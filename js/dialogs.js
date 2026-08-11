// 책 추가/수정, 노트 편집, 진도 업데이트, 완독 회고 다이얼로그

import { el, esc, ymd, addDays, parseYmd, debounce, clamp } from './util.js';
import * as store from './store.js';
import { searchBooks, searchByIsbn, canScanBarcode } from './search.js';
import { modal, toast, confirmDialog, coverHTML, fieldHTML, parseList, ratingInput } from './ui.js';
import { go } from './router.js';

/* ============================================================
   책 추가 — 온라인 검색 + 직접 입력
   ============================================================ */
export function openAddBook({ initialQuery = '' } = {}) {
  const body = el(`
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="field">
        <label>책 검색</label>
        <div style="display:flex;gap:8px">
          <input class="input" id="abQuery" placeholder="제목, 저자, ISBN" value="${esc(initialQuery)}" autocomplete="off">
          ${canScanBarcode() ? '<button class="btn" id="abScan" type="button" title="바코드 스캔">📷</button>' : ''}
        </div>
      </div>
      <div id="abResults" class="searchres"></div>
      <div id="abStatus" class="tiny faint"></div>
      <button class="btn btn--ghost" id="abManual" type="button" style="align-self:flex-start">＋ 검색 없이 직접 입력</button>
    </div>`);

  modal({
    title: '책 추가',
    body,
    wide: true,
    onMount(box, close) {
      const input = box.querySelector('#abQuery');
      const results = box.querySelector('#abResults');
      const status = box.querySelector('#abStatus');
      let ctrl = null;

      const run = async (q) => {
        ctrl?.abort();
        if (!q.trim()) { results.innerHTML = ''; status.textContent = ''; return; }
        ctrl = new AbortController();
        status.style.color = '';
        status.textContent = '검색 중…';
        results.innerHTML = '<div class="skel" style="height:56px"></div>'.repeat(3);
        try {
          const { items, providerLabel, warning } = await searchBooks(q, { signal: ctrl.signal });
          if (!items.length) {
            results.innerHTML = '';
            status.textContent = '검색 결과가 없어요. 아래에서 직접 입력해 보세요.';
            return;
          }
          status.textContent = warning || `${items.length}건 · ${providerLabel}`;
          results.innerHTML = items.map((it, i) => {
            const dup = store.findDuplicate(it);
            return `
              <button class="searchres__item" type="button" data-i="${i}">
                ${coverHTML(it)}
                <span style="min-width:0;flex:1">
                  <span style="display:block;font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.title)}</span>
                  <span class="tiny faint" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${esc([it.authors.join(', '), it.publisher, (it.publishedDate || '').slice(0, 4)].filter(Boolean).join(' · '))}
                  </span>
                  ${dup ? '<span class="tiny" style="color:var(--warn)">이미 서재에 있어요</span>'
                        : (it.pageCount ? `<span class="tiny faint">${it.pageCount}쪽</span>` : '')}
                </span>
              </button>`;
          }).join('');
          results.querySelectorAll('[data-i]').forEach((btn) => {
            btn.onclick = () => {
              close();
              openBookForm({ draft: items[Number(btn.dataset.i)] });
            };
          });
        } catch (e) {
          if (e.name === 'AbortError') return;
          results.innerHTML = '';
          status.textContent = e.message;
          status.style.color = 'var(--danger)';
          // 검색이 막혔을 때는 직접 입력이 유일한 길이므로 눈에 띄게 바꾼다
          const manual = box.querySelector('#abManual');
          manual.className = 'btn btn--primary';
          manual.style.alignSelf = 'flex-start';
        }
      };

      input.addEventListener('input', debounce((e) => run(e.target.value), 400));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(input.value); });
      if (initialQuery) run(initialQuery);

      box.querySelector('#abManual').onclick = () => {
        close();
        openBookForm({ draft: { title: input.value.trim() } });
      };

      box.querySelector('#abScan')?.addEventListener('click', () => {
        close();
        openBarcodeScanner();
      });
    },
  });
}

