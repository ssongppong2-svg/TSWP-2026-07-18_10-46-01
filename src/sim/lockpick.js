// 힘 락픽: 힘 카드를 골라 카드들의 합력을 목표와 똑같이 맞추면 자물쇠가 풀립니다.
// 한 축 위의 힘만 다룬다: 가로 문제는 오른쪽 +, 왼쪽 −, 세로 문제는 위 +, 아래 −.
// 문제 종류 (자물쇠마다 무작위):
//   resultant  합력 맞추기 — 요구 합력이 보임
//   friction   힘의 평형 — 이미 걸려 있는 마찰력과 합력 0이 되도록 (요구 합력 = 마찰력의 반대)
//   elastic    탄성력 — 용수철상수 × 늘일 길이 = 필요한 힘 (직접 계산, 요구 합력은 숨김)
//   buoyancy   부력 — 공기 중 무게 − 물속 무게 = 부력 (직접 계산, 위쪽 +)
//   moon       달에서의 무게 — 지구 무게 ÷ 6 (직접 계산, 위쪽 +)
// 빨리 계산할수록 빨리 해체된다 (공부가 곧 실력).

export const CARD_COUNT = 6;
export const PUZZLE_KINDS = ['resultant', 'friction', 'elastic', 'buoyancy', 'moon'];

// 문제 종류별 교범 (화면 아래 설명) — 관련 개념 카드 id
export const PUZZLE_INFO = {
  resultant: { title: '합력 잠금', concept: 'resultantOpposite', text: '같은 방향의 두 힘은 더하고, 반대 방향의 두 힘은 큰 힘에서 작은 힘을 뺀다. 합력의 방향은 큰 힘의 방향.' },
  friction: { title: '마찰 브레이크 잠금', concept: 'equilibrium', text: '한 물체에 작용하는 힘들의 합력이 0이면 힘의 평형. 마찰력과 크기가 같고 방향이 반대인 힘을 만든다.' },
  elastic: { title: '용수철 잠금', concept: 'springScale', text: '용수철이 늘어난 길이는 작용한 힘에 비례한다. 필요한 힘 = 용수철상수(N/cm) × 늘일 길이(cm).' },
  buoyancy: { title: '부력 잠금', concept: 'buoyancySize', text: '부력의 크기 = 공기 중에서 잰 무게 − 물속에서 잰 무게. 부력의 방향은 위쪽.' },
  moon: { title: '달 중력 잠금', concept: 'moonWeight', text: '달의 중력은 지구의 약 1/6. 달에서의 무게 = 지구에서의 무게 ÷ 6 (질량은 그대로).' },
};

const sideWord = (dir, vertical) => (vertical ? (dir > 0 ? '위쪽' : '아래쪽') : dir > 0 ? '오른쪽' : '왼쪽');

// 문제 상황 → { target(카드 합), fixed(이미 걸린 힘), hidden(요구 합력 숨김), vertical, prompt }
function scenario(kind, rng) {
  const dir = rng.chance(0.5) ? 1 : -1;
  switch (kind) {
    case 'friction': {
      const f = rng.int(3, 12);
      // 마찰력이 dir 방향으로 걸려 있음 → 카드 합력은 반대 방향 f
      return { target: -dir * f, fixed: dir * f, hidden: false, vertical: false, prompt: `회전축에 마찰력이 ${sideWord(dir)}으로 ${f} N 걸려 있다. 힘의 평형(전체 합력 0)을 만들어라.` };
    }
    case 'elastic': {
      const k = rng.pick([2, 3, 4]);
      const x = rng.int(2, Math.floor(18 / k));
      return { target: dir * k * x, hidden: true, vertical: false, prompt: `용수철상수 ${k} N/cm인 용수철을 ${sideWord(dir)}으로 ${x} cm 늘이는 힘을 만들어라.` };
    }
    case 'buoyancy': {
      const b = rng.int(3, 12);
      const water = rng.int(2, 9);
      return { target: b, hidden: true, vertical: true, prompt: `공기 중 무게 ${b + water} N, 물속 무게 ${water} N인 추. 추가 받는 부력과 같은 힘을 위쪽으로 만들어라.` };
    }
    case 'moon': {
      const m = rng.int(3, 12);
      return { target: m, hidden: true, vertical: true, prompt: `지구에서 무게 ${m * 6} N인 장비를 달에서 받치는 힘(달에서의 무게)을 위쪽으로 만들어라.` };
    }
    default: {
      const t = dir * rng.int(3, 18);
      return { target: t, hidden: false, vertical: false, prompt: `요구 합력: ${sideWord(Math.sign(t))} ${Math.abs(t)} N` };
    }
  }
}

