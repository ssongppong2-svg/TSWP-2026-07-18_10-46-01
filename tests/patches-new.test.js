import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { emptyIntent } from '../src/sim/agent.js';
import { PATCHES } from '../src/sim/data.js';

// 진행 중인 경기: 나 + 적 하나만 남기고, 나는 앞이 12 m 트인 곳에 섬
function setup(patchId) {
  const m = new Match({ mapId: 'force-bound', seed: 7, playerTeam: TEAMS.DEFUSE });
  m.phase = 'live';
  const me = m.player;
  const foe = m.agents.find((a) => a.team !== me.team);
  for (const a of m.agents) if (a !== me && a !== foe) a.alive = false;
  const s = m.map.spawns.defuse[0];
  let yaw = 0;
  for (let k = 0; k < 48; k++) {
    const y = (k / 48) * Math.PI * 2;
    if (!m.map.raycast({ x: s.x, y: 1, z: s.z }, { x: s.x - Math.sin(y) * 12, y: 1, z: s.z - Math.cos(y) * 12 })) {
      yaw = y;
      break;
    }
  }
  const put = (a, x, z) => {
    a.pos.x = a.prev.x = x;
    a.pos.z = a.prev.z = z;
    a.pos.y = a.prev.y = m.map.groundHeight(x, z, 0.3, 0.5);
    a.vel.x = a.vel.y = a.vel.z = 0;
    a.onGround = true;
  };
  put(me, s.x, s.z);
  me.yaw = yaw;
  me.pitch = 0;
  const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  put(foe, s.x + fwd.x * 8, s.z + fwd.z * 8);
  foe.yaw = yaw + Math.PI;
  let intents = new Map();
  for (const a of [me, foe]) m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), ...(intents.get(ag.id) ?? {}), yaw: ag.yaw, pitch: ag.pitch }) });
  me.patches[0] = { id: patchId, cd: 0, activeT: 0 };
  me.ult = 999;
  const run = (sec, set = {}) => {
    intents = new Map(Object.entries(set));
    for (let i = 0; i < Math.round(sec / DT); i++) m.tick(DT);
    intents = new Map();
  };
  return { m, me, foe, fwd, put, run, s };
}

test('반작용 추진기: 뒤로 분사하면 반작용으로 앞으로 빠르게 미끄러져 나감', () => {
  const { m, me, run } = setup('reactionDash');
  const x0 = me.pos.x, z0 = me.pos.z;
  assert.ok(m.usePatch(me, 0));
  run(0.6);
  const d = Math.hypot(me.pos.x - x0, me.pos.z - z0);
  assert.ok(d > 3, `질주 거리 ${d.toFixed(2)} m`);
  assert.ok(me.patches[0].cd > 0, '재사용 대기');
});

test('무게 닻: 무게 ×3 → 폭발에 거의 안 밀리고, 느려지고, 점프 불가', () => {
  const a = setup('weightAnchor');
  const b = setup('weightAnchor');
  assert.ok(a.m.usePatch(a.me, 0));
  // 같은 폭발을 옆 2 m에서
  for (const t of [a, b]) {
    t.me.hp = 1000;
    t.m.blast({ x: t.me.pos.x + 2, y: t.me.pos.y + 0.2, z: t.me.pos.z, kind: 'frag', team: t.foe.team, ownerId: null }, { id: 'frag', radius: 6, damage: 1, pen: 0, wear: 0 }, null);
  }
  const push = (t) => Math.hypot(t.me.vel.x, t.me.vel.z);
  assert.ok(push(a) * 2.5 < push(b), `닻 ${push(a).toFixed(2)} vs 보통 ${push(b).toFixed(2)}`);
  assert.ok(a.me.onGround, '닻을 내리면 떠오르지 않음');
  a.me.vel.x = a.me.vel.z = 0;
  a.run(0.4, { [a.me.id]: { jump: true } });
  assert.ok(a.me.pos.y < 0.05, '점프 불가');
});

test('마찰 장갑: 손을 떼면 훨씬 빨리 멈춤', () => {
  const stopAfter = (grip) => {
    const t = setup('frictionGrip');
    if (grip) assert.ok(t.m.usePatch(t.me, 0));
    t.run(0.8, { [t.me.id]: { moveZ: 1 } });
    t.run(0.1);
    return Math.hypot(t.me.vel.x, t.me.vel.z);
  };
  const g = stopAfter(true), n = stopAfter(false);
  assert.ok(g < n * 0.6, `장갑 ${g.toFixed(2)} vs 보통 ${n.toFixed(2)} m/s`);
});

