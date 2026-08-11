// 통계 — 연도별 독서 요약

import { el, esc, on, nfmt, sum, groupBy, daysBetween } from '../util.js';
import * as store from '../store.js';
import { barChart, donutChart, rankList, heatmap } from '../charts.js';
import { go } from '../router.js';

const uiState = { year: new Date().getFullYear() };

export default function statsView() {
  const books = store.books();
  const sessions = store.sessions();
  const notes = store.notes();

  const years = [...new Set([
    ...books.filter((b) => b.finishedAt).map((b) => Number(b.finishedAt.slice(0, 4))),
    ...sessions.map((s) => Number(s.date.slice(0, 4))),
    ...books.map((b) => Number(store.acquisitionOf(b).date.slice(0, 4))),
    new Date().getFullYear(),
  ])].filter(Boolean).sort((a, b) => b - a);

  if (!years.includes(uiState.year)) uiState.year = years[0];
  const Y = uiState.year;
  const yStr = String(Y);

  const doneY = books.filter((b) => b.status === 'done' && b.finishedAt?.startsWith(yStr));
  const sessY = sessions.filter((s) => s.date.startsWith(yStr));
  const notesY = notes.filter((n) => String(n.createdAt).startsWith(yStr));

  const minutesY = sum(sessY, (s) => s.minutes);
  const pagesFromBooks = sum(doneY, (b) => b.pageCount || 0);
  const pagesFromSessions = sum(sessY, (s) =>
    (s.startPage != null && s.endPage != null && s.endPage > s.startPage) ? s.endPage - s.startPage : 0);
  const rated = doneY.filter((b) => b.rating > 0);
  const avgRating = rated.length ? (sum(rated, (b) => b.rating) / rated.length) : 0;
  const st = store.streak();
  const activeDays = new Set(sessY.map((s) => s.date)).size;

  /* ---- 월별 ---- */
  const monthLabels = ['1','2','3','4','5','6','7','8','9','10','11','12'];
  const doneByMonth = monthLabels.map((_, i) => ({
    label: monthLabels[i],
    value: doneY.filter((b) => Number(b.finishedAt.slice(5, 7)) === i + 1).length,
  }));
  const minByMonth = monthLabels.map((_, i) => ({
    label: monthLabels[i],
    value: Math.round(sum(sessY.filter((s) => Number(s.date.slice(5, 7)) === i + 1), (s) => s.minutes) / 60),
  }));

  /* ---- 분류/저자/평점 ---- */
  const catRows = [...groupBy(
    doneY.flatMap((b) => (b.categories?.length ? b.categories : ['분류 없음'])),
    (c) => c,
  ).entries()].map(([label, arr]) => ({ label, value: arr.length }))
    .sort((a, b) => b.value - a.value).slice(0, 8);

  const authorRows = [...groupBy(
    doneY.flatMap((b) => (b.authors?.length ? b.authors : ['저자 미상'])),
    (a) => a,
  ).entries()].map(([label, arr]) => ({ label, value: arr.length }))
    .sort((a, b) => b.value - a.value);

  const ratingRows = [5, 4, 3, 2, 1].map((r) => ({
    label: `${r}★`,
    value: doneY.filter((b) => Math.round(b.rating) === r).length,
  }));

  /* ---- 완독 소요 기간 ---- */
  const spans = doneY
    .filter((b) => b.startedAt && b.finishedAt)
    .map((b) => ({ book: b, days: Math.max(1, daysBetween(b.startedAt, b.finishedAt) + 1) }));
  const avgSpan = spans.length ? Math.round(sum(spans, (s) => s.days) / spans.length) : null;

  const acq = store.acquisitionSummary({ year: Y });
  const goal = store.goal(Y);
  const goalPct = goal.books ? Math.min(100, Math.round((doneY.length / goal.books) * 100)) : 0;

  const root = el(`
    <div>
      <div class="section__head" style="margin-bottom:16px">
        <h1 style="font-size:22px">통계</h1>
        <div class="scroller" style="margin-left:auto">
          ${years.map((y) => `<button class="chip ${y === Y ? 'is-active' : ''}" data-year="${y}" type="button">${y}년</button>`).join('')}
        </div>
      </div>

      ${goal.books ? `
      <div class="card" style="padding:16px;margin-bottom:18px">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:9px">
          <b>${Y}년 목표</b>
          <span class="mono muted">${doneY.length} / ${goal.books}권</span>
          <span class="mono muted" style="margin-left:auto">${goalPct}%</span>
        </div>
        <div class="progress"><i style="width:${goalPct}%"></i></div>
      </div>` : ''}

      <div class="stat-grid" style="margin-bottom:12px">
        <div class="stat"><div class="stat__v mono">${doneY.length}<small>권</small></div><div class="stat__k">완독</div></div>
        <div class="stat"><div class="stat__v mono">${nfmt(pagesFromBooks || pagesFromSessions)}<small>쪽</small></div><div class="stat__k">읽은 분량</div></div>
        <div class="stat"><div class="stat__v mono">${minutesY >= 60 ? (minutesY / 60).toFixed(1) : minutesY}<small>${minutesY >= 60 ? '시간' : '분'}</small></div><div class="stat__k">독서 시간</div></div>
        <div class="stat"><div class="stat__v mono">${avgRating ? avgRating.toFixed(1) : '—'}<small>★</small></div><div class="stat__k">평균 별점</div></div>
      </div>
      <div class="stat-grid" style="margin-bottom:26px">
        <div class="stat"><div class="stat__v mono">${activeDays}<small>일</small></div><div class="stat__k">읽은 날</div></div>
        <div class="stat"><div class="stat__v mono">${st.best}<small>일</small></div><div class="stat__k">최장 연속</div></div>
        <div class="stat"><div class="stat__v mono">${notesY.length}<small>개</small></div><div class="stat__k">남긴 기록</div></div>
        <div class="stat"><div class="stat__v mono">${avgSpan ?? '—'}<small>일</small></div><div class="stat__k">한 권 평균 기간</div></div>
      </div>

      <section class="section">
        <div class="section__head"><h2>월별 완독</h2><span class="muted tiny">${Y}년</span></div>
        <div class="card" style="padding:16px 14px">${barChart(doneByMonth, { height: 150 })}</div>
      </section>

      <section class="section">
        <div class="section__head"><h2>월별 독서 시간</h2><span class="muted tiny">시간 단위</span></div>
        <div class="card" style="padding:16px 14px">${barChart(minByMonth, { height: 150 })}</div>
      </section>

      <section class="section">
        <div class="section__head"><h2>독서 잔디</h2>
          <span class="muted tiny">최근 6개월</span></div>
        <div class="card" style="padding:16px">${heatmap(store.activityByDay())}</div>
      </section>

      <div style="display:grid;gap:16px;grid-template-columns:1fr" id="statsGrid">
        <section class="section" style="margin:0">
          <div class="section__head"><h2>분류별 비중</h2></div>
          <div class="card" style="padding:16px">${donutChart(catRows)}</div>
        </section>

        <section class="section" style="margin:0">
          <div class="section__head"><h2>많이 읽은 저자</h2></div>
          <div class="card" style="padding:8px 16px">${rankList(authorRows, { valueFmt: (v) => `${v}권` })}</div>
        </section>

        <section class="section" style="margin:0">
          <div class="section__head"><h2>별점 분포</h2></div>
          <div class="card" style="padding:8px 16px">${rankList(ratingRows, { valueFmt: (v) => `${v}권`, max: 5 })}</div>
        </section>

        <section class="section" style="margin:0">
          <div class="section__head"><h2>가장 빨리 읽은 책</h2></div>
          <div class="card" style="padding:8px 16px">
            ${spans.length
              ? spans.sort((a, b) => a.days - b.days).slice(0, 5).map((s, i) => `
                <div class="rank-row" data-book="${esc(s.book.id)}" style="cursor:pointer">
                  <span class="n">${i + 1}</span>
                  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.book.title)}</span>
                  <span class="v">${s.days}일</span>
                </div>`).join('')
              : '<p class="empty">데이터가 없어요.</p>'}
          </div>
        </section>
      </div>

      <section class="section" style="margin-top:26px">
        <div class="section__head"><h2>어디서 온 책인가</h2>
          <span class="muted tiny">${Y}년 기준 · 서재에 담은 날</span></div>
        <div class="card" style="padding:16px">
          ${acq.period.purchase + acq.period.borrow === 0 ? `
            <p class="muted tiny">아직 구매·대출을 적어 두지 않았어요.
              책 정보 수정에서 <b>어디서 온 책</b>을 골라 두면 여기에 쌓입니다.</p>
          ` : `
            <div class="acq-split">
              <div class="acq-cell">
                <div class="acq-cell__v mono">${acq.period.purchase}<small>권</small></div>
                <div class="acq-cell__k">🛒 구매</div>
              </div>
              <div class="acq-cell">
                <div class="acq-cell__v mono">${acq.period.borrow}<small>권</small></div>
                <div class="acq-cell__k">🏛 대출</div>
              </div>
              <div class="acq-cell">
                <div class="acq-cell__v mono">${acq.period.purchase + acq.period.borrow
                  ? Math.round((acq.period.borrow / (acq.period.purchase + acq.period.borrow)) * 100) : 0}<small>%</small></div>
                <div class="acq-cell__k">대출 비중</div>
              </div>
            </div>
            <div class="acq-bar" title="구매 ${acq.period.purchase}권 · 대출 ${acq.period.borrow}권">
              <i class="buy" style="width:${(acq.period.purchase / Math.max(1, acq.period.purchase + acq.period.borrow)) * 100}%"></i>
              <i class="lend" style="width:${(acq.period.borrow / Math.max(1, acq.period.purchase + acq.period.borrow)) * 100}%"></i>
            </div>
            <p class="tiny faint" style="margin-top:10px">
              누적(전체 기간) 구매 <b>${nfmt(acq.lifetime.purchase)}</b>권 ·
              대출 <b>${nfmt(acq.lifetime.borrow)}</b>권${
                acq.period.none ? ` · ${Y}년 미지정 ${acq.period.none}권` : ''}
            </p>
          `}
        </div>

        ${acq.places.length ? `
          <div class="card" style="padding:8px 16px;margin-top:12px">
            <div class="tiny faint" style="padding:10px 0 4px;font-weight:800">자주 간 곳 · ${Y}년</div>
            ${acq.places.slice(0, 8).map((r, i) => `
              <div class="rank-row">
                <span class="n">${i + 1}</span>
                <span class="badge badge--${r.type === 'purchase' ? 'buy' : 'lend'}"
                      style="flex:0 0 auto">${r.type === 'purchase' ? '구매' : '대출'}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.place)}</span>
                <span class="v">${r.value}권</span>
              </div>`).join('')}
          </div>` : ''}
      </section>

      ${doneY.length ? `
      <section class="section" style="margin-top:26px">
        <div class="section__head"><h2>${Y}년에 읽은 책</h2><span class="muted tiny">${doneY.length}권</span></div>
        <div class="shelf">
          ${doneY.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).map((b) => `
            <article class="shelf-item" data-book="${esc(b.id)}">
              ${b.cover
                ? `<div class="cover"><img src="${esc(b.cover)}" alt="" loading="lazy"
                     onerror="this.style.display='none';this.nextElementSibling.hidden=false"><div class="cover__fallback" hidden>${esc(b.title)}</div></div>`
                : `<div class="cover"><div class="cover__fallback">${esc(b.title)}</div></div>`}
              <div><div class="shelf-item__title">${esc(b.title)}</div>
                <div class="shelf-item__meta">${esc(b.finishedAt.slice(5).replace('-', '/'))}</div></div>
            </article>`).join('')}
        </div>
      </section>` : `
      <div class="empty" style="margin-top:20px"><strong>${Y}년 완독 기록이 없어요</strong>
        올해의 첫 책을 완독해 보세요.</div>`}
    </div>`);

  // 넓은 화면에서 2열
  if (window.matchMedia('(min-width: 760px)').matches) {
    root.querySelector('#statsGrid').style.gridTemplateColumns = '1fr 1fr';
  }

  on(root, 'click', '[data-year]', (e, t) => {
    uiState.year = Number(t.dataset.year);
    go('#/stats', { replace: true });
  });
  on(root, 'click', '[data-book]', (e, t) => go(`#/book/${t.dataset.book}`));

  return root;
}
