import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GameMap } from '../sim/map.js';
import { DEFAULT_MAP_ID } from '../sim/maps/index.js';
import { createTextures } from './textures.js';
import { RainSystem } from './weather.js';
import { buildWorld } from './world-view.js';
import { LightRig } from './lights.js';

// 품질 단계. 점광원(points)은 개수만큼 모든 표면의 픽셀 계산이 늘어나므로 가장 크게 줄임.
// pixelRatio = 해상도 상한, minScale = 프레임이 모자랄 때 내려갈 수 있는 해상도 하한 (자동 조절)
export const QUALITY = {
  low: { name: '낮음', shadows: false, shadowSize: 0, bloom: false, env: false, pixelRatio: 1, minScale: 0.5, startScale: 0.8, points: 2, muzzles: 0, rain: 1800 },
  medium: { name: '보통', shadows: false, shadowSize: 0, bloom: false, env: true, pixelRatio: 1, minScale: 0.6, startScale: 1, points: 4, muzzles: 1, rain: 4000 },
  high: { name: '높음', shadows: true, shadowSize: 2048, bloom: true, env: true, pixelRatio: 1.5, minScale: 0.7, startScale: 1, points: 6, muzzles: 2, rain: 7000 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high'];

// 처음 실행할 때 기기에 맞는 품질 추정 (설정이 '자동'일 때)
export function detectQuality(renderer) {
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    /* 알 수 없음 */
  }
  const ua = navigator.userAgent || '';
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  if (/CrOS|Android|iPhone|iPad/i.test(ua) || /SwiftShader|llvmpipe|Mali|Adreno|PowerVR|Software/i.test(gpu) || cores <= 4 || mem <= 4) return 'low';
  if (/NVIDIA|GeForce|RTX|GTX|Radeon RX|Radeon Pro|Apple M\d (Pro|Max|Ultra)/i.test(gpu)) return 'high';
  return 'medium';
}

// 날씨별 하늘·안개·달빛
const WEATHER = {
  clear: { fog: ['#0b0e13', 16, 92], top: '#05070a', horizon: '#1a1d22', glow: '#3d2b1c', overcast: 0, moon: 0.6, hemi: 0.55 },
  rain: { fog: ['#0a0c0f', 9, 64], top: '#07080a', horizon: '#15181c', glow: '#2a241e', overcast: 1, moon: 0.32, hemi: 0.5 },
};

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform vec3 moonDir;
  uniform float overcast; uniform float bolt;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 col = mix(horizon, top, smoothstep(-0.02, 0.5, h));
    col += glow * pow(1.0 - clamp(abs(h) * 4.0, 0.0, 1.0), 3.0) * 0.6;
    float m = max(dot(normalize(vDir), normalize(moonDir)), 0.0);
    col += vec3(0.75, 0.8, 0.9) * (smoothstep(0.9993, 0.9997, m) * 0.9 + pow(m, 80.0) * 0.08) * (1.0 - overcast);
    // 비구름: 낮게 깔린 구름 결 + 번개 때 구름이 밝아짐
    float cloud = sin(vDir.x * 7.0 + vDir.z * 3.0) * sin(vDir.z * 5.0 - vDir.x * 2.0) * 0.5 + 0.5;
    col += vec3(0.05, 0.055, 0.06) * cloud * overcast * smoothstep(0.0, 0.4, h);
    col += vec3(0.55, 0.6, 0.75) * bolt * (0.4 + cloud * 0.6) * smoothstep(-0.05, 0.3, h);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// 바디캠 렌즈: 가장자리가 휘는 광각 왜곡 · 색 번짐 · 노이즈 · 비네팅 · 체력 비례 악화 · 섬광
export const BodycamShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    aspect: { value: 1.6 },
    distortion: { value: 0.16 },
    chroma: { value: 0.0025 },
    vignette: { value: 0.55 },
    grain: { value: 0.05 },
    damage: { value: 0 },
    pulse: { value: 0 },
    flash: { value: 0 },
    blur: { value: 0 },
    rain: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, aspect, distortion, chroma, vignette, grain, damage, pulse, flash, blur, rain;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    vec2 lens(vec2 uv) {
      vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
      float maxR2 = 0.25 * aspect * aspect + 0.25;
      float r2 = dot(c, c);
      c *= (1.0 + distortion * r2) / (1.0 + distortion * maxR2);
      return c / vec2(aspect, 1.0) + 0.5;
    }
    vec3 sampleCA(vec2 uv, float ca) {
      vec2 d = uv - 0.5;
      return vec3(
        texture2D(tDiffuse, uv + d * ca).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - d * ca).b
      );
    }
    // 렌즈에 맺힌 빗방울: 칸마다 하나씩 생겼다 사라지며 뒤쪽 화면을 굴절시킴
    vec2 raindrops(vec2 uv, out float rim) {
      rim = 0.0;
      vec2 p = uv * vec2(aspect, 1.0) * 7.0;
      vec2 id = floor(p);
      vec2 f = fract(p) - 0.5;
      float h = rand(id);
      float life = fract(time * (0.05 + h * 0.07) + h * 7.0);
      float alive = smoothstep(0.0, 0.06, life) * smoothstep(1.0, 0.75, life) * step(0.6, rand(id + 3.1));
      vec2 c = (vec2(rand(id + 1.7), rand(id + 5.3)) - 0.5) * 0.55;
      c.y += life * 0.3 * step(0.75, h);
      float r = 0.07 + 0.13 * rand(id + 9.1);
      vec2 dd = f - c;
      dd.y *= 1.15;
      float dist = length(dd);
      float m = smoothstep(r, r * 0.7, dist) * alive;
      rim = smoothstep(r * 0.55, r, dist) * m;
      return -dd / (7.0 * vec2(aspect, 1.0)) * m * 0.9;
    }
    void main() {
      vec2 uv = lens(vUv);
      float rim = 0.0;
      if (rain > 0.001) uv += raindrops(vUv, rim) * rain;
      vec2 d = uv - 0.5;
      float edge = dot(d, d);
      float ca = chroma * (0.4 + edge * 6.0) * (1.0 + damage * 3.0);
      vec3 col = sampleCA(uv, ca);
      // 큰 피해 직후 흐려짐
      if (blur > 0.001) {
        vec2 px = vec2(blur * 0.004);
        col = (col + sampleCA(uv + vec2(px.x, 0.0), ca) + sampleCA(uv - vec2(px.x, 0.0), ca) + sampleCA(uv + vec2(0.0, px.y), ca) + sampleCA(uv - vec2(0.0, px.y), ca)) / 5.0;
      }
      col *= 1.0 - rim * 0.35 * rain;
      // 체력이 낮을수록 색이 빠지고 붉게 어두워짐
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum), damage * 0.8);
      float r = length((vUv - 0.5) * vec2(aspect, 1.0));
      float v = smoothstep(0.95, 0.25, r);
      col *= mix(1.0 - vignette - damage * 0.35, 1.0, v);
      col = mix(col, col * vec3(1.15, 0.35, 0.3) + vec3(0.06, 0.0, 0.0), damage * (1.0 - v) * (0.55 + 0.45 * pulse));
      // 센서 노이즈
      float g = rand(vUv * vec2(1931.0, 1087.0) + fract(time * 17.0)) - 0.5;
      col += g * grain * (1.0 + damage * 1.5);
      // 섬광
      col = mix(col, vec3(1.0, 0.98, 0.94), clamp(flash, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
      // 색 변환을 이 패스에서 같이 처리 (전체 화면 패스 하나 절약)
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

// 렌더러 + 장면 + 맵. 타이틀 화면과 경기에서 같이 쓴다.
export class Stage {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.map = null;
    this.qualityKey = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0a0d12');
    this.scene.fog = new THREE.Fog('#0b0e13', 16, 92);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 900);
    this.camera.rotation.order = 'YXZ';

    const moonDir = new THREE.Vector3(0.35, 0.75, -0.55).normalize();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          top: { value: new THREE.Color('#05070a') },
          horizon: { value: new THREE.Color('#1a1d22') },
          glow: { value: new THREE.Color('#3d2b1c') },
          moonDir: { value: moonDir },
          overcast: { value: 0 },
          bolt: { value: 0 },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.sky = sky;
    this.scene.add(sky);

    this.hemi = new THREE.HemisphereLight('#2c3647', '#0d0b09', 0.55);
    this.scene.add(this.hemi);
    const moon = new THREE.DirectionalLight('#8fa6c8', 0.6);
    moon.position.copy(moonDir).multiplyScalar(80);
    moon.target.position.set(0, 0, 0);
    Object.assign(moon.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 10, far: 200 });
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.04;
    moon.shadow.radius = 3;
    this.moon = moon;
    this.scene.add(moon, moon.target);

    this.textures = createTextures();
    this.lightRig = new LightRig(this.scene);
    this.renderScale = 1;
    this.rain = null;
    this.bolt = 0;
    this.onThunder = null;
    this.setMap(DEFAULT_MAP_ID);

    this._overlay = null; // 1인칭 총 (ViewModel)
    this.time = 0;
    this.applyQuality(settings.quality);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  // 맵 교체 (맵마다 지형·조명·날씨가 다름)
  setMap(id) {
    if (this.map?.id === id && this.world) return;
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse((o) => {
        o.geometry?.dispose();
        for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
          if (m.map && !Object.values(this.textures).includes(m.map)) m.map.dispose();
          m.dispose();
        }
      });
    }
    this.map = new GameMap(id);
    this.world = buildWorld(this.map, this.textures);
    this.scene.add(this.world);
    this.lamps = this.world.userData.lamps;
    this.lightRig.clear((src) => src.lamp);
    for (const src of this.lamps.sources) this.lightRig.add(Object.assign(src, { lamp: true }));
    this.applyWeather();
    if (this.renderer) this.applyQuality(this.qualityMode);
  }

  applyWeather() {
    const w = WEATHER[this.map.weather] ?? WEATHER.clear;
    this.weather = w;
    this.scene.fog.color.set(w.fog[0]);
    this.scene.fog.near = w.fog[1];
    this.scene.fog.far = w.fog[2];
    this.scene.background.set(w.fog[0]);
    const u = this.sky.material.uniforms;
    u.top.value.set(w.top);
    u.horizon.value.set(w.horizon);
    u.glow.value.set(w.glow);
    u.overcast.value = w.overcast;
    this.moon.intensity = w.moon;
    this.hemi.intensity = w.hemi;
    if (this.rain) {
      this.scene.remove(this.rain.group);
      this.rain.dispose();
      this.rain = null;
    }
    if (this.map.weather === 'rain') {
      const q = QUALITY[this.qualityKey] ?? QUALITY.high;
      this.rain = new RainSystem({ count: q.rain, splashes: Math.round(q.rain / 7) });
      this.rain.onThunder = (delay, vol) => this.onThunder?.(delay, vol);
      this.scene.add(this.rain.group);
    }
  }

  // key: 'auto' | 'low' | 'medium' | 'high'. 자동이면 기기에 맞춰 고르고, 느리면 한 단계씩 내림
  applyQuality(key) {
    if (!this.renderer) this.createRenderer();
    this.qualityMode = key === 'auto' || key in QUALITY ? key : 'auto';
    let level = this.qualityMode;
    if (level === 'auto') level = this.autoLevel ??= detectQuality(this.renderer);
    this.setLevel(level);
  }

  createRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.2;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.className = 'game-canvas';
    r.domElement.tabIndex = 0;
    this.container.prepend(r.domElement);
    this.renderer = r;
    // 금속 표면이 비칠 환경 (없으면 금속이 새까맣게 보임). 낮음 품질에서는 끔
    const pmrem = new THREE.PMREMGenerator(r);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.12;
  }

  setLevel(level) {
    const q = QUALITY[level] ?? QUALITY.medium;
    const r = this.renderer;
    const changed = this.qualityKey !== level;
    this.qualityKey = level;
    this.quality = q;
    if (changed || this.renderScale > 1) this.renderScale = q.startScale;
    this.scene.environment = q.env ? this.envMap : null;
    // 그림자: 높음에서만, 움직이지 않는 지형만 한 번 그려 둠 (요원은 그림자 패스에서 제외)
    r.shadowMap.enabled = q.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;
    this.moon.castShadow = q.shadows;
    if (q.shadows) {
      this.moon.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
    this.lightRig.setBudget(q.points, q.muzzles);
    // 블룸이 없을 때는 등 렌즈에 가벼운 후광을 붙임
    if (this.lamps?.halos) this.lamps.halos.visible = !q.bloom;
    if (this.rain && this.rain.count !== q.rain) this.applyWeather();
    this.scene.traverse((o) => {
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
    this.buildComposer(q);
    this.resize();
  }

  // 해상도 배율 (프레임이 모자라면 낮추고 여유 있으면 올림) — Game.watchPerformance가 조절
  setRenderScale(scale) {
    const q = this.quality ?? QUALITY.medium;
    const s = Math.max(q.minScale, Math.min(1, scale));
    if (Math.abs(s - this.renderScale) < 0.01) return false;
    this.renderScale = s;
    this.applyPixelRatio();
    return true;
  }

  applyPixelRatio() {
    const q = this.quality ?? QUALITY.medium;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio) * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.composer?.setPixelRatio(pr);
    this.updateFov();
  }

  // 화면 처리 순서: 맵 → 1인칭 총 → 빛번짐 → 바디캠 렌즈 → 색 변환
  buildComposer(q) {
    this.composer?.dispose?.();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio) * this.renderScale);
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.overlayPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.overlayPass.clear = false;
    this.overlayPass.clearDepth = true;
    this.overlayPass.enabled = false;
    c.addPass(this.overlayPass);
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
      c.addPass(this.bloom);
    }
    this.bloom = q.bloom ? this.bloom : null;
    this.bodycam = new ShaderPass(BodycamShader);
    c.addPass(this.bodycam);
    this.composer = c;
    if (this._overlay) this.overlay = this._overlay;
  }

  get canvas() {
    return this.renderer.domElement;
  }

  get overlay() {
    return this._overlay;
  }

  set overlay(vm) {
    this._overlay = vm;
    if (!this.overlayPass) return;
    if (vm) {
      vm.scene.environment = this.envMap;
      vm.scene.environmentIntensity = 0.2;
      this.overlayPass.scene = vm.scene;
      this.overlayPass.camera = vm.camera;
      this.overlayPass.enabled = true;
    } else {
      this.overlayPass.enabled = false;
    }
  }

  setFov(horizontalDeg) {
    this.hfov = horizontalDeg;
    this.resize();
  }

  // 정조준 확대 (1 = 기본)
  setZoom(zoom) {
    if (Math.abs((this.zoom ?? 1) - zoom) < 1e-3) return;
    this.zoom = zoom;
    this.updateFov();
  }

  updateFov() {
    const aspect = this.camera.aspect;
    const hfov = THREE.MathUtils.degToRad(this.hfov ?? this.settings.fov ?? 100);
    const v = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(v / 2) / (this.zoom ?? 1)));
    this.camera.updateProjectionMatrix();
    // 물방울 크기 계산용: 1m 거리의 1m가 화면에서 차지하는 픽셀 수
    if (this.renderer) {
      const h = this.renderer.domElement.height;
      this.rain?.setPixelScale(h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)));
    }
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.updateFov();
    this.bodycam.uniforms.aspect.value = aspect;
    this._overlay?.setAspect(aspect);

  }

  // 바디캠 효과 세기 (설정에서 끌 수 있음)
  setLens({ damage = 0, pulse = 0, flash = 0, blur = 0 } = {}) {
    const u = this.bodycam.uniforms;
    const on = this.settings.bodycam !== false;
    u.distortion.value = on ? 0.16 : 0;
    u.chroma.value = on ? 0.0025 : 0;
    u.grain.value = on ? 0.03 : 0.01;
    u.vignette.value = on ? 0.55 : 0.3;
    u.damage.value = damage;
    u.pulse.value = pulse;
    u.flash.value = flash;
    u.blur.value = blur;
    u.rain.value = on && this.map?.weather === 'rain' ? 1 : 0;
  }

  render(dt = 0.016) {
    this.time += dt;
    this.bodycam.uniforms.time.value = this.time;
    this.sky.position.copy(this.camera.position);
    // 비와 번개: 번개가 치면 하늘과 주변이 잠깐 밝아짐
    const w = this.weather ?? WEATHER.clear;
    if (this.rain) {
      this.bolt = this.rain.update(dt, this.camera);
      this.sky.material.uniforms.bolt.value = this.bolt;
      this.hemi.intensity = w.hemi + this.bolt * 2.2 + (this.quality?.env ? 0 : 0.3);
      this.moon.intensity = w.moon + this.bolt * 1.6;
    } else this.hemi.intensity = w.hemi + (this.quality?.env ? 0 : 0.3);
    // 가까운 등에만 실제 광원 배정, 나머지는 빛 웅덩이로
    this.lightRig.update(dt, this.camera.position);
    this.lamps?.syncPools();
    this.composer.render(dt);
  }

  // 타이틀 화면: 맵 위를 천천히 도는 카메라
  orbit(t) {
    const R = 44;
    const a = t * 0.05 + 0.8;
    this.camera.position.set(Math.cos(a) * R, 22 + Math.sin(t * 0.2) * 2, Math.sin(a) * R);
    this.camera.lookAt(0, 0, 0);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
