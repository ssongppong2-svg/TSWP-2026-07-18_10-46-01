import test from 'node:test';
import assert from 'node:assert/strict';
import { GameMap, STORY, SLAB, KIND } from '../src/sim/map.js';
import { NavGrid } from '../src/sim/nav.js';
import { createAgent, emptyIntent, stepMovement } from '../src/sim/agent.js';
import { MAP_ORDER } from '../src/sim/maps/index.js';

// 작은 시험 맵: 서쪽 계단(c3-4, r6→r3 북쪽으로 오름)이 2층 다리(r2, c3-9)로 이어지고, 다리 아래는 1층 통로.
// 다리 양쪽 가장자리에는 난간이 저절로 생기고, o 칸(c8)만 트여 있음
const TEST = {
  id: 'floors-test',
  layout: [
    '############',
    '#..........#',
    '#..........#',
    '#..^^......#',
    '#..^^......#',
    '#..^^......#',
    '#..^^......#',
    '#..........#',
    '#..........#',
    '############',
  ],
  upper: [
    '############',
    '#          #',
    '#  =====o=  ',
    '#          #',
    '#          #',
    '#          #',
    '#          #',
    '#          #',
    '#          #',
    '############',
  ].map((l) => l.padEnd(12, ' ').slice(0, 12)),
};
const map = new GameMap(TEST);
const P = (c, r, y = 0) => ({ x: map.cellX(c), y, z: map.cellZ(r) });

test('2층: 다리 칸은 바닥판 한 구간만 막혀 있고, 위·아래 두 층에 설 수 있음', () => {
  assert.deepEqual(map.spansAt(6, 2), [[STORY - SLAB, STORY, KIND.slab]]);
  assert.deepEqual(map.surfaces(6, 2), [0, STORY]);
  assert.deepEqual(map.surfaces(6, 1), [0], '다리 옆 칸은 1층만');
  assert.equal(map.railMask[map.idx(6, 2)], 1 | 2, '다리 칸: 북·남 가장자리 난간');
  assert.equal(map.railMask[map.idx(8, 2)], 0, 'o 칸은 난간 없음');
  assert.equal(map.railMask[map.idx(3, 2)] & 2, 0, '계단 윗끝 쪽은 트여 있음');
  assert.equal(map.groundHeight(map.cellX(6), map.cellZ(2), 0.3, 0.4), 0);
  assert.equal(map.groundHeight(map.cellX(6), map.cellZ(2), 0.3, STORY + 0.4), STORY);
  assert.ok(Math.abs(map.ramp(3, 6).h0) < 1e-6 && Math.abs(map.ramp(3, 3).h1 - STORY) < 1e-6, '계단은 0 → 3.6m');
});

test('2층: 탄·시야 — 다리 밑으로는 지나가고, 바닥판은 위·아래에서 막음', () => {
  assert.ok(map.lineOfSight(P(6, 5, 1.6), P(6, 1, 1.6)), '다리 밑 눈높이 시야');
  const up = map.raycast(P(6, 2, 1.6), P(6, 2, 6));
  assert.ok(up && Math.abs(up.y - (STORY - SLAB)) < 1e-6 && up.ny === -1, '아래에서 쏘면 바닥판 밑면');
  const down = map.raycast(P(6, 2, 6), P(6, 2, 0.5));
  assert.ok(down && Math.abs(down.y - STORY) < 1e-6 && down.ny === 1, '위에서 쏘면 바닥판 윗면');
  const rail = map.raycast(P(6, 2, STORY + 0.5), P(6, 0, STORY + 0.5));
  assert.ok(rail && rail.nz === 1 && Math.abs(rail.z - (map.cellZ(2) - 1 + 0.1)) < 1e-6, '난간 높이의 탄은 북쪽 난간 안쪽 면에 맞음');
  assert.ok(map.lineOfSight(P(6, 2, STORY + 1.6), P(6, 1, STORY + 1.6)), '난간 위로는 보임');
  assert.ok(map.lineOfSight(P(8, 2, STORY + 0.5), P(8, 3.4, STORY + 0.5)), 'o 칸 가장자리는 트여 있음');
});

