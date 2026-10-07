import { CELL } from './constants.js';

// ─────────────────────────────────────────────────────────────
// 맵: 포스 바운드 (Force Bound)
// 한 글자 = 2m × 2m 한 칸. 글자만 바꾸면 맵을 직접 고칠 수 있어요.
//   #  벽 (4.8m)            C  큰 상자 (2.2m, 탄성판으로 올라갈 수 있음)
//   c  작은 상자 (1.0m)      =  낮은 방벽 (1.1m)
//   .  바닥                  a / b  A·B 구역 바닥
//   A / B  폭탄 위치          F / D  포스팀 / 해체팀 시작 위치
// 위쪽(북쪽)이 포스팀 진영, 아래쪽(남쪽)이 해체팀 진영입니다.
// ─────────────────────────────────────────────────────────────
export const FORCE_BOUND = {
  id: 'force-bound',
  name: '포스 바운드',
  layout: [
    '####################################',
    '##................................##',
    '##....C.......FFFFFFFF.......C....##',
    '##................................##',
    '##...#######............#######...##',
    '##...........####..####...........##',
    '##.C.........##......##.........C.##',
    '##.aaaaaa==a.##.CCCC.##.b==bbbbbb.##',
    '##.aaaaaaaaa.##......##.bbbbbbbbb.##',
    '##.aCCaaaaaa.##.c..c.##.bbbbbbCCb.##',
    '##.aaaaaaaaa.##......##.bbbbbbbbb.##',
    '##.aaaaAaaaa............bbbbBbbbb.##',
    '##.aacaaaaaa............bbbbbbcbb.##',
    '##.aaaaaacaa............bbcbbbbbb.##',
    '##.aaaaaacaa.##......##.bbcbbbbbb.##',
    '##.aCaaaaaaa.##..CC..##.bbbbbbbCb.##',
    '##...........##......##...........##',
    '####...########......########...####',
    '####...########......########...####',
    '##...c.########C....C########.c...##',
    '##.....########......########.....##',
    '##................................##',
    '##........c..............c........##',
    '##................................##',
    '##.....########.C..C.########.....##',
    '##.....########......########.....##',
    '##.C...########......########...C.##',
    '##.C...########..CC..########...C.##',
    '##.....########......########.....##',
    '##...##########......##########...##',
    '##...##########......##########...##',
    '##.....########......########.....##',
    '##................................##',
    '##................................##',
    '##....C......................C....##',
    '##....c......................c....##',
    '##............DDDDDDDD............##',
    '##................................##',
    '##................................##',
    '####################################',
  ],
  // 포스팀 봇이 지키는 자리 (r=줄, c=칸, lr/lc=바라볼 칸)
  holds: {
    A: [
      { r: 8, c: 10, lr: 12, lc: 14 },
      { r: 10, c: 3, lr: 17, lc: 4 },
    ],
    B: [
      { r: 8, c: 25, lr: 12, lc: 21 },
      { r: 10, c: 32, lr: 17, lc: 31 },
    ],
    mid: [{ r: 8, c: 17, lr: 22, lc: 17 }],
  },
};

export const TILES = {
  '#': { h: 4.8, kind: 'wall' },
  C: { h: 2.2, kind: 'bigCrate' },
  c: { h: 1.0, kind: 'crate' },
  '=': { h: 1.1, kind: 'barrier' },
};

