// 앱 상태 저장소 — 메모리 캐시 + IndexedDB 영속화 + 변경 이벤트

import * as db from './db.js';
import { uid, ymd, sum, clamp } from './util.js';

export const STATUS = {
  reading: '읽는 중',
  want:    '읽고 싶은',
  done:    '완독',
  paused:  '잠시 멈춤',
  dropped: '중단',
};
export const STATUS_ORDER = ['reading', 'want', 'done', 'paused', 'dropped'];

/** 이 책이 어디서 왔는지 */
export const ACQUISITION = {
  purchase: { label: '구매', placeLabel: '구매처', ph: '예: 교보문고, 알라딘, 동네서점' },
  borrow:   { label: '대출', placeLabel: '빌린 곳', ph: '예: 시립도서관, 학교도서관' },
};

export const NOTE_TYPES = {
  quote:  { label: '인용', icon: '❝' },
  memo:   { label: '메모', icon: '✎' },
  action: { label: '실천', icon: '✔' },
};

const DEFAULT_SETTINGS = {
  id: 'settings',
  theme: 'auto',            // auto | light | dark
  shelfView: 'grid',        // grid | list
  defaultSort: 'recent',
  searchProvider: 'google', // google | aladin | kakao
  aladinKey: '',
  kakaoKey: '',
  dailyMinutesTarget: 30,
};

const state = {
  books: [],
  notes: [],
  sessions: [],
  meta: [],
  graves: [],
  loaded: false,
};

// 동기화는 '누가 더 나중에 고쳤나'로 판정한다. 모든 쓰기가 이 도장을 찍는다.
// dirty 는 '아직 클라우드에 못 올렸다'는 표시다. 시각만 보고 판단하면
// 방금 내려받은 기록을 도로 올려 보내는 왕복이 생긴다.
const nowIso = () => new Date().toISOString();
const stamp = (obj) => { obj.updatedAt = nowIso(); obj.dirty = true; return obj; };

const listeners = new Set();

/** 변경 구독. 반환값은 구독 해제 함수. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(kind = 'change') {
  for (const fn of listeners) {
    try { fn(kind); } catch (e) { console.error(e); }
  }
}

export async function load() {
  const [books, notes, sessions, meta, graves] = await Promise.all([
    db.getAll('books'), db.getAll('notes'), db.getAll('sessions'),
    db.getAll('meta'), db.getAll('graves'),
  ]);
  state.books = books;
  state.notes = notes;
  state.sessions = sessions;
  state.meta = meta;
  state.graves = graves;
  state.loaded = true;
  emit('load');
}

/* ---------- 조회 ---------- */
export const books    = () => state.books;
export const notes    = () => state.notes;
export const sessions = () => state.sessions;

export const getBook = (id) => state.books.find((b) => b.id === id) || null;
export const notesOf = (bookId) => state.notes.filter((n) => n.bookId === bookId);
export const sessionsOf = (bookId) => state.sessions.filter((s) => s.bookId === bookId);

/* ---------- 설정 ---------- */
export function settings() {
  const s = state.meta.find((m) => m.id === 'settings');
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
export async function saveSettings(patch) {
  const next = stamp({ ...settings(), ...patch, id: 'settings' });
  await db.put('meta', next);
  upsertMeta(next);
  emit('settings');
  return next;
}

/* ---------- 연간 목표 ---------- */
export function goal(year = new Date().getFullYear()) {
  const g = state.meta.find((m) => m.id === `goal:${year}`);
  return g || { id: `goal:${year}`, year, books: 0, pages: 0, minutes: 0 };
}
export async function saveGoal(year, patch) {
  const next = stamp({ ...goal(year), ...patch, id: `goal:${year}`, year });
  await db.put('meta', next);
  upsertMeta(next);
  emit('goal');
  return next;
}
function upsertMeta(obj) {
  const i = state.meta.findIndex((m) => m.id === obj.id);
  if (i >= 0) state.meta[i] = obj; else state.meta.push(obj);
}

/* ---------- 책 ---------- */
export function newBook(data = {}) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: '',
    subtitle: '',
    authors: [],
    publisher: '',
    publishedDate: '',
    isbn: '',
    pageCount: 0,
    cover: '',          // API 가 준 공식 표지 (주소)
    photo: null,        // 내가 찍은 표지 사진 {id, bytes, w, h}
    coverPref: 'photo', // 목록에서 무엇을 보여줄지: 'photo' | 'official'
    categories: [],
    description: '',
    link: '',
    status: 'want',
    rating: 0,
    review: '',
    oneLine: '',
    rereadIntent: false,
    startedAt: '',
    finishedAt: '',
    currentPage: 0,
    tags: [],
    favorite: false,
    acqType: '',        // '' 미지정 | 'purchase' 구매 | 'borrow' 대출
    acqPlace: '',       // 구매처 또는 빌린 곳
    acqDate: '',        // 구매일 / 대출일 (비어 있으면 서재에 담은 날로 본다)
    acqDueDate: '',     // 반납 예정일 (대출일 때만)
    acqReturnedAt: '',  // 반납한 날 (비어 있으면 아직 갖고 있는 것)
    priority: 1,        // 0 낮음 / 1 보통 / 2 높음
    readCount: 0,
    addedAt: now,
    updatedAt: now,
    dirty: true,       // 아직 클라우드에 못 올렸다는 표시
    ...data,
  };
}

