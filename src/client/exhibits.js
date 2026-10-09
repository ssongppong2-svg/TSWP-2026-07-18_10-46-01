import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from '../sim/constants.js';
import { TILES } from '../sim/map.js';
import { makeSolidMaterial } from './agent-view.js';
import { CEILING_Y } from './ceiling.js';

// 과학 전시물·실험 장비. 모양이 같은 것끼리 InstancedMesh로 한 번에 그린다.
// 단색 부품은 정점 색 + 정점별 거칠기·금속성(makeSolidMaterial) → 종류당 그리기 호출 1번.

const V3 = THREE.Vector3;

// 부품 하나: 형상을 옮기고 정점 색·거칠기·금속성을 붙임
export function part(geo, color, rough = 0.6, metal = 0, p = [0, 0, 0], r = [0, 0, 0], s = 1, emit = 0) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const sc = Array.isArray(s) ? s : [s, s, s];
  const m = new THREE.Matrix4().compose(new V3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new V3(...sc));
  g.applyMatrix4(m);
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  const rme = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col.set([c.r, c.g, c.b], i * 3);
    rme.set([rough, metal, emit], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRME', new THREE.BufferAttribute(rme, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  geo.dispose();
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, seg = 14) => new THREE.CylinderGeometry(r1, r2, h, seg);
const sph = (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);

// 용수철 (나선 관)
class Helix extends THREE.Curve {
  constructor(r, len, turns) {
    super();
    this.r = r;
    this.len = len;
    this.turns = turns;
  }
  getPoint(t, target = new V3()) {
    const a = t * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.r, -t * this.len, Math.sin(a) * this.r);
  }
}
const spring = (r, len, turns, wire = 0.006) => new THREE.TubeGeometry(new Helix(r, len, turns), Math.round(turns * 14), wire, 5, false);
// 화살표 (힘의 방향 표시): 위를 향함, 원점 = 꼬리
const arrowParts = (color, len, p, r) => [
  part(cyl(0.012, 0.012, len - 0.06, 8), color, 0.5, 0, [0, (len - 0.06) / 2, 0]),
  part(new THREE.ConeGeometry(0.035, 0.07, 10), color, 0.5, 0, [0, len - 0.035, 0]),
].map((g) => g.applyMatrix4(new THREE.Matrix4().compose(new V3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new V3(1, 1, 1))));

const WOOD = '#8a6a48', DARKWOOD = '#4a3a2c', BRASS = '#b48a3e', STEEL = '#9aa0a6', DARK = '#26282b', RED = '#c0392b', BLUE = '#2f6fb5';

