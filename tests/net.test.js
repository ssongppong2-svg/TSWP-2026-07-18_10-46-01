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

test('온라인 동기화: 맵 장치(지레 셔터·승강기) 상태가 참가자 화면에 전달되고 길이 막힘', () => {
  const { host, client } = setup({ mapId: 'science-hall' });
  const hs = new HostSync(host);
  client.localAgent = client.agentById('defuse-1');
  const cs = new ClientSync(client, 'defuse-1');
  host.phase = 'live';
  const gate = host.devices.list.find((d) => d.type === 'gate');
  const lever = gate.levers[0];
  const pusher = host.agentById('defuse-0');
  host.setController(pusher.id, { getIntent: (m, a) => emptyIntent(a) });
  pusher.pos.x = pusher.prev.x = host.map.cellX(lever.c);
  pusher.pos.z = pusher.prev.z = host.map.cellZ(lever.r);
  pusher.pos.y = pusher.prev.y = 0;
  assert.ok(host.devices.tryUse(pusher), '지렛대 사용');
  for (let k = 0; k < 60 * 6; k++) host.tick(DT);
  cs.apply(JSON.parse(JSON.stringify(hs.snapshot())), host.time);
  const cg = client.devices.list.find((d) => d.type === 'gate');
  const [r, c] = cg.cells[0];
  assert.ok(cg.st.closed && client.map.dynBlocked(c, r), '참가자 맵에서도 셔터가 닫혀 막힘');
  const hl = host.devices.list.find((d) => d.type === 'lift');
  const cl = client.devices.list.find((d) => d.type === 'lift');
  assert.ok(Math.abs(hl.st.y - cl.st.y) < 0.02, '승강기 높이 같음');
});

test('온라인 동기화: 참가자가 4로 투척물을 들고 던지면 방장이 처리하고, 날아가는 투척물·남은 개수가 참가자에게 전달', () => {
  const { host, client } = setup({ seed: 37 });
  const hs = new HostSync(host);
  const me = client.agentById('defuse-1');
  client.localAgent = me;
  const cs = new ClientSync(client, 'defuse-1');
  host.agentById('defuse-1').gear.smoke = 1;
  host.agentById('defuse-1').gear.stun = 1;
  let t = 0;
  // 교전 시작 1초 뒤 4를 누르고, 0.5초 뒤 왼쪽 클릭
  const scripted = {
    getIntent: (m, a) => ({ ...emptyIntent(a), equip: Math.abs(t - (PRE + 1)) < DT / 2 ? 'throw' : null, fire: t > PRE + 1.5 && t < PRE + 1.6, yaw: a.yaw, pitch: 0.3 }),
  };
  const rec = new InputRecorder(scripted);
  client.setController(me.id, rec);
  const inbox = [];
  host.setController('defuse-1', new RemoteController(() => inbox[0]?.v, (s) => (hs.acks['defuse-1'] = s)));
  host.setController('defuse-0', { getIntent: (m, a) => emptyIntent(a) });
  const toClient = [];
  let sawThrowable = false, sawEquip = false, thrown = 0;
  client.events.on('throw', () => thrown++);
  const LAT = 6;
  for (let k = 0; k < 60 * (PRE + 3); k++) {
    t = k * DT;
    client.tick(DT);
    inbox.push({ v: rec.latest, at: k + LAT });
    while (inbox.length > 1 && inbox[1].at <= k) inbox.shift();
    host.tick(DT);
    if (k % 3 === 0) toClient.push({ snap: JSON.parse(JSON.stringify(hs.snapshot())), at: k + LAT });
    while (toClient.length && toClient[0].at <= k) cs.apply(toClient.shift().snap, t);
    if (client.throwables.length) sawThrowable = true;
    if (me.equip?.kind === 'throw') sawEquip = true;
  }
  const hm = host.agentById('defuse-1');
  assert.equal(hm.gear.smoke + hm.gear.stun, 1, '방장 경기에서 하나를 던짐');
  assert.ok(sawEquip, '참가자 화면에서도 손에 든 장비가 보임');
  assert.ok(sawThrowable, '날아가는 투척물이 참가자 화면에 보임');
  assert.equal(me.gear.smoke + me.gear.stun, 1, '남은 개수 전달');
  assert.ok(thrown >= 1, '던짐 사건 전달');
});

