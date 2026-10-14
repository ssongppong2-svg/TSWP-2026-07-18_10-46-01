// 새 맵 테마의 질감 (달 기지 · 우주 화물선 · 거대한 세상)
//   createTextures()와 같은 약속: floor·floorBump(4m×4m 한 장) · wall·wallBump(4m×4.8m) · wallTop · crate(1m 상자) · container(2.2m) · barrier(1.1m 방벽)
import { blotches, cracks, heightFromNoise, makeCanvas, paintNoise, rng, roundRect, toTexture } from './textures.js';

const cache = new Map();

export function themeTextures(theme) {
  if (cache.has(theme)) return cache.get(theme);
  const t = theme === 'moon' ? moonTextures() : theme === 'ship' ? shipTextures() : theme === 'giant' ? giantTextures() : null;
  cache.set(theme, t);
  return t;
}

// 높이맵 캔버스에 둥근 구덩이(크레이터) 새기기: 안쪽은 어둡게(낮게), 테두리는 밝게(높게)
function craterBump(g, x, y, r) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r * 1.25);
  grd.addColorStop(0, 'rgba(0,0,0,0.45)');
  grd.addColorStop(0.7, 'rgba(0,0,0,0.25)');
  grd.addColorStop(0.82, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
}

// ───────────────────────── 달 기지 ─────────────────────────
function moonTextures() {
  const S = 512;
  // 바닥: 고운 회색 표토 + 작은 크레이터 + 자갈 + 발자국
  const fc = makeCanvas(S, S);
  const fg = fc.getContext('2d');
  const fn = paintNoise(fg, S, S, [128, 127, 124], 16, { seed: 301, cells: 6, octaves: 5 });
  const fb = heightFromNoise(fn, S, S);
  const fbg = fb.getContext('2d');
  const r = rng(303);
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rad = 6 + r() ** 2 * 40;
    craterBump(fbg, x, y, rad);
    // 색: 그늘진 안쪽 · 햇빛 받은 테두리 (빛이 왼쪽 위에서)
    const grd = fg.createRadialGradient(x + rad * 0.2, y + rad * 0.2, 0, x, y, rad * 1.2);
    grd.addColorStop(0, 'rgba(60,60,58,0.35)');
    grd.addColorStop(0.75, 'rgba(70,70,68,0.18)');
    grd.addColorStop(0.85, 'rgba(210,210,205,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    fg.fillStyle = grd;
    fg.fillRect(x - rad * 1.3, y - rad * 1.3, rad * 2.6, rad * 2.6);
  }
  for (let i = 0; i < 900; i++) {
    const v = 70 + r() * 120;
    fg.fillStyle = `rgba(${v},${v},${v - 4},${0.3 + r() * 0.5})`;
    const s = 1 + r() * 2.5;
    fg.fillRect(r() * S, r() * S, s, s);
  }
  // 우주복 발자국 (바닥 무늬)
  fg.fillStyle = 'rgba(70,70,68,0.28)';
  for (let k = 0; k < 2; k++) {
    let x = r() * S, y = r() * S;
    const a = r() * Math.PI * 2;
    for (let s = 0; s < 9; s++) {
      fg.save();
      fg.translate(x + Math.cos(a + Math.PI / 2) * (s % 2 ? 9 : -9), y + Math.sin(a + Math.PI / 2) * (s % 2 ? 9 : -9));
      fg.rotate(a);
      for (let b = -2; b <= 2; b++) fg.fillRect(-12 + b * 0, b * 3 - 1, 22, 2);
      fg.restore();
      x += Math.cos(a) * 26;
      y += Math.sin(a) * 26;
    }
  }
  // 벽: 흰 모듈 패널 (1m × 1.2m) · 리벳 · 주황 띠 · 아래쪽 먼지
  const W = 512, H = 614, px = H / 4.8;
  const wc = makeCanvas(W, H);
  const wg = wc.getContext('2d');
  paintNoise(wg, W, H, [206, 208, 210], 6, { seed: 311, cells: 6, octaves: 3 });
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = col * 128, y = row * 1.2 * px;
      wg.fillStyle = `rgba(${(row + col) % 2 ? 255 : 0},${(row + col) % 2 ? 255 : 0},${(row + col) % 2 ? 255 : 0},0.035)`;
      wg.fillRect(x, y, 128, 1.2 * px);
      wg.strokeStyle = 'rgba(90,96,104,0.55)';
      wg.lineWidth = 2;
      wg.strokeRect(x + 1, y + 1, 126, 1.2 * px - 2);
      wg.fillStyle = 'rgba(120,124,130,0.8)';
      for (const [rx, ry] of [[6, 6], [122, 6], [6, 1.2 * px - 6], [122, 1.2 * px - 6]]) {
        wg.beginPath();
        wg.arc(x + rx, y + ry, 2.2, 0, Math.PI * 2);
        wg.fill();
      }
    }
  }
  wg.fillStyle = '#d4642a';
  wg.fillRect(0, H - 1.3 * px, W, 0.12 * px);
  wg.fillStyle = '#2b3542';
  wg.fillRect(0, H - 1.16 * px, W, 0.04 * px);
  const dust = wg.createLinearGradient(0, H, 0, H - 1.0 * px);
  dust.addColorStop(0, 'rgba(110,108,104,0.75)');
  dust.addColorStop(1, 'rgba(110,108,104,0)');
  wg.fillStyle = dust;
  wg.fillRect(0, H - 1.0 * px, W, 1.0 * px);
  wg.font = '700 22px "Rajdhani", sans-serif';
  wg.fillStyle = 'rgba(40,48,60,0.7)';
  wg.fillText('LB-01 · PRESSURIZED', 140, 1.2 * px * 2 + 40);
  const wb = makeCanvas(256, 307);
  const wbg = wb.getContext('2d');
  wbg.fillStyle = '#ffffff';
  wbg.fillRect(0, 0, 256, 307);
  wbg.fillStyle = '#000000';
  for (let col = 0; col <= 4; col++) wbg.fillRect(col * 64 - 1, 0, 2, 307);
  for (let row = 0; row <= 4; row++) wbg.fillRect(0, row * 1.2 * (307 / 4.8) - 1, 256, 2);
  const top = makeCanvas(64, 64);
  paintNoise(top.getContext('2d'), 64, 64, [150, 152, 156], 10, { seed: 317, cells: 4, octaves: 2 });
  // 1m 상자: 흰 보급 상자 · 주황 모서리 · 표지
  const crate = supplyCase(256, '#e7e9ec', '#d4642a', 'O₂ · 보급', 321);
  // 2.2m 컨테이너: 은색 화물 모듈 · 주황 띠 · 번호
  const container = supplyCase(512, '#c9cdd2', '#d4642a', 'LB-CARGO 07', 331, true);
  // 1.1m 방벽: 표토를 채운 자루 더미
  const bc = makeCanvas(512, 256);
  const bg = bc.getContext('2d');
  bg.fillStyle = '#6f6e6a';
  bg.fillRect(0, 0, 512, 256);
  const br = rng(341);
  for (let row = 0; row < 4; row++) {
    for (let k = -1; k < 6; k++) {
      const x = k * 96 + (row % 2) * 48, y = 256 - (row + 1) * 62;
      const v = 140 + br() * 30;
      bg.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
      roundRect(bg, x + 3, y + 3, 90, 56, 22);
      bg.fill();
      bg.strokeStyle = 'rgba(60,58,54,0.6)';
      bg.lineWidth = 2;
      bg.stroke();
    }
  }
  blotches(bg, 512, 256, 20, 'rgba(90,88,84,0.3)', 10, 40, 343);
  return {
    floor: toTexture(fc),
    floorBump: toTexture(fb, { srgb: false }),
    wall: toTexture(wc),
    wallBump: toTexture(wb, { srgb: false }),
    wallTop: toTexture(top),
    crate: toTexture(crate),
    container: toTexture(container),
    barrier: toTexture(bc),
  };
}

