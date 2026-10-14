import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_KG, FORCE_KIND, agentMass, fmtN } from '../src/client/force-arrows.js';
import { carriedMass } from '../src/sim/agent.js';

test('힘 화살표: 크기는 앞 두 자리까지 읽기 쉽게 (N)', () => {
  assert.equal(fmtN(250), '250');
  assert.equal(fmtN(9_123), '9,100');
  assert.equal(fmtN(33_456), '33,000');
  assert.equal(fmtN(64), '64');
});

test('힘 화살표: 요원 질량 = 몸 + 가진 장비 · 힘 종류마다 이름과 색', () => {
  const a = { weapons: { rifle: {} }, gear: {}, armor: 0 };
  assert.equal(agentMass(a), BODY_KG + carriedMass(a));
  for (const k of ['blast', 'elastic', 'net', 'gravity', 'friction', 'reaction', 'buoyancy', 'weight']) {
    assert.ok(FORCE_KIND[k]?.name && /^#[0-9a-f]{6}$/i.test(FORCE_KIND[k].color), k);
  }
});