// 카드 6장 중 2~3장의 합이 target이 되게. 한 장으로는 안 풀리고, 정답에 양쪽 방향이 섞임 (빼기 연습)
function dealCards(target, rng) {
  for (let attempt = 0; attempt < 800; attempt++) {
    const cards = [];
    for (let i = 0; i < CARD_COUNT; i++) cards.push({ dir: rng.chance(0.5) ? 1 : -1, mag: rng.int(1, 9) });
    const size = rng.chance(0.5) ? 3 : 2;
    const order = rng.shuffle([...Array(CARD_COUNT).keys()]);
    const solution = order.slice(0, size).sort((a, b) => a - b);
    const last = solution[solution.length - 1];
    const rest = solution.slice(0, -1).reduce((s, i) => s + cards[i].dir * cards[i].mag, 0);
    const v = target - rest;
    if (v === 0 || Math.abs(v) > 9) continue;
    cards[last] = { dir: Math.sign(v), mag: Math.abs(v) };
    if (cards.some((c) => c.dir * c.mag === target)) continue;
    if (new Set(solution.map((i) => cards[i].dir)).size < 2) continue;
    return { cards, solution };
  }
  return null;
}

export function generatePuzzle(rng, kind = null) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const k = kind ?? rng.pick(PUZZLE_KINDS);
    const sc = scenario(k, rng);
    if (Math.abs(sc.target) < 3 || Math.abs(sc.target) > 18) continue;
    const dealt = dealCards(sc.target, rng);
    if (!dealt) continue;
    return { kind: k, ...sc, ...dealt };
  }
  return {
    kind: 'resultant',
    target: 7,
    hidden: false,
    vertical: false,
    prompt: '요구 합력: 오른쪽 7 N',
    cards: [
      { dir: 1, mag: 5 }, { dir: -1, mag: 3 }, { dir: 1, mag: 5 },
      { dir: -1, mag: 8 }, { dir: 1, mag: 9 }, { dir: -1, mag: 2 },
    ],
    solution: [0, 1, 2],
  };
}

export function netForce(puzzle, selected) {
  let sum = 0;
  puzzle.cards.forEach((c, i) => {
    if (selected[i]) sum += c.dir * c.mag;
  });
  return sum;
}

export function isSolved(puzzle, selected) {
  return selected.some(Boolean) && netForce(puzzle, selected) === puzzle.target;
}

export function describeForce(n, vertical = false) {
  if (n === 0) return '0 N (힘의 평형)';
  return `${sideWord(Math.sign(n), vertical)} ${Math.abs(n)} N`;
}

export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export function formula(puzzle, selected) {
  const parts = [];
  puzzle.cards.forEach((c, i) => {
    if (selected[i]) parts.push(`(${signed(c.dir * c.mag)})`);
  });
  if (!parts.length) return '힘 카드 선택 대기';
  const net = netForce(puzzle, selected);
  if (puzzle.fixed) return `마찰력 (${signed(puzzle.fixed)}) + ${parts.join(' + ')} = ${signed(net + puzzle.fixed)} N`;
  return `${parts.join(' + ')} = ${signed(net)} N`;
}
