import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { emptyIntent } from '../src/sim/agent.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { BotBrain } from '../src/ai/bot.js';
import { planEntry } from '../src/ai/entry.js';
import { ENTRY_COMMANDS } from '../src/sim/entry-orders.js';

// 포스 바운드 연구동 "복도 ↔ 동쪽 방" 문(2번). 분대장(사람)은 복도에서 문을 보고 지휘, 아군 봇 4명이 진입
const DOOR_ID = 2;
const EAST = -Math.PI / 2;
function put(a, x, z, yaw = 0) {
  a.pos.x = a.prev.x = x;
  a.pos.z = a.prev.z = z;
  a.pos.y = a.prev.y = 0;
  a.vel.x = a.vel.y = a.vel.z = 0;
  a.yaw = yaw;
  a.pitch = 0;
  a.onGround = true;
}
function squad(seed, { setup = null, gear = {} } = {}) {
  const m = new Match({ seed, mapId: 'force-bound', playerTeam: TEAMS.DEFUSE });
  if (setup) {
    m.doorSetup = setup;
    m.doors.reset();
  }
  m.phase = 'live';
  const d = m.doors.list[DOOR_ID];
  const me = m.player;
  const mates = m.agents.filter((a) => a.team === TEAMS.DEFUSE && a !== me);
  const foes = m.agents.filter((a) => a.team === TEAMS.FORCE);
  put(me, d.x - 2.6, d.z, EAST);
  const spots = [[-3, -2], [-3, 2], [-4.5, 0.5], [-4.5, -0.5]];
  mates.forEach((a, i) => {
    put(a, d.x + spots[i][0], d.z + spots[i][1], EAST);
    a.gear = { ...a.gear, ...(gear[i] ?? {}) };
    m.setController(a.id, new BotBrain(a, m, 'normal', i + 1));
    m.controllers.get(a.id).startDelay = 0;
  });
  foes.forEach((a, i) => {
    put(a, -30 + i * 1.2, -36, 0);
    m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: ag.pitch }) });
  });
  m.setController(me.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: EAST, pitch: 0 }) });
  return { m, d, me, mates, foes };
}
const runUntil = (m, s, done) => {
  for (let i = 0; i < Math.round(s / DT); i++) {
    m.tick(DT);
    if (done()) return true;
  }
  return false;
};
const inRoom = (d, a) => a.alive && a.pos.x > d.x + 0.6;

test('진입 계획: 문 양옆 대기 자리 · 문 앞 자리 · 문 너머 방의 진입 지점', () => {
  const { m, d } = squad(1);
  const p = planEntry(m, d, -1);
  assert.ok(p.stack.length >= 4, `대기 자리 ${p.stack.length}곳`);
  for (const s of p.stack) assert.ok(s.x < d.x - 0.9, '대기 자리는 내 쪽(복도)');
  assert.ok(p.stack.slice(0, 2).some((s) => s.z < d.z) && p.stack.slice(0, 2).some((s) => s.z > d.z), '문 양옆');
  assert.ok(p.room.cells.length >= 6, `방 ${p.room.cells.length}칸`);
  assert.ok(p.room.points.length >= 2);
  for (const q of p.room.points) assert.ok(q.x > d.x + 0.5, '진입 지점은 방 안');
});

test('진입 명령 휠: 6가지 (대기·열고·섬광·폭파·걷어차고·문 밑)', () => {
  assert.deepEqual(ENTRY_COMMANDS.map((c) => c.mode), ['stack', 'open', 'flash', 'breach', 'kick', 'mirror']);
  assert.deepEqual(ENTRY_COMMANDS.map((c) => c.key), [1, 2, 3, 4, 5, 6]);
});

