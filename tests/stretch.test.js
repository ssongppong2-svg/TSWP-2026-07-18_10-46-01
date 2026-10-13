import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/sim/maps/index.js';
import { FORCE_BOUND_BASE } from '../src/sim/maps/force-bound.js';
import { SCIENCE_HALL_BASE } from '../src/sim/maps/science-hall.js';
import { checkStretch, stretchMap } from '../src/sim/maps/stretch.js';

const count = (rows, re) => rows.reduce((n, r) => n + (r.match(re)?.length ?? 0), 0);

test('맵 넓히기: 포스 바운드·과학관은 약 1.3~1.5배 · 1·2층 크기가 같음 · CQB 야간 과학관은 원래 크기', () => {
  for (const [id, base] of [['force-bound', FORCE_BOUND_BASE], ['science-hall', SCIENCE_HALL_BASE]]) {
    const d = MAPS[id];
    const kr = d.layout.length / base.layout.length, kc = d.layout[0].length / base.layout[0].length;
    assert.ok(kr >= 1.35 && kr <= 1.55, `${id} 세로 ×${kr.toFixed(2)}`);
    assert.ok(kc >= 1.25 && kc <= 1.5, `${id} 가로 ×${kc.toFixed(2)}`);
    assert.equal(d.upper.length, d.layout.length);
    for (const row of [...d.layout, ...d.upper]) assert.equal(row.length, d.layout[0].length);
    // 폭탄은 하나씩 그대로 · 계단 칸 수는 옆으로만 늘어남(길이 그대로)
    assert.equal(count(d.layout, /A/g), 1);
    assert.equal(count(d.layout, /B/g), 1);
  }
  assert.equal(MAPS['science-hall-op'].layout.length, SCIENCE_HALL_BASE.layout.length);
});

test('맵 넓히기: 세로벽 옆에 끼우면 방이 넓어지고 벽 두께는 그대로, 가로벽의 문간 폭도 그대로', () => {
  const def = {
    id: 't',
    layout: [
      '##########',
      '#...#....#',
      '#...#....#',
      '###..#####',
      '#........#',
      '##########',
    ],
    upper: ['          ', '          ', '          ', '          ', '          ', '          '],
  };
  // 4번 칸(세로벽) 뒤에 한 칸 · 2번 줄(방) 뒤에 한 줄
  const s = stretchMap(def, { cols: { 4: 1 }, rows: { 2: 1 } });
  assert.deepEqual(s.layout, [
    '###########',
    '#...#.....#',
    '#...#.....#',
    '#...#.....#',
    '###..######',
    '#.........#',
    '###########',
  ]);
});

test('맵 넓히기: 계단을 따라 늘이거나 문·셔터를 자르는 줄은 거절', () => {
  const bad = checkStretch(FORCE_BOUND_BASE, { rows: { 13: 1 }, cols: { 12: 1 } });
  assert.ok(bad.some((b) => b.includes('계단')));
  assert.ok(bad.some((b) => b.includes('문')));
  assert.throws(() => stretchMap(FORCE_BOUND_BASE, { rows: { 14: 1 } }));
});
