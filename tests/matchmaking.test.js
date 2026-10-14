import test from 'node:test';
import assert from 'node:assert/strict';
import { Matchmaker, mmQueue, pickMap, assignTeams, MM_COUNTDOWN, MM_MAX } from '../src/net/matchmaking.js';
import { PROTOCOL } from '../src/net/protocol.js';
import { MAP_ORDER } from '../src/sim/maps/index.js';

// 메모리 속 방: 모두가 같은 presence 목록을 봄 (실제 room과 같은 모양)
function memoryTransport() {
  const rooms = new Map();
  let n = 0;
  return {
    kind: 'memory',
    async join(name) {
      const room = rooms.get(name) ?? { members: new Map(), listeners: new Set() };
      rooms.set(name, room);
      const id = `p${n++}`;
      room.members.set(id, {});
      const notify = () => [...room.listeners].forEach((f) => f());
      let mine = null;
      const api = {
        presence: async (patch) => {
          const me = room.members.get(id);
          if (!me) return;
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) delete me[k];
            else me[k] = v;
          }
          notify();
        },
        peers: () => [...room.members].map(([peer, presence]) => ({ peer, isMe: peer === id, presence })),
        onPeers: (fn) => {
          mine = fn;
          room.listeners.add(fn);
          return () => room.listeners.delete(fn);
        },
        connected: () => true,
        leave: async () => {
          room.members.delete(id);
          if (mine) room.listeners.delete(mine);
          notify();
        },
      };
      return api;
    },
  };
}

test('빠른 매칭: 대기열은 온 순서 · 출발한 사람과 출발 명단에 든 사람은 빠짐', () => {
  const p = (tk, at, extra = {}) => ({ k: 'mm', v: PROTOCOL, tk, at, ...extra });
  const q = mmQueue([p('c', 30), p('a', 10), p('b', 20), p('x', 5, { go: { teams: { x: 'defuse', y: 'force' } } }), p('y', 6), { k: 'p', v: PROTOCOL, tk: 'z', at: 1 }]);
  assert.deepEqual(q.map((e) => e.tk), ['a', 'b', 'c']);
});

test('빠른 매칭: 맵은 가장 많이 고른 것 · 같으면 그중 하나 · 표가 없으면 아무 맵', () => {
  assert.equal(pickMap(['moon-base', 'moon-base', 'giant-nest', null]), 'moon-base');
  for (let i = 0; i < 20; i++) assert.ok(['moon-base', 'giant-nest'].includes(pickMap(['moon-base', 'giant-nest'])));
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(pickMap([null, 'nowhere']));
  for (const m of seen) assert.ok(MAP_ORDER.includes(m));
  assert.ok(seen.size >= 3, '표가 없으면 여러 맵이 골고루');
});

test('빠른 매칭: 팀은 온 순서대로 번갈아 (차이는 많아야 1명)', () => {
  const t = assignTeams(['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(Object.values(t), ['defuse', 'force', 'defuse', 'force', 'defuse']);
});

test('빠른 매칭: 2명부터 카운트다운 → 진행자가 방을 열고 모두 같은 코드·맵으로 출발', async () => {
  const tr = memoryTransport();
  let clock = 1000;
  const now = () => clock;
  const gos = [];
  const mk = (name) => new Matchmaker(tr, { name, now, tick: 0, linger: 0, goDelay: 0, onGo: (g) => gos.push({ name, ...g }) });
  const a = mk('가'), b = mk('나'), c = mk('다');
  await a.start();
  clock += 10;
  await b.start();
  clock += 10;
  await c.start();
  b.setVote('giant-nest');
  c.setVote('giant-nest');
  for (const m of [a, b, c]) m.update();
  assert.ok(a.isLeader && !b.isLeader, '먼저 온 사람이 진행');
  assert.equal(a.countdown, MM_COUNTDOWN);
  assert.equal(b.countdown, MM_COUNTDOWN, '진행자의 남은 시간이 모두에게 보임');
  clock += MM_COUNTDOWN * 1000 + 10;
  a.update(); // 진행자 출발
  for (const m of [b, c]) m.update(); // 알림을 보고 따라감
  assert.equal(gos.length, 3);
  const host = gos.find((g) => g.host);
  assert.equal(host.name, '가');
  assert.ok(gos.every((g) => g.code === host.code && g.map === 'giant-nest'));
  assert.deepEqual(gos.map((g) => g.team).sort(), ['defuse', 'defuse', 'force']);
  await new Promise((r) => setTimeout(r, 20));
});

test('빠른 매칭: 혼자면 카운트다운 없음 · 진행자는 지금 시작 (빈자리 봇) · 10명이면 바로 출발', async () => {
  const tr = memoryTransport();
  let clock = 0;
  const gos = [];
  const solo = new Matchmaker(tr, { name: '혼자', now: () => clock, tick: 0, linger: 0, goDelay: 0, onGo: (g) => gos.push(g) });
  await solo.start();
  solo.update();
  assert.equal(solo.countdown, null);
  solo.launchNow();
  assert.equal(gos.length, 1);
  assert.equal(Object.keys(gos[0].teams).length, 1);
  await new Promise((r) => setTimeout(r, 20));
  // 10명
  const tr2 = memoryTransport();
  const got = [];
  const many = [];
  for (let i = 0; i < MM_MAX; i++) {
    clock += 1;
    const m = new Matchmaker(tr2, { name: `요원${i}`, now: () => clock, tick: 0, linger: 0, goDelay: 0, onGo: (g) => got.push(g) });
    await m.start();
    many.push(m);
  }
  many[0].update();
  for (const m of many.slice(1)) m.update();
  assert.equal(got.length, MM_MAX, '10명이 모이면 카운트다운 없이 출발');
  assert.equal(Object.values(got[0].teams).filter((t) => t === 'defuse').length, 5);
  await new Promise((r) => setTimeout(r, 20));
});

test('빠른 매칭: 진행자는 출발 알림을 먼저 올리고 잠시 뒤 방으로 (나머지가 알림을 읽을 시간)', async () => {
  const tr = memoryTransport();
  let clock = 0;
  const gos = [];
  const a = new Matchmaker(tr, { name: '가', now: () => clock, tick: 0, linger: 200, goDelay: 60, onGo: (g) => gos.push(g) });
  const b = new Matchmaker(tr, { name: '나', now: () => clock, tick: 0, linger: 200, goDelay: 60, onGo: (g) => gos.push(g) });
  await a.start();
  clock += 5;
  await b.start();
  a.update();
  a.launchNow();
  b.update();
  assert.ok(!gos.some((g) => g.host), '진행자는 아직 방으로 가지 않음');
  assert.ok(gos.some((g) => !g.host), '나머지는 알림을 보자마자 출발');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(gos.length, 2);
  assert.ok(gos.some((g) => g.host), '잠시 뒤 진행자도 방으로');
  await new Promise((r) => setTimeout(r, 250));
});