/* ============================================================
   바코드(ISBN) 스캔 — 지원 브라우저에서만
   ============================================================ */
async function openBarcodeScanner() {
  const body = el(`
    <div style="display:flex;flex-direction:column;gap:10px">
      <video id="bcVideo" playsinline muted
             style="width:100%;border-radius:12px;background:#000;aspect-ratio:4/3;object-fit:cover"></video>
      <p class="tiny faint" id="bcStatus">카메라를 준비하고 있어요…</p>
    </div>`);

  let stream = null, raf = null, stopped = false;

  const { close } = modal({
    title: 'ISBN 바코드 스캔',
    body,
    onMount(box, cl) {
      const video = box.querySelector('#bcVideo');
      const status = box.querySelector('#bcStatus');

      const teardown = () => {
        stopped = true;
        cancelAnimationFrame(raf);
        stream?.getTracks().forEach((t) => t.stop());
      };
      const obs = new MutationObserver(() => {
        if (!box.isConnected) { obs.disconnect(); teardown(); }
      });
      obs.observe(document.getElementById('modalRoot'), { childList: true });

      (async () => {
        try {
          const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'isbn'] });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          video.srcObject = stream;
          await video.play();
          status.textContent = '책 뒤표지의 바코드를 비춰 주세요.';

          const loop = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(video);
              const hit = codes.find((c) => /^97[89]\d{10}$/.test(c.rawValue));
              if (hit) {
                teardown(); cl();
                toast('바코드를 읽었어요. 책 정보를 찾는 중…');
                const items = await searchByIsbn(hit.rawValue);
                if (items.length) openBookForm({ draft: items[0] });
                else openBookForm({ draft: { isbn: hit.rawValue } });
                return;
              }
            } catch { /* 프레임 단위 실패는 무시 */ }
            raf = requestAnimationFrame(loop);
          };
          loop();
        } catch (e) {
          status.textContent = `카메라를 열 수 없어요: ${e.message}`;
        }
      })();
    },
  });
  void close;
}

/* ============================================================
   책 정보 폼 (추가 / 수정 공용)
   ============================================================ */