// 보급 상자 · 화물 모듈 면 (가장자리 테 · 모서리 띠 · 표지 글자)
function supplyCase(S, base, accent, label, seed, ribs = false) {
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  paintNoise(g, S, S, hexRgb(base), 8, { seed, cells: 5, octaves: 3 });
  const e = S * 0.06;
  g.strokeStyle = 'rgba(70,74,80,0.7)';
  g.lineWidth = S * 0.02;
  g.strokeRect(e, e, S - 2 * e, S - 2 * e);
  if (ribs) {
    g.strokeStyle = 'rgba(80,86,92,0.45)';
    g.lineWidth = S * 0.012;
    for (let i = 1; i < 8; i++) {
      g.beginPath();
      g.moveTo(e + (i * (S - 2 * e)) / 8, e);
      g.lineTo(e + (i * (S - 2 * e)) / 8, S - e);
      g.stroke();
    }
  }
  g.fillStyle = accent;
  for (const [x, y] of [[0, 0], [S - S * 0.16, 0], [0, S - S * 0.16], [S - S * 0.16, S - S * 0.16]]) g.fillRect(x, y, S * 0.16, S * 0.16);
  g.fillRect(0, S * 0.44, S, S * 0.07);
  g.fillStyle = 'rgba(30,34,42,0.85)';
  g.font = `700 ${Math.round(S * 0.075)}px "Rajdhani", "IBM Plex Sans KR", sans-serif`;
  g.textAlign = 'center';
  g.fillText(label, S / 2, S * 0.68);
  blotches(g, S, S, 10, 'rgba(110,108,104,0.18)', S * 0.04, S * 0.14, seed + 1);
  return c;
}