// 작은 전시물 (바닥 = y 0, 높이 0.5m 안, 폭 ±0.5m 안). 진열장 안이나 실험 상자 위에 놓임
const SMALL = {
  // 용수철저울: 매단 추가 무거울수록 많이 늘어남
  springs() {
    const out = [
      part(box(0.9, 0.03, 0.34), DARKWOOD, 0.7, 0, [0, 0.015, 0]),
      part(box(0.025, 0.5, 0.025), STEEL, 0.35, 0.8, [-0.42, 0.25, 0]),
      part(box(0.025, 0.5, 0.025), STEEL, 0.35, 0.8, [0.42, 0.25, 0]),
      part(box(0.88, 0.025, 0.03), STEEL, 0.35, 0.8, [0, 0.49, 0]),
      part(box(0.04, 0.42, 0.006), '#e8e2cf', 0.6, 0, [0.33, 0.27, -0.06]),
    ];
    [[-0.24, 0.1, 0.03], [0, 0.18, 0.05], [0.22, 0.27, 0.07]].forEach(([x, len, mass]) => {
      out.push(part(spring(0.022, len, 8 + len * 30), STEEL, 0.3, 0.85, [x, 0.48, 0]));
      out.push(part(cyl(0.035, 0.035, mass, 16), BRASS, 0.3, 0.9, [x, 0.48 - len - mass / 2, 0]));
    });
    return out;
  },
  // 윗접시저울: 추와 물체의 무게가 같으면 평형
  balance() {
    const out = [
      part(box(0.6, 0.04, 0.26), DARKWOOD, 0.7, 0, [0, 0.02, 0]),
      part(cyl(0.02, 0.025, 0.3, 10), STEEL, 0.35, 0.8, [0, 0.19, 0]),
      part(box(0.62, 0.02, 0.025), STEEL, 0.35, 0.8, [0, 0.34, 0]),
      part(new THREE.ConeGeometry(0.03, 0.05, 3), BRASS, 0.3, 0.9, [0, 0.37, 0]),
    ];
    for (const x of [-0.28, 0.28]) {
      out.push(part(cyl(0.004, 0.004, 0.1, 6), STEEL, 0.35, 0.8, [x, 0.29, 0]));
      out.push(part(cyl(0.1, 0.09, 0.012, 20), STEEL, 0.3, 0.85, [x, 0.24, 0]));
    }
    // 왼쪽: 추 세 개 / 오른쪽: 나무토막
    [[0.04, 0.03], [0.034, 0.028], [0.026, 0.024]].reduce((y, [r, h]) => {
      out.push(part(cyl(r, r, h, 14), BRASS, 0.3, 0.9, [-0.28, y + h / 2, 0]));
      return y + h;
    }, 0.246);
    out.push(part(box(0.1, 0.08, 0.08), WOOD, 0.75, 0, [0.28, 0.286, 0]));
    return out;
  },
  // 빗면과 나무토막: 마찰력은 미끄러지는 방향의 반대
  ramp() {
    const sh = new THREE.Shape([new THREE.Vector2(-0.4, 0), new THREE.Vector2(0.4, 0), new THREE.Vector2(0.4, 0.28)]);
    const wedge = new THREE.ExtrudeGeometry(sh, { depth: 0.24, bevelEnabled: false });
    wedge.translate(0, 0, -0.12);
    const ang = Math.atan2(0.28, 0.8);
    const out = [
      part(box(0.9, 0.03, 0.3), DARKWOOD, 0.7, 0, [0, 0.015, 0]),
      part(wedge, '#c9c3b2', 0.8, 0, [0, 0.03, 0]),
      part(box(0.12, 0.07, 0.1), WOOD, 0.75, 0, [0.05, 0.03 + 0.175 + 0.035 * Math.cos(ang), 0], [0, 0, ang]),
    ];
    // 마찰력 화살표 (빗면 위쪽 방향)
    out.push(...arrowParts(RED, 0.2, [0.13, 0.27, 0.08], [0, 0, -(Math.PI / 2 - ang)]));
    return out;
  },
  // 진자: 줄의 길이가 같으면 주기가 같음
  pendulum() {
    const out = [
      part(box(0.7, 0.03, 0.3), DARKWOOD, 0.7, 0, [0, 0.015, 0]),
      part(box(0.025, 0.48, 0.025), STEEL, 0.35, 0.8, [-0.3, 0.27, 0]),
      part(box(0.025, 0.48, 0.025), STEEL, 0.35, 0.8, [0.3, 0.27, 0]),
      part(box(0.62, 0.025, 0.03), STEEL, 0.35, 0.8, [0, 0.5, 0]),
      part(cyl(0.003, 0.003, 0.34, 6), '#d8d2c4', 0.6, 0, [0.06, 0.33, 0], [0, 0, 0.35]),
      part(sph(0.04), BRASS, 0.25, 0.9, [0.12, 0.17, 0]),
      part(new THREE.TorusGeometry(0.3, 0.004, 4, 24, Math.PI / 2), '#e8e2cf', 0.6, 0, [0, 0.49, 0.02], [0, 0, -Math.PI * 0.75]),
    ];
    return out;
  },
  // 부력: 물에 뜬 나무토막 (부력 = 중력)
  beaker() {
    const out = [
      part(box(0.5, 0.03, 0.3), DARKWOOD, 0.7, 0, [0, 0.015, 0]),
      part(cyl(0.14, 0.13, 0.3, 24), '#2f6f8f', 0.15, 0.1, [0, 0.18, 0]),
      part(new THREE.TorusGeometry(0.142, 0.006, 4, 24), STEEL, 0.3, 0.8, [0, 0.33, 0], [Math.PI / 2, 0, 0]),
      part(box(0.1, 0.08, 0.1), WOOD, 0.75, 0, [0, 0.34, 0], [0, 0.4, 0]),
    ];
    out.push(...arrowParts(BLUE, 0.16, [0.17, 0.2, 0], [0, 0, 0]));
    out.push(...arrowParts(RED, 0.16, [-0.17, 0.36, 0], [Math.PI, 0, 0]));
    return out;
  },
};
const SMALL_KEYS = Object.keys(SMALL);
const smallCache = new Map();
const smallGeo = (key) => {
  if (!smallCache.has(key)) smallCache.set(key, mergeGeometries(SMALL[key]()));
  return smallCache.get(key);
};

