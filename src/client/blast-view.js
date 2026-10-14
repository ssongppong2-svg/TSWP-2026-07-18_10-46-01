// 폭발 연출 (세열 수류탄 · C4)
//   0.00초 섬광 + 불덩이(안쪽이 하얗게 타고 바깥이 주황→보랏빛으로 식으며 갈라져 사라짐)
//   0.00~0.3초 충격파: 공기가 밀려나는 투명한 껍질 + 바닥을 쓸고 가는 고리·먼지 치마 + 화면이 일렁임
//   0~3초 파편: 빛나게 달궈진 조각이 튀어 올라 벽에 튕기고 바닥에 떨어지며 식음 (불티 꼬리)
//   ~30초 그을음 자국 (처음 몇 초는 불씨가 남음) · 피어오르는 연기
import * as THREE from 'three';
import { smokeTexture } from './textures.js';

const NOISE = /* glsl */ `
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { return vn(p) * 0.55 + vn(p * 2.1 + 3.7) * 0.3 + vn(p * 4.3 + 7.1) * 0.15; }
`;

// 불덩이: 잡음으로 울퉁불퉁 부풀고(위로 끓어오름), 시간이 지나면 식으며 갈라져 타 없어짐
const FIRE_VERT = /* glsl */ `
  uniform float uAge, uSeed;
  varying vec3 vN, vV, vO;
  varying float vD;
  ${NOISE}
  void main() {
    vec3 p = position;
    vO = position;
    float n = fbm(p * 1.9 + vec3(uSeed, uSeed * 0.7 - uAge * 2.6, uSeed * 1.3));
    vD = n;
    p *= 0.78 + n * 0.62;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const FIRE_FRAG = /* glsl */ `
  uniform float uAge, uLife, uGain, uSeed;
  uniform vec3 uTint;
  varying vec3 vN, vV, vO;
  varying float vD;
  ${NOISE}
  void main() {
    float t = clamp(uAge / uLife, 0.0, 1.0);
    float facing = abs(dot(normalize(vN), normalize(vV)));
    // 잔무늬: 픽셀마다 잡음 (가장자리가 솜털처럼 흩어짐)
    float d = vD * 0.55 + fbm(vO * 5.0 + vec3(uSeed, -uAge * 3.2, uSeed * 0.5)) * 0.45;
    // 온도: 가운데(정면)·처음일수록 뜨거움
    float heat = clamp((1.05 - t * 1.35) * (0.35 + facing * 0.85) + (d - 0.5) * 0.8, 0.0, 1.0);
    vec3 col = mix(vec3(0.5, 0.07, 0.01), vec3(1.0, 0.36, 0.04), smoothstep(0.08, 0.5, heat));
    col = mix(col, vec3(1.0, 0.78, 0.42), smoothstep(0.55, 0.85, heat));
    col = mix(col, vec3(1.0, 0.97, 0.88), smoothstep(0.9, 1.0, heat));
    col = mix(col, uTint, 0.2 * smoothstep(0.35, 0.9, t) * (1.0 - heat)); // 식으며 보랏빛 플라스마
    // 갈라짐: 시간이 갈수록 잡음이 낮은 곳부터 타 없어짐 · 윤곽은 부드럽게
    float keep = smoothstep(t * 1.05 - 0.05, t * 1.05 + 0.18, d + facing * 0.25);
    float a = keep * (1.0 - smoothstep(0.75, 1.0, t)) * smoothstep(0.02, 0.4, facing);
    // 미리 곱한 알파: 밝은 배경 위에서도 하얗게 날아가지 않고 불길 제 색으로 가림 (뜨거운 곳은 더 빛남)
    gl_FragColor = vec4(col * uGain * (0.5 + heat * 1.2) * a, a * (0.55 + 0.3 * (1.0 - heat)));
  }
