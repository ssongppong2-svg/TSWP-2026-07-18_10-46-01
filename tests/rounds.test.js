import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { attachBots } from '../src/ai/bot.js';
import { BOT_NAMES, DT, ECON, ROUNDS, TEAMS } from '../src/sim/constants.js';
import { emptyIntent } from '../src/sim/agent.js';
import { AMMO, ARMOR, WEAPONS } from '../src/sim/data.js';
import { TeamDraft } from '../src/sim/draft.js';
import { createRng } from '../src/core/rng.js';
import { ClientSync, HostSync, InputRecorder, RemoteController, planMatch, rosterFor } from '../src/net/protocol.js';

const roundsMatch = (seed = 4, extra = {}) => new Match({ seed, playerTeam: TEAMS.DEFUSE, rules: 'rounds', ...extra });
const ticks = (m, n, fn) => {
  for (let i = 0; i < n; i++) {
    fn?.(i);
    m.tick(DT);
  }
};

test('라운드제: 구매 시간에는 시작 구역 밖으로 못 나가고, 끝나면 진행', () => {
  const m = roundsMatch();
  const me = m.player;
  assert.equal(m.phase, 'buy');
  assert.equal(m.phaseT, ROUNDS.buyTimeFirst);
  assert.equal(me.credits, ECON.start);
  assert.equal(me.primary, null, '첫 라운드는 권총만');
  assert.equal(me.weapon, 'pistol');
  // 앞(북쪽)으로 계속 달려도 장벽에서 멈춤
  m.setController(me.id, { getIntent: (mm, a) => ({ ...emptyIntent(a), moveZ: 1, yaw: 0 }) });
  ticks(m, 60 * 5);
  const b = m.barriers[me.team];
  assert.ok(me.pos.z >= b.z0 - 1e-6, '장벽 안');
  assert.ok(me.pos.z < b.z0 + 1, '장벽까지는 움직임');
  ticks(m, 60 * (ROUNDS.buyTimeFirst - 5) + 2);
  assert.equal(m.phase, 'live');
  ticks(m, 60);
  assert.ok(me.pos.z < b.z0 - 1, '진행이 시작되면 나감');
});

