// IndexedDB 얇은 래퍼 — 저장소: books / notes / sessions / meta
// 브라우저가 IndexedDB를 막아둔 경우(사파리 프라이빗 등) localStorage로 자동 폴백한다.

const DB_NAME = 'chaekgalpi';
const DB_VER  = 1;
const STORES  = ['books', 'notes', 'sessions', 'meta'];

let dbp = null;
let fallback = false;

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VER);
    } catch (e) {
      return reject(e);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          const os = db.createObjectStore(s, { keyPath: 'id' });
          if (s === 'notes' || s === 'sessions') os.createIndex('bookId', 'bookId');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  }).catch((e) => {
    console.warn('[db] IndexedDB 사용 불가 → localStorage 폴백', e);
    fallback = true;
    return null;
  });
  return dbp;
}

/* ---------- localStorage 폴백 ---------- */
const lsKey = (store) => `chaekgalpi:${store}`;
const lsAll = (store) => {
  try { return JSON.parse(localStorage.getItem(lsKey(store)) || '[]'); }
  catch { return []; }
};
const lsWrite = (store, rows) => {
  try { localStorage.setItem(lsKey(store), JSON.stringify(rows)); }
  catch (e) { console.error('[db] localStorage 저장 실패', e); throw e; }
};

/* ---------- 공개 API ---------- */
export async function getAll(store) {
  const db = await openDB();
  if (!db || fallback) return lsAll(store);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, value) {
  const db = await openDB();
  if (!db || fallback) {
    const rows = lsAll(store);
    const i = rows.findIndex((r) => r.id === value.id);
    if (i >= 0) rows[i] = value; else rows.push(value);
    lsWrite(store, rows);
    return value;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

export async function putMany(store, values) {
  if (!values.length) return;
  const db = await openDB();
  if (!db || fallback) {
    const rows = lsAll(store);
    for (const v of values) {
      const i = rows.findIndex((r) => r.id === v.id);
      if (i >= 0) rows[i] = v; else rows.push(v);
    }
    lsWrite(store, rows);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const v of values) os.put(v);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function del(store, id) {
  const db = await openDB();
  if (!db || fallback) {
    lsWrite(store, lsAll(store).filter((r) => r.id !== id));
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function delWhere(store, pred) {
  const rows = await getAll(store);
  const targets = rows.filter(pred);
  for (const r of targets) await del(store, r.id);
  return targets.length;
}

export async function clearAll() {
  const db = await openDB();
  if (!db || fallback) {
    for (const s of STORES) lsWrite(s, []);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    for (const s of STORES) tx.objectStore(s).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
