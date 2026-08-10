// 기록 — 날짜별 독서 활동 타임라인

import { el, esc, on, fmtMinutes, weekdayKo, ymd, groupBy } from '../util.js';
import * as store from '../store.js';
import { coverHTML } from '../ui.js';
import { go } from '../router.js';

const PAGE = 30; // 한 번에 보여줄 날짜 수
const uiState = { limit: PAGE };

export default function timelineView() {
  const events = [];

  for (const s of store.sessions()) {
    const b = store.getBook(s.bookId);
    if (!b) continue;
    const pages = (s.startPage != null && s.endPage != null && s.endPage > s.startPage)
      ? s.endPage - s.startPage : 0;
    events.push({
      date: s.date, kind: 'session', book: b, sort: s.startedAt || s.date,
      title: `${b.title}`,
      sub: `${fmtMinutes(s.minutes)}${pages ? ` · ${pages}쪽` : ''}${s.memo ? ` · ${s.memo}` : ''}`,
      icon: '⏱',
    });
  }
  for (const n of store.notes()) {
    const b = store.getBook(n.bookId);
    if (!b) continue;
    const meta = store.NOTE_TYPES[n.type] || store.NOTE_TYPES.memo;
    events.push({
      date: ymd(new Date(n.createdAt)), kind: 'note', book: b, sort: n.createdAt,
      title: n.text.length > 60 ? `${n.text.slice(0, 60)}…` : n.text,
      sub: `${meta.label}${n.page != null ? ` · ${n.page}쪽` : ''} · ${b.title}`,
      icon: meta.icon,
    });
  }
  for (const b of store.books()) {
    if (b.finishedAt) {
      events.push({
        date: b.finishedAt, kind: 'finish', book: b, sort: `${b.finishedAt}T23:59`,
        title: `${b.title} 완독`,
        sub: b.oneLine || `${(b.authors || []).join(', ')}`,
        icon: '🎉',
      });
    }
    if (b.startedAt && b.startedAt !== b.finishedAt) {
      events.push({
        date: b.startedAt, kind: 'start', book: b, sort: `${b.startedAt}T00:01`,
        title: `${b.title} 읽기 시작`,
        sub: (b.authors || []).join(', '),
        icon: '📖',
      });
    }
  }

  const byDay = [...groupBy(events, (e2) => e2.date).entries()]
    .sort((a, b) => b[0].localeCompare(a[0]));

  const root = el(`
    <div>
      <div class="section__head" style="margin-bottom:18px">
        <h1 style="font-size:22px">기록</h1>
        <span class="muted tiny">${events.length}개의 활동</span>
      </div>
      <div id="tlBody"></div>
    </div>`);

  function paint() {
    const host = root.querySelector('#tlBody');
    if (!byDay.length) {
      host.innerHTML = `<div class="empty"><strong>아직 기록이 없어요</strong>
        타이머로 읽거나 문장을 남기면 여기에 하루하루가 쌓여요.</div>`;
      return;
    }
    const shown = byDay.slice(0, uiState.limit);
    host.innerHTML = shown.map(([date, items]) => {
      const d = new Date(date);
      const sorted = [...items].sort((a, b) => String(b.sort).localeCompare(String(a.sort)));
      return `
        <div class="tl-day">
          <div class="tl-day__date">
            <b>${d.getDate()}</b>
            ${d.getMonth() + 1}월 ${weekdayKo(d)}
          </div>
          <div class="tl-day__line"></div>
          <div class="tl-day__items">
            ${sorted.map((it) => `
              <div class="tl-event" data-book="${esc(it.book.id)}">
                ${coverHTML(it.book)}
                <div class="tl-event__main">
                  <div class="tl-event__t">${esc(it.icon)} ${esc(it.title)}</div>
                  <div class="tl-event__s">${esc(it.sub)}</div>
                </div>
              </div>`).join('')}
          </div>
        </div>`;
    }).join('')
      + (byDay.length > uiState.limit
        ? '<div style="text-align:center;margin-top:12px"><button class="btn" data-more type="button">더 보기</button></div>'
        : '');
  }
  paint();

  on(root, 'click', '[data-book]', (e, t) => go(`#/book/${t.dataset.book}`));
  on(root, 'click', '[data-more]', () => { uiState.limit += PAGE; paint(); });

  return root;
}