export function openBookForm({ draft = null, book = null } = {}) {
  const b = book || store.newBook(draft || {});
  const editing = !!book;

  const body = el(`
    <div style="display:flex;flex-direction:column;gap:13px">
      <div style="display:flex;gap:14px;align-items:flex-start">
        ${coverHTML(b, { width: 74 })}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
          ${fieldHTML('제목 *', `<input class="input" id="bfTitle" value="${esc(b.title)}">`)}
          ${fieldHTML('저자', `<input class="input" id="bfAuthors" value="${esc((b.authors || []).join(', '))}" placeholder="쉼표로 구분">`)}
        </div>
      </div>
      <div class="row">
        ${fieldHTML('출판사', `<input class="input" id="bfPublisher" value="${esc(b.publisher)}">`)}
        <div class="field">
          <label>전체 쪽수 ${!b.pageCount ? '<span style="color:var(--warn)">· 검색으로 못 채웠어요</span>' : ''}</label>
          <input class="input" id="bfPages" type="number" min="0" value="${b.pageCount || ''}"
                 ${!b.pageCount ? 'placeholder="책 뒤쪽에서 확인해 입력해 주세요" style="border-color:var(--warn)"' : ''}>
          ${!b.pageCount ? '<p class="tiny faint">쪽수가 있어야 진도율과 완독 예상일이 계산돼요.</p>' : ''}
        </div>
      </div>
      <div class="row">
        ${fieldHTML('상태', `<select class="select" id="bfStatus">
          ${store.STATUS_ORDER.map((s) => `<option value="${s}" ${b.status === s ? 'selected' : ''}>${store.STATUS[s]}</option>`).join('')}
        </select>`)}
        ${fieldHTML('분류/장르', `<input class="input" id="bfCats" value="${esc((b.categories || []).join(', '))}" placeholder="소설, 에세이…">`)}
      </div>
      <div class="row">
        ${fieldHTML('시작일', `<input class="input" id="bfStart" type="date" value="${esc(b.startedAt)}">`)}
        ${fieldHTML('완독일', `<input class="input" id="bfFinish" type="date" value="${esc(b.finishedAt)}">`)}
      </div>
      <div class="row">
        ${fieldHTML('어디서 온 책', `<select class="select" id="bfAcqType">
          <option value="" ${!b.acqType ? 'selected' : ''}>미지정</option>
          <option value="purchase" ${b.acqType === 'purchase' ? 'selected' : ''}>구매</option>
          <option value="borrow" ${b.acqType === 'borrow' ? 'selected' : ''}>대출</option>
        </select>`)}
        <div class="field">
          <label id="bfAcqPlaceLabel">구매처 · 빌린 곳</label>
          <input class="input" id="bfAcqPlace" list="bfPlaces" value="${esc(b.acqPlace || '')}" autocomplete="off">
          <datalist id="bfPlaces"></datalist>
        </div>
        <div class="field">
          <label id="bfAcqDateLabel">구매일 · 대출일</label>
          <input class="input" id="bfAcqDate" type="date" value="${esc(b.acqDate || '')}">
        </div>
        <div class="field" id="bfDueWrap" hidden>
          <label>반납 예정일</label>
          <input class="input" id="bfAcqDue" type="date" value="${esc(b.acqDueDate || '')}">
        </div>
      </div>
      <div class="row">
        ${fieldHTML('태그', `<input class="input" id="bfTags" value="${esc((b.tags || []).join(', '))}" placeholder="자기계발, 재독하고싶은…">`)}
        ${fieldHTML('읽고 싶은 정도', `<select class="select" id="bfPriority">
          <option value="2" ${b.priority === 2 ? 'selected' : ''}>높음 — 다음에 읽을 책</option>
          <option value="1" ${b.priority === 1 ? 'selected' : ''}>보통</option>
          <option value="0" ${b.priority === 0 ? 'selected' : ''}>낮음 — 언젠가</option>
        </select>`)}
      </div>
      ${fieldHTML('표지 이미지 주소', `<input class="input" id="bfCover" value="${esc(b.cover)}" placeholder="https://…">`)}
      ${fieldHTML('ISBN', `<input class="input" id="bfIsbn" value="${esc(b.isbn)}">`)}
    </div>`);

  modal({
    title: editing ? '책 정보 수정' : '서재에 추가',
    body,
    wide: true,
    foot: `<button class="btn btn--primary" data-save type="button">${editing ? '저장' : '서재에 담기'}</button>`,
    onMount(box, close) {
      const v = (id) => box.querySelector(id).value.trim();

      // 구매/대출 선택에 따라 옆 칸의 성격이 달라진다
      const acqType = box.querySelector('#bfAcqType');
      const acqPlace = box.querySelector('#bfAcqPlace');
      const acqDate = box.querySelector('#bfAcqDate');
      const acqDue = box.querySelector('#bfAcqDue');
      const dueWrap = box.querySelector('#bfDueWrap');
      const placeLabel = box.querySelector('#bfAcqPlaceLabel');
      const dateLabel = box.querySelector('#bfAcqDateLabel');
      const places = box.querySelector('#bfPlaces');

      const syncAcq = ({ userChanged = false } = {}) => {
        const t = acqType.value;
        const meta = store.ACQUISITION[t];
        const on = !!meta;
        [acqPlace, acqDate].forEach((f) => { f.disabled = !on; });
        placeLabel.textContent = meta ? meta.placeLabel : '구매처 · 빌린 곳';
        dateLabel.textContent = t === 'borrow' ? '대출일' : t === 'purchase' ? '구매일' : '구매일 · 대출일';
        acqPlace.placeholder = meta ? meta.ph : '먼저 구매인지 대출인지 골라 주세요';
        places.innerHTML = store.acquisitionPlaces(t)
          .map((x) => `<option value="${esc(x)}"></option>`).join('');
        // 직접 고른 경우에만 날짜를 오늘로 채워 준다 (기존 기록을 건드리지 않도록)
        if (userChanged && on && !acqDate.value) acqDate.value = ymd();

        dueWrap.hidden = t !== 'borrow';
        // 흔한 대출 기간이 2주라 기본값으로 채워 두되, 언제든 고칠 수 있다
        if (userChanged && t === 'borrow' && !acqDue.value) {
          acqDue.value = ymd(addDays(acqDate.value ? parseYmd(acqDate.value) : new Date(), 14));
        }
      };
      acqDate.addEventListener('change', () => {
        if (acqType.value === 'borrow' && !acqDue.value && acqDate.value) {
          acqDue.value = ymd(addDays(parseYmd(acqDate.value), 14));
        }
      });
      acqType.addEventListener('change', () => syncAcq({ userChanged: true }));
      syncAcq();

      // 표지 주소를 바꾸면 미리보기 갱신
      box.querySelector('#bfCover').addEventListener('change', (e) => {
        const holder = box.querySelector('.cover');
        holder.outerHTML = coverHTML({ ...b, cover: e.target.value.trim(), title: v('#bfTitle') }, { width: 74 });
      });

      box.querySelector('[data-save]').onclick = async () => {
        const title = v('#bfTitle');
        if (!title) { toast('제목을 입력해 주세요.'); box.querySelector('#bfTitle').focus(); return; }

        const patch = {
          title,
          authors: parseList(v('#bfAuthors')),
          publisher: v('#bfPublisher'),
          pageCount: Number(box.querySelector('#bfPages').value) || 0,
          status: v('#bfStatus'),
          categories: parseList(v('#bfCats')),
          startedAt: v('#bfStart'),
          finishedAt: v('#bfFinish'),
          tags: parseList(v('#bfTags')),
          priority: Number(v('#bfPriority')),
          cover: v('#bfCover'),
          isbn: v('#bfIsbn'),
          acqType: v('#bfAcqType'),
          acqPlace: v('#bfAcqType') ? v('#bfAcqPlace') : '',
          acqDate: v('#bfAcqType') ? v('#bfAcqDate') : '',
          acqDueDate: v('#bfAcqType') === 'borrow' ? v('#bfAcqDue') : '',
        };
        if (patch.status === 'reading' && !patch.startedAt) patch.startedAt = ymd();
        if (patch.status === 'done' && !patch.finishedAt) patch.finishedAt = ymd();

        if (editing) {
          await store.updateBook(b.id, patch);
          toast('저장했어요.');
          close();
        } else {
          const dup = store.findDuplicate({ isbn: patch.isbn, title: patch.title, authors: patch.authors });
          if (dup) {
            const ok = await confirmDialog({
              title: '이미 서재에 있어요',
              message: `“${dup.title}”이(가) 이미 있습니다. 그래도 새로 추가할까요?`,
              okText: '새로 추가',
            });
            if (!ok) { close(); go(`#/book/${dup.id}`); return; }
          }
          const created = await store.addBook({
            ...b, ...patch,
            description: b.description || '',
            publishedDate: b.publishedDate || '',
            link: b.link || '',
          });
          close();
          toast('서재에 담았어요 📚');
          go(`#/book/${created.id}`);
        }
      };
    },
  });
}

