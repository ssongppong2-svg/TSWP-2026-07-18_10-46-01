// 맵 랜드마크 모형: 칸(충돌) 위에 덮어씌우는 큰 장식 — 원자로 노심 · 화물 셔틀
//   충돌은 맵 글자 그대로 (원자로 = 천장까지 닿는 벽 기둥 '#', 셔틀 = 2.2 m 큰 상자 'C')이고, 모형은 그 둘레를 감쌈
//   decor.landmarks: [{ type: 'reactor' | 'shuttle', r0, r1, c0, c1, dir? }]
import * as THREE from 'three';
import { CELL } from '../sim/constants.js';
import { ROOF } from '../sim/map.js';

const STEEL = () => new THREE.MeshStandardMaterial({ color: '#4a525c', roughness: 0.42, metalness: 0.75 });
const DARK = () => new THREE.MeshStandardMaterial({ color: '#23282f', roughness: 0.5, metalness: 0.7 });

// 위로 흐르는 에너지 띠 (원자로 노심 유리 안)
function energyTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  for (let i = 0; i <= 8; i++) grd.addColorStop(i / 8, i % 2 ? 'rgb(40,150,210)' : 'rgb(170,245,255)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 2, 6 + Math.random() * 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
}

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#1c1f24';
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#e8b830';
  for (let x = -32; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 48, 0);
    g.lineTo(x + 32, 0);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

// 원자로: 팔각 기단·아래 몸체(빛나는 틈) · 가운데 유리 노심(에너지 띠가 위로 흐름) · 갈비 기둥 · 위 덮개 · 천장으로 이어진 관
function reactor(map, q) {
  const g = new THREE.Group();
  const cx = map.originX + ((q.c0 + q.c1 + 1) / 2) * CELL, cz = map.originZ + ((q.r0 + q.r1 + 1) / 2) * CELL;
  const half = ((q.c1 - q.c0 + 1) * CELL) / 2;
  const R = half * Math.SQRT2 + 0.08; // 기둥 모서리를 덮는 팔각 반지름
  g.position.set(cx, 0, cz);
  const steel = STEEL(), dark = DARK();
  const glow = new THREE.MeshBasicMaterial({ color: '#5fe6ff', toneMapped: false });
  const energy = energyTexture();
  const coreMat = new THREE.MeshStandardMaterial({ color: '#0b2430', emissive: '#ffffff', emissiveMap: energy, emissiveIntensity: 1.1, roughness: 0.15, metalness: 0.1 });
  const oct = (r, h, y, mat) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), mat);
    m.position.y = y + h / 2;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  oct(R + 0.25, 0.45, 0, new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, metalness: 0.3 }));
  oct(R, 1.9, 0.45, steel);
  oct(R - 0.05, 2.8, 2.35, coreMat);
  oct(R, 1.1, 5.15, steel);
  oct(R - 0.3, ROOF - 6.25, 6.25, dark);
  // 팔각 모서리마다 갈비 기둥 + 아래 몸체의 빛나는 세로 틈
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.9, 0.28), dark);
    rib.position.set(Math.sin(a) * (R + 0.02), 2.35 + 1.4, Math.cos(a) * (R + 0.02));
    rib.rotation.y = a;
    g.add(rib);
    const b = a + Math.PI / 8;
    const ap = R * Math.cos(Math.PI / 8) + 0.01;
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.03), glow);
    slit.position.set(Math.sin(b) * ap, 1.4, Math.cos(b) * ap);
    slit.rotation.y = b;
    g.add(slit);
  }
  // 빛 고리 (노심 위아래)
  for (const y of [2.35, 5.15]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.06, 0.07, 8, 48), glow);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  // 천장으로 올라가는 냉각관 4개
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, ROOF - 6.0, 12), steel);
    pipe.position.set(Math.sin(a) * (R - 0.1), 6.0 + (ROOF - 6.0) / 2, Math.cos(a) * (R - 0.1));
    g.add(pipe);
  }
  g.userData.tick = (t) => {
    energy.offset.y = -t * 0.25;
    coreMat.emissiveIntensity = 0.95 + Math.sin(t * 2.2) * 0.2;
  };
  return g;
}

