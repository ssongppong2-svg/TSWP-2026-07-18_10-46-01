// 블랙홀 화면: 검은 구(사건의 지평선) + 빛나는 강착 원반(기울어진 원반 + 늘 나를 보는 빛 고리) + 빨려 드는 빛 알갱이
//   + 터지는 순간 퍼지는 충격파 + 보랏빛 광원. 렌즈 왜곡(뒤쪽 풍경이 휘어 보임)은 바디캠 패스에서 화면 위치·크기를 받아 처리
import * as THREE from 'three';
import { BLACKHOLE, holeRadius } from '../sim/blackhole.js';

const DISK_VERT = /* glsl */ `
  varying vec2 vP;
  void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// 원반: 안쪽은 흰빛·바깥은 주황→보라, 소용돌이 띠가 안쪽일수록 빨리 돎 · 다가오는 쪽이 더 밝음(도플러)
const DISK_FRAG = /* glsl */ `
  uniform float uTime, uIn, uOut, uGain, uSpin;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float t = clamp((r - uIn) / (uOut - uIn), 0.0, 1.0);
    float a = atan(vP.y, vP.x);
    float sw = a * 1.0 + uTime * uSpin / max(r * r, 0.4) + log(r) * 5.0;
    float bands = 0.55 + 0.45 * sin(sw * 6.0) * (0.6 + 0.4 * sin(sw * 2.0 + r * 4.0));
    vec3 hot = vec3(1.0, 0.94, 0.86), mid = vec3(1.0, 0.52, 0.16), cool = vec3(0.52, 0.22, 1.0);
    vec3 col = mix(hot, mid, smoothstep(0.0, 0.45, t));
    col = mix(col, cool, smoothstep(0.4, 1.0, t));
    float edge = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.62, 1.0, t));
    float beam = 0.55 + 0.45 * cos(a - 1.1);
    gl_FragColor = vec4(col * edge * bands * beam * uGain, 1.0);
  }