/* ============================================================
   진도 업데이트
   ============================================================ */
export function openProgressDialog(book) {
  const body = el(`
    <div style="display:flex;flex-direction:column;gap:13px">
      <p class="muted">${esc(book.title)}</p>
      <div class="row">
        ${fieldHTML('현재 쪽', `<input class="input" id="pgNow" type="number" min="0" value="${book.currentPage || 0}">`)}
        ${fieldHTML('전체 쪽', `<input class="input" id="pgTotal" type="number" min="0" value="${book.pageCount || ''}">`)}
      </div>
      <div class="chips" id="pgQuick">
        <button class="chip" type="button" data-add="10">+10쪽</button>
        <button class="chip" type="button" data-add="20">+20쪽</button>
        <button class="chip" type="button" data-add="50">+50쪽</button>
        <button class="chip" type="button" data-pct="25">25%</button>
        <button class="chip" type="button" data-pct="50">50%</button>
        <button class="chip" type="button" data-pct="75">75%</button>
      </div>
      <p class="tiny faint" id="pgHint"></p>
    </div>`);

  modal({
    title: '진도 업데이트',
    body,
    foot: `
      <button class="btn" data-finish type="button">완독 처리</button>
      <button class="btn btn--primary" data-save type="button">저장</button>`,
    onMount(box, close) {
      const now = box.querySelector('#pgNow');
      const total = box.querySelector('#pgTotal');
      const hint = box.querySelector('#pgHint');

      const refresh = () => {
        const t = Number(total.value) || 0;
        const n = Number(now.value) || 0;
        hint.textContent = t ? `${Math.round((n / t) * 100)}% · ${Math.max(0, t - n)}쪽 남음` : '';
      };
      refresh();
      now.addEventListener('input', refresh);
      total.addEventListener('input', refresh);

      box.querySelector('#pgQuick').addEventListener('click', (e) => {
        const t = e.target.closest('[data-add], [data-pct]');
        if (!t) return;
        const tot = Number(total.value) || 0;
        if (t.dataset.add) now.value = (Number(now.value) || 0) + Number(t.dataset.add);
        else if (tot) now.value = Math.round((tot * Number(t.dataset.pct)) / 100);
        refresh();
      });

      box.querySelector('[data-save]').onclick = async () => {
        const tot = Number(total.value) || 0;
        const n = clamp(Number(now.value) || 0, 0, tot || Infinity);
        await store.updateBook(book.id, {
          currentPage: n,
          pageCount: tot,
          status: book.status === 'want' || book.status === 'paused' ? 'reading' : book.status,
          startedAt: book.startedAt || ymd(),
        });
        close();
        if (tot && n >= tot) openFinishDialog(store.getBook(book.id));
        else toast('진도를 저장했어요.');
      };

      box.querySelector('[data-finish]').onclick = async () => {
        const tot = Number(total.value) || book.pageCount || 0;
        await store.updateBook(book.id, { pageCount: tot });
        close();
        openFinishDialog(store.getBook(book.id));
      };
    },
  });
}

