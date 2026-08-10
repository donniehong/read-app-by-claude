// 의존성 없는 SVG 차트 — 막대 / 도넛 / 히트맵

import { esc, ymd, addDays, weekdayKo } from './util.js';

/**
 * 세로 막대 차트 — 라벨이 항상 또렷하도록 SVG 대신 CSS 로 그린다
 * @param {{label:string, value:number}[]} data
 */
export function barChart(data, { height = 150, valueFmt = (v) => v, highlight = -1 } = {}) {
  if (!data.length) return '<p class="empty">데이터가 없어요.</p>';
  const max = Math.max(1, ...data.map((d) => d.value));
  const plot = height - 34;   // 값 라벨 + 축 라벨 자리

  const cols = data.map((d, i) => {
    const h = d.value ? Math.max(3, (d.value / max) * plot) : 0;
    const on = i === highlight || d.value === max;
    return `
      <div class="bar-col" title="${esc(d.label)} · ${esc(String(valueFmt(d.value)))}">
        <span class="bar-col__v">${d.value ? esc(String(d.value)) : ''}</span>
        <span class="bar-col__track" style="height:${plot}px">
          <i style="height:${h}px;opacity:${on ? 1 : 0.82}"></i>
        </span>
        <span class="bar-col__l">${esc(d.label)}</span>
      </div>`;
  }).join('');

  return `<div class="barchart">${cols}</div>`;
}

/** 가로 막대(순위) 목록 */
export function rankList(rows, { valueFmt = (v) => v, max: maxN = 6 } = {}) {
  if (!rows.length) return '<p class="empty">데이터가 없어요.</p>';
  const top = rows.slice(0, maxN);
  const max = Math.max(1, ...top.map((r) => r.value));
  return top.map((r, i) => `
    <div class="rank-row">
      <span class="n">${i + 1}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.label)}</span>
        <span style="display:block;height:4px;border-radius:4px;background:var(--bg-sunk);margin-top:4px">
          <i style="display:block;height:100%;border-radius:4px;background:var(--accent);width:${(r.value / max) * 100}%"></i>
        </span>
      </span>
      <span class="v">${esc(String(valueFmt(r.value)))}</span>
    </div>`).join('');
}

const DONUT_COLORS = ['#5b52ff', '#14c8a0', '#ffb020', '#ff6b5e', '#a86bff', '#3aa0ff', '#7e8bb5', '#e15fa6'];

/** 도넛 차트 + 범례 */
export function donutChart(data, { size = 150 } = {}) {
  const rows = data.filter((d) => d.value > 0);
  if (!rows.length) return '<p class="empty">데이터가 없어요.</p>';
  const total = rows.reduce((a, b) => a + b.value, 0);
  const r = 40, c = 2 * Math.PI * r;
  let off = 0;

  const arcs = rows.map((d, i) => {
    const frac = d.value / total;
    const len = frac * c;
    const seg = `<circle r="${r}" cx="50" cy="50" fill="none" stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}"
        stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}"
        stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 50 50)">
        <title>${esc(d.label)} · ${d.value} (${Math.round(frac * 100)}%)</title></circle>`;
    off += len;
    return seg;
  }).join('');

  const legend = rows.map((d, i) => `
    <span><i style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></i>${esc(d.label)}
      <b class="mono">${d.value}</b></span>`).join('');

  return `
    <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
      <svg viewBox="0 0 100 100" style="width:${size}px;height:${size}px;flex:0 0 auto">
        ${arcs}
        <text x="50" y="49" text-anchor="middle" style="font-size:15px;font-weight:800;fill:var(--text)">${total}</text>
        <text x="50" y="60" text-anchor="middle" style="font-size:7px;fill:var(--text-faint)">권</text>
      </svg>
      <div class="legend" style="flex:1;min-width:140px">${legend}</div>
    </div>`;
}

/**
 * 독서 잔디 히트맵
 * @param {Map<string,{minutes:number,sessions:number,notes:number,finished:number}>} act
 */
export function heatmap(act, { weeks = 27, endDate = new Date() } = {}) {
  const end = new Date(endDate); end.setHours(0, 0, 0, 0);
  // 마지막 열이 이번 주가 되도록 토요일까지 채운다
  const tail = addDays(end, 6 - end.getDay());
  const start = addDays(tail, -(weeks * 7 - 1));

  const level = (a) => {
    if (!a) return 0;
    const m = a.minutes || 0;
    const any = m > 0 || a.sessions > 0 || a.notes > 0 || a.finished > 0;
    if (!any) return 0;
    if (m >= 90) return 4;
    if (m >= 45) return 3;
    if (m >= 15) return 2;
    return 1;
  };

  let cells = '';
  let monthLabels = '';
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      if (day > end) { cells += '<i style="visibility:hidden"></i>'; continue; }
      const key = ymd(day);
      const a = act.get(key);
      const l = level(a);
      const tip = a
        ? `${key} (${weekdayKo(day)}) · ${a.minutes}분${a.finished ? ` · 완독 ${a.finished}권` : ''}`
        : `${key} (${weekdayKo(day)}) · 기록 없음`;
      cells += `<i data-l="${l}" title="${esc(tip)}"></i>`;
    }
  }
  void monthLabels;

  return `
    <div class="heatmap-wrap"><div class="heatmap">${cells}</div></div>
    <div class="heat-legend">
      <span>적음</span>
      <i style="background:var(--bg-sunk)"></i>
      <i data-l="1" style="background:color-mix(in srgb, var(--accent) 26%, var(--bg-sunk))"></i>
      <i data-l="2" style="background:color-mix(in srgb, var(--accent) 48%, var(--bg-sunk))"></i>
      <i data-l="3" style="background:color-mix(in srgb, var(--accent) 72%, var(--bg-sunk))"></i>
      <i data-l="4" style="background:var(--accent)"></i>
      <span>많음</span>
    </div>`;
}
