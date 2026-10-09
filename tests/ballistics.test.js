import test from 'node:test';
import assert from 'node:assert/strict';
import { ARMOR_RULES, hitArmor, penChance } from '../src/sim/ballistics.js';
import { AMMO, ARMOR, WEAPONS } from '../src/sim/data.js';
import { createRng } from '../src/core/rng.js';
import { Match } from '../src/sim/match.js';
import { TEAMS } from '../src/sim/constants.js';

// 몇 발에 쓰러지는지 평균 (applyDamage와 같은 계산: 한 발마다 반올림, 방탄은 관통 판정)
function meanHits(weapon, ammoId, armorId, { head = false, n = 3000, seed = 7 } = {}) {
  const w = WEAPONS[weapon], am = AMMO[ammoId], ar = armorId ? ARMOR[armorId] : null;
  const rng = createRng(seed);
  let total = 0;
  for (let i = 0; i < n; i++) {
    let hp = 100, dur = ar ? ar.dur : 0, k = 0;
    while (hp > 0 && k < 100) {
      k++;
      const amount = Math.round(w.damage * am.dmg * (head ? w.headMult : 1)) * (w.pellets ?? 1);
      if (dur > 0 && (!head || ar.helmet)) {
        const r = hitArmor({ damage: amount, pen: w.pen + am.pen, wear: am.wear, cls: ar.cls, dur, max: ar.dur }, rng.next());
        hp -= Math.round(r.hp);
        dur -= r.wear;
        if (dur < 0.5) dur = 0;
      } else hp -= amount;
    }
    total += k;
  }
  return total / n;
}

test('관통 확률: 관통력이 등급보다 높을수록, 방탄이 닳을수록 잘 뚫림', () => {
  assert.ok(penChance(5, 4, 1) > penChance(3, 4, 1));
  assert.ok(penChance(3, 4, 0.2) > penChance(3, 4, 1), '닳은 방탄은 잘 뚫림');
  assert.equal(penChance(-10, 6, 1), ARMOR_RULES.minChance);
  assert.equal(penChance(20, 1, 1), ARMOR_RULES.maxChance);
  const blocked = hitArmor({ damage: 20, pen: 0, wear: 1, cls: 6, dur: 70, max: 70 }, 0.99);
  assert.equal(blocked.penetrated, false);
  assert.equal(blocked.hp, 20 * ARMOR_RULES.blunt, '막히면 충격만');
  const through = hitArmor({ damage: 20, pen: 9, wear: 1, cls: 2, dur: 40, max: 40 }, 0.01);
  assert.equal(through.penetrated, true);
  assert.ok(through.hp > blocked.hp && through.wear < blocked.wear, '뚫리면 몸에 더 들어가고 방탄은 덜 닳음');
});

test('방탄 효과: 소총 일반탄 맨몸 10발 · 경량 11~13발 · 중량 13~16발', () => {
  assert.equal(meanHits('rifle', 'fmj', null), 10);
  const light = meanHits('rifle', 'fmj', 'light');
  const heavy = meanHits('rifle', 'fmj', 'heavy');
  assert.ok(light > 10.5 && light < 13, `경량 ${light}`);
  assert.ok(heavy > 13 && heavy < 16, `중량 ${heavy}`);
  // 헬멧: 중량은 머리도 막음 → 머리 7발보다 오래 버팀, 그래도 몸통보다는 빠름
  const headHeavy = meanHits('rifle', 'fmj', 'heavy', { head: true });
  assert.ok(headHeavy > 7.5 && headHeavy < heavy, `중량 머리 ${headHeavy}`);
  assert.equal(meanHits('rifle', 'fmj', 'light', { head: true }), 7, '경량 조끼는 머리를 못 막음');
});

test('탄종: 관통탄은 방탄에 강하고, 확장탄은 맨몸에 강하고 방탄에 약함', () => {
  const fmjHeavy = meanHits('rifle', 'fmj', 'heavy');
  const apHeavy = meanHits('rifle', 'ap', 'heavy');
  const hpHeavy = meanHits('rifle', 'hp', 'heavy');
  assert.ok(apHeavy < fmjHeavy - 1.5, `관통탄 ${apHeavy} < 일반탄 ${fmjHeavy}`);
  assert.ok(hpHeavy > fmjHeavy + 1.5, `확장탄 ${hpHeavy} > 일반탄 ${fmjHeavy}`);
  assert.equal(meanHits('rifle', 'ap', null), 10, '관통탄도 맨몸에는 그대로');
  assert.equal(meanHits('rifle', 'hp', null), 8, '확장탄은 맨몸 8발');
  // 산탄총은 방탄을 거의 못 뚫지만 빨리 망가뜨림
  assert.ok(meanHits('shotgun', 'fmj', 'heavy') <= 4.5);
});

test('경기 안에서: 관통탄을 산 요원의 탄은 관통력이 오르고, 방탄이 부서지면 사라짐', () => {
  const m = new Match({ seed: 11, playerTeam: TEAMS.DEFUSE });
  m.phase = 'live';
  const me = m.player;
  me.ammo = 'ap';
  me.weapon = 'rifle';
  m.fire(me, WEAPONS.rifle, me.weapons.rifle);
  const p = m.projectiles.at(-1);
  assert.equal(p.pen, WEAPONS.rifle.pen + AMMO.ap.pen);
  assert.equal(p.wear, AMMO.ap.wear);
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  e.armor = e.armorMax = ARMOR.light.dur;
  e.armorKind = 'light';
  let broke = 0;
  m.events.on('hit', (h) => h.armorBroke && broke++);
  for (let i = 0; i < 8 && e.armor > 0; i++) m.applyDamage(e, 40, me, { pen: 0, wear: 1 });
  assert.equal(e.armor, 0);
  assert.equal(e.armorKind, null, '부서진 방탄은 없어짐');
  assert.equal(broke, 1);
});
