// 새 맵 테마의 질감 (달 기지 · 우주 화물선 · 거대한 새의 둥지)
//   createTextures()와 같은 약속: floor·floorBump(4m×4m 한 장) · wall·wallBump(4m×4.8m) · wallTop · crate(1m 상자) · container(2.2m) · barrier(1.1m 방벽)
import { blotches, cracks, heightFromNoise, makeCanvas, paintNoise, rng, roundRect, toTexture, valueNoise } from './textures.js';

const cache = new Map();

export function themeTextures(theme) {
  if (cache.has(theme)) return cache.get(theme);
  const t = theme === 'moon' ? moonTextures() : theme === 'ship' ? shipTextures() : theme === 'nest' ? nestTextures() : null;
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

// ───────────────────────── 거대한 새의 둥지 ─────────────────────────
// 나뭇가지를 엮은 면: 여러 방향의 가지(밝은 결 · 어두운 그늘) 겹치기
function wovenBranches(g, w, h, seed, { count = 160, thick = [6, 16], base = [92, 68, 44] } = {}) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = (r() - 0.5) * 0.9 + (i % 2 ? 0 : Math.PI / 2) * 0.35;
    const len = 120 + r() * 300;
    const x = r() * w, y = r() * h;
    const t = thick[0] + r() * (thick[1] - thick[0]);
    const v = 0.75 + r() * 0.5;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    // 그림자 → 몸통 → 밝은 결
    g.fillStyle = 'rgba(20,14,8,0.55)';
    g.fillRect(-len / 2, -t / 2 + 3, len, t);
    const grd = g.createLinearGradient(0, -t / 2, 0, t / 2);
    grd.addColorStop(0, `rgb(${base[0] * v * 1.35},${base[1] * v * 1.35},${base[2] * v * 1.3})`);
    grd.addColorStop(0.5, `rgb(${base[0] * v},${base[1] * v},${base[2] * v})`);
    grd.addColorStop(1, `rgb(${base[0] * v * 0.55},${base[1] * v * 0.55},${base[2] * v * 0.55})`);
    g.fillStyle = grd;
    g.fillRect(-len / 2, -t / 2, len, t);
    g.strokeStyle = 'rgba(40,28,16,0.35)';
    g.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.moveTo(-len / 2, -t / 4 + k * (t / 4));
      g.lineTo(len / 2, -t / 4 + k * (t / 4) + (r() - 0.5) * 3);
      g.stroke();
    }
    g.restore();
  }
}

