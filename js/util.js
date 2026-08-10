// 공용 유틸리티

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- DOM ---------- */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** HTML 문자열 → Element */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** 텍스트를 HTML에 안전하게 삽입 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 이벤트 위임 */
export function on(root, evt, sel, fn) {
  root.addEventListener(evt, (e) => {
    const t = e.target.closest(sel);
    if (t && root.contains(t)) fn(e, t);
  });
}

export function debounce(fn, ms = 300) {
  let h;
  return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
}

/* ---------- 날짜 ---------- */
/** Date → 'YYYY-MM-DD' (로컬 기준) */
export function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}
export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function daysBetween(a, b) {
  const A = new Date(a), B = new Date(b);
  A.setHours(0, 0, 0, 0); B.setHours(0, 0, 0, 0);
  return Math.round((B - A) / 86400000);
}
export function startOfWeek(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // 일요일 시작
  return x;
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const weekdayKo = (d) => WD[new Date(d).getDay()];

/** 사람이 읽는 날짜 */
export function fmtDate(v, { withYear = true, weekday = false } = {}) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(+d)) return '';
  const now = new Date();
  const s = withYear && d.getFullYear() !== now.getFullYear()
    ? `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
    : `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return weekday ? `${s} (${weekdayKo(d)})` : s;
}

/** 상대 시간 */
export function fmtRelative(v) {
  const diff = daysBetween(v, new Date());
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  if (diff === 2) return '그저께';
  if (diff > 0 && diff < 7) return `${diff}일 전`;
  return fmtDate(v);
}

/** 분 → '1시간 20분' */
export function fmtMinutes(min) {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}

/** 초 → 'HH:MM:SS' */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export const nfmt = (n) => Number(n || 0).toLocaleString('ko-KR');

/* ---------- 기타 ---------- */
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + (f(b) || 0), 0);

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

/** 날짜 문자열을 시드로 쓰는 결정론적 난수 (0~1) */
export function seededRandom(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = '.json') {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files?.[0] || null);
    i.click();
  });
}
