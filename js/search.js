// 외부 도서 검색
//
// 공급자 우선순위: 알라딘(국내서 정확, 쪽수 제공) → 카카오 → Google Books(키 불필요)
// 앞 순위가 실패하면 다음 순위로 자동으로 내려간다. 어느 하나는 항상 동작한다.
//
// 알라딘·카카오는 원래 서버에서 부르는 것을 전제로 만들어진 API라
// 브라우저에서 직접 호출하면 CORS 로 막힐 수 있다. 설정의 '연결 테스트' 로 확인할 수 있다.

import { settings } from './store.js';

/** @typedef {{title,subtitle,authors,publisher,publishedDate,isbn,pageCount,cover,categories,description,link,source}} BookCandidate */

const httpsCover = (u) => (u || '').replace(/^http:\/\//, 'https://');

/* ============================================================
   Google Books
   ============================================================ */
function fromGoogle(item) {
  const v = item.volumeInfo || {};
  const ids = v.industryIdentifiers || [];
  const isbn13 = ids.find((i) => i.type === 'ISBN_13')?.identifier;
  const isbn10 = ids.find((i) => i.type === 'ISBN_10')?.identifier;
  return {
    title: v.title || '(제목 없음)',
    subtitle: v.subtitle || '',
    authors: v.authors || [],
    publisher: v.publisher || '',
    publishedDate: v.publishedDate || '',
    isbn: isbn13 || isbn10 || '',
    pageCount: v.pageCount || 0,
    cover: httpsCover(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || ''),
    categories: v.categories || [],
    description: v.description || '',
    link: v.infoLink || '',
    source: 'google',
  };
}

/* ============================================================
   카카오 책검색
   ============================================================ */
function fromKakao(doc) {
  return {
    title: doc.title || '(제목 없음)',
    subtitle: '',
    authors: doc.authors || [],
    publisher: doc.publisher || '',
    publishedDate: (doc.datetime || '').slice(0, 10),
    isbn: (doc.isbn || '').split(' ').pop() || '',
    pageCount: 0, // 카카오는 쪽수를 제공하지 않는다
    cover: httpsCover(doc.thumbnail || ''),
    categories: [],
    description: doc.contents || '',
    link: doc.url || '',
    source: 'kakao',
  };
}

/* ============================================================
   알라딘 TTB
   ============================================================ */

/** "유발 하라리 (지은이), 조현욱 (옮긴이)" → ["유발 하라리"] (옮긴이·엮은이는 제외) */
function parseAladinAuthors(str) {
  const parts = String(str || '').split(',').map((s) => s.trim()).filter(Boolean);
  const writers = parts.filter((s) => !/\((옮긴이|번역|그림|엮은이|감수|사진)\)/.test(s));
  return (writers.length ? writers : parts).map((s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim());
}

/** 알라딘 표지 주소를 더 큰 판으로 올린다 (규칙이 바뀌면 원본 그대로 쓴다) */
const biggerAladinCover = (u) => httpsCover(u || '').replace('/coversum/', '/cover500/');

function fromAladin(item) {
  return {
    title: (item.title || '(제목 없음)').replace(/^\[[^\]]*\]\s*/, ''),
    subtitle: item.subTitle || '',
    authors: parseAladinAuthors(item.author),
    publisher: item.publisher || '',
    publishedDate: item.pubDate || '',
    isbn: item.isbn13 || item.isbn || '',
    pageCount: Number(item.subInfo?.itemPage) || 0,
    cover: biggerAladinCover(item.cover),
    categories: (item.categoryName || '').split('>').map((s) => s.trim()).filter(Boolean).slice(-2),
    description: item.description || '',
    link: item.link || '',
    source: 'aladin',
  };
}

/* ============================================================
   공통 오류 처리
   ============================================================ */

/**
 * fetch 실패를 사람이 읽을 수 있는 문구로 바꾼다.
 * fetch 는 CORS 차단과 네트워크 장애를 모두 TypeError 로 알려주기 때문에 둘을 구별할 수 없다.
 * 그래서 브라우저 호출을 허용하지 않을 수 있는 공급자(corsLikely)에만 CORS 를 언급한다.
 */
function netError(e, who, corsLikely) {
  if (e.name === 'AbortError') return e;
  if (e instanceof TypeError) {
    if (!navigator.onLine) return new Error('오프라인 상태예요. 아래에서 직접 입력할 수 있어요.');
    return new Error(corsLikely
      ? `${who}에 브라우저에서 직접 연결할 수 없어요 (CORS 차단으로 보입니다).`
      : `${who}에 연결하지 못했어요. 잠시 후 다시 시도하거나 직접 입력해 주세요.`);
  }
  return e;
}

async function getJSON(url, { signal, headers, who, corsLikely = false }) {
  let res;
  try {
    res = await fetch(url, { signal, headers });
  } catch (e) { throw netError(e, who, corsLikely); }

  if (res.status === 401 || res.status === 403) throw new Error(`${who} 키가 올바르지 않습니다.`);
  if (res.status === 429) throw new Error(`${who} 호출 한도를 넘었어요. 잠시 후 다시 시도해 주세요.`);
  if (!res.ok) throw new Error(`${who} 응답 오류 (${res.status})`);
  return res.json();
}

/* ============================================================
   공급자별 검색
   ============================================================ */
async function searchGoogle(query, signal) {
  const json = await getJSON(
    'https://www.googleapis.com/books/v1/volumes?country=KR&maxResults=24&q=' + encodeURIComponent(query),
    { signal, who: 'Google Books' },
  );
  return (json.items || []).map(fromGoogle);
}

async function searchKakao(query, key, signal) {
  const json = await getJSON(
    'https://dapi.kakao.com/v3/search/book?size=24&query=' + encodeURIComponent(query),
    { signal, headers: { Authorization: `KakaoAK ${key}` }, who: '카카오 책검색', corsLikely: true },
  );
  return (json.documents || []).map(fromKakao);
}

export function aladinSearchUrl(query, key) {
  const p = new URLSearchParams({
    ttbkey: key,
    Query: query,
    QueryType: 'Keyword',
    SearchTarget: 'Book',
    MaxResults: '24',
    start: '1',
    Cover: 'Big',
    OptResult: 'packing',   // 쪽수(subInfo.itemPage) 를 함께 받기 위해
    output: 'js',
    Version: '20131101',
  });
  return `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?${p}`;
}

async function searchAladin(query, key, signal) {
  const json = await getJSON(aladinSearchUrl(query, key), { signal, who: '알라딘', corsLikely: true });
  if (json.errorCode) throw new Error(`알라딘 오류: ${json.errorMessage || json.errorCode}`);
  return (json.item || []).map(fromAladin);
}

/* ============================================================
   공개 API
   ============================================================ */

/** 설정에 따라 시도할 공급자 순서 */
function providerChain(st) {
  const chain = [];
  if (st.searchProvider === 'aladin' && st.aladinKey) {
    chain.push({ id: 'aladin', label: '알라딘', run: (q, s) => searchAladin(q, st.aladinKey, s) });
  }
  if (st.searchProvider === 'kakao' && st.kakaoKey) {
    chain.push({ id: 'kakao', label: '카카오 책검색', run: (q, s) => searchKakao(q, st.kakaoKey, s) });
  }
  chain.push({ id: 'google', label: 'Google Books', run: (q, s) => searchGoogle(q, s) });
  return chain;
}

/**
 * 앞 순위부터 시도하고, 실패하면 다음 순위로 내려간다.
 * @returns {Promise<{items: BookCandidate[], provider: string, providerLabel: string, warning?: string}>}
 */
export async function searchBooks(query, { signal } = {}) {
  const q = query.trim();
  if (!q) return { items: [], provider: 'none', providerLabel: '' };

  const chain = providerChain(settings());
  let warning;

  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    try {
      const items = await p.run(q, signal);
      return { items, provider: p.id, providerLabel: p.label, warning };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      const isLast = i === chain.length - 1;
      if (isLast) throw e;
      warning = `${e.message} ${chain[i + 1].label} 결과를 대신 보여드려요.`;
    }
  }
  return { items: [], provider: 'none', providerLabel: '' };
}

