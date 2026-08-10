// 외부 도서 검색 — Google Books(키 불필요, 기본) / 카카오 책검색(REST 키 필요, 국내서 정확)

import { settings } from './store.js';

/** @typedef {{title,subtitle,authors,publisher,publishedDate,isbn,pageCount,cover,categories,description,link,source}} BookCandidate */

const httpsCover = (u) => (u || '').replace(/^http:\/\//, 'https://');

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

function fromKakao(doc) {
  return {
    title: doc.title || '(제목 없음)',
    subtitle: '',
    authors: doc.authors || [],
    publisher: doc.publisher || '',
    publishedDate: (doc.datetime || '').slice(0, 10),
    isbn: (doc.isbn || '').split(' ').pop() || '',
    pageCount: 0, // 카카오는 페이지 수를 제공하지 않는다
    cover: httpsCover(doc.thumbnail || ''),
    categories: doc.translators?.length ? [] : [],
    description: doc.contents || '',
    link: doc.url || '',
    source: 'kakao',
  };
}

/** 네트워크 자체가 끊긴 경우와 응답 오류를 구분해 사람이 읽을 수 있는 메시지로 바꾼다 */
function netError(e) {
  if (e.name === 'AbortError') return e;
  if (e instanceof TypeError) {
    return new Error(navigator.onLine
      ? '검색 서버에 연결하지 못했어요. 잠시 후 다시 시도하거나 직접 입력해 주세요.'
      : '오프라인 상태예요. 아래에서 직접 입력할 수 있어요.');
  }
  return e;
}

async function searchGoogle(query, signal) {
  const url = 'https://www.googleapis.com/books/v1/volumes?country=KR&maxResults=24&q='
    + encodeURIComponent(query);
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (e) { throw netError(e); }

  if (res.status === 429) {
    throw new Error('오늘 Google Books 검색 한도를 넘었어요. 잠시 후 다시 시도하거나 직접 입력해 주세요.');
  }
  if (!res.ok) throw new Error(`Google Books 응답 오류 (${res.status})`);
  const json = await res.json();
  return (json.items || []).map(fromGoogle);
}

async function searchKakao(query, key, signal) {
  const url = 'https://dapi.kakao.com/v3/search/book?size=24&query=' + encodeURIComponent(query);
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal });
  } catch (e) { throw netError(e); }

  if (res.status === 401) throw new Error('카카오 REST API 키가 올바르지 않습니다.');
  if (res.status === 429) throw new Error('카카오 검색 한도를 넘었어요.');
  if (!res.ok) throw new Error(`카카오 응답 오류 (${res.status})`);
  const json = await res.json();
  return (json.documents || []).map(fromKakao);
}

/**
 * 설정된 공급자로 검색하고, 실패하면 Google Books로 폴백한다.
 * @returns {Promise<{items: BookCandidate[], provider: string, warning?: string}>}
 */
export async function searchBooks(query, { signal } = {}) {
  const q = query.trim();
  if (!q) return { items: [], provider: 'none' };

  const st = settings();
  if (st.searchProvider === 'kakao' && st.kakaoKey) {
    try {
      return { items: await searchKakao(q, st.kakaoKey, signal), provider: 'kakao' };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      const items = await searchGoogle(q, signal);
      return { items, provider: 'google', warning: `${e.message} Google Books 결과를 대신 표시합니다.` };
    }
  }
  return { items: await searchGoogle(q, signal), provider: 'google' };
}

/** ISBN 단건 조회 (바코드 스캔용) */
export async function searchByIsbn(isbn, opts = {}) {
  const { items } = await searchBooks(`isbn:${isbn}`, opts);
  if (items.length) return items;
  const { items: loose } = await searchBooks(isbn, opts);
  return loose;
}

/** 이 브라우저가 바코드 스캔을 지원하는지 */
export const canScanBarcode = () =>
  'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