test('부력 풍선: 부력 > 중력이면 떠오르고, 정해진 높이에서 떠 있다가 끝나면 떨어짐', () => {
  const { m, me, run } = setup('buoyBalloon');
  const y0 = me.pos.y;
  const pops = [];
  m.events.on('balloonPop', (e) => pops.push(e));
  assert.ok(m.usePatch(me, 0));
  run(2.4);
  assert.ok(me.pos.y - y0 > PATCHES.buoyBalloon.rise - 0.4, `떠오른 높이 ${(me.pos.y - y0).toFixed(2)} m`);
  const yMid = me.pos.y;
  run(1);
  assert.ok(Math.abs(me.pos.y - yMid) < 0.3, '꼭대기에서는 떠 있음 (힘의 평형)');
  run(PATCHES.buoyBalloon.duration);
  assert.equal(pops.length, 1, '풍선이 터짐');
  assert.ok(me.pos.y - y0 < 0.1, '다시 땅으로');
});

test('탄성 덫: 적이 밟으면 튕겨 오르고 위치가 표시됨 · 한 번 터지면 사라짐', () => {
  const { m, me, foe, put, run, s: sp } = setup('springTrap');
  put(foe, sp.x + 30, sp.z + 30); // 덫 자리에서 멀리
  assert.ok(m.usePatch(me, 0));
  const trap = m.zones.find((z) => z.type === 'trap');
  assert.ok(trap, '덫이 놓임');
  run(0.7);
  const sprung = [];
  m.events.on('trapSprung', (e) => sprung.push(e));
  put(foe, trap.x, trap.z);
  run(0.1);
  assert.equal(sprung.length, 1);
  assert.ok(foe.vel.y > 3 || foe.pos.y > 0.2, '튕겨 오름');
  assert.ok(foe.revealedUntil > m.time + 2, '위치 표시');
  assert.ok(!m.zones.some((z) => z.type === 'trap'), '한 번 쓰면 사라짐');
});

test('합력 표적: 조준한 적에게 표적 · 맞힌 아군이 늘수록 피해 증가', () => {
  const { m, me, foe } = setup('resultantMark');
  foe.armor = 0;
  assert.ok(m.usePatch(me, 0));
  assert.ok(foe.markT > 0 && foe.revealedUntil > m.time + 5, '표적 · 팀에 보임');
  const ally = m.agents.find((a) => a.team === me.team && a !== me);
  ally.alive = true;
  foe.hp = 100;
  m.applyDamage(foe, 20, me);
  assert.equal(100 - foe.hp, 22, '1명: +10%');
  m.applyDamage(foe, 20, ally);
  assert.equal(100 - 22 - foe.hp, 24, '2명: +20%');
});

test('합력 표적: 조준한 곳에 적이 없으면 쓰지 않음 (재사용 대기 없음)', () => {
  const { m, me } = setup('resultantMark');
  me.yaw += Math.PI / 2;
  assert.ok(!m.usePatch(me, 0));
  assert.equal(me.patches[0].cd, 0);
});

test('중력 낙하: 떨어지는 시간 = √(2h÷g), 땅에 닿으면 반경 안의 적이 크게 다침', () => {
  const { m, me, foe, run } = setup('gravityDrop');
  foe.armor = 0;
  me.pitch = -0.2; // 앞쪽 바닥을 겨눔
  assert.ok(m.usePatch(me, 0));
  const z = m.zones.find((q) => q.type === 'drop');
  assert.ok(z);
  const h = z.top - z.y;
  assert.ok(Math.abs(z.fall - Math.sqrt((2 * h) / 9.8)) < 1e-6);
  // 적을 떨어질 자리에
  foe.pos.x = foe.prev.x = z.x;
  foe.pos.z = foe.prev.z = z.z;
  const hp0 = foe.hp;
  run(z.warn + z.fall - 0.1);
  assert.equal(foe.hp, hp0, '닿기 전에는 멀쩡');
  run(0.25);
  assert.ok(!foe.alive || foe.hp < hp0 - 60, `피해 ${hp0 - foe.hp}`);
});