`;

function diskMaterial(inner, outer, gain, spin) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIn: { value: inner }, uOut: { value: outer }, uGain: { value: gain }, uSpin: { value: spin } },
    vertexShader: DISK_VERT,
    fragmentShader: DISK_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

const N_DUST = 420;

// 둥근 빛 알갱이 (가운데 밝고 가장자리 흐림)
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BlackHoleView {
  // stage: 블랙홀은 stage.holeScene(맵 위에 따로 그리는 장면)에 놓음
  constructor(stage, lights) {
    this.stage = stage;
    this.lights = lights;
    this.group = new THREE.Group();
    this.group.name = 'blackholes';
    stage.holeScene ??= new THREE.Scene();
    stage.holeScene.add(this.group);
    this.items = []; // { hole, root, core, disk, halo, dust, shock, light }
    this.coreGeo = new THREE.SphereGeometry(1, 48, 32);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.diskGeo = new THREE.RingGeometry(1.25, 3.8, 160, 1);
    this.haloGeo = new THREE.RingGeometry(0.98, 1.7, 160, 1);
    this.shockGeo = new THREE.SphereGeometry(1, 32, 20);
    this.dot = dotTexture();
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.screen = []; // 렌즈 왜곡용 화면 정보 (최대 2개)
  }

  // 화면에 그릴 블랙홀 목록을 맞춤 (새로 생기면 만들고, 사라지면 지움)
  sync(holes) {
    for (const it of this.items) if (!holes.includes(it.hole)) this.drop(it);
    this.items = this.items.filter((it) => holes.includes(it.hole));
    for (const h of holes) if (!this.items.some((it) => it.hole === h)) this.items.push(this.make(h));
    if (this.stage.holePass) this.stage.holePass.enabled = this.items.length > 0;
  }

  make(h) {
    const root = new THREE.Group();
    root.position.set(h.x, h.y, h.z);
    const core = new THREE.Mesh(this.coreGeo, this.coreMat);
    core.renderOrder = 2;
    const disk = new THREE.Mesh(this.diskGeo, diskMaterial(1.25, 3.8, 2.4, 2.6));
    disk.rotation.set(-Math.PI / 2 + 0.3, 0, 0.12);
    disk.renderOrder = 3;
    const halo = new THREE.Mesh(this.haloGeo, diskMaterial(0.98, 1.7, 1.6, -1.8));
    halo.renderOrder = 3;
    // 빨려 드는 빛 알갱이: 원반 면을 따라 소용돌이치며 안으로
    const pos = new Float32Array(N_DUST * 3);
    const col = new Float32Array(N_DUST * 3);
    const seeds = new Float32Array(N_DUST * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N_DUST; i++) {
      seeds[i * 3] = Math.random() * Math.PI * 2;
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = 0.6 + Math.random() * 0.8;
      c.setHSL(0.72 + Math.random() * 0.2, 0.9, 0.55 + Math.random() * 0.3);
      if (Math.random() < 0.35) c.setHSL(0.08, 1, 0.65);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const dust = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.32, map: this.dot, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    dust.frustumCulled = false;
    dust.userData.seeds = seeds;
    dust.rotation.copy(disk.rotation);
    // 터지는 순간 퍼지는 충격파 (안쪽에서 보이는 보랏빛 껍질)
    const shock = new THREE.Mesh(this.shockGeo, new THREE.MeshBasicMaterial({ color: 0xb98cff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    root.add(core, disk, halo, dust, shock);
    this.group.add(root);
    const light = this.lights?.add({ pos: new THREE.Vector3(h.x, h.y, h.z), color: new THREE.Color('#9b6bff'), intensity: 900, distance: 90, priority: 6 });
    return { hole: h, root, core, disk, halo, dust, shock, light };
  }

  drop(it) {
    this.group.remove(it.root);
    it.disk.material.dispose();
    it.halo.material.dispose();
    it.dust.geometry.dispose();
    it.dust.material.dispose();
    it.shock.material.dispose();
    if (it.light) this.lights?.remove(it.light);
  }

  // now: 경기 시간 (블랙홀 나이 계산) · camera: 빛 고리를 나에게 돌리고 화면 위치를 구함
  update(now, camera, time) {
    this.screen = [];
    for (const it of this.items) {
      const h = it.hole;
      const age = now - h.t0;
      const R = Math.max(0.001, holeRadius(h, now));
      const k = Math.min(1, age / BLACKHOLE.grow);
      it.core.scale.setScalar(R);
      it.disk.scale.setScalar(R * (0.6 + 0.4 * k));
      it.halo.scale.setScalar(R);
      it.halo.quaternion.copy(camera.quaternion);
      for (const m of [it.disk.material, it.halo.material]) {
        m.uniforms.uTime.value = time;
        m.uniforms.uGain.value = (m === it.disk.material ? 2.4 : 1.6) * Math.min(1, age * 1.5);
      }
      // 빨려 드는 빛 알갱이: 바깥(원반 9배)에서 안쪽으로, 가까울수록 빨리 돎
      const p = it.dust.geometry.attributes.position.array;
      const s = it.dust.userData.seeds;
      for (let i = 0; i < N_DUST; i++) {
        const f = (s[i * 3 + 1] + time * 0.22 * s[i * 3 + 2]) % 1;
        const r = R * (1.15 + (1 - f) * (1 - f) * 7.5);
        const ang = s[i * 3] + time * 5 / Math.max(0.6, r / R);
        const y = Math.sin(s[i * 3] * 7 + time) * R * 0.08 * (r / R);
        p[i * 3] = Math.cos(ang) * r;
        p[i * 3 + 1] = Math.sin(ang) * r;
        p[i * 3 + 2] = y;
      }
      it.dust.geometry.attributes.position.needsUpdate = true;
      it.dust.material.size = 0.3 + R * 0.05;
      it.dust.visible = age > 0.3;
      // 충격파: 0.9초 동안 45 m까지 퍼지며 사라짐
      const sk = Math.min(1, age / 0.9);
      it.shock.visible = sk < 1;
      it.shock.scale.setScalar(1 + sk * 45);
      it.shock.material.opacity = 0.55 * (1 - sk) * (1 - sk);
      if (it.light) it.light.intensity = 700 + 400 * Math.sin(time * 6) * 0.3 + 600 * Math.max(0, 1 - age);
      // 렌즈 왜곡용: 화면 위치(0~1)와 화면에서의 반지름 (가로세로 비 보정 단위)
      const c = this.tmp.set(h.x, h.y, h.z).project(camera);
      const camDir = this.tmp2.set(h.x, h.y, h.z).sub(camera.position);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      if (camDir.dot(fwd) <= 0.5) continue;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const e = new THREE.Vector3(h.x, h.y, h.z).addScaledVector(right, R).project(camera);
      const aspect = camera.aspect;
      const rs = Math.abs(e.x - c.x) * 0.5 * aspect;
      this.screen.push({ x: c.x * 0.5 + 0.5, y: c.y * 0.5 + 0.5, r: rs, k: Math.min(1, age / BLACKHOLE.grow) });
    }
  }

  clear() {
    for (const it of this.items) this.drop(it);
    this.items = [];
    this.screen = [];
  }
}