export async function addBook(data) {
  const b = newBook(data);
  if (b.status === 'reading' && !b.startedAt) b.startedAt = ymd();
  if (b.status === 'done' && !b.finishedAt) b.finishedAt = ymd();
  state.books.push(b);
  await db.put('books', b);
  emit('books');
  return b;
}

export async function updateBook(id, patch) {
  const b = getBook(id);
  if (!b) return null;
  stamp(Object.assign(b, patch));
  await db.put('books', b);
  emit('books');
  return b;
}

/** 상태 변경 시 시작일/종료일/진도를 함께 정리 */
export async function setStatus(id, status) {
  const b = getBook(id);
  if (!b) return null;
  const patch = { status };
  const today = ymd();
  if (status === 'reading' && !b.startedAt) patch.startedAt = today;
  if (status === 'done') {
    if (!b.startedAt) patch.startedAt = today;
    if (!b.finishedAt) patch.finishedAt = today;
    if (b.pageCount) patch.currentPage = b.pageCount;
    patch.readCount = (b.readCount || 0) + (b.status === 'done' ? 0 : 1);
  }
  if (status !== 'done') patch.finishedAt = '';
  return updateBook(id, patch);
}

export async function removeBook(id) {
  const target = getBook(id);
  const deadNotes = notesOf(id).map((n) => n.id);
  const deadSessions = sessionsOf(id).map((s) => s.id);
  if (target?.photo?.id) await deleteImage(target.photo.id);
  for (const n of notesOf(id)) {
    if (n.photo?.id) await deleteImage(n.photo.id);
  }
  state.books = state.books.filter((b) => b.id !== id);
  state.notes = state.notes.filter((n) => n.bookId !== id);
  state.sessions = state.sessions.filter((s) => s.bookId !== id);
  await db.del('books', id);
  await db.delWhere('notes', (n) => n.bookId === id);
  await db.delWhere('sessions', (s) => s.bookId === id);
  await bury('books', id);
  for (const nid of deadNotes) await bury('notes', nid);
  for (const sid of deadSessions) await bury('sessions', sid);
  emit('books');
}

/** 이미 서재에 있는 책인지 (ISBN 또는 제목+저자) */
export function findDuplicate({ isbn, title, authors = [] }) {
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  return state.books.find((b) => {
    if (isbn && b.isbn && b.isbn === isbn) return true;
    return norm(b.title) === norm(title) && norm(b.authors?.[0]) === norm(authors[0]);
  }) || null;
}

/* ---------- 노트(인용/메모/실천) ---------- */
export async function addNote(data) {
  const n = {
    id: uid(),
    bookId: '',
    type: 'quote',
    text: '',
    comment: '',
    page: null,
    tags: [],
    done: false,
    recallCount: 0,
    lastRecalledAt: '',
    createdAt: nowIso(),
    ...data,
  };
  stamp(n);
  state.notes.push(n);
  await db.put('notes', n);
  emit('notes');
  return n;
}
export async function updateNote(id, patch) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return null;
  stamp(Object.assign(n, patch));
  await db.put('notes', n);
  emit('notes');
  return n;
}
export async function removeNote(id) {
  const target = state.notes.find((n) => n.id === id);
  if (target?.photo?.id) await deleteImage(target.photo.id);
  state.notes = state.notes.filter((n) => n.id !== id);
  await db.del('notes', id);
  await bury('notes', id);
  emit('notes');
}