test('상점: 크레딧 차감 · 같은 것을 다시 누르면 환불 · 돈이 모자라면 거절 · 방탄이 먼저 깎임', () => {
  const m = roundsMatch();
  const me = m.player;
  me.credits = 4000;
  assert.ok(m.buy(me, 'rifle'));
  assert.equal(me.credits, 4000 - WEAPONS.rifle.price);
  assert.equal(me.primary, 'rifle');
  assert.equal(me.weapon, 'rifle', '산 총을 바로 듦');
  assert.equal(me.weapons.rifle.mag, WEAPONS.rifle.magSize);
  // 같은 칸의 다른 총: 앞의 것을 환불하고 바꿈
  assert.ok(m.buy(me, 'smg'));
  assert.equal(me.credits, 4000 - WEAPONS.smg.price);
  assert.equal(me.primary, 'smg');
  assert.ok(!me.weapons.rifle, '바꾼 총은 없어짐');
  // 다시 누르면 환불
  assert.ok(m.buy(me, 'smg'));
  assert.equal(me.credits, 4000);
  assert.equal(me.primary, null);
  assert.equal(me.weapon, 'pistol');
  // 방탄: 등급·내구도
  assert.ok(m.buy(me, 'heavy'));
  assert.equal(me.armor, ARMOR.heavy.dur);
  assert.equal(me.armorKind, 'heavy');
  assert.ok(m.buy(me, 'light'), '이번에 산 방탄은 다른 방탄으로 바꿀 수 있음');
  assert.equal(me.armor, ARMOR.light.dur);
  assert.equal(me.armorKind, 'light');
  assert.equal(me.credits, 4000 - ARMOR.light.price);
  assert.ok(m.buy(me, 'light'), '환불');
  assert.equal(me.armor, 0);
  assert.equal(me.armorKind, null);
  assert.equal(me.credits, 4000);
  // 전 라운드부터 입고 있던 방탄이 더 높은 등급이면 사지 않음, 닳았으면 같은 것을 새로 살 수 있음
  me.armor = me.armorMax = ARMOR.heavy.dur;
  me.armorKind = 'heavy';
  assert.equal(m.buy(me, 'light'), false);
  assert.equal(m.buy(me, 'heavy'), false, '새것과 같으면 살 필요 없음');
  me.armor = 20;
  assert.ok(m.buy(me, 'heavy'), '닳은 방탄은 새것으로');
  assert.equal(me.armor, ARMOR.heavy.dur);
  assert.ok(m.buy(me, 'heavy'), '환불하면 닳은 방탄으로 돌아감');
  assert.equal(me.armor, 20);
  me.armor = me.armorMax = 0;
  me.armorKind = null;
  // 탄종: 이번 라운드 모든 총에. 같은 것을 다시 누르거나 일반탄을 고르면 환불
  assert.ok(m.buy(me, 'ap'));
  assert.equal(me.ammo, 'ap');
  assert.equal(me.credits, 4000 - AMMO.ap.price);
  assert.ok(m.buy(me, 'hp'), '다른 탄종으로 바꿈');
  assert.equal(me.ammo, 'hp');
  assert.equal(me.credits, 4000 - AMMO.hp.price);
  assert.ok(m.buy(me, 'fmj'), '일반탄 = 환불');
  assert.equal(me.ammo, 'fmj');
  assert.equal(me.credits, 4000);
  // 돈이 모자람
  me.credits = 1000;
  let denied = 0;
  m.events.on('buyDenied', () => denied++);
  assert.equal(m.buy(me, 'rifle'), false);
  assert.equal(denied, 1);
  // 진행 중에는 못 삼
  m.phase = 'live';
  assert.equal(m.buy(me, 'sheriff'), false);
  // 방탄: 소총 일반탄 몸통 10발이면 맨몸은 쓰러지지만 중량 방탄은 버팀 (막히면 충격만, 방탄이 닳음)
  const enemy = m.agents.find((a) => a.team === TEAMS.FORCE);
  enemy.armor = enemy.armorMax = ARMOR.heavy.dur;
  enemy.armorKind = 'heavy';
  let blocked = 0;
  m.events.on('hit', (e) => e.target === enemy && e.blocked && blocked++);
  for (let i = 0; i < 10; i++) m.applyDamage(enemy, WEAPONS.rifle.damage, me, { pen: WEAPONS.rifle.pen });
  assert.ok(enemy.alive);
  assert.ok(blocked > 0, '일부는 방탄이 막음');
  assert.ok(enemy.hp > 0 && enemy.hp < 100);
  assert.ok(enemy.armor < ARMOR.heavy.dur, '방탄이 닳음');
});

