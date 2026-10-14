// 맵 랜드마크 모형: 칸(충돌) 위에 덮어씌우는 큰 장식 — 원자로 노심 · 화물 셔틀 · 거대한 소화전
//   충돌은 맵 글자 그대로 (원자로 = 천장까지 닿는 벽 기둥 '#', 셔틀 = 2.2 m 큰 상자 'C')이고, 모형은 그 둘레를 감쌈
//   decor.landmarks: [{ type: 'reactor' | 'shuttle' | 'hydrant', r0, r1, c0, c1, dir? }]
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

// 거대한 소화전: 빨간 몸통(팔각 기둥 모서리를 덮는 원기둥) · 아래 받침 테·볼트 · 옆 배출구 마개 2개 · 둥근 머리 · 꼭대기 너트
//   충돌은 2×2 칸 벽 기둥(2층 벽까지 7.2 m) — 모형 높이도 그에 맞춤
function hydrant(map, q) {
  const g = new THREE.Group();
  g.position.set(map.originX + ((q.c0 + q.c1 + 1) / 2) * CELL, 0, map.originZ + ((q.r0 + q.r1 + 1) / 2) * CELL);
  const half = ((q.c1 - q.c0 + 1) * CELL) / 2;
  const R = half * Math.SQRT2 + 0.06; // 기둥 모서리를 덮는 반지름
  const paint = new THREE.MeshStandardMaterial({ map: chippedPaint('#c8221c', 41), roughness: 0.5, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: '#5a1410', roughness: 0.6, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: '#8a9096', roughness: 0.35, metalness: 0.8 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(R + 0.45, R + 0.6, 0.5, 40), dark, 0, 0.25, 0); // 받침 테
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 8), steel, Math.cos(a) * (R + 0.3), 0.58, Math.sin(a) * (R + 0.3));
  }
  add(new THREE.CylinderGeometry(R, R + 0.08, 4.7, 40), paint, 0, 0.5 + 2.35, 0); // 몸통
  add(new THREE.CylinderGeometry(R + 0.22, R + 0.22, 0.35, 40), paint, 0, 5.2, 0); // 위 테
  add(new THREE.SphereGeometry(R * 0.92, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2), paint, 0, 5.35, 0); // 둥근 머리
  add(new THREE.CylinderGeometry(0.55, 0.75, 0.55, 5), steel, 0, 5.35 + R * 0.92 + 0.12, 0); // 꼭대기 너트 (오각형)
  // 옆 배출구 2개 (서로 반대쪽) + 사슬 고리
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.75, 0.85, 0.9, 24), paint, s * (R + 0.35), 3.4, 0, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.8, 0.8, 0.28, 6), steel, s * (R + 0.85), 3.4, 0, 0, 0, Math.PI / 2);
  }
  // 앞쪽 큰 배출구
  add(new THREE.CylinderGeometry(1.0, 1.1, 0.9, 24), paint, 0, 2.8, R + 0.35, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(1.05, 1.05, 0.3, 6), steel, 0, 2.8, R + 0.85, Math.PI / 2, 0, 0);
  return g;
}

