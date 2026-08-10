// 서재 — 상태 탭 · 검색 · 정렬 · 태그 필터 · 그리드/리스트

import { el, esc, on, nfmt } from '../util.js';
import * as store from '../store.js';
import { shelfItemHTML, bookRowHTML, toast } from '../ui.js';
import { openAddBook } from '../dialogs.js';
import { go } from '../router.js';

const SORTS = {
  recent:  { label: '최근 활동순', fn: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) },
  added:   { label: '추가한 순',   fn: (a, b) => String(b.addedAt).localeCompare(String(a.addedAt)) },
  title:   { label: '제목순',      fn: (a, b) => a.title.localeCompare(b.title, 'ko') },
  author:  { label: '저자순',      fn: (a, b) => ((a.authors || [])[0] || '').localeCompare((b.authors || [])[0] || '', 'ko') },
  rating:  { label: '별점 높은순', fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
  finished:{ label: '완독 최신순', fn: (a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)) },
  progress:{ label: '진도 많은순', fn: (a, b) => store.progressOf(b) - store.progressOf(a) },
};

/** 라이브러리 UI 상태 — 화면 이동 후 돌아와도 유지 */
const uiState = { status: 'all', q: '', sort: null, tag: '', view: null };

export default function libraryView(params = {}) {
  const st = store.settings();
  if (uiState.sort === null) uiState.sort = st.defaultSort || 'recent';
  if (uiState.view === null) uiState.view = st.shelfView || 'grid';
  if (params.status) uiState.status = params.status;
  if (params.tag) uiState.tag = params.tag;

  const all = store.books();
  const counts = { all: all.length };
  for (const s of store.STATUS_ORDER) counts[s] = all.filter((b) => b.status === s).length;

  const tagPool = [...new Set(all.flatMap((b) => b.tags || []))].sort((a, b) => a.localeCompare(b, 'ko'));

  const root = el(`
    <div>
      <div class="section__head" style="margin-bottom:14px">
        <h1 style="font-size:22px">서재</h1>
        <span class="muted tiny">${nfmt(all.length)}권</span>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn--sm" data-view type="button">${uiState.view === 'grid' ? '☰ 목록' : '▦ 표지'}</button>
          <button class="btn btn--sm btn--primary" data-add type="button">＋ 추가</button>
        </div>
      </div>

      <div class="scroller" style="margin-bottom:10px">
        <button class="chip ${uiState.status === 'all' ? 'is-active' : ''}" data-status="all" type="button">전체 ${counts.all}</button>
        ${store.STATUS_ORDER.map((s) => `
          <button class="chip ${uiState.status === s ? 'is-active' : ''}" data-status="${s}" type="button">
            ${store.STATUS[s]} ${counts[s]}</button>`).join('')}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <input class="input" id="libQ" placeholder="제목·저자·태그 검색" value="${esc(uiState.q)}"
               style="flex:1 1 200px;height:38px;padding:0 12px">
        <select class="select" id="libSort" style="flex:0 0 auto;width:auto;height:38px;padding:0 10px">
          ${Object.entries(SORTS).map(([k, v]) =>
            `<option value="${k}" ${uiState.sort === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
      </div>

      ${tagPool.length ? `
      <div class="scroller" style="margin-bottom:16px">
        <button class="chip ${!uiState.tag ? 'is-active' : ''}" data-tag="" type="button">태그 전체</button>
        ${tagPool.map((t) => `<button class="chip ${uiState.tag === t ? 'is-active' : ''}" data-tag="${esc(t)}" type="button"># ${esc(t)}</button>`).join('')}
      </div>` : ''}

      <div id="libBody"></div>
    </div>`);

  function filtered() {
    const q = uiState.q.trim().toLowerCase();
    let rows = all.filter((b) => {
      if (uiState.status !== 'all' && b.status !== uiState.status) return false;
      if (uiState.tag && !(b.tags || []).includes(uiState.tag)) return false;
      if (!q) return true;
      const hay = [b.title, b.subtitle, (b.authors || []).join(' '), b.publisher,
        (b.tags || []).join(' '), (b.categories || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
    rows = rows.sort(SORTS[uiState.sort]?.fn || SORTS.recent.fn);
    return rows;
  }

  function paint() {
    const rows = filtered();
    const body = root.querySelector('#libBody');
    if (!rows.length) {
      body.innerHTML = all.length ? `
        <div class="empty"><strong>조건에 맞는 책이 없어요</strong>검색어나 필터를 바꿔 보세요.</div>` : `
        <div class="empty"><strong>서재가 비어 있어요</strong>
          첫 책을 담아 독서 기록을 시작해 보세요.
          <div style="margin-top:14px"><button class="btn btn--primary" data-add type="button">책 추가하기</button></div>
        </div>`;
      return;
    }
    body.innerHTML = uiState.view === 'grid'
      ? `<div class="shelf">${rows.map(shelfItemHTML).join('')}</div>`
      : `<div class="booklist">${rows.map((b) => bookRowHTML(b)).join('')}</div>`;
  }
  paint();

  /* ---- 이벤트 ---- */
  on(root, 'click', '[data-status]', (e, t) => {
    uiState.status = t.dataset.status;
    root.querySelectorAll('[data-status]').forEach((c) => c.classList.toggle('is-active', c === t));
    paint();
  });
  on(root, 'click', '[data-tag]', (e, t) => {
    uiState.tag = t.dataset.tag;
    root.querySelectorAll('[data-tag]').forEach((c) => c.classList.toggle('is-active', c === t));
    paint();
  });
  on(root, 'click', '[data-book]', (e, t) => go(`#/book/${t.dataset.book}`));
  on(root, 'click', '[data-add]', () => openAddBook());
  on(root, 'click', '[data-view]', async (e, t) => {
    uiState.view = uiState.view === 'grid' ? 'list' : 'grid';
    t.textContent = uiState.view === 'grid' ? '☰ 목록' : '▦ 표지';
    await store.saveSettings({ shelfView: uiState.view });
    paint();
  });

  root.querySelector('#libQ').addEventListener('input', (e) => {
    uiState.q = e.target.value;
    paint();
  });
  root.querySelector('#libSort').addEventListener('change', (e) => {
    uiState.sort = e.target.value;
    paint();
  });

  void toast;
  return root;
}

/** 상단 전역 검색창에서 호출 */
export function setQuery(q) {
  uiState.q = q;
  uiState.status = 'all';
  uiState.tag = '';
}
