import * as THREE from 'three';

// 사진 텍스처 (CC0 · src/assets/tex/ 에 넣으면 빌드 때 한 파일 안에 함께 묶임)
//   파일 이름 = 열쇠: 예) concrete_wall_color.jpg, concrete_wall_normal.jpg, concrete_wall_rough.jpg
//   부팅 때 한 번 미리 디코드해 두고(loadPhotos), 텍스처를 만들 때 있으면 사진, 없으면 기존 절차 텍스처를 씀.
//   출처·라이선스는 src/assets/tex/CREDITS.md 에 적음.
const FILES = import.meta.glob('../assets/tex/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' });
const URLS = Object.fromEntries(Object.entries(FILES).map(([path, url]) => [path.split('/').pop().replace(/\.\w+$/, ''), url]));
const IMGS = new Map();
let loading = null;

export function loadPhotos() {
  loading ??= Promise.all(
    Object.entries(URLS).map(
      ([key, url]) =>
        new Promise((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => {
            IMGS.set(key, img);
            resolve();
          };
          img.onerror = () => resolve(); // 한 장이 깨져도 나머지는 계속 (그 자리는 절차 텍스처)
          img.src = url;
        }),
    ),
  );
  return loading;
}

export const hasPhoto = (key) => IMGS.has(key);
export const photoImage = (key) => IMGS.get(key) ?? null;

// 사진 → 텍스처 (반복). color = true면 sRGB(색), 아니면 데이터(노멀·거칠기)
export function photoTexture(key, { color = true, repeat = null, anisotropy = 8 } = {}) {
  const img = IMGS.get(key);
  if (!img) return null;
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true;
  return t;
}

// 사진 위에 글씨·표시를 덧그릴 캔버스 (컨테이너 글씨, 상자 표기 등). 없으면 null
export function photoCanvas(key, w, h) {
  const img = IMGS.get(key);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y += img.height) for (let x = 0; x < w; x += img.width) g.drawImage(img, x, y);
  return c;
}
