// 봇 길찾기: 층을 아는 그래프 위에서 A*로 경로를 찾고, 같은 층에서 직선으로 갈 수 있는 구간은 줄입니다.
// 노드 = 칸의 바닥 하나 (1층 바닥 · 2층 바닥 · 계단). 이웃 칸의 바닥과 높이가 이어지면 연결.
// 2층 가장자리에서 아래가 트인 칸으로는 뛰어내리는 길(한 방향)도 연결 (난간이 있는 가장자리는 제외).
import { HEADROOM, STORY } from './map.js';

const SQRT2 = Math.SQRT2;
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const STEP = 0.5; // 이어진 것으로 보는 높이 차
const DROP_COST = 2.5;
// 계단 방향 코드(1 북 2 남 3 서 4 동) → 오르는 쪽 칸 이동
const RAMP_UP = [null, [0, -1], [0, 1], [-1, 0], [1, 0]];

class MinHeap {
  constructor() {
    this.items = [];
  }
  push(node, f) {
    const a = this.items;
    a.push([f, node]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
  get size() {
    return this.items.length;
  }
}

export class NavGrid {
  constructor(map) {
    this.map = map;
    this.cols = map.cols;
    this.rows = map.rows;
    this.build();
  }

  // 노드·간선 만들기
  build() {
    const map = this.map;
    const nodes = []; // { c, r, y, ramp: { dir, h0, h1 } | null }
    this.byCell = Array.from({ length: this.cols * this.rows }, () => []);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = map.idx(c, r);
        const ramp = map.ramp(c, r);
        if (ramp) {
          // 계단 위 머리 공간 확인
          if (map.ceilingHeight(map.cellX(c), map.cellZ(r), 0.1, ramp.h1 - 0.1) - ramp.h1 < HEADROOM - 0.2) continue;
          this.byCell[i].push(nodes.length);
          nodes.push({ c, r, y: (ramp.h0 + ramp.h1) / 2, ramp });
          continue;
        }
        for (const y of map.surfaces(c, r)) {
          this.byCell[i].push(nodes.length);
          nodes.push({ c, r, y, ramp: null });
        }
      }
    }
    this.nodes = nodes;
    // 노드가 이웃 쪽 경계에서 갖는 높이 (계단은 오르는 쪽 끝 h1, 내려가는 쪽 끝 h0, 옆은 없음)
    const edgeY = (n, dc, dr) => {
      if (!n.ramp) return n.y;
      const up = RAMP_UP[n.ramp.dir];
      if (dc === up[0] && dr === up[1]) return n.ramp.h1;
      if (dc === -up[0] && dr === -up[1]) return n.ramp.h0;
      return null;
    };
    this.edges = nodes.map(() => []);
    nodes.forEach((n, a) => {
      for (const [dc, dr] of DIRS4) {
        const nc = n.c + dc, nr = n.r + dr;
        if (!map.inBounds(nc, nr)) continue;
        const ya = edgeY(n, dc, dr);
        for (const b of this.byCell[map.idx(nc, nr)]) {
          const m = nodes[b];
          let yb = edgeY(m, -dc, -dr);
          // 나란한 계단 (넓은 계단): 같은 방향·같은 높이면 옆으로도 연결
          if (ya == null || yb == null) {
            if (n.ramp && m.ramp && n.ramp.dir === m.ramp.dir && Math.abs(n.ramp.h0 - m.ramp.h0) < 0.01) this.edges[a].push([b, 1]);
            continue;
          }
          if (Math.abs(ya - yb) <= STEP) this.edges[a].push([b, 1]);
        }
        // 2층 가장자리 → 아래가 트인 이웃 칸의 1층으로 뛰어내림
        if (!n.ramp && n.y > STORY - 0.5 && !map.railBetween(n.c, n.r, dc, dr)) {
          const ground = this.byCell[map.idx(nc, nr)].find((b) => nodes[b].y === 0 && !nodes[b].ramp);
          if (ground != null && this.openAbove(nc, nr, 0.5, n.y + 1.8)) this.edges[a].push([ground, DROP_COST]);
        }
      }
      // 대각선: 같은 높이의 평평한 바닥끼리, 양옆 칸도 같은 높이로 트였을 때만
      if (n.ramp) return;
      for (const [dc, dr] of DIAG) {
        const nc = n.c + dc, nr = n.r + dr;
        if (!map.inBounds(nc, nr)) continue;
        const flat = (c, r) => this.byCell[map.idx(c, r)].find((b) => !nodes[b].ramp && Math.abs(nodes[b].y - n.y) < 0.05);
        const b = flat(nc, nr);
        if (b == null || flat(n.c + dc, n.r) == null || flat(n.c, n.r + dr) == null) continue;
        this.edges[a].push([b, SQRT2]);
      }
    });
  }

  // 칸의 y0~y1 높이가 비어 있는지 (뛰어내릴 때 지나갈 공간)
  openAbove(c, r, y0, y1) {
    for (const [s0, s1] of this.map.spansAt(c, r)) if (s1 > y0 && s0 < y1) return false;
    return true;
  }