// 화물 셔틀: 네모난 몸체 + 기울어진 앞 유리 · 착륙 다리 · 뒤 엔진 2개 · 옆 문 · 주황 띠 (충돌 상자 2.2 m 안에 맞춤)
function shuttle(map, q) {
  const g = new THREE.Group();
  const w = (q.c1 - q.c0 + 1) * CELL, d = (q.r1 - q.r0 + 1) * CELL;
  const along = w >= d; // 긴 쪽이 앞뒤
  const L = Math.max(w, d) - 0.25, W = Math.min(w, d) - 0.3;
  g.position.set(map.originX + ((q.c0 + q.c1 + 1) / 2) * CELL, 0, map.originZ + ((q.r0 + q.r1 + 1) / 2) * CELL);
  g.rotation.y = (along ? 0 : Math.PI / 2) + (q.dir === -1 ? Math.PI : 0);
  const hull = new THREE.MeshStandardMaterial({ color: '#e4e8ec', roughness: 0.45, metalness: 0.25 });
  const panel = new THREE.MeshStandardMaterial({ color: '#b9c0c8', roughness: 0.5, metalness: 0.35 });
  const orange = new THREE.MeshStandardMaterial({ color: '#e0782a', roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: '#0e1a24', roughness: 0.08, metalness: 0.6, emissive: '#1a3a50', emissiveIntensity: 0.4 });
  const dark = DARK();
  const glow = new THREE.MeshBasicMaterial({ color: '#7fd0ff', toneMapped: false });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const yb = 0.5, H = 2.15 - yb; // 몸체 아래·높이
  const noseL = 1.4, tail = 0.45; // 뒤 엔진 자리만큼 몸체를 줄임 (엔진이 충돌 상자 밖으로 나가지 않게)
  const bodyL = L - noseL - tail, bodyX = (tail - noseL) / 2;
  add(new THREE.BoxGeometry(bodyL, H, W), hull, bodyX, yb + H / 2, 0);
  // 앞부분: 아래는 몸체, 위는 비스듬한 앞 유리 (옆에서 보면 사다리꼴)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(noseL, 0);
  shape.lineTo(noseL, H * 0.45);
  shape.lineTo(noseL * 0.25, H);
  shape.lineTo(0, H);
  shape.closePath();
  const nose = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  nose.translate(0, 0, -W / 2);
  add(nose, hull, L / 2 - noseL, yb, 0);
  // 앞 유리 (기울어진 면에 붙임)
  const slope = Math.atan2(H * 0.55, noseL * 0.75);
  const glassLen = Math.hypot(H * 0.55, noseL * 0.75);
  // 앞 유리 두 장 (가운데 창틀)
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(glassLen * 0.55, 0.03, W * 0.27), glass, L / 2 - noseL * 0.42, yb + H * 0.758 + 0.025, s * W * 0.16, 0, 0, -slope); // 비스듬한 면 위의 점 (t = 0.56)
  // 배 아래 열 차폐판 (짙은 회색 띠) · 꼬리 날개 · 짧은 날개
  add(new THREE.BoxGeometry(bodyL + noseL * 0.9, 0.3, W + 0.04), dark, bodyX + noseL * 0.42, yb + 0.15, 0);
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(1.5, 0);
  fin.lineTo(0.5, 0.9);
  fin.lineTo(0, 0.9);
  fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.08, bevelEnabled: false });
  finGeo.translate(0, 0, -0.04);
  add(finGeo, hull, -L / 2 + tail, yb + H, 0);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(1.6, 0.08, 0.2), panel, bodyX - 0.6, yb + H * 0.3, s * (W / 2 + 0.1), 0, 0, 0);
  // 주황 띠 · 옆 문 · 창
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(bodyL - 0.2, 0.16, 0.02), orange, bodyX, yb + H * 0.35, s * (W / 2 + 0.01));
    add(new THREE.BoxGeometry(1.1, H * 0.78, 0.02), panel, -0.4, yb + H * 0.45, s * (W / 2 + 0.012));
    for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.42, 0.26, 0.02), glass, -L / 2 + 1.2 + k * 0.7, yb + H * 0.72, s * (W / 2 + 0.012));
  }
  // 지붕: 안테나 · 자세 제어 분사구
  add(new THREE.BoxGeometry(L * 0.5, 0.1, W * 0.6), panel, -0.6, yb + H + 0.05, 0);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), dark, -L / 2 + 1, yb + H + 0.35, W * 0.25);
  for (const [x, z] of [[L / 2 - noseL - 0.3, W / 2], [L / 2 - noseL - 0.3, -W / 2], [-L / 2 + tail + 0.2, W / 2], [-L / 2 + tail + 0.2, -W / 2]]) add(new THREE.BoxGeometry(0.22, 0.22, 0.22), dark, x, yb + H - 0.2, z * 0.98);
  // 착륙 다리 4개 + 발판
  for (const [x, z] of [[L / 2 - 1.2, W / 2 - 0.4], [L / 2 - 1.2, -W / 2 + 0.4], [-L / 2 + 0.9, W / 2 - 0.4], [-L / 2 + 0.9, -W / 2 + 0.4]]) {
    add(new THREE.CylinderGeometry(0.08, 0.1, yb + 0.1, 8), dark, x, (yb + 0.1) / 2, z);
    add(new THREE.CylinderGeometry(0.28, 0.32, 0.06, 12), dark, x, 0.03, z);
  }
  // 뒤 엔진 2개 (빛나는 분사구)
  for (const s of [-1, 1]) {
    const bell = add(new THREE.CylinderGeometry(0.42, 0.28, tail + 0.05, 16, 1, true), dark, -L / 2 + tail / 2, yb + H * 0.5, s * W * 0.25, 0, 0, Math.PI / 2);
    bell.material = new THREE.MeshStandardMaterial({ color: '#30353c', roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide });
    add(new THREE.CircleGeometry(0.3, 16), glow, -L / 2 + tail - 0.08, yb + H * 0.5, s * W * 0.25, 0, -Math.PI / 2, 0);
  }
  return g;
}

export function buildLandmarks(map) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const ticks = [];
  for (const q of map.def.decor?.landmarks ?? []) {
    const m = q.type === 'reactor' ? reactor(map, q) : q.type === 'shuttle' ? shuttle(map, q) : null;
    if (!m) continue;
    group.add(m);
    if (m.userData.tick) ticks.push(m.userData.tick);
  }
  if (ticks.length) group.userData.tick = (t) => ticks.forEach((f) => f(t));
  return group;
}

// 랜드마크가 덮는 칸 (그 칸의 상자 모양·벽 소품은 그리지 않음)
export function landmarkCells(map) {
  const list = map.def.decor?.landmarks ?? [];
  return (c, r) => list.some((q) => r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1);
}
