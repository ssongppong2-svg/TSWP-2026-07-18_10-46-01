import * as THREE from 'three';

// 이미지 파일 없이 캔버스로 그린 텍스처. 한 파일 빌드(오프라인 실행)를 위해 전부 코드로 만든다.

const FONT = '"IBM Plex Sans KR", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
const STENCIL = '"Rajdhani", "IBM Plex Sans KR", "Malgun Gothic", sans-serif';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 시드 난수
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// 이어 붙여도 티 안 나는 값 노이즈 (여러 옥타브)
function valueNoise(w, h, { seed = 1, cells = 8, octaves = 4, persistence = 0.5 } = {}) {
  const out = new Float32Array(w * h);
  const r = rng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const grid = new Float32Array(n * n);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    for (let y = 0; y < h; y++) {
      const gy = (y / h) * n;
      const y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
      const r0 = (y0 % n) * n, r1 = ((y0 + 1) % n) * n;
      for (let x = 0; x < w; x++) {
        const gx = (x / w) * n;
        const x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
        const c0 = x0 % n, c1 = (x0 + 1) % n;
        const a = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * sx;
        const b = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * sx;
        out[y * w + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// 노이즈로 바탕색 칠하기 (+ 높이맵용 회색 캔버스)
function paintNoise(g, w, h, base, variance, opts = {}) {
  const n = valueNoise(w, h, opts);
  const img = g.createImageData(w, h);
  const r2 = rng((opts.seed ?? 1) + 99);
  for (let i = 0; i < n.length; i++) {
    const v = (n[i] - 0.5) * 2 * variance + (r2() - 0.5) * variance * 0.5;
    img.data[i * 4] = Math.max(0, Math.min(255, base[0] + v));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + v));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + v));
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return n;
}

function heightFromNoise(n, w, h) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let i = 0; i < n.length; i++) {
    const v = n[i] * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function blotches(g, w, h, count, color, rMin, rMax, seed) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, rad = rMin + r() * (rMax - rMin);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

function cracks(g, w, h, count, seed, color = 'rgba(15,15,16,0.7)') {
  const r = rng(seed);
  g.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    let x = r() * w, y = r() * h, a = r() * Math.PI * 2;
    g.lineWidth = 0.8 + r() * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 10 + Math.floor(r() * 30);
    for (let k = 0; k < steps; k++) {
      a += (r() - 0.5) * 0.9;
      x += Math.cos(a) * (3 + r() * 6);
      y += Math.sin(a) * (3 + r() * 6);
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function createTextures() {
  // ── 콘크리트 벽: 가로 4m × 세로 4.8m 한 장
  const wallC = makeCanvas(512, 614);
  const wg = wallC.getContext('2d');
  const wn = paintNoise(wg, 512, 614, [104, 106, 108], 22, { seed: 7, cells: 6, octaves: 5 });
  blotches(wg, 512, 614, 18, 'rgba(40,38,34,0.22)', 40, 120, 3);
  // 빗물 자국 (위에서 아래로)
  const sr = rng(11);
  for (let i = 0; i < 26; i++) {
    const x = sr() * 512, len = 120 + sr() * 380, wdt = 2 + sr() * 9;
    const grd = wg.createLinearGradient(0, 0, 0, len);
    grd.addColorStop(0, 'rgba(25,24,22,0.35)');
    grd.addColorStop(1, 'rgba(25,24,22,0)');
    wg.fillStyle = grd;
    wg.fillRect(x, 0, wdt, len);
  }
  // 패널 이음새와 거푸집 구멍
  wg.fillStyle = 'rgba(20,20,20,0.55)';
  wg.fillRect(0, 0, 3, 614);
  wg.fillRect(255, 0, 3, 614);
  for (const yM of [0.9, 2.1, 3.3, 4.4]) {
    for (const xM of [0.5, 1.5, 2.5, 3.5]) {
      const x = xM * 128, y = 614 - yM * 128;
      wg.fillStyle = 'rgba(30,30,30,0.8)';
      wg.beginPath();
      wg.arc(x, y, 4.5, 0, Math.PI * 2);
      wg.fill();
      wg.fillStyle = 'rgba(160,160,160,0.25)';
      wg.beginPath();
      wg.arc(x + 1, y + 1, 4.5, 0, Math.PI);
      wg.fill();
    }
  }
  // 바닥 쪽 때
  const grime = wg.createLinearGradient(0, 614, 0, 520);
  grime.addColorStop(0, 'rgba(30,26,20,0.75)');
  grime.addColorStop(1, 'rgba(30,26,20,0)');
  wg.fillStyle = grime;
  wg.fillRect(0, 520, 512, 94);
  // 낡은 경고 띠
  wg.save();
  wg.globalAlpha = 0.55;
  wg.beginPath();
  wg.rect(0, 570, 512, 22);
  wg.clip();
  wg.fillStyle = '#b8902c';
  wg.fillRect(0, 570, 512, 22);
  wg.fillStyle = '#191919';
  for (let x = -30; x < 540; x += 32) {
    wg.beginPath();
    wg.moveTo(x, 592);
    wg.lineTo(x + 16, 592);
    wg.lineTo(x + 38, 570);
    wg.lineTo(x + 22, 570);
    wg.fill();
  }
  wg.restore();
  cracks(wg, 512, 614, 10, 21, 'rgba(20,20,20,0.5)');
  const wall = toTexture(wallC);
  const wallBump = toTexture(heightFromNoise(wn, 512, 614), { srgb: false });

  // ── 바닥: 4m × 4m 한 장 (줄눈은 2m 간격)
  const floorC = makeCanvas(512, 512);
  const fg = floorC.getContext('2d');
  const fn = paintNoise(fg, 512, 512, [62, 63, 64], 16, { seed: 3, cells: 8, octaves: 5 });
  blotches(fg, 512, 512, 10, 'rgba(10,10,10,0.35)', 20, 70, 5); // 기름 얼룩
  blotches(fg, 512, 512, 14, 'rgba(120,118,110,0.08)', 30, 90, 8);
  cracks(fg, 512, 512, 14, 9);
  fg.fillStyle = 'rgba(15,15,15,0.7)';
  fg.fillRect(0, 0, 512, 3);
  fg.fillRect(0, 254, 512, 3);
  fg.fillRect(0, 0, 3, 512);
  fg.fillRect(254, 0, 3, 512);
  const floor = toTexture(floorC);
  const floorBump = toTexture(heightFromNoise(fn, 512, 512), { srgb: false });

  // ── 벽 윗면: 철제 덮개
  const topC = makeCanvas(256, 256);
  const tg = topC.getContext('2d');
  paintNoise(tg, 256, 256, [46, 48, 50], 14, { seed: 13, cells: 6, octaves: 4 });
  blotches(tg, 256, 256, 8, 'rgba(110,60,30,0.25)', 10, 40, 4);
  const wallTop = toTexture(topC);

  // ── 작은 상자: 올리브색 보급 상자
  const crateC = makeCanvas(512, 256);
  const cg = crateC.getContext('2d');
  paintNoise(cg, 512, 256, [78, 82, 56], 14, { seed: 17, cells: 8, octaves: 4 });
  for (let y = 0; y < 256; y += 42) {
    cg.fillStyle = 'rgba(20,22,12,0.5)';
    cg.fillRect(0, y, 512, 3);
    cg.fillStyle = 'rgba(255,255,230,0.06)';
    cg.fillRect(0, y + 3, 512, 2);
  }
  cg.fillStyle = 'rgba(30,30,30,0.85)';
  for (const x of [0, 488]) cg.fillRect(x, 0, 24, 256);
  cg.fillStyle = 'rgba(220,214,190,0.85)';
  cg.font = `700 54px ${STENCIL}`;
  cg.textAlign = 'center';
  cg.fillText('F-LAB 07', 256, 112);
  cg.font = `500 22px ${FONT}`;
  cg.fillText('질량 25 kg · 무게 245 N', 256, 156);
  cg.font = `600 16px ${STENCIL}`;
  cg.fillText('HANDLE WITH CARE   ▲ THIS SIDE UP', 256, 196);
  blotches(cg, 512, 256, 12, 'rgba(200,190,160,0.12)', 6, 26, 2);
  const crate = toTexture(crateC);

  // ── 큰 상자: 녹슨 컨테이너
  const contC = makeCanvas(512, 512);
  const kg = contC.getContext('2d');
  paintNoise(kg, 512, 512, [52, 66, 72], 12, { seed: 23, cells: 8, octaves: 4 });
  for (let x = 0; x < 512; x += 28) {
    const grd = kg.createLinearGradient(x, 0, x + 28, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0.35)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.08)');
    grd.addColorStop(1, 'rgba(0,0,0,0.35)');
    kg.fillStyle = grd;
    kg.fillRect(x, 0, 28, 512);
  }
  const rr = rng(31);
  for (let i = 0; i < 30; i++) {
    const x = rr() * 512, len = 40 + rr() * 260;
    const grd = kg.createLinearGradient(0, 0, 0, len);
    grd.addColorStop(0, 'rgba(120,62,28,0.55)');
    grd.addColorStop(1, 'rgba(120,62,28,0)');
    kg.fillStyle = grd;
    kg.fillRect(x, rr() * 80, 3 + rr() * 6, len);
  }
  kg.fillStyle = 'rgba(16,20,22,0.85)';
  kg.fillRect(0, 0, 512, 22);
  kg.fillRect(0, 490, 512, 22);
  kg.fillStyle = 'rgba(215,215,205,0.8)';
  kg.font = `700 44px ${STENCIL}`;
  kg.textAlign = 'center';
  kg.fillText('FORCE BOUND LOGISTICS', 256, 200);
  kg.font = `500 24px ${FONT}`;
  kg.fillText('총질량 2,000 kg · 무게 19,600 N', 256, 246);
  kg.font = `600 20px ${STENCIL}`;
  kg.fillText('FBLU 220713 · MAX GROSS 30,480 KG', 256, 290);
  const container = toTexture(contC);

  // ── 낮은 방벽: 콘크리트 방호벽
  const barC = makeCanvas(512, 256);
  const bg = barC.getContext('2d');
  paintNoise(bg, 512, 256, [128, 128, 124], 20, { seed: 29, cells: 8, octaves: 4 });
  blotches(bg, 512, 256, 10, 'rgba(40,36,30,0.25)', 20, 60, 6);
  bg.save();
  bg.globalAlpha = 0.6;
  bg.beginPath();
  bg.rect(0, 26, 512, 28);
  bg.clip();
  bg.fillStyle = '#c9c6bd';
  bg.fillRect(0, 26, 512, 28);
  bg.fillStyle = '#9b2f2a';
  for (let x = -40; x < 560; x += 64) {
    bg.beginPath();
    bg.moveTo(x, 54);
    bg.lineTo(x + 32, 54);
    bg.lineTo(x + 60, 26);
    bg.lineTo(x + 28, 26);
    bg.fill();
  }
  bg.restore();
  const grime2 = bg.createLinearGradient(0, 256, 0, 180);
  grime2.addColorStop(0, 'rgba(30,26,20,0.7)');
  grime2.addColorStop(1, 'rgba(30,26,20,0)');
  bg.fillStyle = grime2;
  bg.fillRect(0, 180, 512, 76);
  const barrier = toTexture(barC);

  return { floor, floorBump, wall, wallBump, wallTop, crate, container, barrier };
}

// 위장 무늬 천 (팀별)
export function camoTexture(team) {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  const pal = team === 'defuse'
    ? { base: [60, 66, 74], blobs: ['#525a65', '#3a4049', '#6b737d', '#2a2f35'] }
    : { base: [112, 98, 74], blobs: ['#8d7a5a', '#5f523d', '#a8936c', '#4a4232'] };
  paintNoise(g, 256, 256, pal.base, 10, { seed: team === 'defuse' ? 41 : 43, cells: 4, octaves: 3 });
  const r = rng(team === 'defuse' ? 5 : 9);
  for (const col of pal.blobs) {
    g.fillStyle = col;
    for (let i = 0; i < 26; i++) {
      // 디지털 무늬: 작은 사각형 묶음
      const x = Math.floor((r() * 256) / 8) * 8, y = Math.floor((r() * 256) / 8) * 8;
      const n = 3 + Math.floor(r() * 7);
      for (let k = 0; k < n; k++) {
        const dx = Math.floor((r() - 0.5) * 5) * 8, dy = Math.floor((r() - 0.5) * 5) * 8;
        g.fillRect((x + dx + 256) % 256, (y + dy + 256) % 256, 8, 8);
      }
    }
  }
  return toTexture(c, { repeat: [1, 1] });
}

// 바닥에 페인트로 칠한 구역 글자
export function siteDecal(letter, color) {
  const c = makeCanvas(512, 512);
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.globalAlpha = 0.85;
  g.font = `700 ${300}px ${STENCIL}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 256, 270);
  g.lineWidth = 14;
  g.strokeStyle = color;
  g.strokeRect(40, 40, 432, 432);
  // 닳은 페인트: 군데군데 지우기
  g.globalCompositeOperation = 'destination-out';
  const n = valueNoise(128, 128, { seed: letter.charCodeAt(0), cells: 8, octaves: 3 });
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const v = n[y * 128 + x];
      if (v < 0.42) {
        g.globalAlpha = Math.min(1, (0.42 - v) * 6);
        g.fillRect(x * 4, y * 4, 4, 4);
      }
    }
  }
  return toTexture(c);
}

// 벽에 스프레이로 쓴 표시 (투명 배경)
export function sprayTexture(text, sub = '', color = '#e8e2d0') {
  const c = makeCanvas(512, 256);
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 6;
  g.font = `700 ${sub ? 128 : 150}px ${STENCIL}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, sub ? 104 : 128);
  if (sub) {
    g.shadowBlur = 3;
    g.font = `600 40px ${FONT}`;
    g.fillText(sub, 256, 200);
  }
  // 흘러내린 페인트
  const r = rng(text.charCodeAt(0) + 3);
  g.shadowBlur = 0;
  for (let i = 0; i < 7; i++) {
    const x = 160 + r() * 200, y = 150 + r() * 20, len = 10 + r() * 50;
    g.fillRect(x, y, 3, len);
  }
  return toTexture(c);
}

// 벽에 붙인 교범(코팅된 작전 문서)
// museum = true: 과학관 전시 설명판 (밝은 바탕, 기관명이 다름)
export function posterTexture({ title, no, lines, icon, museum = false }, { canvasOnly = false } = {}) {
  const c = makeCanvas(512, 704);
  const g = c.getContext('2d');
  paintNoise(g, 512, 704, museum ? [232, 229, 220] : [214, 209, 194], museum ? 4 : 8, { seed: no * 7 + 1, cells: 4, octaves: 3 });
  g.fillStyle = museum ? '#22324a' : '#1d2024';
  g.fillRect(0, 0, 512, 110);
  g.fillStyle = '#c9c3b2';
  g.font = `600 22px ${STENCIL}`;
  g.textAlign = 'left';
  g.fillText(museum ? `NATIONAL FORCE SCIENCE HALL · EXHIBIT ${String(no).padStart(2, '0')}` : `FIELD MANUAL · FM-${String(no).padStart(2, '0')}`, 28, 40);
  g.font = `700 52px ${FONT}`;
  g.fillStyle = '#f0ece2';
  g.fillText(title, 28, 92);
  if (icon) icon(g, 256, 270);
  g.fillStyle = '#23262a';
  g.font = `600 28px ${FONT}`;
  lines.forEach((l, i) => g.fillText(l, 28, 460 + i * 48));
  g.strokeStyle = 'rgba(30,30,30,0.5)';
  g.lineWidth = 2;
  g.strokeRect(14, 124, 484, 290);
  g.fillStyle = 'rgba(30,30,30,0.6)';
  g.font = `500 18px ${STENCIL}`;
  g.fillText(museum ? '국립 힘 과학관  ·  중학교 과학 「힘」' : 'FORCE BOUND RESEARCH FACILITY  ·  DISTRIBUTION: ALL UNITS', 28, 676);
  return canvasOnly ? c : toTexture(c);
}

// ── 과학관 테마: 광택 석재 타일 바닥 · 도장 패널 벽 (처음 쓸 때 한 번만 만듦)
let museumCache = null;
export function museumTextures() {
  if (museumCache) return museumCache;
  // 바닥: 2m 타일 2×2 (한 장 = 4m), 테라조 알갱이 + 얇은 줄눈
  const S = 512;
  const fc = makeCanvas(S, S);
  const fg = fc.getContext('2d');
  paintNoise(fg, S, S, [176, 172, 164], 10, { seed: 41, cells: 8, octaves: 4 });
  const fr = rng(43);
  for (let i = 0; i < 2600; i++) {
    const v = 90 + fr() * 120;
    fg.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.25 + fr() * 0.4})`;
    fg.fillRect(fr() * S, fr() * S, 1 + fr() * 3, 1 + fr() * 3);
  }
  const tile = S / 2;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      // 타일마다 아주 조금 다른 색
      fg.fillStyle = `rgba(${fr() < 0.5 ? 255 : 0},${fr() < 0.5 ? 255 : 0},${fr() < 0.5 ? 255 : 0},0.025)`;
      fg.fillRect(tx * tile, ty * tile, tile, tile);
    }
  }
  fg.fillStyle = 'rgba(70,68,64,0.5)';
  for (let i = 0; i <= 2; i++) {
    fg.fillRect(i * tile - 1, 0, 2, S);
    fg.fillRect(0, i * tile - 1, S, 2);
  }
  const fb = makeCanvas(S, S);
  const fbg = fb.getContext('2d');
  fbg.fillStyle = '#ffffff';
  fbg.fillRect(0, 0, S, S);
  fbg.fillStyle = '#000000';
  for (let i = 0; i <= 2; i++) {
    fbg.fillRect(i * tile - 1.5, 0, 3, S);
    fbg.fillRect(0, i * tile - 1.5, S, 3);
  }
  // 벽: 4m × 4.8m, 밝은 도장 패널 + 2m 이음새 + 걸레받이 + 1.1m 높이 남색 띠
  const wc = makeCanvas(512, 614);
  const wg = wc.getContext('2d');
  paintNoise(wg, 512, 614, [196, 192, 184], 6, { seed: 47, cells: 6, octaves: 3 });
  const px = 614 / 4.8;
  wg.fillStyle = '#2b3a52';
  wg.fillRect(0, 614 - 1.12 * px, 512, 0.08 * px);
  wg.fillStyle = '#3a3c40';
  wg.fillRect(0, 614 - 0.16 * px, 512, 0.16 * px);
  wg.fillStyle = 'rgba(70,68,64,0.6)';
  wg.fillRect(0, 0, 2, 614);
  wg.fillRect(255, 0, 2, 614);
  const grad = wg.createLinearGradient(0, 0, 0, 160);
  grad.addColorStop(0, 'rgba(20,20,22,0.35)');
  grad.addColorStop(1, 'rgba(20,20,22,0)');
  wg.fillStyle = grad;
  wg.fillRect(0, 0, 512, 160);
  const wb = makeCanvas(256, 307);
  const wbg = wb.getContext('2d');
  wbg.fillStyle = '#ffffff';
  wbg.fillRect(0, 0, 256, 307);
  wbg.fillStyle = '#000000';
  wbg.fillRect(0, 0, 2, 307);
  wbg.fillRect(127, 0, 2, 307);
  wbg.fillRect(0, 307 - 0.16 * (307 / 4.8), 256, 2);
  const top = makeCanvas(64, 64);
  const tg = top.getContext('2d');
  paintNoise(tg, 64, 64, [44, 46, 50], 6, { seed: 53, cells: 4, octaves: 2 });
  museumCache = {
    floor: toTexture(fc),
    floorBump: toTexture(fb, { srgb: false }),
    wall: toTexture(wc),
    wallBump: toTexture(wb, { srgb: false }),
    wallTop: toTexture(top),
  };
  return museumCache;
}

// 이름표용 스프라이트 텍스처
export function labelTexture(text, color = '#ffffff') {
  const c = makeCanvas(320, 72);
  const g = c.getContext('2d');
  g.font = `600 34px ${FONT}`;
  const tw = Math.min(300, g.measureText(text).width + 26);
  g.fillStyle = 'rgba(8,10,12,0.72)';
  g.fillRect((320 - tw) / 2, 12, tw, 48);
  g.fillStyle = color;
  g.fillRect((320 - tw) / 2, 12, 4, 48);
  g.fillStyle = '#e8eaec';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 162, 37);
  return toTexture(c);
}

// 부드러운 빛 점 (파티클)
export function glowTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c, { srgb: false });
}

// 연기 덩어리
export function smokeTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const n = valueNoise(128, 128, { seed: 77, cells: 4, octaves: 4 });
  const img = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const d = Math.hypot(x - 64, y - 64) / 64;
      const a = Math.max(0, 1 - d) ** 1.5 * (0.4 + n[y * 128 + x] * 0.8);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// 총구 화염 (별 모양 + 중심 섬광)
export function flashTexture() {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  g.translate(128, 128);
  const r = rng(5);
  for (let i = 0; i < 9; i++) {
    g.rotate((Math.PI * 2) / 9 + (r() - 0.5) * 0.3);
    const len = 70 + r() * 55;
    const grd = g.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, 'rgba(255,244,214,1)');
    grd.addColorStop(0.5, 'rgba(255,186,90,0.7)');
    grd.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(len, 0);
    g.lineTo(0, 9);
    g.fill();
  }
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 60);
  grd.addColorStop(0, 'rgba(255,255,245,1)');
  grd.addColorStop(0.5, 'rgba(255,210,140,0.55)');
  grd.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = grd;
  g.fillRect(-128, -128, 256, 256);
  return toTexture(c, { srgb: false });
}

export function holeTexture() {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(8,8,8,0.95)');
  grd.addColorStop(0.3, 'rgba(18,18,18,0.85)');
  grd.addColorStop(0.55, 'rgba(60,58,54,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

// 폭탄 화면 (남은 시간). 값이 바뀔 때만 다시 그림.
export function createBombScreen() {
  const c = makeCanvas(256, 128);
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (text, color, sub) => {
    g.fillStyle = '#050605';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = color;
    g.globalAlpha = 0.08;
    for (let y = 0; y < 128; y += 3) g.fillRect(0, y, 256, 1);
    g.globalAlpha = 1;
    g.font = `700 70px ${STENCIL}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 56);
    g.font = `500 20px ${FONT}`;
    g.fillText(sub, 128, 106);
    tex.needsUpdate = true;
  };
  return { texture: tex, draw };
}

