// 봇 길찾기: 맵 칸 위에서 A* 로 경로를 찾고, 직선으로 갈 수 있는 구간은 줄여서 자연스럽게 움직이게 합니다.

const SQRT2 = Math.SQRT2;
const NEIGHBORS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

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
  }

  nearestWalkable(c, r) {
    const map = this.map;
    if (map.walkable(c, r)) return { c, r };
    for (let rad = 1; rad < 6; rad++) {
      let best = null, bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          if (!map.walkable(c + dc, r + dr)) continue;
          const d = dc * dc + dr * dr;
          if (d < bestD) {
            bestD = d;
            best = { c: c + dc, r: r + dr };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // 월드 좌표 → 월드 좌표 경로(첫 점 제외). 실패하면 null.
  findPath(sx, sz, tx, tz) {
    const map = this.map;
    const s0 = map.toCell(sx, sz), t0 = map.toCell(tx, tz);
    const s = this.nearestWalkable(s0.c, s0.r);
    const t = this.nearestWalkable(t0.c, t0.r);
    if (!s || !t) return null;
    const cols = this.cols;
    const total = cols * this.rows;
    const g = new Float32Array(total).fill(Infinity);
    const came = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const startI = s.r * cols + s.c, goalI = t.r * cols + t.c;
    const h = (c, r) => {
      const dc = Math.abs(c - t.c), dr = Math.abs(r - t.r);
      return Math.max(dc, dr) + (SQRT2 - 1) * Math.min(dc, dr);
    };
    const open = new MinHeap();
    g[startI] = 0;
    open.push(startI, h(s.c, s.r));
    let found = false;
    while (open.size) {
      const cur = open.pop();
      if (closed[cur]) continue;
      if (cur === goalI) {
        found = true;
        break;
      }
      closed[cur] = 1;
      const c = cur % cols, r = (cur - c) / cols;
      for (const [dc, dr, cost] of NEIGHBORS) {
        const nc = c + dc, nr = r + dr;
        if (!map.walkable(nc, nr)) continue;
        if (dc && dr && (!map.walkable(c + dc, r) || !map.walkable(c, r + dr))) continue;
        const ni = nr * cols + nc;
        if (closed[ni]) continue;
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          open.push(ni, ng + h(nc, nr));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goalI; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => {
      const c = i % cols, r = (i - c) / cols;
      return { x: map.cellX(c), z: map.cellZ(r) };
    });
    // 마지막 점은 실제 목표 지점(칸 중심이 아닌)으로
    if (map.walkable(t0.c, t0.r)) pts[pts.length - 1] = { x: tx, z: tz };
    return this.smooth({ x: sx, z: sz }, pts);
  }

  // 원 반지름(radius)만큼 여유를 두고 직선으로 갈 수 있는지
  clearLine(ax, az, bx, bz, radius = 0.45) {
    const map = this.map;
    const dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(l / 0.3));
    for (let i = 0; i <= steps; i++) {
      const x = ax + (dx * i) / steps, z = az + (dz * i) / steps;
      for (const [ox, oz] of [[radius, radius], [radius, -radius], [-radius, radius], [-radius, -radius]]) {
        const { c, r } = map.toCell(x + ox, z + oz);
        if (!map.walkable(c, r)) return false;
      }
    }
    return true;
  }

  smooth(start, pts) {
    if (pts.length <= 1) return pts;
    const out = [];
    let from = start;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.clearLine(from.x, from.z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      from = pts[j];
      i = j + 1;
    }
    return out;
  }
}
