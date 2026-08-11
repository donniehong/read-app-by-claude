// 테마 — auto / light / dark

const media = window.matchMedia('(prefers-color-scheme: dark)');
let mode = 'auto';

function paint() {
  const dark = mode === 'dark' || (mode === 'auto' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#141a13' : '#f5faf3');
}

export function applyTheme(next) {
  mode = next || 'auto';
  paint();
}

export const currentMode = () => mode;

/** 밝게 ↔ 어둡게 토글 (auto 상태에서는 현재 표시와 반대로) */
export function nextMode() {
  if (mode === 'auto') return media.matches ? 'light' : 'dark';
  return mode === 'dark' ? 'light' : 'dark';
}

media.addEventListener('change', () => { if (mode === 'auto') paint(); });

// localStorage 캐시로 첫 페인트 깜빡임을 줄인다
const cached = localStorage.getItem('chaekgalpi:theme');
if (cached) applyTheme(cached);
else paint();

export function cacheTheme(m) {
  localStorage.setItem('chaekgalpi:theme', m);
}
