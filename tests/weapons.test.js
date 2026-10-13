import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { emptyIntent, giveWeapon } from '../src/sim/agent.js';
import { DT, NOISE, TEAMS } from '../src/sim/constants.js';
import { ARMOR, SHOP_WEAPONS, WEAPONS } from '../src/sim/data.js';
import { WEAPON_ICONS } from '../src/ui/icons.js';
import { BotBrain, botBuy } from '../src/ai/bot.js';
import { createRng } from '../src/core/rng.js';
import { SHOP_KEYS, fireMode } from '../src/ui/shop.js';

const live = (seed = 4) => {
  const m = new Match({ seed, playerTeam: TEAMS.DEFUSE });
  m.phase = 'live';
  return m;
};
const hold = (m, a, id) => {
  giveWeapon(a, id);
  a.weapon = id;
  a.swapT = a.reloadT = a.fireCd = a.burstLeft = 0;
  a.triggerLatch = false; // 방아쇠에서 손을 뗀 상태로
};
// 방아쇠를 frames 동안 당기고(fire) 그 뒤 놓은 채로 rest초
function pull(m, a, frames, rest = 0) {
  let shots = 0;
  const off = m.events.on('shot', (e) => e.agent === a && shots++);
  for (let i = 0; i < frames; i++) m.stepWeapon(a, { ...emptyIntent(a), fire: true }, DT, true);
  for (let i = 0; i < Math.round(rest / DT); i++) m.stepWeapon(a, emptyIntent(a), DT, true);
  off();
  return shots;
}

test('3점사: 한 번 당기면 3발 (손을 바로 떼도 끝까지) · 계속 당기고 있어도 다음 점사는 다시 당겨야', () => {
  const m = live();
  const me = m.player;
  for (const id of ['burst', 'mpistol']) {
    hold(m, me, id);
    const w = WEAPONS[id];
    const before = me.weapons[id].mag;
    assert.equal(pull(m, me, 1, 0.5), 3, `${id}: 한 번 짧게 눌러도 3발`);
    assert.equal(me.weapons[id].mag, before - 3);
    assert.equal(pull(m, me, 60), 3, `${id}: 1초 동안 누르고 있어도 한 점사만`);
    // 점사 안의 간격은 짧고, 점사와 점사 사이는 김
    assert.ok(60 / w.burstRpm < 60 / w.rpm);
  }
});

test('3점사: 탄창이 2발 남았으면 2발만, 무기를 바꾸면 남은 점사는 취소', () => {
  const m = live();
  const me = m.player;
  hold(m, me, 'burst');
  me.weapons.burst.mag = 2;
  me.weapons.burst.reserve = 0;
  assert.equal(pull(m, me, 1, 0.5), 2);
  hold(m, me, 'burst');
  me.weapons.burst.mag = 24;
  m.stepWeapon(me, { ...emptyIntent(me), fire: true }, DT, true);
  assert.equal(me.burstLeft, 2, '첫 발이 나가고 2발 남음');
  m.stepWeapon(me, { ...emptyIntent(me), switchTo: 'pistol' }, DT, true);
  assert.equal(me.burstLeft, 0);
});

test('저격총 머리: 중량 헬멧을 써도 한 방 · 지정사수 소총은 헬멧에 막혀 한 방이 안 됨', () => {
  const m = live();
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  const helmet = () => {
    e.alive = true;
    e.hp = 100;
    e.armorKind = 'heavy';
    e.armor = e.armorMax = ARMOR.heavy.dur;
  };
  helmet();
  let hit = null;
  m.events.on('hit', (h) => (hit = h));
  m.applyDamage(e, WEAPONS.sniper.damage * WEAPONS.sniper.headMult, me, { headshot: true, weapon: 'sniper', pen: WEAPONS.sniper.pen });
  assert.equal(e.alive, false, '헬멧이 있어도 쓰러짐');
  assert.ok(hit.killed && hit.headshot && !hit.blocked, '막힌 소리가 아니라 관통');
  // 몸통은 그대로 (방탄으로 막을 수 있음)
  helmet();
  m.applyDamage(e, WEAPONS.sniper.damage, me, { weapon: 'sniper', pen: WEAPONS.sniper.pen });
  assert.equal(e.alive, true, '몸통 한 발로는 안 쓰러짐');
  helmet();
  m.applyDamage(e, WEAPONS.dmr.damage * WEAPONS.dmr.headMult, me, { headshot: true, weapon: 'dmr', pen: WEAPONS.dmr.pen });
  assert.equal(e.alive, true, '지정사수 소총 머리 한 발은 헬멧이 버팀');
});