test('열고 진입: 문 양옆에 붙었다가 문을 열고 한 명씩 들어가 "방 확보"', () => {
  const { m, d, me, mates } = squad(2);
  const phases = new Set();
  let clear = null;
  m.events.on('roomClear', (e) => (clear = e));
  m.issueCommand(me, { type: 'eOpen' });
  const o = m.orders[me.team];
  assert.equal(o.mode, 'open');
  assert.equal(o.door, DOOR_ID);
  const ok = runUntil(m, 30, () => {
    phases.add(o.phase);
    return !!clear;
  });
  assert.ok(ok, `방 확보까지 (단계 ${[...phases].join('→')})`);
  assert.deepEqual([...phases].slice(0, 3), ['stack', 'breach', 'enter']);
  assert.ok(Math.abs(d.st.ang) > 1, '문이 열림');
  assert.ok(mates.filter((a) => inRoom(d, a)).length >= 3, '분대가 방 안에');
});

test('폭파 후 진입: C4를 붙이고 물러나 터뜨림 → 문이 부서지고 진입 (아군은 다치지 않음)', () => {
  const { m, d, me, mates } = squad(3, { gear: { 2: { c4: 1 } } });
  let clear = false;
  m.events.on('roomClear', () => (clear = true));
  m.issueCommand(me, { type: 'eBreach' });
  assert.ok(runUntil(m, 35, () => clear), '방 확보');
  assert.ok(d.st.broken, '문 폭파');
  for (const a of mates) assert.equal(a.hp, 100, '아군 피해 없음');
  assert.ok(mates.filter((a) => inRoom(d, a)).length >= 3);
});

test('섬광 후 진입: 문을 열고 방 안으로 섬광을 던진 뒤 진입', () => {
  const { m, d, me, mates } = squad(4, { gear: { 1: { flash: 1 } } });
  let flash = null, clear = false;
  m.events.on('detonate', (e) => e.kind === 'flash' && (flash = e));
  m.events.on('roomClear', () => (clear = true));
  m.issueCommand(me, { type: 'eFlash' });
  assert.ok(runUntil(m, 35, () => clear), '방 확보');
  assert.ok(flash, '섬광이 터짐');
  assert.ok(flash.x > d.x + 0.5, '방 안에서 터짐');
  assert.ok(mates.filter((a) => inRoom(d, a)).length >= 3);
});

test('걷어차고 진입: 잠긴 문을 찰 때까지 차서 열고 진입', () => {
  const { m, d, me } = squad(5, { setup: { [DOOR_ID]: { locked: true } } });
  let clear = false, kicks = 0;
  m.events.on('kick', () => kicks++);
  m.events.on('roomClear', () => (clear = true));
  m.issueCommand(me, { type: 'eKick' });
  assert.ok(runUntil(m, 40, () => clear), `방 확보 (발차기 ${kicks}번)`);
  assert.ok(kicks >= 1 && !d.st.locked, '자물쇠가 부서짐');
});

test('문 밑 확인: 카메라로 건너편을 보고 본 적을 무전·표시, 그 뒤 문 앞 대기', () => {
  const { m, d, me, foes } = squad(6);
  const e = foes[0];
  put(e, d.x + 3.5, d.z + 1.2, Math.PI / 2);
  const radio = [];
  m.events.on('radio', (x) => radio.push(x.text));
  m.issueCommand(me, { type: 'eMirror' });
  const o = m.orders[me.team];
  assert.ok(runUntil(m, 25, () => radio.some((t) => t.startsWith('문 밑 확인'))), radio.join(' / '));
  assert.ok(radio.some((t) => t === '문 밑 확인: 적 1명'), radio.join(' / '));
  assert.ok(e.revealedUntil > m.time, '본 적은 표시됨');
  assert.equal(Math.abs(d.st.ang) < 0.05, true, '문은 닫힌 그대로');
  m.tick(DT);
  assert.equal(o.mode, 'stack');
});

test('진입 명령은 문을 바라보고 4.5 m 안에서만 (아니면 거절)', () => {
  const { m, d, me } = squad(7);
  let denied = null;
  m.events.on('commandDenied', (e) => (denied = e));
  put(me, d.x - 7, d.z, EAST);
  m.issueCommand(me, { type: 'eOpen' });
  assert.ok(denied, '너무 멀면 거절');
  assert.equal(m.orders[me.team], null);
});
