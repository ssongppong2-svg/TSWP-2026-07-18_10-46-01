import { STORY } from '../sim/map.js';

// 소리용 위치 판별 (그림·소리와 무관한 순수 함수 → node 시험 가능)
//   footSurface: 발밑 재질 — 'metal'(2층 철제 통로) · 'stairs'(계단) · 'tile'(과학관 바닥) · 'concrete'
//   isCovered:  머리 위가 막혀 있는지 (지붕·2층 바닥판·문 위 벽 아래 = 실내 울림)

export function footSurface(map, x, y, z) {
  const { c, r } = map.toCell(x, z);
  if (!map.inBounds(c, r)) return 'concrete';
  if (map.ramp(c, r)) return 'stairs';
  const museum = map.def?.theme === 'museum';
  // 상자·컨테이너 위 (1층과 2층 사이 높이)
  if (y > 0.5 && y < STORY - 0.4) return museum ? 'tile' : 'metal';
  if (y > STORY - 0.4) {
    // 2층: 철제 통로(=) 또는 그 통로에 이어진 구역 칸
    const u = map.upperAt(c, r);
    if (u === '=') return 'metal';
    return museum ? 'tile' : 'concrete';
  }
  return museum ? 'tile' : 'concrete';
}

export function isCovered(map, x, y, z) {
  const { c, r } = map.toCell(x, z);
  if (!map.inBounds(c, r)) return false;
  // 머리 위로 떠 있는 막힌 구간 (지붕·2층 바닥판·문 위 2층 벽)
  return map.spansAt(c, r).some(([y0]) => y0 > y + 1.6);
}