test('라운드 결과: 점수·크레딧(승리 3000, 패배 1900·2400·2900, 처치 200), 살아남은 요원은 총·방탄 유지', () => {
  const m = roundsMatch(9);
  const me = m.player;
  me.credits = 3900;
  m.buy(me, 'rifle');
  m.buy(me, 'heavy');
  m.phase = 'live';
  const enemies = m.agents.filter((a) => a.team === TEAMS.FORCE);
  const mate = m.agents.find((a) => a.team === TEAMS.DEFUSE && a !== me);
  const mateCredits = mate.credits;
  let wiped = null;
  m.events.on('forceWiped', (e) => (wiped = e));
  for (const e of enemies) m.kill(e, me);
  m.checkEnd();
  // 포스팀을 모두 쓰러뜨려도 끝나지 않음 → 폭탄 2기를 해체해야 승리
  assert.equal(m.phase, 'live', '전멸만으로는 라운드가 끝나지 않음');
  assert.equal(wiped?.left, 2, '남은 폭탄 2기 안내');
  for (const b of m.bombs) b.state = 'defused';
  m.checkEnd();
  assert.equal(m.phase, 'roundEnd');
  assert.equal(m.score.defuse, 1);
  assert.equal(m.roundWinner, TEAMS.DEFUSE);
  assert.equal(m.roundReason, '폭탄 2기 해체 완료');
  assert.equal(me.credits, 0 + ECON.kill * 5 + ECON.win);
  assert.equal(mate.credits, mateCredits + ECON.win);
  assert.equal(enemies[0].credits, ECON.start + ECON.loss[0]);
  me.armor = 20; // 다친 방탄은 그만큼만 남음
  ticks(m, 60 * ROUNDS.endTime + 2);
  assert.equal(m.round, 2);
  assert.equal(m.phase, 'buy');
  assert.equal(me.primary, 'rifle', '살아남았으면 총 유지');
  assert.equal(me.armor, 20);
  assert.equal(enemies[0].primary, null, '쓰러졌으면 잃음');
  assert.ok(enemies.every((e) => e.alive && e.hp === 100), '모두 되살아남');
  // 두 번째 패배는 더 받음
  m.phase = 'live';
  for (const e of enemies) m.kill(e, me);
  for (const b of m.bombs) b.state = 'defused';
  m.checkEnd();
  assert.equal(enemies[0].credits, ECON.start + ECON.loss[0] + ECON.loss[1]);
});

test('폭탄은 라운드마다 A·B 구역 안 무작위 칸에 놓임', () => {
  const m = roundsMatch(12);
  const seen = { A: new Set(), B: new Set() };
  for (let r = 0; r < 8; r++) {
    for (const b of m.bombs) {
      const { c, r: row } = m.map.toCell(b.x, b.z);
      assert.ok(m.map.siteCells[b.id].some((s) => s.c === c && s.r === row), `${b.id} 구역 안`);
      assert.ok(m.map.walkableAt(c, row, b.y ?? 0), '그 층 바닥');
      assert.equal(b.state, 'armed');
      seen[b.id].add(`${c},${row}`);
    }
    m.round = 2; // 전반 첫 라운드가 아닌 것으로
    m.startRound();
  }
  assert.ok(seen.A.size > 2 && seen.B.size > 2, '여러 곳에 놓임');
});

test('봇끼리 한 경기: 7라운드 먼저 이기면 끝, 6라운드 뒤 공수 교대, 크레딧 0~9000', () => {
  const rng = createRng(21);
  const loadouts = new Map();
  for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) {
    const d = new TeamDraft([0, 1, 2, 3, 4].map((i) => `${team}-${i}`));
    d.autoFill(rng);
    for (const [k, v] of d.loadouts()) loadouts.set(k, v);
  }
  const m = new Match({ seed: 21, rules: 'rounds', loadouts });
  attachBots(m, 'normal');
  let halftime = 0, buys = 0, maxCredits = 0;
  const sideAt = [];
  m.events.on('halftime', () => halftime++);
  m.events.on('buy', (e) => !e.sold && buys++);
  m.events.on('roundStart', () => sideAt.push(m.agentById('defuse-0').team));
  let k = 0;
  while (m.phase !== 'ended' && k++ < 60 * 60 * 30) {
    m.tick(DT);
    if (k % 60 === 0) for (const a of m.agents) {
      maxCredits = Math.max(maxCredits, a.credits);
      assert.ok(a.credits >= 0, '크레딧은 음수가 되지 않음');
    }
  }
  assert.equal(m.phase, 'ended');
  const top = Math.max(m.score.defuse, m.score.force);
  assert.equal(top, ROUNDS.winTo);
  assert.equal(m.score[m.winner], ROUNDS.winTo);
  assert.ok(m.history.length >= 7 && m.history.length <= 13);
  assert.ok(maxCredits <= ECON.max);
  assert.ok(buys > 20, `봇이 상점을 씀 (${buys})`);
  if (m.history.length > ROUNDS.half) {
    assert.equal(halftime, 1);
    assert.equal(sideAt[0], TEAMS.DEFUSE);
    assert.equal(sideAt[ROUNDS.half], TEAMS.FORCE, '후반에는 맡은 쪽이 바뀜');
  }
});

