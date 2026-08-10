// 해시 기반 라우터

const routes = [];
let currentPath = '';
let renderFn = null;

/**
 * @param {string} pattern  예) '/book/:id'
 * @param {(params:object)=>(string|Node|Promise<string|Node>)} view
 * @param {string} name
 */
export function route(pattern, view, name) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([\w]+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '$');
  routes.push({ rx, keys, view, name: name || pattern });
}

export function match(path) {
  for (const r of routes) {
    const m = r.rx.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { ...r, params };
    }
  }
  return null;
}

export const currentPathname = () => currentPath;

export function go(hash, { replace = false } = {}) {
  const h = hash.startsWith('#') ? hash : `#${hash}`;
  if (location.hash === h) { renderFn?.(); return; }
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
  if (replace) renderFn?.();
}

export function start(render) {
  renderFn = render;
  window.addEventListener('hashchange', () => {
    currentPath = location.hash.slice(1) || '/home';
    render();
  });
  currentPath = location.hash.slice(1) || '/home';
  if (!location.hash) history.replaceState(null, '', '#/home');
  render();
}

export function setCurrent(path) { currentPath = path; }
