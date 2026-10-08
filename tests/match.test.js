import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { Match, makeRoster } from '../src/sim/match.js';
import { TeamDraft } from '../src/sim/draft.js';
import { attachBots } from '../src/ai/bot.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { emptyIntent } from '../src/sim/agent.js';
import { ARMOR, PATCHES, WEAPONS } from '../src/sim/data.js';

function draftAll(seed, playerTeam = null) {
  const rng = createRng(seed);
  const roster = makeRoster(playerTeam);
  const loadouts = new Map();
  for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) {
    const d = new TeamDraft(roster.filter((m) => m.team === team).map((m) => m.id));
    d.autoFill(rng);
    for (const [k, v] of d.loadouts()) loadouts.set(k, v);
  }
  return loadouts;
}

function runMatch(seed, difficulty = 'normal') {
  const match = new Match({ seed, loadouts: draftAll(seed) });
  attachBots(match, difficulty);
  const counts = {};
  match.events.on('*', (type) => (counts[type] = (counts[type] || 0) + 1));
  let guard = 0;
  while (match.phase !== 'ended' && guard++ < 60 * 200) match.tick(DT);
  return { match, counts };
}

test('봇끼리 5:5 경기가 끝까지 진행되고 규칙대로 끝남', () => {
  const results = { defuse: 0, force: 0 };
  const reasons = {};
  let patchUses = 0, kills = 0, defuses = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { match, counts } = runMatch(seed);
    assert.equal(match.phase, 'ended', `seed ${seed} 경기가 끝나지 않음`);
    results[match.winner]++;
    reasons[match.reason] = (reasons[match.reason] || 0) + 1;
    patchUses += counts.patch || 0;
    kills += counts.kill || 0;
    defuses += counts.bombDefused || 0;
    if (match.winner === TEAMS.DEFUSE) assert.ok(match.bombs.every((b) => b.state === 'defused'));
    else assert.ok(match.alive(TEAMS.DEFUSE).length === 0 || match.timeLeft <= 0);
    for (const a of match.agents) {
      assert.ok(Number.isFinite(a.pos.x) && Number.isFinite(a.pos.y) && Number.isFinite(a.pos.z));
      assert.ok(a.pos.y >= 0 && a.pos.y < 6, `${a.name} y=${a.pos.y}`);
    }
  }
  console.log('승리:', results, '사유:', reasons, '패치 사용:', patchUses, '처치:', kills, '해체:', defuses);
  assert.ok(kills > 0, '교전이 일어나야 함');
  assert.ok(patchUses > 0, '봇이 포스 패치를 써야 함');
});

test('합력 강화장치: 소총 40 → 46, 경량 방탄 상대 몸통 4발 → 3발', () => {
  const match = new Match({ seed: 3, playerTeam: TEAMS.DEFUSE, loadouts: new Map([['defuse-0', ['resultantAmp', 'elasticPad', 'frictionZero', 'gravityCollapse']]]) });
  match.phase = 'live';
  const p = match.player;
  const victim = match.agents.find((a) => a.team === TEAMS.FORCE);
  victim.armor = victim.armorMax = ARMOR.light.value;
  for (let i = 0; i < 3; i++) match.applyDamage(victim, WEAPONS.rifle.damage, p);
  assert.ok(victim.alive, '평소에는 3발로 쓰러지지 않음 (120 < 125)');
  assert.equal(victim.armor, 0, '방탄이 먼저 깎임');
  victim.hp = 100;
  victim.armor = ARMOR.light.value;
  assert.ok(match.usePatch(p, 0));
  assert.equal(p.ampT, 5);
  const amped = WEAPONS.rifle.damage + WEAPONS.rifle.ampBonus;
  assert.equal(amped, 46);
  for (let i = 0; i < 2; i++) match.applyDamage(victim, amped, p);
  assert.ok(victim.alive);
  match.applyDamage(victim, amped, p);
  assert.ok(!victim.alive);
});

test('한 발의 위력: 소총 머리 1발 · 몸통 3발(중량 방탄 4발), 권총 머리 78, 저격총 몸통 1발', () => {
  const r = WEAPONS.rifle;
  assert.ok(r.damage * r.headMult >= 100 + ARMOR.heavy.value, '소총 머리 1발 (방탄 포함)');
  assert.ok(r.damage * 2 < 100 && r.damage * 3 >= 100, '방탄 없으면 몸통 3발');
  assert.ok(r.damage * 3 < 150 && r.damage * 4 >= 150, '중량 방탄이면 몸통 4발');
  assert.equal(Math.round(WEAPONS.pistol.damage * WEAPONS.pistol.headMult), 78);
  assert.ok(WEAPONS.sniper.damage >= 100 + ARMOR.heavy.value, '저격총 몸통 1발');
  assert.ok(WEAPONS.sheriff.damage * WEAPONS.sheriff.headMult >= 150, '리볼버 머리 1발');
  for (const id of ['pistol', 'sheriff', 'smg', 'shotgun', 'rifle', 'sniper']) assert.ok(WEAPONS[id].price >= 0 && WEAPONS[id].slot, id);
});

