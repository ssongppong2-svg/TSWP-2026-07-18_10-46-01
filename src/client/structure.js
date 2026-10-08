import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from '../sim/constants.js';
import { KIND, STORY, SLAB, ROOF, RAIL_H, RAIL_T } from '../sim/map.js';

// 맵의 "막힌 높이 구간(span)"을 그대로 3D 건물로 바꾼다.
// 벽(1층·2층) · 창문(창턱·인방) · 2층 바닥판(윗면·밑면·옆면) · 지붕 · 계단을
// 보이는 면만 재질별로 모아서 그린다 (재질 하나 = 그리기 호출 하나).
// 실내(지붕·2층 바닥 아래)는 정점 색으로 조금 어둡게 해서, 그림자를 끈 저사양에서도 안팎이 구분되게 한다.

const PROP = new Set([KIND.crate, KIND.bigCrate, KIND.barrier]);
const EPS = 1e-3;

// 면을 모으는 도구 (위치·법선·UV·정점 밝기)
export class QuadBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }
  // a b c d: 반시계 방향 네 점, n: 법선, ua~ud: UV, shade: 정점 밝기(숫자 하나 또는 네 개)
  quad(a, b, c, d, n, ua, ub, uc, ud, shade = 1) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(...p);
    for (let i = 0; i < 4; i++) this.nor.push(...n);
    for (const u of [ua, ub, uc, ud]) this.uv.push(...u);
    const s = Array.isArray(shade) ? shade : [shade, shade, shade, shade];
    for (const k of s) this.col.push(k, k, k);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  get empty() {
    return this.idx.length === 0;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// 구간 [y0, y1]에서 다른 구간들이 가린 부분을 뺀 나머지 (보이는 조각들)
function subtract(y0, y1, covers) {
  let out = [[y0, y1]];
  for (const [c0, c1] of covers) {
    const next = [];
    for (const [a, b] of out) {
      if (c1 <= a + EPS || c0 >= b - EPS) next.push([a, b]);
      else {
        if (c0 > a + EPS) next.push([a, c0]);
        if (c1 < b - EPS) next.push([c1, b]);
      }
    }
    out = next;
    if (!out.length) break;
  }
  return out.filter(([a, b]) => b - a > 0.02);
}

// 실내 그늘: 그 칸·높이의 바로 위에 무엇이 덮여 있는지 (지붕 = 실내, 2층 바닥판 = 더 어두운 1층 실내)
export function shadeFn(map, museum) {
  const K = museum ? { open: 1, roof: 0.86, slab: 0.78, ceil: 0.74 } : { open: 1, roof: 0.74, slab: 0.64, ceil: 0.6 };
  const at = (c, r, y) => {
    if (!map.inBounds(c, r)) return K.roof;
    let best = null;
    for (const [y0, , kind] of map.spansAt(c, r)) {
      if (y0 < y || PROP.has(kind) || kind === KIND.rail) continue;
      if (!best || y0 < best[0]) best = [y0, kind];
    }
    if (!best) return K.open;
    if (best[1] === KIND.roof) return K.roof;
    if (best[1] === KIND.slab) return K.slab;
    // 벽·창 인방 아래 (문틀): 살짝만
    return best[0] > 6 ? K.roof : K.open * 0.9;
  };
  at.K = K;
  return at;
}

// 이웃 칸이 그 높이를 가리는 구간 (상자·계단은 칸을 다 채우지 않으므로 가리지 않는 것으로 봄)
function coversOf(map, c, r) {
  if (!map.inBounds(c, r)) return [[-1, 99]];
  return map.spansAt(c, r).filter(([, , k]) => !PROP.has(k)).map(([a, b]) => [a, b]);
}

// 2층 바닥이 있는 칸인지 (벽 무늬를 2층 바닥에 맞춤)
const hasUpper = (map, c, r) => map.inBounds(c, r) && map.surfaces(c, r).some((y) => y > 1);

// map: GameMap, mats: { wall, wallTop, ceil, slabTop, grate, edge, edgeSteel, rail, roofTop, tread, nosing }
export function buildStructure(map, mats, { museum = false } = {}) {
  const group = new THREE.Group();
  group.name = 'structure';
  const shade = shadeFn(map, museum);
  // 철제 통로 칸: = 이거나, 구역·o 칸인데 옆에 = 칸이 있는 곳 (같은 통로의 일부)
  const steel = (c, r) => {
    const u = map.upperAt(c, r);
    if (u === '=') return true;
    if (!'abABo'.includes(u)) return false;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => map.upperAt(c + dc, r + dr) === '=');
  };
  const Q = {};
  const q = (name) => (Q[name] ??= new QuadBuilder());
  const DIRS = [
    // dc, dr, 면의 두 아래 점(왼쪽→오른쪽, 바깥에서 볼 때), 법선
    [0, -1, (x0, x1, z0) => [[x1, z0], [x0, z0]], [0, 0, -1]],
    [0, 1, (x0, x1, z0, z1) => [[x0, z1], [x1, z1]], [0, 0, 1]],
    [-1, 0, (x0, x1, z0, z1) => [[x0, z0], [x0, z1]], [-1, 0, 0]],
    [1, 0, (x0, x1, z0, z1) => [[x1, z1], [x1, z0]], [1, 0, 0]],
  ];

  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const spans = map.spansAt(c, r);
      if (!spans.length) continue;
      const x0 = map.originX + c * CELL, x1 = x0 + CELL;
      const z0 = map.originZ + r * CELL, z1 = z0 + CELL;
      const up = map.upperAt(c, r);
      const tallWall = spans.some(([a, b, k]) => k === KIND.wall && b >= ROOF - EPS);
      for (const [y0, y1, kind] of spans) {
        if (PROP.has(kind)) continue;
        const isWall = kind === KIND.wall || kind === KIND.sill || kind === KIND.lintel;
        // ── 옆면
        for (const [dc, dr, ends, n] of DIRS) {
          const nc = c + dc, nr = r + dr;
          if (!map.inBounds(nc, nr)) continue;
          const vis = subtract(y0, y1, coversOf(map, nc, nr));
          if (!vis.length) continue;
          const [a, b] = ends(x0, x1, z0, z1);
          const horiz = (p) => (n[0] !== 0 ? p[1] * -n[0] : p[0] * n[2]);
          const viewerUp = hasUpper(map, nc, nr);
          for (const [ya, yb] of vis) {
            let name, uvv;
            if (isWall || kind === KIND.roof) {
              name = 'wall';
              // 벽 무늬 높이: 2층 바닥이 보이는 쪽은 1층·2층을 따로, 2층 없는 높은 벽은 한 장을 늘여서
              if (viewerUp) uvv = (y) => (y0 >= STORY - SLAB - EPS ? (y - STORY) / 4.8 : y / 4.8);
              else if (tallWall) uvv = (y) => y / ROOF;
              else uvv = (y) => y / 4.8;
            } else if (kind === KIND.slab) {
              name = steel(c, r) ? 'edgeSteel' : 'edge';
              uvv = (y) => y / 4.8;
            } else continue;
            const sa = shade(nc, nr, ya + 0.05), sb = shade(nc, nr, Math.max(ya + 0.05, yb - 0.3));
            const ua = horiz(a) / 4, ub = horiz(b) / 4;
            q(name).quad(
              [a[0], ya, a[1]], [b[0], ya, b[1]], [b[0], yb, b[1]], [a[0], yb, a[1]],
              n,
              [ua, uvv(ya)], [ub, uvv(ya)], [ub, uvv(yb)], [ua, uvv(yb)],
              [sa, sa, sb, sb],
            );
          }
        }
        // ── 윗면 (바로 위에 다른 구간이 붙어 있으면 가려짐)
        if (!spans.some(([a2]) => Math.abs(a2 - y1) < EPS)) {
          let name = null;
          if (isWall) name = 'wallTop';
          else if (kind === KIND.slab) name = museum ? 'slabTop' : steel(c, r) ? 'grate' : 'slabTop';
          else if (kind === KIND.roof) name = 'roofTop';
          if (name) {
            const s = shade(c, r, y1 + 0.05);
            const k = name === 'grate' ? 2 : 4;
            q(name).quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0 / k, -z1 / k], [x1 / k, -z1 / k], [x1 / k, -z0 / k], [x0 / k, -z0 / k], s);
          }
        }
        // ── 밑면 (천장): 바로 아래에 다른 구간이 붙어 있으면 가려짐
        if (y0 > EPS && !spans.some(([, b2]) => Math.abs(b2 - y0) < EPS)) {
          const name = !museum && kind === KIND.slab && steel(c, r) ? 'grateUnder' : 'ceil';
          const k = name === 'grateUnder' ? 2 : 4;
          q(name).quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [x0 / k, z0 / k], [x1 / k, z0 / k], [x1 / k, z1 / k], [x0 / k, z1 / k], shade.K.ceil);
        }
      }
    }
  }

  buildStairs(map, q, shade);

  // 재질별 메쉬
  const order = ['wall', 'wallTop', 'ceil', 'slabTop', 'grate', 'grateUnder', 'edge', 'edgeSteel', 'roofTop', 'tread', 'nosing', 'chute', 'chuteLip'];
  const alias = { grateUnder: 'grate' };
  for (const name of order) {
    const b = Q[name];
    if (!b || b.empty) continue;
    const mat = mats[name] ?? mats[alias[name]] ?? mats.wall;
    const mesh = new THREE.Mesh(b.build(), mat);
    mesh.name = name;
    mesh.castShadow = name !== 'nosing' && name !== 'ceil';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.add(buildRailings(map, mats, museum));
  return group;
}

