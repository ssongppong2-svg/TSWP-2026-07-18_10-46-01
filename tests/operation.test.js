import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { emptyIntent, eyePos, giveWeapon } from '../src/sim/agent.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { OP, MISSIONS } from '../src/sim/operation.js';

const still = (m) => m.agents.forEach((a) => m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: ag.pitch }) }));
const drive = (m, a, input) => m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: ag.pitch, ...input() }) });
const step = (m, s) => {
  for (let i = 0; i < Math.round(s / DT); i++) m.tick(DT);
};
function op(seed = 1, difficulty = 'normal') {
  const m = new Match({ seed, rules: 'cqb', mission: 'annex', opDifficulty: difficulty, playerTeam: TEAMS.DEFUSE });
  still(m);
  return m;
}
const goLive = (m) => {
  m.phaseT = 0.01;
  step(m, 0.05);
  assert.equal(m.phase, 'live');
};
function put(a, x, z, yaw = 0) {
  a.pos.x = a.prev.x = x;
  a.pos.z = a.prev.z = z;
  a.pos.y = a.prev.y = 0;
  a.vel.x = a.vel.y = a.vel.z = 0;
  a.yaw = yaw;
}

test('작전 준비: 진압팀 5명은 투입 지점에서 예산으로 보급 · 용의자는 무장해 건물 안 자리에 · 장치·잠긴 문', () => {
  const m = op(1);
  assert.equal(m.map.id, 'lab-annex');
  const swat = m.agents.filter((a) => a.team === TEAMS.DEFUSE), sus = m.agents.filter((a) => a.team === TEAMS.FORCE);
  assert.equal(swat.length, 5);
  assert.equal(sus.length, MISSIONS[0].suspects.normal);
  assert.equal(m.phase, 'buy');
  assert.ok(Math.abs(m.phaseT - OP.prep) < 0.01);
  for (const a of swat) {
    assert.equal(a.credits, OP.budget);
    assert.ok(m.op.inExtract(a.pos), '투입 지점');
  }
  for (const a of sus) {
    assert.ok(!m.op.inExtract(a.pos), '용의자는 건물 안');
    assert.ok(a.weapons.pistol && (a.primary == null || a.weapons[a.primary]));
  }
  assert.equal(m.bombs.length, 1);
  assert.equal(m.bombs[0].state, 'armed');
  assert.equal(m.doorKeyTeam, TEAMS.FORCE);
  assert.ok(m.doors.list.filter((d) => d.st.locked).length >= 3, '잠긴 문');
  assert.ok(m.buy(swat[0], 'rifle'), '준비 단계에 보급 단말기');
  assert.equal(m.op.hostages.length, 3);
  assert.equal(m.op.intel.length, 2);
  const obj = m.op.objectives();
  assert.deepEqual(obj.map((o) => o.id), ['neutralize', 'defuse', 'rescue', 'intel']);
  assert.ok(obj.every((o) => !o.done));
});

test('연구원 구출: F로 결박을 풀면(1.2초) 문을 열며 스스로 투입 지점까지 가서 구출', () => {
  const m = op(2);
  goLive(m);
  // 용의자는 멀리 (방해 없게)
  m.agents.filter((a) => a.team === TEAMS.FORCE).forEach((a) => (a.alive = false));
  const me = m.player;
  const h = m.op.hostages[0];
  put(me, h.x - 0.9, h.z, -Math.PI / 2);
  let done = null;
  m.events.on('opTask', (e) => e.state === 'done' && (done = e));
  drive(m, me, () => ({ interact: true }));
  step(m, DT);
  still(m);
  assert.ok(me.opTask, '결박 푸는 중');
  step(m, OP.freeTime + 0.1);
  assert.equal(done?.kind, 'free');
  assert.equal(h.state, 'free');
  let rescued = false;
  m.events.on('hostageRescued', () => (rescued = true));
  for (let i = 0; i < 60 * 70 && !rescued; i++) m.tick(DT);
  assert.ok(rescued, `호송 완료 (${h.x.toFixed(1)}, ${h.z.toFixed(1)})`);
  assert.equal(h.state, 'rescued');
  assert.ok(m.op.inExtract(h));
});

test('연구 자료: F 1.4초 (움직이면 취소)', () => {
  const m = op(3);
  goLive(m);
  const me = m.player;
  const it = m.op.intel[1];
  put(me, it.x + 0.8, it.z, Math.PI / 2);
  let cancel = null;
  m.events.on('opTask', (e) => e.state === 'cancel' && (cancel = e));
  drive(m, me, () => ({ interact: true }));
  step(m, DT);
  drive(m, me, () => ({ moveZ: 1 }));
  step(m, 0.5);
  assert.ok(cancel, '움직이면 취소');
  assert.equal(it.taken, null);
  put(me, it.x + 0.8, it.z, Math.PI / 2);
  drive(m, me, () => ({ interact: true }));
  step(m, DT);
  still(m);
  step(m, OP.intelTime + 0.1);
  assert.equal(it.taken, me.id);
});

