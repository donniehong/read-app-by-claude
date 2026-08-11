// 사진에서 문장 가져오기
//
// 흐름: 사진 고르기 → 문장 영역을 손가락/마우스로 끌어 선택 → 그 부분만 인식
//      → 편집 가능한 글자로 채워짐 → 쪽수·태그 붙여 저장 (원본 사진도 함께 보관)
//
// 영역을 좁게 고를수록 인식이 정확해지므로, 선택은 정확도를 위한 장치이기도 하다.

import { el, esc } from './util.js';
import * as store from './store.js';
import { modal, toast, fieldHTML, parseList } from './ui.js';
import { shrinkImage, pickImage, fmtBytes } from './image.js';
import * as ocr from './ocr.js';

/**
 * @param {{bookId?: string}} opts
 */
export async function openPhotoNote({ bookId = '' } = {}) {
  const books = store.books();
  if (!books.length) { toast('먼저 책을 추가해 주세요.'); return; }

  const file = await pickImage();
  if (!file) return;

  let shrunk;
  try {
    shrunk = await shrinkImage(file, { maxEdge: 2000, quality: 0.85 });
  } catch (e) {
    toast(`사진을 열지 못했어요: ${e.message}`);
    return;
  }

  const supported = ocr.isSupported();

  const body = el(`
    <div style="display:flex;flex-direction:column;gap:13px">
      ${!bookId ? fieldHTML('책', `<select class="select" id="pnBook">
          ${books.map((b) => `<option value="${esc(b.id)}">${esc(b.title)}</option>`).join('')}
        </select>`) : ''}

      <div>
        <div class="pn-stage" id="pnStage">
          <img id="pnImg" src="${shrunk.dataUrl}" alt="올린 사진" draggable="false">
          <div class="pn-sel" id="pnSel" hidden></div>
        </div>
        <p class="tiny faint" id="pnHint" style="margin-top:8px">
          ${supported
            ? '읽어 올 문장 위를 손가락이나 마우스로 <b>끌어서</b> 선택하세요. 좁게 고를수록 정확합니다.'
            : '이 브라우저는 글자 인식을 지원하지 않아요. 사진은 그대로 보관하고, 문장은 직접 입력해 주세요.'}
        </p>
      </div>

      <div class="chips">
        ${supported ? `
          <button class="btn btn--primary btn--sm" id="pnRun" type="button" disabled>선택 영역 읽기</button>
          <button class="btn btn--sm" id="pnAll" type="button">사진 전체 읽기</button>
          <button class="btn btn--ghost btn--sm" id="pnClear" type="button" hidden>선택 지우기</button>` : ''}
      </div>
      <div id="pnProgress" class="pn-progress" hidden><i></i></div>

      ${fieldHTML('문장 *', '<textarea class="textarea" id="pnText" style="min-height:120px" placeholder="인식된 글자가 여기에 들어옵니다. 틀린 곳은 고쳐 주세요."></textarea>')}
      <div class="row">
        ${fieldHTML('쪽수', '<input class="input" id="pnPage" type="number" min="0">')}
        ${fieldHTML('태그', '<input class="input" id="pnTags" placeholder="쉼표로 구분">')}
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer">
        <input type="checkbox" id="pnKeep" checked> 원본 사진도 함께 보관 (${fmtBytes(shrunk.bytes)})
      </label>
    </div>`);

  modal({
    title: '사진에서 문장 가져오기',
    body,
    wide: true,
    foot: '<button class="btn btn--primary" data-save type="button">저장</button>',
    onMount(box, close) {
      const stage = box.querySelector('#pnStage');
      const img = box.querySelector('#pnImg');
      const sel = box.querySelector('#pnSel');
      const text = box.querySelector('#pnText');
      const bar = box.querySelector('#pnProgress');
      const hint = box.querySelector('#pnHint');
      const runBtn = box.querySelector('#pnRun');
      const allBtn = box.querySelector('#pnAll');
      const clearBtn = box.querySelector('#pnClear');

      /** 선택 영역 — 무대(.pn-stage) 좌표 기준. 없으면 null */
      let rect = null;
      let drag = null;

      /**
       * 사진이 무대 안에서 실제로 그려진 영역.
       * 요소 박스는 여백을 포함할 수 있어(object-fit: contain) 그대로 쓰면 좌표가 어긋난다.
       */
      const drawnArea = () => {
        const sr = stage.getBoundingClientRect();
        const ir = img.getBoundingClientRect();
        const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
        const scale = Math.min(ir.width / nw, ir.height / nh) || 1;
        const w = nw * scale, h = nh * scale;
        return {
          left: (ir.left - sr.left) + (ir.width - w) / 2,
          top: (ir.top - sr.top) + (ir.height - h) / 2,
          width: w, height: h, scale,
        };
      };

      const showSel = () => {
        if (!rect) { sel.hidden = true; clearBtn.hidden = true; if (runBtn) runBtn.disabled = true; return; }
        sel.hidden = false;
        sel.style.left = `${rect.x}px`;
        sel.style.top = `${rect.y}px`;
        sel.style.width = `${rect.w}px`;
        sel.style.height = `${rect.h}px`;
        clearBtn.hidden = false;
        if (runBtn) runBtn.disabled = rect.w < 12 || rect.h < 8;
      };

      /** 포인터 위치를 무대 좌표로 바꾸고, 사진 밖으로는 나가지 않게 가둔다 */
      const pointFrom = (e) => {
        const sr = stage.getBoundingClientRect();
        const a = drawnArea();
        const p = e.touches?.[0] || e;
        return {
          x: Math.max(a.left, Math.min(a.left + a.width, p.clientX - sr.left)),
          y: Math.max(a.top, Math.min(a.top + a.height, p.clientY - sr.top)),
        };
      };

      if (supported) {
        const start = (e) => {
          e.preventDefault();
          const p = pointFrom(e);
          drag = p;
          rect = { x: p.x, y: p.y, w: 0, h: 0 };
          showSel();
        };
        const move = (e) => {
          if (!drag) return;
          e.preventDefault();
          const p = pointFrom(e);
          rect = {
            x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y),
            w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y),
          };
          showSel();
        };
        const end = () => { drag = null; showSel(); };

        stage.addEventListener('pointerdown', start);
        stage.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        stage.addEventListener('touchstart', start, { passive: false });
        stage.addEventListener('touchmove', move, { passive: false });
        stage.addEventListener('touchend', end);
      }

      /** 선택 영역(또는 전체)을 원본 해상도로 잘라낸다 */
      const crop = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!rect) {
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          ctx.drawImage(img, 0, 0);
          return canvas;
        }
        const a = drawnArea();
        // 무대 좌표 → 사진 원본 좌표
        const sx = Math.max(0, (rect.x - a.left) / a.scale);
        const sy = Math.max(0, (rect.y - a.top) / a.scale);
        const sw = Math.max(1, Math.min(img.naturalWidth - sx, rect.w / a.scale));
        const sh = Math.max(1, Math.min(img.naturalHeight - sy, rect.h / a.scale));
        canvas.width = Math.round(sw); canvas.height = Math.round(sh);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        return canvas;
      };

      const run = async (whole) => {
        const saved = rect;
        if (whole) rect = null;
        bar.hidden = false;
        bar.firstElementChild.style.width = '5%';
        hint.textContent = '읽는 중… 처음 한 번은 엔진을 준비하느라 몇 초 걸립니다.';
        [runBtn, allBtn].forEach((b) => b && (b.disabled = true));

        try {
          const { text: got, confidence } = await ocr.recognize(crop(), {
            mode: whole ? 'auto' : 'block',
            onProgress: ({ progress }) => {
              bar.firstElementChild.style.width = `${Math.max(5, Math.round(progress * 100))}%`;
            },
          });
          if (!got.trim()) {
            hint.textContent = '글자를 찾지 못했어요. 영역을 다시 잡거나 직접 입력해 주세요.';
          } else {
            text.value = text.value.trim() ? `${text.value.trim()}\n${got}` : got;
            hint.innerHTML = confidence >= 80
              ? `읽었어요 (정확도 추정 ${confidence}%). <b>틀린 글자가 없는지 확인해 주세요.</b>`
              : `읽었지만 자신이 없어요 (정확도 추정 ${confidence}%). <b>꼭 확인하고 고쳐 주세요.</b>`;
          }
        } catch (e) {
          hint.textContent = `인식에 실패했어요: ${e.message}`;
        } finally {
          bar.hidden = true;
          [runBtn, allBtn].forEach((b) => b && (b.disabled = false));
          rect = whole ? saved : rect;
          showSel();
        }
      };

      runBtn?.addEventListener('click', () => run(false));
      allBtn?.addEventListener('click', () => run(true));
      clearBtn?.addEventListener('click', () => { rect = null; showSel(); });

      box.querySelector('[data-save]').onclick = async (e) => {
        const value = text.value.trim();
        if (!value) { toast('문장을 입력하거나 인식해 주세요.'); text.focus(); return; }
        const btn = e.currentTarget;
        btn.disabled = true;

        try {
          const id = bookId || box.querySelector('#pnBook')?.value;
          const pageRaw = box.querySelector('#pnPage').value;
          const photo = box.querySelector('#pnKeep').checked
            ? await store.saveImage(shrunk)
            : null;

          await store.addNote({
            bookId: id,
            type: 'quote',
            text: value,
            page: pageRaw === '' ? null : Number(pageRaw),
            tags: parseList(box.querySelector('#pnTags').value),
            photo,
            source: 'photo',
          });
          close();
          toast('문장을 기록했어요 ✍️');
        } catch (err) {
          btn.disabled = false;
          toast(`저장하지 못했어요: ${err.message}`);
        }
      };

      // 엔진을 미리 준비해 두면 첫 인식이 눈에 띄게 빨라진다
      if (supported) ocr.prefetch();
    },
  });
}