// 칠이 벗겨진 금속 (바탕색 + 녹 · 긁힘 · 흰 줄무늬 반사띠)
function chippedPaint(color, seed) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 512);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(${90 + rnd() * 40},${50 + rnd() * 20},${30},${0.3 + rnd() * 0.5})`;
    g.beginPath();
    g.ellipse(rnd() * 512, rnd() * 512, 3 + rnd() * 16, 2 + rnd() * 8, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(245,245,245,0.85)';
  g.fillRect(0, 300, 512, 26);
  const shade = g.createLinearGradient(0, 0, 0, 512);
  shade.addColorStop(0, 'rgba(255,255,255,0.08)');
  shade.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = shade;
  g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 같은 재질끼리 한 덩어리로 합침 (부품 수십 개 → 그리기 몇 번) · 움직이지 않는 모형에만
export function bakeGroup(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const buckets = new Map();
  g.traverse((m) => {
    if (!m.isMesh) return;
    const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    geo.clearGroups();
    const b = buckets.get(m.material) ?? { geos: [], shadow: false };
    b.geos.push(geo);
    b.shadow ||= m.castShadow;
    buckets.set(m.material, b);
  });
  const out = new THREE.Group();
  out.position.copy(g.position);
  out.quaternion.copy(g.quaternion);
  out.scale.copy(g.scale);
  for (const [mat, b] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(b.geos), mat);
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    out.add(mesh);
    for (const geo of b.geos) geo.dispose();
  }
  out.userData = g.userData;
  return out;
}

export function buildLandmarks(map) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const ticks = [];
  for (const q of map.def.decor?.landmarks ?? []) {
    const raw = q.type === 'reactor' ? reactor(map, q) : q.type === 'shuttle' ? shuttle(map, q) : q.type === 'hydrant' ? hydrant(map, q) : null;
    if (!raw) continue;
    const m = bakeGroup(raw);
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

// 바닥 무늬 (decor.floorPaint): 횡단보도 흰 띠 · 인도 보도블록 · 맨홀 뚜껑 · 바닥에 떨어진 거인의 휴대폰 화면
//   바닥 바로 위 얇은 판 (충돌 없음) · 같은 종류끼리 한 덩어리
export function buildFloorPaint(map) {
  const group = new THREE.Group();
  group.name = 'floorPaint';
  const geos = { crosswalk: [], sidewalk: [], manhole: [], phone: [] };
  const rect = (q, y) => {
    const x0 = map.originX + q.c0 * CELL, x1 = map.originX + (q.c1 + 1) * CELL;
    const z0 = map.originZ + q.r0 * CELL, z1 = map.originZ + (q.r1 + 1) * CELL;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    // 세계 좌표로 UV (무늬 크기가 판 크기와 상관없이 같게): 4 m = 1
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 4, -pos.getZ(i) / 4);
    return g;
  };
  for (const q of map.def.decor?.floorPaint ?? []) {
    if (q.kind === 'crosswalk') geos.crosswalk.push(rect(q, 0.018));
    else if (q.kind === 'sidewalk') geos.sidewalk.push(rect(q, 0.012));
    else if (q.kind === 'manhole') geos.manhole.push(new THREE.CircleGeometry(2.6, 40).rotateX(-Math.PI / 2).translate(map.cellX(q.c), 0.022, map.cellZ(q.r)));
    else if (q.kind === 'phone') {
      const g = rect(q, 0.025);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, i % 2, i < 2 ? 1 : 0); // 화면 한 장
      geos.phone.push(g);
    }
  }
  const decal = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 };
  const mats = {
    crosswalk: () => new THREE.MeshStandardMaterial({ map: paintTexture('crosswalk'), roughness: 0.8, ...decal }),
    sidewalk: () => new THREE.MeshStandardMaterial({ map: paintTexture('sidewalk'), roughness: 0.9, ...decal }),
    manhole: () => new THREE.MeshStandardMaterial({ map: paintTexture('manhole'), roughness: 0.45, metalness: 0.6, ...decal }),
    phone: () => new THREE.MeshStandardMaterial({ map: paintTexture('phone'), emissiveMap: paintTexture('phone'), emissive: '#ffffff', emissiveIntensity: 0.8, roughness: 0.15, ...decal }),
  };
  for (const [k, list] of Object.entries(geos)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), mats[k]());
    m.receiveShadow = true;
    m.renderOrder = k === 'sidewalk' ? 1 : 2;
    group.add(m);
  }
  return group;
}

function paintTexture(kind) {
  const c = document.createElement('canvas');
  const S = kind === 'phone' ? 512 : 256;
  c.width = S;
  c.height = kind === 'phone' ? 256 : S;
  const g = c.getContext('2d');
  let s = { crosswalk: 3, sidewalk: 5, manhole: 7, phone: 9 }[kind];
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  if (kind === 'crosswalk') {
    // 4 m마다 흰 띠 (가운데 2 m) · 닳은 자국
    g.fillStyle = 'rgba(236,236,228,0.92)';
    g.fillRect(S * 0.25, 0, S * 0.5, S);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.6})`;
      g.beginPath();
      g.ellipse(S * 0.25 + rnd() * S * 0.5, rnd() * S, 2 + rnd() * 10, 1 + rnd() * 5, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'sidewalk') {
    // 4 m 보도블록 두 장 (밝은 회색 · 이음매 · 얼룩)
    g.fillStyle = 'rgba(176,172,164,0.96)';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const v = 120 + rnd() * 90;
      g.fillStyle = `rgba(${v},${v},${v - 6},0.35)`;
      g.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
    g.fillStyle = 'rgba(70,68,64,0.9)';
    g.fillRect(0, 0, S, 4);
    g.fillRect(0, 0, 4, S);
    g.fillRect(0, S / 2, S, 3);
  } else if (kind === 'manhole') {
    const R = S / 2;
    g.fillStyle = '#3a3c40';
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#25272a';
    g.lineWidth = 10;
    g.stroke();
    g.strokeStyle = 'rgba(120,124,130,0.8)';
    g.lineWidth = 4;
    for (let r = 30; r < R - 10; r += 22) {
      g.beginPath();
      g.arc(R, R, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(200,204,210,0.85)';
    g.font = '800 26px "Rajdhani", sans-serif';
    g.textAlign = 'center';
    g.fillText('거인시 하수도', R, R + 9);
  } else {
    // 휴대폰 화면: 검은 테두리 · 밝은 잠금 화면 · 시계 · 알림
    g.fillStyle = '#0c0e12';
    g.fillRect(0, 0, 512, 256);
    const grd = g.createLinearGradient(0, 0, 512, 256);
    grd.addColorStop(0, '#3a6ad8');
    grd.addColorStop(1, '#8a4ad8');
    g.fillStyle = grd;
    g.fillRect(18, 18, 476, 220);
    g.fillStyle = '#ffffff';
    g.font = '700 70px "Rajdhani", sans-serif';
    g.textAlign = 'center';
    g.fillText('12:07', 256, 110);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    roundRectPath(g, 120, 140, 272, 70, 14);
    g.fill();
    g.fillStyle = '#20242c';
    g.font = '700 22px "Pretendard", "Noto Sans KR", sans-serif';
    g.fillText('알림 · 발밑에 작은 요원이 있어요', 256, 182);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
