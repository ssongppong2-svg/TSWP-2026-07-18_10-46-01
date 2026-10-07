import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { DT, TEAMS, PLAYER } from '../src/sim/constants.js';
import { emptyIntent, eyePos, stepMovement } from '../src/sim/agent.js';
import { WEAPONS } from '../src/sim/data.js';

// 해체팀 시작 홀(넓은 공간)에 나와 적 1명만 남긴 경기
function duel(loadout = ['gravityVeil', 'elasticPad', 'frictionZero', 'gravityCollapse'], gap = 12) {
  const match = new Match({ seed: 4, playerTeam: TEAMS.DEFUSE, loadouts: new Map([['defuse-0', loadout]]) });
  match.phase = 'live';
  const me = match.player;
  const enemy = match.agents.find((a) => a.team === TEAMS.FORCE);
  for (const a of match.agents) if (a !== me && a !== enemy) a.alive = false;
  const z = match.map.spawns.defuse[0].z;
  me.pos = { x: -6, y: 0, z };
  me.prev = { ...me.pos };
  enemy.pos = { x: -6 + gap, y: 0, z };
  enemy.prev = { ...enemy.pos };
  me.yaw = -Math.PI / 2; // 동쪽(+x)을 봄
  enemy.yaw = Math.PI / 2; // 서쪽(-x)을 봄
  return { match, me, enemy };
}

const step = (match, n) => {
  for (let i = 0; i < n; i++) match.tick(DT);
};

test('작용·반작용 도탄: 벽에 맞은 탄이 반사되고 위력이 85%로 줄어듦', () => {
  const { match, me } = duel(['reactionRounds', 'elasticPad', 'frictionZero', 'gravityCollapse']);
  assert.ok(match.usePatch(me, 0));
  me.yaw = 0; // 북쪽 벽(31번째 줄)을 향해
  me.pitch = 0;
  const w = { ...WEAPONS.rifle, spreadBase: 0, spreadMove: 0, spreadAir: 0 };
  match.fire(me, w, me.weapons.rifle);
  const p = match.projectiles.at(-1);
  let ricochet = null;
  match.events.on('ricochet', (e) => (ricochet = e));
  for (let i = 0; i < 30 && !ricochet; i++) match.updateProjectiles(DT);
  assert.ok(ricochet, '도탄 이벤트');
  assert.ok(match.projectiles.includes(p), '반사 후에도 날아감');
  assert.ok(p.vel.z > 0, '반대 방향으로 튕김');
  assert.ok(Math.abs(p.damage - 24 * 0.85) < 1e-9);
  assert.equal(p.bounces, 0);
});

test('부력 방패: 적 탄을 막고 내구도가 닳으면 부서짐', () => {
  const { match, me, enemy } = duel(['buoyShield', 'elasticPad', 'frictionZero', 'gravityCollapse']);
  assert.ok(match.usePatch(me, 0));
  assert.equal(match.shields.length, 1);
  const w = { ...WEAPONS.rifle, spreadBase: 0, spreadMove: 0, spreadAir: 0 };
  enemy.pitch = -0.02;
  const shoot = (n) => {
    for (let k = 0; k < n; k++) {
      enemy.weapons.rifle.mag = 25;
      enemy.recoil = enemy.recoilYaw = enemy.bloom = 0;
      match.fire(enemy, w, enemy.weapons.rifle);
      for (let i = 0; i < 12; i++) {
        match.updateShields(DT);
        match.updateProjectiles(DT);
      }
    }
  };
  shoot(9); // 24 × 9 = 216 < 220
  assert.equal(me.hp, 100, '방패 뒤에서는 맞지 않음');
  assert.equal(match.shields.length, 1);
  shoot(1); // 240 ≥ 220
  assert.equal(match.shields.length, 0, '내구도 220을 넘으면 부서짐');
  assert.equal(me.hp, 100, '부서지는 탄까지는 방패가 막음');
  shoot(1);
  assert.equal(me.hp, 76, '방패가 없어지면 맞음');
});

test('탄성 그물: 적을 붙잡았다가 바깥쪽으로 튕겨냄', () => {
  const { match, me, enemy } = duel(['gravityVeil', 'elasticPad', 'elasticNet', 'gravityCollapse'], 10);
  me.pitch = -0.17; // 적 발밑을 조준
  assert.ok(match.usePatch(me, 2));
  assert.ok(enemy.held, '붙잡힘');
  step(match, 30);
  assert.ok(enemy.held, '1.2초 동안 유지');
  step(match, 50);
  assert.equal(enemy.held, null);
  assert.ok(enemy.pos.y > 0 || Math.hypot(enemy.vel.x, enemy.vel.z) > 0.5, '튕겨 나감');
});

test('무게 감지기: 반경 안의 적만 벽 너머로도 표시', () => {
  const { match, me, enemy } = duel(['gravityVeil', 'elasticPad', 'weightScanner', 'gravityCollapse']);
  const far = match.agents.find((a) => a.team === TEAMS.FORCE && a !== enemy);
  far.alive = true; // 포스팀 진영(멀리)
  assert.ok(match.usePatch(me, 2));
  assert.ok(enemy.revealedUntil > match.time);
  assert.ok(far.revealedUntil < match.time, '28m 밖은 탐지 안 됨');
  match.visT = 0;
  match.updateVisibility(DT);
  assert.ok(match.time - enemy.spottedT < 0.01);
});