/* ---------- 독서 세션 ---------- */
export async function addSession(data) {
  const s = {
    id: uid(),
    bookId: '',
    date: ymd(),
    startedAt: nowIso(),
    endedAt: nowIso(),
    minutes: 0,
    startPage: null,
    endPage: null,
    memo: '',
    ...data,
  };
  stamp(s);
  state.sessions.push(s);
  await db.put('sessions', s);

  // 진도/상태 자동 갱신
  const b = getBook(s.bookId);
  if (b) {
    const patch = {};
    if (s.endPage != null && s.endPage > (b.currentPage || 0)) patch.currentPage = s.endPage;
    if (b.status === 'want' || b.status === 'paused') {
      patch.status = 'reading';
      if (!b.startedAt) patch.startedAt = s.date;
    }
    if (b.pageCount && (patch.currentPage ?? b.currentPage) >= b.pageCount && b.status !== 'done') {
      patch.status = 'done';
      patch.finishedAt = s.date;
      patch.currentPage = b.pageCount;
      patch.readCount = (b.readCount || 0) + 1;
    }
    if (Object.keys(patch).length) await updateBook(b.id, patch);
  }
  emit('sessions');
  return s;
}
export async function updateSession(id, patch) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return null;
  stamp(Object.assign(s, patch));
  await db.put('sessions', s);
  emit('sessions');
  return s;
}
export async function removeSession(id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  await db.del('sessions', id);
  await bury('sessions', id);
  emit('sessions');
}

/* ---------- 사진 ---------- */
// 사진은 용량이 커서 메모리에 미리 올리지 않는다. 필요할 때 한 장씩 읽고 캐시한다.
const imageCache = new Map();

/** @returns {Promise<{id:string, bytes:number, w:number, h:number}>} */
export async function saveImage({ dataUrl, bytes, w, h }) {
  // uploaded: 이 기기가 사진을 클라우드에 올렸는지. 올리기 전까지는 여기에만 있다.
  const rec = stamp({ id: uid(), dataUrl, bytes, w, h, createdAt: nowIso(), uploaded: false });
  await db.put('images', rec);
  imageCache.set(rec.id, dataUrl);
  return { id: rec.id, bytes, w, h };
}

/** 화면에 붙일 수 있는 주소(data URL). 없으면 null. */
export async function imageSrc(id) {
  if (!id) return null;
  if (imageCache.has(id)) return imageCache.get(id);
  const rec = await db.get('images', id);
  const src = rec?.dataUrl || null;
  if (src) imageCache.set(id, src);
  return src;
}

export async function deleteImage(id) {
  if (!id) return;
  imageCache.delete(id);
  await db.del('images', id);
  await bury('images', id);
}

/* ---------- 삭제 기록(묘비) ---------- */
// 지운 기록을 그냥 없애면 다른 기기가 그 사실을 모르고 되돌려 보낸다.
// 그래서 '언제 무엇을 지웠는지'만 따로 남긴다.
async function bury(kind, id, { at = nowIso(), dirty = true } = {}) {
  const g = { id: `${kind}:${id}`, kind, recId: id, at, dirty };
  state.graves = state.graves.filter((x) => x.id !== g.id).concat(g);
  await db.put('graves', g);
}
export const graves = () => state.graves;

/** 클라우드에도 반영이 끝난 묘비 — 표시만 지운다 */
export async function clearGrave(id) {
  const g = state.graves.find((x) => x.id === id);
  if (!g || !g.dirty) return;
  g.dirty = false;
  await db.put('graves', { ...g });
}

/** 저장된 사진의 장수와 대략적인 용량 — 목록 데이터만으로 계산한다 */
export function photoUsage() {
  const rows = [
    ...state.books.map((b) => b.photo).filter(Boolean),
    ...state.notes.map((n) => n.photo).filter(Boolean),
  ];
  return { count: rows.length, bytes: sum(rows, (r) => r.bytes || 0) };
}

/** 목록·상세에서 무엇을 표지로 보여줄지 */
export function coverSourceOf(book) {
  if (!book) return null;
  const wantPhoto = (book.coverPref || 'photo') === 'photo';
  if (wantPhoto && book.photo?.id) return { kind: 'image', id: book.photo.id };
  if (book.cover) return { kind: 'url', url: book.cover };
  if (book.photo?.id) return { kind: 'image', id: book.photo.id };
  return null;
}

/* ---------- 파생 계산 ---------- */
export function progressOf(book) {
  if (!book) return 0;
  if (book.status === 'done') return 100;
  if (!book.pageCount) return 0;
  return clamp(Math.round(((book.currentPage || 0) / book.pageCount) * 100), 0, 100);
}