/* ============================================================
   완독 회고 — 별점 · 한 줄 · 실천 항목
   ============================================================ */
export function openFinishDialog(book) {
  let rating = book.rating || 0;

  const body = el(`
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:13px;align-items:center">
        ${coverHTML(book, { width: 56 })}
        <div style="min-width:0">
          <div style="font-weight:700">${esc(book.title)}</div>
          <div class="tiny faint">${esc((book.authors || []).join(', '))}</div>
        </div>
      </div>
      <div class="field"><label>별점</label><div id="fdRating"></div></div>
      ${fieldHTML('한 줄 평 — 이 책을 한 문장으로', `<input class="input" id="fdOne" value="${esc(book.oneLine)}" placeholder="예: 습관은 의지가 아니라 설계의 문제다.">`)}
      ${fieldHTML('감상 (선택)', `<textarea class="textarea" id="fdReview" placeholder="배운 것 / 인상 깊었던 것 / 아쉬웠던 것">${esc(book.review)}</textarea>`)}
      ${fieldHTML('이 책에서 실천할 것 (선택)', '<textarea class="textarea" id="fdActions" placeholder="한 줄에 하나씩 적으면 실천 목록으로 저장돼요"></textarea>')}
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer">
        <input type="checkbox" id="fdReread" ${book.rereadIntent ? 'checked' : ''}> 언젠가 다시 읽고 싶다
      </label>
      ${fieldHTML('완독일', `<input class="input" id="fdDate" type="date" value="${esc(book.finishedAt || ymd())}">`)}
    </div>`);

  modal({
    title: '완독 기록',
    body,
    wide: true,
    foot: '<button class="btn btn--primary" data-save type="button">완독으로 저장</button>',
    onMount(box, close) {
      box.querySelector('#fdRating').appendChild(ratingInput(rating, (v) => { rating = v; }));

      box.querySelector('[data-save]').onclick = async () => {
        const finishedAt = box.querySelector('#fdDate').value || ymd();
        await store.updateBook(book.id, {
          status: 'done',
          rating,
          oneLine: box.querySelector('#fdOne').value.trim(),
          review: box.querySelector('#fdReview').value.trim(),
          rereadIntent: box.querySelector('#fdReread').checked,
          finishedAt,
          startedAt: book.startedAt || finishedAt,
          currentPage: book.pageCount || book.currentPage,
          readCount: (book.readCount || 0) + (book.status === 'done' ? 0 : 1),
        });

        const actions = box.querySelector('#fdActions').value
          .split('\n').map((s) => s.trim()).filter(Boolean);
        for (const text of actions) {
          await store.addNote({ bookId: book.id, type: 'action', text });
        }

        close();
        toast(actions.length ? `완독! 실천 ${actions.length}개를 등록했어요 🎉` : '완독을 축하해요 🎉');
      };
    },
  });
}

