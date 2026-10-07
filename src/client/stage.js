import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GameMap } from '../sim/map.js';
import { createTextures } from './textures.js';
import { buildWorld } from './world-view.js';

export const QUALITY = {
  low: { name: '낮음', shadows: false, shadowSize: 0, bloom: false, pixelRatio: 0.85, lamps: 6 },
  medium: { name: '보통', shadows: true, shadowSize: 1024, bloom: true, pixelRatio: 1, lamps: 11 },
  high: { name: '높음', shadows: true, shadowSize: 2048, bloom: true, pixelRatio: 1.5, lamps: 99 },
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
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 col = mix(horizon, top, smoothstep(-0.02, 0.5, h));
    col += glow * pow(1.0 - clamp(abs(h) * 4.0, 0.0, 1.0), 3.0) * 0.6;
    float m = max(dot(normalize(vDir), normalize(moonDir)), 0.0);
    col += vec3(0.75, 0.8, 0.9) * (smoothstep(0.9993, 0.9997, m) * 0.9 + pow(m, 80.0) * 0.08);
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
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, aspect, distortion, chroma, vignette, grain, damage, pulse, flash, blur;
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
    void main() {
      vec2 uv = lens(vUv);
      vec2 d = uv - 0.5;
      float edge = dot(d, d);
      float ca = chroma * (0.4 + edge * 6.0) * (1.0 + damage * 3.0);
      vec3 col = sampleCA(uv, ca);
      // 큰 피해 직후 흐려짐
      if (blur > 0.001) {
        vec2 px = vec2(blur * 0.004);
        col = (col + sampleCA(uv + vec2(px.x, 0.0), ca) + sampleCA(uv - vec2(px.x, 0.0), ca) + sampleCA(uv + vec2(0.0, px.y), ca) + sampleCA(uv - vec2(0.0, px.y), ca)) / 5.0;
      }
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
    }
  `,
};

// 렌더러 + 장면 + 맵. 타이틀 화면과 경기에서 같이 쓴다.
export class Stage {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.map = new GameMap();
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

    this.scene.add(new THREE.HemisphereLight('#2c3647', '#0d0b09', 0.55));
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
    this.world = buildWorld(this.map, this.textures);
    this.scene.add(this.world);
    this.lamps = this.world.userData.lamps;

    this._overlay = null; // 1인칭 총 (ViewModel)
    this.time = 0;
    this.applyQuality(settings.quality);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  applyQuality(key) {
    const q = QUALITY[key] ?? QUALITY.high;
    if (!this.renderer) {
      const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.2;
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.domElement.className = 'game-canvas';
      r.domElement.tabIndex = 0;
      this.container.prepend(r.domElement);
      this.renderer = r;
      // 금속 표면이 비칠 환경 (없으면 금속이 새까맣게 보임)
      const pmrem = new THREE.PMREMGenerator(r);
      this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      this.scene.environment = this.envMap;
      this.scene.environmentIntensity = 0.12;
    }
    const r = this.renderer;
    this.qualityKey = key in QUALITY ? key : 'high';
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    r.shadowMap.enabled = q.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.moon.castShadow = q.shadows;
    if (q.shadows) {
      this.moon.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
    this.lamps.forEach((l, i) => (l.visible = i < q.lamps));
    this.scene.traverse((o) => {
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
    this.buildComposer(q);
    this.resize();
  }

  // 화면 처리 순서: 맵 → 1인칭 총 → 빛번짐 → 바디캠 렌즈 → 색 변환
  buildComposer(q) {
    this.composer?.dispose?.();
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
    this.bodycam = new ShaderPass(BodycamShader);
    c.addPass(this.bodycam);
    c.addPass(new OutputPass());
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
  }

  render(dt = 0.016) {
    this.time += dt;
    this.bodycam.uniforms.time.value = this.time;
    this.sky.position.copy(this.camera.position);
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
