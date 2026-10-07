import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { TeamDraft, COPIES_PER_TEAM } from '../src/sim/draft.js';
import { PATCH_ORDER } from '../src/sim/data.js';

const members = ['p', 'b1', 'b2', 'b3', 'b4'];

test('선착순: 팀당 패치마다 2개까지만', () => {
  const d = new TeamDraft(members);
  assert.ok(d.pick('p', 'elasticPad'));
  assert.ok(d.pick('b1', 'elasticPad'));
  assert.ok(!d.pick('b2', 'elasticPad'), '세 번째 사람은 못 가져감');
  assert.deepEqual(d.holders('elasticPad'), ['p', 'b1']);
  assert.ok(!d.pick('p', 'elasticPad'), '같은 패치 두 개 장착 불가');
  assert.ok(d.pick('p', 'gravityVeil'));
  assert.ok(!d.pick('p', 'resultantAmp'), '한 사람은 2개까지');
  assert.ok(d.unpick('p', 'gravityVeil'));
  assert.equal(d.stock.gravityVeil, COPIES_PER_TEAM);
});

test('자동 채우기: 5명 모두 서로 다른 패치 2개씩, 재고 초과 없음', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = createRng(seed);
    const d = new TeamDraft(members);
    // 무작위로 몇 개 먼저 고른 뒤 나머지 자동
    for (let k = 0; k < 4; k++) {
      const m = rng.pick(members);
      const opts = d.botOptions(m);
      if (opts.length) d.pick(m, rng.pick(opts));
    }
    d.autoFill(rng, ['p']);
    for (const m of members) {
      const l = d.picks.get(m);
      assert.equal(l.length, 2, `seed ${seed} ${m}`);
      assert.equal(new Set(l).size, 2);
    }
    for (const id of PATCH_ORDER) assert.equal(d.stock[id], 0);
  }
});
