// 설정은 이 브라우저에만 저장된다. 저장이 막힌 환경(시크릿 창 등)에서도 기본값으로 동작.
const KEY = 'forcebound.settings.v1';

export const DEFAULT_SETTINGS = {
  name: '나',
  sensitivity: 1,
  fov: 100,
  volume: 0.8,
  quality: 'auto', // 'auto'(기기에 맞춰 자동) | 'low' | 'medium' | 'high'
  settingsVersion: 3,
  invertY: false,
  difficulty: 'normal',
  bodycam: false, // 바디캠 렌즈 효과 (왜곡·노이즈·REC 표시) — 기본은 끔
  shake: 1, // 화면 흔들림 세기
  crosshair: 'cross', // 조준점: 'cross' 점+선 / 'dot' 점만 / 'off' 없음
  mapId: 'force-bound',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      // 예전 버전은 기본값 '높음'이 그대로 저장돼 있어 저사양 기기에서 느림 → 한 번 '자동'으로 바꿈
      if (!(s.settingsVersion >= 2)) s.quality = 'auto';
      // 발로란트식으로 바뀌며 바디캠 렌즈는 기본으로 끄고 조준점은 점+선으로 (한 번만)
      if (!(s.settingsVersion >= 3)) {
        s.bodycam = false;
        if (s.crosshair === 'dot') s.crosshair = 'cross';
      }
      s.settingsVersion = 3;
      return s;
    }
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