// 2층 난간 (map.railMask: 칸 가장자리마다). 공장: 노란 안전 난간(기둥·손잡이·중간대) + 발끝막이,
// 과학관: 유리판 + 나무 손잡이 + 금속 받침. 충돌 상자(칸 가장자리 안쪽 RAIL_T) 안에 들어가게 만듦
function buildRailings(map, mats, museum) {
  const group = new THREE.Group();
  group.name = 'railings';
  const parts = { rail: [], railDark: [], glass: [] };
  const box = (list, w, h, d, x, y, z) => list.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const y0 = STORY;
  const mid = RAIL_T / 2;
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const m = map.railMask[map.idx(c, r)];
      if (!m) continue;
      const x0 = map.originX + c * CELL, z0 = map.originZ + r * CELL;
      // 가장자리마다 (시작점, 방향, 안쪽 위치)
      const edges = [];
      if (m & 1) edges.push({ ax: 'x', a: x0, fixed: z0 + mid });
      if (m & 2) edges.push({ ax: 'x', a: x0, fixed: z0 + CELL - mid });
      if (m & 4) edges.push({ ax: 'z', a: z0, fixed: x0 + mid });
      if (m & 8) edges.push({ ax: 'z', a: z0, fixed: x0 + CELL - mid });
      for (const e of edges) {
        const along = (len, h, thick, center, y, list) => {
          if (e.ax === 'x') box(list, len, h, thick, center, y, e.fixed);
          else box(list, thick, h, len, e.fixed, y, center);
        };
        const centre = e.a + CELL / 2;
        if (museum) {
          along(CELL, RAIL_H - 0.12, 0.02, centre, y0 + 0.06 + (RAIL_H - 0.12) / 2, parts.glass);
          along(CELL, 0.07, 0.09, centre, y0 + RAIL_H - 0.035, parts.rail);
          along(CELL, 0.06, 0.08, centre, y0 + 0.03, parts.railDark);
        } else {
          along(CELL, 0.06, 0.06, centre, y0 + RAIL_H - 0.03, parts.rail);
          along(CELL, 0.045, 0.045, centre, y0 + 0.55, parts.rail);
          along(CELL, 0.12, 0.02, centre, y0 + 0.06, parts.railDark);
          for (const t of [0.05, CELL / 2, CELL - 0.05]) along(0.06, RAIL_H, 0.06, e.a + t, y0 + RAIL_H / 2, parts.rail);
        }
      }
    }
  }
  const add = (list, mat, shadow = true) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(list), mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(parts.rail, mats.railTop);
  add(parts.railDark, mats.rail);
  if (parts.glass.length) {
    const glass = new THREE.Mesh(mergeGeometries(parts.glass), mats.railGlass);
    glass.renderOrder = 3;
    group.add(glass);
  }
  return group;
}

