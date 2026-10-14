import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { attachBots } from '../src/ai/bot.js';
import { BOT_NAMES, DT, TEAMS } from '../src/sim/constants.js';
import { emptyIntent } from '../src/sim/agent.js';
import { PATCH_ORDER } from '../src/sim/data.js';
import { MISSIONS, OP } from '../src/sim/operation.js';
import { ClientSync, HostSync, InputRecorder, RemoteController, packPlan, planOp, rosterFor, unpackPlan } from '../src/net/protocol.js';

// CQB 온라인 협동: 사람 2명(방장·참가자)은 모두 진압팀, 빈자리 봇 3 + 용의자 봇
function setup({ seed = 5, mission = 'annex', difficulty = 'normal' } = {}) {
  const players = [
    { key: 'host', name: '방장' },
    { key: 'p2', name: '참가자' },
  ];
  const m = MISSIONS.find((x) => x.id === mission);
  const plan = unpackPlan(JSON.parse(JSON.stringify(packPlan(planOp(players, { botNames: BOT_NAMES, suspects: m.suspects[difficulty] }), PATCH_ORDER))), PATCH_ORDER, BOT_NAMES);
  const opts = { seed, rules: 'cqb', mission, opDifficulty: difficulty, loadouts: new Map() };
  const host = new Match({ ...opts, roster: rosterFor(plan, 'host') });
  attachBots(host, 'normal');
  const client = new Match({ ...opts, roster: rosterFor(plan, 'p2'), client: true });
  return { plan, host, client };
}

test('CQB 온라인 계획: 사람은 모두 진압팀 · 빈자리 봇 · 용의자 수는 난이도대로 (압축해도 같음)', () => {
  const players = [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }, { key: 'c', name: 'C' }];
  const plan = planOp(players, { botNames: BOT_NAMES, suspects: 9 });
  assert.equal(plan.roster.filter((r) => r.team === 'defuse').length, 5);
  assert.equal(plan.roster.filter((r) => r.team === 'force').length, 9);
  assert.deepEqual(plan.roster.filter((r) => r.key).map((r) => r.id), ['defuse-0', 'defuse-1', 'defuse-2']);
  const back = unpackPlan(JSON.parse(JSON.stringify(packPlan(plan, PATCH_ORDER))), PATCH_ORDER, BOT_NAMES);
  assert.deepEqual(back.roster.map((r) => [r.id, r.name, r.key]), plan.roster.map((r) => [r.id, r.name, r.key]));
  assert.equal(back.roster.find((r) => r.id === 'force-8').name, '용의자 9');
});