test('중력 강화장막: 날아오던 투사체가 서서히 멈추고 피해를 주지 않음, 끝나면 떨어짐', () => {
  const match = new Match({ seed: 5, playerTeam: TEAMS.DEFUSE, loadouts: new Map([['defuse-0', ['gravityVeil', 'elasticPad', 'frictionZero', 'gravityCollapse']]]) });
  match.phase = 'live';
  const me = match.player;
  const enemy = match.agents.find((a) => a.team === TEAMS.FORCE);
  // 해체팀 시작 홀(열린 공간)에서 적을 내 동쪽 20m에 세우고 나를 향해 쏘게 함
  me.pos.z = enemy.pos.z = match.map.spawns.defuse[0].z;
  enemy.pos = { x: me.pos.x + 20, y: 0, z: me.pos.z };
  enemy.prev = { ...enemy.pos };
  enemy.yaw = Math.PI / 2;
  for (const a of match.agents) if (a !== me && a !== enemy) a.alive = false;
  enemy.pitch = 0;
  enemy.weapons.rifle.mag = 25;
  assert.ok(match.usePatch(me, 0));
  match.fire(enemy, { ...enemyWeapon(), spreadBase: 0 }, enemy.weapons.rifle);
  const proj = match.projectiles[match.projectiles.length - 1];
  const speeds = [];
  for (let i = 0; i < 60; i++) {
    match.updateVeils(DT);
    match.updateProjectiles(DT);
    if (match.projectiles.includes(proj)) speeds.push(Math.hypot(proj.vel.x, proj.vel.y, proj.vel.z));
  }
  assert.equal(me.hp, 100, '장막 안에서는 맞지 않음');
  assert.ok(match.projectiles.includes(proj), '멈춘 투사체가 공중에 남아 있음');
  assert.ok(speeds.at(-1) < 1, '거의 멈춤');
  assert.ok(speeds.some((s) => s > 30 && s < 150), '서서히 감속');
  for (let i = 0; i < 60 * 4; i++) {
    match.updateVeils(DT);
    match.updateProjectiles(DT);
  }
  assert.ok(!match.projectiles.includes(proj), '장막이 끝나면 바닥에 떨어져 사라짐');
  function enemyWeapon() {
    return { id: 'rifle', rpm: 600, damage: 24, speed: 160, spreadBase: 0, spreadMove: 0, spreadAir: 0, bloomPerShot: 0, bloomMax: 0, recoilPitch: [0], recoilYaw: [0], recoilMax: 0, recoilYawMax: 0, adsSpread: 1, adsRecoil: 1, crouchSpread: 1 };
  }
});

test('합력 락픽: 맞으면 처음부터, 정답이면 1초 뒤 해체', () => {
  const match = new Match({ seed: 9, playerTeam: TEAMS.DEFUSE });
  match.phase = 'live';
  const me = match.player;
  const bomb = match.bombs[0];
  me.pos = { x: bomb.x + 1, y: 0, z: bomb.z };
  const intent = emptyIntent(me);
  assert.ok(match.tryStartLockpick(me));
  const first = me.lockpick.puzzle;
  me.lockpick.selected[first.solution[0]] = true;
  match.applyDamage(me, 10, match.agents.find((a) => a.team === TEAMS.FORCE));
  assert.equal(me.lockpick, null, '맞으면 락픽 창이 닫힘');
  assert.equal(bomb.picker, null);
  assert.ok(match.tryStartLockpick(me));
  assert.notEqual(me.lockpick.puzzle, first, '새 문제로 처음부터');
  for (const k of me.lockpick.puzzle.solution) me.lockpick.selected[k] = true;
  for (let i = 0; i < 70 && me.lockpick; i++) match.stepLockpick(me, intent, DT);
  assert.equal(bomb.state, 'defused');
  assert.equal(me.stats.defuses, 1);
});

test('폭탄은 2분 뒤 터지고 포스팀 승리', () => {
  const match = new Match({ seed: 11 });
  match.phase = 'live';
  for (let i = 0; i < 60 * 121 && match.phase !== 'ended'; i++) match.tick(DT);
  assert.equal(match.winner, TEAMS.FORCE);
  assert.ok(match.bombs.every((b) => b.state === 'exploded'));
});
