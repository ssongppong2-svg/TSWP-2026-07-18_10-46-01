import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { TeamDraft, COPIES_PER_TEAM } from '../src/sim/draft.js';
import { PATCHES, PATCH_ORDER, LOADOUT_SLOTS } from '../src/sim/data.js';

const members = ['p', 'b1', 'b2', 'b3', 'b4'];

test('패치 구성: 일반 5 · 특수 3 · 필살 3', () => {
  const count = (t) => PATCH_ORDER.filter((id) => PATCHES[id].tier === t).length;
  assert.equal(count('normal'), 5);
  assert.equal(count('special'), 3);
  assert.equal(count('ultimate'), 3);
  assert.deepEqual(LOADOUT_SLOTS.map((s) => s.key), ['C', 'Q', 'E', 'X']);
});

test('선착순: 패치마다 팀당 2개, 등급별 슬롯 수 제한', () => {
  const d = new TeamDraft(members);
  assert.ok(d.pick('p', 'elasticPad'));
  assert.ok(d.pick('b1', 'elasticPad'));
  assert.ok(!d.pick('b2', 'elasticPad'), '세 번째 사람은 못 가져감');
  assert.deepEqual(d.holders('elasticPad'), ['p', 'b1']);
  assert.ok(!d.pick('p', 'elasticPad'), '같은 패치 두 개 장착 불가');
  assert.ok(d.pick('p', 'gravityVeil'));
  assert.ok(!d.pick('p', 'resultantAmp'), '일반은 2개까지');
  assert.ok(d.pick('p', 'frictionZero'));
  assert.ok(!d.pick('p', 'elasticNet'), '특수는 1개까지');
  assert.ok(d.pick('p', 'gravityCollapse'));
  assert.ok(!d.pick('p', 'frictionStorm'), '필살은 1개까지');
  assert.ok(d.isComplete('p'));
  assert.deepEqual(d.loadoutOf('p'), ['elasticPad', 'gravityVeil', 'frictionZero', 'gravityCollapse']);
  assert.ok(d.unpick('p', 'gravityVeil'));
  assert.equal(d.stock.gravityVeil, COPIES_PER_TEAM);
  assert.deepEqual(d.loadoutOf('p'), ['elasticPad', null, 'frictionZero', 'gravityCollapse']);
});

test('자동 채우기: 5명 모두 C·Q·E·X를 등급에 맞게 서로 다른 패치로 채움', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = createRng(seed);
    const d = new TeamDraft(members);
    for (let k = 0; k < 8; k++) {
      const m = rng.pick(members);
      const opts = d.botOptions(m);
      if (opts.length) d.pick(m, rng.pick(opts));
    }
    d.autoFill(rng, ['p']);
    for (const m of members) {
      const l = d.loadoutOf(m);
      assert.ok(l.every(Boolean), `seed ${seed} ${m} ${l}`);
      assert.equal(new Set(l).size, 4);
      l.forEach((id, i) => assert.equal(PATCHES[id].tier, LOADOUT_SLOTS[i].tier));
    }
    for (const id of PATCH_ORDER) assert.ok(d.stock[id] >= 0);
  }
});
