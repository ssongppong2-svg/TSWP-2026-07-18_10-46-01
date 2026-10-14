// 문의 모양: 맵 정의(doors)의 문간 칸 하나에 문틀(벽)과 문짝(외문·양문)을 세운다.
// 벽 칸이 2m 두께라 문간도 2m 깊이의 통로다. 문틀 기둥이 통로 양옆을 메워 문 너비만 트이고,
// 문짝은 통로 한가운데(벽 두께의 중간)에 경첩으로 달려 돈다.
// map.js가 문틀(고정 상자)을, doors.js가 문짝(움직이는 얇은 판)을 쓴다.
import { CELL } from './constants.js';

export const DOOR = {
  single: 1.2, // 외문 너비
  double: 1.8, // 양문 너비 (문짝 두 개)
  height: 2.15, // 문짝 높이
  frameTop: 2.25, // 문틀 위 (인방 아래)
  thick: 0.06, // 문짝 두께
  gap: 0.03, // 문짝 아래 틈 (문 밑 카메라가 들어가는 곳)
  open: 1.62, // 활짝 연 각도 (약 93°)
  crack: 0.3, // 살짝 연 각도 (약 17°)
  openTime: 0.6, // 닫힘 → 활짝 (보통 속도)
  crackTime: 1.1, // 닫힘 → 살짝 (천천히)
  reach: 1.75, // 문 가운데까지 손이 닿는 거리
  kickWindup: 0.32, // 발을 들어 차기까지
  kickSpeed: 10, // 걷어찬 문이 도는 빠르기 (rad/s)
  kickBreak: 0.3, // 잠긴 문을 한 번에 부술 확률
  kickBreakAdd: 0.18, // 찰 때마다 더해짐 (경첩·자물쇠가 헐거워짐)
  kickStun: 1.3, // 걷어찬 문에 맞은 사람이 휘청이는 시간
  kickKnock: 4.5, // 문에 맞아 밀려나는 속도
  lockHp: 3, // 산탄 몇 알이 자물쇠에 맞으면 부서지는지
  lockRadius: 0.45, // 자물쇠(손잡이) 둘레
  breachStun: 3.2, // 문을 폭파하면 건너편 사람이 비틀거리는 시간
  breachRange: 4.5,
};

// 문 재질: 나무 문은 웬만한 탄이 뚫고(피해 줄어듦), 철문은 관통력 높은 탄만 뚫음
export const DOOR_MAT = {
  wood: { penNeed: 1, through: 0.7, name: '나무 문' },
  steel: { penNeed: 3, through: 0.55, name: '철문' },
};

// 문 하나의 모양. def: { r, c, span: 'x'|'z', leaves: 1|2, hinge: 0|1, mat, locked, open }
//   span: 닫힌 문짝이 놓이는 방향 ('x'면 지나가는 방향은 z)
export function doorGeometry(map, def, id) {
  const spanX = def.span === 'x';
  const u = spanX ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const n = spanX ? { x: 0, z: 1 } : { x: 1, z: 0 };
  const double = (def.leaves ?? 1) === 2;
  const w = double ? DOOR.double : DOOR.single;
  const { c, r } = def;
  if (!map.walkable(c, r)) throw new Error(`문 ${id} (${r}, ${c}): 문간 칸이 막혀 있습니다.`);
  const [sa, sb] = spanX ? [[c - 1, r], [c + 1, r]] : [[c, r - 1], [c, r + 1]];
  if (map.walkable(...sa) || map.walkable(...sb)) throw new Error(`문 ${id} (${r}, ${c}): 문간 양옆이 벽이어야 합니다.`);
  const x = map.cellX(c), z = map.cellZ(r);
  const x0 = map.originX + c * CELL, z0 = map.originZ + r * CELL;
  // 문틀 위 끝: 칸의 천장(2층 바닥판 밑 등)과 옆 벽 높이 중 낮은 쪽
  let ceil = Infinity;
  for (const [y0] of map.spansAt(c, r)) if (y0 > DOOR.frameTop && y0 < ceil) ceil = y0;
  const side = Math.max(map.heights[map.idx(...sa)], map.heights[map.idx(...sb)]);
  const top = Math.min(ceil, side);
  // 문틀: 양옆 기둥(통로 깊이 전체) + 위 인방 [minX, maxX, minZ, maxZ, y0, y1]
  const boxes = [];
  const box = (a0, a1, y0, y1) => (spanX ? [a0, a1, z0, z0 + CELL, y0, y1] : [x0, x0 + CELL, a0, a1, y0, y1]);
  const mid = spanX ? x : z, edge0 = spanX ? x0 : z0;
  boxes.push(box(edge0, mid - w / 2, 0, top), box(mid + w / 2, edge0 + CELL, 0, top));
  if (top > DOOR.frameTop + 0.02) boxes.push(box(mid - w / 2, mid + w / 2, DOOR.frameTop, top));
  // 문짝: 경첩 위치(hx, hz)와 닫혔을 때 경첩에서 문 끝으로 향하는 방향(dx, dz)
  const hingeSides = double ? [-1, 1] : [def.hinge === 1 ? 1 : -1];
  const leaves = hingeSides.map((h) => ({ hx: x + u.x * h * (w / 2), hz: z + u.z * h * (w / 2), dx: -u.x * h, dz: -u.z * h, len: double ? w / 2 : w }));
  return { id, def, c, r, x, z, u, n, w, top, boxes, leaves, double, mat: def.mat ?? map.def.doorMat ?? 'wood' };
}

// 문짝이 ang(라디안, +면 n 쪽으로 열림)만큼 열렸을 때의 선분
export function leafSegment(door, leaf, ang) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const dx = leaf.dx * cs + door.n.x * sn, dz = leaf.dz * cs + door.n.z * sn;
  return { x0: leaf.hx + dx * 0.02, z0: leaf.hz + dz * 0.02, x1: leaf.hx + dx * (leaf.len - 0.01), z1: leaf.hz + dz * (leaf.len - 0.01), dx, dz };
}

// 점에서 선분까지 가장 가까운 점
export function closestOnSegment(px, pz, x0, z0, x1, z1) {
  const ex = x1 - x0, ez = z1 - z0;
  const l2 = ex * ex + ez * ez;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - x0) * ex + (pz - z0) * ez) / l2)) : 0;
  return { x: x0 + ex * t, z: z0 + ez * t, t };
}
