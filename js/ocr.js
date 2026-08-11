// 사진 속 글자 인식 (OCR)
//
// 인식은 전부 이 기기 안에서 이루어진다. 사진은 어디로도 전송되지 않는다.
// 엔진(약 4.6MB)은 저장소에 함께 담겨 있어 오프라인에서도 동작하지만,
// 처음 쓸 때 한 번 읽어 들이는 시간이 걸리므로 필요해질 때까지 불러오지 않는다.

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;

let scriptLoaded = null;
let workerPromise = null;

// 진행률 콜백은 인식기를 만들 때 한 번만 등록되므로,
// 매 호출마다 다른 콜백을 쓸 수 있도록 한 단계 거쳐 보낸다.
let progressSink = null;

/** 이 브라우저가 WebAssembly SIMD 를 지원하는지 (엔진이 SIMD 판만 동봉되어 있다) */
export function isSupported() {
  if (typeof WebAssembly !== 'object') return false;
  try {
    // SIMD 명령(v128)이 든 최소 모듈을 검증해 본다
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
      3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]));
  } catch { return false; }
}

function loadScript() {
  if (scriptLoaded) return scriptLoaded;
  scriptLoaded = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = `${BASE}tesseract.min.js`;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('엔진을 불러오지 못했어요.')));
    s.onerror = () => reject(new Error('엔진 파일을 찾을 수 없어요.'));
    document.head.appendChild(s);
  });
  return scriptLoaded;
}

/**
 * 인식기를 준비한다. 한 번 만들어 두고 계속 쓴다.
 * @param {(p:{status:string, progress:number})=>void} [onProgress]
 */
export function warmUp() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    if (!isSupported()) throw new Error('이 브라우저는 사진 글자 인식을 지원하지 않아요.');
    const Tesseract = await loadScript();
    return Tesseract.createWorker('kor', 1, {
      // 워커를 blob 으로 감싸면 워커 안에서 상대 경로 기준이 사라져 wasm 을 못 찾는다
      workerBlobURL: false,
      workerPath: `${BASE}worker.min.js`,
      corePath: `${BASE}tesseract-core-simd-lstm.js`,
      langPath: `${BASE}lang`,
      gzip: true,
      // 항상 함수를 넘긴다 — undefined 를 주면 엔진이 기본 로거 자리에 그대로 넣어 두고 호출하다 터진다
      logger: (m) => progressSink?.({ status: m.status, progress: m.progress || 0 }),
    });
  })().catch((e) => { workerPromise = null; throw e; });
  return workerPromise;
}

/**
 * 잘라낸 조각을 인식하기 좋게 다듬는다. 회색조로 바꾸고 대비를 살짝 올린 뒤,
 * 글자가 작으면 조금 키운다.
 *
 * 확대 배율은 2배를 넘기지 않는다. 그 이상 늘리면 없던 정보가 생기지 않는데도
 * 보간 얼룩 때문에 엔진이 있지도 않은 글줄을 하나 더 만들어 낸다
 * (3배로 키웠을 때 같은 문장이 두 번 읽히는 것을 확인했다).
 */
const TARGET_H = 450;   // 이 정도 높이일 때 인식이 가장 안정적이었다
const MAX_EDGE = 3000;  // 지나치게 큰 캔버스는 느리기만 하다

export function preprocess(source, { targetHeight = TARGET_H } = {}) {
  const sw = source.width, sh = source.height;
  let scale = Math.max(1, Math.min(2, targetHeight / Math.max(1, sh)));
  if (Math.max(sw, sh) * scale > MAX_EDGE) scale = MAX_EDGE / Math.max(sw, sh);
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // 회색조 + 평균 밝기 계산
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    sum += g;
  }
  const mean = sum / (d.length / 4);

  // 평균을 가운데로 두고 대비를 완만하게 올린다 (완전 이진화는 얇은 획을 지운다)
  const contrast = 1.35;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, (d[i] - mean) * contrast + mean));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// 마지막으로 지정한 페이지 분할 방식 (같은 값이면 다시 설정하지 않는다)
let lastMode = null;

/**
 * 이미지(또는 캔버스)에서 글자를 읽는다.
 * @param {'block'|'auto'} [opts.mode]
 *   block — 사용자가 고른 한 덩어리의 글. 기본값이며 오려낸 영역에 알맞다.
 *   auto  — 사진 전체처럼 편집이 어떻게 되어 있는지 모를 때.
 * @returns {Promise<{text:string, confidence:number}>}
 */
export async function recognize(source, { onProgress, mode = 'block' } = {}) {
  progressSink = onProgress || null;
  try {
    const worker = await warmUp();
    if (mode !== lastMode) {
      // 6 = 하나의 글 덩어리, 3 = 자동 편집 분석
      await worker.setParameters({ tessedit_pageseg_mode: mode === 'auto' ? '3' : '6' });
      lastMode = mode;
    }
    const { data } = await worker.recognize(preprocess(source), {}, { text: true, blocks: true });
    return {
      text: cleanUp(pickLines(data)),
      confidence: Math.round(data.confidence || 0),
    };
  } finally {
    progressSink = null;
  }
}

/**
 * 줄별 신뢰도를 보고 잡음 줄을 걷어낸다.
 * 종이 가장자리나 얼룩이 짧고 자신 없는 한 줄로 잡히는 일이 잦은데,
 * '짧으면서 자신도 없는' 줄만 버리므로 "끝." 같은 짧은 진짜 문장은 남는다.
 */
function pickLines(data) {
  const lines = (data.blocks || [])
    .flatMap((b) => b.paragraphs || [])
    .flatMap((par) => par.lines || []);
  if (!lines.length) return data.text || '';

  const kept = lines.filter((l) => {
    const t = (l.text || '').trim();
    if (!t) return false;
    // 잡음 줄은 공백이 잔뜩 섞여 길어 보이므로, 길이는 공백을 뺀 글자 수로 센다
    const chars = t.replace(/\s+/g, '').length;
    if (l.confidence < 30) return false;            // 사실상 못 읽은 줄
    return !(l.confidence < 60 && chars <= 4);      // 짧으면서 자신도 없는 줄
  });
  if (!kept.length) return data.text || '';
  return kept.map((l) => (l.text || '').replace(/\n+$/, '')).join('\n');
}

/**
 * 인식 결과의 겉모양만 다듬는다.
 * 띄어쓰기는 건드리지 않는다 — 붙이거나 떼는 순간 멀쩡한 문장이 망가진다.
 * 오인식 교정은 사용자가 눈으로 보고 고치는 편이 낫다.
 */
export function cleanUp(raw) {
  return String(raw)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 미리 준비해 두기 (실패해도 조용히 넘어간다) */
export function prefetch() {
  if (!isSupported()) return;
  warmUp().catch(() => {});
}
