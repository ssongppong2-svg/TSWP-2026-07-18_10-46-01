import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { emptyIntent, ZERO_G_MAX } from '../src/sim/agent.js';
import { GameMap } from '../src/sim/map.js';
import { stepThrown, aimForTarget, GRAVITY } from '../src/sim/gear.js';

// 진행 중인 경기에서 나 혼자 남기고, 내 의도를 마음대로 정함
function solo(mapId) {
  const m = new Match({ mapId, seed: 3, playerTeam: TEAMS.DEFUSE });
  m.phase = 'live';
  const me = m.player;
  for (const a of m.agents) if (a !== me) a.alive = false;
  let want = {};
  m.setController(me.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), ...want, yaw: ag.yaw, pitch: ag.pitch }) });
  const s = m.map.spawns.defuse[0];
  me.pos.x = me.prev.x = s.x;
  me.pos.z = me.prev.z = s.z;
  me.pos.y = me.prev.y = m.map.groundHeight(s.x, s.z, 0.3, 0.5);
  me.vel.x = me.vel.y = me.vel.z = 0;
  me.onGround = true;
  const run = (sec, w = {}) => {
    want = w;
    for (let i = 0; i < Math.round(sec / DT); i++) m.tick(DT);
    want = {};
  };
  return { m, me, run };
}

// 제자리에서 한 번 뛰어 가장 높이 오른 높이와 떠 있던 시간
function jump(mapId) {
  const { me, run } = solo(mapId);
  const y0 = me.pos.y;
  let top = 0, air = 0;
  run(DT * 2, { jump: true });
  for (let i = 0; i < 600 && !me.onGround; i++) {
    run(DT);
    top = Math.max(top, me.pos.y - y0);
    air += DT;
  }
  return { top, air };
}

test('달: 중력이 지구의 1/6 → 같은 다리 힘으로도 훨씬 높이·오래 뜸', () => {
  const map = new GameMap('moon-base');
  assert.ok(Math.abs(map.gravity - 1 / 6) < 1e-9);
  assert.equal(map.gravityAt(0, 0), map.gravity);
  const earth = jump('force-bound'), moon = jump('moon-base');
  assert.ok(moon.top > earth.top * 1.8, `높이 지구 ${earth.top.toFixed(2)} m · 달 ${moon.top.toFixed(2)} m`);
  assert.ok(moon.air > earth.air * 2, `체공 지구 ${earth.air.toFixed(2)} s · 달 ${moon.air.toFixed(2)} s`);
  // 너무 높이 뛰어 지붕·2층에 바로 오르지 않게 (한 층 3.6 m보다 낮게)
  assert.ok(moon.top < 3, `달 점프 ${moon.top.toFixed(2)} m`);
});

test('달: 같은 속도로 던진 물체가 더 멀리 날아감 · 조준 각도는 중력에 맞춤', () => {
  const fly = (mapId) => {
    const map = new GameMap(mapId);
    const t = { pos: { x: 0, y: 30, z: 0 }, vel: { x: 6, y: 4, z: 0 }, bounces: 0 };
    let time = 0;
    while (t.pos.y > 25 && time < 20) {
      stepThrown({ ...map, raycast: () => null, gravityAt: (x, z) => map.gravityAt(x, z) }, t, DT);
      time += DT;
    }
    return { x: t.pos.x, time };
  };
  const e = fly('force-bound'), mo = fly('moon-base');
  assert.ok(mo.x > e.x * 2, `지구 ${e.x.toFixed(1)} m · 달 ${mo.x.toFixed(1)} m`);
  // 같은 목표를 맞히려면 달에서는 더 낮게 던짐
  const to = { x: 0, y: 0, z: -20 };
  const pe = aimForTarget({ x: 0, y: 0, z: 0 }, to, 14, GRAVITY);
  const pm = aimForTarget({ x: 0, y: 0, z: 0 }, to, 14, GRAVITY / 6);
  assert.ok(pe && pm && pm.pitch < pe.pitch);
  // 무중력: 곧게 겨눔
  const p0 = aimForTarget({ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: -20 }, 14, 0);
  assert.ok(Math.abs(p0.pitch - Math.atan2(2, 20)) < 1e-9);
});

