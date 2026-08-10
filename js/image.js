// 사진 다루기 — 업로드한 이미지를 적당한 크기로 줄여 저장 가능한 형태로 만든다

const MAX_EDGE = 1600;   // 장변 기준
const QUALITY  = 0.82;

/** 대략적인 data URL 바이트 수 (base64 → 실제 크기) */
export const dataUrlBytes = (dataUrl) => {
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
};

export function fmtBytes(n) {
  if (!n) return '0B';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* 아래 방법으로 재시도 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('이미지를 열 수 없어요.'));
      el.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * 사진을 장변 1600px, JPEG 82% 로 줄인다.
 * @returns {Promise<{dataUrl:string, bytes:number, w:number, h:number}>}
 */
export async function shrinkImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('이미지 파일이 아니에요.');
  }
  const bmp = await loadBitmap(file);
  const sw = bmp.width, sh = bmp.height;
  if (!sw || !sh) throw new Error('이미지 크기를 읽을 수 없어요.');

  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl, bytes: dataUrlBytes(dataUrl), w, h };
}

/** 파일 선택창 (모바일에서는 카메라도 함께 뜬다) */
export function pickImage() {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*';
    i.onchange = () => resolve(i.files?.[0] || null);
    i.click();
  });
}