/** ISBN 단건 조회 (바코드 스캔용) */
export async function searchByIsbn(isbn, opts = {}) {
  const { items } = await searchBooks(`isbn:${isbn}`, opts);
  if (items.length) return items;
  const { items: loose } = await searchBooks(isbn, opts);
  return loose;
}

/**
 * 설정 화면의 '연결 테스트'.
 * 이 브라우저에서 해당 공급자를 실제로 부를 수 있는지 확인해 결과를 문장으로 돌려준다.
 * @returns {Promise<{ok:boolean, message:string, sample?:string, pageCount?:number}>}
 */
export async function testProvider(providerId, key) {
  const probe = '사피엔스';
  try {
    let items;
    if (providerId === 'aladin') items = await searchAladin(probe, key);
    else if (providerId === 'kakao') items = await searchKakao(probe, key);
    else items = await searchGoogle(probe);

    if (!items.length) {
      return { ok: false, message: '연결은 됐지만 결과가 비어 있어요. 키 권한을 확인해 주세요.' };
    }
    const withPages = items.filter((b) => b.pageCount > 0).length;
    return {
      ok: true,
      message: `연결 성공 · ${items.length}건 (쪽수 있는 결과 ${withPages}건)`,
      sample: items[0].title,
      pageCount: items[0].pageCount,
    };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/** 이 브라우저가 바코드 스캔을 지원하는지 */
export const canScanBarcode = () =>
  'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