/** 이 책의 분당 페이지 속도(세션 기반). 데이터 없으면 전체 평균으로 대체. */
export function readingSpeed(bookId) {
  const usable = (arr) => arr.filter(
    (s) => s.minutes >= 3 && s.startPage != null && s.endPage != null && s.endPage > s.startPage,
  );
  let rows = usable(sessionsOf(bookId));
  if (rows.length < 2) rows = usable(state.sessions);
  if (!rows.length) return null;
  const pages = sum(rows, (s) => s.endPage - s.startPage);
  const mins  = sum(rows, (s) => s.minutes);
  if (!mins) return null;
  return pages / mins; // pages per minute
}

/** 완독 예상 정보 */
export function forecast(book) {
  if (!book?.pageCount || book.status === 'done') return null;
  const left = Math.max(0, book.pageCount - (book.currentPage || 0));
  if (!left) return null;
  const pps = readingSpeed(book.id);
  if (!pps || pps <= 0) return null;
  const minutesLeft = left / pps;

  // 최근 30일 하루 평균 독서 시간으로 며칠 걸릴지 추정
  const since = new Date(); since.setDate(since.getDate() - 30);
  const recent = state.sessions.filter((s) => new Date(s.date) >= since);
  const perDay = recent.length ? sum(recent, (s) => s.minutes) / 30 : 0;
  const days = perDay > 0 ? Math.ceil(minutesLeft / perDay) : null;

  let date = null;
  if (days != null && days < 3650) {
    const d = new Date(); d.setDate(d.getDate() + days);
    date = d;
  }
  return { pagesLeft: left, minutesLeft: Math.round(minutesLeft), days, date };
}

/** 날짜별 활동 요약 Map<'YYYY-MM-DD', {minutes, pages, sessions, notes, finished}> */
export function activityByDay() {
  const m = new Map();
  const touch = (d) => {
    if (!m.has(d)) m.set(d, { minutes: 0, pages: 0, sessions: 0, notes: 0, finished: 0 });
    return m.get(d);
  };
  for (const s of state.sessions) {
    const a = touch(s.date);
    a.minutes += s.minutes || 0;
    a.sessions += 1;
    if (s.startPage != null && s.endPage != null && s.endPage > s.startPage) {
      a.pages += s.endPage - s.startPage;
    }
  }
  for (const n of state.notes) touch(ymd(new Date(n.createdAt))).notes += 1;
  for (const b of state.books) if (b.finishedAt) touch(b.finishedAt).finished += 1;
  return m;
}

/** 연속 독서일 (오늘 또는 어제까지 이어진 기록) */
export function streak() {
  const act = activityByDay();
  const active = (d) => {
    const a = act.get(ymd(d));
    return !!a && (a.minutes > 0 || a.sessions > 0 || a.notes > 0 || a.finished > 0);
  };
  let cur = 0;
  const start = new Date();
  if (!active(start)) start.setDate(start.getDate() - 1);
  const cursor = new Date(start);
  while (active(cursor)) { cur++; cursor.setDate(cursor.getDate() - 1); }

  // 최장 연속
  const days = [...act.keys()].sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    const a = act.get(d);
    if (!(a.minutes > 0 || a.sessions > 0 || a.notes > 0 || a.finished > 0)) continue;
    if (prev && (new Date(d) - new Date(prev)) === 86400000) run += 1; else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current: cur, best };
}

/* ---------- 자랑거리가 되는 단위 세 가지 ---------- */
// 등록번호 · 킬로페이지 · 부문 분포.
// 권수는 남과 비교하기 어렵지만, 이 셋은 내 서재가 쌓여 가는 모양을 보여 준다.

/** 완독한 순서대로 줄 세운 목록. 번호는 여기서 나온다. */
function accessionOrder() {
  return state.books
    .filter((b) => b.status === 'done' && b.finishedAt)
    // 같은 날 두 권을 끝냈으면 서재에 담은 순서로 가른다 — 기기가 달라도 같은 답이 나와야 한다
    .sort((a, b) => (a.finishedAt !== b.finishedAt
      ? (a.finishedAt < b.finishedAt ? -1 : 1)
      : String(a.addedAt || a.id) < String(b.addedAt || b.id) ? -1 : 1));
}

/**
 * 이 책이 내 서재의 몇 번째 완독인지. 아직 안 끝냈으면 null.
 * 번호를 따로 저장하지 않고 매번 센다 — 기기 두 대가 같은 번호를 각자 발급하는 일을 막는다.
 */
export function accessionNo(book) {
  if (!book || book.status !== 'done' || !book.finishedAt) return null;
  const i = accessionOrder().findIndex((b) => b.id === book.id);
  return i < 0 ? null : i + 1;
}
export const accessionTotal = () => accessionOrder().length;

