// 기기 간 동기화 — Supabase 를 창고로 쓴다.
//
// 규칙은 하나다: 같은 기록이 양쪽에서 바뀌었으면 나중에 고친 쪽이 이긴다.
// 기록(책·문장·독서기록·목표)은 records 표에, 사진은 보관함(Storage)에 오간다.
//
// SDK 를 쓰지 않고 fetch 로 직접 부른다. 빌드 도구 없이 굴러가야 하고,
// 우리가 쓰는 기능이 네 가지뿐이라 라이브러리를 들일 이유가 없다.

import * as store from './store.js';
import { APP_NAME } from './brand.js';

const BUCKET = 'photos';
const PAGE = 500;

/** Supabase 프로젝트에서 한 번만 실행하면 되는 준비용 SQL */
export const SETUP_SQL = `-- ${APP_NAME} 동기화 준비 (한 번만 실행하면 됩니다)

create table if not exists public.records (
  user_id    uuid        not null references auth.users on delete cascade,
  kind       text        not null,
  rec_id     text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null,
  server_at  timestamptz not null default now(),
  primary key (user_id, kind, rec_id)
);

create index if not exists records_sync_idx on public.records (user_id, server_at);

-- 도착 순서는 서버가 직접 찍는다. 기기 시계가 틀려도 빠뜨리지 않기 위해서다.
create or replace function public.records_stamp() returns trigger
language plpgsql as $$
begin
  new.server_at := now();
  return new;
end $$;

drop trigger if exists records_stamp on public.records;
create trigger records_stamp before insert or update on public.records
  for each row execute function public.records_stamp();

-- 내 기록은 나만 보고 나만 고친다
alter table public.records enable row level security;
drop policy if exists "own records" on public.records;
create policy "own records" on public.records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 사진 보관함 (비공개)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "own photos" on storage.objects;
create policy "own photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
`;

/* ---------- 상태 ---------- */
let running = false;
let queued = false;
let lastError = '';
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) {
    try { fn(status()); } catch (e) { console.error(e); }
  }
}

export function status() {
  const s = store.syncState();
  return {
    configured: !!(s.url && s.anonKey),
    signedIn: !!s.accessToken,
    email: s.email,
    lastSyncAt: s.lastSyncAt,
    running,
    error: lastError,
  };
}

/* ---------- 통신 기본 ---------- */
const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

/** 사람이 읽을 수 있는 실패 메시지로 바꾼다 */
async function explain(res, fallback) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.message || body?.msg || body?.error_description || body?.error || body?.hint || '';
  } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
  if (res.status === 401 || res.status === 403) {
    return detail || '권한이 없습니다. 다시 로그인해 주세요.';
  }
  if (res.status === 404) return detail || '주소를 찾을 수 없습니다. 준비용 SQL 을 실행했는지 확인해 주세요.';
  return detail ? `${fallback} (${detail})` : `${fallback} (HTTP ${res.status})`;
}

function netMessage(e) {
  if (e instanceof TypeError) {
    return '연결하지 못했습니다. 인터넷 상태와 프로젝트 주소를 확인해 주세요.';
  }
  return e.message || '알 수 없는 오류';
}

