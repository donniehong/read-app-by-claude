// 홈 — 지표 줄 · 목표 · 이어읽기 · 오늘의 문장 · 실천 · 독서 잔디
//
// 화면 역할을 갈라 같은 값이 두 번 나오지 않게 한다.
//   지표 줄 = 지금 상태 / 히어로 = 목표와 페이스 / 잔디 = 습관

import { el, esc, ymd, fmtDate, nfmt, sum, seededRandom, startOfWeek, addDays, dueWord, on } from '../util.js';
import * as store from '../store.js';
import { coverHTML, toast } from '../ui.js';
import { heatmap } from '../charts.js';
import * as timer from '../timer.js';
import { openAddBook, openProgressDialog, openNoteEditor } from '../dialogs.js';
import { openPhotoNote } from '../photonote.js';
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
    (a.recallCount || 0) - (b.recallCount || 0)
    || String(a.lastRecalledAt).localeCompare(String(b.lastRecalledAt)));
  const window = pool.slice(0, Math.max(1, Math.ceil(pool.length * 0.6)));
  const idx = Math.floor(seededRandom(`${ymd()}:${offset}`) * window.length);
  return window[idx % window.length];
}

/** 최근 12주 주별 합계 → 스파크라인용 0~100 배열 */
function weeklyTrend(valueOf) {
  const thisWeek = startOfWeek();
  const buckets = [];
  for (let w = 11; w >= 0; w--) {
    const from = addDays(thisWeek, -7 * w);
    const to = addDays(from, 7);
    buckets.push(valueOf(from, to));
  }
  const max = Math.max(1, ...buckets);
  return buckets.map((v) => Math.round((v / max) * 100));
}

/**
 * 12주 추세 막대. 기록이 있는 주가 3주 미만이면 그리지 않는다 —
 * 거의 빈 줄만 남아 고장난 것처럼 보이기 때문.
 */
function sparkHTML(values) {
  if (values.filter((v) => v > 0).length < 3) return '';
  return `<div class="spark">${values.map((v, i) =>
    `<i class="${i === values.length - 1 && v > 0 ? 'hi' : ''}" style="height:${v}%"></i>`).join('')}</div>`;
}

function kpiHTML({ k, v, unit, delta, deltaClass = 'flat', spark }) {
  return `
    <div class="kpi">
      <div class="kpi__k">${esc(k)}</div>
      <div class="kpi__v">${v}${unit ? `<s>${esc(unit)}</s>` : ''}</div>
      <div class="kpi__d ${deltaClass}">${esc(delta)}</div>
      ${spark || ''}
    </div>`;
}