test('합력 폭주: 살아 있는 아군 전원 소총 +3, 8초', () => {
  const match = new Match({ seed: 2, playerTeam: TEAMS.DEFUSE, loadouts: new Map([['defuse-0', ['gravityVeil', 'elasticPad', 'frictionZero', 'resultantSurge']]]) });
  match.phase = 'live';
  const me = match.player;
  me.ult = 100;
  assert.ok(match.usePatch(me, 3));
  for (const a of match.agents) assert.equal(a.ampT > 0, a.team === TEAMS.DEFUSE);
  assert.equal(me.ult, 0);
});

test('마찰 폭풍: 구역 안의 적은 느려지고 점프할 수 없음', () => {
  const { match, me, enemy } = duel(['gravityVeil', 'elasticPad', 'frictionZero', 'frictionStorm'], 10);
  me.ult = 100;
  me.pitch = -0.17;
  assert.ok(match.usePatch(me, 3));
  match.updateZones(DT);
  assert.ok(enemy.mired);
  const intent = { ...emptyIntent(enemy), moveZ: 1, jump: true };
  for (let i = 0; i < 60; i++) stepMovement(enemy, intent, match.map, DT, true);
  assert.ok(Math.hypot(enemy.vel.x, enemy.vel.z) < PLAYER.runSpeed * 0.35);
  assert.equal(enemy.pos.y, 0, '점프 불가');
});

test('칼: 정면 50, 등 뒤에서 찌르면 1.5배', () => {
  const { match, me, enemy } = duel(undefined, 1.5);
  match.melee(me, false);
  assert.equal(enemy.hp, 50);
  enemy.hp = 100;
  enemy.yaw = -Math.PI / 2; // 나와 같은 방향(등을 보임)
  me.meleeCd = 0;
  match.melee(me, false);
  assert.equal(enemy.hp, 25);
});

test('앉기: 서 있을 때 머리 높이로 날아온 탄이 앉은 요원 위로 지나감', () => {
  const { match, me, enemy } = duel();
  me.crouch = 1;
  enemy.pitch = 0;
  const w = { ...WEAPONS.rifle, spreadBase: 0, spreadMove: 0, spreadAir: 0 };
  match.fire(enemy, w, enemy.weapons.rifle);
  for (let i = 0; i < 20; i++) match.updateProjectiles(DT);
  assert.equal(me.hp, 100);
  assert.ok(eyePos(me).y < 1.2);
});

test('기울이기: 벽에 붙어 있으면 벽을 뚫고 기울지 않음', () => {
  const { match, me } = duel();
  // 서쪽 외벽에 오른쪽 어깨를 붙임 (북쪽을 보면 오른쪽이 동쪽 → 왼쪽 기울이기 시 서쪽 벽)
  me.pos = { x: match.map.originX + 4 + 0.4, y: 0, z: me.pos.z };
  me.yaw = 0;
  const intent = { ...emptyIntent(me), lean: -1 };
  for (let i = 0; i < 40; i++) stepMovement(me, intent, match.map, DT, true);
  assert.ok(me.lean < -0.9);
  assert.ok(Math.abs(me.leanOffset) < 0.3, `offset ${me.leanOffset}`);
  assert.ok(eyePos(me).x > match.map.originX + 4, '눈이 벽 밖으로 나가지 않음');
  const free = { ...emptyIntent(me), lean: 1 };
  for (let i = 0; i < 80; i++) stepMovement(me, free, match.map, DT, true);
  assert.ok(Math.abs(me.leanOffset - PLAYER.leanOffset) < 1e-6, '반대쪽은 끝까지 기울어짐');
});

test('정조준: 퍼짐이 줄어들고 반동 패턴이 쌓였다가 회복됨', () => {
  const { match, me } = duel();
  const spreadOf = (ads) => {
    me.adsT = ads ? 1 : 0;
    let sum = 0;
    for (let i = 0; i < 400; i++) {
      me.recoil = me.recoilYaw = me.bloom = 0;
      me.sinceShot = 1;
      me.vel = { x: 4, y: 0, z: 0 };
      me.weapons.rifle.mag = 25;
      match.fire(me, WEAPONS.rifle, me.weapons.rifle);
      const p = match.projectiles.pop();
      const d = p.vel;
      sum += Math.acos(Math.min(1, -d.x / Math.hypot(d.x, d.y, d.z) * Math.sign(-1)));
    }
    return sum / 400;
  };
  const hip = spreadOf(false), ads = spreadOf(true);
  assert.ok(ads < hip * 0.6, `ads ${ads} hip ${hip}`);

  me.adsT = 0;
  me.recoil = me.recoilYaw = 0;
  me.sinceShot = 1;
  me.vel = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 10; i++) {
    me.weapons.rifle.mag = 25;
    match.fire(me, WEAPONS.rifle, me.weapons.rifle);
  }
  assert.equal(me.sprayIndex, 10);
  assert.ok(me.recoil > 0.1, '수직 반동 누적');
  assert.ok(me.recoilYaw !== 0, '좌우 반동');
  const intent = emptyIntent(me);
  for (let i = 0; i < 60; i++) match.stepWeapon(me, intent, DT, true);
  assert.ok(me.recoil < 0.1, '쏘지 않으면 회복');
});