  // 그 지점에서 가장 가까운 노드 (같은 칸의 바닥 중 y와 가까운 것, 없으면 주변 칸)
  nodeNear(x, y, z) {
    const map = this.map;
    const { c, r } = map.toCell(x, z);
    const pick = (cc, rr) => {
      if (!map.inBounds(cc, rr)) return null;
      let best = null, bestD = Infinity;
      for (const b of this.byCell[map.idx(cc, rr)]) {
        const n = this.nodes[b];
        // 자기보다 조금 위(계단·턱)까지는 같은 바닥으로
        const d = Math.abs(n.y - y) + (n.y > y + 1.2 ? 10 : 0);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      return best != null ? { b: best, d: bestD } : null;
    };
    const here = pick(c, r);
    if (here && here.d < 1.5) return here.b;
    for (let rad = 1; rad < 6; rad++) {
      let best = null, bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const p = pick(c + dc, r + dr);
          if (!p) continue;
          const d = p.d * 3 + dc * dc + dr * dr;
          if (d < bestD) {
            bestD = d;
            best = p.b;
          }
        }
      }
      if (best != null) return best;
    }
    return here?.b ?? null;
  }

  pointOf(b) {
    const n = this.nodes[b];
    return { x: this.map.cellX(n.c), y: n.y, z: this.map.cellZ(n.r) };
  }

  // 출발 → 목표 (둘 다 {x, y, z}). 월드 좌표 경로(첫 점 제외). 실패하면 null.
  // 예전 형식 findPath(sx, sz, tx, tz)도 받음 (1층 기준)
  findPath(from, to, tx, tz) {
    if (typeof from === 'number') {
      from = { x: from, y: 0, z: to };
      to = { x: tx, y: 0, z: tz };
    }
    const s = this.nodeNear(from.x, from.y ?? 0, from.z);
    const t = this.nodeNear(to.x, to.y ?? 0, to.z);
    if (s == null || t == null) return null;
    const nodes = this.nodes;
    const N = nodes.length;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const T = nodes[t];
    const h = (b) => {
      const n = nodes[b];
      const dc = Math.abs(n.c - T.c), dr = Math.abs(n.r - T.r);
      return Math.max(dc, dr) + (SQRT2 - 1) * Math.min(dc, dr) + Math.abs(n.y - T.y) * 0.5;
    };
    const open = new MinHeap();
    g[s] = 0;
    open.push(s, h(s));
    let found = false;
    while (open.size) {
      const cur = open.pop();
      if (closed[cur]) continue;
      if (cur === t) {
        found = true;
        break;
      }
      closed[cur] = 1;
      for (const [b, cost] of this.edges[cur]) {
        if (closed[b]) continue;
        const ng = g[cur] + cost;
        if (ng < g[b]) {
          g[b] = ng;
          came[b] = cur;
          open.push(b, ng + h(b));
        }
      }
    }
    if (!found) return null;
    const ids = [];
    for (let i = t; i !== -1; i = came[i]) ids.push(i);
    ids.reverse();
    const pts = ids.map((b) => ({ ...this.pointOf(b), node: b }));
    // 마지막 점은 실제 목표 지점(칸 중심이 아닌)으로 — 같은 칸·같은 바닥이면
    const tc = this.map.toCell(to.x, to.z);
    if (T.c === tc.c && T.r === tc.r && !T.ramp) pts[pts.length - 1] = { x: to.x, y: T.y, z: to.z, node: t };
    return this.smooth({ x: from.x, y: nodes[s].y, z: from.z, node: s }, pts).map(({ x, y, z }) => ({ x, y, z }));
  }

  // 같은 층에서 원 반지름만큼 여유를 두고 직선으로 갈 수 있는지 (예전 형식: 1층)
  clearLine(ax, az, bx, bz, radius = 0.45, y = 0) {
    const map = this.map;
    const dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(l / 0.3));
    for (let i = 0; i <= steps; i++) {
      const x = ax + (dx * i) / steps, z = az + (dz * i) / steps;
      for (const [ox, oz] of [[radius, radius], [radius, -radius], [-radius, radius], [-radius, -radius]]) {
        const { c, r } = map.toCell(x + ox, z + oz);
        if (!map.walkableAt(c, r, y)) return false;
      }
    }
    return true;
  }

  // 같은 높이의 평평한 바닥 위에서만 지름길로 줄임 (계단·뛰어내리기 지점은 그대로)
  smooth(start, pts) {
    if (pts.length <= 1) return pts;
    const flat = (p) => !this.nodes[p.node]?.ramp;
    const out = [];
    let from = start;
    let i = 0;
    while (i < pts.length) {
      let j = i;
      if (flat(from) && flat(pts[i]) && Math.abs(pts[i].y - from.y) < 0.05) {
        j = pts.length - 1;
        while (j > i && !(flat(pts[j]) && this.sameLevel(from, pts, i, j) && this.clearLine(from.x, from.z, pts[j].x, pts[j].z, 0.45, from.y))) j--;
      }
      out.push(pts[j]);
      from = pts[j];
      i = j + 1;
    }
    return out;
  }

  sameLevel(from, pts, i, j) {
    for (let k = i; k <= j; k++) if (Math.abs(pts[k].y - from.y) > 0.05 || this.nodes[pts[k].node]?.ramp) return false;
    return true;
  }
}