test('온라인 라운드제: 참가자 구매가 방장에 반영되고 점수·크레딧·폭탄 위치가 전달됨', () => {
  const players = [
    { key: 'host', name: '방장', team: TEAMS.DEFUSE, load: [] },
    { key: 'p2', name: '참가자', team: TEAMS.DEFUSE, load: [] },
  ];
  const plan = planMatch(players, { botNames: BOT_NAMES, draft: TeamDraft, rng: createRng(3) });
  const loadouts = new Map(plan.loadouts);
  const host = new Match({ seed: 3, roster: rosterFor(plan, 'host'), loadouts, rules: 'rounds' });
  attachBots(host, 'normal');
  const client = new Match({ seed: 3, roster: rosterFor(plan, 'p2'), loadouts, rules: 'rounds', client: true });
  const hs = new HostSync(host);
  const me = client.agentById('defuse-1');
  client.localAgent = me;
  const cs = new ClientSync(client, 'defuse-1');
  let wantBuy = null;
  const rec = new InputRecorder({ getIntent: (mm, a) => ({ ...emptyIntent(a), buy: wantBuy }) });
  client.setController(me.id, rec);
  host.setController('defuse-1', new RemoteController(() => rec.latest, (s) => (hs.acks['defuse-1'] = s)));
  host.setController('defuse-0', { getIntent: (mm, a) => emptyIntent(a) });
  const sync = (k) => {
    client.tick(DT);
    host.tick(DT);
    if (k % 3 === 0) cs.apply(JSON.parse(JSON.stringify(hs.snapshot({ withStats: k % 30 === 0 }))), k * DT);
  };
  host.agentById('defuse-1').credits = 1000;
  for (let k = 0; k < 30; k++) {
    wantBuy = k === 5 ? 'sheriff' : null;
    sync(k);
  }
  const hm = host.agentById('defuse-1');
  assert.equal(hm.secondary, 'sheriff', '방장 경기에서 샀음');
  assert.equal(hm.credits, 200);
  assert.equal(me.secondary, 'sheriff', '참가자 화면에도 반영');
  assert.equal(me.weapon, 'sheriff');
  assert.equal(me.credits, 200);
  for (const a of host.agents) {
    if (a.id === 'defuse-1') continue;
    const c = client.agentById(a.id);
    assert.equal(c.secondary, a.secondary, `${a.id} 보조무기가 참가자 화면에도`);
    assert.equal(c.primary, a.primary);
  }
  for (const [i, b] of host.bombs.entries()) {
    assert.equal(client.bombs[i].x, b.x);
    assert.equal(client.bombs[i].z, b.z);
  }
  // 라운드 하나를 끝냄
  host.phase = 'live';
  for (const e of host.agents.filter((a) => a.team === TEAMS.FORCE)) host.kill(e, hm);
  host.checkEnd();
  assert.equal(host.phase, 'live', '전멸만으로는 끝나지 않음');
  for (const b of host.bombs) b.state = 'defused';
  host.checkEnd();
  let roundEnd = 0;
  client.events.on('roundEnd', () => roundEnd++);
  for (let k = 30; k < 60; k++) sync(k);
  assert.equal(client.phase, 'roundEnd');
  assert.equal(client.score.defuse, 1);
  assert.equal(client.roundReason, '폭탄 2기 해체 완료');
  assert.equal(roundEnd, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(hs.snapshot({ withStats: true }))) < 3600);
});

