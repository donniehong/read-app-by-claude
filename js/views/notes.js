// 문장·실천 — 모든 인용/메모/실천을 한곳에서 검색하고 관리

import { el, esc, on, fmtRelative } from '../util.js';
import * as store from '../store.js';
import { toast, confirmDialog } from '../ui.js';
import { openNoteEditor } from '../dialogs.js';
import { openQuoteCard } from '../quotecard.js';
import { go } from '../router.js';

const uiState = { type: 'all', q: '', tag: '', hideDone: true };

export default function notesView(params = {}) {
  if (params.type) uiState.type = params.type;

  const all = [...store.notes()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const counts = { all: all.length, quote: 0, memo: 0, action: 0 };
  all.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
  const tagPool = [...new Set(all.flatMap((n) => n.tags || []))].sort((a, b) => a.localeCompare(b, 'ko'));

  const root = el(`
    <div>
      <div class="section__head" style="margin-bottom:14px">
        <h1 style="font-size:22px">문장·실천</h1>
        <span class="muted tiny">${all.length}개</span>
        <button class="btn btn--sm btn--primary" data-new type="button" style="margin-left:auto">＋ 기록</button>
      </div>

      <div class="scroller" style="margin-bottom:10px">
        <button class="chip ${uiState.type === 'all' ? 'is-active' : ''}" data-type="all" type="button">전체 ${counts.all}</button>
        ${Object.entries(store.NOTE_TYPES).map(([k, m]) =>
          `<button class="chip ${uiState.type === k ? 'is-active' : ''}" data-type="${k}" type="button">${m.icon} ${m.label} ${counts[k] || 0}</button>`).join('')}
      </div>

      <input class="input" id="ntQ" placeholder="문장 속 단어로 검색" value="${esc(uiState.q)}"
             style="height:38px;padding:0 12px;margin-bottom:10px">

      ${tagPool.length ? `
      <div class="scroller" style="margin-bottom:14px">
        <button class="chip ${!uiState.tag ? 'is-active' : ''}" data-tag="" type="button">태그 전체</button>
        ${tagPool.map((t) => `<button class="chip ${uiState.tag === t ? 'is-active' : ''}" data-tag="${esc(t)}" type="button"># ${esc(t)}</button>`).join('')}
      </div>` : ''}

      <label id="ntDoneWrap" class="tiny muted" style="display:none;gap:7px;align-items:center;margin-bottom:12px;cursor:pointer">
        <input type="checkbox" id="ntHideDone" ${uiState.hideDone ? 'checked' : ''}> 완료한 실천 숨기기
      </label>

      <div id="ntBody"></div>
    </div>`);

  function filtered() {
    const q = uiState.q.trim().toLowerCase();
    return all.filter((n) => {
      if (uiState.type !== 'all' && n.type !== uiState.type) return false;
      if (uiState.tag && !(n.tags || []).includes(uiState.tag)) return false;
      if (n.type === 'action' && uiState.hideDone && n.done && uiState.type === 'action') return false;
      if (!q) return true;
      const book = store.getBook(n.bookId);
      return [n.text, n.comment, book?.title, (book?.authors || []).join(' '), (n.tags || []).join(' ')]
        .join(' ').toLowerCase().includes(q);
    });
  }

  function cardHTML(n) {
    const b = store.getBook(n.bookId);
    const meta = store.NOTE_TYPES[n.type] || store.NOTE_TYPES.memo;
    return `
      <article class="note note--${esc(n.type)} ${n.done ? 'is-done' : ''}" data-noteid="${esc(n.id)}">
        <div class="note__head">
          ${n.type === 'action' ? '<button class="note-check" data-toggle type="button" aria-label="완료">✓</button>' : ''}
          <div style="min-width:0;flex:1">
            <div class="note__text">${esc(n.text)}</div>
            ${n.comment ? `<div class="note__comment">${esc(n.comment)}</div>` : ''}
          </div>
        </div>
        <div class="note__foot">
          <span class="link" data-book="${esc(n.bookId)}" style="cursor:pointer;color:var(--text-dim);font-weight:600">
            ${esc(b?.title || '(삭제된 책)')}</span>
          ${n.page != null ? `<span class="mono">${n.page}쪽</span>` : ''}
          <span>${esc(meta.label)}</span>
          <span>${esc(fmtRelative(n.createdAt))}</span>
          <span class="spacer"></span>
          <span class="note__actions">
            ${n.type === 'quote' ? '<button class="btn btn--sm btn--ghost" data-card type="button">카드</button>' : ''}
            <button class="btn btn--sm btn--ghost" data-edit type="button">수정</button>
            <button class="btn btn--sm btn--ghost" data-del type="button">삭제</button>
          </span>
        </div>
      </article>`;
  }

  function paint() {
    const rows = filtered();
    root.querySelector('#ntDoneWrap').style.display = uiState.type === 'action' ? 'flex' : 'none';
    const host = root.querySelector('#ntBody');
    if (!rows.length) {
      host.innerHTML = all.length
        ? '<div class="empty"><strong>결과가 없어요</strong>검색어나 필터를 바꿔 보세요.</div>'
        : `<div class="empty"><strong>기록이 아직 없어요</strong>
             책을 읽다 마음에 닿은 문장을 남기면 여기 모여요.
             <div style="margin-top:14px"><button class="btn btn--primary" data-new type="button">첫 문장 남기기</button></div>
           </div>`;
      return;
    }
    host.innerHTML = uiState.type === 'quote'
      ? `<div class="masonry">${rows.map(cardHTML).join('')}</div>`
      : rows.map(cardHTML).join('');
  }
  paint();

  /* ---- 이벤트 ---- */
  on(root, 'click', '[data-type]', (e, t) => {
    uiState.type = t.dataset.type;
    root.querySelectorAll('[data-type]').forEach((c) => c.classList.toggle('is-active', c === t));
    paint();
  });
  on(root, 'click', '[data-tag]', (e, t) => {
    uiState.tag = t.dataset.tag;
    root.querySelectorAll('[data-tag]').forEach((c) => c.classList.toggle('is-active', c === t));
    paint();
  });
  root.querySelector('#ntQ').addEventListener('input', (e) => { uiState.q = e.target.value; paint(); });
  root.querySelector('#ntHideDone').addEventListener('change', (e) => {
    uiState.hideDone = e.target.checked; paint();
  });

  on(root, 'click', '[data-new]', () => {
    if (!store.books().length) { toast('먼저 책을 추가해 주세요.'); return; }
    openNoteEditor({ type: uiState.type === 'all' ? 'quote' : uiState.type });
  });
  on(root, 'click', '[data-book]', (e, t) => go(`#/book/${t.dataset.book}`));

  const noteOf = (t) => all.find((x) => x.id === t.closest('[data-noteid]').dataset.noteid);
  on(root, 'click', '[data-toggle]', async (e, t) => {
    const n = noteOf(t);
    await store.updateNote(n.id, { done: !n.done });
    if (!n.done) toast('실천 완료! 👏');
  });
  on(root, 'click', '[data-edit]', (e, t) => {
    const n = noteOf(t);
    openNoteEditor({ bookId: n.bookId, note: n });
  });
  on(root, 'click', '[data-card]', (e, t) => {
    const n = noteOf(t);
    openQuoteCard(n, store.getBook(n.bookId));
  });
  on(root, 'click', '[data-del]', async (e, t) => {
    const n = noteOf(t);
    const ok = await confirmDialog({ title: '기록 삭제', message: '이 기록을 지울까요?', okText: '삭제', danger: true });
    if (ok) { await store.removeNote(n.id); toast('삭제했어요.'); }
  });

  return root;
}