test('CQB 온라인 동기화: 참가자가 F로 결박을 풀면 방장이 처리하고, 진행 막대·연구원 상태·발견이 참가자 화면에 전달', () => {
  const { host, client } = setup({ seed: 8 });
  const hs = new HostSync(host, { maxBytes: 3300 });
  const me = client.agentById('defuse-1');
  client.localAgent = me;
  const cs = new ClientSync(client, 'defuse-1');
  let press = false;
  const rec = new InputRecorder({ getIntent: (m, a) => ({ ...emptyIntent(a), yaw: a.yaw, pitch: a.pitch, interact: press }) });
  client.setController(me.id, rec);
  host.setController('defuse-1', new RemoteController(() => rec.latest, (s) => (hs.acks['defuse-1'] = s)));
  host.setController('defuse-0', { getIntent: (m, a) => ({ ...emptyIntent(a), yaw: a.yaw, pitch: a.pitch }) });
  const sync = () => cs.apply(JSON.parse(JSON.stringify(hs.snapshot())), host.time);
  // 바로 작전 개시 · 용의자는 치움
  host.phaseT = 0.01;
  for (const a of host.agents.filter((x) => x.team === TEAMS.FORCE)) a.alive = false;
  for (let k = 0; k < 6; k++) {
    host.tick(DT);
    client.tick(DT);
    sync();
  }
  assert.equal(client.phase, 'live');
  const h = host.op.hostages[0];
  for (const m of [host, client]) {
    const a = m.agentById('defuse-1');
    a.pos.x = a.prev.x = h.x - 0.9;
    a.pos.z = a.prev.z = h.z;
    a.vel.x = a.vel.z = 0;
  }
  let opTaskSeen = false, doneEvent = null, foundEvent = null;
  client.events.on('opTask', (e) => e.state === 'done' && (doneEvent = e));
  client.events.on('opFound', (e) => (foundEvent = e));
  for (let k = 0; k < 60 * 2.2; k++) {
    press = k > 6 && k < 12;
    client.tick(DT);
    host.tick(DT);
    if (k % 3 === 0) sync();
    if (me.opTask?.kind === 'free') opTaskSeen = true;
  }
  sync();
  assert.ok(opTaskSeen, '참가자 화면에 결박 푸는 진행이 보임');
  assert.equal(host.op.hostages[0].state, 'free', '방장 경기에서 풀림');
  assert.equal(client.op.hostages[0].state, 'free', '참가자 화면에도 풀림');
  assert.ok(client.op.hostages[0].found, '발견 표시');
  assert.equal(doneEvent?.item, client.op.hostages[0], '사건의 연구원이 참가자 화면의 같은 연구원');
  assert.equal(doneEvent.agent, me);
  assert.equal(foundEvent?.item, client.op.hostages[0]);
  assert.ok(Math.hypot(client.op.hostages[0].x - host.op.hostages[0].x, client.op.hostages[0].z - host.op.hostages[0].z) < 0.5, '연구원 위치');
});

test('CQB 온라인 동기화: 봇 분대로 끝까지 (과학관·어려움 = 16명) — 스냅숏 크기·결과·등급이 참가자에게 같게', () => {
  const { host, client } = setup({ seed: 3, mission: 'hall', difficulty: 'hard' });
  const hs = new HostSync(host, { maxBytes: 3300 });
  const me = client.agentById('defuse-1');
  client.localAgent = me;
  const cs = new ClientSync(client, 'defuse-1');
  for (const id of ['defuse-0', 'defuse-1']) {
    host.agentById(id).human = false;
    host.agentById(id).isPlayer = false;
  }
  attachBots(host, 'normal');
  client.setController(me.id, new InputRecorder({ getIntent: (m, a) => emptyIntent(a) }));
  let maxBytes = 0, kills = 0;
  client.events.on('kill', () => kills++);
  let k = 0;
  const limit = (MISSIONS.find((x) => x.id === 'hall').time + 180) / DT; // 작전 시간 + 준비 + 여유 (봇이 끝까지 수색해도)
  while (host.phase !== 'ended' && k < limit) {
    client.tick(DT);
    host.tick(DT);
    if (k % 3 === 0) {
      const snap = hs.snapshot({ withStats: k % 60 === 0 });
      maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(snap)));
      cs.apply(JSON.parse(JSON.stringify(snap)), k * DT);
    }
    cs.smooth(DT, k * DT);
    k++;
  }
  for (let j = 0; j < 4; j++) cs.apply(JSON.parse(JSON.stringify(hs.snapshot({ withStats: true }))), k * DT);
  assert.equal(host.phase, 'ended');
  assert.equal(client.phase, 'ended');
  assert.equal(client.winner, host.winner);
  const hr = host.op.result, cr = client.op.result;
  assert.ok(cr, '참가자 화면에서도 작전 결과');
  assert.equal(cr.success, hr.success);
  assert.equal(cr.total, hr.total);
  assert.equal(cr.grade, hr.grade);
  assert.deepEqual(cr.objectives.map((o) => o.detail), hr.objectives.map((o) => o.detail));
  const hostKills = host.agents.reduce((s, a) => s + a.stats.kills, 0);
  assert.equal(kills, hostKills, '처치 사건이 모두 전달');
  assert.ok(maxBytes <= 3600, `스냅숏 크기 ${maxBytes}B`);
});
