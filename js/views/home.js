// 홈 — 오늘의 문장 · 목표 페이스 · 읽는 중 · 실천 · 잔디

import { el, esc, ymd, fmtDate, nfmt, sum, seededRandom, startOfWeek, on } from '../util.js';
import * as store from '../store.js';
import { coverHTML, ratingHTML, toast } from '../ui.js';
import { heatmap } from '../charts.js';
import * as timer from '../timer.js';
import { openAddBook, openProgressDialog, openNoteEditor, openFinishDialog } from '../dialogs.js';
import { openQuoteCard } from '../quotecard.js';
import { go } from '../router.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return '고요한 밤이에요';
  if (h < 11) return '좋은 아침이에요';
  if (h < 14) return '점심 무렵이네요';
  if (h < 18) return '나른한 오후예요';
  if (h < 22) return '편안한 저녁이에요';
  return '하루를 마무리할 시간이에요';
}

/** 오늘의 문장 — 날짜 기준 결정론적 선택, 덜 본 문장에 가중치 */
function quoteOfDay(offset = 0) {
  const quotes = store.notes().filter((n) => n.type === 'quote' && n.text.trim());
  if (!quotes.length) return null;
  const pool = [...quotes].sort((a, b) =>
    (a.recallCount || 0) - (b.recallCount || 0) || String(a.lastRecalledAt).localeCompare(String(b.lastRecalledAt)));
  const window = pool.slice(0, Math.max(1, Math.ceil(pool.length * 0.6)));
  const idx = Math.floor(seededRandom(ymd() + ':' + offset) * window.length);
  return window[idx % window.length];
}