/** 지금까지 읽은 쪽수 — 완독한 책은 전부, 읽는 중인 책은 지금 쪽까지 */
export function totalPages() {
  return sum(state.books, (b) => (
    b.status === 'done' ? (b.pageCount || b.currentPage || 0) : (b.currentPage || 0)
  ));
}
/** 1,000쪽을 1kp 로 센다 */
export const kilopages = () => totalPages() / 1000;

/** 레이더로 그릴 부문 — 축이 고정돼야 모양을 견줄 수 있다 */
export const GENRES = [
  { key: 'lit',  label: '문학',      kw: ['소설', '시', '희곡', '문학', '고전', '판타지', '추리', '스릴러', 'sf', '로맨스'] },
  { key: 'hum',  label: '인문·사회', kw: ['인문', '철학', '심리', '사회', '정치', '경제', '경영', '교육', '종교'] },
  { key: 'sci',  label: '과학·기술', kw: ['과학', '수학', '기술', '공학', '컴퓨터', 'it', '의학', '자연'] },
  { key: 'life', label: '실용·자기계발', kw: ['자기계발', '실용', '건강', '요리', '취미', '여행', '재테크', '투자'] },
  { key: 'art',  label: '예술·문화', kw: ['예술', '미술', '음악', '사진', '디자인', '건축', '영화', '만화', '문화'] },
  { key: 'hist', label: '역사',      kw: ['역사', '전기', '평전', '고고'] },
];

/** 책의 분류 글자를 여섯 부문 중 하나로 접는다. 아무 데도 안 걸리면 null. */
export function genreOf(book) {
  const text = [...(book.categories || []), ...(book.tags || [])].join(' ').toLowerCase();
  if (!text.trim()) return null;
  for (const g of GENRES) {
    if (g.kw.some((k) => text.includes(k))) return g.key;
  }
  return null;
}

/**
 * 부문별 완독 권수. year 를 주면 그 해만.
 * @returns {{rows: {key,label,value}[], other: number, total: number, thinnest: object|null}}
 */
export function genreBalance({ year = null } = {}) {
  const counts = Object.fromEntries(GENRES.map((g) => [g.key, 0]));
  let other = 0;
  for (const b of state.books) {
    if (b.status !== 'done' || !b.finishedAt) continue;
    if (year && Number(b.finishedAt.slice(0, 4)) !== Number(year)) continue;
    const k = genreOf(b);
    if (k) counts[k] += 1; else other += 1;
  }
  const rows = GENRES.map((g) => ({ key: g.key, label: g.label, value: counts[g.key] }));
  const total = sum(rows, (r) => r.value) + other;
  // 가장 얇은 쪽을 짚어 주면 다음에 무엇을 집을지 정하기 쉬워진다
  const thinnest = total ? rows.reduce((a, r) => (r.value < a.value ? r : a), rows[0]) : null;
  return { rows, other, total, thinnest };
}

/* ---------- 입수 경로 집계 ---------- */

/** 날짜가 비어 있으면 서재에 담은 날을 대신 쓴다 */
export function acquisitionOf(book) {
  return {
    type: book.acqType || '',
    place: (book.acqPlace || '').trim(),
    date: book.acqDate || String(book.addedAt || '').slice(0, 10),
  };
}

/** 서재에 이미 적어 둔 장소들 (입력 자동완성용) */
export function acquisitionPlaces(type) {
  const seen = new Map();
  for (const b of state.books) {
    const a = acquisitionOf(b);
    if (!a.place) continue;
    if (type && a.type !== type) continue;
    seen.set(a.place, (seen.get(a.place) || 0) + 1);
  }
  return [...seen.entries()].sort((x, y) => y[1] - x[1]).map(([place]) => place);
}

/**
 * 반납할 책 목록. 기한이 가까운 순으로 돌려준다.
 * @param {{withinDays?: number}} opts  기한이 이만큼 남은 것까지 포함 (지난 것은 항상 포함)
 * @returns {{book:object, due:string, daysLeft:number, overdue:boolean}[]}
 */
