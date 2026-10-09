import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { PUZZLE_INFO, PUZZLE_KINDS, generatePuzzle, isSolved, netForce, describeForce, formula } from '../src/sim/lockpick.js';
import { CONCEPT_BY_ID } from '../src/sim/concepts.js';

test('힘 락픽: 다섯 종류 모두 항상 풀 수 있고, 한 장으로는 안 풀리고, 반대 방향 힘이 섞임', () => {
  const rng = createRng(7);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const p = generatePuzzle(rng);
    seen.add(p.kind);
    assert.ok(PUZZLE_INFO[p.kind] && CONCEPT_BY_ID[PUZZLE_INFO[p.kind].concept], `교범 개념 ${p.kind}`);
    assert.ok(p.prompt.length > 5);
    if (p.kind === 'friction') assert.equal(p.fixed, -p.target, '마찰력과 평형');
    if (['elastic', 'buoyancy', 'moon'].includes(p.kind)) assert.ok(p.hidden, '계산 문제는 요구 합력을 숨김');
    if (['buoyancy', 'moon'].includes(p.kind)) assert.ok(p.vertical && p.target > 0, '세로 문제는 위쪽');
    const sel = p.cards.map((_, k) => p.solution.includes(k));
    assert.ok(isSolved(p, sel));
    assert.ok(!p.cards.some((c) => c.dir * c.mag === p.target));
    assert.equal(new Set(p.solution.map((k) => p.cards[k].dir)).size, 2);
    assert.ok(Math.abs(p.target) >= 3 && Math.abs(p.target) <= 18);
  }
  assert.deepEqual([...seen].sort(), [...PUZZLE_KINDS].sort());
});

test('힘 락픽 문제 계산: 용수철·부력·달 무게의 요구 합력이 문제 속 숫자와 맞음', () => {
  const rng = createRng(11);
  for (let i = 0; i < 300; i++) {
    const p = generatePuzzle(rng);
    const n = p.prompt.match(/\d+/g).map(Number);
    if (p.kind === 'elastic') assert.equal(Math.abs(p.target), n[0] * n[1]);
    if (p.kind === 'buoyancy') assert.equal(p.target, n[0] - n[1]);
    if (p.kind === 'moon') assert.equal(p.target * 6, n[0]);
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