const hash = (c, r) => ((c * 73856093) ^ (r * 19349663)) >>> 0;

// 셀 목록 → 종류별 InstancedMesh
function instanced(geo, mat, cells, place) {
  const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
  const m = new THREE.Matrix4();
  cells.forEach((cell, i) => {
    place(m, cell);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// 그 종류의 상자 칸 목록 { c, r, y } (2층 바닥 위의 상자도 포함)
function cellsOf(map, kind, skip = () => false) {
  return map.props.filter((p) => p.kind === kind && !skip(p.c, p.r)).map(({ c, r, y }) => ({ c, r, y }));
}

// 방금 넣은 부품들을 그 칸의 바닥 높이만큼 올림
function liftFrom(list, start, y) {
  if (!y) return;
  for (let i = start; i < list.length; i++) list[i].translate(0, y, 0);
}

// ── 포스 바운드: 작은 상자 위의 실험 장비 (상자 5개 중 2개꼴)
export function buildLabProps(map) {
  const group = new THREE.Group();
  group.name = 'labProps';
  const mat = makeSolidMaterial({ strobe: 0 });
  const by = {};
  for (const cell of cellsOf(map, 'crate')) {
    const h = hash(cell.c, cell.r);
    if (h % 5 >= 2) continue;
    (by[SMALL_KEYS[h % SMALL_KEYS.length]] ??= []).push(cell);
  }
  const q = new THREE.Quaternion();
  for (const [key, cells] of Object.entries(by)) {
    const mesh = instanced(smallGeo(key), mat, cells, (m, { c, r, y }) => {
      q.setFromAxisAngle(new V3(0, 1, 0), (hash(r, c) % 8) * (Math.PI / 4));
      m.compose(new V3(map.cellX(c), y + TILES.c.h, map.cellZ(r)), q, new V3(1.15, 1.15, 1.15));
    });
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

// ── 과학관: 진열장·키오스크·수조·전시 탁자·푸코 진자 탑
export function buildMuseumProps(map, { atlas, panelCount }) {
  const group = new THREE.Group();
  group.name = 'museumProps';
  const solid = makeSolidMaterial({ strobe: 1 });
  const decor = map.def.decor ?? {};
  const pend = decor.pendulum;
  const underPendulum = (c, r) => pend && Math.abs(c - pend.c) < 1.6 && Math.abs(r - pend.r) < 1.6;
  const tankSet = new Set((decor.tanks ?? []).map(([r, c]) => `${r},${c}`));
  const q = new THREE.Quaternion();
  const one = new V3(1, 1, 1);

  // 진열장 (작은 상자 칸): 받침대 + 유리 덮개 + 안의 전시물
  const cases = cellsOf(map, 'crate');
  const W = CELL * 0.86;
  const plinth = mergeGeometries([
    part(box(W, 0.84, W), '#d9d5cc', 0.55, 0, [0, 0.46, 0]),
    part(box(W * 0.96, 0.08, W * 0.96), '#2c2e32', 0.6, 0.1, [0, 0.04, 0]),
    part(box(W + 0.02, 0.04, W + 0.02), '#3a3c40', 0.4, 0.4, [0, 0.9, 0]),
  ]);
  const at = (c, r, y = 0) => new V3(map.cellX(c), y, map.cellZ(r));
  group.add(instanced(plinth, solid, cases, (m, { c, r, y }) => m.compose(at(c, r, y), q.identity(), one)));
  const glassMat = new THREE.MeshStandardMaterial({ color: '#bcd3dc', transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.1, depthWrite: false });
  const glass = instanced(new THREE.BoxGeometry(W * 0.94, 0.56, W * 0.94).translate(0, 0.92 + 0.28, 0), glassMat, cases, (m, { c, r, y }) => m.compose(at(c, r, y), q.identity(), one));
  glass.renderOrder = 3;
  group.add(glass);
  const byKind = {};
  for (const cell of cases) (byKind[SMALL_KEYS[hash(cell.c, cell.r) % SMALL_KEYS.length]] ??= []).push(cell);
  for (const [key, cells] of Object.entries(byKind)) {
    group.add(instanced(smallGeo(key), solid, cells, (m, { c, r, y }) => {
      q.setFromAxisAngle(new V3(0, 1, 0), (hash(r, c) % 4) * (Math.PI / 2));
      m.compose(at(c, r, y + 0.92), q, one);
    }));
  }

  // 키오스크 (큰 상자 칸): 네 면에 전시 설명판 (아틀라스), 받침·덮개는 단색
  const big = cellsOf(map, 'bigCrate', underPendulum);
  const kiosks = big.filter(({ c, r }) => !tankSet.has(`${r},${c}`));
  const tanks = big.filter(({ c, r }) => tankSet.has(`${r},${c}`));
  const KW = CELL * 0.96, KH = TILES.C.h;
  const panelGeos = [];
  const kioskSolid = [];
  kiosks.forEach(({ c, r, y }, i) => {
    const x = map.cellX(c), z = map.cellZ(r);
    const s0 = kioskSolid.length, p0 = panelGeos.length;
    kioskSolid.push(part(box(KW, 0.22, KW), '#2c2e32', 0.6, 0.1, [x, 0.11, z]));
    kioskSolid.push(part(box(KW + 0.04, 0.12, KW + 0.04), '#3a3c40', 0.4, 0.5, [x, KH - 0.06, z]));
    kioskSolid.push(part(box(KW * 0.98, KH - 0.34, KW * 0.98), '#e4e0d6', 0.7, 0, [x, 0.22 + (KH - 0.34) / 2, z]));
    // 네 면의 설명판 (각 면 다른 주제)
    for (let f = 0; f < 4; f++) {
      const panel = (hash(c, r) + f + i) % panelCount;
      const a = (f * Math.PI) / 2;
      const nx = Math.sin(a), nz = Math.cos(a);
      const ph = KH - 0.5, pw = Math.min(KW * 0.86, (ph * 512) / 704);
      const g = new THREE.PlaneGeometry(pw, ph);
      atlasUV(g, panel, panelCount);
      g.rotateY(a);
      g.translate(x + nx * (KW / 2 + 0.006), 0.26 + ph / 2, z + nz * (KW / 2 + 0.006));
      panelGeos.push(g);
    }
    liftFrom(kioskSolid, s0, y);
    liftFrom(panelGeos, p0, y);
  });

  // 전시 탁자 (낮은 방벽 칸): 비스듬한 윗면에 설명판
  const tables = cellsOf(map, 'barrier');
  const TW = CELL * 0.9, TH = TILES['='].h;
  tables.forEach(({ c, r, y }) => {
    const x = map.cellX(c), z = map.cellZ(r);
    const s0 = kioskSolid.length, p0 = panelGeos.length;
    kioskSolid.push(part(box(TW, TH - 0.2, TW), '#7a5f45', 0.7, 0, [x, (TH - 0.2) / 2, z]));
    kioskSolid.push(part(box(TW + 0.04, 0.06, TW + 0.04), '#3a3c40', 0.4, 0.4, [x, TH - 0.2, z]));
    const g = new THREE.PlaneGeometry(TW * 0.9, TW * 0.9 * (704 / 512) * 0.55);
    atlasUV(g, hash(c, r) % panelCount, panelCount, 0.55);
    g.rotateX(-Math.PI / 2 + 0.35);
    g.rotateY(((hash(r, c) % 4) * Math.PI) / 2);
    g.translate(x, TH - 0.08, z);
    panelGeos.push(g);
    liftFrom(kioskSolid, s0, y);
    liftFrom(panelGeos, p0, y);
  });

  // 수조 (부력): 금속 틀 + 물 + 뜬 나무토막 + 가라앉은 추
  const waterGeos = [];
  tanks.forEach(({ c, r, y }) => {
    const x = map.cellX(c), z = map.cellZ(r);
    const s0 = kioskSolid.length, w0 = waterGeos.length;
    kioskSolid.push(part(box(KW, 0.3, KW), '#2c2e32', 0.6, 0.2, [x, 0.15, z]));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kioskSolid.push(part(box(0.08, KH - 0.3, 0.08), STEEL, 0.35, 0.8, [x + (sx * (KW - 0.08)) / 2, 0.3 + (KH - 0.3) / 2, z + (sz * (KW - 0.08)) / 2]));
    kioskSolid.push(part(box(KW, 0.06, KW), STEEL, 0.35, 0.8, [x, KH - 0.03, z]));
    kioskSolid.push(part(box(0.5, 0.36, 0.5), WOOD, 0.75, 0, [x + 0.3, KH - 0.32, z - 0.2], [0, 0.5, 0]));
    kioskSolid.push(part(cyl(0.16, 0.16, 0.3, 16), BRASS, 0.3, 0.9, [x - 0.35, 0.46, z + 0.3]));
    waterGeos.push(new THREE.BoxGeometry(KW - 0.12, KH - 0.45, KW - 0.12).translate(x, 0.3 + (KH - 0.45) / 2, z));
    liftFrom(kioskSolid, s0, y);
    liftFrom(waterGeos, w0, y);
  });

  if (kioskSolid.length) {
    const m = new THREE.Mesh(mergeGeometries(kioskSolid), solid);
    m.castShadow = true;
    group.add(m);
  }
  if (panelGeos.length) group.add(new THREE.Mesh(mergeGeometries(panelGeos), new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.55, metalness: 0 })));
  if (waterGeos.length) {
    const water = new THREE.Mesh(
      mergeGeometries(waterGeos),
      new THREE.MeshStandardMaterial({ color: '#2b7590', transparent: true, opacity: 0.62, roughness: 0.08, metalness: 0.1, emissive: '#0b2833', emissiveIntensity: 0.6 }),
    );
    water.renderOrder = 2;
    group.add(water);
  }

  // 아트리움 천장: 막힌 천장에 매립한 광천장(빛나는 판 + 격자 보) · 둘레의 내림 천장 · 현수막 (부딪힘 없음, 보기만)
  const ac = decor.atriumCeiling;
  if (ac) {
    const x0 = map.originX + ac.c0 * CELL, x1 = map.originX + (ac.c1 + 1) * CELL;
    const z0 = map.originZ + ac.r0 * CELL, z1 = map.originZ + (ac.r1 + 1) * CELL;
    const y = CEILING_Y;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const W = x1 - x0, D = z1 - z0;
    const band = 0.7; // 둘레 내림 천장 폭
    const lum = new THREE.Mesh(
      new THREE.PlaneGeometry(W - band * 2, D - band * 2).rotateX(Math.PI / 2).translate(cx, y - 0.01, cz),
      new THREE.MeshBasicMaterial({ color: '#fff7ea', side: THREE.DoubleSide }),
    );
    group.add(lum);
    const parts = [];
    // 격자 보 (조명판 사이)
    for (let xx = x0 + band + CELL; xx < x1 - band - 0.1; xx += CELL) parts.push(part(box(0.09, 0.14, D - band * 2), '#cfc9bd', 0.5, 0.1, [xx, y - 0.07, cz]));
    for (let zz = z0 + band + CELL; zz < z1 - band - 0.1; zz += CELL) parts.push(part(box(W - band * 2, 0.14, 0.09), '#cfc9bd', 0.5, 0.1, [cx, y - 0.07, zz]));
    // 둘레 내림 천장 (단) + 아래 모서리 금속 띠
    for (const [w, d, px, pz] of [[W, band, cx, z0 + band / 2], [W, band, cx, z1 - band / 2], [band, D - band * 2, x0 + band / 2, cz], [band, D - band * 2, x1 - band / 2, cz]]) {
      parts.push(part(box(w, 0.55, d), '#e4dfd4', 0.85, 0, [px, y - 0.275, pz]));
    }
    for (const [w, d, px, pz] of [[W - band * 2, 0.04, cx, z0 + band], [W - band * 2, 0.04, cx, z1 - band], [0.04, D - band * 2, x0 + band, cz], [0.04, D - band * 2, x1 - band, cz]]) {
      parts.push(part(box(w, 0.05, d), BRASS, 0.3, 0.85, [px, y - 0.55, pz]));
    }
    group.add(new THREE.Mesh(mergeGeometries(parts), solid));
    // 현수막: 내림 천장 안쪽 긴 두 변에 걸림 (2층 눈높이보다 위라 시야를 가리지 않음)
    const banners = [
      { title: '국립 힘 과학관', sub: 'NATIONAL FORCE SCIENCE HALL', color: '#1f3b5c' },
      { title: '중력 · 탄성력', sub: 'GRAVITY · ELASTIC FORCE', color: '#5c2f1f' },
      { title: '마찰력 · 부력', sub: 'FRICTION · BUOYANCY', color: '#1f4c45' },
      { title: '합력 · 작용 반작용', sub: 'RESULTANT · ACTION-REACTION', color: '#3f2d5c' },
    ];
    const BH = 1.15, BW = 0.62;
    banners.forEach((bn, i) => {
      const side = i % 2 ? 1 : -1;
      const t = (Math.floor(i / 2) + 1) / 3;
      const bx = x0 + W * t, bz = side < 0 ? z0 + band + 0.05 : z1 - band - 0.05;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshStandardMaterial({ map: bannerTexture(bn), roughness: 0.85, side: THREE.DoubleSide }));
      m.position.set(bx, y - 0.62 - BH / 2, bz);
      m.rotation.y = side < 0 ? 0 : Math.PI;
      group.add(m);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, BW + 0.08, 6).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: BRASS, roughness: 0.3, metalness: 0.9 }));
      rod.position.set(bx, y - 0.6, bz);
      group.add(rod);
    });
  }

  // 푸코 진자: 팔각 탑 위로 긴 줄에 매달린 추가 흔들리고, 흔들리는 면이 천천히 돈다
  if (pend) {
    const x = map.originX + (pend.c + 0.5) * CELL, z = map.originZ + (pend.r + 0.5) * CELL;
    const tower = mergeGeometries([
      part(cyl(1.92, 1.98, KH, 8), '#2c2e32', 0.5, 0.2, [x, KH / 2, z], [0, Math.PI / 8, 0]),
      part(cyl(1.96, 1.96, 0.08, 8), BRASS, 0.3, 0.9, [x, KH, z], [0, Math.PI / 8, 0]),
      part(new THREE.CircleGeometry(1.7, 40), '#e4e0d6', 0.6, 0, [x, KH + 0.045, z], [-Math.PI / 2, 0, 0]),
      part(new THREE.RingGeometry(1.2, 1.25, 40), DARK, 0.6, 0, [x, KH + 0.05, z], [-Math.PI / 2, 0, 0]),
      part(new THREE.RingGeometry(0.6, 0.63, 40), DARK, 0.6, 0, [x, KH + 0.05, z], [-Math.PI / 2, 0, 0]),
    ]);
    const t = new THREE.Mesh(tower, solid);
    t.castShadow = true;
    group.add(t);
    // 아트리움 천장(광천장 가운데)에 매달림 (줄 길이 = 천장 높이 - 추 높이) + 천장 고정 장식
    const L = CEILING_Y - 0.02 - (KH + 1.1);
    const rosette = new THREE.Mesh(
      mergeGeometries([part(cyl(0.34, 0.4, 0.07, 24), BRASS, 0.3, 0.9, [x, CEILING_Y - 0.035, z]), part(cyl(0.06, 0.06, 0.22, 10), DARK, 0.4, 0.7, [x, CEILING_Y - 0.13, z])]),
      solid,
    );
    group.add(rosette);
    const pivot = new THREE.Group();
    pivot.position.set(x, KH + 1.1 + L, z);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, L, 6).translate(0, -L / 2, 0), new THREE.MeshStandardMaterial({ color: '#8d9298', roughness: 0.4, metalness: 0.8 }));
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16).translate(0, -L, 0), new THREE.MeshStandardMaterial({ color: BRASS, roughness: 0.25, metalness: 0.9 }));
    pivot.add(cable, bob);
    group.add(pivot);
    const period = 2 * Math.PI * Math.sqrt(L / 9.8);
    group.userData.tick = (time) => {
      const swing = Math.sin((time / period) * Math.PI * 2) * 0.22;
      const plane = time * 0.02; // 흔들리는 면이 천천히 회전
      pivot.rotation.set(Math.cos(plane) * swing, 0, Math.sin(plane) * swing);
    };
  }
  return group;
}

