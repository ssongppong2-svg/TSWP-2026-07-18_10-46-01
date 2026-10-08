import { CELL } from './constants.js';
import { getMapDef } from './maps/index.js';

// 맵 데이터(글자 격자·구역 이름 등)는 ./maps/ 폴더에 있다. 이 파일은 격자를 게임에서 쓰는 형태로 바꾼다.
//
// 2층 구조: 칸마다 "막힌 높이 구간(span)" 목록을 둔다. 예) 1층 통로 위에 다리가 지나가면
// 그 칸은 [3.3, 3.6] (다리 바닥판) 하나만 막혀 있어서, 아래로는 지나가고 위로는 걸어 다닌다.
// 충돌·바닥·천장·총알·시야·길찾기가 모두 이 구간으로 계산된다.
export { FORCE_BOUND } from './maps/force-bound.js';

export const STORY = 3.6; // 2층 바닥 높이
export const SLAB = 0.3; // 바닥판 두께 (1층 천장 = 3.3)
export const ROOF = 7.2; // 건물 지붕 높이
export const WALL = 4.8; // 1층짜리 담장 높이
export const HEADROOM = 2.0; // 서 있을 수 있는 최소 높이
export const RAIL_H = 1.05; // 2층 난간 높이 (바닥에서)
export const RAIL_T = 0.1; // 난간 두께 (칸 가장자리 안쪽)

// 1층에 놓이는 물건 (높이는 1층 바닥 기준)
export const TILES = {
  '#': { h: WALL, kind: 'wall' },
  C: { h: 2.2, kind: 'bigCrate' },
  c: { h: 1.0, kind: 'crate' },
  '=': { h: 1.1, kind: 'barrier' },
};

// 막힌 구간의 종류 (화면에서 재질을 고를 때 씀)
export const KIND = { wall: 1, slab: 2, rail: 3, crate: 4, bigCrate: 5, barrier: 6, roof: 7, sill: 8, lintel: 9, gate: 10, lift: 11, push: 12 };
export const KIND_NAME = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v, k]));
const PROP_KINDS = new Set([KIND.crate, KIND.bigCrate, KIND.barrier]);

// 계단 글자 → 오르는 방향 (칸 단위)
const RAMP_DIRS = { '^': [0, -1], v: [0, 1], '<': [-1, 0], '>': [1, 0] };
const MAXS = 6;
const NO_BOXES = [];