test('연구원 피해: 아군 탄에도 맞고, 숨지면 감점 · 섬광에는 웅크림', () => {
  const m = op(4);
  goLive(m);
  const me = m.player;
  const h = m.op.hostages[0];
  giveWeapon(me, 'rifle');
  me.weapon = 'rifle';
  put(me, h.x - 4, h.z, -Math.PI / 2);
  m.agents.filter((a) => a.team === TEAMS.FORCE).forEach((a) => put(a, -30, -28));
  const eye = eyePos(me);
  const pitch = Math.atan2(0.6 - eye.y, 4);
  let hits = 0;
  m.events.on('hostageHit', () => hits++);
  drive(m, me, () => ({ yaw: -Math.PI / 2, pitch, fire: h.state !== 'dead', crouch: true }));
  step(m, 3);
  assert.ok(hits > 0, '연구원이 맞음');
  assert.equal(h.state, 'dead');
  assert.equal(m.op.stats.hostageKilledBySwat, 1);
  const r = m.op.score(true, '');
  assert.ok(r.penalty >= 15);
});

test('작전 끝: 모든 목표 완료 → 성공·등급 / 진압팀 전멸·장치 폭발 → 실패 · 장치를 해체하면 시간이 멈춤', () => {
  const m = op(5);
  goLive(m);
  for (const a of m.agents.filter((x) => x.team === TEAMS.FORCE)) m.kill(a, m.player);
  for (const it of m.op.intel) it.taken = m.player.id;
  m.bombs[0].state = 'defused';
  step(m, 0.1);
  assert.ok(m.op.devicesDone);
  const t0 = m.timeLeft;
  step(m, 2);
  assert.ok(Math.abs(m.timeLeft - t0) < 1e-6, '시간 멈춤');
  assert.equal(m.phase, 'live', '연구원이 남아 있으면 계속');
  for (const h of m.op.hostages) h.state = 'rescued';
  step(m, 0.1);
  assert.equal(m.phase, 'ended');
  assert.equal(m.winner, TEAMS.DEFUSE);
  assert.equal(m.op.result.success, true);
  assert.equal(m.op.result.grade, 'S');

  const m2 = op(6);
  goLive(m2);
  for (const a of m2.agents.filter((x) => x.team === TEAMS.DEFUSE)) m2.kill(a, null);
  step(m2, 0.1);
  assert.equal(m2.phase, 'ended');
  assert.equal(m2.op.result.success, false);

  const m3 = op(7);
  goLive(m3);
  m3.timeLeft = 0.05;
  let boom = false;
  m3.events.on('explode', () => (boom = true));
  step(m3, 0.2);
  assert.ok(boom);
  assert.equal(m3.op.result.success, false);
  assert.ok(m3.op.result.total <= 60);
});

// ───── 작전 AI ─────
import { attachBots } from '../src/ai/bot.js';
import { makeOpRoster } from '../src/sim/operation.js';

test('작전 AI: 용의자는 자기 자리를 지키고, 진압팀 봇은 지휘 명령이 없으면 대장(사람)을 따라감', () => {
  const m = new Match({ seed: 11, rules: 'cqb', mission: 'annex', playerTeam: TEAMS.DEFUSE });
  attachBots(m, 'normal');
  const me = m.player;
  m.setController(me.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: 0 }) });
  goLive(m);
  // 대장을 주차장 동쪽으로 옮김 → 봇이 따라옴
  put(me, 20, 21, 0);
  step(m, 12);
  const mates = m.agents.filter((a) => a.team === TEAMS.DEFUSE && a !== me && a.alive);
  const near = mates.filter((a) => Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) < 5).length;
  assert.ok(near >= 3, `대장 곁에 ${near}명`);
  const sus = m.agents.filter((a) => a.team === TEAMS.FORCE && a.alive);
  const atPost = sus.filter((a) => Math.hypot(a.pos.x - a.post.x, a.pos.z - a.post.z) < 4 || a.post.patrol).length;
  assert.ok(atPost >= sus.length - 2, `자리를 지키는 용의자 ${atPost}/${sus.length}`);
});

test('작전 AI: 사람 없이 봇 분대만으로도 작전을 끝까지 (수색·구출·자료·해체)', () => {
  const m = new Match({ seed: 1, rules: 'cqb', mission: 'annex', roster: makeOpRoster('봇', 8, { me: false }) });
  attachBots(m, 'normal');
  for (let i = 0; i < 60 * 60 * 9 && m.phase !== 'ended'; i++) m.tick(DT);
  const obj = m.op.objectives();
  assert.equal(m.phase, 'ended', obj.map((o) => `${o.label} ${o.detail}`).join(' · '));
  assert.ok(m.op.result.success, m.op.result.reason);
  assert.ok(m.op.hostages.every((h) => h.state === 'rescued' || h.state === 'dead'));
});
