// 독서 세션 타이머 — 화면 전환/새로고침에도 살아남는 실행 중 세션

import { $, el, esc, fmtClock, ymd } from './util.js';
import * as store from './store.js';
import { modal, toast, fieldHTML } from './ui.js';

const LS_KEY = 'chaekgalpi:timer';
let tick = null;

/** @returns {{bookId:string, startedAt:number, startPage:number|null, pausedMs:number, pausedAt:number|null}|null} */
export function current() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
  catch { return null; }
}
function write(t) {
  if (t) localStorage.setItem(LS_KEY, JSON.stringify(t));
  else localStorage.removeItem(LS_KEY);
}

/** 경과 초 */
function elapsed(t) {
  if (!t) return 0;
  const paused = t.pausedAt ? Date.now() - t.pausedAt : 0;
  return Math.floor((Date.now() - t.startedAt - t.pausedMs - paused) / 1000);
}

export function start(bookId) {
  const running = current();
  if (running && running.bookId !== bookId) {
    toast('이미 다른 책의 세션이 진행 중이에요.');
    return false;
  }
  if (running) return true;
  const book = store.getBook(bookId);
  write({
    bookId,
    startedAt: Date.now(),
    startPage: book?.currentPage ?? null,
    pausedMs: 0,
    pausedAt: null,
  });
  render();
  return true;
}

export function togglePause() {
  const t = current();
  if (!t) return;
  if (t.pausedAt) { t.pausedMs += Date.now() - t.pausedAt; t.pausedAt = null; }
  else t.pausedAt = Date.now();
  write(t);
  render();
}

export function cancel() {
  write(null);
  render();
}

/** 세션 종료 → 기록 저장 모달 */
export function stop() {
  const t = current();
  if (!t) return;
  const secs = elapsed(t);
  const book = store.getBook(t.bookId);
  const minutes = Math.max(1, Math.round(secs / 60));

  modal({
    title: '독서 세션 기록',
    body: `
      <p class="muted" style="margin-bottom:2px">${esc(book?.title || '')}</p>
      <div class="row">
        ${fieldHTML('읽은 시간(분)', `<input class="input" type="number" min="1" id="tsMin" value="${minutes}">`)}
        ${fieldHTML('시작 페이지', `<input class="input" type="number" min="0" id="tsFrom" value="${t.startPage ?? ''}">`)}
        ${fieldHTML('끝 페이지', `<input class="input" type="number" min="0" id="tsTo" value="${book?.currentPage ?? ''}">`)}
      </div>
      ${fieldHTML('한 줄 기록 (선택)', '<textarea class="textarea" id="tsMemo" placeholder="오늘 읽으면서 든 생각"></textarea>')}
      <p class="tiny faint">측정 시간 ${fmtClock(secs)}</p>`,
    foot: `
      <button class="btn btn--danger" data-drop type="button">저장 안 함</button>
      <button class="btn btn--primary" data-save type="button">저장</button>`,
    onMount(box, close) {
      box.querySelector('[data-drop]').onclick = () => { cancel(); close(); toast('세션을 버렸어요.'); };
      box.querySelector('[data-save]').onclick = async () => {
        const num = (id) => {
          const v = box.querySelector(id).value;
          return v === '' ? null : Number(v);
        };
        await store.addSession({
          bookId: t.bookId,
          date: ymd(),
          startedAt: new Date(t.startedAt).toISOString(),
          endedAt: new Date().toISOString(),
          minutes: Math.max(1, Number(box.querySelector('#tsMin').value) || minutes),
          startPage: num('#tsFrom'),
          endPage: num('#tsTo'),
          memo: box.querySelector('#tsMemo').value.trim(),
        });
        cancel();
        close();
        toast('독서 기록을 저장했어요 📖');
      };
    },
  });
}

/** 타이머 없이 과거 세션을 직접 추가 */
export function manualSessionDialog(bookId) {
  const book = store.getBook(bookId);
  modal({
    title: '독서 기록 직접 추가',
    body: `
      <p class="muted">${esc(book?.title || '')}</p>
      <div class="row">
        ${fieldHTML('날짜', `<input class="input" type="date" id="msDate" value="${ymd()}">`)}
        ${fieldHTML('읽은 시간(분)', '<input class="input" type="number" min="1" id="msMin" value="30">')}
      </div>
      <div class="row">
        ${fieldHTML('시작 페이지', `<input class="input" type="number" min="0" id="msFrom" value="${book?.currentPage ?? ''}">`)}
        ${fieldHTML('끝 페이지', '<input class="input" type="number" min="0" id="msTo">')}
      </div>
      ${fieldHTML('한 줄 기록 (선택)', '<textarea class="textarea" id="msMemo"></textarea>')}`,
    foot: '<button class="btn btn--primary" data-save type="button">추가</button>',
    onMount(box, close) {
      box.querySelector('[data-save]').onclick = async () => {
        const date = box.querySelector('#msDate').value || ymd();
        const num = (id) => {
          const v = box.querySelector(id).value;
          return v === '' ? null : Number(v);
        };
        await store.addSession({
          bookId,
          date,
          startedAt: new Date(`${date}T12:00:00`).toISOString(),
          endedAt: new Date(`${date}T12:00:00`).toISOString(),
          minutes: Math.max(1, Number(box.querySelector('#msMin').value) || 1),
          startPage: num('#msFrom'),
          endPage: num('#msTo'),
          memo: box.querySelector('#msMemo').value.trim(),
        });
        close();
        toast('기록을 추가했어요.');
      };
    },
  });
}

/* ---------- 하단 도크 렌더링 ---------- */
export function render() {
  const dock = $('#timerDock');
  if (!dock) return;
  const t = current();

  if (!t) {
    dock.hidden = true;
    dock.innerHTML = '';
    if (tick) { clearInterval(tick); tick = null; }
    return;
  }

  const book = store.getBook(t.bookId);
  if (!book) { cancel(); return; }

  if (!dock.dataset.bookId || dock.dataset.bookId !== t.bookId || !dock.innerHTML) {
    dock.dataset.bookId = t.bookId;
    dock.innerHTML = `
      <span class="timer-pulse"></span>
      <div class="timer-dock__body">
        <div class="timer-dock__time" id="tdTime">00:00:00</div>
        <div class="timer-dock__title">${esc(book.title)}</div>
      </div>
      <button class="btn btn--sm" data-pause type="button">일시정지</button>
      <button class="btn btn--sm btn--primary" data-stop type="button">종료</button>`;
    dock.querySelector('[data-pause]').onclick = togglePause;
    dock.querySelector('[data-stop]').onclick = stop;
  }
  dock.hidden = false;

  const paint = () => {
    const cur = current();
    if (!cur) return render();
    const timeEl = dock.querySelector('#tdTime');
    if (timeEl) timeEl.textContent = fmtClock(elapsed(cur));
    const pauseBtn = dock.querySelector('[data-pause]');
    if (pauseBtn) pauseBtn.textContent = cur.pausedAt ? '이어하기' : '일시정지';
    dock.querySelector('.timer-pulse').style.animationPlayState = cur.pausedAt ? 'paused' : 'running';
  };
  paint();
  if (!tick) tick = setInterval(paint, 1000);
}

export const isRunning = (bookId) => {
  const t = current();
  return !!t && (!bookId || t.bookId === bookId);
};