`;

// 불길을 감싸는 검은 연기 덩어리: 처음엔 안쪽 불빛에 주황으로 물들고, 식으며 짙은 연기로 남음
const SMOKE_FRAG = /* glsl */ `
  uniform float uAge, uLife, uSeed;
  varying vec3 vN, vV, vO;
  varying float vD;
  ${NOISE}
  void main() {
    float t = clamp(uAge / uLife, 0.0, 1.0);
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float d = vD * 0.5 + fbm(vO * 3.6 + vec3(uSeed, -uAge * 1.4, 0.0)) * 0.5;
    float lit = (1.0 - smoothstep(0.0, 0.45, t)) * smoothstep(0.35, 0.85, d);
    vec3 col = mix(vec3(0.085, 0.078, 0.088), vec3(0.85, 0.36, 0.08), lit * 0.75);
    // 시간이 갈수록 옅은 곳부터 갈라져 가닥으로 흩어짐 · 윤곽은 부드럽게
    float keep = smoothstep(0.28 + t * 0.6, 0.5 + t * 0.6, d + facing * 0.3);
    float a = keep * smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.5, 1.0, t)) * smoothstep(0.05, 0.5, facing) * 0.88;
    gl_FragColor = vec4(col, a);
  }
`;

// 충격파 껍질: 가장자리만 희미하게 빛나는 공기의 벽
const SHELL_VERT = /* glsl */ `
  varying vec3 vN, vV;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const SHELL_FRAG = /* glsl */ `
  uniform float uK;
  uniform vec3 uColor;
  varying vec3 vN, vV;
  void main() {
    float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    gl_FragColor = vec4(uColor * pow(rim, 4.0) * uK, 1.0);
  }
`;

// 바닥을 쓸고 가는 고리 (바깥 가장자리가 밝고 안쪽으로 흐려짐)
const RING_VERT = /* glsl */ `
  varying vec2 vP;
  void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RING_FRAG = /* glsl */ `
  uniform float uK;
  uniform vec3 uColor;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float a = smoothstep(0.78, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
    gl_FragColor = vec4(uColor * a * uK, 1.0);
  }
