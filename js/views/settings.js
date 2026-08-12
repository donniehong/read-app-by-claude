// 설정 — 목표 · 테마 · 검색 공급자 · 백업/복원 · 샘플 데이터

import { el, esc, on, ymd, downloadBlob, pickFile, nfmt, fmtRelative } from '../util.js';
import * as store from '../store.js';
import * as sync from '../sync.js';
import { toast, confirmDialog, fieldHTML, modal } from '../ui.js';
import { testProvider } from '../search.js';
import { fmtBytes } from '../image.js';
import { applyTheme } from '../theme.js';
import { seedDemo } from '../demo.js';
import { go } from '../router.js';
import { APP_NAME } from '../brand.js';

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
        <div class="section__head"><h2>기기 간 동기화</h2></div>
        <div class="card" style="padding:16px" id="stSync"></div>
      </section>

      <section class="section">
        <div class="section__head"><h2>데이터</h2></div>
        <div class="card" style="padding:16px">
          <p class="tiny muted" style="margin-bottom:14px" id="stWhere"></p>
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
             ['T', '테마 전환'], ['1~5', '탭 이동'], ['6', '설정'], ['Esc', '창 닫기']].map(([k, v]) => `
            <div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px">
              <kbd style="background:var(--bg-sunk);border-radius:6px;padding:1px 8px;font-family:var(--font);font-weight:700;min-width:44px;text-align:center">${esc(k)}</kbd>
              <span class="muted">${esc(v)}</span>
            </div>`).join('')}
        </div>
      </section>

      <p class="tiny faint" style="text-align:center;margin-top:30px">${APP_NAME} · 오프라인에서도 동작하는 개인 독서기록</p>
    </div>`);

  /* ---- 기기 간 동기화 ---- */
  const syncBox = root.querySelector('#stSync');

  const STEPS = [
    ['supabase.com 에서 무료 계정을 만들고 <b>New project</b> 를 누르세요.',
     '이름과 비밀번호는 아무거나 좋아요. 지역은 <b>Northeast Asia (Seoul)</b> 이 가장 빠릅니다. 만드는 데 1~2분 걸려요.'],
    ['왼쪽 메뉴 <b>SQL Editor</b> 에서 아래 SQL 을 붙여넣고 <b>Run</b> 을 누르세요.',
     '기록을 담을 표와 사진 보관함을 만들고, 남이 내 기록을 못 보게 잠그는 작업입니다. 한 번만 하면 돼요.'],
    ['<b>Authentication → Sign In / Providers → Email</b> 에서 <b>Confirm email</b> 을 꺼 주세요.',
     '끄지 않으면 계정을 만든 뒤 메일함의 확인 링크를 눌러야 로그인됩니다. 어느 쪽이든 괜찮아요.'],
    ['톱니바퀴(<b>Project Settings</b>) → <b>API Keys</b> 에서 <b>Publishable key</b>(sb_publishable_…) 를 복사해 아래에 붙여넣으세요.',
     '기본으로 열리는 <b>Publishable and secret API keys</b> 탭의 <b>default</b> 줄입니다. '
     + '<b>Secret keys</b>(sb_secret_…), <b>JWT Keys</b> 메뉴, <b>service_role</b> 은 넣으면 안 됩니다 — 넣으시면 앱이 막아 드려요. '
     + '예전 방식인 <b>Legacy anon</b>(eyJ…) 탭의 키를 쓰셔도 동작합니다.'],
    ['프로젝트 주소는 <b>General</b> 의 <b>Project ID</b> 앞뒤를 붙여 만드시면 가장 확실합니다.',
     '<code>https://&lt;Project ID&gt;.supabase.co</code> 형태입니다. '
     + '<b>INTEGRATIONS → Data API</b> 페이지의 <b>Project URL</b> 을 그대로 복사하셔도 같습니다.'],
  ];

  function openSyncHelp() {
    const { root: box } = modal({
      title: '동기화 준비 (한 번만)',
      wide: true,
      body: `
        <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:14px">
          ${STEPS.map(([h, d]) => `<li><div style="font-weight:700;font-size:14px">${h}</div>
            <div class="tiny muted" style="margin-top:4px">${d}</div></li>`).join('')}
        </ol>
        <div style="margin-top:16px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <b style="font-size:13px">붙여넣을 SQL</b>
            <button class="btn btn--sm" id="syCopy" type="button" style="margin-left:auto">복사</button>
          </div>
          <pre style="margin:0;max-height:240px;overflow:auto;background:var(--bg-sunk);border-radius:12px;padding:12px;font-size:11.5px;line-height:1.5;white-space:pre">${esc(sync.SETUP_SQL)}</pre>
        </div>`,
    });
    box.querySelector('#syCopy').onclick = async (e) => {
      try {
        await navigator.clipboard.writeText(sync.SETUP_SQL);
        e.currentTarget.textContent = '복사됨';
      } catch {
        toast('복사가 막혀 있어요. SQL 을 직접 선택해 복사해 주세요.');
      }
    };
  }

  const noteHTML = (msg, kind = 'dim') => (msg
    ? `<p class="tiny" style="margin-top:10px;color:var(--${kind})">${esc(msg)}</p>` : '');

  function renderSync() {
    const s = store.syncState();
    const st2 = sync.status();
    const pending = store.pendingCount();

    if (!st2.configured) {
      syncBox.innerHTML = `
        <p class="tiny muted" style="margin-bottom:14px">
          PC와 휴대폰이 <b>같은 기록</b>을 보게 하려면 기록을 놓아둘 곳이 하나 필요해요.
          무료 Supabase 프로젝트를 쓰며, 준비는 처음 한 번뿐입니다.
        </p>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${fieldHTML('프로젝트 주소', '<input class="input" id="syUrl" placeholder="https://xxxxxxxx.supabase.co" autocomplete="off">')}
          ${fieldHTML('공개 키 (Publishable 또는 anon)', '<input class="input" id="syKey" placeholder="sb_publishable_... 또는 eyJ... 로 시작하는 키" autocomplete="off">')}
        </div>
        <div class="chips" style="margin-top:14px">
          <button class="btn btn--primary btn--sm" id="syCheck" type="button">연결 확인</button>
          <button class="btn btn--sm" id="syHelp" type="button">준비 방법 보기</button>
        </div>
        <div id="syOut"></div>`;
      syncBox.querySelector('#syHelp').onclick = () => openSyncHelp();
      syncBox.querySelector('#syCheck').onclick = async (e) => {
        const btn = e.currentTarget;
        const url = syncBox.querySelector('#syUrl').value.trim();
        const anonKey = syncBox.querySelector('#syKey').value.trim();
        const out = syncBox.querySelector('#syOut');
        btn.disabled = true;
        out.innerHTML = noteHTML('프로젝트에 연결해 보는 중…', 'text-dim');
        try {
          await sync.testConnection({ url, anonKey });
          await store.saveSyncState({ url: url.replace(/\/+$/, ''), anonKey });
          toast('창고를 찾았어요. 이제 이 창고에서 쓸 계정을 만들면 됩니다.');
          renderSync();
        } catch (err) {
          btn.disabled = false;
          out.innerHTML = noteHTML(`❌ ${err.message}`, 'danger');
        }
      };
      return;
    }

    if (!st2.signedIn) {
      const host = s.url.replace(/^https?:\/\//, '');
      syncBox.innerHTML = `
        <p class="tiny muted" style="margin-bottom:14px">
          <b>${esc(host)}</b> 창고를 쓸 <b>계정을 만드세요.</b>
          Supabase 홈페이지 계정이 아니라, <b>내 창고 안에서만 쓰는 계정</b>이에요.
          이메일과 비밀번호는 새로 정하시면 됩니다 (Supabase 로그인과 같아도 괜찮아요).
          휴대폰에서는 <b>같은 이메일·비밀번호로 로그인</b>하면 이 기기의 기록이 그대로 따라갑니다.
        </p>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${fieldHTML('이메일', `<input class="input" id="syEmail" type="email" value="${esc(s.email)}" autocomplete="username">`)}
          ${fieldHTML('비밀번호', '<input class="input" id="syPw" type="password" autocomplete="current-password">')}
        </div>
        <div class="chips" style="margin-top:14px">
          <button class="btn btn--primary btn--sm" id="syUp" type="button">계정 만들기 (처음이면 이쪽)</button>
          <button class="btn btn--sm" id="syIn" type="button">로그인 (다른 기기에서 이미 만들었다면)</button>
          <button class="btn btn--sm btn--ghost" id="syForget" type="button">주소·키 다시 넣기</button>
        </div>
        <div id="syOut"></div>`;

      const go2 = async (mode, btn) => {
        const out = syncBox.querySelector('#syOut');
        btn.disabled = true;
        out.innerHTML = noteHTML(mode === 'signUp' ? '계정을 만드는 중…' : '로그인하는 중…', 'text-dim');
        try {
          await sync.signIn({
            url: s.url, anonKey: s.anonKey,
            email: syncBox.querySelector('#syEmail').value.trim(),
            password: syncBox.querySelector('#syPw').value,
            mode,
          });
          toast('로그인했어요. 첫 동기화를 시작합니다.');
          renderSync();
          sync.syncNow();
        } catch (err) {
          btn.disabled = false;
          out.innerHTML = noteHTML(`❌ ${err.message}`, 'danger');
        }
      };
      syncBox.querySelector('#syIn').onclick = (e) => go2('signIn', e.currentTarget);
      syncBox.querySelector('#syUp').onclick = (e) => go2('signUp', e.currentTarget);
      syncBox.querySelector('#syForget').onclick = async () => {
        await store.saveSyncState({ url: '', anonKey: '' });
        renderSync();
      };
      return;
    }

    const when = st2.lastSyncAt ? fmtRelative(st2.lastSyncAt) : '아직 없음';
    syncBox.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="badge badge--done">연결됨</span>
        <b style="font-size:14px">${esc(st2.email)}</b>
      </div>
      <p class="tiny faint" style="margin-top:8px">
        마지막 동기화 ${esc(when)}${pending ? ` · 올릴 것 ${nfmt(pending)}건` : ' · 모두 올라감'}
      </p>
      <div class="chips" style="margin-top:14px">
        <button class="btn btn--primary btn--sm" id="syNow" type="button" ${st2.running ? 'disabled' : ''}>
          ${st2.running ? '동기화 중…' : '지금 동기화'}</button>
        <button class="btn btn--sm btn--ghost" id="syOut2" type="button">이 기기에서 로그아웃</button>
      </div>
      ${noteHTML(st2.error ? `❌ ${st2.error}` : '', 'danger')}
      <p class="tiny faint" style="margin-top:10px">
        책·문장·독서기록·연간 목표와 사진이 오갑니다. 테마 같은 화면 설정은 기기마다 따로예요.
      </p>`;

    syncBox.querySelector('#syNow').onclick = async () => {
      const r = await sync.syncNow();
      renderSync();
      if (sync.status().error) return;
      const bits = [];
      if (r.pulled) bits.push(`받은 것 ${r.pulled}건`);
      if (r.pushed) bits.push(`보낸 것 ${r.pushed}건`);
      if (r.photosUp || r.photosDown) bits.push(`사진 ${r.photosUp + r.photosDown}장`);
      toast(bits.length ? `동기화 완료 — ${bits.join(' · ')}` : '이미 최신이에요.');
    };
    syncBox.querySelector('#syOut2').onclick = async () => {
      const ok = await confirmDialog({
        title: '로그아웃',
        message: '이 기기의 기록은 그대로 남아요. 다시 로그인하면 이어서 동기화됩니다.',
        okText: '로그아웃',
      });
      if (!ok) return;
      await sync.signOut();
      renderSync();
    };
  }

  renderSync();
  const offSync = sync.subscribe(() => { if (root.isConnected) { renderSync(); paintWhere(); } });
  // 화면이 사라지면 구독도 거둔다
  new MutationObserver((_, ob) => {
    if (!root.isConnected) { offSync(); ob.disconnect(); }
  }).observe(document.body, { childList: true, subtree: true });

  // 기록이 어디에 있는지는 동기화를 켰는지에 따라 달라진다. 한 곳에서 함께 관리한다.
  const whereText = (linked) => (linked
    ? `기기 간 이동은 위쪽 <b>동기화</b>가 알아서 합니다. 여기 있는 건 <b>되돌릴 지점</b>이에요.
       동기화는 실수까지 그대로 옮기기 때문에 — 잘못 지운 책은 다른 기기와 클라우드에서도 사라집니다 —
       가끔 내보내 두시면 그 시점으로 되살릴 수 있어요.
       되살리기(가져오기)를 하면 다음 동기화 때 다른 기기에도 함께 반영됩니다.`
    : `기록은 지금 <b>이 기기 안에만</b> 있어요.
       다른 기기에서도 같이 보시려면 위쪽 <b>기기 간 동기화</b>를 켜세요.
       아래 내보내기는 <b>되돌릴 지점</b>을 만드는 일입니다 —
       브라우저 데이터를 지우거나 실수로 지웠을 때 파일에서 되살립니다.`);

  const paintWhere = () => {
    root.querySelector('#stWhere').innerHTML = whereText(sync.status().signedIn);
  };
  paintWhere();

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
      downloadBlob(blob, `${APP_NAME}_백업_${ymd()}.json`);
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
        const linked = sync.status().signedIn;
        const ok = await confirmDialog({
          title: '덮어쓰기',
          message: linked
            ? '지금 저장된 모든 기록을 지우고 파일 내용으로 교체해요. '
              + '동기화를 쓰는 중이라 다음 동기화 때 다른 기기와 클라우드에도 그대로 반영됩니다. 되돌릴 수 없습니다.'
            : '지금 저장된 모든 기록을 지우고 파일 내용으로 교체해요. 되돌릴 수 없습니다.',
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
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${APP_NAME}_서재_${ymd()}.csv`);
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
    const linked = sync.status().signedIn;
    const ok = await confirmDialog({
      title: '전체 초기화',
      message: linked
        ? '모든 책, 문장, 독서 기록이 영구히 삭제돼요. 동기화를 쓰는 중이라 '
          + '다른 기기와 클라우드에서도 함께 사라집니다. 먼저 백업을 내보내는 걸 권해요.'
        : '모든 책, 문장, 독서 기록이 영구히 삭제돼요. 먼저 백업을 내보내는 걸 권해요.',
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