test('2층: 길찾기 — 1층에서 다리 위로는 계단을 거치고, 다리에서 1층으로는 뛰어내림', () => {
  const nav = new NavGrid(map);
  const path = nav.findPath(P(9, 7), P(8, 2, STORY));
  assert.ok(path, '길이 있어야 함');
  assert.ok(Math.abs(path.at(-1).y - STORY) < 1e-6);
  assert.ok(path.some((p) => p.y > 0.1 && p.y < STORY - 0.1), '계단(중간 높이)을 지남');
  assert.ok(path.some((p) => map.toCell(p.x, p.z).c <= 4), '서쪽 계단으로 돌아감');
  const drop = nav.findPath(P(8, 2, STORY), P(8, 4));
  assert.ok(drop && drop.length <= 3, 'o 칸에서 바로 뛰어내림');
  assert.equal(drop.at(-1).y, 0);
  // 난간이 있는 곳에서는 뛰어내리지 않고 o 칸으로 돌아감
  const around = nav.findPath(P(6, 2, STORY), P(6, 4));
  assert.ok(around.some((p) => map.toCell(p.x, p.z).c === 8 && p.y > 1), 'o 칸을 거침');
});

test('2층: 요원이 계단을 걸어 올라 다리 위에 서고, 다리 밑에서는 머리가 바닥판에 막힘', () => {
  const a = createAgent({ id: 1, name: 't', team: 'defuse', spawn: { x: map.cellX(3) + 1, z: map.cellZ(7) } });
  const intent = emptyIntent(a);
  intent.moveZ = 1; // 북쪽(앞)으로
  for (let i = 0; i < 60 * 4; i++) stepMovement(a, intent, map, 1 / 60, true);
  assert.ok(Math.abs(a.pos.y - STORY) < 0.05, `2층 높이에 섬 (y=${a.pos.y.toFixed(2)})`);
  assert.equal(map.toCell(a.pos.x, a.pos.z).r, 2);
  // 다리 밑에서 탄성판처럼 위로 튕겨도 머리가 3.3m 바닥판에 막힘
  const b = createAgent({ id: 2, name: 'u', team: 'force', spawn: { x: map.cellX(7), z: map.cellZ(2) } });
  const still = emptyIntent(b);
  b.vel.y = 14;
  b.onGround = false;
  let top = 0;
  for (let i = 0; i < 90; i++) {
    stepMovement(b, still, map, 1 / 60, true);
    top = Math.max(top, b.pos.y);
  }
  assert.ok(top + 1.85 <= STORY - SLAB + 1e-6, `머리 높이 ${(top + 1.85).toFixed(2)}`);
  assert.ok(b.pos.y < 0.01, '다시 1층 바닥');
});

test('2층: 난간이 몸을 막아 다리에서 떨어지지 않음', () => {
  const a = createAgent({ id: 3, name: 'r', team: 'defuse', spawn: { x: map.cellX(6), z: map.cellZ(2) } });
  a.pos.y = a.prev.y = STORY;
  const intent = emptyIntent(a);
  intent.moveZ = -1; // 남쪽(뒤)으로 계속 걸음
  for (let i = 0; i < 120; i++) stepMovement(a, intent, map, 1 / 60, true);
  assert.ok(Math.abs(a.pos.y - STORY) < 0.01, '2층에 그대로');
  assert.ok(a.pos.z < map.cellZ(2) + 1 - 0.1, '난간 안쪽');
});

test('2층 맵: 모든 맵에 2층 바닥과 계단이 있고, 계단 아래·위 끝이 막히지 않음', () => {
  const RUP = { 1: [0, -1], 2: [0, 1], 3: [-1, 0], 4: [1, 0] };
  for (const id of MAP_ORDER) {
    const m = new GameMap(id);
    let upper = 0, ramps = 0;
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        if (m.surfaces(c, r).includes(STORY)) upper++;
        const rp = m.ramp(c, r);
        if (!rp) continue;
        ramps++;
        const [dc, dr] = RUP[rp.dir];
        if (rp.h0 === 0) assert.ok(m.walkableAt(c - dc, r - dr, 0), `${id} 계단 아래 입구 (${r}, ${c})`);
        if (Math.abs(rp.h1 - STORY) < 1e-6) assert.ok(m.walkableAt(c + dc, r + dr, STORY), `${id} 계단 위 출구 (${r}, ${c})`);
      }
    }
    assert.ok(upper > 60 && ramps >= 16, `${id}: 2층 ${upper}칸 · 계단 ${ramps}칸`);
  }
});
