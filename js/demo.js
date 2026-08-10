// 샘플 데이터 — 처음 둘러볼 때 기능을 한눈에 보여주기 위한 예시

import * as store from './store.js';
import { ymd, addDays } from './util.js';

const D = (n) => ymd(addDays(new Date(), -n));

export async function seedDemo() {
  const year = new Date().getFullYear();
  if (!store.goal(year).books) await store.saveGoal(year, { books: 24 });

  const atomic = await store.addBook({
    title: '아주 작은 습관의 힘',
    authors: ['제임스 클리어'],
    publisher: '비즈니스북스',
    pageCount: 320,
    currentPage: 320,
    status: 'done',
    rating: 5,
    startedAt: D(46),
    finishedAt: D(31),
    categories: ['자기계발'],
    tags: ['습관', '재독하고싶은'],
    oneLine: '습관은 의지의 문제가 아니라 설계의 문제다.',
    review: '작게 시작하라는 말은 흔하지만, 이 책은 “왜” 작아야 하는지를 시스템으로 설명한다.\n환경을 바꾸는 것이 결심을 다지는 것보다 훨씬 강력하다는 점이 오래 남았다.',
    rereadIntent: true,
    readCount: 1,
  });

  const sapiens = await store.addBook({
    title: '사피엔스',
    authors: ['유발 하라리'],
    publisher: '김영사',
    pageCount: 636,
    currentPage: 284,
    status: 'reading',
    startedAt: D(12),
    categories: ['역사', '인문'],
    tags: ['통찰'],
  });

  const almond = await store.addBook({
    title: '아몬드',
    authors: ['손원평'],
    publisher: '창비',
    pageCount: 267,
    currentPage: 267,
    status: 'done',
    rating: 4,
    startedAt: D(20),
    finishedAt: D(16),
    categories: ['소설'],
    oneLine: '감정을 모르는 아이가, 감정을 배우는 이야기.',
  });

  await store.addBook({
    title: '문학이라는 위로',
    authors: ['정여울'],
    publisher: 'arte',
    pageCount: 288,
    status: 'want',
    priority: 2,
    categories: ['에세이'],
    tags: ['위로'],
  });

  await store.addBook({
    title: '코스모스',
    authors: ['칼 세이건'],
    publisher: '사이언스북스',
    pageCount: 719,
    status: 'want',
    priority: 1,
    categories: ['과학'],
  });

  /* 문장 · 메모 · 실천 */
  await store.addNote({
    bookId: atomic.id, type: 'quote', page: 41,
    text: '목표가 아니라 시스템에 집중하라. 목표는 방향을 정하고, 시스템은 그 방향으로 나아가게 한다.',
    comment: '계획을 세우는 데 쓰던 시간을 루틴을 다듬는 데 써 보기로 했다.',
    tags: ['습관'],
  });
  await store.addNote({
    bookId: atomic.id, type: 'action',
    text: '자기 전 책을 머리맡에 두고, 하루 2쪽만 읽기',
  });
  await store.addNote({
    bookId: atomic.id, type: 'action', done: true,
    text: '독서 기록 앱을 매일 여는 시간을 정해두기 (밤 10시)',
  });
  await store.addNote({
    bookId: sapiens.id, type: 'quote', page: 52,
    text: '허구를 믿는 능력 덕분에 사피엔스는 낯선 이들과도 대규모로 협력할 수 있었다.',
    tags: ['통찰'],
  });
  await store.addNote({
    bookId: sapiens.id, type: 'memo', page: 130,
    text: '농업혁명이 “역사상 최대의 사기”라는 관점이 인상적. 총량의 풍요가 개인의 행복과 같지 않다는 이야기로 읽힌다.',
  });
  await store.addNote({
    bookId: almond.id, type: 'quote', page: 88,
    text: '멀리 있는 불행에는 대개 무감각하다. 슬픔은 가까이 있을 때에만 슬픔이 된다.',
  });

  /* 독서 세션 — 최근 3주 */
  const plan = [
    [almond.id, 18, 40, 120, 175], [almond.id, 17, 55, 175, 230],
    [almond.id, 16, 35, 230, 267], [sapiens.id, 12, 45, 0, 48],
    [sapiens.id, 11, 30, 48, 82], [sapiens.id, 9, 65, 82, 140],
    [sapiens.id, 7, 25, 140, 168], [sapiens.id, 5, 50, 168, 214],
    [sapiens.id, 3, 40, 214, 252], [sapiens.id, 1, 35, 252, 284],
  ];
  for (const [bookId, ago, minutes, from, to] of plan) {
    const date = D(ago);
    await store.addSession({
      bookId, date, minutes, startPage: from, endPage: to,
      startedAt: new Date(`${date}T21:00:00`).toISOString(),
      endedAt: new Date(`${date}T21:00:00`).toISOString(),
    });
  }
}
