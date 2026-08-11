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
  loaded: false,
};

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
  const [books, notes, sessions, meta] = await Promise.all([
    db.getAll('books'), db.getAll('notes'), db.getAll('sessions'), db.getAll('meta'),
  ]);
  state.books = books;
  state.notes = notes;
  state.sessions = sessions;
  state.meta = meta;
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
  const next = { ...settings(), ...patch, id: 'settings' };
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
  const next = { ...goal(year), ...patch, id: `goal:${year}`, year };
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
    priority: 1,        // 0 낮음 / 1 보통 / 2 높음
    readCount: 0,
    addedAt: now,
    updatedAt: now,
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
  Object.assign(b, patch, { updatedAt: new Date().toISOString() });
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
    createdAt: new Date().toISOString(),
    ...data,
  };
  state.notes.push(n);
  await db.put('notes', n);
  emit('notes');
  return n;
}
export async function updateNote(id, patch) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return null;
  Object.assign(n, patch);
  await db.put('notes', n);
  emit('notes');
  return n;
}
export async function removeNote(id) {
  const target = state.notes.find((n) => n.id === id);
  if (target?.photo?.id) await deleteImage(target.photo.id);
  state.notes = state.notes.filter((n) => n.id !== id);
  await db.del('notes', id);
  emit('notes');
}

/* ---------- 독서 세션 ---------- */
export async function addSession(data) {
  const s = {
    id: uid(),
    bookId: '',
    date: ymd(),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    minutes: 0,
    startPage: null,
    endPage: null,
    memo: '',
    ...data,
  };
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
  Object.assign(s, patch);
  await db.put('sessions', s);
  emit('sessions');
  return s;
}
export async function removeSession(id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  await db.del('sessions', id);
  emit('sessions');
}

/* ---------- 사진 ---------- */
// 사진은 용량이 커서 메모리에 미리 올리지 않는다. 필요할 때 한 장씩 읽고 캐시한다.
const imageCache = new Map();

/** @returns {Promise<{id:string, bytes:number, w:number, h:number}>} */
export async function saveImage({ dataUrl, bytes, w, h }) {
  const rec = { id: uid(), dataUrl, bytes, w, h, createdAt: new Date().toISOString() };
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
    meta: state.meta,
    images,
  };
}

/**
 * @param {object} data  내보내기 JSON
 * @param {'merge'|'replace'} mode
 */
export async function importData(data, mode = 'merge') {
  if (!data || !Array.isArray(data.books)) throw new Error('형식이 올바르지 않은 백업 파일입니다.');

  if (mode === 'replace') {
    await db.clearAll();
    state.books = []; state.notes = []; state.sessions = []; state.meta = [];
  }

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

export async function resetAll() {
  await db.clearAll();
  imageCache.clear();
  state.books = []; state.notes = []; state.sessions = []; state.meta = [];
  emit('reset');
}