// 개념 카드 (맵에 떠 있는 홀로그램 카드): 이름과 짧은 설명
const cardCache = new Map();
export function conceptCardTexture(concept) {
  if (cardCache.has(concept.id)) return cardCache.get(concept.id);
  const W = 256, H = 356;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,24,32,0.82)';
  roundRect(g, 4, 4, W - 8, H - 8, 18);
  g.fill();
  g.strokeStyle = 'rgba(111,211,232,0.95)';
  g.lineWidth = 4;
  roundRect(g, 4, 4, W - 8, H - 8, 18);
  g.stroke();
  g.fillStyle = '#6fd3e8';
  g.font = `600 20px ${STENCIL}`;
  g.textAlign = 'center';
  g.fillText('CONCEPT CARD', W / 2, 42);
  g.font = `700 64px ${STENCIL}`;
  g.fillText('F', W / 2, 140);
  g.fillStyle = '#e8f6fa';
  g.font = `700 ${concept.name.length > 6 ? 26 : 34}px ${FONT}`;
  g.fillText(concept.name, W / 2, 210);
  g.fillStyle = 'rgba(232,246,250,0.7)';
  g.font = `500 17px ${FONT}`;
  g.fillText('가까이 가면 도감에 기록', W / 2, 310);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cardCache.set(concept.id, t);
  return t;
}