test('온라인 동기화: 참가자가 드론을 띄워 조종하면 방장 경기에서 날고, 참가자 화면에서도 미리 날며 F로 복귀', () => {
  const { host, client } = setup({ seed: 41 });
  const hs = new HostSync(host);
  const me = client.agentById('defuse-1');
  client.localAgent = me;
  const cs = new ClientSync(client, 'defuse-1');
  host.agentById('defuse-1').gear.drone = 1;
  let t = 0;
  const T0 = PRE + 1;
  const scripted = {
    getIntent: (m, a) => ({
      ...emptyIntent(a),
      equip: Math.abs(t - T0) < DT / 2 ? 'gadget' : null,
      fire: t > T0 + 0.5 && t < T0 + 0.6,
      moveZ: t > T0 + 0.8 && t < T0 + 2.5 ? 1 : 0,
      interact: Math.abs(t - (T0 + 3)) < DT / 2,
      yaw: a.yaw,
      pitch: 0,
    }),
  };
  const rec = new InputRecorder(scripted);
  client.setController(me.id, rec);
  const inbox = [];
  host.setController('defuse-1', new RemoteController(() => inbox[0]?.v, (s) => (hs.acks['defuse-1'] = s)));
  host.setController('defuse-0', { getIntent: (m, a) => emptyIntent(a) });
  const toClient = [];
  let flew = 0, sawClient = false, hostStart = null;
  const LAT = 6;
  for (let k = 0; k < 60 * (T0 + 4); k++) {
    t = k * DT;
    client.tick(DT);
    inbox.push({ v: rec.latest, at: k + LAT });
    while (inbox.length > 1 && inbox[1].at <= k) inbox.shift();
    host.tick(DT);
    const hd = host.drones[0];
    if (hd) {
      hostStart ??= { ...hd.pos };
      flew = Math.max(flew, Math.hypot(hd.pos.x - hostStart.x, hd.pos.z - hostStart.z));
    }
    if (k % 3 === 0) toClient.push({ snap: JSON.parse(JSON.stringify(hs.snapshot())), at: k + LAT });
    while (toClient.length && toClient[0].at <= k) cs.apply(toClient.shift().snap, t);
    if (me.drone && client.drones.length) sawClient = true;
  }
  assert.ok(flew > 3, `방장 경기에서 드론이 날아감 (${flew.toFixed(1)} m)`);
  assert.ok(sawClient, '참가자 화면에서 내 드론 조종 중');
  assert.equal(host.agentById('defuse-1').drone, null, 'F로 복귀');
  assert.equal(host.drones.length, 0);
});

test('온라인 동기화: 새 장비 — 참가자 RC카·카메라 보기, 경보 센서·카메라·EMP 상태가 참가자 화면에 전달', () => {
  const { host, client } = setup({ seed: 43 });
  const hs = new HostSync(host);
  const me = client.agentById('defuse-1');
  client.localAgent = me;
  const cs = new ClientSync(client, 'defuse-1');
  const hme = host.agentById('defuse-1');
  hme.gear.rc = 1;
  hme.rcBat = 60;
  let t = 0;
  const T0 = PRE + 1;
  const scripted = {
    getIntent: (m, a) => ({
      ...emptyIntent(a),
      equip: Math.abs(t - T0) < DT / 2 ? 'gadget' : null,
      fire: t > T0 + 0.5 && t < T0 + 0.6,
      moveZ: t > T0 + 0.8 && t < T0 + 2 ? 1 : 0,
      yaw: a.yaw,
      pitch: 0,
    }),
  };
  const rec = new InputRecorder(scripted);
  client.setController(me.id, rec);
  const inbox = [];
  host.setController('defuse-1', new RemoteController(() => inbox[0]?.v, (s) => (hs.acks['defuse-1'] = s)));
  host.setController('defuse-0', { getIntent: (m, a) => emptyIntent(a) });
  const toClient = [];
  let sawRc = false, sawEquip = false;
  const LAT = 6;
  const sync = (k) => {
    if (k % 3 === 0) toClient.push({ snap: JSON.parse(JSON.stringify(hs.snapshot())), at: k + LAT });
    while (toClient.length && toClient[0].at <= k) cs.apply(toClient.shift().snap, t);
  };
  for (let k = 0; k < 60 * (T0 + 2.5); k++) {
    t = k * DT;
    client.tick(DT);
    inbox.push({ v: rec.latest, at: k + LAT });
    while (inbox.length > 1 && inbox[1].at <= k) inbox.shift();
    host.tick(DT);
    sync(k);
    if (me.equip?.kind === 'rc') sawEquip = true;
    if (client.drones.some((d) => d.kind === 'rc' && d.ownerId === me.id)) sawRc = true;
  }
  assert.ok(sawEquip, '손에 든 RC카가 참가자 화면에');
  assert.ok(sawRc, '달리는 RC카가 참가자 화면에 (종류 그대로)');
  // 방장 경기에 경보 센서·카메라를 놓고 EMP를 맞힘 → 참가자 화면에 같은 상태
  const enemy = host.agents.find((a) => a.team === TEAMS.FORCE);
  host.gadgets.alarms.push({ id: 7001, kind: 'alarm', ownerId: enemy.id, team: enemy.team, x: 1, y: 0.5, z: 2, nx: 1, nz: 0, ex: 5, ey: 0.5, ez: 2, len: 4, offUntil: host.time + 5, cdUntil: 0, trippedT: host.time - 1 });
  host.gadgets.cams.push({ id: 7002, kind: 'cam', ownerId: hme.id, team: hme.team, x: 3, y: 1.2, z: 4, nx: 0, ny: 0, nz: 1, yaw0: 0, offUntil: -99 });
  hme.empT = 4;
  const k0 = Math.round(t / DT) + 1;
  for (let k = k0; k < k0 + 30; k++) {
    t = k * DT;
    client.tick(DT);
    host.tick(DT);
    sync(k);
  }
  const al = client.gadgets.alarms.find((x) => x.id === 7001);
  assert.ok(al && al.team === enemy.team && Math.abs(al.ex - 5) < 0.01, '경보 센서 위치·줄 끝');
  assert.ok(al.offUntil > client.time, 'EMP로 꺼진 상태');
  const cam = client.gadgets.cams.find((x) => x.id === 7002);
  assert.ok(cam && cam.team === hme.team && cam.nz === 1, '카메라');
  assert.ok(me.empT > 2, '내 장비가 EMP로 먹통인 시간');
});

