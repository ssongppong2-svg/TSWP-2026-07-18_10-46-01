// ─────────────────────────────────────────────────────────────
// 맵: 과학관 · 야간 작전 (Science Hall — Night Op) — CQB 작전 전용 변형
// 5대5 과학관과 같은 건물. 폐관 뒤 불 꺼진 전시관, 남쪽 동(실험실·강당) 입구를 문 하나 너비로 좁혀 문을 달았다.
//   진압팀은 정문 로비(D)에 투입, 구출한 연구원은 로비까지 호송. 장치는 A 중력관 · B 부력관 두 곳
// ─────────────────────────────────────────────────────────────
import { SCIENCE_HALL_BASE as SCIENCE_HALL } from './science-hall.js'; // 작전 맵은 원래 크기 (좁은 실내 CQB)

// 원래 배치에서 고칠 칸: [줄, 칸, 글자]
const EDITS = [
  [22, 5, '#'], // 탄성 실험실 북문 (2칸 → 1칸)
  [22, 14, '#'], // 강당 북서문
  [22, 21, '#'], // 강당 북동문
  [22, 30, '#'], // 마찰 실험실 북문
  [31, 8, '#'], [31, 10, '#'], // 탄성 실험실 남문 (3칸 → 1칸)
  [31, 16, '#'], [31, 19, '#'], // 강당 남문 둘
  [31, 26, '#'], [31, 28, '#'], // 마찰 실험실 남문
  [26, 11, '#'], // 탄성 실험실 ↔ 강당
  [28, 24, '#'], // 강당 ↔ 마찰 실험실
];
const patch = (rows) => {
  const out = rows.map((r) => r.split(''));
  for (const [r, c, ch] of EDITS) out[r][c] = ch;
  return out.map((r) => r.join(''));
};

export const SCIENCE_HALL_OP = {
  ...SCIENCE_HALL,
  id: 'science-hall-op',
  name: '과학관 · 야간',
  nameEn: 'SCIENCE HALL — NIGHT',
  code: 'SH-OP',
  desc: '폐관한 과학관. 불 꺼진 전시관과 2층 회랑, 문으로 나뉜 실험실·강당.',
  mood: '야간 · 폐관',
  light: undefined, // 밤 (천장 조명만)
  cqb: true,
  doorMat: 'wood',
  layout: patch(SCIENCE_HALL.layout),
  doors: [
    { r: 22, c: 4, span: 'x', mat: 'wood' }, // 탄성 실험실 북문
    { r: 22, c: 13, span: 'x', mat: 'wood', leaves: 2 }, // 강당 북서문
    { r: 22, c: 22, span: 'x', mat: 'wood', leaves: 2 }, // 강당 북동문
    { r: 22, c: 31, span: 'x', mat: 'wood' }, // 마찰 실험실 북문
    { r: 31, c: 9, span: 'x', mat: 'steel', leaves: 2 }, // 탄성 실험실 남문 (로비)
    { r: 31, c: 15, span: 'x', mat: 'wood', leaves: 2, locked: true }, // 강당 남서문 (잠김)
    { r: 31, c: 20, span: 'x', mat: 'wood', leaves: 2 }, // 강당 남동문
    { r: 31, c: 27, span: 'x', mat: 'steel', leaves: 2 }, // 마찰 실험실 남문 (로비)
    { r: 25, c: 11, span: 'z', mat: 'wood' }, // 탄성 실험실 ↔ 강당
    { r: 27, c: 24, span: 'z', mat: 'wood', locked: true }, // 강당 ↔ 마찰 실험실 (잠김)
  ],
  op: {
    extract: { r0: 32, r1: 38, c0: 2, c1: 33 },
    hostages: [
      { r: 27, c: 5 }, // 탄성 실험실
      { r: 28, c: 18 }, // 강당 무대 앞
      { r: 25, c: 30 }, // 마찰 실험실
      { r: 3, c: 29 }, // 관리동
    ],
    intel: [
      { r: 1, c: 6, name: '관리동 보안 기록' },
      { r: 14, c: 26, name: '부력관 실험 데이터' },
    ],
    posts: [
      { r: 2, c: 20, lr: 5, lc: 17 }, // 관리동
      { r: 9, c: 6, lr: 17, lc: 9 }, // A 중력관
      { r: 11, c: 19, lr: 17, lc: 17 }, // 아트리움
      { r: 9, c: 29, lr: 17, lc: 26 }, // B 부력관
      { r: 19, c: 17, lr: 22, lc: 13, patrol: { r: 19, c: 27 } }, // 전시 복도 순찰
      { r: 24, c: 8, lr: 22, lc: 4 }, // 탄성 실험실
      { r: 23, c: 20, lr: 22, lc: 22 }, // 강당 북쪽
      { r: 28, c: 15, lr: 31, lc: 15 }, // 강당 남쪽
      { r: 28, c: 28, lr: 31, lc: 27 }, // 마찰 실험실
      { r: 20, c: 4, lr: 22, lc: 4 }, // 전시 복도 서쪽
      { r: 14, c: 21, lr: 17, lc: 17 }, // 아트리움 남쪽
      { r: 13, c: 9, lr: 16, lc: 9 }, // A 중력관 남쪽
    ],
  },
};