test('무중력 구역: 뛰면 떨어지지 않고 계속 떠오름 · 바라보는 쪽으로 분사해 나아감(최고 속도 제한)', () => {
  const { m, me, run } = solo('force-bound');
  const { c, r } = m.map.toCell(me.pos.x, me.pos.z);
  m.map.zeroG.push({ r0: r - 6, r1: r + 6, c0: c - 6, c1: c + 6 });
  assert.equal(m.map.gravityAt(me.pos.x, me.pos.z), 0);
  const y0 = me.pos.y;
  run(DT * 2, { jump: true });
  run(0.6);
  const y1 = me.pos.y;
  run(0.4);
  assert.ok(me.pos.y > y1 && y1 > y0, `떠오름 ${y0.toFixed(2)} → ${y1.toFixed(2)} → ${me.pos.y.toFixed(2)}`);
  // 위를 보고 앞으로 분사 → 위쪽 속도가 붙음, 최고 속도는 ZERO_G_MAX
  me.pitch = 1.2;
  run(2, { moveZ: 1 });
  assert.ok(me.vel.y > 1, `위쪽 속도 ${me.vel.y.toFixed(2)}`);
  assert.ok(Math.hypot(me.vel.x, me.vel.y, me.vel.z) <= ZERO_G_MAX + 1e-6);
});

test('무중력 구역에서는 중력 낙하(1톤 추)를 쓸 수 없음 — 무게가 0 (재사용 대기 없음)', () => {
  const { m, me } = solo('force-bound');
  me.patches[0] = { id: 'gravityDrop', cd: 0, activeT: 0 };
  me.ult = 999;
  me.pitch = -0.2;
  m.map.zeroG.push({ r0: 0, r1: m.map.rows - 1, c0: 0, c1: m.map.cols - 1 });
  const denied = [];
  m.events.on('patchDenied', (e) => denied.push(e.reason));
  assert.ok(!m.usePatch(me, 0));
  assert.deepEqual(denied, ['zeroG']);
  assert.ok(!m.zones.some((z) => z.type === 'drop'));
  // 달에서는 떨어지지만 √6 배 느리게 (t = √(2h÷g))
  const moon = solo('moon-base');
  moon.me.patches[0] = { id: 'gravityDrop', cd: 0, activeT: 0 };
  moon.me.ult = 999;
  moon.me.pitch = -0.2;
  assert.ok(moon.m.usePatch(moon.me, 0));
  const z = moon.m.zones.find((q) => q.type === 'drop');
  assert.ok(Math.abs(z.g - 9.8 / 6) < 1e-9);
  assert.ok(Math.abs(z.fall - Math.sqrt((2 * (z.top - z.y)) / z.g)) < 1e-9);
});

test('우주 화물선: 가운데 화물칸만 무중력 · 몸이 뜬 봇은 아래로 분사해 바닥으로 돌아옴', async () => {
  const { attachBots } = await import('../src/ai/bot.js');
  const m = new Match({ mapId: 'star-freighter', seed: 2 });
  attachBots(m, 'normal');
  const map = m.map;
  assert.equal(map.gravityAt(map.cellX(19), map.cellZ(12)), 0, '화물칸 = 무중력');
  assert.equal(map.gravityAt(map.cellX(6), map.cellZ(13)), 1, '엔진실 = 보통 중력');
  for (let i = 0; i < 60 * 12 && m.phase !== 'live'; i++) m.tick(DT);
  const bot = m.agents.find((a) => a.alive);
  bot.pos.x = bot.prev.x = map.cellX(19);
  bot.pos.z = bot.prev.z = map.cellZ(13);
  bot.pos.y = bot.prev.y = 2.5;
  bot.vel.x = bot.vel.y = bot.vel.z = 0;
  bot.onGround = false;
  let landed = false;
  for (let i = 0; i < 60 * 3 && !landed; i++) {
    m.tick(DT);
    landed = bot.onGround && bot.pos.y < 0.05;
  }
  assert.ok(landed, `바닥으로 돌아옴 (y=${bot.pos.y.toFixed(2)})`);
});