test('온라인 동기화: 사건이 한꺼번에 몰려 스냅숏이 넘쳐도 맞음 사건은 모두 전달 (발소리·탄 자국부터 덜어냄)', () => {
  const { host, client } = setup({ seed: 47 });
  const hs = new HostSync(host);
  const cs = new ClientSync(client, 'defuse-1');
  client.localAgent = client.agentById('defuse-1');
  host.tick(DT);
  hs.snapshot();
  // 한 틱에 산탄 여러 알 + 발소리·탄 자국이 잔뜩
  const shooter = host.agentById('defuse-0'), target = host.agents.find((a) => a.team === TEAMS.FORCE);
  for (let i = 0; i < 12; i++) host.emit('hit', { target, attacker: shooter, amount: 6 + i, headshot: i === 3, killed: false, weapon: 'shotgun', pos: { x: 1, y: 1.2, z: 3 }, backstab: false, armor: i % 2 === 0, blocked: false, armorBroke: false });
  host.emit('hit', { target, attacker: null, amount: 30, weapon: 'frag', pos: null });
  // 맞음 사건 뒤에 나온 것들 (예전엔 오래된 것부터 덜어내서 맞음 사건이 먼저 잘림)
  for (let i = 0; i < 60; i++) host.emit('footstep', { agent: host.agents[i % host.agents.length], loud: true });
  for (let i = 0; i < 40; i++) host.emit('impact', { x: i, y: 1, z: 2, nx: 0, ny: 1, nz: 0, kind: 'surface' });
  const snap = hs.snapshot();
  assert.ok(Buffer.byteLength(JSON.stringify(snap)) <= hs.maxBytes + 64, '크기 제한 지킴');
  const got = [];
  client.events.on('hit', (e) => got.push(e));
  cs.apply(JSON.parse(JSON.stringify(snap)), host.time);
  assert.equal(got.length, 13, '맞음 사건 13개 모두 도착');
  assert.equal(got[3].headshot, true);
  assert.equal(got[0].armor, true);
  assert.equal(got[0].weapon, 'shotgun');
  assert.equal(got[0].attacker?.id, 'defuse-0');
  assert.equal(got[0].target?.id, target.id);
  assert.deepEqual(got[0].pos, { x: 1, y: 1.2, z: 3 });
  assert.equal(got[12].weapon, 'frag', '총이 아닌 무기는 이름 그대로');
  assert.equal(got[12].attacker, null);
  assert.equal(got[12].amount, 30);
});
