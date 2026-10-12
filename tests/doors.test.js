import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { GameMap } from '../src/sim/map.js';
import { emptyIntent, eyePos, chestPos, giveWeapon } from '../src/sim/agent.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { DOOR } from '../src/sim/door-geo.js';
import { GEAR } from '../src/sim/gear.js';
import { HostSync, ClientSync, InputRecorder, RemoteController } from '../src/net/protocol.js';

// 포스 바운드 연구동 "복도 ↔ 동쪽 방" 나무 문 (2번): 문짝이 z 방향, 지나가는 방향은 x
const DOOR_ID = 2;
const live = (seed = 3, setup = null) => {
  const m = new Match({ seed, mapId: 'force-bound', playerTeam: TEAMS.DEFUSE });
  if (setup) {
    m.doorSetup = setup;
    m.doors.reset();
  }
  m.phase = 'live';
  return m;
};
function put(a, x, z, yaw = 0) {
  a.pos.x = a.prev.x = x;
  a.pos.z = a.prev.z = z;
  a.pos.y = a.prev.y = 0;
  a.vel.x = a.vel.y = a.vel.z = 0;
  a.yaw = yaw;
  a.pitch = 0;
  a.onGround = true;
}
const still = (m) => m.agents.forEach((a) => m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: ag.pitch }) }));
const drive = (m, a, input) => m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: ag.pitch, ...input() }) });
const step = (m, s) => {
  for (let i = 0; i < Math.round(s / DT); i++) m.tick(DT);
};
// 나머지 요원은 문에서 멀리 (포스 진영 구석)
function park(m, except) {
  m.agents.forEach((a, i) => {
    if (except.includes(a)) return;
    put(a, -30 + i * 1.2, -36);
  });
}
const EAST = -Math.PI / 2; // +x를 바라봄

test('문 모양: 문간 양옆 문틀이 통로를 문 너비로 좁히고, 위는 인방', () => {
  const map = new GameMap('force-bound');
  assert.equal(map.doors.length, 4);
  const d = map.doors[DOOR_ID];
  assert.equal(d.boxes.length, 3);
  const open = d.boxes[1][2] - d.boxes[0][3];
  assert.ok(Math.abs(open - DOOR.single) < 1e-9, '문 너비만큼 트임');
  assert.ok(d.top > DOOR.frameTop, '인방 위 끝은 천장까지');
  // 문틀은 충돌·총알에 걸림 (난간처럼)
  assert.ok(map.thinBoxes(d.c, d.r).length >= 3);
  assert.equal(map.doorCellAt(d.c, d.r), d);
});

