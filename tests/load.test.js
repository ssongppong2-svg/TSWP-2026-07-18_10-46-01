import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { carriedMass, emptyIntent, loadFactors, stepMovement } from '../src/sim/agent.js';
import { DT, LOAD, PLAYER, STAMINA, TEAMS } from '../src/sim/constants.js';
import { ARMOR, WEAPONS } from '../src/sim/data.js';

// 제자리에서 계속 달리게 함 (매 틱 위치만 처음으로 되돌려 벽에 막히지 않게)
function run(m, a, seconds, intent = {}) {
  const home = { ...a.pos };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const it = { ...emptyIntent(a), moveZ: 1, ...intent };
    stepMovement(a, it, m.map, DT, true);
    a.pos.x = a.prev.x = home.x;
    a.pos.z = a.prev.z = home.z;
  }
}

test('장비 무게: 질량 × 9.8 = 무게, 기준(8 kg)을 넘으면 느려짐', () => {
  const m = new Match({ seed: 2, playerTeam: TEAMS.DEFUSE });
  const a = m.player;
  // 한 판짜리 규칙: 소총 + 권총 + 칼
  const base = WEAPONS.rifle.mass + WEAPONS.pistol.mass + WEAPONS.knife.mass;
  assert.equal(carriedMass(a), base);
  assert.equal(loadFactors(base).speed, 1, '가벼우면 그대로');
  a.armor = a.armorMax = ARMOR.heavy.dur;
  a.armorKind = 'heavy';
  const heavy = carriedMass(a);
  assert.ok(Math.abs(heavy - (base + ARMOR.heavy.mass)) < 1e-9);
  assert.ok(Math.abs(heavy * LOAD.g - 140.14) < 0.01, `무게 ${heavy * LOAD.g} N`);
  const f = loadFactors(heavy);
  assert.ok(f.speed < 1 && f.speed > 0.9, `속도 ×${f.speed}`);
  assert.ok(f.accel < f.speed, '관성: 출발·멈춤이 더 크게 둔해짐');
  a.armor = 0;
  assert.equal(carriedMass(a), base, '부서진 방탄은 무게 없음');
});

test('관성: 무거운 요원은 같은 시간에 덜 빨라짐', () => {
  const m = new Match({ seed: 2, playerTeam: TEAMS.DEFUSE });
  const [light, heavy] = m.agents.filter((x) => x.team === TEAMS.DEFUSE);
  heavy.armor = heavy.armorMax = ARMOR.heavy.dur;
  heavy.armorKind = 'heavy';
  heavy.weapons.sniper = { mag: 5, reserve: 10 };
  for (const a of [light, heavy]) {
    a.vel.x = a.vel.z = 0;
    run(m, a, 0.15);
  }
  const sp = (a) => Math.hypot(a.vel.x, a.vel.z);
  assert.ok(sp(heavy) < sp(light) * 0.93, `가벼움 ${sp(light).toFixed(2)} · 무거움 ${sp(heavy).toFixed(2)}`);
});

test('지구력: 오래 달리면 지쳐서 느려지고 점프 불가, 걸으면 회복', () => {
  const m = new Match({ seed: 2, playerTeam: TEAMS.DEFUSE });
  const a = m.player;
  run(m, a, 10);
  assert.ok(a.stamina < STAMINA.max - 30 && !a.tired, `10초 뒤 ${a.stamina}`);
  run(m, a, 20);
  assert.ok(a.tired, '지침');
  const tiredSpeed = Math.hypot(a.vel.x, a.vel.z);
  assert.ok(tiredSpeed < PLAYER.runSpeed * STAMINA.tiredSpeed + 0.05, `지친 속도 ${tiredSpeed}`);
  a.onGround = true;
  run(m, a, DT, { jump: true });
  assert.ok(a.vel.y <= 0, '지치면 점프 못 함');
  // 걷거나 멈추면 잠시 뒤 다시 참
  run(m, a, 2, { moveZ: 0 });
  assert.ok(a.tired, '회복 기준(25)까지는 아직 지침');
  run(m, a, 2, { moveZ: 0 });
  assert.ok(!a.tired && a.stamina >= STAMINA.recover);
  // 무거우면 더 빨리 닳음
  const b = m.agents.find((x) => x.team === TEAMS.DEFUSE && x !== a);
  b.stamina = a.stamina = STAMINA.max;
  b.armor = b.armorMax = ARMOR.heavy.dur;
  b.armorKind = 'heavy';
  run(m, a, 5);
  run(m, b, 5);
  assert.ok(b.stamina < a.stamina, `가벼움 ${a.stamina.toFixed(1)} · 무거움 ${b.stamina.toFixed(1)}`);
});
