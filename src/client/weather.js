import * as THREE from 'three';

// 비: 카메라 주변 상자 안에서 빗줄기·물 튀김을 셰이더로 움직임 (CPU는 시간만 넘김)
const RAIN_VERT = /* glsl */ `
  uniform float uTime, uSize, uHeight, uSpeed, uLen;
  uniform vec3 uCenter;
  uniform vec2 uWind;
  attribute vec4 aSeed; // x, z (0~1), 높이 위상, 굵기
  attribute float aEnd; // 0 = 위 끝, 1 = 아래 끝
  varying float vAlpha;
  void main() {
    float h = mod(aSeed.z * uHeight - uTime * uSpeed, uHeight);
    vec2 base = aSeed.xy * uSize + uWind * uTime;
    vec2 lo = uCenter.xz - uSize * 0.5;
    vec2 xz = lo + mod(base - lo, uSize);
    vec3 p = vec3(xz.x, h, xz.y);
    vec3 v = normalize(vec3(uWind.x, -uSpeed, uWind.y));
    p += v * uLen * aEnd;
    float d = length(xz - uCenter.xz);
    vAlpha = (0.16 + aSeed.w * 0.2) * smoothstep(uSize * 0.5, uSize * 0.12, d) * smoothstep(0.0, 0.6, h);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const RAIN_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFlash;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor * (1.0 + uFlash * 4.0), vAlpha);
  }
`;

const SPLASH_VERT = /* glsl */ `
  uniform float uTime, uSize, uPixel;
  uniform vec3 uCenter;
  attribute vec3 aSeed; // 위상, 주기, 난수
  varying float vLife;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float t = uTime / aSeed.y + aSeed.x;
    float cycle = floor(t);
    vLife = fract(t);
    float k = cycle * 13.17 + aSeed.z * 91.7;
    vec2 xz = uCenter.xz + (vec2(hash(k), hash(k + 7.3)) - 0.5) * uSize;
    vec4 mv = viewMatrix * vec4(xz.x, 0.05, xz.y, 1.0);
    gl_Position = projectionMatrix * mv;
    // 지름 3~10cm 정도로 퍼지는 물방울 (uPixel = 1m가 1m 거리에서 차지하는 픽셀)
    gl_PointSize = uPixel * (0.03 + vLife * 0.07) / -mv.z;
  }
`;
const SPLASH_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    c.y *= 2.6; // 바닥에 누운 고리처럼 납작하게
    float r = length(c) * 2.0;
    float ring = smoothstep(0.5, 0.78, r) * smoothstep(1.0, 0.86, r);
    float a = ring * (1.0 - vLife) * (1.0 - vLife) * 0.35;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class RainSystem {
  constructor({ count = 6000, splashes = 900 } = {}) {
    this.count = count;
    this.group = new THREE.Group();
    this.group.name = 'rain';
    this.time = 0;
    this.size = 34;

    // 빗줄기: 선분(위·아래 두 점)
    const seeds = new Float32Array(count * 2 * 4);
    const ends = new Float32Array(count * 2);
    const pos = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 2; k++) {
        seeds.set(s, (i * 2 + k) * 4);
        ends[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: this.size },
        uHeight: { value: 16 },
        uSpeed: { value: 17 },
        uLen: { value: 0.55 },
        uCenter: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector2(1.6, 0.7) },
        uColor: { value: new THREE.Color('#8e9cab') },
        uFlash: { value: 0 },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rain = new THREE.LineSegments(geo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    this.group.add(this.rain);

    // 바닥에 튀는 물방울 (짧게 퍼지는 고리)
    const sp = new Float32Array(splashes * 3);
    for (let i = 0; i < splashes; i++) sp.set([Math.random(), 0.35 + Math.random() * 0.45, Math.random()], i * 3);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(splashes * 3), 3));
    sgeo.setAttribute('aSeed', new THREE.BufferAttribute(sp, 3));
    this.splashMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 22 },
        uPixel: { value: 600 },
        uCenter: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color('#9fb0c2') },
      },
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.splash = new THREE.Points(sgeo, this.splashMat);
    this.splash.frustumCulled = false;
    this.group.add(this.splash);

    // 번개
    this.flash = 0;
    this.nextBolt = 14 + Math.random() * 20;
    this.onThunder = null;
  }

  setPixelScale(heightPx) {
    this.splashMat.uniforms.uPixel.value = heightPx;
  }

  // 반환: 번개 밝기(0~1)
  update(dt, camera) {
    this.time += dt;
    const u = this.rainMat.uniforms;
    u.uTime.value = this.time;
    u.uCenter.value.copy(camera.position);
    this.splashMat.uniforms.uTime.value = this.time;
    this.splashMat.uniforms.uCenter.value.copy(camera.position);
    // 번개: 두세 번 깜빡이고, 몇 초 뒤 천둥
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.nextBolt = 22 + Math.random() * 35;
      this.bolt = { t: 0, pattern: [0, 0.07, 0.16, 0.3].slice(0, 2 + Math.floor(Math.random() * 3)) };
      this.onThunder?.(1.2 + Math.random() * 3.5, 0.5 + Math.random() * 0.5);
    }
    let f = 0;
    if (this.bolt) {
      this.bolt.t += dt;
      for (const s of this.bolt.pattern) {
        const k = this.bolt.t - s;
        if (k >= 0 && k < 0.09) f = Math.max(f, 1 - k / 0.09);
      }
      if (this.bolt.t > 0.6) this.bolt = null;
    }
    this.flash = f;
    u.uFlash.value = f;
    return f;
  }

  dispose() {
    this.rain.geometry.dispose();
    this.rainMat.dispose();
    this.splash.geometry.dispose();
    this.splashMat.dispose();
  }
}

// 바닥의 물웅덩이 (얼룩 모양 알파) — 낮은 거칠기라 등불이 길게 반사됨
export function puddleTexture(seed = 11) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S;
    const r = 14 + rnd() * 46;
    for (let k = 0; k < 5; k++) {
      const gr = g.createRadialGradient(x + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r, 0, x, y, r * (0.6 + rnd() * 0.7));
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.7, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, r * (0.8 + rnd()), r * (0.5 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