export class GameMap {
  constructor(def = getMapDef()) {
    if (typeof def === 'string') def = getMapDef(def);
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.weather = def.weather ?? 'clear';
    const ground = def.layout;
    const upper = def.upper ?? null;
    this.rows = ground.length;
    this.cols = ground[0].length;
    this.width = this.cols * CELL;
    this.depth = this.rows * CELL;
    this.originX = -this.width / 2;
    this.originZ = -this.depth / 2;
    const n = this.cols * this.rows;
    this.chars = [];
    this.upperChars = [];
    this.heights = new Float64Array(n); // 1층 바닥에서 이어진 장애물 높이 (예전 heightAt)
    this.sn = new Uint8Array(n);
    this.sy0 = new Float64Array(n * MAXS);
    this.sy1 = new Float64Array(n * MAXS);
    this.sk = new Uint8Array(n * MAXS);
    this.rampDir = new Int8Array(n); // 0 없음, 1 북 2 남 3 서 4 동 (오르는 쪽)
    this.rampH0 = new Float64Array(n);
    this.rampH1 = new Float64Array(n);
    this.railMask = new Uint8Array(n); // 2층 바닥 칸 가장자리의 난간 (1 북 2 남 4 서 8 동)
    this.bombs = [];
    this.spawns = { defuse: [], force: [] };
    this.siteCells = { A: [], B: [] };
    this.props = []; // 상자·방벽 { c, r, y, h, kind }
    this.roofs = (def.roofs ?? []).map((q) => ({ ...q }));
    // 맵 장치 (devices.js가 움직임): 승강기 칸·미끄럼틀 칸·탄성 발판 칸
    this.devices = (def.devices ?? []).map((d, id) => ({ ...d, id }));
    this.liftCells = new Set();
    this.slideCells = new Set();
    this.padCells = new Set();
    for (const d of this.devices) {
      if (d.type === 'lift') this.liftCells.add(d.r * this.cols + d.c);
      if (d.type === 'pad') this.padCells.add(d.r * this.cols + d.c);
      if (d.type === 'slide') for (let r = d.r0; r <= d.r1; r++) for (let c = d.c0; c <= d.c1; c++) this.slideCells.add(r * this.cols + c);
    }
    this.staticSpans = []; // 칸마다 처음 만든 구간 (움직이는 장치 구간을 더하고 뺄 때 기준)
    this.dyn = new Map(); // 칸 → 장치가 더한 구간 [y0, y1, kind]

    for (let r = 0; r < this.rows; r++) {
      const line = ground[r];
      if (line.length !== this.cols) throw new Error(`맵 ${r}번째 줄의 길이가 다릅니다.`);
      if (upper && upper[r].length !== this.cols) throw new Error(`맵 2층 ${r}번째 줄의 길이가 다릅니다.`);
      for (let c = 0; c < this.cols; c++) {
        const ch = line[c];
        const up = upper ? upper[r][c] : ' ';
        this.chars.push(ch);
        this.upperChars.push(up);
        this.buildCell(c, r, ch, up);
        const x = this.cellX(c), z = this.cellZ(r);
        if (ch === 'A' || ch === 'B') {
          this.bombs.push({ id: ch, c, r, x, y: 0, z });
          this.siteCells[ch].push({ c, r, y: 0 });
        }
        if (ch === 'a') this.siteCells.A.push({ c, r, y: 0 });
        if (ch === 'b') this.siteCells.B.push({ c, r, y: 0 });
        if (up === 'A' || up === 'B') {
          this.bombs.push({ id: up, c, r, x, y: STORY, z });
          this.siteCells[up].push({ c, r, y: STORY });
        }
        if (up === 'a') this.siteCells.A.push({ c, r, y: STORY });
        if (up === 'b') this.siteCells.B.push({ c, r, y: STORY });
        if (ch === 'F') this.spawns.force.push({ c, r, x, z });
        if (ch === 'D') this.spawns.defuse.push({ c, r, x, z });
      }
    }
    this.buildRamps(ground);
    this.buildRails();
    this.bombs.sort((a, b) => a.id.localeCompare(b.id));
    const yOf = (h) => (h.f ? STORY : 0);
    const toWorld = (h) => ({
      x: this.cellX(h.c),
      y: yOf(h),
      z: this.cellZ(h.r),
      lookX: this.cellX(h.lc),
      lookY: (h.lf ? STORY : 0) + 1.5, // 바라볼 곳의 눈높이 (lf: 1 이면 2층)
      lookZ: this.cellZ(h.lr),
      via: h.via ? { x: this.cellX(h.via.c), y: h.via.f ? STORY : 0, z: this.cellZ(h.via.r) } : null,
    });
    this.holds = Object.fromEntries(Object.entries(def.holds ?? {}).map(([k, list]) => [k, list.map(toWorld)]));
    this.staging = Object.fromEntries(Object.entries(def.staging ?? {}).map(([k, list]) => [k, list.map(toWorld)]));
    this.callouts = def.callouts ?? [];
  }