/* ---------- 로그인 ---------- */
async function authFetch(url, anonKey, path, body) {
  const res = await fetch(`${trimUrl(url)}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await explain(res, '로그인에 실패했습니다'));
  return res.json();
}

function tokenPatch(json) {
  return {
    accessToken: json.access_token || '',
    refreshToken: json.refresh_token || '',
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
    userId: json.user?.id || '',
    email: json.user?.email || '',
  };
}

/**
 * @param {{url:string, anonKey:string, email:string, password:string, mode:'signIn'|'signUp'}} p
 */
export async function signIn({ url, anonKey, email, password, mode = 'signIn' }) {
  const u = trimUrl(url);
  if (!u || !anonKey) throw new Error('프로젝트 주소와 키를 먼저 넣어 주세요.');
  if (!email || !password) throw new Error('이메일과 비밀번호를 넣어 주세요.');

  let json;
  try {
    json = mode === 'signUp'
      ? await authFetch(u, anonKey, 'signup', { email, password })
      : await authFetch(u, anonKey, 'token?grant_type=password', { email, password });
  } catch (e) {
    throw new Error(netMessage(e));
  }
  if (!json.access_token) {
    // 가입 확인 메일을 켜 둔 프로젝트는 토큰 없이 사용자만 만들어 준다
    throw new Error('계정은 만들어졌지만 바로 로그인되지 않았습니다. 메일함의 확인 링크를 누른 뒤 로그인해 주세요.');
  }
  await store.saveSyncState({ url: u, anonKey, ...tokenPatch(json) });
  lastError = '';
  emit();
  return status();
}

export async function signOut() {
  await store.saveSyncState({
    accessToken: '', refreshToken: '', expiresAt: 0, userId: '', cursor: '', lastSyncAt: '',
  });
  lastError = '';
  emit();
}

/** 만료가 가까우면 조용히 갱신한다 */
async function freshToken() {
  const s = store.syncState();
  if (!s.accessToken) throw new Error('로그인이 필요합니다.');
  if (s.expiresAt - 60_000 > Date.now()) return s;

  const json = await authFetch(s.url, s.anonKey, 'token?grant_type=refresh_token', {
    refresh_token: s.refreshToken,
  });
  return store.saveSyncState(tokenPatch(json));
}

const headersOf = (s, extra = {}) => ({
  apikey: s.anonKey,
  authorization: `Bearer ${s.accessToken}`,
  ...extra,
});

/* ---------- 기록 주고받기 ---------- */
async function pull(s) {
  let cursor = s.cursor || '1970-01-01T00:00:00Z';
  let total = 0;

  for (;;) {
    const q = new URLSearchParams({
      select: 'kind,rec_id,data,deleted,updated_at,server_at',
      server_at: `gt.${cursor}`,
      order: 'server_at.asc',
      limit: String(PAGE),
    });
    const res = await fetch(`${s.url}/rest/v1/records?${q}`, { headers: headersOf(s) });
    if (!res.ok) throw new Error(await explain(res, '내려받기에 실패했습니다'));
    const rows = await res.json();
    if (!rows.length) break;

    await store.applyRemote(rows.map((r) => ({
      kind: r.kind, recId: r.rec_id, data: r.data, deleted: !!r.deleted, updatedAt: r.updated_at,
    })));
    total += rows.length;
    cursor = rows[rows.length - 1].server_at;
    if (rows.length < PAGE) break;
  }
  return { cursor, count: total };
}

async function push(s) {
  const rows = store.syncableRecords();
  if (!rows.length) return { count: 0 };

  const payload = rows.map((r) => {
    // dirty 는 이 기기의 사정이다. 클라우드까지 들고 갈 이유가 없다.
    const { dirty, ...data } = r.data || {};
    return {
      user_id: s.userId,
      kind: r.kind,
      rec_id: r.recId,
      data: r.deleted ? null : data,
      deleted: r.deleted,
      updated_at: r.updatedAt,
    };
  });

  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200);
    const res = await fetch(`${s.url}/rest/v1/records?on_conflict=user_id,kind,rec_id`, {
      method: 'POST',
      headers: headersOf(s, {
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(await explain(res, '올리기에 실패했습니다'));
  }

  await store.clearDirty(rows);
  return { count: rows.length };
}

/* ---------- 사진 주고받기 ---------- */
const objectUrl = (s, id) => `${s.url}/storage/v1/object/${BUCKET}/${s.userId}/${id}`;

const toBlob = (dataUrl) => fetch(dataUrl).then((r) => r.blob());
const toDataUrl = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

async function pushPhotos(s) {
  const pending = await store.imagesToUpload();
  let n = 0;
  for (const rec of pending) {
    const blob = await toBlob(rec.dataUrl);
    const res = await fetch(objectUrl(s, rec.id), {
      method: 'POST',
      headers: headersOf(s, { 'content-type': blob.type || 'image/jpeg', 'x-upsert': 'true' }),
      body: blob,
    });
    if (!res.ok) throw new Error(await explain(res, '사진을 올리지 못했습니다'));
    await store.markImageUploaded(rec.id);
    n += 1;
  }
  return n;
}

async function pullPhotos(s) {
  const ids = await store.missingImageIds();
  if (!ids.length) return 0;

  // 크기 정보는 사진을 가리키는 책·문장이 들고 있다
  const meta = new Map();
  for (const b of store.books()) if (b.photo?.id) meta.set(b.photo.id, b.photo);
  for (const nt of store.notes()) if (nt.photo?.id) meta.set(nt.photo.id, nt.photo);

  let n = 0;
  for (const id of ids) {
    const res = await fetch(objectUrl(s, id), { headers: headersOf(s) });
    // 아직 저쪽 기기가 못 올렸을 수 있다. 그건 실패가 아니라 '다음에 다시'다.
    if (res.status === 404 || res.status === 400) continue;
    if (!res.ok) throw new Error(await explain(res, '사진을 내려받지 못했습니다'));
    const blob = await res.blob();
    const info = meta.get(id) || {};
    await store.putImage(id, {
      dataUrl: await toDataUrl(blob),
      bytes: blob.size || info.bytes || 0,
      w: info.w || 0,
      h: info.h || 0,
    });
    n += 1;
  }
  return n;
}

async function dropRemotePhotos(s) {
  const dead = store.graves().filter((g) => g.kind === 'images' && g.dirty);
  for (const g of dead) {
    try {
      await fetch(objectUrl(s, g.recId), { method: 'DELETE', headers: headersOf(s) });
      await store.clearGrave(g.id);
    } catch { /* 지우기는 실패해도 동기화를 멈추지 않는다 */ }
  }
}

/* ---------- 한 번 돌리기 ---------- */
export async function syncNow() {
  if (!status().signedIn) return { skipped: '로그인이 필요합니다.' };
  if (running) { queued = true; return { skipped: '이미 동기화 중' }; }

  running = true;
  lastError = '';
  emit();
  const result = { pulled: 0, pushed: 0, photosUp: 0, photosDown: 0 };
  try {
    let s = await freshToken();

    // 올리기 → 내려받기 순서. 내 변경이 먼저 서버에 닿아야
    // 같은 기록을 두 기기가 건드렸을 때 판정이 한 번에 끝난다.
    const up = await push(s);
    result.pushed = up.count;

    const down = await pull(s);
    result.pulled = down.count;

    result.photosUp = await pushPhotos(s);
    result.photosDown = await pullPhotos(s);
    await dropRemotePhotos(s);

    await store.saveSyncState({ cursor: down.cursor, lastSyncAt: new Date().toISOString() });
  } catch (e) {
    lastError = netMessage(e);
    console.warn('[sync]', e);
  } finally {
    running = false;
    emit();
  }
  if (queued) { queued = false; setTimeout(syncNow, 500); }
  return result;
}

/**
 * 넣으면 안 되는 키인지 알아본다.
 * Secret · service_role 키는 모든 잠금을 무시하므로, 브라우저에 들어가면
 * 주소를 아는 누구나 내 기록을 읽고 지울 수 있다. 실수 한 번에 프로젝트가 열린다.
 * @returns {string} 문제가 있으면 사람이 읽을 메시지, 없으면 빈 문자열
 */
export function keyProblem(key) {
  const k = String(key || '').trim();
  if (/^sb_secret_/i.test(k)) {
    return '비밀 키(sb_secret_…)를 넣으셨습니다. 이 키는 모든 잠금을 무시하니 브라우저에 넣으면 안 됩니다. '
      + '공개 키(Publishable 또는 anon)를 넣어 주세요.';
  }
  // 예전 방식의 키는 JWT 라서 역할이 안에 적혀 있다
  const m = /^eyJ[\w-]*\.([\w-]+)\./.exec(k);
  if (m) {
    try {
      const body = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (body.role && body.role !== 'anon') {
        return `${body.role} 키를 넣으셨습니다. 이 키는 모든 잠금을 무시하니 브라우저에 넣으면 안 됩니다. `
          + 'anon(public) 키를 넣어 주세요.';
      }
    } catch { /* 우리가 못 읽는 형식이면 판단하지 않는다 */ }
  }
  return '';
}

/** 설정을 저장하기 전에 주소와 키가 맞는지만 두들겨 본다 */
export async function testConnection({ url, anonKey }) {
  const u = trimUrl(url);
  if (!u || !anonKey) throw new Error('프로젝트 주소와 키를 모두 넣어 주세요.');
  // 로그인 토큰이 오가므로 암호화되지 않은 주소는 막는다.
  // 내 컴퓨터에 직접 띄운 Supabase 만 예외로 둔다.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u);
  if (!local && !/^https:\/\//.test(u)) {
    throw new Error('프로젝트 주소는 https:// 로 시작해야 합니다.');
  }
  const bad = keyProblem(anonKey);
  if (bad) throw new Error(bad);
  let res;
  try {
    res = await fetch(`${u}/auth/v1/settings`, { headers: { apikey: anonKey } });
  } catch (e) {
    throw new Error(netMessage(e));
  }
  if (res.status === 401) throw new Error('키가 맞지 않습니다. anon public 키를 넣었는지 확인해 주세요.');
  if (!res.ok) throw new Error(await explain(res, '프로젝트에 닿지 못했습니다'));
  return true;
}

/* ---------- 자동으로 돌리기 ---------- */
let timer = null;
let idle = null;

export function start() {
  const kick = (delay) => {
    clearTimeout(idle);
    idle = setTimeout(() => { if (status().signedIn) syncNow(); }, delay);
  };

  // 기록이 바뀌면 잠시 뒤 한 번. 연달아 고치는 동안은 미뤄 둔다.
  store.subscribe((kind) => {
    if (kind === 'sync' || kind === 'sync-state' || kind === 'load') return;
    kick(4000);
  });

  addEventListener('online', () => kick(1000));
  addEventListener('focus', () => kick(1500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick(1500);
  });

  clearInterval(timer);
  timer = setInterval(() => { if (status().signedIn && navigator.onLine !== false) syncNow(); }, 90_000);

  if (status().signedIn) kick(800);
}
