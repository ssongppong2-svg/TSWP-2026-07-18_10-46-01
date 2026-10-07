import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { attachBots } from '../src/ai/bot.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { emptyIntent } from '../src/sim/agent.js';
import { MAP_ORDER, getMapDef } from '../src/sim/maps/index.js';

const step = (match, n) => {
  for (let i = 0; i < n; i++) match.tick(DT);
};

// 플레이어가 한 번만 명령을 내리는 조종자
function commander(match, type) {
  let sent = false;
  return {
    getIntent(m, a) {
      const i = emptyIntent(a);
      if (!sent) {
        i.command = { type };
        sent = true;
      }
      return i;
    },
  };
}

test('맵 목록: 포스 바운드가 등록되어 있고 맵마다 필요한 정보가 있음', () => {
  assert.ok(MAP_ORDER.includes('force-bound'));
  for (const id of MAP_ORDER) {
    const def = getMapDef(id);
    assert.ok(def.name && def.layout?.length, id);
    assert.ok(def.callouts?.length, '무전 구역 이름');
    assert.ok(def.staging?.A?.length && def.staging?.B?.length, '해체팀 집결 지점');
  }
  const match = new Match({ mapId: 'force-bound', seed: 1 });
  assert.equal(match.map.id, 'force-bound');
  assert.equal(match.map.calloutAt(match.map.bombs[0].x, match.map.bombs[0].z), 'A 사이트');
});

test('지휘: A 목표 명령을 내리면 분대원이 응답하고 폭탄 A로 향함', () => {
  const match = new Match({ seed: 7, playerTeam: TEAMS.DEFUSE });
  attachBots(match, 'normal');
  const me = match.player;
  match.phase = 'live';
  match.liveAt = 0;
  const radios = [];
  match.events.on('radio', (e) => radios.push(e));
  match.setController(me.id, commander(match, 'A'));
  step(match, 60 * 3);
  assert.equal(match.orders.defuse?.type, 'A');
  assert.ok(radios.some((r) => r.team === TEAMS.DEFUSE && r.kind === 'ack' && r.text.includes('A')), '수신 응답');
  const bombA = match.bombById('A');
  const mates = match.agents.filter((a) => a.team === TEAMS.DEFUSE && !a.isPlayer);
  const before = mates.map((a) => Math.hypot(a.pos.x - bombA.x, a.pos.z - bombA.z));
  step(match, 60 * 6);
  const after = mates.map((a) => Math.hypot(a.pos.x - bombA.x, a.pos.z - bombA.z));
  assert.ok(after.every((d, i) => d < before[i]), '모두 A 쪽으로 이동 (집결 대기 없이)');
});

test('지휘: 집결 명령이면 분대장 곁으로 모임', () => {
  const match = new Match({ seed: 8, playerTeam: TEAMS.DEFUSE });
  attachBots(match, 'normal');
  const me = match.player;
  match.phase = 'live';
  // 분대장을 진영 반대쪽 끝으로 옮김
  me.pos.x = match.map.cellX(4);
  me.pos.z = match.map.cellZ(34);
  me.prev = { ...me.pos };
  match.setController(me.id, commander(match, 'regroup'));
  step(match, 60 * 14);
  const mates = match.agents.filter((a) => a.team === TEAMS.DEFUSE && !a.isPlayer);
  for (const a of mates) assert.ok(Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) < 6, `${a.name} 집결`);
});

test('무전: 적 발소리를 들은 분대원이 구역 이름과 함께 보고하고, 정보가 팀에 공유됨', () => {
  const match = new Match({ seed: 9, playerTeam: TEAMS.DEFUSE });
  attachBots(match, 'normal');
  match.phase = 'live';
  const radios = [];
  match.events.on('radio', (e) => radios.push(e));
  const mate = match.agents.find((a) => a.team === TEAMS.DEFUSE && !a.isPlayer);
  const enemy = match.agents.find((a) => a.team === TEAMS.FORCE);
  // 적을 아군 근처 벽 너머(보이지 않는 곳)에 두고 달리는 소리를 냄
  enemy.pos = { x: mate.pos.x + 8, y: 0, z: mate.pos.z - 8 };
  for (let i = 0; i < 20 && !radios.length; i++) {
    match.makeNoise(enemy, 'step');
    step(match, 20);
  }
  const report = radios.find((r) => r.kind === 'contact');
  assert.ok(report, '무전 보고');
  assert.equal(report.team, TEAMS.DEFUSE);
  assert.match(report.text, /발소리 포착/);
  assert.ok(match.intel.defuse.length > 0, '팀 정보 공유');
});