  // 글자 두 개(1층·2층)로 칸의 막힌 구간을 만듦. 1층 부분과 2층 부분을 따로 쌓음
  //   1층: # 벽(위가 비면 4.8m, 2층이 있으면 2층 바닥판 아래까지) · w 창문 벽 · C c = 상자·방벽
  //   2층: # 벽(지붕까지) · w 창문 벽 · = - 바닥판 · a b A B 구역 바닥판 · c C 바닥판 위 상자 · r 난간
  buildCell(c, r, ch, up) {
    const i = this.idx(c, r);
    const add = (y0, y1, kind) => {
      const k = this.sn[i]++;
      if (k >= MAXS) throw new Error(`칸 (${r}, ${c})에 막힌 구간이 너무 많습니다.`);
      this.sy0[i * MAXS + k] = y0;
      this.sy1[i * MAXS + k] = y1;
      this.sk[i * MAXS + k] = kind;
    };
    const below = STORY - SLAB;
    const open = up === ' ' || up === '.';
    // 1층
    if (ch === '#') add(0, open ? WALL : below, KIND.wall);
    else if (ch === 'w') {
      // 창문 벽: 창턱 아래·창 위만 막힘 (창으로 보고 쏠 수 있음)
      add(0, 0.9, KIND.sill);
      add(2.2, open ? WALL : below, KIND.lintel);
    } else if (TILES[ch]) {
      const t = TILES[ch];
      add(0, t.h, KIND[t.kind]);
      this.props.push({ c, r, y: 0, h: t.h, kind: t.kind });
    }
    // 2층
    // r(예전 난간 칸)·o(난간 없는 가장자리)도 보통 바닥판. 난간은 buildRails가 가장자리에 자동으로 세움
    const slab = '=-abcCrABo'.includes(up);
    if (up === '#') add(below, ROOF, KIND.wall);
    else if (up === 'w') {
      add(below, STORY + 0.9, KIND.sill);
      add(STORY + 2.2, ROOF, KIND.lintel);
    } else if (slab) {
      add(below, STORY, KIND.slab);
      if (up === 'c') {
        add(STORY, STORY + 1.0, KIND.crate);
        this.props.push({ c, r, y: STORY, h: 1.0, kind: 'crate' });
      } else if (up === 'C') {
        add(STORY, STORY + 2.2, KIND.bigCrate);
        this.props.push({ c, r, y: STORY, h: 2.2, kind: 'bigCrate' });
      }
    }
    // 지붕: 지정된 사각형(건물) 안에서 지붕까지 닿는 벽이 아닌 칸 (2층 바닥 위든 트인 홀 위든)
    if (up !== '#' && up !== 'w' && this.roofs.some((q) => r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1)) add(ROOF - SLAB, ROOF, KIND.roof);
    // 막힌 구간을 아래부터 정렬하고, 바닥에서 이어진 높이 (예전 heightAt)
    this.sortSpans(i);
    this.staticSpans[i] = this.spansAt(c, r);
    this.updateHeight(i);
  }

  updateHeight(i) {
    if (this.rampDir[i]) return;
    let h = 0;
    for (let k = 0; k < this.sn[i]; k++) if (this.sy0[i * MAXS + k] <= h + 1e-3) h = Math.max(h, this.sy1[i * MAXS + k]);
    this.heights[i] = h;
  }

  // 장치가 칸에 구간을 더하거나(span) 뺌(null): 승강기 바닥판, 닫힌 셔터
  setDynamic(c, r, span) {
    const i = this.idx(c, r);
    if (span) this.dyn.set(i, span);
    else if (!this.dyn.delete(i)) return;
    const list = [...this.staticSpans[i]];
    if (span) list.push(span);
    list.sort((a, b) => a[0] - b[0]);
    this.sn[i] = list.length;
    list.forEach(([y0, y1, kd], k) => {
      this.sy0[i * MAXS + k] = y0;
      this.sy1[i * MAXS + k] = y1;
      this.sk[i * MAXS + k] = kd;
    });
    this.updateHeight(i);
  }

  // 닫힌 셔터처럼 지금 장치가 막고 있는 칸 (길찾기가 피함)
  dynBlocked(c, r) {
    const d = this.inBounds(c, r) && this.dyn.get(this.idx(c, r));
    return !!d && (d[2] === KIND.gate || d[2] === KIND.push);
  }

  isLift(c, r) {
    return this.liftCells.has(r * this.cols + c);
  }

  isPad(c, r) {
    return this.padCells.has(r * this.cols + c);
  }

  isSlide(c, r) {
    return this.slideCells.has(r * this.cols + c);
  }

  // 미끄럼틀 위면 내려가는 방향 (단위 벡터), 아니면 null
  slideAt(x, z) {
    const { c, r } = this.toCell(x, z);
    if (!this.inBounds(c, r) || !this.isSlide(c, r)) return null;
    const d = this.rampDir[this.idx(c, r)];
    if (!d) return null;
    return [null, { x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 0 }, { x: -1, z: 0 }][d];
  }

