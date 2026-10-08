import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { attachBots } from '../src/ai/bot.js';
import { BOT_NAMES, DT, PRE_ROUND_TIME as PRE, TEAMS } from '../src/sim/constants.js';
import { emptyIntent } from '../src/sim/agent.js';
import { TeamDraft } from '../src/sim/draft.js';
import { createRng } from '../src/core/rng.js';
import { ClientSync, HostSync, InputRecorder, RemoteController, planMatch, rosterFor } from '../src/net/protocol.js';

// 방장 1명(사람) + 참가자 1명(사람) + 봇 8명: 같은 계획으로 양쪽 경기를 만들고 지연을 두고 주고받음
function setup({ seed = 31, mapId = 'force-bound' } = {}) {
  const players = [
    { key: 'host', name: '방장', team: TEAMS.DEFUSE, load: ['elasticPad', 'resultantAmp', 'frictionZero', 'resultantSurge'] },
    { key: 'p2', name: '참가자', team: TEAMS.DEFUSE, load: ['elasticPad', 'elasticPad', 'weightScanner', 'gravityCollapse'] },
  ];
  const plan = planMatch(players, { botNames: BOT_NAMES, draft: TeamDraft, rng: createRng(seed) });
  const loadouts = new Map(plan.loadouts);
  const host = new Match({ mapId, seed, roster: rosterFor(plan, 'host'), loadouts });
  attachBots(host, 'normal');
  const client = new Match({ mapId, seed, roster: rosterFor(plan, 'p2'), loadouts, client: true });
  return { plan, host, client };
}

test('경기 계획: 사람 자리 · 빈자리 봇 · 팀당 같은 패치 2기 제한', () => {
  const players = [
    { key: 'a', name: 'A', team: 'defuse', load: ['elasticPad', 'resultantAmp', 'weightScanner', 'gravityCollapse'] },
    { key: 'b', name: 'B', team: 'defuse', load: ['elasticPad', 'resultantAmp', 'weightScanner', 'gravityCollapse'] },
    { key: 'c', name: 'C', team: 'defuse', load: ['elasticPad', 'resultantAmp', 'weightScanner', 'gravityCollapse'] },
    { key: 'd', name: 'D', team: 'force', load: [] },
  ];
  const plan = planMatch(players, { botNames: BOT_NAMES, draft: TeamDraft, rng: createRng(1) });
  assert.equal(plan.roster.length, 10);
  assert.deepEqual(plan.roster.filter((r) => r.key).map((r) => r.id), ['defuse-0', 'defuse-1', 'defuse-2', 'force-0']);
  const lo = new Map(plan.loadouts);
  for (const [id, l] of lo) assert.equal(l.filter(Boolean).length, 4, `${id} 4칸`);
  const count = (team, pid) => [...lo].filter(([id, l]) => id.startsWith(team) && l.includes(pid)).length;
  assert.equal(count('defuse', 'elasticPad'), 2, '먼저 고른 두 사람만');
  assert.ok(lo.get('defuse-0').includes('elasticPad') && lo.get('defuse-1').includes('elasticPad'));
  assert.ok(!lo.get('defuse-2').includes('elasticPad'), '세 번째는 다른 패치로');
  const r = rosterFor(plan, 'b');
  assert.equal(r.find((x) => x.isPlayer).id, 'defuse-1');
  assert.equal(r.filter((x) => x.human).length, 3);
});