`;

const add = (opts) => ({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, ...opts });

// 그을음 자국: 가운데가 짙고 가장자리가 들쭉날쭉한 검은 얼룩 + 바깥으로 뻗은 줄기
function scorchTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const rays = Array.from({ length: 22 }, () => [Math.random() * Math.PI * 2, 0.55 + Math.random() * 0.45]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      let ray = 0;
      for (const [a0, len] of rays) {
        const da = Math.abs(((ang - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        ray = Math.max(ray, Math.max(0, 1 - da * 9) * Math.max(0, 1 - d / len));
      }
      const wob = 0.62 + 0.12 * Math.sin(ang * 5 + 1.3) + 0.08 * Math.sin(ang * 11 + 0.4);
      let a = Math.max(0, 1 - d / wob) ** 0.8 * 0.95 + ray * 0.55;
      a *= 0.75 + Math.random() * 0.25;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 10;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 남은 불씨: 자국 가운데에 흩어진 빛 점
function emberTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  for (let k = 0; k < 70; k++) {
    const r = Math.sqrt(Math.random()) * S * 0.36;
    const a = Math.random() * Math.PI * 2;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const s = 1.5 + Math.random() * 3.5;
    const grd = g.createRadialGradient(x, y, 0, x, y, s);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x - s, y - s, s * 2, s * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX_DEBRIS = 120;
const MAX_SCORCH = 10;
const GRAV = 14;

export class BlastView {
  // map: 파편이 벽에 튕기고 바닥에 떨어지게 · effects: 불티·먼지 입자 · lights: 폭발 빛
  constructor(scene, map, effects, lights = null) {
    this.map = map;
    this.effects = effects;
    this.lights = lights;
    this.group = new THREE.Group();
    this.group.name = 'blasts';
    scene.add(this.group);
    this.list = [];
    this.fireGeo = new THREE.SphereGeometry(1, 40, 28);
    this.shellGeo = new THREE.SphereGeometry(1, 32, 18);
    this.ringGeo = new THREE.CircleGeometry(1, 64);
    this.smokeMap = smokeTexture();
    // 파편: 납작한 조각들 (달궈진 정도 heat → 주황빛)
    const dg = new THREE.DodecahedronGeometry(1, 0);
    this.heat = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS), 1);
    this.heat.setUsage(THREE.DynamicDrawUsage);
    dg.setAttribute('heat', this.heat);
    const dm = new THREE.MeshStandardMaterial({ color: '#3a3631', roughness: 0.75, metalness: 0.35 });
    dm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float heat;\nvarying float vHeat;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = heat;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHeat;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mix(vec3(0.9, 0.18, 0.03), vec3(1.0, 0.75, 0.4), vHeat) * vHeat * vHeat * 6.0;');
    };
    this.debrisMesh = new THREE.InstancedMesh(dg, dm, MAX_DEBRIS);
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 0;
    this.group.add(this.debrisMesh);
    this.debris = [];
    // 그을음 자국 (오래된 것부터 재사용)
    const scMat = new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const emMap = emberTexture();
    this.scorches = [];
    for (let i = 0; i < MAX_SCORCH; i++) {
      const m = new THREE.Mesh(this.ringGeo, scMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      const em = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial(add({ map: emMap, color: '#ff7a2a', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
      em.position.z = 0.004;
      m.add(em);
      this.group.add(m);
      this.scorches.push({ mesh: m, em, t: 0, life: 0 });
    }
    this.scorchNext = 0;
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.hotSmoke = new THREE.Color('#ff9a55');
    this.coldSmoke = new THREE.Color('#57525c');
    this.shock = null; // 화면 일렁임 { x, y, r, k } (바디캠 패스에서 처리)
  }

  // kind: 'frag' | 'c4' · e: 폭발 위치
  spawn(e, kind = 'frag') {
    const big = kind === 'c4' ? 1.35 : 1;
    const R = 1.7 * big; // 불덩이 반지름 (m)
    const floor = this.map.groundHeight(e.x, e.z, 0.3, e.y + 0.3);
    const lowY = Math.max(e.y, floor + 0.15);
    const root = new THREE.Group();
    root.position.set(e.x, lowY, e.z);
    const seed = Math.random() * 50;
    // 불덩이 (안쪽 하얗게 → 주황 → 보랏빛) + 더 크고 옅은 바깥 불길
    const fireMat = (gain, life) =>
      new THREE.ShaderMaterial({ uniforms: { uAge: { value: 0 }, uLife: { value: life }, uGain: { value: gain }, uSeed: { value: seed }, uTint: { value: new THREE.Color('#9b5cff') } }, vertexShader: FIRE_VERT, fragmentShader: FIRE_FRAG, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    const fire = new THREE.Mesh(this.fireGeo, fireMat(0.95, 0.7 * big));
    const flare = new THREE.Mesh(this.fireGeo, new THREE.ShaderMaterial({ uniforms: { uAge: { value: 0 }, uLife: { value: 1.9 * big }, uSeed: { value: seed + 11 } }, vertexShader: FIRE_VERT, fragmentShader: SMOKE_FRAG, transparent: true, depthWrite: false }));
    fire.renderOrder = 4;
    flare.renderOrder = 3; // 연기 먼저 → 불길이 위에 더해짐
    // 충격파 껍질 + 바닥 고리
    const shell = new THREE.Mesh(this.shellGeo, new THREE.ShaderMaterial({ uniforms: { uK: { value: 1 }, uColor: { value: new THREE.Color('#cfe4ff') } }, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, ...add({ side: THREE.DoubleSide }) }));
    const ring = new THREE.Mesh(this.ringGeo, new THREE.ShaderMaterial({ uniforms: { uK: { value: 1 }, uColor: { value: new THREE.Color('#ffc890') } }, vertexShader: RING_VERT, fragmentShader: RING_FRAG, ...add({ side: THREE.DoubleSide }) }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = floor - lowY + 0.06;
    root.add(fire, flare, shell, ring);
    // 피어오르는 연기 (처음엔 불빛에 주황으로 물들었다가 짙은 회보라로)
    const puffs = [];
    for (let i = 0; i < Math.round(12 * big); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeMap, color: '#ff9a55', transparent: true, depthWrite: false, opacity: 0 }));
      const a = Math.random() * Math.PI * 2, r = Math.random() * R * 0.7;
      const p = { s, x: Math.cos(a) * r, y: Math.random() * R * 0.6, z: Math.sin(a) * r, vx: Math.cos(a) * (0.6 + Math.random()), vz: Math.sin(a) * (0.6 + Math.random()), vy: 0.9 + Math.random() * 1.2, size: R * (1.3 + Math.random() * 0.9), spin: (Math.random() - 0.5) * 0.6, delay: 0.15 + Math.random() * 0.25 };
      s.material.rotation = Math.random() * 6;
      s.visible = false;
      root.add(s);
      puffs.push(p);
    }
    this.group.add(root);
    // 폭발 빛: 하얀 주황으로 번쩍 → 붉게 식음
    const light = { pos: new THREE.Vector3(e.x, lowY + 0.8, e.z), color: new THREE.Color('#ffb070'), intensity: 320 * big, distance: 20 * big, priority: 6 };
    this.lights?.add(light);
    this.list.push({ root, fire, flare, shell, ring, puffs, light, t: 0, big, R, floor, center: new THREE.Vector3(e.x, lowY, e.z) });
    // 바닥을 쓸고 나가는 먼지 치마 · 위로 솟는 불티
    const fx = this.effects;
    fx.dust.ring({ x: e.x, y: floor + 0.15, z: e.z }, '#4a4440', Math.round(70 * big), 11 * big, 1.6, 0.6);
    fx.sparks.burst({ x: e.x, y: lowY + 0.2, z: e.z }, '#ffcf8a', Math.round(40 * big), { speed: 20 * big, up: 1.6, life: 0.5, gravity: 4, spread: 1.6 });
    // 달궈진 파편
    const n = Math.round(22 * big);
    for (let k = 0; k < n; k++) this.addDebris(e.x, lowY + 0.1, e.z, floor, big);
    // 그을음 자국 (바닥 가까이에서 터졌을 때만)
    if (e.y - floor < 1.4) {
      const sc = this.scorches[this.scorchNext];
      this.scorchNext = (this.scorchNext + 1) % MAX_SCORCH;
      sc.mesh.position.set(e.x, floor + 0.012, e.z);
      sc.mesh.rotation.z = Math.random() * Math.PI * 2;
      const size = 2.5 * big * (0.9 + Math.random() * 0.2);
      sc.mesh.scale.set(size, size, 1);
      sc.mesh.visible = true;
      sc.t = 0;
      sc.life = 30;
    }
  }

  addDebris(x, y, z, floor, big) {
    if (this.debris.length >= MAX_DEBRIS) this.debris.shift();
    const a = Math.random() * Math.PI * 2;
    const up = 0.25 + Math.random() * 0.9;
    const sp = (6 + Math.random() * 11) * big;
    const h = Math.sqrt(Math.max(0, 1 - up * up * 0.5));
    const v = new THREE.Vector3(Math.cos(a) * h, up, Math.sin(a) * h).normalize().multiplyScalar(sp);
    // 처음 날아가는 방향으로 벽까지 거리 (벽에 닿으면 튕김)
    const hit = this.map.raycast({ x, y: y + 0.2, z }, { x: x + Math.cos(a) * 14, y: y + 0.2, z: z + Math.sin(a) * 14 });
    const limit = hit ? Math.max(0.2, hit.t * 14 - 0.1) : Infinity;
    const sc = (0.045 + Math.random() * 0.08) * (big > 1 ? 1.15 : 1);
    this.debris.push({
      p: new THREE.Vector3(x, y, z), v, ox: x, oz: z, limit, floor,
      rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new THREE.Vector3((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22),
      size: new THREE.Vector3(sc * (0.8 + Math.random() * 0.8), sc * (0.35 + Math.random() * 0.4), sc * (0.8 + Math.random() * 0.6)),
      heat: 0.85 + Math.random() * 0.15, t: 0, life: 2.6 + Math.random() * 1.6, trail: 0,
    });
  }

  update(dt, camera) {
    const fx = this.effects;
    this.shock = null;
    // 폭발
    this.list = this.list.filter((b) => {
      b.t += dt;
      const t = b.t;
      // 불덩이: 0.12초 만에 부풀고 천천히 커지며 떠오름
      const grow = 1 - Math.pow(1 - Math.min(1, t / 0.12), 3);
      const fs = b.R * (0.3 + 0.7 * grow) * (1 + t * 0.45);
      b.fire.scale.setScalar(fs);
      b.fire.position.y = t * t * 1.6;
      b.fire.material.uniforms.uAge.value = t;
      b.flare.scale.setScalar(b.R * (0.45 + 0.75 * grow) * (1.15 + t * 0.55));
      b.flare.position.y = t * 0.9;
      b.flare.material.uniforms.uAge.value = t;
      b.fire.visible = t < b.fire.material.uniforms.uLife.value;
      b.flare.visible = t < b.flare.material.uniforms.uLife.value;
      // 충격파 껍질: 0.28초에 반지름 9 m까지
      const sk = Math.min(1, t / 0.28);
      b.shell.visible = sk < 1;
      b.shell.scale.setScalar(0.5 + (1 - Math.pow(1 - sk, 2)) * 8.5 * b.big);
      b.shell.material.uniforms.uK.value = 0.06 * (1 - sk) * (1 - sk);
      // 바닥 고리: 0.5초에 반지름 7 m까지
      const rk = Math.min(1, t / 0.5);
      b.ring.visible = rk < 1;
      b.ring.scale.setScalar(0.4 + (1 - Math.pow(1 - rk, 2.2)) * 6.6 * b.big);
      b.ring.material.uniforms.uK.value = 0.55 * (1 - rk) ** 1.5;
      // 연기
      let smokeAlive = false;
      for (const p of b.puffs) {
        const st = t - p.delay;
        if (st <= 0) continue;
        const life = 4.2 * b.big;
        const k = st / life;
        if (k >= 1) {
          p.s.visible = false;
          continue;
        }
        smokeAlive = true;
        p.s.visible = true;
        const slow = 1 - Math.exp(-st * 1.4);
        p.s.position.set(p.x + p.vx * slow * 1.6, p.y + p.vy * st * 0.9, p.z + p.vz * slow * 1.6);
        const sz = p.size * (0.5 + 0.9 * Math.sqrt(k));
        p.s.scale.set(sz, sz, 1);
        p.s.material.rotation += p.spin * dt;
        p.s.material.color.copy(this.hotSmoke).lerp(this.coldSmoke, Math.min(1, st / 0.45));
        p.s.material.opacity = Math.min(1, st / 0.12) * (1 - k) ** 1.2 * 0.85;
      }
      // 빛: 번쩍 → 붉게 식음
      if (b.light) {
        b.light.intensity = 320 * b.big * Math.exp(-t * 9) + 110 * b.big * Math.max(0, 1 - t / 1.2);
        b.light.color.setRGB(1, 0.5 + 0.22 * Math.exp(-t * 6), 0.25 + 0.2 * Math.exp(-t * 8));
        if (t > 1.2) {
          this.lights?.remove(b.light);
          b.light = null;
        }
      }
      // 화면 일렁임: 카메라 앞쪽에서 터졌을 때만 (0.45초)
      if (camera && t < 0.45) {
        const d = camera.position.distanceTo(b.center);
        const near = Math.max(0, 1 - d / 45);
        const c = this.tmp.copy(b.center).project(camera);
        if (near > 0 && c.z < 1 && Math.abs(c.x) < 1.6 && Math.abs(c.y) < 1.6) {
          const worldR = 0.5 + (t / 0.45) * 14 * b.big;
          this.v.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(worldR).add(b.center).project(camera);
          const r = Math.min(1.4, Math.abs(this.v.x - c.x) * 0.5 * camera.aspect);
          const k = near * (1 - t / 0.45) ** 1.5 * b.big;
          if (!this.shock || k > this.shock.k) this.shock = { x: c.x * 0.5 + 0.5, y: c.y * 0.5 + 0.5, r, k };
        }
      }
      const alive = t < 0.8 * b.big || smokeAlive || b.light;
      if (!alive) this.drop(b);
      return alive;
    });
    // 파편
    let n = 0;
    this.debris = this.debris.filter((d) => {
      d.t += dt;
      if (d.t >= d.life) return false;
      d.v.y -= GRAV * dt;
      d.p.addScaledVector(d.v, dt);
      // 벽에 닿으면 튕겨 나옴
      if (Math.hypot(d.p.x - d.ox, d.p.z - d.oz) > d.limit) {
        d.v.x *= -0.35;
        d.v.z *= -0.35;
        d.limit = Infinity;
      }
      if (d.p.y < d.floor + d.size.y) {
        d.p.y = d.floor + d.size.y;
        if (d.v.y < -1.5) {
          d.v.y *= -0.32;
          d.v.x *= 0.55;
          d.v.z *= 0.55;
          d.w.multiplyScalar(0.6);
        } else {
          d.v.set(d.v.x * 0.8, 0, d.v.z * 0.8);
          d.w.multiplyScalar(0.85);
        }
      }
      d.rot.x += d.w.x * dt;
      d.rot.y += d.w.y * dt;
      d.rot.z += d.w.z * dt;
      d.heat *= Math.exp(-dt * 1.35);
      // 날아가는 동안 불티 꼬리
      d.trail -= dt;
      if (d.trail <= 0 && d.heat > 0.35 && d.v.lengthSq() > 9) {
        d.trail = 0.035;
        fx.sparks.burst(d.p, d.heat > 0.6 ? '#ffc47a' : '#ff7a3a', 1, { speed: 0.4, up: 0.3, life: 0.28, gravity: 1 });
      }
      const fade = Math.min(1, (d.life - d.t) / 0.5);
      this.q.setFromEuler(d.rot);
      this.s.copy(d.size).multiplyScalar(fade);
      this.m4.compose(d.p, this.q, this.s);
      this.debrisMesh.setMatrixAt(n, this.m4);
      this.heat.array[n] = d.heat;
      n++;
      return true;
    });
    this.debrisMesh.count = n;
    if (n) {
      this.debrisMesh.instanceMatrix.needsUpdate = true;
      this.heat.needsUpdate = true;
    }
    // 그을음 자국: 불씨가 몇 초 동안 깜빡이며 식고, 자국은 마지막 5초에 옅어짐
    for (const sc of this.scorches) {
      if (!sc.mesh.visible) continue;
      sc.t += dt;
      if (sc.t >= sc.life) {
        sc.mesh.visible = false;
        continue;
      }
      sc.mesh.material.opacity = 0.82 * Math.min(1, (sc.life - sc.t) / 5) * Math.min(1, sc.t / 0.15);
      const glow = Math.max(0, 1 - sc.t / 4.5);
      sc.em.material.opacity = glow * glow * (0.8 + 0.2 * Math.sin(sc.t * 13 + sc.mesh.rotation.z * 7));
      sc.em.visible = glow > 0;
    }
  }

  drop(b) {
    this.group.remove(b.root);
    b.fire.material.dispose();
    b.flare.material.dispose();
    b.shell.material.dispose();
    b.ring.material.dispose();
    for (const p of b.puffs) p.s.material.dispose();
    if (b.light) this.lights?.remove(b.light);
  }

  // 라운드가 바뀌면 모두 지움
  clear() {
    for (const b of this.list) this.drop(b);
    this.list = [];
    this.debris = [];
    this.debrisMesh.count = 0;
    for (const sc of this.scorches) sc.mesh.visible = false;
    this.shock = null;
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
    this.fireGeo.dispose();
    this.shellGeo.dispose();
    this.ringGeo.dispose();
    this.debrisMesh.geometry.dispose();
    this.debrisMesh.material.dispose();
    for (const sc of this.scorches) {
      sc.mesh.material.dispose();
      sc.em.material.dispose();
    }
  }
}
