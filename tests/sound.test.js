import test from 'node:test';
import assert from 'node:assert/strict';
import { GameMap, STORY } from '../src/sim/map.js';
import { footSurface, isCovered } from '../src/client/sound-surfaces.js';

// 소리용 위치 판별: 발밑 재질과 머리 위 지붕
const cells = (m, fn) => {
  const out = [];
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) if (fn(c, r)) out.push({ c, r, x: m.cellX(c), z: m.cellZ(r) });
  return out;
};

test('포스 바운드: 1층은 콘크리트, 2층 철제 통로는 쇠, 계단은 계단 소리', () => {
  const m = new GameMap('force-bound');
  const ground = cells(m, (c, r) => m.walkable(c, r) && m.surfaces(c, r).includes(0));
  assert.ok(ground.length > 100);
  for (const g of ground.slice(0, 40)) assert.equal(footSurface(m, g.x, 0, g.z), 'concrete');
  const walk = cells(m, (c, r) => m.upperAt(c, r) === '=' && m.surfaces(c, r).includes(STORY));
  assert.ok(walk.length > 0, '철제 통로 칸이 있어야 함');
  for (const w of walk) assert.equal(footSurface(m, w.x, STORY, w.z), 'metal');
  const ramps = cells(m, (c, r) => !!m.ramp(c, r));
  assert.ok(ramps.length > 0);
  for (const s of ramps) assert.equal(footSurface(m, s.x, 1.8, s.z), 'stairs');
  // 상자 위
  assert.equal(footSurface(m, ground[0].x, 1.0, ground[0].z), 'metal');
  // 맵 밖은 콘크리트로 (오류 없이)
  assert.equal(footSurface(m, -9999, 0, -9999), 'concrete');
});

test('과학관: 바닥은 타일, 완전 실내라 어디서나 지붕 아래', () => {
  const m = new GameMap('science-hall');
  const ground = cells(m, (c, r) => m.walkable(c, r) && m.surfaces(c, r).includes(0));
  assert.ok(ground.length > 100);
  for (const g of ground) {
    assert.equal(footSurface(m, g.x, 0, g.z), 'tile');
    assert.ok(isCovered(m, g.x, 0, g.z), `(${g.c}, ${g.r}) 1층 머리 위가 막혀 있어야 함`);
  }
  const upper = cells(m, (c, r) => m.surfaces(c, r).includes(STORY));
  for (const u of upper) assert.ok(isCovered(m, u.x, STORY, u.z), `(${u.c}, ${u.r}) 2층 머리 위가 막혀 있어야 함`);
});

test('포스 바운드: 마당은 트여 있고 창고·건물 안은 지붕 아래 (실내 울림)', () => {
  const m = new GameMap('force-bound');
  const ground = cells(m, (c, r) => m.walkable(c, r) && m.surfaces(c, r).includes(0));
  const covered = ground.filter((g) => isCovered(m, g.x, 0, g.z));
  const open = ground.filter((g) => !isCovered(m, g.x, 0, g.z));
  assert.ok(covered.length > 20, '지붕 아래 칸이 있어야 함');
  assert.ok(open.length > 100, '트인 마당 칸이 있어야 함');
  // 지붕 사각형 안의 1층은 모두 덮여 있음
  for (const q of m.roofs) {
    for (const g of ground) if (g.r >= q.r0 && g.r <= q.r1 && g.c >= q.c0 && g.c <= q.c1) assert.ok(isCovered(m, g.x, 0, g.z));
  }
  assert.equal(isCovered(m, -9999, 0, -9999), false);
});
