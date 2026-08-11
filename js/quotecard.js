// 인용 카드 이미지 생성 — 문장을 이미지로 저장해 공유

import { el, esc, downloadBlob } from './util.js';
import { APP_NAME } from './brand.js';
import { modal, toast } from './ui.js';

const THEMES = [
  { id: 'paper',  name: '종이',   bg: '#f3ece0', fg: '#2a241c', sub: '#7b7062', accent: '#a4552f' },
  { id: 'night',  name: '밤',     bg: '#191712', fg: '#f0ece2', sub: '#9a9184', accent: '#e08a5a' },
  { id: 'ink',    name: '먹',     bg: '#22262b', fg: '#eef1f4', sub: '#98a1aa', accent: '#7fb3d5' },
  { id: 'moss',   name: '이끼',   bg: '#22301f', fg: '#e9f0e4', sub: '#9db396', accent: '#a9c98a' },
  { id: 'plain',  name: '흰지',   bg: '#ffffff', fg: '#1b1b1b', sub: '#8a8a8a', accent: '#c0392b' },
];

const RATIOS = [
  { id: 'square', name: '정사각 1:1', w: 1080, h: 1080 },
  { id: 'story',  name: '스토리 4:5', w: 1080, h: 1350 },
  { id: 'wide',   name: '와이드 16:9', w: 1200, h: 675 },
];

const FONT_SERIF = '"Apple SD Gothic Neo", "Noto Serif KR", "Nanum Myeongjo", Georgia, serif';
const FONT_SANS  = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch === ' ' ? '' : ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** 캔버스에 인용 카드를 그린다 */
export function draw(canvas, { text, title, authors, page, themeId, ratioId }) {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const ratio = RATIOS.find((r) => r.id === ratioId) || RATIOS[0];
  const W = ratio.w, H = ratio.h;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // 얇은 테두리
  ctx.strokeStyle = theme.sub + '55';
  ctx.lineWidth = 2;
  const pad = Math.round(W * 0.055);
  ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

  const inner = Math.round(W * 0.115);
  const maxW = W - inner * 2;

  // 여는 따옴표
  ctx.fillStyle = theme.accent;
  ctx.font = `700 ${Math.round(W * 0.115)}px ${FONT_SERIF}`;
  ctx.textBaseline = 'top';
  ctx.fillText('“', inner - Math.round(W * 0.012), inner - Math.round(W * 0.01));

  // 본문 — 길이에 맞춰 글자 크기 자동 조절
  const bodyTop = inner + Math.round(W * 0.10);
  const footH = Math.round(W * 0.16);
  const avail = H - bodyTop - inner - footH;

  let size = Math.round(W * 0.058);
  let lines = [];
  let lh = 0;
  for (; size >= Math.round(W * 0.026); size -= 2) {
    ctx.font = `400 ${size}px ${FONT_SERIF}`;
    lines = wrap(ctx, text, maxW);
    lh = Math.round(size * 1.62);
    if (lines.length * lh <= avail) break;
  }
  // 그래도 넘치면 잘라내고 말줄임
  const maxLines = Math.max(1, Math.floor(avail / lh));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[lines.length - 1] = lines[lines.length - 1].replace(/.$/, '…');
  }

  ctx.fillStyle = theme.fg;
  ctx.font = `400 ${size}px ${FONT_SERIF}`;
  const blockTop = bodyTop + Math.max(0, (avail - lines.length * lh) / 2);
  lines.forEach((ln, i) => ctx.fillText(ln, inner, blockTop + i * lh));

  // 하단 출처
  const baseY = H - inner - Math.round(W * 0.075);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(inner, baseY - Math.round(W * 0.028), Math.round(W * 0.05), 3);

  ctx.fillStyle = theme.fg;
  ctx.font = `700 ${Math.round(W * 0.032)}px ${FONT_SANS}`;
  const t = wrap(ctx, title || '', maxW)[0] || '';
  ctx.fillText(t, inner, baseY);

  ctx.fillStyle = theme.sub;
  ctx.font = `400 ${Math.round(W * 0.026)}px ${FONT_SANS}`;
  const meta = [authors, page ? `${page}쪽` : ''].filter(Boolean).join(' · ');
  ctx.fillText(meta, inner, baseY + Math.round(W * 0.045));

  // 워터마크
  ctx.fillStyle = theme.sub + '99';
  ctx.font = `600 ${Math.round(W * 0.021)}px ${FONT_SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText(APP_NAME, W - inner, baseY + Math.round(W * 0.045));
  ctx.textAlign = 'left';
}

/** 인용 카드 만들기 모달 */
export function openQuoteCard(note, book) {
  let themeId = 'paper';
  let ratioId = 'square';

  const body = el(`
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="qc-preview"><canvas id="qcCanvas"></canvas></div>
      <div class="field">
        <label>배경</label>
        <div class="qc-themes" id="qcThemes">
          ${THEMES.map((t) => `<button type="button" class="qc-swatch ${t.id === themeId ? 'is-active' : ''}"
             data-theme="${t.id}" title="${esc(t.name)}"
             style="background:${t.bg};border-color:${t.id === themeId ? 'var(--accent)' : 'transparent'};
                    box-shadow:inset 0 0 0 1px ${t.sub}55"></button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>비율</label>
        <div class="chips" id="qcRatios">
          ${RATIOS.map((r) => `<button type="button" class="chip ${r.id === ratioId ? 'is-active' : ''}"
             data-ratio="${r.id}">${esc(r.name)}</button>`).join('')}
        </div>
      </div>
    </div>`);

  modal({
    title: '인용 카드 만들기',
    body,
    foot: `
      <button class="btn" data-copy type="button">이미지 복사</button>
      <button class="btn btn--primary" data-save type="button">PNG 저장</button>`,
    onMount(box, close) {
      const canvas = box.querySelector('#qcCanvas');
      const paint = () => draw(canvas, {
        text: note.text,
        title: book?.title || '',
        authors: (book?.authors || []).join(', '),
        page: note.page,
        themeId, ratioId,
      });
      paint();

      box.querySelector('#qcThemes').addEventListener('click', (e) => {
        const b = e.target.closest('[data-theme]');
        if (!b) return;
        themeId = b.dataset.theme;
        box.querySelectorAll('.qc-swatch').forEach((s) => {
          const on = s.dataset.theme === themeId;
          s.classList.toggle('is-active', on);
          s.style.borderColor = on ? 'var(--accent)' : 'transparent';
        });
        paint();
      });
      box.querySelector('#qcRatios').addEventListener('click', (e) => {
        const b = e.target.closest('[data-ratio]');
        if (!b) return;
        ratioId = b.dataset.ratio;
        box.querySelectorAll('#qcRatios .chip').forEach((c) => c.classList.toggle('is-active', c === b));
        paint();
      });

      box.querySelector('[data-save]').onclick = () => {
        canvas.toBlob((blob) => {
          const name = `인용_${(book?.title || 'card').slice(0, 20).replace(/[\\/:*?"<>|]/g, '')}.png`;
          downloadBlob(blob, name);
          toast('이미지를 저장했어요.');
          close();
        }, 'image/png');
      };

      box.querySelector('[data-copy]').onclick = async () => {
        try {
          const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          toast('클립보드에 복사했어요.');
        } catch {
          toast('이 브라우저에서는 복사를 지원하지 않아요. 저장을 이용해 주세요.');
        }
      };
    },
  });
}
