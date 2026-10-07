import test from 'node:test';
import assert from 'node:assert/strict';
import { GameMap } from '../src/sim/map.js';
import { NavGrid } from '../src/sim/nav.js';

const map = new GameMap();

test('맵: 폭탄 2개와 팀별 시작 위치', () => {
  assert.deepEqual(map.bombs.map((b) => b.id), ['A', 'B']);
  assert.ok(map.spawns.defuse.length >= 5);
  assert.ok(map.spawns.force.length >= 5);
  assert.equal(map.holds.A.length, 2);
  for (const list of Object.values(map.holds)) {
    for (const h of list) {
      const { c, r } = map.toCell(h.x, h.z);
      assert.ok(map.walkable(c, r), '지키는 자리는 바닥이어야 함');
    }
  }
});

test('맵: 레이캐스트가 벽에서 멈춤', () => {
  const b = map.bombs[0];
  const hit = map.raycast({ x: b.x, y: 1.6, z: b.z }, { x: b.x - 100, y: 1.6, z: b.z });
  assert.ok(hit, '서쪽 외벽에 맞아야 함');
  assert.equal(hit.nx, 1);
  assert.ok(hit.x > map.originX && hit.x < b.x);
});

test('맵: 바닥을 향한 레이는 바닥(y=0)에서 멈춤', () => {
  const s = map.spawns.defuse[0];
  const hit = map.raycast({ x: s.x, y: 1.6, z: s.z }, { x: s.x, y: -5, z: s.z - 1 });
  assert.ok(hit);
  assert.ok(Math.abs(hit.y) < 1e-6);
  assert.equal(hit.ny, 1);
});

test('맵: 원 충돌이 벽 밖으로 밀어냄', () => {
  const pos = { x: map.originX + 4.1, y: 0, z: 0 };
  const vel = { x: -5, y: 0, z: 0 };
  map.collideCircle(pos, 0.35, 0, 0.4, vel);
  assert.ok(pos.x >= map.originX + 4 + 0.35 - 1e-6);
  assert.equal(vel.x, 0);
});

test('길찾기: 양 팀 시작 위치에서 두 폭탄까지 길이 있음', () => {
  const nav = new NavGrid(map);
  for (const team of ['defuse', 'force']) {
    const s = map.spawns[team][0];
    for (const b of map.bombs) {
      const path = nav.findPath(s.x, s.z, b.x, b.z);
      assert.ok(path && path.length > 0, `${team} → ${b.id}`);
      const last = path[path.length - 1];
      assert.ok(Math.hypot(last.x - b.x, last.z - b.z) < 0.01);
    }
  }
});