/* ============================================================
   노트(인용/메모/실천) 편집
   ============================================================ */
export function openNoteEditor({ bookId, note = null, type = 'quote' } = {}) {
  const editing = !!note;
  const n = note || { type, text: '', comment: '', page: null, tags: [] };
  const books = store.books();

  const body = el(`
    <div style="display:flex;flex-direction:column;gap:13px">
      ${!bookId && !editing ? fieldHTML('책', `<select class="select" id="neBook">
          ${books.map((b) => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}
        </select>`) : ''}
      <div class="field">
        <label>종류</label>
        <div class="chips" id="neType">
          ${Object.entries(store.NOTE_TYPES).map(([k, meta]) =>
            `<button type="button" class="chip ${n.type === k ? 'is-active' : ''}" data-type="${k}">${meta.icon} ${meta.label}</button>`).join('')}
        </div>
      </div>
      ${fieldHTML('내용 *', `<textarea class="textarea" id="neText" style="min-height:130px" placeholder="책 속 문장이나 생각을 적어 주세요">${esc(n.text)}</textarea>`)}
      <div class="row">
        ${fieldHTML('쪽수', `<input class="input" id="nePage" type="number" min="0" value="${n.page ?? ''}">`)}
        ${fieldHTML('태그', `<input class="input" id="neTags" value="${esc((n.tags || []).join(', '))}" placeholder="쉼표로 구분">`)}
      </div>
      ${fieldHTML('내 생각 (선택)', `<textarea class="textarea" id="neComment" style="min-height:70px">${esc(n.comment)}</textarea>`)}
    </div>`);

  let curType = n.type;

  modal({
    title: editing ? '기록 수정' : '문장·메모 남기기',
    body,
    wide: true,
    foot: '<button class="btn btn--primary" data-save type="button">저장</button>',
    onMount(box, close) {
      box.querySelector('#neType').addEventListener('click', (e) => {
        const t = e.target.closest('[data-type]');
        if (!t) return;
        curType = t.dataset.type;
        box.querySelectorAll('#neType .chip').forEach((c) => c.classList.toggle('is-active', c === t));
      });

      box.querySelector('[data-save]').onclick = async () => {
        const text = box.querySelector('#neText').value.trim();
        if (!text) { toast('내용을 입력해 주세요.'); return; }
        const pageRaw = box.querySelector('#nePage').value;
        const patch = {
          type: curType,
          text,
          comment: box.querySelector('#neComment').value.trim(),
          page: pageRaw === '' ? null : Number(pageRaw),
          tags: parseList(box.querySelector('#neTags').value),
        };
        if (editing) {
          await store.updateNote(n.id, patch);
        } else {
          const bid = bookId || box.querySelector('#neBook')?.value;
          if (!bid) { toast('책을 먼저 추가해 주세요.'); return; }
          await store.addNote({ bookId: bid, ...patch });
        }
        close();
        toast('기록했어요 ✍️');
      };
    },
  });
}
