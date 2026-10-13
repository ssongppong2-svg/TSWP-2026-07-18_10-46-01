import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { TEAMS } from '../src/sim/constants.js';
import { DeathLog, deathTips } from '../src/sim/death-report.js';

const setup = () => {
  const m = new Match({ seed: 5, playerTeam: TEAMS.DEFUSE });
  m.phase = 'live';
  const me = m.player;
  const foe = m.agents.find((a) => a.team === TEAMS.FORCE);
  const foe2 = m.agents.filter((a) => a.team === TEAMS.FORCE)[1];
  const s = m.map.spawns.defuse[0];
  Object.assign(me.pos, { x: s.x, y: 0, z: s.z });
  me.yaw = 0; // 앞(−z)을 봄
  Object.assign(foe.pos, { x: s.x, y: 0, z: s.z + 12 }); // 등 뒤 12 m
  Object.assign(foe2.pos, { x: s.x + 8, y: 0, z: s.z }); // 옆 8 m
  return { m, me, foe, foe2 };
};

test('죽음 분석표: 받은 피해(공격자별·머리)·내가 준 피해·명중률·거리·상대 남은 체력·뒤에서 맞음', () => {
  const { m, me, foe, foe2 } = setup();
  const log = new DeathLog(m, me.id);
  let kill = null;
  m.events.on('kill', (e) => e.victim === me && (kill = e));
  // 내가 먼저 두 번 맞힘 (총알 10발 중)
  for (let i = 0; i < 10; i++) m.emit('shot', { agent: me, weapon: 'rifle' });
  m.applyDamage(foe, 25, me, { weapon: 'rifle', pos: foe.pos });
  m.applyDamage(foe, 25, me, { weapon: 'rifle', pos: foe.pos, headshot: true });
  // 옆에서 한 발, 뒤에서 세 발 (마지막은 머리)
  m.time += 0.2;
  m.applyDamage(me, 20, foe2, { weapon: 'smg', pos: me.pos });
  m.time += 0.3;
  m.applyDamage(me, 30, foe, { weapon: 'rifle', pos: me.pos });
  m.time += 0.2;
  m.applyDamage(me, 30, foe, { weapon: 'rifle', pos: me.pos });
  m.time += 0.2;
  m.applyDamage(me, 60, foe, { weapon: 'rifle', pos: me.pos, headshot: true });
  assert.ok(kill, '쓰러짐');
  const r = log.report(kill);
  assert.equal(r.killer.id, foe.id);
  assert.equal(r.weapon, 'rifle');
  assert.equal(r.headshot, true);
  assert.equal(r.taken.hits, 4);
  assert.equal(r.taken.headshots, 1);
  assert.equal(r.attackers[0].id, foe.id, '가장 많이 준 공격자가 먼저');
  assert.equal(r.attackers[0].hits, 3);
  assert.equal(r.attackers[1].id, foe2.id);
  assert.equal(r.dealt.killer, 50);
  assert.equal(r.dealt.hits, 2);
  assert.equal(r.dealt.shots, 10);
  assert.ok(Math.abs(r.distance - 12) < 1.5, `거리 ${r.distance}`);
  assert.ok(Math.abs(r.ttk - 0.7) < 0.01, `교전 ${r.ttk}`);
  assert.equal(r.killer.hp, 50);
  assert.equal(r.state.behind, true, '뒤에서 맞음');
  assert.equal(r.tips[0][0], '뒤에서 당함');
  assert.ok(r.tips.length >= 1 && r.tips.length <= 3);
});

test('죽음 분석표: 새 라운드면 기록을 비움 · 조언 규칙(먼 거리 기관단총·방탄 없음·명중률)', () => {
  const { m, me, foe } = setup();
  const log = new DeathLog(m, me.id);
  m.applyDamage(me, 10, foe, { weapon: 'rifle', pos: me.pos });
  assert.equal(log.taken.length, 1);
  m.emit('roundPrep', { round: 2 });
  assert.equal(log.taken.length, 0);
  const tips = deathTips({ state: { moving: false }, ttk: 2, taken: { hits: 4, headshots: 0 }, headshot: false, distance: 32, myWeapon: 'smg', armorKind: null, dealt: { shots: 20, hits: 1 }, killer: { hp: 100 } }).map((t) => t[0]);
  assert.deepEqual(tips, ['먼 거리에서 짐', '방탄 없음', '명중률이 낮음']);
});
