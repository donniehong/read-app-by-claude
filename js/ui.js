// 공용 UI 조각 — 모달 / 토스트 / 확인창 / 표지 / 별점

import { $, el, esc, on } from './util.js';
import { STATUS, progressOf, coverSourceOf, imageSrc } from './store.js';

/* ---------- 토스트 ---------- */
export function toast(msg, ms = 2200) {
  const root = $('#toastRoot');
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  root.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .2s, transform .2s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(6px)';
    setTimeout(() => t.remove(), 220);
  }, ms);
}

/* ---------- 모달 ---------- */
let modalStack = [];

/**
 * @param {{title:string, body:string|Node, foot?:string|Node, wide?:boolean, onMount?:(root:HTMLElement, close:Function)=>void}} opts
 * @returns {{root:HTMLElement, close:Function}}
 */
export function modal({ title, body, foot = '', wide = false, onMount }) {
  const root = $('#modalRoot');
  root.hidden = false;

  const box = el(`
    <div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h3>${esc(title)}</h3>
        <button class="btn btn--icon btn--ghost" data-close type="button" aria-label="닫기">✕</button>
      </div>
      <div class="modal__body"></div>
      ${foot ? '<div class="modal__foot"></div>' : ''}
    </div>`);

  const bodyEl = box.querySelector('.modal__body');
  if (body instanceof Node) bodyEl.appendChild(body); else bodyEl.innerHTML = body;
  if (foot) {
    const footEl = box.querySelector('.modal__foot');
    if (foot instanceof Node) footEl.appendChild(foot); else footEl.innerHTML = foot;
  }

  // 이전 모달은 숨기고 스택에 쌓는다
  const prev = modalStack[modalStack.length - 1];
  if (prev) prev.box.style.display = 'none';

  root.appendChild(box);
  const entry = { box, close };
  modalStack.push(entry);

  function close() {
    const i = modalStack.indexOf(entry);
    if (i < 0) return;
    modalStack.splice(i, 1);
    box.remove();
    const top = modalStack[modalStack.length - 1];
    if (top) top.box.style.display = '';
    else root.hidden = true;
  }

  box.querySelector('[data-close]').addEventListener('click', close);
  onMount?.(box, close);
  hydrateImages(box);

  // 첫 입력 요소에 포커스 (모바일 키보드 자동 팝업은 피한다)
  if (window.matchMedia('(min-width: 900px)').matches) {
    setTimeout(() => box.querySelector('input, textarea, select, button')?.focus(), 30);
  }
  return { root: box, close };
}

// 배경 클릭 / ESC 로 닫기
document.addEventListener('click', (e) => {
  if (e.target.id === 'modalRoot' && modalStack.length) {
    modalStack[modalStack.length - 1].close();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) {
    e.stopPropagation();
    modalStack[modalStack.length - 1].close();
  }
});

export const modalOpen = () => modalStack.length > 0;

/** 확인창 → Promise<boolean> */
export function confirmDialog({ title = '확인', message, okText = '확인', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const { root, close } = modal({
      title,
      body: `<p class="muted" style="line-height:1.7">${esc(message)}</p>`,
      foot: `
        <button class="btn" data-no type="button">취소</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-yes type="button">${esc(okText)}</button>`,
      onMount(box, cl) {
        box.querySelector('[data-no]').onclick = () => { done = true; cl(); resolve(false); };
        box.querySelector('[data-yes]').onclick = () => { done = true; cl(); resolve(true); };
      },
    });
    // 배경/ESC 로 닫힌 경우도 false 로 처리
    const obs = new MutationObserver(() => {
      if (!root.isConnected) { obs.disconnect(); if (!done) resolve(false); }
    });
    obs.observe(document.getElementById('modalRoot'), { childList: true });
  });
}

/* ---------- 표지 ---------- */
/**
 * 표지 조각. 내가 찍은 사진은 저장소에서 비동기로 읽어야 하므로
 * 자리만 잡아두고 렌더 뒤 hydrateImages() 가 실제 이미지를 채운다.
 *
 * @param {object} book  책 (또는 검색 결과처럼 cover 만 있는 객체)
 */