test('온라인 동기화: 참가자 입력이 방장 경기에 반영되고, 상태·사건이 참가자 화면에 전달됨', () => {
  const { host, client } = setup();
  const hs = new HostSync(host);
  const me = client.agentById('defuse-1');
  client.localAgent = me;
  const cs = new ClientSync(client, 'defuse-1');
  // 참가자: 앞으로 걷다가 쏨
  let t = 0;
  const scripted = { getIntent: (m, a) => ({ ...emptyIntent(a), moveZ: 1, fire: t > PRE + 1 && t < PRE + 1.6, yaw: a.yaw, pitch: 0 }) };
  const rec = new InputRecorder(scripted);
  client.setController(me.id, rec);
  const inbox = [];
  host.setController('defuse-1', new RemoteController(() => inbox[0]?.v, (s) => (hs.acks['defuse-1'] = s)));
  // 방장 자신은 가만히
  host.setController('defuse-0', { getIntent: (m, a) => emptyIntent(a) });
  const toClient = [];
  const events = { shot: 0, footstep: 0, mine: 0 };
  client.events.on('shot', (e) => {
    events.shot++;
    if (e.agent === me) events.mine++;
  });
  client.events.on('footstep', () => events.footstep++);
  let maxBytes = 0;
  const LAT = 6; // 약 100ms
  const start = { ...host.agentById('defuse-1').pos };
  for (let k = 0; k < 60 * 30; k++) {
    t = k * DT;
    client.tick(DT);
    inbox.push({ v: rec.latest, at: k + LAT });
    while (inbox.length > 1 && inbox[1].at <= k) inbox.shift();
    host.tick(DT);
    if (k % 3 === 0) {
      const snap = hs.snapshot({ withStats: k % 60 === 0 });
      maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(snap)));
      toClient.push({ snap: JSON.parse(JSON.stringify(snap)), at: k + LAT });
    }
    while (toClient.length && toClient[0].at <= k) cs.apply(toClient.shift().snap, t);
    cs.smooth(DT, t);
  }
  const hm = host.agentById('defuse-1');
  // 참가자가 앞으로 걸었음 → 방장 경기에서도 움직였음
  assert.ok(Math.hypot(hm.pos.x - start.x, hm.pos.z - start.z) > 3, '방장 경기에서 참가자 요원이 이동함');
  assert.ok(Math.abs(hm.pos.z - me.pos.z) < 1.6, `내 요원 위치가 방장과 비슷함 (${hm.pos.z.toFixed(2)} vs ${me.pos.z.toFixed(2)})`);
  // 방장 경기에서 참가자 요원이 쏨
  assert.ok(hm.weapons.rifle.mag < 30, '방장 쪽에서 참가자 요원의 사격이 처리됨');
  assert.ok(events.mine > 0, '참가자 화면에서 자기 사격을 바로 보여 줌');
  // 봇들의 상태가 참가자 화면에 반영
  for (const a of host.agents) {
    if (a.id === 'defuse-1') continue;
    const c = client.agentById(a.id);
    assert.ok(Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z) < 2.5, `${a.id} 위치 동기화`);
    assert.equal(a.alive, c.alive);
  }
  assert.ok(events.footstep > 0, '다른 요원 발소리 전달');
  assert.equal(client.phase, host.phase);
  assert.ok(Math.abs(client.timeLeft - host.timeLeft) < 0.5);
  assert.ok(maxBytes < 3600, `스냅숏 크기 ${maxBytes}B`);
});

test('온라인 동기화: 봇끼리 한 판 끝까지 — 스냅숏 4KB 이하, 결과·통계가 참가자에게 전달', () => {
  const { host, client } = setup({ seed: 77 });
  const hs = new HostSync(host);
  const me = client.agentById('defuse-1');
  client.localAgent = me;
  const cs = new ClientSync(client, 'defuse-1');
  // 두 사람 모두 봇에게 맡김 (방장 쪽)
  host.agentById('defuse-0').human = false;
  host.agentById('defuse-1').human = false;
  host.agentById('defuse-0').isPlayer = false;
  attachBots(host, 'normal');
  client.setController(me.id, new InputRecorder({ getIntent: (m, a) => emptyIntent(a) }));
  let maxBytes = 0, kills = 0, hits = 0;
  client.events.on('kill', () => kills++);
  client.events.on('hit', () => hits++);
  let k = 0;
  while (host.phase !== 'ended' && k < 60 * 140) {
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
  assert.equal(client.reason, host.reason);
  const hostKills = host.agents.reduce((s, a) => s + a.stats.kills, 0);
  assert.equal(client.agents.reduce((s, a) => s + a.stats.kills, 0), hostKills, '처치 통계');
  assert.equal(kills, hostKills, '처치 사건이 모두 전달');
  assert.ok(hits >= hostKills, '피격 사건 전달');
  assert.ok(maxBytes <= 3600, `스냅숏 크기 ${maxBytes}B`);
});

test('시작 정보 압축: 풀었을 때 명단·패치가 같음', async () => {
  const { packPlan, unpackPlan } = await import('../src/net/protocol.js');
  const { PATCH_ORDER } = await import('../src/sim/data.js');
  const players = [
    { key: 'x1', name: '가', team: 'force', load: ['gravityVeil', 'buoyShield', 'elasticNet', 'frictionStorm'] },
    { key: 'x2', name: '나', team: 'defuse', load: [] },
  ];
  const plan = planMatch(players, { botNames: BOT_NAMES, draft: TeamDraft, rng: createRng(5) });
  const packed = packPlan(plan, PATCH_ORDER);
  assert.ok(Buffer.byteLength(JSON.stringify(packed)) < 400);
  const back = unpackPlan(JSON.parse(JSON.stringify(packed)), PATCH_ORDER, BOT_NAMES);
  assert.deepEqual(back.roster, plan.roster);
  assert.deepEqual(back.loadouts, plan.loadouts);
});
