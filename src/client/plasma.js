// 우주 테마 에너지 탄 색: 팀마다 플라스마 색 (해체팀 하늘빛 · 포스팀 주황빛)
// 탄 궤적·잔상·총구 불꽃·1·3인칭 총 발광이 모두 이 색을 씀
export const PLASMA = { defuse: '#4fe3ff', force: '#ff7a3a' };
export const plasmaOf = (team) => PLASMA[team] ?? '#c9b6ff';