// 현수막 무늬 (세로로 긴 천: 위 띠 · 큰 제목 · 영문 · 아래 술)
function bannerTexture({ title, sub, color }) {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.25)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#d9b45a';
  g.fillRect(0, 18, W, 6);
  g.fillRect(0, H - 60, W, 4);
  g.fillStyle = '#f4efe4';
  g.textAlign = 'center';
  const words = title.split(' · ');
  words.forEach((w, i) => {
    let px = 40;
    do g.font = `700 ${px}px 'IBM Plex Sans KR', 'Noto Sans KR', sans-serif`;
    while (g.measureText(w).width > W - 36 && --px > 20);
    g.fillText(w, W / 2, 150 + i * 70);
  });
  g.font = "600 15px 'IBM Plex Mono', monospace";
  g.fillStyle = 'rgba(244,239,228,0.75)';
  sub.split(' · ').forEach((w, i) => g.fillText(w, W / 2, 330 + i * 24));
  // 지구·화살표 기호 (힘의 표현)
  g.strokeStyle = '#d9b45a';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(W / 2 - 50, 410);
  g.lineTo(W / 2 + 40, 410);
  g.stroke();
  g.beginPath();
  g.moveTo(W / 2 + 50, 410);
  g.lineTo(W / 2 + 30, 398);
  g.lineTo(W / 2 + 30, 422);
  g.closePath();
  g.fillStyle = '#d9b45a';
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 아틀라스(가로 4칸 × 세로 2칸)에서 panel번째 칸을 쓰도록 UV 지정. crop = 위에서부터 쓸 높이 비율
function atlasUV(g, panel, count, crop = 1) {
  const cols = 4, rows = Math.ceil(count / cols);
  const u0 = (panel % cols) / cols, v1 = 1 - Math.floor(panel / cols) / rows;
  const du = 1 / cols, dv = 1 / rows;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * du, v1 - (1 - uv.getY(i)) * dv * crop);
}

// ── 개념 카드 (경기 중 주울 수 있는 홀로그램 카드)
export class ConceptCards {
  constructor(scene, match, cardTexture) {
    this.match = match;
    this.group = new THREE.Group();
    this.group.name = 'conceptCards';
    scene.add(this.group);
    this.views = match.concepts.map((c) => {
      const g = new THREE.Group();
      g.position.set(c.x, c.y ?? 0, c.z);
      const card = new THREE.Mesh(
        new THREE.PlaneGeometry(0.36, 0.5),
        new THREE.MeshBasicMaterial({ map: cardTexture(c.id), transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      );
      card.position.y = 1.05;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.4, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#6fd3e8', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      ring.position.y = 0.03;
      g.add(card, ring);
      this.group.add(g);
      return { c, g, card, ring };
    });
  }

  update(time, viewerId) {
    for (const v of this.views) {
      v.g.visible = !v.c.takenBy.includes(viewerId);
      if (!v.g.visible) continue;
      v.card.position.y = 1.05 + Math.sin(time * 2 + v.c.key) * 0.06;
      v.card.rotation.y = time * 1.2 + v.c.key;
      v.ring.material.opacity = 0.25 + Math.sin(time * 3 + v.c.key) * 0.1;
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}