export function loansDue({ withinDays = 7 } = {}) {
  const today = ymd();
  return state.books
    .filter((b) => b.acqType === 'borrow' && b.acqDueDate && !b.acqReturnedAt)
    .map((b) => {
      const daysLeft = Math.round(
        (new Date(`${b.acqDueDate}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000,
      );
      return { book: b, due: b.acqDueDate, daysLeft, overdue: daysLeft < 0 };
    })
    .filter((r) => r.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** 아직 반납하지 않고 갖고 있는 대출 책 수 */
export const loansOut = () =>
  state.books.filter((b) => b.acqType === 'borrow' && !b.acqReturnedAt).length;

/**
 * 구매/대출 통계.
 * @param {{year?: number|null}} opts  year 를 주면 그 해만, 없으면 전체
 */
export function acquisitionSummary({ year = null } = {}) {
  const all = state.books.map(acquisitionOf);
  const inYear = year ? all.filter((a) => a.date.startsWith(String(year))) : all;

  const tally = (rows) => ({
    purchase: rows.filter((a) => a.type === 'purchase').length,
    borrow: rows.filter((a) => a.type === 'borrow').length,
    none: rows.filter((a) => !a.type).length,
    total: rows.length,
  });

  const byPlace = new Map();
  for (const a of inYear) {
    if (!a.type || !a.place) continue;
    const key = `${a.type}\u0000${a.place}`;
    byPlace.set(key, (byPlace.get(key) || 0) + 1);
  }
  const places = [...byPlace.entries()]
    .map(([key, value]) => {
      const [type, place] = key.split('\u0000');
      return { type, place, value };
    })
    .sort((x, y) => y.value - x.value);

  return { period: tally(inYear), lifetime: tally(all), places };
}

/* ---------- 기기 간 동기화 ---------- */
// 무엇을 클라우드에 올릴지: 책·문장·독서기록과 연간 목표까지.
// 기기 설정(테마, 화면 방식)과 로그인 정보는 그 기기의 것이므로 올리지 않는다.
const SYNCED_KINDS = ['books', 'notes', 'sessions', 'meta'];
const syncableMeta = (m) => /^goal:/.test(m.id);

/** 로그인 정보와 동기화 진행 상태 — 이 기기에만 남는다 */
export function syncState() {
  const s = state.meta.find((m) => m.id === 'sync');
  return {
    id: 'sync',
    url: '', anonKey: '', email: '',
    accessToken: '', refreshToken: '', expiresAt: 0, userId: '',
    cursor: '', lastSyncAt: '',
    ...(s || {}),
  };
}
export async function saveSyncState(patch) {
  const next = { ...syncState(), ...patch, id: 'sync' };
  await db.put('meta', next);
  upsertMeta(next);
  emit('sync-state');
  return next;
}

/** 아직 클라우드에 올리지 못한 것들 (삭제 기록 포함) */
export function syncableRecords() {
  const rows = [];
  const add = (kind, r) => {
    if (!r.dirty) return;
    rows.push({
      kind, recId: r.id, deleted: false,
      updatedAt: r.updatedAt || r.addedAt || r.createdAt || '1970-01-01T00:00:00.000Z',
      data: r,
    });
  };
  for (const b of state.books) add('books', b);
  for (const n of state.notes) add('notes', n);
  for (const s of state.sessions) add('sessions', s);
  for (const m of state.meta) if (syncableMeta(m)) add('meta', m);
  for (const g of state.graves) {
    if (g.kind === 'images' || !g.dirty) continue;  // 사진은 보관함에서 따로 지운다
    rows.push({ kind: g.kind, recId: g.recId, deleted: true, updatedAt: g.at, data: null });
  }
  return rows;
}

/** 올리기가 끝난 것들의 '아직 안 올림' 표시를 지운다 */
export async function clearDirty(rows) {
  const byKind = { books: [], notes: [], sessions: [], meta: [] };
  const tombs = [];
  for (const row of rows) {
    if (row.deleted) {
      const g = state.graves.find((x) => x.kind === row.kind && x.recId === row.recId);
      if (g && g.at === row.updatedAt) { g.dirty = false; tombs.push({ ...g }); }
      continue;
    }
    const list = listFor(row.kind);
    const rec = list?.find((r) => r.id === row.recId);
    // 올리는 사이에 또 고쳤다면 그대로 두고 다음 차례에 올린다
    if (!rec || rec.updatedAt !== row.updatedAt) continue;
    rec.dirty = false;
    byKind[row.kind].push(rec);
  }
  for (const kind of SYNCED_KINDS) {
    if (byKind[kind].length) await db.putMany(kind, byKind[kind]);
  }
  if (tombs.length) await db.putMany('graves', tombs);
}

/** 아직 못 올린 건수 — 설정 화면에 보여 준다 */
export function pendingCount() {
  return syncableRecords().length;
}

const listFor = (kind) => (
  kind === 'books' ? state.books
  : kind === 'notes' ? state.notes
  : kind === 'sessions' ? state.sessions
  : kind === 'meta' ? state.meta
  : null
);

/**
 * 클라우드에서 받은 것을 이 기기에 반영한다.
 * 같은 기록이 양쪽에서 바뀌었으면 나중에 고친 쪽이 이긴다.
 * @returns {Promise<number>} 실제로 바뀐 건수
 */
export async function applyRemote(rows) {
  const writes = { books: [], notes: [], sessions: [], meta: [] };
  const drops = [];
  let changed = 0;

  for (const row of rows) {
    const list = listFor(row.kind);
    if (!list) continue;
    if (row.kind === 'meta' && !syncableMeta({ id: row.recId })) continue;

    const mine = list.find((r) => r.id === row.recId);
    const mineAt = mine?.updatedAt || mine?.addedAt || mine?.createdAt || '';
    const buried = state.graves.find((g) => g.kind === row.kind && g.recId === row.recId);

    if (row.deleted) {
      if (!mine) continue;
      if (mineAt && mineAt > row.updatedAt) continue;   // 지운 뒤에 내가 다시 고쳤다
      drops.push({ kind: row.kind, id: row.recId, at: row.updatedAt });
      changed += 1;
      continue;
    }
    if (buried && buried.at > row.updatedAt) continue;  // 내가 지운 게 더 나중이다
    if (mine && mineAt >= row.updatedAt) continue;      // 내 것이 더 새것이거나 같다

    const rec = { ...row.data, id: row.recId, updatedAt: row.updatedAt, dirty: false };
    writes[row.kind].push(rec);
    changed += 1;
  }

  for (const kind of SYNCED_KINDS) {
    if (!writes[kind].length) continue;
    await db.putMany(kind, writes[kind]);
    const list = listFor(kind);
    for (const rec of writes[kind]) {
      const i = list.findIndex((r) => r.id === rec.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
    }
  }
  for (const d of drops) {
    await db.del(d.kind, d.id);
    const list = listFor(d.kind);
    const i = list.findIndex((r) => r.id === d.id);
    if (i >= 0) list.splice(i, 1);
    // 남의 삭제를 받아 적을 때도 묘비는 세운다 — 세 번째 기기에도 전해져야 한다.
    // 시각은 원래 지운 시각 그대로 둔다. 지금 시각을 찍으면 서로 되쏘게 된다.
    await bury(d.kind, d.id, { at: d.at, dirty: false });
  }
  if (changed) emit('sync');
  return changed;
}

/* 사진 — 기록과 달리 보관함(Storage)에 따로 오간다 */
export const imageRecord = (id) => db.get('images', id);

/** 아직 클라우드에 올리지 않은 사진 */
export async function imagesToUpload() {
  const rows = await db.getAll('images');
  return rows.filter((r) => !r.uploaded);
}
export async function markImageUploaded(id) {
  const rec = await db.get('images', id);
  if (!rec) return;
  await db.put('images', { ...rec, uploaded: true });
}
/** 책·문장이 가리키는데 이 기기에 아직 없는 사진 */
export async function missingImageIds() {
  const want = new Set([
    ...state.books.map((b) => b.photo?.id),
    ...state.notes.map((n) => n.photo?.id),
  ].filter(Boolean));
  if (!want.size) return [];
  const have = new Set((await db.getAll('images')).map((r) => r.id));
  return [...want].filter((id) => !have.has(id));
}
export async function putImage(id, { dataUrl, bytes, w, h }) {
  const rec = stamp({ id, dataUrl, bytes, w, h, createdAt: nowIso(), uploaded: true });
  await db.put('images', rec);
  imageCache.set(id, dataUrl);
}

/* ---------- 백업 / 복원 ---------- */
/**
 * 백업 만들기. 사진은 용량이 크므로 포함 여부를 고를 수 있다.
 * @param {{includePhotos?: boolean}} opts
 */
export async function exportData({ includePhotos = true } = {}) {
  const images = [];
  if (includePhotos) {
    const ids = [
      ...state.books.map((b) => b.photo?.id),
      ...state.notes.map((n) => n.photo?.id),
    ].filter(Boolean);
    for (const id of ids) {
      const rec = await db.get('images', id);
      if (rec) images.push(rec);
    }
  }
  return {
    app: 'chaekgalpi',
    version: 2,
    exportedAt: new Date().toISOString(),
    books: state.books,
    notes: state.notes,
    sessions: state.sessions,
    // 로그인 정보는 백업에 넣지 않는다 — 파일이 남에게 가면 곧 계정이 넘어간다
    meta: state.meta.filter((m) => m.id !== 'sync'),
    images,
  };
}

/**
 * @param {object} data  내보내기 JSON
 * @param {'merge'|'replace'} mode
 */
export async function importData(data, mode = 'merge') {
  if (!data || !Array.isArray(data.books)) throw new Error('형식이 올바르지 않은 백업 파일입니다.');

  if (mode === 'replace') await wipeAll();

  const idMap = new Map();
  const bookKey = (b) => (b.isbn || `${b.title}|${(b.authors || [])[0] || ''}`).trim();
  const existing = new Map(state.books.map((b) => [bookKey(b), b]));

  const newBooks = [];
  for (const raw of data.books) {
    const b = { ...newBook(), ...raw };
    const hit = existing.get(bookKey(b));
    if (hit) { idMap.set(b.id, hit.id); continue; }
    const fresh = { ...b, id: uid() };
    idMap.set(b.id, fresh.id);
    newBooks.push(fresh);
    existing.set(bookKey(fresh), fresh);
  }

  const seenNotes = new Set(state.notes.map((n) => `${n.bookId}|${n.text}|${n.page}`));
  const newNotes = [];
  for (const raw of data.notes || []) {
    const bookId = idMap.get(raw.bookId) || raw.bookId;
    const k = `${bookId}|${raw.text}|${raw.page}`;
    if (seenNotes.has(k)) continue;
    seenNotes.add(k);
    newNotes.push({ ...raw, id: uid(), bookId });
  }

  const seenSess = new Set(state.sessions.map((s) => `${s.bookId}|${s.startedAt}`));
  const newSessions = [];
  for (const raw of data.sessions || []) {
    const bookId = idMap.get(raw.bookId) || raw.bookId;
    const k = `${bookId}|${raw.startedAt}`;
    if (seenSess.has(k)) continue;
    seenSess.add(k);
    newSessions.push({ ...raw, id: uid(), bookId });
  }

  const newMeta = (data.meta || []).filter(
    (m) => mode === 'replace' || !state.meta.some((x) => x.id === m.id),
  );

  // 사진 복원 — id 를 새로 발급하고, 이를 참조하는 책/노트를 함께 고쳐준다
  const imgMap = new Map();
  const newImages = [];
  for (const raw of data.images || []) {
    if (!raw?.dataUrl) continue;
    const fresh = { ...raw, id: uid() };
    imgMap.set(raw.id, fresh.id);
    newImages.push(fresh);
  }
  const relink = (rec) => {
    if (rec.photo?.id && imgMap.has(rec.photo.id)) rec.photo = { ...rec.photo, id: imgMap.get(rec.photo.id) };
    else if (rec.photo?.id && !imgMap.has(rec.photo.id)) rec.photo = null;  // 사진 없이 내보낸 백업
    return rec;
  };
  newBooks.forEach(relink);
  newNotes.forEach(relink);
  // 가져온 것도 '방금 바뀐 기록'이어야 다음 동기화 때 다른 기기로 넘어간다
  [...newBooks, ...newNotes, ...newSessions, ...newMeta].forEach(stamp);
  await db.putMany('images', newImages);

  await db.putMany('books', newBooks);
  await db.putMany('notes', newNotes);
  await db.putMany('sessions', newSessions);
  await db.putMany('meta', newMeta);

  state.books.push(...newBooks);
  state.notes.push(...newNotes);
  state.sessions.push(...newSessions);
  state.meta.push(...newMeta);

  emit('import');
  return {
    books: newBooks.length, notes: newNotes.length,
    sessions: newSessions.length, images: newImages.length,
  };
}

/**
 * 서재를 비운다. 초기화와 '덮어쓰기 가져오기'가 함께 쓴다.
 *
 * 그냥 지우면 두 가지가 잘못된다.
 *  - 로그인 정보까지 날아가 조용히 로그아웃된다 (백업 파일에는 로그인 정보가 없다)
 *  - 지웠다는 사실이 안 남아, 클라우드의 옛 기록이 다음 동기화 때 도로 내려온다
 */
async function wipeAll() {
  const tombs = [
    ...state.books.map((b) => ({ kind: 'books', id: b.id })),
    ...state.notes.map((n) => ({ kind: 'notes', id: n.id })),
    ...state.sessions.map((s) => ({ kind: 'sessions', id: s.id })),
    ...state.meta.filter(syncableMeta).map((m) => ({ kind: 'meta', id: m.id })),
  ];
  const keepSync = state.meta.find((m) => m.id === 'sync');

  await db.clearAll();
  imageCache.clear();
  state.books = []; state.notes = []; state.sessions = []; state.meta = []; state.graves = [];

  if (keepSync) { await db.put('meta', keepSync); upsertMeta(keepSync); }
  for (const t of tombs) await bury(t.kind, t.id);
}

export async function resetAll() {
  await wipeAll();
  emit('reset');
}
