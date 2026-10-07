import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GameMap } from '../sim/map.js';
import { createTextures } from './textures.js';
import { buildWorld } from './world-view.js';

export const QUALITY = {
  low: { name: '낮음', shadows: false, shadowSize: 0, bloom: false, pixelRatio: 0.85, antialias: false },
  medium: { name: '보통', shadows: true, shadowSize: 1024, bloom: false, pixelRatio: 1, antialias: true },
  high: { name: '높음', shadows: true, shadowSize: 2048, bloom: true, pixelRatio: 1.5, antialias: true },
};

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
    col = mix(col, top, smoothstep(0.25, 0.85, h));
    col = mix(col, horizon * 0.55, smoothstep(0.0, -0.2, h));
    float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
    col += sunColor * (pow(s, 600.0) * 6.0 + pow(s, 12.0) * 0.45);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// 렌더러 + 장면 + 맵. 타이틀 화면과 경기에서 같이 씁니다.
export class Stage {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.map = new GameMap();
    this.qualityKey = null;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#a99fb4', 70, 210);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 900);
    this.camera.rotation.order = 'YXZ';

    const sunDir = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          top: { value: new THREE.Color('#16203d') },
          mid: { value: new THREE.Color('#5d6fa8') },
          horizon: { value: new THREE.Color('#f0a982') },
          sunDir: { value: sunDir },
          sunColor: { value: new THREE.Color('#ffd7a8') },
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

    this.scene.add(new THREE.HemisphereLight('#a9c6ff', '#4a3a2c', 1.25));
    const sun = new THREE.DirectionalLight('#ffd9b0', 2.8);
    sun.position.copy(sunDir).multiplyScalar(80);
    sun.target.position.set(0, 0, 0);
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    this.textures = createTextures();
    this.world = buildWorld(this.map, this.textures);
    this.scene.add(this.world);

    this.overlay = null; // 1인칭 총 (ViewModel)
    this.shake = 0;
    this.applyQuality(settings.quality);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  applyQuality(key) {
    const q = QUALITY[key] ?? QUALITY.high;
    const needNewRenderer = !this.renderer || this.qualityKey === null || QUALITY[this.qualityKey].antialias !== q.antialias;
    if (needNewRenderer) {
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer.domElement.remove();
      }
      const r = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance' });
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.domElement.className = 'game-canvas';
      r.domElement.tabIndex = 0;
      this.container.prepend(r.domElement);
      this.renderer = r;
      this.onCanvas?.(r.domElement);
    }
    const r = this.renderer;
    this.qualityKey = key in QUALITY ? key : 'high';
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    r.shadowMap.enabled = q.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.needsUpdate = true;
      }
    });
    this.composer?.dispose?.();
    this.composer = null;
    if (q.bloom) {
      const c = new EffectComposer(r);
      c.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.55, 0.88);
      c.addPass(this.bloom);
      c.addPass(new OutputPass());
      this.composer = c;
    }
    this.resize();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  setFov(horizontalDeg) {
    this.hfov = horizontalDeg;
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const hfov = THREE.MathUtils.degToRad(this.hfov ?? this.settings.fov ?? 100);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect));
    this.camera.updateProjectionMatrix();
    this.overlay?.setAspect(aspect);
  }

  render() {
    const r = this.renderer;
    this.sky.position.copy(this.camera.position);
    if (this.composer) this.composer.render();
    else {
      r.autoClear = true;
      r.render(this.scene, this.camera);
    }
    if (this.overlay) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.overlay.scene, this.overlay.camera);
      r.autoClear = true;
    }
  }

  // 타이틀 화면: 맵 위를 천천히 도는 카메라
  orbit(t) {
    const R = 46;
    const a = t * 0.06 + 0.8;
    this.camera.position.set(Math.cos(a) * R, 26 + Math.sin(t * 0.2) * 3, Math.sin(a) * R);
    this.camera.lookAt(0, 0, 0);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