function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ───────────────────────── 우주 화물선 ─────────────────────────
function shipTextures() {
  const S = 512;
  // 바닥: 미끄럼 방지 철판 (2m 판 2×2) · 노란 경고 테 · 볼트
  const fc = makeCanvas(S, S);
  const fg = fc.getContext('2d');
  paintNoise(fg, S, S, [86, 92, 100], 8, { seed: 401, cells: 6, octaves: 4 });
  const r = rng(403);
  for (let y = 6; y < S; y += 14) {
    for (let x = (y / 14) % 2 ? 6 : 13; x < S; x += 14) {
      fg.save();
      fg.translate(x, y);
      fg.rotate(((x + y) / 14) % 2 ? 0.8 : -0.8);
      fg.fillStyle = 'rgba(150,158,168,0.35)';
      fg.fillRect(-4, -1, 8, 2);
      fg.restore();
    }
  }
  const fb = makeCanvas(S, S);
  const fbg = fb.getContext('2d');
  fbg.fillStyle = '#808080';
  fbg.fillRect(0, 0, S, S);
  for (let i = 0; i <= 2; i++) {
    fg.fillStyle = 'rgba(30,34,40,0.8)';
    fg.fillRect(i * 256 - 2, 0, 4, S);
    fg.fillRect(0, i * 256 - 2, S, 4);
    fbg.fillStyle = '#000';
    fbg.fillRect(i * 256 - 2, 0, 4, S);
    fbg.fillRect(0, i * 256 - 2, S, 4);
  }
  fg.fillStyle = 'rgba(150,158,168,0.8)';
  for (const x of [12, 244, 268, 500]) for (const y of [12, 244, 268, 500]) {
    fg.beginPath();
    fg.arc(x, y, 3, 0, Math.PI * 2);
    fg.fill();
  }
  blotches(fg, S, S, 12, 'rgba(20,22,26,0.18)', 20, 60, 405);
  // 벽: 짙은 회청색 패널 · 가로 홈 · 하늘빛 표시등 줄 · 배관 · 경고 띠
  const W = 512, H = 614, px = H / 4.8;
  const wc = makeCanvas(W, H);
  const wg = wc.getContext('2d');
  paintNoise(wg, W, H, [78, 86, 98], 7, { seed: 411, cells: 6, octaves: 3 });
  for (let col = 0; col < 2; col++) {
    const x = col * 256;
    wg.fillStyle = 'rgba(40,46,56,0.9)';
    wg.fillRect(x, 0, 3, H);
    for (const y of [0.6, 1.8, 3.2]) {
      wg.fillStyle = 'rgba(30,34,42,0.75)';
      wg.fillRect(x + 20, H - y * px, 216, 3);
    }
    // 점검 덮개 (리벳)
    wg.strokeStyle = 'rgba(40,46,56,0.8)';
    wg.lineWidth = 2;
    wg.strokeRect(x + 40, H - 3.0 * px, 90, 0.9 * px);
    wg.fillStyle = 'rgba(150,160,175,0.7)';
    for (const [rx, ry] of [[44, -2.96], [126, -2.96], [44, -2.14], [126, -2.14]]) wg.fillRect(x + rx, H + ry * px, 3, 3);
  }
  // 하늘빛 표시등 줄 (허리 높이) · 바닥 쪽 노란·검정 경고 띠
  const glow = wg.createLinearGradient(0, H - 1.25 * px, 0, H - 1.05 * px);
  glow.addColorStop(0, 'rgba(79,227,255,0)');
  glow.addColorStop(0.5, 'rgba(120,235,255,0.95)');
  glow.addColorStop(1, 'rgba(79,227,255,0)');
  wg.fillStyle = glow;
  wg.fillRect(0, H - 1.25 * px, W, 0.2 * px);
  wg.save();
  wg.beginPath();
  wg.rect(0, H - 0.22 * px, W, 0.22 * px);
  wg.clip();
  for (let x = -40; x < W + 40; x += 32) {
    wg.fillStyle = (x / 32) % 2 ? '#d9b23a' : '#1c1e22';
    wg.beginPath();
    wg.moveTo(x, H);
    wg.lineTo(x + 16, H);
    wg.lineTo(x + 40, H - 0.22 * px);
    wg.lineTo(x + 24, H - 0.22 * px);
    wg.fill();
  }
  wg.restore();
  // 천장 쪽 배관 두 줄
  for (const [y, v] of [[0.35, 120], [0.6, 96]]) {
    const pg = wg.createLinearGradient(0, y * px - 9, 0, y * px + 9);
    pg.addColorStop(0, `rgb(${v - 40},${v - 36},${v - 30})`);
    pg.addColorStop(0.5, `rgb(${v + 40},${v + 44},${v + 50})`);
    pg.addColorStop(1, `rgb(${v - 50},${v - 46},${v - 40})`);
    wg.fillStyle = pg;
    wg.fillRect(0, y * px - 9, W, 18);
  }
  wg.font = '700 26px "Rajdhani", sans-serif';
  wg.fillStyle = 'rgba(217,178,58,0.85)';
  wg.fillText('DECK 2 · ODYSSEY', 280, H - 2.2 * px);
  const wb = makeCanvas(256, 307);
  const wbg = wb.getContext('2d');
  wbg.fillStyle = '#ffffff';
  wbg.fillRect(0, 0, 256, 307);
  wbg.fillStyle = '#000';
  wbg.fillRect(0, 0, 2, 307);
  wbg.fillRect(127, 0, 2, 307);
  for (const y of [0.6, 1.8, 3.2]) wbg.fillRect(0, 307 - y * (307 / 4.8), 256, 2);
  const top = makeCanvas(64, 64);
  paintNoise(top.getContext('2d'), 64, 64, [60, 66, 74], 8, { seed: 417, cells: 4, octaves: 2 });
  const crate = supplyCase(256, '#5a6370', '#d9b23a', 'CARGO', 421);
  const container = supplyCase(512, '#46505c', '#4fe3ff', 'ODY-HOLD 3', 431, true);
  // 1.1m 방벽: 자석 고정 화물 받침 (노랑·검정 줄 + 철판)
  const bc = makeCanvas(512, 256);
  const bg = bc.getContext('2d');
  paintNoise(bg, 512, 256, [96, 102, 110], 8, { seed: 441, cells: 5, octaves: 3 });
  bg.save();
  bg.beginPath();
  bg.rect(0, 0, 512, 46);
  bg.clip();
  for (let x = -40; x < 560; x += 46) {
    bg.fillStyle = (x / 46) % 2 ? '#d9b23a' : '#1c1e22';
    bg.beginPath();
    bg.moveTo(x, 46);
    bg.lineTo(x + 23, 46);
    bg.lineTo(x + 46, 0);
    bg.lineTo(x + 23, 0);
    bg.fill();
  }
  bg.restore();
  bg.fillStyle = 'rgba(30,34,40,0.6)';
  for (let x = 32; x < 512; x += 64) bg.fillRect(x, 80, 4, 150);
  return {
    floor: toTexture(fc),
    floorBump: toTexture(fb, { srgb: false }),
    wall: toTexture(wc),
    wallBump: toTexture(wb, { srgb: false }),
    wallTop: toTexture(top),
    crate: toTexture(crate),
    container: toTexture(container),
    barrier: toTexture(bc),
  };
}