test('구매 시간 개념 점검: 사람만 라운드마다 한 문제, 맞히면 에너지 +200 (한 번만), 다음 라운드는 다른 문제', async () => {
  const { CONCEPT_BY_ID } = await import('../src/sim/concepts.js');
  const m = roundsMatch(5);
  const me = m.player;
  assert.ok(me.quiz && !me.quiz.done, '사람에게 문제');
  assert.ok(m.agents.filter((a) => a !== me).every((a) => !a.quiz), '봇은 없음');
  const c = CONCEPT_BY_ID[me.quiz.id];
  const before = me.credits;
  m.setController(me.id, { getIntent: (mm, a) => ({ ...emptyIntent(a), quiz: c.answer }) });
  ticks(m, 2);
  assert.equal(me.credits, before + ECON.quiz, '정답 보너스');
  assert.ok(me.quiz.done && me.quiz.ok);
  ticks(m, 2);
  assert.equal(me.credits, before + ECON.quiz, '두 번 받지 않음');
  const first = me.quiz.id;
  m.round = 2;
  m.startRound();
  assert.ok(me.quiz.id !== first && !me.quiz.done, '새 라운드에는 다른 문제');
  // 틀리면 보너스 없음
  const wrong = (CONCEPT_BY_ID[me.quiz.id].answer + 1) % CONCEPT_BY_ID[me.quiz.id].choices.length;
  const c2 = me.credits;
  m.setController(me.id, { getIntent: (mm, a) => ({ ...emptyIntent(a), quiz: wrong }) });
  ticks(m, 2);
  assert.ok(me.quiz.done && !me.quiz.ok && me.credits === c2, '틀리면 보너스 없음');
});

test('개념 숙달: 관련 개념을 숙달한 사람은 그 패치의 재사용 대기가 15% 짧음', () => {
  const load = new Map([['defuse-0', ['elasticPad', null, null, null]]]);
  const plain = new Match({ seed: 2, playerTeam: TEAMS.DEFUSE, loadouts: load });
  const master = new Match({ seed: 2, playerTeam: TEAMS.DEFUSE, loadouts: load, playerMastery: ['elastic'] });
  for (const m of [plain, master]) {
    m.phase = 'live';
    m.usePatch(m.player, 0);
  }
  const a = plain.player.patches[0].cd, b = master.player.patches[0].cd;
  assert.ok(a > 0 && Math.abs(b - a * 0.85) < 1e-6, `${a} → ${b}`);
  assert.ok(master.isMastered(master.player, 'elasticPad') && !plain.isMastered(plain.player, 'elasticPad'));
});

test('해체 필수: 포스팀이 모두 쓰러져도 폭탄을 해체하지 못하면 시간이 다 되어 폭발 → 포스팀 승리 · 봇은 전멸 뒤 곧장 폭탄으로', () => {
  const m = roundsMatch(12);
  attachBots(m, 'normal');
  m.phase = 'live';
  m.phaseT = 0;
  for (const e of m.agents.filter((a) => a.team === TEAMS.FORCE)) m.kill(e, null);
  m.checkEnd();
  assert.equal(m.phase, 'live');
  // 봇 해체팀: 집결 지점에서 기다리지 않고 폭탄으로 향함
  const bots = m.agents.filter((a) => a.team === TEAMS.DEFUSE && !a.isPlayer && a.alive);
  const before = bots.map((a) => Math.min(...m.bombs.map((b) => Math.hypot(b.x - a.pos.x, b.z - a.pos.z))));
  for (let k = 0; k < 60 * 4; k++) m.tick(1 / 60);
  const after = bots.map((a) => Math.min(...m.bombs.map((b) => Math.hypot(b.x - a.pos.x, b.z - a.pos.z))));
  assert.ok(after.filter((d, i) => d < before[i] - 3).length >= Math.ceil(bots.length / 2), '봇들이 폭탄 쪽으로 다가감');
  // 해체하지 못한 채 시간이 다 됨 → 폭발 · 포스팀 승리
  for (const b of m.bombs) b.state = 'armed';
  m.timeLeft = 0;
  m.checkEnd();
  assert.equal(m.phase, 'roundEnd');
  assert.equal(m.roundWinner, TEAMS.FORCE);
  assert.equal(m.roundReason, '제한 시간 종료 — 폭탄 폭발');
});