export default function homeView() {
  const books = store.books();
  const sessions = store.sessions();
  const notes = store.notes();
  const year = new Date().getFullYear();
  const goal = store.goal(year);

  const doneThisYear = books.filter((b) => b.status === 'done' && b.finishedAt?.startsWith(String(year)));
  const reading = books.filter((b) => b.status === 'reading')
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  /* ---------- 지표 ---------- */
  const wkStart = startOfWeek();
  const lastWkStart = addDays(wkStart, -7);
  const minutesIn = (from, to) => sum(
    sessions.filter((s) => { const d = new Date(s.date); return d >= from && d < to; }),
    (s) => s.minutes,
  );
  const weekMinutes = minutesIn(wkStart, addDays(wkStart, 7));
  const lastWeekMinutes = minutesIn(lastWkStart, wkStart);
  const weekDelta = weekMinutes - lastWeekMinutes;

  const st = store.streak();

  const speed = store.readingSpeed();          // 분당 페이지 (전체 평균)
  const speedPerHour = speed ? Math.round(speed * 60) : null;

  const thisMonth = ymd().slice(0, 7);
  const lastMonthDate = new Date(); lastMonthDate.setDate(1); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = ymd(lastMonthDate).slice(0, 7);
  const doneThisMonth = books.filter((b) => b.finishedAt?.startsWith(thisMonth)).length;
  const doneLastMonth = books.filter((b) => b.finishedAt?.startsWith(lastMonth)).length;

  const totalPages = sum(sessions, (s) =>
    (s.startPage != null && s.endPage != null && s.endPage > s.startPage) ? s.endPage - s.startPage : 0)
    || sum(doneThisYear, (b) => b.pageCount || 0);

  const quotes = notes.filter((n) => n.type === 'quote');
  const quotesThisMonth = quotes.filter((n) => String(n.createdAt).slice(0, 7) === thisMonth).length;

  const kpis = [
    kpiHTML({
      k: '이번 주 독서',
      v: weekMinutes >= 60 ? (weekMinutes / 60).toFixed(1) : weekMinutes,
      unit: weekMinutes >= 60 ? '시간' : '분',
      delta: lastWeekMinutes
        ? `${weekDelta >= 0 ? '▲' : '▼'} 지난주 ${weekDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(weekDelta / 6) / 10)}h`
        : '지난주 기록 없음',
      deltaClass: !lastWeekMinutes ? 'flat' : weekDelta >= 0 ? 'up' : 'down',
      spark: sparkHTML(weeklyTrend(minutesIn)),
    }),
    kpiHTML({
      k: '연속 기록', v: st.current, unit: '일',
      delta: st.best ? `최장 ${st.best}일` : '오늘부터 시작',
      spark: sparkHTML(weeklyTrend((from, to) => {
        const days = new Set(sessions
          .filter((s) => { const d = new Date(s.date); return d >= from && d < to; })
          .map((s) => s.date));
        return days.size;
      })),
    }),
    kpiHTML({
      k: '읽기 속도', v: speedPerHour ?? '—', unit: speedPerHour ? '쪽/h' : '',
      delta: speedPerHour ? '세션 기록 기준' : '세션이 쌓이면 표시돼요',
      spark: '',
    }),
    kpiHTML({
      k: '이번 달 완독', v: doneThisMonth, unit: '권',
      delta: doneLastMonth
        ? `${doneThisMonth >= doneLastMonth ? '▲' : '▼'} 지난달 ${doneThisMonth >= doneLastMonth ? '+' : '−'}${Math.abs(doneThisMonth - doneLastMonth)}`
        : '지난달 완독 없음',
      deltaClass: !doneLastMonth ? 'flat' : doneThisMonth >= doneLastMonth ? 'up' : 'down',
      spark: '',
    }),
    kpiHTML({
      k: '읽은 분량', v: nfmt(totalPages), unit: '쪽',
      delta: '기록된 전체',
      spark: sparkHTML(weeklyTrend((from, to) => sum(
        sessions.filter((s) => { const d = new Date(s.date); return d >= from && d < to; }),
        (s) => (s.startPage != null && s.endPage != null && s.endPage > s.startPage) ? s.endPage - s.startPage : 0,
      ))),
    }),
    kpiHTML({
      k: '모은 문장', v: nfmt(quotes.length), unit: '개',
      delta: quotesThisMonth ? `▲ 이번 달 +${quotesThisMonth}` : '이번 달 아직',
      deltaClass: quotesThisMonth ? 'up' : 'flat',
      spark: sparkHTML(weeklyTrend((from, to) => notes.filter((n) => {
        const d = new Date(n.createdAt);
        return d >= from && d < to;
      }).length)),
    }),
  ].join('');

  /* ---------- 목표(히어로) ---------- */
  let hero;
  if (goal.books > 0) {
    const dayOfYear = Math.floor((new Date() - new Date(year, 0, 1)) / 86400000) + 1;
    const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
    const expected = (goal.books * dayOfYear) / daysInYear;
    const diff = doneThisYear.length - expected;
    const pct = Math.min(100, Math.round((doneThisYear.length / goal.books) * 100));
    const remain = Math.max(0, goal.books - doneThisYear.length);
    const daysLeft = daysInYear - dayOfYear;
    const perBook = remain > 0 && daysLeft > 0 ? Math.floor(daysLeft / remain) : null;
    const paceTxt = Math.abs(diff) < 0.5
      ? '계획한 속도 그대로예요'
      : diff > 0
        ? `예정보다 ${diff.toFixed(1)}권 앞서고 있어요`
        : `예정보다 ${Math.abs(diff).toFixed(1)}권 뒤처져 있어요`;

    hero = `
      <div class="hero">
        <div class="hero__lb">🎯 ${year}년 목표</div>
        <div class="hero__big mono">${doneThisYear.length} / ${goal.books}권</div>
        <div class="hero__sub">${paceTxt}</div>
        <div class="hero__track"><i style="width:${pct}%"></i></div>
        <div class="hero__foot">
          <span>${pct}% 달성</span>
          <span style="margin-left:auto">${remain ? `남은 ${remain}권${perBook ? ` · ${perBook}일에 한 권` : ''}` : '목표 달성!'}</span>
        </div>
      </div>`;
  } else {
    hero = `
      <div class="hero">
        <div class="hero__lb">🎯 ${year}년</div>
        <div class="hero__big mono">${doneThisYear.length}권 완독</div>
        <div class="hero__sub">목표를 정하면 지금 속도가 빠른지 느린지 알려드려요</div>
        <button class="hero__btn" data-goal type="button">연간 목표 정하기</button>
      </div>`;
  }

  /* ---------- 이어읽기 ---------- */
  const [first, ...rest] = reading;
  let readingBlock;
  if (first) {
    const pct = store.progressOf(first);
    const f = store.forecast(first);
    readingBlock = `
      <div class="cont" data-book="${esc(first.id)}">
        ${coverHTML(first)}
        <div class="cont__bd">
          <div class="cont__t">${esc(first.title)}</div>
          <div class="cont__a">${esc((first.authors || []).join(', '))}</div>
          <div class="progress"><i style="width:${pct}%"></i></div>
          <div class="cont__meta">
            <span class="mono">${first.pageCount ? `${nfmt(first.currentPage || 0)} / ${nfmt(first.pageCount)}쪽` : `${nfmt(first.currentPage || 0)}쪽까지`}</span>
            ${first.pageCount ? `<span class="mono">· ${pct}%</span>` : ''}
            ${f?.date ? `<span class="pill">${fmtDate(f.date)}쯤 완독</span>` : ''}
          </div>
          <div class="cont__cta">
            <button class="btn btn--primary btn--sm" data-timer="${esc(first.id)}" type="button">
              ${timer.isRunning(first.id) ? '⏹ 세션 종료' : '▶ 읽기 시작'}</button>
            <button class="btn btn--soft btn--sm" data-progress="${esc(first.id)}" type="button">진도 입력</button>
          </div>
        </div>
      </div>
      ${rest.length ? `<div class="mini">${rest.slice(0, 4).map((b) => {
        const p = store.progressOf(b);
        return `
        <div class="mc" data-book="${esc(b.id)}">
          ${coverHTML(b)}
          <div style="flex:1;min-width:0">
            <div class="mc__t">${esc(b.title)}</div>
            <div class="mc__pc mono">${b.pageCount ? `${nfmt(b.currentPage || 0)} / ${nfmt(b.pageCount)}쪽 · ${p}%` : `${nfmt(b.currentPage || 0)}쪽까지`}</div>
            <div class="progress" style="height:6px;margin-top:7px"><i style="width:${p}%"></i></div>
          </div>
        </div>`;
      }).join('')}</div>` : '<div style="height:22px"></div>'}`;
  } else {
    readingBlock = `
      <div class="empty" style="margin-bottom:22px">
        <strong>지금 읽고 있는 책이 없어요</strong>
        서재에서 책을 골라 읽기를 시작해 보세요.
        <div style="margin-top:14px"><button class="btn btn--primary" data-add type="button">＋ 책 추가하기</button></div>
      </div>`;
  }

  /* ---------- 오늘의 문장 ---------- */
  const q = quoteOfDay();
  const qBook = q ? store.getBook(q.bookId) : null;
  const quoteBlock = q ? `
    <div class="qcard" data-note="${esc(q.id)}">
      <div class="qcard__mark">“</div>
      <p class="qcard__p">${esc(q.text)}</p>
      <div class="qcard__src">${esc(qBook?.title || '')}${q.page != null ? ` · ${q.page}쪽` : ''}</div>
      <div class="qcard__row">
        <button class="btn btn--soft btn--sm" data-another type="button">🔀 다른 문장</button>
        <button class="btn btn--soft btn--sm" data-card type="button">🖼 카드 만들기</button>
      </div>
    </div>` : `
    <div class="qcard">
      <div class="qcard__mark">“</div>
      <p class="qcard__p muted" style="font-size:15px">마음에 남은 문장을 모아 보세요.
        다음 날부터 하나씩 다시 꺼내 드릴게요.</p>
      <div class="qcard__row">
        <button class="btn btn--primary btn--sm" data-newnote type="button">✍️ 문장 남기기</button>
      </div>
    </div>`;

  /* ---------- 실천 ---------- */
  const openActions = store.notes().filter((n) => n.type === 'action' && !n.done);
  const doneActions = store.notes().filter((n) => n.type === 'action' && n.done).length;
  const actionBlock = openActions.length ? `
    <h2 class="section__head" style="margin-bottom:12px"><span style="font-size:18px;font-weight:800">책에서 얻은 실천</span>
      <span class="more" data-goto="#/notes?type=action">${doneActions} / ${doneActions + openActions.length}</span></h2>
    <div class="todo">
      ${openActions.slice(0, 4).map((n) => {
        const b = store.getBook(n.bookId);
        return `
        <div class="td">
          <button class="ck" data-toggle="${esc(n.id)}" type="button" aria-label="완료 표시">✓</button>
          <div style="min-width:0;flex:1">
            <div class="td__t">${esc(n.text)}</div>
            <div class="td__b">${esc(b?.title || '')}</div>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  /* ---------- 반납 임박 ---------- */
  const due = store.loansDue({ withinDays: 7 });
  const dueBlock = due.length ? `
    <div class="duebar ${due.some((r) => r.overdue) ? 'is-late' : ''}">
      <span class="duebar__ic">${due.some((r) => r.overdue) ? '⚠️' : '⏰'}</span>
      <div class="duebar__body">
        <div class="duebar__t">${due.some((r) => r.overdue) ? '반납일이 지난 책이 있어요' : '곧 반납할 책이 있어요'}</div>
        <div class="duebar__list">
          ${due.slice(0, 4).map((r) => `
            <button class="duebar__item" data-book="${esc(r.book.id)}" type="button">
              ${esc(r.book.title)} <b>${esc(dueWord(r.daysLeft))}</b>
              ${r.book.acqPlace ? `<span class="faint">· ${esc(r.book.acqPlace)}</span>` : ''}
            </button>`).join('')}
        </div>
      </div>
    </div>` : '';

  /* ---------- 조립 ---------- */
  const root = el(`
    <div>
      <div class="hd">
        <h1 class="hd__hi">${greeting()}
          <small>${first ? `오늘도 ${esc(first.title)} 이어서 읽어볼까요?`
            : st.current > 0 ? `🔥 ${st.current}일 연속 기록 중이에요`
            : '오늘 한 쪽이라도 읽어 볼까요?'}</small>
        </h1>
      </div>

      ${dueBlock}

      <div class="kpis">${kpis}</div>

      <div class="grid2">
        <div>
          ${hero}

          <div class="quick">
            <button class="qa" data-quick="read" type="button"><div class="qa__ic i1">📖</div><div class="qa__lb">이어읽기</div></button>
            <button class="qa" data-quick="note" type="button"><div class="qa__ic i2">✍️</div><div class="qa__lb">문장 남기기</div></button>
            <button class="qa" data-quick="photo" type="button"><div class="qa__ic i3">📷</div><div class="qa__lb">사진에서</div></button>
            <button class="qa" data-quick="add" type="button"><div class="qa__ic i4">＋</div><div class="qa__lb">책 추가</div></button>
          </div>

          <h2 class="section__head"><span style="font-size:18px;font-weight:800">읽는 중</span>
            ${reading.length ? `<span class="more" data-goto="#/library?status=reading">전체 ${reading.length}권 →</span>` : ''}</h2>
          ${readingBlock}
        </div>

        <div>
          <h2 class="section__head"><span style="font-size:18px;font-weight:800">오늘의 문장</span>
            ${quotes.length ? `<span class="more" data-goto="#/notes?type=quote">${quotes.length}개 →</span>` : ''}</h2>
          ${quoteBlock}

          ${actionBlock}

          <h2 class="section__head" style="margin-top:22px"><span style="font-size:18px;font-weight:800">독서 잔디</span>
            <span class="more" data-goto="#/stats">통계 →</span></h2>
          <div class="grass">
            ${heatmap(store.activityByDay(), { weeks: 18 })}
          </div>
        </div>
      </div>
    </div>`);

  /* ---------- 이벤트 ---------- */
  on(root, 'click', '[data-book]', (e, t) => {
    // 카드 안의 버튼(타이머·진도 등)을 누른 것은 이동이 아니다.
    // 다만 항목 자체가 버튼인 경우(반납 알림)는 눌러서 이동하는 게 맞다.
    const btn = e.target.closest('button');
    if (btn && btn !== t && t.contains(btn)) return;
    go(`#/book/${t.dataset.book}`);
  });
  on(root, 'click', '[data-goto]', (e, t) => go(t.dataset.goto));
  on(root, 'click', '[data-add]', () => openAddBook());
  on(root, 'click', '[data-newnote]', () => openNoteEditor({ type: 'quote' }));
  on(root, 'click', '[data-goal]', () => go('#/settings'));

  on(root, 'click', '[data-quick]', (e, t) => {
    const what = t.dataset.quick;
    if (what === 'add') return openAddBook();
    if (what === 'note') {
      if (!books.length) return toast('먼저 책을 추가해 주세요.');
      return openNoteEditor({ type: 'quote' });
    }
    if (what === 'photo') return openPhotoNote();
    if (what === 'read') {
      if (!first) return toast('읽는 중인 책이 없어요.');
      if (timer.isRunning(first.id)) return timer.stop();
      if (timer.start(first.id)) toast('독서 세션을 시작했어요 ⏱');
      go('#/home', { replace: true });
    }
  });

  on(root, 'click', '[data-timer]', (e, t) => {
    const id = t.dataset.timer;
    if (timer.isRunning(id)) { timer.stop(); return; }
    if (timer.start(id)) toast('독서 세션을 시작했어요 ⏱');
    go('#/home', { replace: true });
  });
  on(root, 'click', '[data-progress]', (e, t) => openProgressDialog(store.getBook(t.dataset.progress)));

  on(root, 'click', '[data-toggle]', async (e, t) => {
    const n = store.notes().find((x) => x.id === t.dataset.toggle);
    if (n) { await store.updateNote(n.id, { done: !n.done }); toast('실천 완료! 👏'); }
  });

  let qOffset = 0;
  on(root, 'click', '[data-another]', () => {
    qOffset += 1;
    const next = quoteOfDay(qOffset);
    if (!next) return;
    const box = root.querySelector('.qcard');
    const nb = store.getBook(next.bookId);
    box.dataset.note = next.id;
    box.querySelector('.qcard__p').textContent = next.text;
    box.querySelector('.qcard__src').textContent =
      `${nb?.title || ''}${next.page != null ? ` · ${next.page}쪽` : ''}`;
  });
  on(root, 'click', '[data-card]', () => {
    const id = root.querySelector('.qcard')?.dataset.note;
    const n = store.notes().find((x) => x.id === id);
    if (n) openQuoteCard(n, store.getBook(n.bookId));
  });

  // 오늘의 문장을 봤다고 표시 (하루 한 번만 — 매 렌더마다 쓰면 변경 이벤트가 무한히 돈다)
  if (q && q.lastRecalledAt !== ymd()) {
    store.updateNote(q.id, { recallCount: (q.recallCount || 0) + 1, lastRecalledAt: ymd() });
  }

  return root;
}