// ───────────────────────── 거대한 세상 (거인들의 도시) ─────────────────────────
// 모든 것이 거인 크기: 아스팔트 자갈이 주먹만 하고, 벽돌 한 장이 2.4 m
function giantTextures() {
  const S = 512;
  // 바닥: 거인 아스팔트 — 굵은 자갈 · 타르 이음매 · 기름 얼룩 · 갈라짐
  const fc = makeCanvas(S, S);
  const fg = fc.getContext('2d');
  paintNoise(fg, S, S, [70, 72, 76], 14, { seed: 601, cells: 8, octaves: 4 });
  const r = rng(603);
  const fb = makeCanvas(S, S);
  const fbg = fb.getContext('2d');
  fbg.fillStyle = '#606060';
  fbg.fillRect(0, 0, S, S);
  for (let i = 0; i < 420; i++) {
    const x = r() * S, y = r() * S, rad = 5 + r() ** 2 * 16, v = 70 + r() * 70;
    fg.fillStyle = `rgba(${v},${v * 0.98},${v * 0.95},${0.55 + r() * 0.4})`;
    fg.beginPath();
    fg.ellipse(x, y, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
    fg.fill();
    fg.strokeStyle = 'rgba(20,20,22,0.5)';
    fg.lineWidth = 1.5;
    fg.stroke();
    const gr = fbg.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(230,230,230,0.9)');
    gr.addColorStop(1, 'rgba(96,96,96,0)');
    fbg.fillStyle = gr;
    fbg.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  blotches(fg, S, S, 5, 'rgba(18,18,24,0.35)', 30, 80, 605);
  cracks(fg, S, S, 4, 607, 'rgba(15,15,18,0.75)');
  fg.fillStyle = 'rgba(25,25,28,0.55)';
  fg.fillRect(0, 250, S, 7); // 타르 이음매
  // 벽: 거인 건물 벽돌 (한 장 2.4 m × 0.8 m) — 줄눈 · 색 차이 · 얼룩
  const W = 512, H = 614;
  const wc = makeCanvas(W, H);
  const wg = wc.getContext('2d');
  wg.fillStyle = '#6a625a';
  wg.fillRect(0, 0, W, H);
  const wb = makeCanvas(256, 307);
  const wbg = wb.getContext('2d');
  wbg.fillStyle = '#303030';
  wbg.fillRect(0, 0, 256, 307);
  const bh = H / 6, bw = W * 0.6;
  const br = rng(611);
  for (let row = 0; row < 6; row++) {
    const off = row % 2 ? -bw / 2 : 0;
    for (let x = off; x < W; x += bw) {
      const v = 0.8 + br() * 0.35;
      const base = br() < 0.15 ? [120, 70, 52] : [150, 78, 58];
      wg.fillStyle = `rgb(${base[0] * v},${base[1] * v},${base[2] * v})`;
      roundRect(wg, x + 7, row * bh + 7, bw - 14, bh - 14, 8);
      wg.fill();
      // 벽돌 표면 얼룩 · 패인 자국
      for (let k = 0; k < 14; k++) {
        wg.fillStyle = `rgba(${br() < 0.5 ? 40 : 200},${br() < 0.5 ? 30 : 160},${30},${0.06 + br() * 0.08})`;
        wg.beginPath();
        wg.ellipse(x + 10 + br() * (bw - 20), row * bh + 10 + br() * (bh - 20), 4 + br() * 18, 2 + br() * 8, br() * 3, 0, Math.PI * 2);
        wg.fill();
      }
      wbg.fillStyle = '#c8c8c8';
      roundRect(wbg, (x + 7) / 2, (row * bh + 7) / 2, (bw - 14) / 2, (bh - 14) / 2, 4);
      wbg.fill();
    }
  }
  blotches(wg, W, H, 8, 'rgba(20,16,12,0.18)', 30, 90, 613);
  // 아래쪽 빗물 때
  const dirt = wg.createLinearGradient(0, H * 0.7, 0, H);
  dirt.addColorStop(0, 'rgba(30,26,22,0)');
  dirt.addColorStop(1, 'rgba(30,26,22,0.45)');
  wg.fillStyle = dirt;
  wg.fillRect(0, 0, W, H);
  const top = makeCanvas(64, 64);
  const tg = top.getContext('2d');
  paintNoise(tg, 64, 64, [150, 146, 140], 12, { seed: 621, cells: 4, octaves: 2 });
  // 1m 작은 상자 → 병뚜껑 옆면 (주름 · 빨간 칠 · 긁힘)
  const cap = makeCanvas(256, 128);
  const cg = cap.getContext('2d');
  for (let x = 0; x < 256; x += 8) {
    const grd = cg.createLinearGradient(x, 0, x + 8, 0);
    grd.addColorStop(0, '#7a1414');
    grd.addColorStop(0.5, '#e23a2c');
    grd.addColorStop(1, '#7a1414');
    cg.fillStyle = grd;
    cg.fillRect(x, 0, 8, 128);
  }
  cg.fillStyle = 'rgba(230,230,235,0.75)';
  for (let i = 0; i < 30; i++) cg.fillRect(r() * 256, r() * 128, 1 + r() * 3, 1);
  // 2.2m 큰 상자 → 콜라 캔 상표 (질량·무게 표시)
  const can = makeCanvas(512, 256);
  const kg = can.getContext('2d');
  kg.fillStyle = '#c4141c';
  kg.fillRect(0, 0, 512, 256);
  kg.fillStyle = '#f4f2ee';
  kg.beginPath();
  kg.moveTo(0, 150);
  for (let x = 0; x <= 512; x += 8) kg.lineTo(x, 150 + Math.sin(x * 0.025) * 18);
  kg.lineTo(512, 175);
  for (let x = 512; x >= 0; x -= 8) kg.lineTo(x, 175 + Math.sin(x * 0.025 + 0.6) * 18);
  kg.fill();
  kg.fillStyle = '#ffffff';
  kg.font = '900 74px "Rajdhani", "Pretendard", sans-serif';
  kg.textAlign = 'center';
  kg.fillText('FORCE', 140, 118);
  kg.font = '700 26px "Pretendard", "Noto Sans KR", sans-serif';
  kg.fillText('COLA', 140, 146);
  kg.fillStyle = '#f4f2ee';
  kg.font = '600 17px "Pretendard", "Noto Sans KR", sans-serif';
  kg.textAlign = 'left';
  for (const [i, t] of ['355 mL', '질량 0.37 kg', '무게 3.6 N (지구)', '달에서는 0.6 N'].entries()) kg.fillText(t, 330, 70 + i * 24);
  // 캔 위아래 은색 테두리
  for (const y of [0, 240]) {
    const grd = kg.createLinearGradient(0, y, 0, y + 16);
    grd.addColorStop(0, '#9aa0a6');
    grd.addColorStop(0.5, '#e8ecef');
    grd.addColorStop(1, '#8a9096');
    kg.fillStyle = grd;
    kg.fillRect(0, y, 512, 16);
  }
  // 1.1m 방벽 → 몽당연필 (노란 육각 · HB): 눕힌 육각 기둥에 감기므로 가로 = 둘레(면 6개), 세로 = 길이
  const pc = makeCanvas(256, 512);
  const pg = pc.getContext('2d');
  for (let i = 0; i < 6; i++) {
    pg.fillStyle = i % 2 ? '#f6c836' : '#e2b024';
    pg.fillRect((i * 256) / 6, 0, 256 / 6 + 1, 512);
    pg.fillStyle = 'rgba(255,248,200,0.4)';
    pg.fillRect((i * 256) / 6, 0, 3, 512);
  }
  pg.save();
  pg.translate(256 / 12 + 14, 256);
  pg.rotate(-Math.PI / 2);
  pg.fillStyle = '#1d4f2a';
  pg.font = '800 26px "Rajdhani", sans-serif';
  pg.textAlign = 'center';
  pg.fillText('HB · FORCE No.2', 0, 0);
  pg.restore();
  pg.fillStyle = 'rgba(80,50,10,0.25)';
  for (let i = 0; i < 40; i++) pg.fillRect(r() * 256, r() * 512, 1, 2 + r() * 20);
  return {
    floor: toTexture(fc),
    floorBump: toTexture(fb, { srgb: false }),
    wall: toTexture(wc),
    wallBump: toTexture(wb, { srgb: false }),
    wallTop: toTexture(top),
    crate: toTexture(cap),
    container: toTexture(can),
    barrier: toTexture(pc),
    zones: giantZoneTextures(),
    pole: poleTexture(),
  };
}

// 벽 재질 구역: 운동화 천 · 도시락 플라스틱 · 화강암 연석 (각각 4 m × 4.8 m 한 장)
function giantZoneTextures() {
  const W = 512, H = 614;
  const out = {};
  // 운동화: 흰 캔버스 천 + 빨간 덧댐 + 바느질 + 신발끈 구멍
  {
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#ecebe6';
    g.fillRect(0, 0, W, H);
    const r = rng(701);
    for (let y = 0; y < H; y += 3) {
      g.fillStyle = `rgba(120,118,110,${0.05 + r() * 0.06})`;
      g.fillRect(0, y, W, 1);
    }
    for (let x = 0; x < W; x += 3) {
      g.fillStyle = `rgba(120,118,110,${0.04 + r() * 0.05})`;
      g.fillRect(x, 0, 1, H);
    }
    g.fillStyle = '#c8242a';
    g.beginPath();
    g.moveTo(0, H * 0.62);
    g.bezierCurveTo(W * 0.3, H * 0.5, W * 0.7, H * 0.72, W, H * 0.6);
    g.lineTo(W, H * 0.82);
    g.lineTo(0, H * 0.82);
    g.fill();
    // 고무 밑창 띠
    g.fillStyle = '#f7f6f2';
    g.fillRect(0, H * 0.82, W, H * 0.18);
    g.fillStyle = 'rgba(40,40,40,0.25)';
    for (let x = 0; x < W; x += 24) g.fillRect(x, H * 0.9, 12, 4);
    // 바느질 선
    g.strokeStyle = 'rgba(60,40,30,0.55)';
    g.lineWidth = 3;
    g.setLineDash([10, 8]);
    for (const y of [H * 0.6, H * 0.8]) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    g.setLineDash([]);
    // 신발끈 구멍 (은색 고리)
    for (let x = 64; x < W; x += 128) {
      g.fillStyle = '#9aa0a6';
      g.beginPath();
      g.arc(x, H * 0.2, 20, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a2a2a';
      g.beginPath();
      g.arc(x, H * 0.2, 11, 0, Math.PI * 2);
      g.fill();
    }
    blotches(g, W, H, 6, 'rgba(90,80,60,0.12)', 20, 70, 703);
    out.sneaker = toTexture(c);
  }
  // 도시락: 하늘색 플라스틱 + 세로 골 + 스티커
  {
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#6cc4e8');
    grd.addColorStop(1, '#3e9cc8');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 64) {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x + 6, 0, 10, H);
      g.fillStyle = 'rgba(0,40,80,0.15)';
      g.fillRect(x + 16, 0, 6, H);
    }
    g.fillStyle = '#ffd84a';
    roundRect(g, W * 0.18, H * 0.3, W * 0.64, H * 0.3, 30);
    g.fill();
    g.fillStyle = '#2a3a4a';
    g.font = '800 54px "Pretendard", "Noto Sans KR", sans-serif';
    g.textAlign = 'center';
    g.fillText('거인 도시락', W / 2, H * 0.44);
    g.font = '600 26px "Pretendard", "Noto Sans KR", sans-serif';
    g.fillText('뚜껑을 열 때 필요한 힘: 30 N', W / 2, H * 0.52);
    blotches(g, W, H, 5, 'rgba(255,255,255,0.12)', 30, 80, 711);
    out.lunchbox = toTexture(c);
  }
  // 연석: 화강암 큰 덩어리 (반점 · 이음매)
  {
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    paintNoise(g, W, H, [150, 148, 144], 16, { seed: 721, cells: 6, octaves: 4 });
    const r = rng(723);
    for (let i = 0; i < 2600; i++) {
      const v = r() < 0.5 ? 40 + r() * 40 : 200 + r() * 50;
      g.fillStyle = `rgba(${v},${v},${v + (r() < 0.2 ? 20 : 0)},0.5)`;
      g.fillRect(r() * W, r() * H, 2 + r() * 3, 2 + r() * 3);
    }
    g.fillStyle = 'rgba(40,40,42,0.6)';
    g.fillRect(0, 0, 6, H);
    g.fillRect(0, H * 0.5, W, 5);
    blotches(g, W, H, 6, 'rgba(30,30,30,0.15)', 30, 90, 725);
    out.curb = toTexture(c);
  }
  return out;
}

// 쓰러진 신호등 기둥 윗면: 녹색 칠 · 벗겨짐 · 붙은 전단지
function poleTexture() {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  paintNoise(g, 256, 256, [70, 96, 82], 10, { seed: 731, cells: 4, octaves: 3 });
  blotches(g, 256, 256, 10, 'rgba(120,90,60,0.45)', 6, 18, 733);
  g.fillStyle = 'rgba(240,236,220,0.9)';
  g.fillRect(150, 40, 60, 80);
  g.fillStyle = 'rgba(40,40,40,0.7)';
  for (let y = 52; y < 112; y += 10) g.fillRect(158, y, 44, 3);
  return toTexture(c);
}
