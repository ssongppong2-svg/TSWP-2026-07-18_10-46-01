// 설정은 이 브라우저에만 저장된다. 저장이 막힌 환경(시크릿 창 등)에서도 기본값으로 동작.
const KEY = 'forcebound.settings.v1';

export const DEFAULT_SETTINGS = {
  name: '나',
  sensitivity: 1,
  fov: 100,
  volume: 0.8,
  quality: 'high',
  invertY: false,
  difficulty: 'normal',
  bodycam: true, // 바디캠 렌즈 효과
  shake: 1, // 화면 흔들림 세기
  crosshair: 'dot', // 조준점: 'dot' 작은 점 / 'off' 없음
  mapId: 'force-bound',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* 저장소를 쓸 수 없으면 기본값 */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 무시 */
  }
}