export class GameMap {
  constructor(def = FORCE_BOUND) {
    this.def = def;
    this.name = def.name;
    this.rows = def.layout.length;
    this.cols = def.layout[0].length;
    this.width = this.cols * CELL;
    this.depth = this.rows * CELL;
    this.originX = -this.width / 2;
    this.originZ = -this.depth / 2;
    this.chars = [];
    this.heights = new Float32Array(this.cols * this.rows);
    this.bombs = [];
    this.spawns = { defuse: [], force: [] };
    this.siteCells = { A: [], B: [] };

    for (let r = 0; r < this.rows; r++) {
      const line = def.layout[r];
      if (line.length !== this.cols) throw new Error(`맵 ${r}번째 줄의 길이가 다릅니다.`);
      for (let c = 0; c < this.cols; c++) {
        const ch = line[c];
        this.chars.push(ch);
        this.heights[this.idx(c, r)] = TILES[ch]?.h ?? 0;
        const x = this.cellX(c), z = this.cellZ(r);
        if (ch === 'A' || ch === 'B') {
          this.bombs.push({ id: ch, c, r, x, z });
          this.siteCells[ch].push({ c, r });
        }
        if (ch === 'a') this.siteCells.A.push({ c, r });
        if (ch === 'b') this.siteCells.B.push({ c, r });
        if (ch === 'F') this.spawns.force.push({ c, r, x, z });
        if (ch === 'D') this.spawns.defuse.push({ c, r, x, z });
      }
    }
    this.bombs.sort((a, b) => a.id.localeCompare(b.id));
    const toWorld = (h) => ({ x: this.cellX(h.c), z: this.cellZ(h.r), lookX: this.cellX(h.lc), lookZ: this.cellZ(h.lr) });
    this.holds = Object.fromEntries(Object.entries(def.holds ?? {}).map(([k, list]) => [k, list.map(toWorld)]));
  }

  idx(c, r) {
    return r * this.cols + c;
  }

  inBounds(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  heightAt(c, r) {
    return this.inBounds(c, r) ? this.heights[this.idx(c, r)] : Infinity;
  }

  charAt(c, r) {
    return this.inBounds(c, r) ? this.chars[this.idx(c, r)] : '#';
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

  walkable(c, r) {
    return this.inBounds(c, r) && this.heights[this.idx(c, r)] === 0;
  }

  // 원(반지름 radius) 아래에서 maxY 이하인 가장 높은 바닥 높이
  groundHeight(x, z, radius, maxY) {
    let best = 0;
    const c0 = Math.floor((x - radius - this.originX) / CELL);
    const c1 = Math.floor((x + radius - this.originX) / CELL);
    const r0 = Math.floor((z - radius - this.originZ) / CELL);
    const r1 = Math.floor((z + radius - this.originZ) / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const h = this.heightAt(c, r);
        if (h <= best || h > maxY + 1e-4) continue;
        const minX = this.originX + c * CELL, minZ = this.originZ + r * CELL;
        const cx = Math.max(minX, Math.min(x, minX + CELL));
        const cz = Math.max(minZ, Math.min(z, minZ + CELL));
        if ((x - cx) ** 2 + (z - cz) ** 2 < radius * radius) best = h;
      }
    }
    return best;
  }

  // 원기둥(사람)을 벽·상자 밖으로 밀어냄. 벽 쪽으로 향하던 속도 성분은 없앰.
  collideCircle(pos, radius, feetY, stepHeight, vel) {
    const blockY = feetY + stepHeight;
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const c0 = Math.floor((pos.x - radius - this.originX) / CELL);
      const c1 = Math.floor((pos.x + radius - this.originX) / CELL);
      const r0 = Math.floor((pos.z - radius - this.originZ) / CELL);
      const r1 = Math.floor((pos.z + radius - this.originZ) / CELL);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (this.heightAt(c, r) <= blockY) continue;
          const minX = this.originX + c * CELL, maxX = minX + CELL;
          const minZ = this.originZ + r * CELL, maxZ = minZ + CELL;
          const cx = Math.max(minX, Math.min(pos.x, maxX));
          const cz = Math.max(minZ, Math.min(pos.z, maxZ));
          let dx = pos.x - cx, dz = pos.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= radius * radius) continue;
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

  // 선분 a→b가 처음 부딪히는 곳 (격자 DDA). 없으면 null.
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
      const h = this.heightAt(c, r);
      if (h > 0) {
        const yIn = ay + dy * tEnter;
        if (yIn < h) {
          if (nx === 0 && nz === 0) {
            const l = Math.hypot(dx, dz) || 1;
            return hit(tEnter, -dx / l, 0, -dz / l);
          }
          return hit(tEnter, nx, 0, nz);
        }
        const yOut = ay + dy * tExit;
        if (yOut < h) return hit((h - ay) / dy, 0, 1, 0);
      }
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

  // 그 지점의 바닥(상자 위 포함)에 놓을 위치
  dropToGround(x, z, fromY) {
    const { c, r } = this.toCell(x, z);
    const h = this.heightAt(c, r);
    return h <= fromY + 0.05 && h !== Infinity ? h : 0;
  }
}
