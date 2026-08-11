// 앱 부트스트랩 — 라우팅, 전역 이벤트, 단축키

import { $, $$, on, debounce } from './util.js';
import * as store from './store.js';
import { applyTheme, nextMode, cacheTheme } from './theme.js';
import { route, match, start, go, currentPathname, setCurrent } from './router.js';
import { toast, modalOpen, hydrateImages } from './ui.js';
import { openAddBook, openNoteEditor } from './dialogs.js';
import * as timer from './timer.js';
import * as sync from './sync.js';

import homeView from './views/home.js';
import libraryView, { setQuery } from './views/library.js';
import bookView from './views/book.js';
import timelineView from './views/timeline.js';
import notesView from './views/notes.js';
import statsView from './views/stats.js';
import settingsView from './views/settings.js';

/* ---------- 라우트 ---------- */
route('/home', homeView, 'home');
route('/library', libraryView, 'library');
route('/book/:id', bookView, 'library');
route('/timeline', timelineView, 'timeline');
route('/notes', notesView, 'notes');
route('/stats', statsView, 'stats');
route('/settings', settingsView, 'settings');

const viewEl = $('#view');
let renderToken = 0;

function parseHash() {
  const raw = location.hash.slice(1) || '/home';
  const [path, qs] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  return { path: path || '/home', params };
}

function render() {
  const token = ++renderToken;
  const { path, params } = parseHash();
  setCurrent(path);

  // '#/add' 는 화면이 아니라 모달을 여는 단축 경로
  if (path === '/add') {
    history.replaceState(null, '', '#/library');
    setCurrent('/library');
    render();
    openAddBook();
    return;
  }

  const hit = match(path);
  if (!hit) {
    viewEl.innerHTML = `<div class="empty"><strong>페이지를 찾을 수 없어요</strong>
      <div style="margin-top:14px"><a class="btn" href="#/home">홈으로</a></div></div>`;
    return;
  }

  const scrollKey = `scroll:${path}`;
  const keepScroll = viewEl.dataset.path === path;
  const prevScroll = window.scrollY;

  let node;
  try {
    node = hit.view({ ...hit.params, ...params });
  } catch (e) {
    console.error(e);
    viewEl.innerHTML = `<div class="empty"><strong>화면을 그리는 중 문제가 생겼어요</strong>${e.message}</div>`;
    return;
  }
  if (token !== renderToken) return;

  viewEl.replaceChildren(node);
  viewEl.dataset.path = path;
  void scrollKey;

  if (keepScroll) window.scrollTo(0, prevScroll);
  else window.scrollTo(0, 0);

  // 내비게이션 활성 표시
  $$('[data-route]').forEach((a) => a.classList.toggle('is-active', a.dataset.route === hit.name));
  timer.render();
  hydrateImages(viewEl);
}

/* ---------- 전역 이벤트 ---------- */
function wireChrome() {
  $('#btnAddBook').onclick = () => openAddBook();

  $('#btnTheme').onclick = async () => {
    const m = nextMode();
    applyTheme(m);
    cacheTheme(m);
    await store.saveSettings({ theme: m });
  };

  on(document, 'click', '[data-nav]', (e, t) => go(t.dataset.nav));

  const search = $('#globalSearch');
  const runSearch = debounce((v) => {
    setQuery(v);
    if (currentPathname() !== '/library') go('#/library');
    else render();
  }, 250);
  search.addEventListener('input', (e) => runSearch(e.target.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { setQuery(search.value); go('#/library'); search.blur(); }
    if (e.key === 'Escape') { search.value = ''; setQuery(''); search.blur(); render(); }
  });

  // 단축키 (입력 중이거나 모달이 열려 있으면 무시)
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (modalOpen()) return;

    if (e.key === '/') { e.preventDefault(); $('#globalSearch').focus(); return; }
    const map = {
      n: () => openAddBook(),
      q: () => {
        if (!store.books().length) return toast('먼저 책을 추가해 주세요.');
        openNoteEditor({ type: 'quote' });
      },
      t: async () => {
        const m = nextMode();
        applyTheme(m); cacheTheme(m);
        await store.saveSettings({ theme: m });
      },
      1: () => go('#/home'),
      2: () => go('#/library'),
      3: () => go('#/timeline'),
      4: () => go('#/notes'),
      5: () => go('#/stats'),
      6: () => go('#/settings'),
    };
    const fn = map[e.key.toLowerCase()];
    if (fn) { e.preventDefault(); fn(); }
  });
}

/* ---------- 시작 ---------- */
(async function main() {
  wireChrome();
  await store.load();
  applyTheme(store.settings().theme);
  cacheTheme(store.settings().theme);

  // 데이터가 바뀌면 현재 화면을 다시 그린다.
  // 설정·목표 변경은 제외한다 — 값을 바꾼 폼 자체가 다시 그려지면 포커스와 스크롤이 튄다.
  // (설정 화면은 자기 상태를 직접 반영하고, 다른 화면은 이동할 때 새로 그려진다)
  let pending = null;
  store.subscribe((kind) => {
    if (kind === 'settings' || kind === 'goal' || kind === 'sync-state') return;
    clearTimeout(pending);
    pending = setTimeout(render, 30);
  });

  start(render);
  timer.render();
  sync.start();

  // 서비스 워커 (오프라인 지원) — file:// 로 열면 등록되지 않는다
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[sw]', e));
  }
})();
