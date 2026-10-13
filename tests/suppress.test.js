import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { emptyIntent, eyePos } from '../src/sim/agent.js';
import { DT, SUPPRESS, TEAMS } from '../src/sim/constants.js';
import { WEAPONS } from '../src/sim/data.js';

const live = (seed = 5) => {
  const m = new Match({ seed, playerTeam: TEAMS.DEFUSE });
  m.phase = 'live';
  return m;
};
// 해체팀 시작 홀(트인 곳)에 세우기
function place(m, a, dx, dz) {
  const s = m.map.spawns.defuse[0];
  a.pos.x = a.prev.x = s.x + dx;
  a.pos.z = a.prev.z = s.z + dz;
  a.pos.y = a.prev.y = m.map.dropToGround(a.pos.x, a.pos.z, 2);
  a.vel.x = a.vel.y = a.vel.z = 0;
}
// 옆으로 off m 떨어진 곳을 앞에서 뒤로 지나가는 탄 (team = 쏜 편)
function bulletPast(m, target, off, team, weapon = 'rifle') {
  const e = eyePos(target);
  const from = { x: e.x + off, y: e.y, z: e.z - 6 };
  const p = {
    id: m.nextId++, ownerId: 'x', team, weapon, damage: WEAPONS[weapon].damage, pen: 3, wear: 1, ammo: 'fmj', bounces: 0,
    pos: { ...from }, prev: { ...from }, from: { ...from }, vel: { x: 0, y: 0, z: WEAPONS[weapon].speed }, life: 1, harmless: false, inVeil: false, pellet: false,
  };
  m.projectiles.push(p);
  return p;
}

test('제압: 적 탄이 머리 옆을 스치면 쌓이고 휙 사건이 한 번, 같은 편 탄·먼 탄은 아무 일 없음', () => {
  const m = live();
  const me = m.player;
  place(m, me, 0, 0);
  const events = [];
  m.events.on('nearMiss', (e) => events.push(e));
  bulletPast(m, me, 0.7, TEAMS.FORCE);
  for (let i = 0; i < 6; i++) m.updateProjectiles(DT);
  assert.equal(events.length, 1, '한 탄에 한 번');
  assert.equal(events[0].agent, me);
  assert.ok(Math.abs(events[0].d - 0.7) < 0.05, `가장 가까운 거리 ${events[0].d}`);
  const s1 = me.suppress;
  assert.ok(s1 > 0.1 && s1 < 0.5, `제압 ${s1}`);
  // 같은 편 탄
  bulletPast(m, me, 0.4, TEAMS.DEFUSE);
  // 반경 밖 탄
  bulletPast(m, me, SUPPRESS.radius + 0.4, TEAMS.FORCE);
  for (let i = 0; i < 6; i++) m.updateProjectiles(DT);
  assert.equal(events.length, 1);
  assert.equal(me.suppress, s1);
  // 경기관총 탄은 소총보다 세게, 가까울수록 세게
  me.suppress = 0;
  bulletPast(m, me, 0.3, TEAMS.FORCE, 'lmg');
  for (let i = 0; i < 6; i++) m.updateProjectiles(DT);
  assert.ok(me.suppress > s1 * 1.5, `경기관총 ${me.suppress} > 소총 ${s1}`);
});

test('제압: 잠깐 머문 뒤 줄어들어 사라짐', () => {
  const m = live();
  const me = m.player;
  me.suppress = 0.8;
  me.suppressHold = SUPPRESS.hold;
  const step = (sec) => { for (let i = 0; i < Math.round(sec / DT); i++) m.stepWeapon(me, emptyIntent(me), DT, true); };
  step(SUPPRESS.hold * 0.8);
  assert.equal(me.suppress, 0.8, '머무는 동안은 그대로');
  step(0.5);
  assert.ok(me.suppress < 0.8 && me.suppress > 0);
  step(3);
  assert.equal(me.suppress, 0);
});

test('제압: 쌓일수록 탄이 빗나감 (서서 정조준해도)', () => {
  const spreadOf = (supp) => {
    const m = live(9);
    const me = m.player;
    me.weapon = 'rifle';
    me.adsT = 1;
    let sum = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      me.suppress = supp;
      me.bloom = me.recoil = me.recoilYaw = me.punch = 0;
      me.sinceShot = 9;
      m.fire(me, WEAPONS.rifle, { mag: 99, reserve: 0 });
      const p = m.projectiles.pop();
      const v = p.vel, sp = Math.hypot(v.x, v.y, v.z);
      const aim = { x: -Math.sin(me.yaw) * Math.cos(me.pitch), y: Math.sin(me.pitch), z: -Math.cos(me.yaw) * Math.cos(me.pitch) };
      const c = (v.x * aim.x + v.y * aim.y + v.z * aim.z) / sp;
      sum += Math.acos(Math.min(1, Math.abs(c)));
    }
    return sum / n;
  };
  const calm = spreadOf(0), shaken = spreadOf(1);
  assert.ok(shaken > calm * 3, `제압 ${shaken.toFixed(4)} vs 평소 ${calm.toFixed(4)}`);
});
