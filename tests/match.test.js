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

test('합력 강화장치: 소총 11 → 13, 경량 보호막 상대 몸통 12발 → 10발', () => {
  const match = new Match({ seed: 3, playerTeam: TEAMS.DEFUSE, loadouts: new Map([['defuse-0', ['resultantAmp', 'elasticPad', 'frictionZero', 'gravityCollapse']]]) });
  match.phase = 'live';
  const p = match.player;
  const victim = match.agents.find((a) => a.team === TEAMS.FORCE);
  victim.armor = victim.armorMax = ARMOR.light.value;
  for (let i = 0; i < 11; i++) match.applyDamage(victim, WEAPONS.rifle.damage, p);
  assert.ok(victim.alive, '평소에는 11발로 쓰러지지 않음 (121 < 125)');
  assert.equal(victim.armor, 0, '보호막이 먼저 깎임');
  match.applyDamage(victim, WEAPONS.rifle.damage, p);
  assert.ok(!victim.alive, '12발째에 쓰러짐');
  victim.alive = true;
  victim.hp = 100;
  victim.armor = ARMOR.light.value;
  assert.ok(match.usePatch(p, 0));
  assert.equal(p.ampT, 5);
  const amped = WEAPONS.rifle.damage + WEAPONS.rifle.ampBonus;
  assert.equal(amped, 13);
  for (let i = 0; i < 9; i++) match.applyDamage(victim, amped, p);
  assert.ok(victim.alive, '9발(117)은 버팀');
  match.applyDamage(victim, amped, p);
  assert.ok(!victim.alive, '10발째에 쓰러짐');
});

test('오래 싸우는 교전: 기준 총(소총·기관단총·권총) 몸통 10발·머리 7발, 다른 총은 비율 유지 (보호막 없을 때)', () => {
  // 피해는 한 발마다 반올림해서 들어감 (applyDamage)
  const hits = (id, head = false, ehp = 100) => {
    const w = WEAPONS[id];
    const per = Math.round(w.damage * (head ? w.headMult : 1)) * (w.pellets ?? 1);
    return Math.ceil(ehp / per);
  };
  for (const id of ['rifle', 'smg', 'pistol']) {
    assert.equal(hits(id), 10, `${id} 몸통 10발`);
    assert.equal(hits(id, true), 7, `${id} 머리 7발`);
  }
  assert.equal(hits('sheriff'), 4, '리볼버 몸통 4발');
  assert.equal(hits('sheriff', true), 3, '리볼버 머리 3발');
  assert.equal(hits('sniper'), 3, '저격총 몸통 3발');
  assert.equal(hits('sniper', true), 2, '저격총 머리 2발');
  assert.equal(hits('shotgun'), 3, '산탄총: 가까이서 몸통에 다 맞으면 3번');
  // 보호막: 경량 +2~3발, 중량 +5발
  assert.equal(hits('rifle', false, 100 + ARMOR.light.value), 12);
  assert.equal(hits('rifle', false, 100 + ARMOR.heavy.value), 14);
  assert.equal(hits('pistol', false, 100 + ARMOR.heavy.value), 15);
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

test('개념 숙달: 해체 문제 개념을 숙달하면 계산 결과가 보이고 더 빨리 돌아감', () => {
  const lockConcepts = ['resultantOpposite', 'equilibrium', 'springScale', 'buoyancySize', 'moonWeight'];
  const turnFrames = (mastery) => {
    const match = new Match({ seed: 9, playerTeam: TEAMS.DEFUSE, playerMastery: mastery });
    match.phase = 'live';
    const me = match.player;
    const bomb = match.bombs[0];
    me.pos = { x: bomb.x + 1, y: bomb.y ?? 0, z: bomb.z };
    assert.ok(match.tryStartLockpick(me));
    const p = me.lockpick.puzzle;
    if (mastery.length) assert.ok(p.mastered && !p.hidden, '숙달하면 요구 힘을 바로 보여 줌');
    else assert.ok(!p.mastered);
    for (const k of p.solution) me.lockpick.selected[k] = true;
    let n = 0;
    while (me.lockpick && n < 200) {
      match.stepLockpick(me, emptyIntent(me), DT);
      n++;
    }
    assert.equal(bomb.state, 'defused');
    return n;
  };
  const plain = turnFrames([]), master = turnFrames(lockConcepts);
  assert.ok(master < plain * 0.7, `${plain} → ${master}프레임`);
});

test('폭탄은 2분 뒤 터지고 포스팀 승리', () => {
  const match = new Match({ seed: 11 });
  match.phase = 'live';
  for (let i = 0; i < 60 * 121 && match.phase !== 'ended'; i++) match.tick(DT);
  assert.equal(match.winner, TEAMS.FORCE);
  assert.ok(match.bombs.every((b) => b.state === 'exploded'));
});