export function coverHTML(book, { width, force } = {}) {
  const style = width ? ` style="width:${width}px"` : '';
  const fallback = `<div class="cover__fallback" hidden>${esc(book?.title || '무제')}</div>`;
  const src = force || coverSourceOf(book) || (book?.cover ? { kind: 'url', url: book.cover } : null);

  if (src?.kind === 'image') {
    return `<div class="cover"${style}>
      <img alt="" data-img="${esc(src.id)}" />
      ${fallback}
    </div>`;
  }
  if (src?.kind === 'url') {
    return `<div class="cover"${style}>
      <img src="${esc(src.url)}" alt="" loading="lazy"
           onerror="this.style.display='none';this.nextElementSibling.hidden=false" />
      ${fallback}
    </div>`;
  }
  return `<div class="cover"${style}>
    <div class="cover__fallback">${esc(book?.title || '무제')}</div>
  </div>`;
}

/** coverHTML 이 남긴 자리(data-img)를 실제 사진으로 채운다 */
export async function hydrateImages(root = document) {
  const nodes = [...root.querySelectorAll('img[data-img]')];
  await Promise.all(nodes.map(async (img) => {
    const id = img.dataset.img;
    delete img.dataset.img;
    try {
      const src = await imageSrc(id);
      if (src) { img.src = src; return; }
    } catch (e) { console.warn('[ui] 사진을 읽지 못했어요', e); }
    img.style.display = 'none';
    img.parentElement?.querySelector('.cover__fallback')?.removeAttribute('hidden');
  }));
}

/* ---------- 별점 ---------- */
/** 표시 전용 별점 (0~5, 0.5 단위는 반올림 표시) */
export function ratingHTML(value = 0, { small = false } = {}) {
  const v = Number(value) || 0;
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<span class="${i <= Math.round(v) ? 'on' : ''}">★</span>`;
  return `<span class="rating rating--static ${small ? 'rating--sm' : ''}" title="${v}점">${s}</span>`;
}

/** 편집 가능한 별점 위젯 */
export function ratingInput(value = 0, onChange) {
  const wrap = el(`<span class="rating" role="slider" aria-label="별점"
     aria-valuemin="0" aria-valuemax="5" aria-valuenow="${value}" tabindex="0"></span>`);
  let cur = Number(value) || 0;

  const paint = (v) => {
    wrap.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      wrap.appendChild(el(`<span class="${i <= v ? 'on' : ''}" data-v="${i}">★</span>`));
    }
    wrap.setAttribute('aria-valuenow', cur);
  };
  paint(cur);

  on(wrap, 'click', '[data-v]', (e, t) => {
    const v = Number(t.dataset.v);
    cur = (cur === v) ? 0 : v;   // 같은 별 다시 누르면 해제
    paint(cur);
    onChange?.(cur);
  });
  wrap.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-v]');
    if (t) paint(Number(t.dataset.v));
  });
  wrap.addEventListener('mouseleave', () => paint(cur));
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { cur = Math.min(5, cur + 1); paint(cur); onChange?.(cur); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { cur = Math.max(0, cur - 1); paint(cur); onChange?.(cur); }
  });
  return wrap;
}

/* ---------- 책 카드 ---------- */
export function shelfItemHTML(book) {
  const pct = progressOf(book);
  const showBar = book.status === 'reading' && pct > 0;
  const author = (book.authors || [])[0] || '';
  return `
    <article class="shelf-item" data-book="${esc(book.id)}">
      ${coverHTML(book)}
      ${showBar ? `<div class="shelf-item__bar"><i style="width:${pct}%"></i></div>` : ''}
      <div>
        <div class="shelf-item__title">${esc(book.title)}</div>
        <div class="shelf-item__meta">${esc(author)}</div>
      </div>
    </article>`;
}

export function bookRowHTML(book, extra = '') {
  const pct = progressOf(book);
  return `
    <article class="bookrow" data-book="${esc(book.id)}">
      ${coverHTML(book)}
      <div class="bookrow__main">
        <div class="bookrow__title">${esc(book.title)}</div>
        <div class="tiny faint">${esc((book.authors || []).join(', '))}</div>
        <div class="tiny muted" style="margin-top:4px">
          <span class="badge badge--${esc(book.status)}">${esc(STATUS[book.status] || '')}</span>
          ${book.status === 'reading' && pct ? `<span class="mono"> · ${pct}%</span>` : ''}
          ${book.rating ? ` ${ratingHTML(book.rating, { small: true })}` : ''}
          ${extra}
        </div>
      </div>
    </article>`;
}

/* ---------- 폼 헬퍼 ---------- */
export const fieldHTML = (label, inner) =>
  `<div class="field"><label>${esc(label)}</label>${inner}</div>`;

export function parseList(str) {
  return String(str || '').split(',').map((s) => s.trim()).filter(Boolean);
}