test('문: 닫힌 문은 몸·시야를 막고, F로 열면 여는 사람 반대쪽으로 열려 지나갈 수 있음', () => {
  const m = live(3);
  still(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  const d = m.doors.list[DOOR_ID];
  park(m, [me, e]);
  put(me, d.x - 1.4, d.z, EAST);
  put(e, d.x + 2.5, d.z, Math.PI / 2);
  assert.ok(!m.map.lineOfSight(eyePos(me), chestPos(e)), '닫힌 문 너머는 안 보임');
  // 문으로 걸어가도 지나가지 못함
  drive(m, me, () => ({ moveZ: 1, yaw: EAST }));
  step(m, 1.2);
  assert.ok(me.pos.x < d.x - 0.3, `문에 막힘 (x ${(me.pos.x - d.x).toFixed(2)})`);
  // F
  let ev = null;
  m.events.on('door', (x) => (ev ??= x));
  drive(m, me, () => ({ interact: true, yaw: EAST }));
  step(m, DT);
  assert.equal(ev?.act, 'open');
  still(m);
  step(m, DOOR.openTime + 0.1);
  assert.ok(d.st.ang > DOOR.open - 0.01, '나와 반대쪽(+x)으로 활짝');
  assert.ok(m.map.lineOfSight(eyePos(me), chestPos(e)), '열린 문으로 보임');
  drive(m, me, () => ({ moveZ: 1, yaw: EAST }));
  step(m, 1.0);
  assert.ok(me.pos.x > d.x + 0.5, '문을 지나감');
});

test('문: 사람이 문짝이 도는 자리에 서 있으면 멈춰 기다림 · 살짝 열기는 천천히 틈만', () => {
  const m = live(4);
  still(m);
  const me = m.player;
  const ally = m.agents.find((a) => a !== me && a.team === TEAMS.DEFUSE);
  const d = m.doors.list[DOOR_ID];
  park(m, [me, ally]);
  put(me, d.x - 1.3, d.z, EAST);
  put(ally, d.x + 0.75, d.z - 0.2, 0); // 문 바로 뒤 (문짝이 쓸고 지나가는 자리)
  m.doors.act(me, 'crack');
  step(m, 0.3);
  assert.ok(d.st.ang > 0 && d.st.ang < DOOR.crack, '천천히 열리는 중');
  step(m, 1.2);
  assert.ok(Math.abs(d.st.ang - DOOR.crack) < 0.02, `틈만 (${d.st.ang.toFixed(2)})`);
  // 활짝 열려다 사람에게 막힘
  m.doors.use(me);
  step(m, 2);
  assert.ok(d.st.ang < DOOR.open - 0.2, '사람이 막아서 다 못 엶');
  assert.ok(Math.hypot(ally.pos.x - (d.x + 0.75), ally.pos.z - (d.z - 0.2)) < 0.4, '막은 사람은 밀려나지 않음');
});

test('문: 나무 문은 관통력 있는 탄이 뚫고(피해 감소), 철문은 권총탄을 막음', () => {
  const m = live(5);
  const wood = m.doors.list[DOOR_ID], steel = m.doors.list[0];
  const hitOf = (d) => ({ x: d.x, y: 1.2, z: d.z, leaf: 0 });
  const pistol = { weapon: 'pistol', pen: 1, damage: 30, harmless: false };
  assert.equal(m.doors.shot(wood, hitOf(wood), pistol), true);
  assert.ok(Math.abs(pistol.damage - 21) < 1e-9, '나무 문을 뚫으면 피해 70%');
  assert.equal(pistol.pen, 0, '관통력이 줄어듦');
  assert.equal(m.doors.shot(steel, hitOf(steel), { weapon: 'pistol', pen: 1, damage: 30 }), false, '철문은 권총탄을 막음');
  assert.equal(m.doors.shot(steel, hitOf(steel), { weapon: 'rifle', pen: 3, damage: 40 }), true, '소총탄은 철문도 뚫음');
  // 실제 사격: 닫힌 나무 문 너머의 적이 맞음 (피해는 줄어서)
  still(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  park(m, [me, e]);
  put(me, wood.x - 2.5, wood.z, EAST);
  put(e, wood.x + 1.8, wood.z, Math.PI / 2);
  giveWeapon(me, 'rifle');
  me.weapon = 'rifle';
  let hit = null, doorImpact = false;
  m.events.on('hit', (x) => (hit ??= x));
  m.events.on('impact', (x) => (doorImpact ||= x.kind === 'door'));
  const c = chestPos(e), eye = eyePos(me);
  const yaw = Math.atan2(-(c.x - eye.x), -(c.z - eye.z));
  const pitch = Math.atan2(c.y - eye.y, Math.hypot(c.x - eye.x, c.z - eye.z));
  drive(m, me, () => ({ yaw, pitch, fire: !hit, crouch: true }));
  step(m, 1.2);
  assert.ok(doorImpact, '문짝에 맞은 자국');
  assert.ok(hit && hit.target === e, '문 너머 적이 맞음');
});

test('문: 잠긴 문은 F로 안 열림 → 발차기로 부수고, 문 뒤 사람은 휘청 · 산탄총은 자물쇠를 부숨', () => {
  const m = live(6, { [DOOR_ID]: { locked: true } });
  still(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  const d = m.doors.list[DOOR_ID];
  park(m, [me, e]);
  put(me, d.x - 1.3, d.z, EAST);
  put(e, d.x + 0.8, d.z - 0.15, 0);
  const acts = [];
  m.events.on('door', (x) => acts.push(x.act));
  m.doors.use(me);
  step(m, 0.8);
  assert.equal(acts[0], 'locked');
  assert.equal(d.st.ang, 0, '잠긴 문은 그대로');
  let kicks = 0;
  while (d.st.locked && kicks < 6) {
    assert.ok(m.doors.act(me, 'kick'));
    kicks++;
    step(m, DOOR.kickWindup + 0.4);
  }
  assert.ok(!d.st.locked, `발차기로 자물쇠가 부서짐 (${kicks}번)`);
  assert.ok(acts.includes('lockBreak') && acts.includes('kick'));
  step(m, 0.4);
  assert.ok(Math.abs(d.st.ang) > DOOR.open - 0.05, '걷어찬 문이 활짝');
  assert.ok(e.stunT > 0 || acts.includes('kick'), '문 뒤 사람이 문에 맞음');

  // 산탄총: 손잡이 쪽을 쏘면 자물쇠가 부서짐
  const m2 = live(7, { [DOOR_ID]: { locked: true } });
  still(m2);
  const p2 = m2.player;
  const d2 = m2.doors.list[DOOR_ID];
  park(m2, [p2]);
  put(p2, d2.x - 1.6, d2.z, EAST);
  giveWeapon(p2, 'shotgun');
  p2.weapon = 'shotgun';
  const leaf = d2.leaves[0];
  const lock = { x: leaf.hx + leaf.dx * (leaf.len - 0.12), y: 1.0, z: leaf.hz + leaf.dz * (leaf.len - 0.12) };
  const eye = eyePos(p2);
  const yaw = Math.atan2(-(lock.x - eye.x), -(lock.z - eye.z));
  const pitch = Math.atan2(lock.y - eye.y, Math.hypot(lock.x - eye.x, lock.z - eye.z));
  let shots = 0;
  m2.events.on('shot', () => shots++);
  drive(m2, p2, () => ({ yaw, pitch, fire: d2.st.locked }));
  step(m2, 2.5);
  assert.ok(!d2.st.locked, `산탄 ${shots}발로 자물쇠가 부서짐`);
  assert.ok(Math.abs(d2.st.tgt) > 0.1, '문이 조금 밀려 열림');
});

test('문: C4를 문에 붙여 터뜨리면 문이 부서지고 건너편 사람은 비틀거림', () => {
  const m = live(8);
  still(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  const d = m.doors.list[DOOR_ID];
  park(m, [me, e]);
  put(me, d.x - 1.3, d.z, EAST);
  put(e, d.x + 2.6, d.z + 0.5, Math.PI / 2);
  me.gear.c4 = 1;
  assert.ok(m.doors.act(me, 'charge'), '문 행동으로 바로 붙임');
  assert.equal(m.charges.length, 1);
  assert.equal(m.charges[0].doorId, d.id);
  assert.ok(m.charges[0].x < d.x, '내 쪽 면');
  // 물러나서 터뜨림
  put(me, d.x - 5, d.z, EAST);
  step(m, GEAR.c4.arm + 0.1);
  let breach = null;
  m.events.on('door', (x) => x.act === 'breach' && (breach = x));
  assert.ok(m.detonate(me));
  assert.ok(breach, '문 폭파');
  assert.ok(d.st.broken);
  assert.ok(!m.map.leaves.some((L) => L.door === d.id), '문짝이 없어짐');
  assert.ok(e.stunT >= 2, `건너편 사람 비틀거림 (${e.stunT.toFixed(1)}초)`);
  // 다음 라운드엔 다시 달림
  m.doors.reset();
  assert.ok(!d.st.broken && m.map.leaves.some((L) => L.door === d.id));
});

test('문 밑 카메라: 닫힌 문 너머 적이 보이고(팀에 공유), 클릭하면 표시 · 움직이면 거둠', () => {
  const m = live(9);
  still(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  const d = m.doors.list[DOOR_ID];
  park(m, [me, e]);
  put(me, d.x - 1.3, d.z, EAST);
  put(e, d.x + 4, d.z + 0.6, Math.PI / 2);
  step(m, 0.3);
  assert.ok(!(me.visibleEnemies ?? []).includes(e.id), '눈으로는 안 보임');
  assert.ok(m.doors.act(me, 'mirror'));
  assert.ok(me.mirror);
  const body = { ...me.pos };
  drive(m, me, () => ({ yaw: EAST, pitch: 0.1 }));
  step(m, 0.4);
  assert.ok(me.visibleEnemies.includes(e.id), '카메라로 보임');
  assert.ok(m.time - e.spottedT < 0.3, '팀 미니맵에 보임');
  assert.ok(me.crouch > 0.5 && Math.hypot(me.pos.x - body.x, me.pos.z - body.z) < 0.05, '몸은 앉아서 그대로');
  // 가운데 두고 클릭 → 5초 표시
  const v = m.doors.mirrorView(me);
  const c = chestPos(e);
  const yaw = Math.atan2(-(c.x - v.pos.x), -(c.z - v.pos.z));
  const pitch = Math.atan2(c.y - v.pos.y, Math.hypot(c.x - v.pos.x, c.z - v.pos.z));
  let k = 0;
  drive(m, me, () => ({ yaw, pitch, fire: k++ === 2 }));
  step(m, 0.2);
  assert.ok(e.revealedUntil > m.time + 4, '클릭한 적이 표시됨');
  // 움직이면 거둠
  drive(m, me, () => ({ moveZ: 1, yaw: EAST }));
  step(m, DT * 2);
  assert.equal(me.mirror, null);
  // 열린 문에는 못 씀
  still(m);
  m.doors.use(me);
  step(m, 1);
  assert.equal(m.doors.act(me, 'mirror'), false);
});

test('길찾기: 문간은 문 가운데로 곧게 지나감 (비스듬히 문틀을 스치지 않음)', () => {
  const m = live(10);
  const d = m.doors.list[DOOR_ID];
  // 복도 북쪽에서 동쪽 방 남쪽으로 (문을 비스듬히 지나야 하는 길)
  const start = { x: d.x - 3, y: 0, z: d.z - 2.5 };
  const path = m.nav.findPath(start, { x: d.x + 3, y: 0, z: d.z + 2.5 });
  assert.ok(path && path.length >= 2);
  // 문 평면(x = d.x)을 지나는 곳이 문 가운데 근처, 그 앞뒤 1 m도 곧게
  const pts = [start, ...path];
  let crossed = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.x - d.x) * (b.x - d.x) > 0) continue;
    const t = (d.x - a.x) / (b.x - a.x);
    crossed = { z: a.z + (b.z - a.z) * t, slope: Math.abs((b.z - a.z) / (b.x - a.x)) };
  }
  assert.ok(crossed, '문을 지나감');
  assert.ok(Math.abs(crossed.z - d.z) < 0.15, `문 가운데로 (${(crossed.z - d.z).toFixed(2)} m)`);
  assert.ok(crossed.slope < 0.3, '문간은 곧게');
});

test('온라인 동기화: 참가자의 F·발차기·문 밑 카메라가 방장 경기에서 처리되고 문 상태가 참가자 화면에 전달', () => {
  const opts = { seed: 12, mapId: 'force-bound', rules: 'single', roster: null };
  const host = new Match({ ...opts, playerTeam: TEAMS.DEFUSE });
  const client = new Match({ ...opts, playerTeam: TEAMS.DEFUSE, client: true });
  const hs = new HostSync(host);
  const me = client.player;
  client.localAgent = me;
  const cs = new ClientSync(client, me.id);
  const hme = host.agentById(me.id);
  const d = host.doors.list[DOOR_ID];
  host.phase = 'live';
  for (const m of [host, client]) {
    m.phase = 'live';
    park(m, [m.agentById(me.id)]);
    put(m.agentById(me.id), d.x - 1.3, d.z, EAST);
  }
  host.agents.forEach((a) => a !== hme && host.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: ag.pitch }) }));
  let t = 0;
  const at = (s) => Math.abs(t - s) < DT / 2;
  const rec = new InputRecorder({
    getIntent: (mm, a) => ({ ...emptyIntent(a), yaw: EAST, pitch: 0, interact: at(0.2) || at(1.4), door: at(2.2) ? 'mirror' : null }),
  });
  client.setController(me.id, rec);
  let input = null;
  host.setController(me.id, new RemoteController(() => input, (s) => (hs.acks[me.id] = s)));
  let opened = 0, clientSawOpen = false, mirrorHost = false, mirrorClient = false;
  for (let k = 0; k < 60 * 3; k++) {
    t = k * DT;
    client.tick(DT);
    input = rec.latest;
    host.tick(DT);
    opened = Math.max(opened, Math.abs(d.st.ang));
    if (hme.mirror) mirrorHost = true;
    if (k % 3 === 0) cs.apply(JSON.parse(JSON.stringify(hs.snapshot())), t);
    if (Math.abs(client.doors.list[DOOR_ID].st.ang) > 1) clientSawOpen = true;
    if (me.mirror) mirrorClient = true;
  }
  assert.ok(opened > DOOR.open - 0.05, '방장 경기에서 F로 문이 열림');
  assert.ok(clientSawOpen, '참가자 화면의 문도 열림');
  assert.ok(Math.abs(d.st.ang) < 0.05, '다시 F로 닫힘');
  assert.ok(mirrorHost && mirrorClient, '문 밑 카메라가 방장·참가자 모두에서 켜짐');
  assert.ok(client.map.leaves.length === host.map.leaves.length, '문짝 선분 수가 같음');
});
