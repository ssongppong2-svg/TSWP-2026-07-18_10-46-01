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

// ── 포스 바운드: 작은 상자 위의 실험 장비 (상자 5개 중 2개꼴). only: 이 칸들만 ('c,r' 집합)
export function buildLabProps(map, only = null) {
  const group = new THREE.Group();
  group.name = 'labProps';
  const mat = makeSolidMaterial({ strobe: 0, detail: 6 });
  const by = {};
  for (const cell of cellsOf(map, 'crate', only ? (c, r) => !only.has(`${c},${r}`) : undefined)) {
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
  const solid = makeSolidMaterial({ strobe: 1, detail: 2.5 });
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

// ───────────────────────── 연구동 실내 가구 (CQB 작전 별관) ─────────────────────────
// 실내(지붕 아래) 상자 칸을 그 방에 맞는 가구로 그림. 충돌 상자(1.84 m 사각 · 높이 1.0 / 2.2 / 1.1)를 꽉 채우는 모양
//   c(1.0 m): 실험실 = 실험대(검은 에폭시 상판·회색 수납장·개수대) / 사무·휴게·로비 = 책상(나무 상판·서랍장·모니터) / 창고 = 그대로 보급 상자
//   C(2.2 m): 서버실 = 서버 랙(LED) / 화학 실험실 = 흄 후드(유리 새시) / 창고 = 철제 선반(상자) / 그 밖 = 철제 수납장
//   =(1.1 m): 안내 데스크·바리케이드 (나무 판 + 밝은 상판)
const LAB = { panel: '#c9ccc8', groove: '#7d8380', epoxy: '#1c2023', steel: '#9aa0a6', dark: '#24272b', plinth: '#2b2e31' };
const EP = 0.92; // 상자 반폭 (CELL * 0.92 / 2)

const FURNITURE = {
  bench(v) {
    const out = [
      part(box(1.72, 0.1, 1.72), LAB.plinth, 0.8, 0, [0, 0.05, 0]),
      part(box(1.78, 0.82, 1.78), LAB.panel, 0.55, 0.05, [0, 0.51, 0]),
      part(box(1.84, 0.045, 1.84), LAB.epoxy, 0.32, 0, [0, 0.9775, 0]),
    ];
    for (const z of [-1, 1]) {
      out.push(part(box(1.74, 0.012, 0.01), LAB.groove, 0.7, 0, [0, 0.76, z * 0.892]));
      for (const x of [-0.44, 0, 0.44]) out.push(part(box(0.012, 0.62, 0.01), LAB.groove, 0.7, 0, [x, 0.44, z * 0.892]));
      for (const x of [-0.66, -0.22, 0.22, 0.66]) {
        out.push(part(box(0.14, 0.018, 0.022), LAB.steel, 0.3, 0.85, [x, 0.7, z * 0.9]));
        out.push(part(box(0.2, 0.014, 0.022), LAB.steel, 0.3, 0.85, [x, 0.84, z * 0.9]));
      }
    }
    if (v === 1) {
      // 개수대 + 거위목 수도꼭지 + 가스 밸브
      out.push(part(box(0.56, 0.012, 0.42), '#41474c', 0.25, 0.7, [0.35, 1.003, 0.2]));
      out.push(part(box(0.48, 0.006, 0.34), '#15181a', 0.3, 0.4, [0.35, 1.008, 0.2]));
      out.push(part(cyl(0.016, 0.02, 0.34, 10), LAB.steel, 0.25, 0.9, [0.35, 1.17, -0.06]));
      out.push(part(new THREE.TorusGeometry(0.08, 0.014, 6, 12, Math.PI), LAB.steel, 0.25, 0.9, [0.35, 1.34, 0.02], [0, Math.PI / 2, 0]));
      for (const x of [-0.4, -0.25]) {
        out.push(part(cyl(0.02, 0.02, 0.1, 8), '#c8a23a', 0.35, 0.8, [x, 1.05, -0.7]));
        out.push(part(box(0.06, 0.012, 0.012), '#c0392b', 0.5, 0, [x, 1.1, -0.68]));
      }
    }
    return out;
  },
  desk(v) {
    const wood = v ? '#7d5f42' : '#8f7356';
    const out = [
      part(box(1.84, 0.05, 1.84), wood, 0.6, 0, [0, 0.975, 0]),
      part(box(0.52, 0.95, 1.74), '#3b3f44', 0.55, 0.2, [-0.64, 0.475, 0]),
      part(box(0.52, 0.95, 1.74), '#3b3f44', 0.55, 0.2, [0.64, 0.475, 0]),
    ];
    for (const z of [-1, 1]) {
      out.push(part(box(0.78, 0.7, 0.03), '#30343a', 0.6, 0.1, [0, 0.6, z * 0.86]));
      for (const x of [-0.64, 0.64]) for (const y of [0.28, 0.58, 0.82]) out.push(part(box(0.14, 0.016, 0.02), LAB.steel, 0.3, 0.85, [x, y, z * 0.88]));
    }
    // 모니터·키보드·서류
    out.push(part(box(0.56, 0.34, 0.03), '#121417', 0.3, 0.2, [0.1, 1.27, -0.35]));
    out.push(part(box(0.5, 0.28, 0.005), '#1f3a4c', 0.15, 0, [0.1, 1.27, -0.333], [0, 0, 0], 1, 0.35));
    out.push(part(box(0.05, 0.12, 0.05), '#121417', 0.4, 0.3, [0.1, 1.06, -0.37]));
    out.push(part(box(0.22, 0.012, 0.16), '#121417', 0.4, 0.3, [0.1, 1.006, -0.37]));
    out.push(part(box(0.44, 0.015, 0.15), '#2a2d31', 0.5, 0.1, [0.1, 1.008, -0.05]));
    out.push(part(box(0.3, 0.02, 0.22), '#e8e4da', 0.8, 0, [-0.55, 1.01, 0.2], [0, 0.3, 0]));
    out.push(part(box(0.28, 0.012, 0.2), '#d9d4c6', 0.8, 0, [-0.5, 1.03, 0.25], [0, -0.2, 0]));
    return out;
  },
  rack() {
    const out = [part(box(1.84, 2.18, 1.84), '#16181b', 0.45, 0.45, [0, 1.09, 0]), part(box(1.86, 0.06, 1.86), '#0f1012', 0.6, 0.3, [0, 0.03, 0])];
    const LED = ['#3dff7a', '#3dff7a', '#3dff7a', '#ffb43d', '#3da5ff'];
    let k = 7;
    const rnd = () => ((k = (k * 16807) % 2147483647) / 2147483647);
    for (const z of [-1, 1]) {
      for (const x of [-0.46, 0.46]) {
        out.push(part(box(0.86, 2.02, 0.02), '#202327', 0.5, 0.5, [x, 1.1, z * 0.925]));
        out.push(part(box(0.025, 0.36, 0.03), LAB.steel, 0.3, 0.85, [x + 0.36, 1.15, z * 0.94]));
        // 장비 단 (가로 홈) + 상태등
        for (let i = 0; i < 9; i++) {
          const y = 0.3 + i * 0.2;
          out.push(part(box(0.8, 0.008, 0.01), '#0c0d0f', 0.6, 0, [x, y, z * 0.937]));
          for (let j = 0; j < 3; j++) if (rnd() < 0.75) out.push(part(box(0.018, 0.018, 0.012), LED[Math.floor(rnd() * LED.length)], 0.4, 0, [x - 0.33 + j * 0.05 + (rnd() < 0.3 ? 0.4 : 0), y + 0.08, z * 0.938], [0, 0, 0], 1, 3));
        }
      }
      out.push(part(box(0.32, 0.06, 0.006), '#e8e8e2', 0.7, 0, [-0.46, 2.06, z * 0.937]));
    }
    return out;
  },
  hood() {
    const out = [
      part(box(1.8, 0.86, 1.74), LAB.panel, 0.55, 0.05, [0, 0.43, -0.02]),
      part(box(1.84, 0.04, 1.8), LAB.epoxy, 0.32, 0, [0, 0.88, 0]),
      // 위 몸통 (뒤판·옆판·윗덮개는 하나로) + 앞 유리 새시
      part(box(1.84, 1.3, 1.6), '#d6d8d4', 0.5, 0.08, [0, 1.55, -0.12]),
      part(box(1.84, 0.34, 1.84), '#c4c7c3', 0.5, 0.08, [0, 2.03, 0]),
      part(box(1.5, 0.82, 0.02), '#24323b', 0.06, 0.4, [0, 1.38, 0.9]),
      part(box(1.56, 0.04, 0.05), LAB.steel, 0.3, 0.85, [0, 1.8, 0.9]),
      part(box(1.56, 0.04, 0.05), LAB.steel, 0.3, 0.85, [0, 0.96, 0.9]),
      part(box(0.04, 0.86, 0.05), LAB.steel, 0.3, 0.85, [-0.76, 1.38, 0.9]),
      part(box(0.04, 0.86, 0.05), LAB.steel, 0.3, 0.85, [0.76, 1.38, 0.9]),
      part(box(0.04, 0.84, 0.035), LAB.steel, 0.3, 0.85, [0, 1.38, 0.91]),
      part(box(1.3, 0.03, 0.02), '#ffffff', 0.3, 0, [0, 1.74, 0.85], [0, 0, 0], 1, 2.2),
      part(box(1.0, 0.05, 0.03), LAB.steel, 0.25, 0.9, [0, 1.04, 0.93]),
      // 경고 띠 · 배기 덕트
      part(box(0.5, 0.1, 0.006), '#d9b23a', 0.6, 0, [0, 2.03, 0.923]),
      part(cyl(0.16, 0.16, 0.5, 14), '#a9adb0', 0.4, 0.6, [0, 2.45, -0.3]),
    ];
    for (const x of [-0.44, 0.44]) out.push(part(box(0.012, 0.62, 0.01), LAB.groove, 0.7, 0, [x, 0.44, 0.852]));
    for (const x of [-0.66, -0.22, 0.22, 0.66]) out.push(part(box(0.14, 0.018, 0.022), LAB.steel, 0.3, 0.85, [x, 0.72, 0.86]));
    return out;
  },
  cabinet(v) {
    const body = v ? '#b8bcbb' : '#c9c4b5';
    const out = [part(box(1.84, 2.16, 1.84), body, 0.5, 0.35, [0, 1.08, 0]), part(box(1.86, 0.04, 1.86), '#8f9496', 0.45, 0.5, [0, 2.18, 0])];
    for (const z of [-1, 1]) {
      for (const x of [-0.46, 0, 0.46]) out.push(part(box(0.012, 2.04, 0.01), '#6f7476', 0.6, 0.2, [x, 1.08, z * 0.922]));
      for (const x of [-0.69, -0.23, 0.23, 0.69]) {
        out.push(part(box(0.022, 0.16, 0.03), LAB.steel, 0.3, 0.85, [x + (x < 0 ? 0.17 : -0.17) * (Math.abs(x) > 0.4 ? 1 : -1), 1.1, z * 0.932]));
        // 환기 홈
        for (let i = 0; i < 4; i++) out.push(part(box(0.24, 0.012, 0.012), '#53585b', 0.6, 0.2, [x, 1.86 + i * 0.045, z * 0.925]));
        out.push(part(box(0.16, 0.06, 0.006), v ? '#d9b23a' : '#e8e4da', 0.6, 0, [x, 1.66, z * 0.924]));
      }
    }
    return out;
  },
  shelf() {
    const out = [part(box(1.78, 2.1, 0.03), '#2d3135', 0.7, 0.3, [0, 1.05, 0])];
    for (const x of [-0.9, 0.9]) for (const z of [-0.88, 0.88]) out.push(part(box(0.06, 2.2, 0.06), '#c2652b', 0.5, 0.4, [x, 1.1, z]));
    for (const y of [0.12, 1.06, 2.0]) {
      out.push(part(box(1.8, 0.03, 1.8), '#7c8186', 0.6, 0.4, [0, y, 0]));
      for (const z of [-0.9, 0.9]) out.push(part(box(1.84, 0.08, 0.05), '#c2652b', 0.5, 0.4, [0, y - 0.03, z]));
    }
    let k = 3;
    const rnd = () => ((k = (k * 16807) % 2147483647) / 2147483647);
    for (const y of [0.135, 1.075]) {
      for (const z of [-1, 1]) {
        let x = -0.86;
        while (x < 0.7) {
          const w = 0.32 + rnd() * 0.22, h = 0.35 + rnd() * 0.42, d = 0.6 + rnd() * 0.22;
          if (x + w > 0.88) break;
          const col = rnd() < 0.7 ? (rnd() < 0.5 ? '#a37b4c' : '#8f6a40') : '#5f6a74';
          out.push(part(box(w - 0.02, h, d), col, 0.85, 0, [x + w / 2, y + h / 2, z * (0.06 + d / 2)]));
          if (col !== '#5f6a74') out.push(part(box(w - 0.02, 0.04, 0.005), '#c9b48a', 0.8, 0, [x + w / 2, y + h * 0.6, z * (0.065 + d)]));
          x += w;
        }
      }
    }
    return out;
  },
  counter(v) {
    const out = [
      part(box(1.9, 1.04, 1.9), v ? '#5f4a37' : '#6f5641', 0.65, 0, [0, 0.52, 0]),
      part(box(1.94, 0.05, 1.94), '#d9d6cf', 0.45, 0, [0, 1.075, 0]),
      part(box(1.92, 0.08, 1.92), LAB.plinth, 0.8, 0, [0, 0.04, 0]),
    ];
    for (const z of [-1, 1]) out.push(part(box(1.9, 0.03, 0.01), LAB.steel, 0.3, 0.8, [0, 0.82, z * 0.952]));
    for (const x of [-1, 1]) out.push(part(box(0.01, 0.03, 1.9), LAB.steel, 0.3, 0.8, [x * 0.952, 0.82, 0]));
    return out;
  },
};
const furnCache = new Map();
const furnGeo = (key, v) => {
  const k = `${key}${v}`;
  if (!furnCache.has(k)) furnCache.set(k, mergeGeometries(FURNITURE[key](v)));
  return furnCache.get(k);
};

// indoor(c, r): 그 칸이 실내(지붕 아래)인지. 반환 group.userData.cells = 가구로 그린 칸 ('c,r')
export function buildLabInterior(map, indoor) {
  const group = new THREE.Group();
  group.name = 'labInterior';
  const mat = makeSolidMaterial({ strobe: 1, detail: 2.5 });
  const area = (c, r) => map.callouts.find((k) => k.f == null && r >= k.r0 && r <= k.r1 && c >= k.c0 && c <= k.c1)?.name ?? '';
  const pick = {
    crate: (a) => (/실험/.test(a) ? 'bench' : /창고/.test(a) ? null : 'desk'),
    bigCrate: (a) => (/서버/.test(a) ? 'rack' : /화학/.test(a) ? 'hood' : /창고/.test(a) ? 'shelf' : 'cabinet'),
    barrier: () => 'counter',
  };
  // 앞면(로컬 +z)이 트인 쪽을 보게
  const open = (c, r) => map.charAt(c, r) === '.' || map.charAt(c, r) === 'D';
  const faceYaw = (c, r) => (open(c, r + 1) ? 0 : open(c, r - 1) ? Math.PI : open(c + 1, r) ? Math.PI / 2 : open(c - 1, r) ? -Math.PI / 2 : 0);
  const cells = new Set();
  const by = new Map();
  for (const p of map.props) {
    if (!pick[p.kind] || !indoor(p.c, p.r)) continue;
    const key = pick[p.kind](area(p.c, p.r));
    if (!key) continue;
    const h = hash(p.c, p.r);
    const v = key === 'bench' ? (h % 5 === 2 || h % 5 === 4 ? 1 : 0) : h % 2;
    const yaw = key === 'hood' || key === 'rack' ? faceYaw(p.c, p.r) : (h % 4) * (Math.PI / 2);
    const k = `${key}|${v}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ ...p, yaw });
    cells.add(`${p.c},${p.r}`);
  }
  const q = new THREE.Quaternion();
  for (const [k, list] of by) {
    const [key, v] = k.split('|');
    const mesh = instanced(furnGeo(key, +v), mat, list, (m, { c, r, y, yaw }) => {
      q.setFromAxisAngle(new V3(0, 1, 0), yaw);
      m.compose(new V3(map.cellX(c), y, map.cellZ(r)), q, new V3(1, 1, 1));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // 실험대 위 실험 장비 (개수대가 없는 실험대만)
  const benches = new Set([...(by.get('bench|0') ?? [])].map((p) => `${p.c},${p.r}`));
  group.add(buildLabProps(map, benches));
  group.userData.cells = cells;
  return group;
}
