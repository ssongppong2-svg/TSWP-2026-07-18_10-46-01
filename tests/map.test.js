import test from 'node:test';
import assert from 'node:assert/strict';
import { GameMap, STORY } from '../src/sim/map.js';
import { NavGrid } from '../src/sim/nav.js';
import { MAP_ORDER } from '../src/sim/maps/index.js';

const map = new GameMap();

test('맵: 폭탄 2개와 팀별 시작 위치', () => {
  assert.deepEqual(map.bombs.map((b) => b.id), ['A', 'B']);
  assert.ok(map.spawns.defuse.length >= 5);
  assert.ok(map.spawns.force.length >= 5);
  assert.ok(map.holds.A.length >= 2);
});

test('맵: 모든 맵의 지키는 자리·모이는 자리·개념 카드 자리는 그 층의 바닥', () => {
  for (const id of MAP_ORDER) {
    const m = new GameMap(id);
    const spots = [...Object.values(m.holds).flat(), ...Object.values(m.staging).flat()];
    for (const h of spots) {
      const { c, r } = m.toCell(h.x, h.z);
      assert.ok(m.walkableAt(c, r, h.y), `${id} 자리 (${r}, ${c}, y${h.y})`);
    }
    for (const s of m.def.concepts) assert.ok(m.walkableAt(s.c, s.r, s.f ? STORY : 0), `${id} 개념 카드 (${s.r}, ${s.c})`);
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

test('맵: 두 팀 진영 사이에 눈높이 직선 시야가 없음 (시작하자마자 저격 방지)', () => {
  for (const id of MAP_ORDER) {
    const m = new GameMap(id);
    const area = (r0, r1) => {
      const out = [];
      for (let r = r0; r <= r1; r++) {
        for (let c = 0; c < m.cols; c++) {
          if (!m.walkable(c, r)) continue;
          for (const [ox, oz] of [[0.25, 0.25], [0.75, 0.75]]) out.push({ x: m.originX + (c + ox) * 2, y: 1.6, z: m.originZ + (r + oz) * 2 });
        }
      }
      return out;
    };
    const north = area(1, 4), south = area(32, 38);
    let lines = 0;
    for (const a of north) for (const b of south) if (m.lineOfSight(a, b)) lines++;
    assert.equal(lines, 0, id);
  }
});