export default function homeView() {
  const books = store.books();
  const year = new Date().getFullYear();
  const g = store.goal(year);

  const doneThisYear = books.filter((b) => b.status === 'done' && b.finishedAt?.startsWith(String(year)));
  const reading = books.filter((b) => b.status === 'reading')
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const wants = books.filter((b) => b.status === 'want')
    .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1) || String(b.addedAt).localeCompare(String(a.addedAt)));

  const wkStart = startOfWeek();
  const weekMinutes = sum(store.sessions().filter((s) => new Date(s.date) >= wkStart), (s) => s.minutes);
  const st = store.streak();
  const quoteCount = store.notes().filter((n) => n.type === 'quote').length;
  const openActions = store.notes().filter((n) => n.type === 'action' && !n.done);

  /* ---- 목표 페이스 ---- */
  let goalBlock;
  if (g.books > 0) {
    const dayOfYear = Math.floor((new Date() - new Date(year, 0, 1)) / 86400000) + 1;
    const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
    const expected = (g.books * dayOfYear) / daysInYear;
    const diff = doneThisYear.length - expected;
    const pct = Math.min(100, Math.round((doneThisYear.length / g.books) * 100));
    const pacePct = Math.min(100, (expected / g.books) * 100);
    const paceTxt = Math.abs(diff) < 0.5
      ? '계획한 속도 그대로예요.'
      : diff > 0
        ? `예정보다 ${diff.toFixed(1)}권 앞서고 있어요.`
        : `예정보다 ${Math.abs(diff).toFixed(1)}권 뒤처져 있어요.`;
    const remain = Math.max(0, g.books - doneThisYear.length);
    const daysLeft = daysInYear - dayOfYear;
    const perBook = remain > 0 && daysLeft > 0 ? Math.floor(daysLeft / remain) : null;

    goalBlock = `
      <div class="card goal-card">
        <div class="goal-card__top">
          <span class="goal-card__num mono">${doneThisYear.length}</span>
          <span class="muted">/ ${g.books}권 · ${year}년 목표</span>
          <span class="mono muted" style="margin-left:auto">${pct}%</span>
        </div>
        <div class="progress">
          <i style="width:${pct}%"></i>
          <span class="progress__pace" style="left:${pacePct}%" title="오늘까지의 목표 속도"></span>
        </div>
        <p class="pace-note ${diff >= 0 ? 'ahead' : 'behind'}">${paceTxt}</p>
        ${perBook ? `<p class="tiny faint" style="margin-top:4px">남은 ${remain}권 · 한 권에 ${perBook}일씩이면 달성해요.</p>` : ''}
      </div>`;
  } else {
    goalBlock = `
      <div class="card goal-card">
        <div class="goal-card__top"><span class="goal-card__num">${doneThisYear.length}권</span>
          <span class="muted">올해 완독</span></div>
        <p class="tiny faint" style="margin-top:6px">올해 목표를 정하면 진행 속도를 알려드려요.</p>
        <button class="btn btn--sm" data-goal type="button" style="margin-top:10px">연간 목표 설정</button>
      </div>`;
  }

  /* ---- 오늘의 문장 ---- */
  const q = quoteOfDay();
  const qBook = q ? store.getBook(q.bookId) : null;
  const quoteBlock = q ? `
    <div class="quote-of-day" data-note="${esc(q.id)}">
      <div class="quote-of-day__label">오늘의 문장</div>
      <p class="quote-of-day__text">${esc(q.text)}</p>
      <div class="quote-of-day__src">
        ${esc(qBook?.title || '')}${q.page ? ` · ${q.page}쪽` : ''}
      </div>
      <div style="display:flex;gap:6px;margin-top:12px">
        <button class="btn btn--sm" data-another type="button">다른 문장</button>
        <button class="btn btn--sm" data-card type="button">카드 만들기</button>
      </div>
    </div>` : `
    <div class="quote-of-day">
      <div class="quote-of-day__label">오늘의 문장</div>
      <p class="quote-of-day__text muted" style="font-size:15px">
        마음에 남은 문장을 모아 보세요. 매일 하나씩 다시 꺼내 드릴게요.</p>
      <button class="btn btn--sm" data-newnote type="button">문장 기록하기</button>
    </div>`;

  /* ---- 읽는 중 ---- */
  const readingBlock = reading.length ? `
    <div class="reading-cards">
      ${reading.slice(0, 4).map((b) => {
        const pct = store.progressOf(b);
        const f = store.forecast(b);
        return `
        <div class="card reading-card">
          <div data-book="${esc(b.id)}" style="cursor:pointer">${coverHTML(b)}</div>
          <div class="reading-card__body">
            <div class="reading-card__title" data-book="${esc(b.id)}" style="cursor:pointer">${esc(b.title)}</div>
            <div class="tiny faint">${esc((b.authors || []).join(', '))}</div>
            <div style="margin-top:8px">
              <div class="progress" style="height:6px"><i style="width:${pct}%"></i></div>
              <div class="tiny faint mono" style="margin-top:5px">
                ${b.pageCount ? `${nfmt(b.currentPage || 0)} / ${nfmt(b.pageCount)}쪽 · ${pct}%` : '쪽수 정보 없음'}
              </div>
              ${f?.date ? `<div class="tiny" style="color:var(--accent);margin-top:2px">
                 이 속도라면 ${fmtDate(f.date)}쯤 완독</div>` : ''}
            </div>
            <div class="reading-card__foot">
              <button class="btn btn--sm btn--primary" data-timer="${esc(b.id)}" type="button">
                ${timer.isRunning(b.id) ? '진행 중' : '타이머 시작'}</button>
              <button class="btn btn--sm" data-progress="${esc(b.id)}" type="button">진도</button>
              <button class="btn btn--sm btn--ghost" data-quote="${esc(b.id)}" type="button">✍️</button>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : `
    <div class="empty">
      <strong>지금 읽고 있는 책이 없어요</strong>
      서재에서 책을 골라 읽기를 시작해 보세요.
      <div style="margin-top:14px"><button class="btn btn--primary" data-add type="button">책 추가하기</button></div>
    </div>`;

  /* ---- 실천 목록 ---- */
  const actionBlock = openActions.length ? `
    <div class="card" style="padding:6px 14px">
      ${openActions.slice(0, 5).map((n) => {
        const b = store.getBook(n.bookId);
        return `
        <div class="note" data-note="${esc(n.id)}" style="border:0;border-left:0;padding:11px 0;margin:0;border-bottom:1px solid var(--line-soft);border-radius:0">
          <div class="note__head">
            <button class="note-check" data-toggle="${esc(n.id)}" type="button" aria-label="완료 표시">✓</button>
            <div style="min-width:0;flex:1">
              <div style="font-size:14px;line-height:1.5">${esc(n.text)}</div>
              <div class="tiny faint" style="margin-top:2px">${esc(b?.title || '')}</div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  /* ---- 읽고 싶은 책 ---- */
  const wantBlock = wants.length ? `
    <div class="shelf">
      ${wants.slice(0, 8).map((b) => `
        <article class="shelf-item" data-book="${esc(b.id)}">
          ${coverHTML(b)}
          <div><div class="shelf-item__title">${esc(b.title)}</div>
          <div class="shelf-item__meta">${esc((b.authors || [])[0] || '')}</div></div>
        </article>`).join('')}
    </div>` : '';

  /* ---- 최근 완독 ---- */
  const recentDone = books.filter((b) => b.status === 'done' && b.finishedAt)
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 6);

  const root = el(`
    <div>
      <header style="margin-bottom:18px">
        <h1 style="font-size:23px;letter-spacing:-.03em">${greeting()}</h1>
        <p class="muted tiny" style="margin-top:3px">
          ${st.current > 0 ? `🔥 ${st.current}일 연속 기록 중` : '오늘 한 쪽이라도 읽어 볼까요?'}
        </p>
      </header>

      <div class="hero">
        ${quoteBlock}
        ${goalBlock}
      </div>

      <div class="stat-grid" style="margin-bottom:26px">
        <div class="stat"><div class="stat__v mono">${doneThisYear.length}<small>권</small></div><div class="stat__k">올해 완독</div></div>
        <div class="stat"><div class="stat__v mono">${
          weekMinutes >= 60
            ? `${(weekMinutes / 60).toFixed(1)}<small>시간</small>`
            : `${weekMinutes}<small>분</small>`
        }</div><div class="stat__k">이번 주 독서</div></div>
        <div class="stat"><div class="stat__v mono">${st.current}<small>일</small></div><div class="stat__k">연속 기록 (최장 ${st.best}일)</div></div>
        <div class="stat"><div class="stat__v mono">${nfmt(quoteCount)}<small>개</small></div><div class="stat__k">모은 문장</div></div>
      </div>

      <section class="section">
        <div class="section__head"><h2>읽는 중</h2>
          ${reading.length > 4 ? '<span class="more" data-goto="#/library?status=reading">전체 보기</span>' : ''}</div>
        ${readingBlock}
      </section>

      ${openActions.length ? `
      <section class="section">
        <div class="section__head"><h2>책에서 얻은 실천</h2>
          <span class="more" data-goto="#/notes?type=action">전체 보기</span></div>
        ${actionBlock}
      </section>` : ''}

      ${wants.length ? `
      <section class="section">
        <div class="section__head"><h2>다음에 읽을 책</h2>
          <span class="more" data-goto="#/library?status=want">전체 보기</span></div>
        ${wantBlock}
      </section>` : ''}

      <section class="section">
        <div class="section__head"><h2>독서 잔디</h2>
          <span class="more" data-goto="#/stats">통계 자세히</span></div>
        <div class="card" style="padding:16px">
          ${heatmap(store.activityByDay())}
        </div>
      </section>

      ${recentDone.length ? `
      <section class="section">
        <div class="section__head"><h2>최근 완독</h2></div>
        <div class="shelf">
          ${recentDone.map((b) => `
            <article class="shelf-item" data-book="${esc(b.id)}">
              ${coverHTML(b)}
              <div>
                <div class="shelf-item__title">${esc(b.title)}</div>
                <div class="shelf-item__meta">${b.rating ? ratingHTML(b.rating, { small: true }) : esc(fmtDate(b.finishedAt))}</div>
              </div>
            </article>`).join('')}
        </div>
      </section>` : ''}
    </div>`);

  /* ---- 이벤트 ---- */
  on(root, 'click', '[data-book]', (e, t) => {
    if (e.target.closest('button')) return;
    go(`#/book/${t.dataset.book}`);
  });
  on(root, 'click', '[data-goto]', (e, t) => go(t.dataset.goto));
  on(root, 'click', '[data-add]', () => openAddBook());
  on(root, 'click', '[data-newnote]', () => openNoteEditor({ type: 'quote' }));
  on(root, 'click', '[data-goal]', () => go('#/settings'));

  on(root, 'click', '[data-timer]', (e, t) => {
    const id = t.dataset.timer;
    if (timer.isRunning(id)) { timer.stop(); return; }
    if (timer.start(id)) toast('독서 세션을 시작했어요 ⏱');
  });
  on(root, 'click', '[data-progress]', (e, t) => openProgressDialog(store.getBook(t.dataset.progress)));
  on(root, 'click', '[data-quote]', (e, t) => openNoteEditor({ bookId: t.dataset.quote }));

  on(root, 'click', '[data-toggle]', async (e, t) => {
    const n = store.notes().find((x) => x.id === t.dataset.toggle);
    if (n) { await store.updateNote(n.id, { done: !n.done }); toast(n.done ? '실천 완료! 👏' : '다시 열었어요.'); }
  });

  // 오늘의 문장 조작
  let qOffset = 0;
  on(root, 'click', '[data-another]', () => {
    qOffset += 1;
    const next = quoteOfDay(qOffset);
    if (!next) return;
    const box = root.querySelector('.quote-of-day');
    const nb = store.getBook(next.bookId);
    box.dataset.note = next.id;
    box.querySelector('.quote-of-day__text').textContent = next.text;
    box.querySelector('.quote-of-day__src').textContent =
      `${nb?.title || ''}${next.page ? ` · ${next.page}쪽` : ''}`;
  });
  on(root, 'click', '[data-card]', () => {
    const id = root.querySelector('.quote-of-day')?.dataset.note;
    const n = store.notes().find((x) => x.id === id);
    if (n) openQuoteCard(n, store.getBook(n.bookId));
  });

  // 오늘의 문장을 봤다고 표시 (간격 반복용).
  // 하루 한 번만 기록한다 — 매 렌더마다 쓰면 변경 이벤트가 무한히 돈다.
  if (q && q.lastRecalledAt !== ymd()) {
    store.updateNote(q.id, { recallCount: (q.recallCount || 0) + 1, lastRecalledAt: ymd() });
  }

  void openFinishDialog;
  return root;
}