test('새 총 5종: 상점·아이콘·소리 거리·키가 모두 있고, 수치가 말이 됨', () => {
  for (const id of ['mpistol', 'carbine', 'burst', 'dmr', 'lmg']) {
    const w = WEAPONS[id];
    assert.ok(w && w.id === id);
    assert.ok(SHOP_WEAPONS.includes(id), `${id} 상점`);
    assert.ok(WEAPON_ICONS[id], `${id} 아이콘`);
    assert.ok(NOISE[id] > 0, `${id} 소리 거리`);
    assert.ok(SHOP_KEYS[id], `${id} 키`);
    assert.ok(['primary', 'secondary'].includes(w.slot));
    assert.ok(w.recoilPitch.length && w.recoilYaw.length);
    if (w.burst) assert.ok(!w.auto && w.burstRpm > w.rpm);
  }
  assert.equal(fireMode(WEAPONS.burst), '3점사');
  assert.equal(fireMode(WEAPONS.lmg), '자동');
  assert.equal(fireMode(WEAPONS.dmr), '단발');
  // 키가 겹치지 않음
  const keys = Object.values(SHOP_KEYS);
  assert.equal(new Set(keys).size, keys.length);
  // 경기관총은 탄이 많고 무겁고 재장전이 김, 지정사수 소총은 몸통 4발·머리 2발
  assert.ok(WEAPONS.lmg.magSize >= 100 && WEAPONS.lmg.mass > WEAPONS.rifle.mass && WEAPONS.lmg.reload > WEAPONS.rifle.reload);
  assert.equal(Math.ceil(100 / WEAPONS.dmr.damage), 4);
  assert.equal(Math.ceil(100 / Math.round(WEAPONS.dmr.damage * WEAPONS.dmr.headMult)), 2);
});

test('봇 구매: 풀 구매면 소총·3점사·지정사수·경기관총·저격총이 골고루, 반 구매면 카빈도, 에코면 기관권총도', () => {
  const rng = createRng(5);
  const seen = { full: new Set(), half: new Set(), eco: new Set() };
  for (const plan of ['full', 'half', 'eco']) {
    for (let i = 0; i < 160; i++) {
      const m = new Match({ seed: i + 1, playerTeam: TEAMS.DEFUSE, rules: 'rounds' });
      m.round = 3; // 권총 라운드가 아님
      const a = m.agents.find((x) => !x.isPlayer);
      a.primary = null;
      a.credits = plan === 'full' ? 7000 : plan === 'half' ? 3000 : 1500;
      botBuy(m, a, plan, rng);
      seen[plan].add(a.primary ?? a.secondary);
    }
  }
  for (const id of ['rifle', 'burst', 'dmr', 'lmg', 'sniper']) assert.ok(seen.full.has(id), `풀 구매에 ${id} (${[...seen.full]})`);
  assert.ok(seen.half.has('carbine') && seen.half.has('smg'), `반 구매 ${[...seen.half]}`);
  assert.ok(seen.eco.has('mpistol') && seen.eco.has('sheriff'), `에코 ${[...seen.eco]}`);
});

test('봇 사격: 3점사 총은 한 번씩 당겨 점사가 나가고, 경기관총은 길게 긁음', () => {
  const m = live(7);
  const bot = m.agents.find((a) => a.team === TEAMS.DEFUSE && !a.isPlayer);
  const brain = new BotBrain(bot, m, 'normal', 0);
  const run = (id, seconds) => {
    hold(m, bot, id);
    let shots = 0;
    const off = m.events.on('shot', (e) => e.agent === bot && shots++);
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const intent = emptyIntent(bot);
      brain.shoot(bot, intent, DT);
      m.stepWeapon(bot, intent, DT, true);
    }
    off();
    return shots;
  };
  const burst = run('burst', 2);
  assert.ok(burst >= 9 && burst % 3 === 0, `3점사 2초 ${burst}발`);
  bot.weapons.lmg = { mag: 100, reserve: 100 };
  brain.burstLeft = brain.burstPause = 0;
  const lmg = run('lmg', 1.2);
  assert.ok(lmg >= 8, `경기관총 ${lmg}발`);
});
