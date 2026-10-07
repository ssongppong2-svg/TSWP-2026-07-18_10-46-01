import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { generatePuzzle, isSolved, netForce, describeForce, formula } from '../src/sim/lockpick.js';

test('합력 락픽: 항상 풀 수 있고, 한 장으로는 안 풀리고, 반대 방향 힘이 섞임', () => {
  const rng = createRng(7);
  for (let i = 0; i < 500; i++) {
    const p = generatePuzzle(rng);
    const sel = p.cards.map((_, k) => p.solution.includes(k));
    assert.ok(isSolved(p, sel));
    assert.ok(!p.cards.some((c) => c.dir * c.mag === p.target));
    assert.equal(new Set(p.solution.map((k) => p.cards[k].dir)).size, 2);
    assert.ok(Math.abs(p.target) >= 3 && Math.abs(p.target) <= 18);
  }
});

test('합력 계산: 같은 방향은 더하고 반대 방향은 뺌', () => {
  const p = { target: 7, cards: [{ dir: 1, mag: 10 }, { dir: -1, mag: 3 }, { dir: 1, mag: 2 }], solution: [0, 1] };
  assert.equal(netForce(p, [true, true, false]), 7);
  assert.equal(netForce(p, [true, false, true]), 12);
  assert.ok(!isSolved(p, [false, false, false]));
  assert.equal(describeForce(-5), '왼쪽 5 N');
  assert.equal(describeForce(0), '0 N (힘의 평형)');
  assert.equal(formula(p, [true, true, false]), '(+10) + (−3) = +7 N');
});
