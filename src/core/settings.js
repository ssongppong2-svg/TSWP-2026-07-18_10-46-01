// 설정은 이 브라우저에만 저장된다. 저장이 막힌 환경(시크릿 창 등)에서도 기본값으로 동작.
const KEY = 'forcebound.settings.v1';

export const DEFAULT_SETTINGS = {
  name: '나',
  sensitivity: 1,
  fov: 100,
  volume: 0.8,
  quality: 'auto', // 'auto'(기기에 맞춰 자동) | 'low' | 'medium' | 'high'
  settingsVersion: 4,
  invertY: false,
  difficulty: 'normal',
  bodycam: true, // 바디캠 렌즈 (가장자리 왜곡·필름 노이즈·테두리 눈금) — 기본은 켬 (약하게)
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
      // 예전 버전의 점 조준점은 점+선으로 (한 번만)
      if (!(s.settingsVersion >= 3) && s.crosshair === 'dot') s.crosshair = 'cross';
      // 연구소 요원 바디캠 톤으로 바뀌며 렌즈를 약하게 다듬고 기본으로 켬 (한 번만, 이후 끄면 그대로)
      if (!(s.settingsVersion >= 4)) s.bodycam = true;
      s.settingsVersion = 4;
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
