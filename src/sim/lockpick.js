// 합력 락픽: 힘 카드를 골라 합력을 목표 힘과 똑같이 맞추면 자물쇠가 풀립니다.
// 오른쪽 방향을 +, 왼쪽 방향을 − 로 계산한다.

export const CARD_COUNT = 6;

export function generatePuzzle(rng) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const cards = [];
    for (let i = 0; i < CARD_COUNT; i++) cards.push({ dir: rng.chance(0.5) ? 1 : -1, mag: rng.int(1, 9) });
    const size = rng.chance(0.5) ? 3 : 2;
    const order = rng.shuffle([...Array(CARD_COUNT).keys()]);
    const solution = order.slice(0, size).sort((a, b) => a - b);
    const target = solution.reduce((s, i) => s + cards[i].dir * cards[i].mag, 0);
    if (Math.abs(target) < 3 || Math.abs(target) > 18) continue;
    // 카드 한 장만으로는 풀리지 않게
    if (cards.some((c) => c.dir * c.mag === target)) continue;
    // 반대 방향 힘의 합성(빼기)도 꼭 연습하도록 정답에 양쪽 방향을 섞음
    if (new Set(solution.map((i) => cards[i].dir)).size < 2) continue;
    return { target, cards, solution };
  }
  return {
    target: 7,
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

export function describeForce(n) {
  if (n === 0) return '0 N (힘의 평형)';
  return `${n > 0 ? '오른쪽' : '왼쪽'} ${Math.abs(n)} N`;
}

export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export function formula(puzzle, selected) {
  const parts = [];
  puzzle.cards.forEach((c, i) => {
    if (selected[i]) parts.push(`(${signed(c.dir * c.mag)})`);
  });
  if (!parts.length) return '힘 카드 선택 대기';
  return `${parts.join(' + ')} = ${signed(netForce(puzzle, selected))} N`;
}