// 계단: 칸마다 4단 (경사로 충돌은 매끈하지만 화면에는 계단으로). 디딤판 끝에 미끄럼 방지 띠
function buildStairs(map, q, shade) {
  const STEPS = 4;
  const RUP = [null, [0, -1], [0, 1], [-1, 0], [1, 0]];
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const rp = map.ramp(c, r);
      if (!rp) continue;
      const [ux, uz] = RUP[rp.dir];
      const wx = -uz, wz = ux; // 옆 방향
      const cx = map.cellX(c), cz = map.cellZ(r);
      const P = (s, t, y) => [cx + ux * (s - CELL / 2) + wx * t, y, cz + uz * (s - CELL / 2) + wz * t];
      const rise = (rp.h1 - rp.h0) / STEPS, depth = CELL / STEPS;
      // 옆 칸이 같은 계단이면 옆면을 그리지 않음 (넓은 계단)
      const sameSide = (sgn) => {
        const o = map.ramp(c + wx * sgn, r + wz * sgn);
        return o && o.dir === rp.dir && Math.abs(o.h0 - rp.h0) < EPS;
      };
      const H = CELL / 2;
      if (map.isSlide?.(c, r)) {
        // 마찰 미끄럼틀: 계단 대신 매끈한 판 + 양옆 낮은 턱
        const k = (rp.h1 - rp.h0) / CELL;
        const nl = Math.hypot(k, 1);
        const n = [(-ux * k) / nl, 1 / nl, (-uz * k) / nl];
        const a0 = P(0, -H, rp.h0), a1 = P(0, H, rp.h0), a2 = P(CELL, H, rp.h1), a3 = P(CELL, -H, rp.h1);
        const sh = shade(c, r, rp.h1 + 0.05);
        q('chute').quad(a0, a1, a2, a3, n, [a0[0] / 4, -a0[2] / 4], [a1[0] / 4, -a1[2] / 4], [a2[0] / 4, -a2[2] / 4], [a3[0] / 4, -a3[2] / 4], sh);
        for (const sgn of [-1, 1]) {
          if (sameSide(sgn)) continue;
          const t = sgn * H;
          const b0 = P(0, t, 0), b1 = P(CELL, t, 0), b2 = P(CELL, t, rp.h1), b3 = P(0, t, rp.h0);
          const nn = [wx * sgn, 0, wz * sgn];
          const quad = sgn > 0 ? [b0, b1, b2, b3] : [b1, b0, b3, b2];
          const hs = (p) => (p[0] * ux + p[2] * uz) / 4;
          q('wall').quad(quad[0], quad[1], quad[2], quad[3], nn, [hs(quad[0]), quad[0][1] / 4.8], [hs(quad[1]), quad[1][1] / 4.8], [hs(quad[2]), quad[2][1] / 4.8], [hs(quad[3]), quad[3][1] / 4.8], shade(c + wx * sgn, r + wz * sgn, 0.5));
          // 턱 (안쪽 면 + 윗면)
          const L = 0.28, T = 0.08;
          const i0 = P(0, t - sgn * T, rp.h0), i1 = P(CELL, t - sgn * T, rp.h1), i2 = P(CELL, t - sgn * T, rp.h1 + L), i3 = P(0, t - sgn * T, rp.h0 + L);
          const ni = [-wx * sgn, 0, -wz * sgn];
          const qi = sgn > 0 ? [i1, i0, i3, i2] : [i0, i1, i2, i3];
          q('chuteLip').quad(qi[0], qi[1], qi[2], qi[3], ni, [0, 0], [1, 0], [1, 1], [0, 1], sh);
          const o0 = P(0, t, rp.h0 + L), o1 = P(CELL, t, rp.h1 + L), o2 = P(CELL, t - sgn * T, rp.h1 + L), o3 = P(0, t - sgn * T, rp.h0 + L);
          const qo = sgn > 0 ? [o0, o1, o2, o3] : [o1, o0, o3, o2];
          q('chuteLip').quad(qo[0], qo[1], qo[2], qo[3], [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1], sh);
        }
        continue;
      }
      for (let i = 0; i < STEPS; i++) {
        const ya = rp.h0 + i * rise, yb = ya + rise;
        const s0 = i * depth, s1 = s0 + depth;
        const sh = shade(c, r, yb + 0.05);
        const uvTop = (p) => [p[0] / 4, -p[2] / 4];
        // 디딤판
        const t0 = P(s0, -H, yb), t1 = P(s0, H, yb), t2 = P(s1, H, yb), t3 = P(s1, -H, yb);
        q('tread').quad(t0, t1, t2, t3, [0, 1, 0], uvTop(t0), uvTop(t1), uvTop(t2), uvTop(t3), sh);
        // 챌판 (내려가는 쪽을 봄)
        const v0 = P(s0, -H, ya), v1 = P(s0, H, ya), v2 = P(s0, H, yb), v3 = P(s0, -H, yb);
        const hz = (p) => (p[0] * -uz + p[2] * ux) / 4;
        q('wall').quad(v0, v1, v2, v3, [-ux, 0, -uz], [hz(v0), ya / 4.8], [hz(v1), ya / 4.8], [hz(v2), yb / 4.8], [hz(v3), yb / 4.8], sh * 0.92);
        // 미끄럼 방지 띠
        const nz0 = P(s0, -H, yb + 0.004), nz1 = P(s0, H, yb + 0.004), nz2 = P(s0 + 0.07, H, yb + 0.004), nz3 = P(s0 + 0.07, -H, yb + 0.004);
        q('nosing').quad(nz0, nz1, nz2, nz3, [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1], sh);
        // 옆면 (계단 아래는 막혀 있음)
        for (const sgn of [-1, 1]) {
          if (sameSide(sgn)) continue;
          const t = sgn * H;
          const a = P(s0, t, 0), b = P(s1, t, 0), cc = P(s1, t, yb), d = P(s0, t, yb);
          const n = [wx * sgn, 0, wz * sgn];
          const quad = sgn > 0 ? [a, b, cc, d] : [b, a, d, cc];
          const hs = (p) => (p[0] * ux + p[2] * uz) / 4;
          const nc = c + wx * sgn, nr = r + wz * sgn;
          const s2 = shade(nc, nr, 0.5);
          q('wall').quad(quad[0], quad[1], quad[2], quad[3], n, [hs(quad[0]), quad[0][1] / 4.8], [hs(quad[1]), quad[1][1] / 4.8], [hs(quad[2]), quad[2][1] / 4.8], [hs(quad[3]), quad[3][1] / 4.8], s2);
        }
      }
    }
  }
}