function nestTextures() {
  const S = 512;
  // 바닥: 잔가지·마른 풀·솜털을 다져 엮은 둥지 바닥
  const fc = makeCanvas(S, S);
  const fg = fc.getContext('2d');
  paintNoise(fg, S, S, [104, 82, 56], 18, { seed: 501, cells: 6, octaves: 4 });
  wovenBranches(fg, S, S, 503, { count: 220, thick: [3, 9], base: [120, 94, 62] });
  const r = rng(505);
  // 마른 풀 줄기 · 흰 솜털
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI, l = 10 + r() * 30;
    fg.strokeStyle = `rgba(${190 + r() * 40},${160 + r() * 40},${90 + r() * 40},0.55)`;
    fg.lineWidth = 1 + r();
    fg.beginPath();
    fg.moveTo(x, y);
    fg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    fg.stroke();
  }
  blotches(fg, S, S, 16, 'rgba(240,236,226,0.35)', 6, 18, 507);
  const fb = heightFromNoise(valueNoise(S, S, { seed: 509, cells: 16, octaves: 3 }), S, S);
  // 벽: 굵은 가지를 엮은 둥지 테두리
  const W = 512, H = 614;
  const wc = makeCanvas(W, H);
  const wg = wc.getContext('2d');
  paintNoise(wg, W, H, [62, 46, 30], 12, { seed: 511, cells: 5, octaves: 3 });
  wovenBranches(wg, W, H, 513, { count: 150, thick: [12, 30], base: [104, 78, 50] });
  // 이끼·깃털 솜털 조금
  blotches(wg, W, H, 12, 'rgba(90,110,60,0.3)', 18, 50, 515);
  blotches(wg, W, H, 8, 'rgba(235,230,220,0.3)', 8, 20, 517);
  const wb = heightFromNoise(valueNoise(256, 307, { seed: 519, cells: 10, octaves: 3 }), 256, 307);
  const top = makeCanvas(64, 64);
  const tg = top.getContext('2d');
  paintNoise(tg, 64, 64, [88, 66, 42], 14, { seed: 521, cells: 4, octaves: 2 });
  // 1m 상자 → 나무 껍질 둥치 (잘린 가지 토막)
  const crate = barkFace(256, 531);
  // 2.2m → 큰 알 (상자 대신 알 모양으로 그림 · 이 질감은 알 껍질)
  const egg = makeCanvas(512, 512);
  const eg = egg.getContext('2d');
  paintNoise(eg, 512, 512, [232, 226, 210], 8, { seed: 541, cells: 5, octaves: 3 });
  const er = rng(543);
  for (let i = 0; i < 140; i++) {
    const x = er() * 512, y = er() * 512, rad = 2 + er() ** 2 * 18;
    eg.fillStyle = `rgba(${120 + er() * 40},${90 + er() * 30},${60 + er() * 20},${0.25 + er() * 0.5})`;
    eg.beginPath();
    eg.ellipse(x, y, rad, rad * (0.6 + er() * 0.5), er() * 3, 0, Math.PI * 2);
    eg.fill();
  }
  // 1.1m 방벽 → 쓰러진 깃털 더미
  const fe = makeCanvas(512, 256);
  const feg = fe.getContext('2d');
  feg.fillStyle = '#3a3a44';
  feg.fillRect(0, 0, 512, 256);
  const fr = rng(551);
  for (let i = 0; i < 26; i++) {
    const x = fr() * 512, y = 256 - fr() * 200, len = 120 + fr() * 120, a = -0.4 + fr() * 0.8;
    feg.save();
    feg.translate(x, y);
    feg.rotate(a);
    const v = fr();
    const col = v < 0.4 ? [70, 76, 96] : v < 0.75 ? [118, 98, 74] : [220, 214, 200];
    feg.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    feg.beginPath();
    feg.ellipse(0, 0, len / 2, 16 + fr() * 10, 0, 0, Math.PI * 2);
    feg.fill();
    feg.strokeStyle = 'rgba(250,246,236,0.7)';
    feg.lineWidth = 2;
    feg.beginPath();
    feg.moveTo(-len / 2, 0);
    feg.lineTo(len / 2, 0);
    feg.stroke();
    feg.strokeStyle = 'rgba(20,20,26,0.25)';
    feg.lineWidth = 1;
    for (let k = -len / 2; k < len / 2; k += 6) {
      feg.beginPath();
      feg.moveTo(k, 0);
      feg.lineTo(k + 8, -14);
      feg.moveTo(k, 0);
      feg.lineTo(k + 8, 14);
      feg.stroke();
    }
    feg.restore();
  }
  return {
    floor: toTexture(fc),
    floorBump: toTexture(fb, { srgb: false }),
    wall: toTexture(wc),
    wallBump: toTexture(wb, { srgb: false }),
    wallTop: toTexture(top),
    crate: toTexture(crate),
    container: toTexture(egg),
    barrier: toTexture(fe),
  };
}

// 나무 껍질 면 (세로 골 · 옹이)
function barkFace(S, seed) {
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  paintNoise(g, S, S, [86, 64, 42], 14, { seed, cells: 4, octaves: 4 });
  const r = rng(seed + 1);
  for (let i = 0; i < 40; i++) {
    const x = r() * S;
    g.strokeStyle = `rgba(30,20,12,${0.3 + r() * 0.4})`;
    g.lineWidth = 2 + r() * 4;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= S; y += 16) g.lineTo(x + Math.sin(y * 0.05 + i) * 4, y);
    g.stroke();
  }
  cracks(g, S, S, 6, seed + 2, 'rgba(20,14,8,0.6)');
  return c;
}
