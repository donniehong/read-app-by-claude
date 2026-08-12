// IndexedDB 얇은 래퍼 — 저장소: books / notes / sessions / meta / images / graves
// 브라우저가 IndexedDB를 막아둔 경우(사파리 프라이빗 등) localStorage로 자동 폴백한다.
//
// graves 는 '지웠다'는 사실만 남기는 묘비다. 지운 기록을 그냥 없애 버리면
// 다른 기기가 그 사실을 알 길이 없어, 동기화할 때 지운 책이 되살아난다.

const DB_NAME = 'chaekgalpi';
const DB_VER  = 3;
const STORES  = ['books', 'notes', 'sessions', 'meta', 'images', 'graves'];

let dbp = null;
let fallback = false;

/** 저장소에 문제가 생겼을 때 사람에게 알릴 통로 */
let trouble = null;
export function onTrouble(fn) { trouble = fn; }
const warn = (msg) => { console.warn('[db]', msg); trouble?.(msg); };

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
    req.onsuccess = () => {
      // 다른 탭이 더 새 버전으로 열리면 이 연결을 놓아 줘야 그쪽이 갱신할 수 있다
      req.result.onversionchange = () => {
        req.result.close();
        dbp = null;
        warn('앱이 새 버전으로 바뀌었어요. 이 탭을 새로고침해 주세요.');
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    // 다른 탭이 옛 버전을 붙들고 있으면 갱신이 막힌다.
    // 여기서 포기하고 localStorage 로 갈아타면 서재가 텅 빈 것처럼 보인다 —
    // 기록은 IndexedDB 에 멀쩡히 있는데 엉뚱한 곳을 들여다보는 셈이다.
    // 그래서 기다린다. 저쪽 탭이 닫히는 순간 onsuccess 로 이어진다.
    req.onblocked = () => warn(
      '이 앱이 열린 다른 탭이 있어 저장소를 준비하지 못하고 있어요. '
      + '다른 탭을 닫으면 이어서 진행됩니다.',
    );
  }).catch((e) => {
    warn(`이 브라우저에서 IndexedDB 를 쓸 수 없어 임시 저장소로 넘어갑니다 (${e?.name || e}).`);
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
/** 단건 조회 — 사진처럼 전부 메모리에 올리면 안 되는 데이터에 쓴다 */
export async function get(store, id) {
  const db = await openDB();
  if (!db || fallback) return lsAll(store).find((r) => r.id === id) || null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

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
