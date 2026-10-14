import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { attachBots } from '../src/ai/bot.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { STORY } from '../src/sim/map.js';
import { NavGrid } from '../src/sim/nav.js';
import { MAP_ORDER, getMapDef } from '../src/sim/maps/index.js';
import { CONCEPTS, CONCEPT_BY_ID, pickQuiz } from '../src/sim/concepts.js';

const step = (match, n) => {
  for (let i = 0; i < n; i++) match.tick(DT);
};

test('맵 목록: 과학관이 등록되어 있고 모든 바닥 칸이 해체팀 진영에서 이어짐', () => {
  assert.ok(MAP_ORDER.includes('science-hall'));
  for (const id of MAP_ORDER) {
    const match = new Match({ mapId: id, seed: 1 });
    const map = match.map;
    assert.equal(map.bombs.length, 2, id);
    assert.ok(map.spawns.defuse.length && map.spawns.force.length, id);
    // 길찾기 그래프(층 포함)에서 해체팀 진영으로부터 갈 수 있는 바닥 확인
    const nav = new NavGrid(map);
    const start = map.spawns.defuse[0];
    const seen = new Uint8Array(nav.nodes.length);
    const queue = [nav.nodeNear(start.x, 0, start.z)];
    seen[queue[0]] = 1;
    while (queue.length) {
      for (const [b] of nav.edges[queue.pop()]) {
        if (seen[b]) continue;
        seen[b] = 1;
        queue.push(b);
      }
    }
    const reach = (c, r, y = 0) => nav.byCell[map.idx(c, r)].some((b) => seen[b] && Math.abs(nav.nodes[b].y - y) < 0.05);
    for (const b of map.bombs) assert.ok(reach(b.c, b.r, b.y), `${id} 폭탄 ${b.id}에 갈 수 있음`);
    for (const s of map.spawns.force) assert.ok(reach(s.c, s.r), `${id} 포스 진영에 갈 수 있음`);
    for (const s of getMapDef(id).concepts ?? []) assert.ok(reach(s.c, s.r, s.f ? STORY : 0), `${id} 개념 카드 자리 ${s.r},${s.c}`);
  }
});

test('과학관: 봇끼리 경기가 정상적으로 끝남', () => {
  const match = new Match({ mapId: 'science-hall', seed: 21 });
  attachBots(match, 'normal');
  let guard = 0;
  while (match.phase !== 'ended' && guard++ < 60 * 140) match.tick(DT);
  assert.equal(match.phase, 'ended');
  assert.ok([TEAMS.DEFUSE, TEAMS.FORCE].includes(match.winner));
});

test('개념 카드: 맵에 놓이고, 사람만 주울 수 있으며 같은 카드는 한 번만', () => {
  const prefer = ['buoyancy', 'friction'];
  const match = new Match({ mapId: 'science-hall', seed: 4, playerTeam: TEAMS.DEFUSE, conceptIds: prefer });
  attachBots(match, 'normal');
  assert.equal(match.concepts.length, 4);
  assert.deepEqual(match.concepts.slice(0, 2).map((c) => c.id), prefer, '먼저 놓을 개념이 앞자리');
  assert.equal(new Set(match.concepts.map((c) => c.id)).size, 4, '같은 개념은 한 번만');
  const picked = [];
  match.events.on('conceptPicked', (e) => picked.push(e));
  // 봇을 카드 위에 세워도 줍지 않음
  const bot = match.agents.find((a) => !a.isPlayer);
  const c0 = match.concepts[0];
  bot.pos.x = c0.x;
  bot.pos.z = c0.z;
  match.updateConcepts();
  assert.equal(picked.length, 0);
  // 플레이어는 주움 (한 번만)
  const me = match.player;
  me.pos.x = c0.x;
  me.pos.z = c0.z;
  match.updateConcepts();
  match.updateConcepts();
  assert.equal(picked.length, 1);
  assert.equal(picked[0].concept.id, c0.id);
  assert.deepEqual(me.concepts, [c0.id]);
  assert.deepEqual(c0.takenBy, [me.id]);
});

test('개념 점검: 주운 카드 → 쓴 패치 관련 개념 → 나머지 순서로 3문제, 정답 번호가 보기 안에 있음', () => {
  const quiz = pickQuiz(['gravity'], ['elasticPad', 'buoyShield'], 3);
  assert.deepEqual(quiz.map((q) => q.id), ['gravity', 'elastic', 'buoyancy']);
  const fill = pickQuiz([], [], 3, () => 0);
  assert.equal(fill.length, 3);
  for (const c of CONCEPTS) {
    assert.ok(c.answer >= 0 && c.answer < c.choices.length, c.id);
    assert.ok(c.q && c.why && c.text, c.id);
    assert.equal(CONCEPT_BY_ID[c.id], c);
  }
});

test('개념 카드가 없는 맵 설정이면 카드도 없음 (봇 경기 재현성 유지)', () => {
  const def = getMapDef('force-bound');
  const match = new Match({ mapId: 'force-bound', seed: 9, conceptCount: 0 });
  assert.equal(match.concepts.length, 0);
  assert.ok(def.concepts.length > 0);
  step(match, 10);
});