  sortSpans(i) {
    const list = [];
    for (let k = 0; k < this.sn[i]; k++) list.push([this.sy0[i * MAXS + k], this.sy1[i * MAXS + k], this.sk[i * MAXS + k]]);
    list.sort((a, b) => a[0] - b[0]);
    list.forEach(([y0, y1, kd], k) => {
      this.sy0[i * MAXS + k] = y0;
      this.sy1[i * MAXS + k] = y1;
      this.sk[i * MAXS + k] = kd;
    });
  }

  // 계단: 같은 글자가 오르는 방향으로 이어진 칸들이 1층(0)에서 2층(STORY)까지 고르게 오름
  buildRamps(ground) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = ground[r][c];
        const d = RAMP_DIRS[ch];
        if (!d) continue;
        // 아래쪽 끝이면 줄 전체를 계산
        const pc = c - d[0], pr = r - d[1];
        if (this.inBounds(pc, pr) && ground[pr][pc] === ch) continue;
        const run = [];
        let cc = c, rr = r;
        while (this.inBounds(cc, rr) && ground[rr][cc] === ch) {
          run.push([cc, rr]);
          cc += d[0];
          rr += d[1];
        }
        const dirCode = { '^': 1, v: 2, '<': 3, '>': 4 }[ch];
        run.forEach(([rc, rrow], k) => {
          const i = this.idx(rc, rrow);
          this.rampDir[i] = dirCode;
          this.rampH0[i] = (STORY * k) / run.length;
          this.rampH1[i] = (STORY * (k + 1)) / run.length;
          this.heights[i] = this.rampH1[i];
        });
      }
    }
  }

  // 난간: 2층 바닥 칸의 가장자리 중 바깥이 허공인 곳 (옆 칸에 2층 바닥·벽·계단 윗끝이 없음).
  // o 칸은 난간 없이 트여 있음 (뛰어내리는 곳). 난간은 칸 가장자리 안쪽의 얇은 판 (높이 RAIL_H)
  buildRails() {
    const RUP = [null, [0, -1], [0, 1], [-1, 0], [1, 0]];
    const EDGES = [[0, -1, 1], [0, 1, 2], [-1, 0, 4], [1, 0, 8]];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.upperAt(c, r) === 'o' || !this.surfaces(c, r).includes(STORY)) continue;
        let mask = 0;
        for (const [dc, dr, bit] of EDGES) {
          const nc = c + dc, nr = r + dr;
          if (!this.inBounds(nc, nr)) continue;
          if (this.surfaces(nc, nr).includes(STORY) || this.isLift(nc, nr)) continue;
          // 그 높이에 벽·창턱이 있으면 난간 필요 없음
          if (this.spansAt(nc, nr).some(([y0, y1]) => y0 <= STORY + 0.3 && y1 >= STORY + 0.5)) continue;
          // 계단 윗끝이 이 가장자리에 닿아 있으면 트여 있음
          const rp = this.ramp(nc, nr);
          if (rp) {
            const up = RUP[rp.dir];
            if (up[0] === -dc && up[1] === -dr && Math.abs(rp.h1 - STORY) < 0.3) continue;
          }
          mask |= bit;
        }
        this.railMask[this.idx(c, r)] = mask;
      }
    }
  }

  // 그 칸의 난간 상자들 [minX, maxX, minZ, maxZ, y0, y1]
  railBoxes(c, r) {
    if (!this.inBounds(c, r)) return NO_BOXES;
    const m = this.railMask[this.idx(c, r)];
    if (!m) return NO_BOXES;
    const x0 = this.originX + c * CELL, x1 = x0 + CELL;
    const z0 = this.originZ + r * CELL, z1 = z0 + CELL;
    const y0 = STORY, y1 = STORY + RAIL_H;
    const out = [];
    if (m & 1) out.push([x0, x1, z0, z0 + RAIL_T, y0, y1]);
    if (m & 2) out.push([x0, x1, z1 - RAIL_T, z1, y0, y1]);
    if (m & 4) out.push([x0, x0 + RAIL_T, z0, z1, y0, y1]);
    if (m & 8) out.push([x1 - RAIL_T, x1, z0, z1, y0, y1]);
    return out;
  }

  // 두 이웃 칸 사이 가장자리에 난간이 있는지
  railBetween(c, r, dc, dr) {
    const bit = dc === 0 ? (dr < 0 ? 1 : 2) : dc < 0 ? 4 : 8;
    const back = dc === 0 ? (dr < 0 ? 2 : 1) : dc < 0 ? 8 : 4;
    return (this.inBounds(c, r) && (this.railMask[this.idx(c, r)] & bit) !== 0) || (this.inBounds(c + dc, r + dr) && (this.railMask[this.idx(c + dc, r + dr)] & back) !== 0);
  }

  // ───────── 칸 정보 ─────────
  idx(c, r) {
    return r * this.cols + c;
  }

  inBounds(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  // 1층 바닥에서 이어진 장애물 높이 (벽 4.8·7.2, 상자 1.0 …, 계단은 윗끝 높이)
  heightAt(c, r) {
    return this.inBounds(c, r) ? this.heights[this.idx(c, r)] : Infinity;
  }

  charAt(c, r) {
    return this.inBounds(c, r) ? this.chars[this.idx(c, r)] : '#';
  }

  upperAt(c, r) {
    return this.inBounds(c, r) ? this.upperChars[this.idx(c, r)] : '#';
  }

  // 칸의 막힌 구간 [[y0, y1, kind] …] (아래부터)
  spansAt(c, r) {
    if (!this.inBounds(c, r)) return [[0, Infinity, KIND.wall]];
    const i = this.idx(c, r);
    const out = [];
    for (let k = 0; k < this.sn[i]; k++) out.push([this.sy0[i * MAXS + k], this.sy1[i * MAXS + k], this.sk[i * MAXS + k]]);
    return out;
  }

  ramp(c, r) {
    if (!this.inBounds(c, r)) return null;
    const i = this.idx(c, r);
    const d = this.rampDir[i];
    return d ? { dir: d, h0: this.rampH0[i], h1: this.rampH1[i] } : null;
  }

  cellX(c) {
    return this.originX + (c + 0.5) * CELL;
  }

  cellZ(r) {
    return this.originZ + (r + 0.5) * CELL;
  }

  toCell(x, z) {
    return { c: Math.floor((x - this.originX) / CELL), r: Math.floor((z - this.originZ) / CELL) };
  }

  // 그 층의 높이 (0 = 1층, 1 = 2층)
  floorOf(y) {
    return y > STORY - 1 ? 1 : 0;
  }

  // 1층에서 서 있을 수 있는 칸 (계단 제외)
  walkable(c, r) {
    if (!this.inBounds(c, r)) return false;
    const i = this.idx(c, r);
    if (this.rampDir[i]) return false;
    return this.sn[i] === 0 || this.sy0[i * MAXS] >= HEADROOM;
  }

  // 서 있을 수 있는 바닥 높이들 (1층 0, 2층 STORY). 계단·상자 위는 제외
  surfaces(c, r) {
    if (!this.inBounds(c, r)) return [];
    const i = this.idx(c, r);
    if (this.rampDir[i]) return [];
    const out = [];
    const n = this.sn[i];
    if (n === 0 || this.sy0[i * MAXS] >= HEADROOM) out.push(0);
    for (let k = 0; k < n; k++) {
      const top = this.sy1[i * MAXS + k];
      if (Math.abs(top - STORY) > 0.05) continue;
      const next = k + 1 < n ? this.sy0[i * MAXS + k + 1] : Infinity;
      if (next - top >= HEADROOM) out.push(STORY);
    }
    return out;
  }

  // 그 높이(±0.4)에 서 있을 수 있는지
  walkableAt(c, r, y) {
    return this.surfaces(c, r).some((s) => Math.abs(s - y) < 0.4);
  }

  // 계단 칸의 (x, z) 지점 바닥 높이
  rampHeight(i, x, z) {
    const c = i % this.cols, r = (i - c) / this.cols;
    const x0 = this.originX + c * CELL, z0 = this.originZ + r * CELL;
    let u;
    switch (this.rampDir[i]) {
      case 1: u = 1 - (z - z0) / CELL; break; // 북쪽(−z)으로 오름
      case 2: u = (z - z0) / CELL; break;
      case 3: u = 1 - (x - x0) / CELL; break;
      default: u = (x - x0) / CELL;
    }
    u = Math.max(0, Math.min(1, u));
    return this.rampH0[i] + (this.rampH1[i] - this.rampH0[i]) * u;
  }

  // ───────── 이동 물리 ─────────
  // 원(반지름 radius) 아래에서 maxY 이하인 가장 높은 바닥 높이
  groundHeight(x, z, radius, maxY) {
    let best = 0;
    const c0 = Math.floor((x - radius - this.originX) / CELL);
    const c1 = Math.floor((x + radius - this.originX) / CELL);
    const r0 = Math.floor((z - radius - this.originZ) / CELL);
    const r1 = Math.floor((z + radius - this.originZ) / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!this.inBounds(c, r)) continue;
        const minX = this.originX + c * CELL, minZ = this.originZ + r * CELL;
        const cx = Math.max(minX, Math.min(x, minX + CELL));
        const cz = Math.max(minZ, Math.min(z, minZ + CELL));
        if ((x - cx) ** 2 + (z - cz) ** 2 >= radius * radius) continue;
        const i = this.idx(c, r);
        if (this.rampDir[i]) {
          const h = this.rampHeight(i, cx, cz);
          if (h > best && h <= maxY + 1e-4) best = h;
        }
        for (let k = 0; k < this.sn[i]; k++) {
          const h = this.sy1[i * MAXS + k];
          if (h > best && h <= maxY + 1e-4) best = h;
        }
      }
    }
    return best;
  }

  // 원 위에서 fromY보다 높은 가장 낮은 천장 (없으면 Infinity)
  ceilingHeight(x, z, radius, fromY) {
    let best = Infinity;
    const c0 = Math.floor((x - radius - this.originX) / CELL);
    const c1 = Math.floor((x + radius - this.originX) / CELL);
    const r0 = Math.floor((z - radius - this.originZ) / CELL);
    const r1 = Math.floor((z + radius - this.originZ) / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!this.inBounds(c, r)) continue;
        const minX = this.originX + c * CELL, minZ = this.originZ + r * CELL;
        const cx = Math.max(minX, Math.min(x, minX + CELL));
        const cz = Math.max(minZ, Math.min(z, minZ + CELL));
        if ((x - cx) ** 2 + (z - cz) ** 2 >= radius * radius) continue;
        const i = this.idx(c, r);
        for (let k = 0; k < this.sn[i]; k++) {
          const y0 = this.sy0[i * MAXS + k];
          if (y0 > fromY && y0 < best) best = y0;
        }
      }
    }
    return best;
  }

  // 그 칸이 몸(발 feetY+step ~ 머리 feetY+bodyH)을 막는지, 막는 높이 (계단은 가장 가까운 지점의 높이로)
  blocks(c, r, feetY, stepHeight, bodyH, px, pz) {
    if (!this.inBounds(c, r)) return true;
    const i = this.idx(c, r);
    const lo = feetY + stepHeight, hi = feetY + bodyH;
    for (let k = 0; k < this.sn[i]; k++) {
      if (this.sy1[i * MAXS + k] > lo && this.sy0[i * MAXS + k] < hi) return true;
    }
    if (this.rampDir[i] && this.rampHeight(i, px, pz) > lo) return true;
    return false;
  }

  // 원기둥(사람)을 벽·상자 밖으로 밀어냄. 벽 쪽으로 향하던 속도 성분은 없앰.
  collideCircle(pos, radius, feetY, stepHeight, vel, bodyH = 1.85) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const c0 = Math.floor((pos.x - radius - this.originX) / CELL);
      const c1 = Math.floor((pos.x + radius - this.originX) / CELL);
      const r0 = Math.floor((pos.z - radius - this.originZ) / CELL);
      const r1 = Math.floor((pos.z + radius - this.originZ) / CELL);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const minX = this.originX + c * CELL, maxX = minX + CELL;
          const minZ = this.originZ + r * CELL, maxZ = minZ + CELL;
          const cx = Math.max(minX, Math.min(pos.x, maxX));
          const cz = Math.max(minZ, Math.min(pos.z, maxZ));
          let dx = pos.x - cx, dz = pos.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= radius * radius) continue;
          // 난간 (칸 가장자리의 얇은 판)
          for (const [bx0, bx1, bz0, bz1, by0, by1] of this.railBoxes(c, r)) {
            if (by1 <= feetY + stepHeight || by0 >= feetY + bodyH) continue;
            if (this.pushOut(pos, radius, bx0, bx1, bz0, bz1, vel)) moved = hit = true;
          }
          if (!this.blocks(c, r, feetY, stepHeight, bodyH, cx, cz)) continue;
          let nx, nz, push;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            nx = dx / d;
            nz = dz / d;
            push = radius - d;
          } else {
            const left = pos.x - minX, right = maxX - pos.x, top = pos.z - minZ, bottom = maxZ - pos.z;
            const m = Math.min(left, right, top, bottom);
            if (m === left) [nx, nz, push] = [-1, 0, left + radius];
            else if (m === right) [nx, nz, push] = [1, 0, right + radius];
            else if (m === top) [nx, nz, push] = [0, -1, top + radius];
            else [nx, nz, push] = [0, 1, bottom + radius];
          }
          pos.x += nx * push;
          pos.z += nz * push;
          if (vel) {
            const vn = vel.x * nx + vel.z * nz;
            if (vn < 0) {
              vel.x -= vn * nx;
              vel.z -= vn * nz;
            }
          }
          moved = hit = true;
        }
      }
      if (!moved) break;
    }
    return hit;
  }

  // 원을 사각형(xz) 밖으로 밀어냄 (난간용)
  pushOut(pos, radius, minX, maxX, minZ, maxZ, vel) {
    const cx = Math.max(minX, Math.min(pos.x, maxX));
    const cz = Math.max(minZ, Math.min(pos.z, maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) return false;
    let nx, nz, push;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      nx = dx / d;
      nz = dz / d;
      push = radius - d;
    } else {
      const left = pos.x - minX, right = maxX - pos.x, top = pos.z - minZ, bottom = maxZ - pos.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) [nx, nz, push] = [-1, 0, left + radius];
      else if (m === right) [nx, nz, push] = [1, 0, right + radius];
      else if (m === top) [nx, nz, push] = [0, -1, top + radius];
      else [nx, nz, push] = [0, 1, bottom + radius];
    }
    pos.x += nx * push;
    pos.z += nz * push;
    if (vel) {
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) {
        vel.x -= vn * nx;
        vel.z -= vn * nz;
      }
    }
    return true;
  }

  // ───────── 총알·시야 ─────────
  // 선분 a→b가 처음 부딪히는 곳 (격자 DDA + 칸마다 막힌 구간). 없으면 null.
  raycast(a, b) {
    const ax = a.x, ay = a.y, az = a.z;
    const dx = b.x - ax, dy = b.y - ay, dz = b.z - az;
    const hit = (t, nx, ny, nz) => ({ t, x: ax + dx * t, y: ay + dy * t, z: az + dz * t, nx, ny, nz });
    if (ay <= 0) return hit(0, 0, 1, 0);
    let tEnd = 1;
    let groundHit = false;
    if (dy < 0) {
      const tg = -ay / dy;
      if (tg < tEnd) {
        tEnd = tg;
        groundHit = true;
      }
    }
    let c = Math.floor((ax - this.originX) / CELL);
    let r = Math.floor((az - this.originZ) / CELL);
    const stepC = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepR = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaC = stepC ? CELL / Math.abs(dx) : Infinity;
    const tDeltaR = stepR ? CELL / Math.abs(dz) : Infinity;
    let tMaxC = stepC > 0 ? ((c + 1) * CELL + this.originX - ax) / dx : stepC < 0 ? (c * CELL + this.originX - ax) / dx : Infinity;
    let tMaxR = stepR > 0 ? ((r + 1) * CELL + this.originZ - az) / dz : stepR < 0 ? (r * CELL + this.originZ - az) / dz : Infinity;
    let tEnter = 0, nx = 0, nz = 0;
    for (let guard = 0; guard < 1024; guard++) {
      const tExit = Math.min(tMaxC, tMaxR, tEnd);
      const side = () => {
        if (nx === 0 && nz === 0) {
          const l = Math.hypot(dx, dz) || 1;
          return hit(tEnter, -dx / l, 0, -dz / l);
        }
        return hit(tEnter, nx, 0, nz);
      };
      if (!this.inBounds(c, r)) return side();
      const i = this.idx(c, r);
      const yIn = ay + dy * tEnter, yOut = ay + dy * tExit;
      let best = null;
      for (let k = 0; k < this.sn[i]; k++) {
        const y0 = this.sy0[i * MAXS + k], y1 = this.sy1[i * MAXS + k];
        if (yIn >= y0 && yIn <= y1) return side();
        if (dy < 0 && yIn > y1 && yOut <= y1) {
          const t = (y1 - ay) / dy;
          if (!best || t < best.t) best = hit(t, 0, 1, 0);
        } else if (dy > 0 && yIn < y0 && yOut >= y0) {
          const t = (y0 - ay) / dy;
          if (!best || t < best.t) best = hit(t, 0, -1, 0);
        }
      }
      if (this.rampDir[i]) {
        const fIn = yIn - this.rampHeight(i, ax + dx * tEnter, az + dz * tEnter);
        const fOut = yOut - this.rampHeight(i, ax + dx * tExit, az + dz * tExit);
        if (fIn < 0) return side();
        if (fOut < 0) {
          const t = tEnter + (fIn / (fIn - fOut)) * (tExit - tEnter);
          if (!best || t < best.t) {
            const s = (this.rampH1[i] - this.rampH0[i]) / CELL;
            const g = [[0, s], [0, -s], [s, 0], [-s, 0]][this.rampDir[i] - 1];
            const l = Math.hypot(g[0], 1, g[1]);
            best = hit(t, g[0] / l, 1 / l, g[1] / l);
          }
        }
      }
      // 난간 (얇은 상자, 판 방식 교차)
      for (const [bx0, bx1, bz0, bz1, by0, by1] of this.railBoxes(c, r)) {
        let t0 = -Infinity, t1 = Infinity, n = null;
        let ok = true;
        for (const [o, d, lo, hi, axis] of [[ax, dx, bx0, bx1, 0], [ay, dy, by0, by1, 1], [az, dz, bz0, bz1, 2]]) {
          if (Math.abs(d) < 1e-12) {
            if (o < lo || o > hi) ok = false;
            continue;
          }
          let ta = (lo - o) / d, tb = (hi - o) / d;
          const sign = ta > tb ? 1 : -1;
          if (ta > tb) [ta, tb] = [tb, ta];
          if (ta > t0) {
            t0 = ta;
            n = axis === 0 ? [sign, 0, 0] : axis === 1 ? [0, sign, 0] : [0, 0, sign];
          }
          t1 = Math.min(t1, tb);
        }
        if (!ok || t0 > t1 || t1 < 0 || !n) continue;
        const th = Math.max(0, t0);
        if (th < tEnter - 1e-6 || th > tExit + 1e-6) continue;
        if (!best || th < best.t) best = hit(th, n[0], n[1], n[2]);
      }
      if (best) return best;
      if (tExit >= tEnd) break;
      if (tMaxC < tMaxR) {
        c += stepC;
        tEnter = tMaxC;
        tMaxC += tDeltaC;
        nx = -stepC;
        nz = 0;
      } else {
        r += stepR;
        tEnter = tMaxR;
        tMaxR += tDeltaR;
        nx = 0;
        nz = -stepR;
      }
    }
    return groundHit ? hit(tEnd, 0, 1, 0) : null;
  }

  lineOfSight(a, b) {
    return this.raycast(a, b) === null;
  }

  // 그 지점의 바닥(상자·2층 바닥 포함)에 놓을 위치 — fromY 아래에서 가장 높은 바닥
  dropToGround(x, z, fromY) {
    return this.groundHeight(x, z, 0.05, fromY + 0.05);
  }

  // 무전 보고용 구역 이름 (없으면 null). 2층 전용 구역(f: 1)이 있으면 높이로 고름
  calloutAt(x, z, y = 0) {
    const { c, r } = this.toCell(x, z);
    const floor = this.floorOf(y);
    for (const k of this.callouts) {
      if (k.f != null && k.f !== floor) continue;
      if (r >= k.r0 && r <= k.r1 && c >= k.c0 && c <= k.c1) return k.name;
    }
    return null;
  }
}
