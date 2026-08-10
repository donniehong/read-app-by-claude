// 책 상세 — 진도 · 감상 · 문장/메모/실천 · 독서 세션

import { el, esc, on, nfmt, fmtDate, fmtMinutes, sum, daysBetween } from '../util.js';
import * as store from '../store.js';
import { coverHTML, ratingInput, toast, confirmDialog } from '../ui.js';
import { openBookForm, openProgressDialog, openNoteEditor, openFinishDialog } from '../dialogs.js';
import { openQuoteCard } from '../quotecard.js';
import * as timer from '../timer.js';
import { go } from '../router.js';

const tabState = {};   // bookId → 활성 탭

export default function bookView({ id }) {
  const b = store.getBook(id);
  if (!b) {
    return el(`<div class="empty"><strong>책을 찾을 수 없어요</strong>
      삭제되었거나 잘못된 주소입니다.
      <div style="margin-top:14px"><a class="btn" href="#/library">서재로 가기</a></div></div>`);
  }

  const tab = tabState[id] || 'overview';
  const notes = store.notesOf(id).sort((a, b2) => (a.page ?? 1e9) - (b2.page ?? 1e9)
    || String(a.createdAt).localeCompare(String(b2.createdAt)));
  const sessions = store.sessionsOf(id).sort((a, b2) => String(b2.startedAt).localeCompare(String(a.startedAt)));
  const pct = store.progressOf(b);
  const f = store.forecast(b);
  const totalMin = sum(sessions, (s) => s.minutes);
  const running = timer.isRunning(id);

  const readDays = b.startedAt && b.finishedAt ? daysBetween(b.startedAt, b.finishedAt) + 1 : null;

  const root = el(`
    <div>
      <button class="btn btn--ghost btn--sm" data-back type="button" style="margin-bottom:14px">← 뒤로</button>

      <div class="bookhead">
        ${coverHTML(b)}
        <div class="bookhead__info">
          <span class="badge badge--${esc(b.status)}">${esc(store.STATUS[b.status])}</span>
          ${b.readCount > 1 ? `<span class="badge badge--want">${b.readCount}회독</span>` : ''}
          <h1 class="bookhead__title" style="margin-top:8px">${esc(b.title)}</h1>
          <p class="bookhead__authors">${esc((b.authors || []).join(', '))}${b.publisher ? ` · ${esc(b.publisher)}` : ''}</p>

          <div id="bkRating"></div>

          ${b.status !== 'want' ? `
          <div style="margin-top:14px;max-width:420px">
            <div class="progress"><i style="width:${pct}%"></i></div>
            <div class="tiny faint mono" style="margin-top:6px">
              ${b.pageCount ? `${nfmt(b.currentPage || 0)} / ${nfmt(b.pageCount)}쪽 · ${pct}%` : `${nfmt(b.currentPage || 0)}쪽까지 읽음`}
              ${totalMin ? ` · 누적 ${fmtMinutes(totalMin)}` : ''}
            </div>
            ${f?.date ? `<div class="tiny" style="color:var(--accent);margin-top:4px">
              남은 ${nfmt(f.pagesLeft)}쪽 · 이 속도라면 ${fmtDate(f.date)}쯤 완독 (약 ${f.days}일)</div>` : ''}
          </div>` : ''}

          <div class="bookhead__actions">
            ${b.status === 'done' ? `
              <button class="btn" data-reread type="button">다시 읽기</button>
              <button class="btn" data-finish type="button">완독 기록 수정</button>
            ` : `
              <button class="btn btn--primary" data-timer type="button">${running ? '⏹ 세션 종료' : '⏱ 읽기 시작'}</button>
              <button class="btn" data-progress type="button">진도 업데이트</button>
              <button class="btn" data-finish type="button">완독</button>
            `}
            <button class="btn" data-note type="button">✍️ 기록</button>
            <button class="btn btn--icon" data-menu type="button" title="더보기">⋯</button>
          </div>
        </div>
      </div>

      <div class="tabs-line">
        <button class="tab ${tab === 'overview' ? 'is-active' : ''}" data-tab="overview" type="button">개요</button>
        <button class="tab ${tab === 'notes' ? 'is-active' : ''}" data-tab="notes" type="button">문장·메모 ${notes.length || ''}</button>
        <button class="tab ${tab === 'sessions' ? 'is-active' : ''}" data-tab="sessions" type="button">독서 기록 ${sessions.length || ''}</button>
      </div>
      <div id="bkTab"></div>
    </div>`);

  /* ---------- 탭: 개요 ---------- */
  function overviewHTML() {
    const info = [
      ['상태', store.STATUS[b.status]],
      ['쪽수', b.pageCount ? `${nfmt(b.pageCount)}쪽` : '—'],
      ['시작', b.startedAt ? fmtDate(b.startedAt) : '—'],
      ['완독', b.finishedAt ? fmtDate(b.finishedAt) : '—'],
      ['걸린 기간', readDays ? `${readDays}일` : '—'],
      ['누적 독서', totalMin ? fmtMinutes(totalMin) : '—'],
      ['출판', [b.publisher, (b.publishedDate || '').slice(0, 4)].filter(Boolean).join(' · ') || '—'],
      ['ISBN', b.isbn || '—'],
    ];

    return `
      ${b.oneLine || b.review || b.rating ? `
      <section class="section">
        <div class="section__head"><h2>내 감상</h2>
          <span class="more" data-finish>수정</span></div>
        <div class="card" style="padding:16px">
          ${b.oneLine ? `<p style="font-family:var(--serif);font-size:16.5px;line-height:1.7">“${esc(b.oneLine)}”</p>` : ''}
          ${b.review ? `<p class="muted" style="margin-top:${b.oneLine ? 12 : 0}px;white-space:pre-wrap;line-height:1.75">${esc(b.review)}</p>` : ''}
          ${b.rereadIntent ? '<p class="tiny" style="margin-top:12px;color:var(--accent)">🔁 다시 읽고 싶은 책</p>' : ''}
        </div>
      </section>` : `
      <section class="section">
        <div class="empty" style="padding:26px">
          <strong>아직 감상이 없어요</strong>
          다 읽은 뒤 한 줄 평과 실천 항목을 남겨 보세요.
          <div style="margin-top:12px"><button class="btn btn--sm" data-finish type="button">감상 남기기</button></div>
        </div>
      </section>`}

      <section class="section">
        <div class="section__head"><h2>책 정보</h2></div>
        <div class="card" style="padding:6px 16px">
          ${info.map(([k, v]) => `
            <div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px">
              <span class="faint" style="width:82px;flex:0 0 auto">${esc(k)}</span>
              <span style="flex:1;min-width:0">${esc(v)}</span>
            </div>`).join('')}
          ${(b.tags || []).length ? `
            <div style="padding:12px 0"><div class="chips">
              ${b.tags.map((t) => `<span class="chip chip--static"># ${esc(t)}</span>`).join('')}
            </div></div>` : ''}
        </div>
        ${b.description ? `
          <div class="card" style="padding:16px;margin-top:12px">
            <p class="muted" style="line-height:1.8;white-space:pre-wrap;font-size:13.8px">${esc(b.description)}</p>
          </div>` : ''}
      </section>`;
  }

  /* ---------- 탭: 문장·메모 ---------- */
  function noteCardHTML(n) {
    const meta = store.NOTE_TYPES[n.type] || store.NOTE_TYPES.memo;
    return `
      <article class="note note--${esc(n.type)} ${n.done ? 'is-done' : ''}" data-noteid="${esc(n.id)}">
        <div class="note__head">
          ${n.type === 'action' ? `<button class="note-check" data-toggle type="button" aria-label="완료">✓</button>` : ''}
          <div style="min-width:0;flex:1">
            <div class="note__text">${esc(n.text)}</div>
            ${n.comment ? `<div class="note__comment">${esc(n.comment)}</div>` : ''}
          </div>
        </div>
        <div class="note__foot">
          <span>${meta.icon} ${meta.label}</span>
          ${n.page != null ? `<span class="mono">${n.page}쪽</span>` : ''}
          ${(n.tags || []).map((t) => `<span># ${esc(t)}</span>`).join('')}
          <span class="spacer"></span>
          <span class="note__actions">
            ${n.type === 'quote' ? '<button class="btn btn--sm btn--ghost" data-card type="button">카드</button>' : ''}
            <button class="btn btn--sm btn--ghost" data-edit type="button">수정</button>
            <button class="btn btn--sm btn--ghost" data-del type="button">삭제</button>
          </span>
        </div>
      </article>`;
  }

  function notesHTML() {
    if (!notes.length) {
      return `<div class="empty"><strong>기록한 문장이 없어요</strong>
        마음에 남은 문장, 떠오른 생각, 실천할 일을 남겨 보세요.
        <div style="margin-top:14px"><button class="btn btn--primary" data-note type="button">✍️ 첫 기록 남기기</button></div></div>`;
    }
    const counts = { quote: 0, memo: 0, action: 0 };
    notes.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
    return `
      <div class="chips" style="margin-bottom:14px">
        <button class="chip is-active" data-ntype="all" type="button">전체 ${notes.length}</button>
        ${Object.entries(store.NOTE_TYPES).map(([k, m]) => counts[k]
          ? `<button class="chip" data-ntype="${k}" type="button">${m.icon} ${m.label} ${counts[k]}</button>` : '').join('')}
        <button class="btn btn--sm btn--primary" data-note type="button" style="margin-left:auto">＋ 기록</button>
      </div>
      <div id="bkNotes">${notes.map(noteCardHTML).join('')}</div>`;
  }

  /* ---------- 탭: 독서 기록 ---------- */
  function sessionsHTML() {
    if (!sessions.length) {
      return `<div class="empty"><strong>독서 세션이 없어요</strong>
        타이머로 읽으면 독서 시간과 속도가 쌓여요.
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:center">
          <button class="btn btn--primary" data-timer type="button">⏱ 읽기 시작</button>
          <button class="btn" data-manual type="button">직접 입력</button>
        </div></div>`;
    }
    const pages = sum(sessions, (s) =>
      (s.startPage != null && s.endPage != null && s.endPage > s.startPage) ? s.endPage - s.startPage : 0);
    const speed = store.readingSpeed(id);

    return `
      <div class="stat-grid" style="margin-bottom:16px">
        <div class="stat"><div class="stat__v mono">${sessions.length}<small>회</small></div><div class="stat__k">독서 세션</div></div>
        <div class="stat"><div class="stat__v mono">${fmtMinutes(totalMin)}</div><div class="stat__k">누적 시간</div></div>
        <div class="stat"><div class="stat__v mono">${nfmt(pages)}<small>쪽</small></div><div class="stat__k">기록된 분량</div></div>
        <div class="stat"><div class="stat__v mono">${speed ? (speed * 60).toFixed(0) : '—'}<small>쪽/시간</small></div><div class="stat__k">읽기 속도</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn btn--sm" data-manual type="button">＋ 기록 직접 추가</button>
      </div>
      <div class="booklist">
        ${sessions.map((s) => `
          <div class="card" style="padding:12px 14px" data-sess="${esc(s.id)}">
            <div style="display:flex;gap:10px;align-items:baseline">
              <b style="font-size:13.5px">${esc(fmtDate(s.date, { weekday: true }))}</b>
              <span class="mono muted tiny">${fmtMinutes(s.minutes)}</span>
              ${s.startPage != null && s.endPage != null
                ? `<span class="mono faint tiny">${s.startPage}→${s.endPage}쪽</span>` : ''}
              <button class="btn btn--sm btn--ghost" data-delsess type="button" style="margin-left:auto">삭제</button>
            </div>
            ${s.memo ? `<p class="muted tiny" style="margin-top:6px;white-space:pre-wrap">${esc(s.memo)}</p>` : ''}
          </div>`).join('')}
      </div>`;
  }

  function paintTab() {
    const host = root.querySelector('#bkTab');
    host.innerHTML = tab === 'notes' ? notesHTML()
      : tab === 'sessions' ? sessionsHTML()
      : overviewHTML();
  }
  paintTab();

  // 별점 위젯
  root.querySelector('#bkRating').appendChild(
    ratingInput(b.rating || 0, async (v) => {
      await store.updateBook(id, { rating: v });
      toast(v ? `${v}점을 남겼어요.` : '별점을 지웠어요.');
    }),
  );

  /* ---------- 이벤트 ---------- */
  on(root, 'click', '[data-back]', () => {
    if (history.length > 1) history.back(); else go('#/library');
  });
  on(root, 'click', '[data-tab]', (e, t) => {
    tabState[id] = t.dataset.tab;
    go(`#/book/${id}`, { replace: true });
  });

  on(root, 'click', '[data-timer]', () => {
    if (timer.isRunning(id)) { timer.stop(); return; }
    if (timer.start(id)) toast('독서 세션을 시작했어요 ⏱');
    go(`#/book/${id}`, { replace: true });
  });
  on(root, 'click', '[data-progress]', () => openProgressDialog(store.getBook(id)));
  on(root, 'click', '[data-finish]', () => openFinishDialog(store.getBook(id)));
  on(root, 'click', '[data-note]', () => openNoteEditor({ bookId: id }));
  on(root, 'click', '[data-manual]', () => timer.manualSessionDialog(id));

  on(root, 'click', '[data-reread]', async () => {
    const ok = await confirmDialog({
      title: '다시 읽기',
      message: '진도를 0쪽으로 되돌리고 “읽는 중”으로 바꿉니다. 기존 감상과 문장은 그대로 남아요.',
      okText: '다시 읽기',
    });
    if (!ok) return;
    await store.updateBook(id, {
      status: 'reading', currentPage: 0, finishedAt: '',
      startedAt: new Date().toISOString().slice(0, 10),
    });
    toast('다시 읽기를 시작해요 📖');
  });

  on(root, 'click', '[data-menu]', async () => {
    const { modal } = await import('../ui.js');
    modal({
      title: '더보기',
      body: `<div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn" data-m="edit" type="button">책 정보 수정</button>
        <button class="btn" data-m="status" type="button">상태 바꾸기</button>
        <button class="btn" data-m="fav" type="button">${b.favorite ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기'}</button>
        <button class="btn btn--danger" data-m="del" type="button">서재에서 삭제</button>
      </div>`,
      onMount(box, close) {
        box.addEventListener('click', async (e) => {
          const t = e.target.closest('[data-m]');
          if (!t) return;
          const act = t.dataset.m;
          if (act === 'edit') { close(); openBookForm({ book: store.getBook(id) }); }
          if (act === 'fav') { await store.updateBook(id, { favorite: !b.favorite }); close(); }
          if (act === 'status') {
            close();
            modal({
              title: '상태 바꾸기',
              body: `<div style="display:flex;flex-direction:column;gap:8px">
                ${store.STATUS_ORDER.map((s) => `<button class="btn ${b.status === s ? 'btn--primary' : ''}" data-s="${s}" type="button">${store.STATUS[s]}</button>`).join('')}
              </div>`,
              onMount(box2, close2) {
                box2.addEventListener('click', async (ev) => {
                  const st = ev.target.closest('[data-s]');
                  if (!st) return;
                  close2();
                  if (st.dataset.s === 'done') openFinishDialog(store.getBook(id));
                  else { await store.setStatus(id, st.dataset.s); toast('상태를 바꿨어요.'); }
                });
              },
            });
          }
          if (act === 'del') {
            close();
            const ok = await confirmDialog({
              title: '책 삭제',
              message: `“${b.title}”과(와) 이 책의 문장·독서 기록이 모두 지워져요. 되돌릴 수 없습니다.`,
              okText: '삭제', danger: true,
            });
            if (ok) { await store.removeBook(id); toast('삭제했어요.'); go('#/library'); }
          }
        });
      },
    });
  });

  // 노트 필터
  on(root, 'click', '[data-ntype]', (e, t) => {
    root.querySelectorAll('[data-ntype]').forEach((c) => c.classList.toggle('is-active', c === t));
    const want = t.dataset.ntype;
    root.querySelectorAll('#bkNotes .note').forEach((card) => {
      const n = notes.find((x) => x.id === card.dataset.noteid);
      card.style.display = (want === 'all' || n?.type === want) ? '' : 'none';
    });
  });

  // 노트 액션
  on(root, 'click', '[data-toggle]', async (e, t) => {
    const nid = t.closest('[data-noteid]').dataset.noteid;
    const n = notes.find((x) => x.id === nid);
    await store.updateNote(nid, { done: !n.done });
  });
  on(root, 'click', '[data-edit]', (e, t) => {
    const nid = t.closest('[data-noteid]').dataset.noteid;
    openNoteEditor({ bookId: id, note: notes.find((x) => x.id === nid) });
  });
  on(root, 'click', '[data-card]', (e, t) => {
    const nid = t.closest('[data-noteid]').dataset.noteid;
    openQuoteCard(notes.find((x) => x.id === nid), b);
  });
  on(root, 'click', '[data-del]', async (e, t) => {
    const nid = t.closest('[data-noteid]').dataset.noteid;
    const ok = await confirmDialog({ title: '기록 삭제', message: '이 기록을 지울까요?', okText: '삭제', danger: true });
    if (ok) { await store.removeNote(nid); toast('삭제했어요.'); }
  });
  on(root, 'click', '[data-delsess]', async (e, t) => {
    const sid = t.closest('[data-sess]').dataset.sess;
    const ok = await confirmDialog({ title: '독서 기록 삭제', message: '이 세션 기록을 지울까요?', okText: '삭제', danger: true });
    if (ok) { await store.removeSession(sid); toast('삭제했어요.'); }
  });

  return root;
}
