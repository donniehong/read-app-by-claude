// 설정 — 목표 · 테마 · 검색 공급자 · 백업/복원 · 샘플 데이터

import { el, esc, on, ymd, downloadBlob, pickFile, nfmt } from '../util.js';
import * as store from '../store.js';
import { toast, confirmDialog, fieldHTML } from '../ui.js';
import { testProvider } from '../search.js';
import { fmtBytes } from '../image.js';
import { applyTheme } from '../theme.js';
import { seedDemo } from '../demo.js';
import { go } from '../router.js';

export default function settingsView() {
  const st = store.settings();
  const year = new Date().getFullYear();
  const g = store.goal(year);
  const counts = {
    books: store.books().length,
    notes: store.notes().length,
    sessions: store.sessions().length,
  };
  const photo = store.photoUsage();

  const root = el(`
    <div>
      <h1 style="font-size:22px;margin-bottom:18px">설정</h1>

      <section class="section">
        <div class="section__head"><h2>${year}년 독서 목표</h2></div>
        <div class="card" style="padding:16px">
          <div class="row">
            ${fieldHTML('완독 권수', `<input class="input" id="stGoalBooks" type="number" min="0" value="${g.books || ''}" placeholder="예: 24">`)}
            ${fieldHTML('하루 목표 독서 시간(분)', `<input class="input" id="stDaily" type="number" min="0" value="${st.dailyMinutesTarget || ''}">`)}
          </div>
          <p class="tiny faint" style="margin-top:10px">목표를 정하면 홈에서 “예정보다 몇 권 앞서는지” 알려드려요.</p>
          <button class="btn btn--primary btn--sm" id="stSaveGoal" type="button" style="margin-top:12px">목표 저장</button>
        </div>
      </section>

      <section class="section">
        <div class="section__head"><h2>화면</h2></div>
        <div class="card" style="padding:16px">
          ${fieldHTML('테마', `<select class="select" id="stTheme">
            <option value="auto"  ${st.theme === 'auto' ? 'selected' : ''}>시스템 설정 따르기</option>
            <option value="light" ${st.theme === 'light' ? 'selected' : ''}>밝게</option>
            <option value="dark"  ${st.theme === 'dark' ? 'selected' : ''}>어둡게</option>
          </select>`)}
        </div>
      </section>

      <section class="section">
        <div class="section__head"><h2>책 검색</h2></div>
        <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
          ${fieldHTML('검색 공급자', `<select class="select" id="stProvider">
            <option value="google" ${st.searchProvider === 'google' ? 'selected' : ''}>Google Books — 키 불필요</option>
            <option value="aladin" ${st.searchProvider === 'aladin' ? 'selected' : ''}>알라딘 — 국내서 정확, 쪽수 제공 (키 필요)</option>
            <option value="kakao"  ${st.searchProvider === 'kakao' ? 'selected' : ''}>카카오 책검색 — 국내서 정확 (키 필요, 쪽수 없음)</option>
          </select>`)}

          <div id="stAladinWrap" ${st.searchProvider === 'aladin' ? '' : 'hidden'}>
            ${fieldHTML('알라딘 TTB 키', `<input class="input" id="stAladinKey" value="${esc(st.aladinKey)}" placeholder="ttb..." autocomplete="off">`)}
          </div>
          <div id="stKakaoWrap" ${st.searchProvider === 'kakao' ? '' : 'hidden'}>
            ${fieldHTML('카카오 REST API 키', `<input class="input" id="stKakaoKey" value="${esc(st.kakaoKey)}" placeholder="developers.kakao.com 에서 발급" autocomplete="off">`)}
          </div>

          <p class="tiny faint" id="stKeyNote" ${st.searchProvider === 'google' ? 'hidden' : ''}>
            키는 이 브라우저에만 저장되며 어디로도 전송되지 않아요.
            알라딘·카카오는 원래 서버에서 부르는 API라 브라우저에서 막힐 수 있습니다.
            아래 <b>연결 테스트</b>로 확인해 보세요. 막히면 Google Books 로 자동으로 넘어갑니다.
          </p>

          <div class="chips">
            <button class="btn btn--primary btn--sm" id="stSaveSearch" type="button">검색 설정 저장</button>
            <button class="btn btn--sm" id="stTest" type="button">연결 테스트</button>
          </div>
          <div id="stTestOut" class="tiny" hidden></div>
        </div>
      </section>

      <section class="section">
        <div class="section__head"><h2>데이터</h2></div>
        <div class="card" style="padding:16px">
          <p class="tiny muted" style="margin-bottom:14px">
            모든 기록은 이 브라우저 안에만 저장돼요 (서버 없음).
            기기를 옮기거나 백업하려면 아래에서 파일로 내보내세요.
          </p>
          <p class="tiny faint" style="margin-bottom:14px">
            현재 책 ${nfmt(counts.books)}권 · 기록 ${nfmt(counts.notes)}개 · 독서 세션 ${nfmt(counts.sessions)}회
            ${photo.count ? ` · 사진 ${nfmt(photo.count)}장 (${fmtBytes(photo.bytes)})` : ''}
          </p>
          <div class="chips">
            <button class="btn btn--sm" id="stExport" type="button">
              JSON 내보내기${photo.count ? ` (약 ${fmtBytes(Math.round(photo.bytes * 1.37) + 60000)})` : ''}</button>
            <button class="btn btn--sm" id="stImportMerge" type="button">가져오기 (합치기)</button>
            <button class="btn btn--sm" id="stImportReplace" type="button">가져오기 (덮어쓰기)</button>
            <button class="btn btn--sm" id="stCsv" type="button">CSV 내보내기</button>
          </div>
          <div class="chips" style="margin-top:12px">
            <button class="btn btn--sm" id="stDemo" type="button">샘플 데이터 넣어보기</button>
            <button class="btn btn--sm btn--danger" id="stReset" type="button">전체 초기화</button>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section__head"><h2>단축키 (PC)</h2></div>
        <div class="card" style="padding:8px 16px">
          ${[['/', '검색창으로 이동'], ['N', '책 추가'], ['Q', '문장 기록'],
             ['T', '테마 전환'], ['1~5', '탭 이동'], ['Esc', '창 닫기']].map(([k, v]) => `
            <div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px">
              <kbd style="background:var(--bg-sunk);border-radius:6px;padding:1px 8px;font-family:var(--font);font-weight:700;min-width:44px;text-align:center">${esc(k)}</kbd>
              <span class="muted">${esc(v)}</span>
            </div>`).join('')}
        </div>
      </section>

      <p class="tiny faint" style="text-align:center;margin-top:30px">책갈피 · 오프라인에서도 동작하는 개인 독서기록</p>
    </div>`);

  /* ---- 목표 ---- */
  root.querySelector('#stSaveGoal').onclick = async () => {
    const books = Number(root.querySelector('#stGoalBooks').value) || 0;
    const daily = Number(root.querySelector('#stDaily').value) || 0;
    await store.saveGoal(year, { books });
    await store.saveSettings({ dailyMinutesTarget: daily });
    toast('목표를 저장했어요.');
  };

  /* ---- 테마 ---- */
  root.querySelector('#stTheme').onchange = async (e) => {
    await store.saveSettings({ theme: e.target.value });
    applyTheme(e.target.value);
  };

  /* ---- 검색 ---- */
  const provider = () => root.querySelector('#stProvider').value;
  const keyOf = (p) => (p === 'aladin' ? root.querySelector('#stAladinKey')?.value.trim()
    : p === 'kakao' ? root.querySelector('#stKakaoKey')?.value.trim() : '') || '';

  root.querySelector('#stProvider').onchange = () => {
    const p = provider();
    root.querySelector('#stAladinWrap').hidden = p !== 'aladin';
    root.querySelector('#stKakaoWrap').hidden = p !== 'kakao';
    root.querySelector('#stKeyNote').hidden = p === 'google';
  };

  root.querySelector('#stSaveSearch').onclick = async () => {
    await store.saveSettings({
      searchProvider: provider(),
      aladinKey: root.querySelector('#stAladinKey')?.value.trim() || '',
      kakaoKey: root.querySelector('#stKakaoKey')?.value.trim() || '',
    });
    toast('검색 설정을 저장했어요.');
  };

  root.querySelector('#stTest').onclick = async (e) => {
    const btn = e.currentTarget;
    const out = root.querySelector('#stTestOut');
    const p = provider();
    const key = keyOf(p);

    if (p !== 'google' && !key) {
      out.hidden = false;
      out.style.color = 'var(--danger)';
      out.textContent = '먼저 키를 입력해 주세요.';
      return;
    }

    btn.disabled = true;
    out.hidden = false;
    out.style.color = 'var(--text-dim)';
    out.textContent = '‘사피엔스’로 실제 검색을 시도하는 중…';

    const r = await testProvider(p, key);
    btn.disabled = false;
    out.style.color = r.ok ? 'var(--ok)' : 'var(--danger)';
    out.textContent = r.ok
      ? `✅ ${r.message}${r.sample ? ` · 예: ${r.sample}${r.pageCount ? ` (${r.pageCount}쪽)` : ''}` : ''}`
      : `❌ ${r.message}${p !== 'google' ? ' 이 공급자는 쓸 수 없으니 Google Books 로 두는 걸 권해요.' : ''}`;
  };

  /* ---- 백업 ---- */
  root.querySelector('#stExport').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '만드는 중…';
    try {
      const data = await store.exportData({ includePhotos: true });
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      downloadBlob(blob, `책갈피_백업_${ymd()}.json`);
      toast(`백업을 내려받았어요 (${fmtBytes(blob.size)})`);
    } catch (err) {
      toast(`백업에 실패했어요: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };

  const doImport = async (mode) => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (mode === 'replace') {
        const ok = await confirmDialog({
          title: '덮어쓰기',
          message: '지금 저장된 모든 기록을 지우고 파일 내용으로 교체해요. 되돌릴 수 없습니다.',
          okText: '덮어쓰기', danger: true,
        });
        if (!ok) return;
      }
      const r = await store.importData(data, mode);
      toast(`책 ${r.books}권 · 기록 ${r.notes}개 · 세션 ${r.sessions}회${r.images ? ` · 사진 ${r.images}장` : ''}을 가져왔어요.`);
    } catch (e) {
      toast(`가져오기 실패: ${e.message}`);
    }
  };
  root.querySelector('#stImportMerge').onclick = () => doImport('merge');
  root.querySelector('#stImportReplace').onclick = () => doImport('replace');

  /* ---- CSV ---- */
  root.querySelector('#stCsv').onclick = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['제목', '저자', '출판사', '상태', '별점', '전체쪽수', '현재쪽', '시작일', '완독일',
      '입수', '구매처/빌린곳', '구매일/대출일', '반납예정일', '반납일', '한줄평', '태그'];
    const rows = store.books().map((b) => [
      b.title, (b.authors || []).join(' / '), b.publisher, store.STATUS[b.status] || b.status,
      b.rating || '', b.pageCount || '', b.currentPage || '', b.startedAt, b.finishedAt,
      store.ACQUISITION[b.acqType]?.label || '', b.acqPlace || '', b.acqDate || '',
      b.acqDueDate || '', b.acqReturnedAt || '',
      b.oneLine, (b.tags || []).join(' / '),
    ].map(cell).join(','));
    const csv = '﻿' + [head.map(cell).join(','), ...rows].join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `책갈피_서재_${ymd()}.csv`);
    toast('CSV를 내려받았어요.');
  };

  /* ---- 샘플 / 초기화 ---- */
  root.querySelector('#stDemo').onclick = async () => {
    const ok = await confirmDialog({
      title: '샘플 데이터',
      message: '기능을 둘러볼 수 있도록 예시 책과 기록을 추가해요. 기존 데이터는 지워지지 않아요.',
      okText: '넣기',
    });
    if (!ok) return;
    await seedDemo();
    toast('샘플 데이터를 넣었어요.');
    go('#/home');
  };

  root.querySelector('#stReset').onclick = async () => {
    const ok = await confirmDialog({
      title: '전체 초기화',
      message: '모든 책, 문장, 독서 기록이 영구히 삭제돼요. 먼저 백업을 내보내는 걸 권해요.',
      okText: '전부 삭제', danger: true,
    });
    if (!ok) return;
    await store.resetAll();
    toast('초기화했어요.');
    go('#/home');
  };

  void on;
  return root;
}
