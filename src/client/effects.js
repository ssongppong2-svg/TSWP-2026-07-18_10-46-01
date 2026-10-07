import * as THREE from 'three';
import { TEAM_INFO } from '../sim/constants.js';
import { createBombScreen, glowTexture, holeTexture, labelTexture } from './textures.js';
import { SITE_COLORS } from './world-view.js';

export const PATCH_COLORS = {
  gravityVeil: '#8a7dff',
  elasticPad: '#8dff5a',
  resultantAmp: '#ffa13d',
  frictionZero: '#9ff3ff',
  gravityCollapse: '#c47dff',
};

const FRESNEL_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = position;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

function veilMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, opacity: { value: 0 } },
    vertexShader: FRESNEL_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float time; uniform float opacity;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float bands = pow(0.5 + 0.5 * sin(vP.y * 5.0 - time * 5.0), 6.0);
        float hex = pow(abs(sin(vP.x * 3.0) * sin(vP.z * 3.0) * sin(vP.y * 3.0)), 0.25);
        float a = (f * 0.85 + bands * 0.18 + hex * 0.04 + 0.03) * opacity;
        gl_FragColor = vec4(color * (0.7 + f * 1.4 + bands), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function discMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, opacity: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float time; uniform float opacity; varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float rim = smoothstep(0.86, 1.0, r);
        float streak = pow(0.5 + 0.5 * sin((p.x + p.y * 0.35) * 16.0 + time * 1.5), 5.0);
        float ripple = pow(0.5 + 0.5 * sin(r * 26.0 - time * 4.0), 10.0);
        float a = (0.22 + rim * 0.75 + streak * 0.12 + ripple * 0.18) * opacity;
        gl_FragColor = vec4(color * (0.9 + rim * 1.2 + ripple * 0.6 + streak * 0.4), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
}

function swirlMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, opacity: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float time; uniform float opacity; varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        float arms = pow(0.5 + 0.5 * sin(a * 3.0 + r * 14.0 - time * 7.0), 3.0);
        float ring = smoothstep(0.25, 0.45, r) * (1.0 - smoothstep(0.75, 1.0, r));
        float alpha = arms * ring * opacity;
        gl_FragColor = vec4(color * (1.0 + arms), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// 스파크·파편 파티클 (고정 개수 풀)
class Sparks {
  constructor(scene, max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.total = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.14, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
  }

  burst(p, color, count, { speed = 4, up = 1.5, life = 0.45, gravity = 9, normal = null, spread = 1 } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      let vx = (Math.random() - 0.5) * 2 * spread, vy = Math.random() * up, vz = (Math.random() - 0.5) * 2 * spread;
      if (normal) {
        vx += normal.x * 1.2;
        vy += normal.y * 1.2;
        vz += normal.z * 1.2;
      }
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = vx * s;
      this.vel[i * 3 + 1] = vy * s;
      this.vel[i * 3 + 2] = vz * s;
      this.life[i] = this.total[i] = life * (0.6 + Math.random() * 0.8);
      this.base[i * 3] = c.r;
      this.base[i * 3 + 1] = c.g;
      this.base[i * 3 + 2] = c.b;
      this.grav[i] = gravity;
    }
  }

  // 한 점으로 빨려 들어가는 입자 (중력 붕괴)
  inward(center, color, count, radius) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2, r = radius * (0.6 + Math.random() * 0.4), y = (Math.random() - 0.5) * 2;
      this.pos[i * 3] = center.x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = center.y + y;
      this.pos[i * 3 + 2] = center.z + Math.sin(a) * r;
      const t = 0.55;
      this.vel[i * 3] = (center.x - this.pos[i * 3]) / t + Math.sin(a) * 4;
      this.vel[i * 3 + 1] = (center.y - this.pos[i * 3 + 1]) / t;
      this.vel[i * 3 + 2] = (center.z - this.pos[i * 3 + 2]) / t - Math.cos(a) * 4;
      this.life[i] = this.total[i] = t;
      this.base[i * 3] = c.r;
      this.base[i * 3 + 1] = c.g;
      this.base[i * 3 + 2] = c.b;
      this.grav[i] = 0;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.3;
        this.vel[i * 3] *= 0.5;
        this.vel[i * 3 + 2] *= 0.5;
      }
      const f = this.life[i] / this.total[i];
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

class BombView {
  constructor(bomb) {
    this.bomb = bomb;
    const g = new THREE.Group();
    g.position.set(bomb.x, 0, bomb.z);
    this.group = g;
    const metal = new THREE.MeshStandardMaterial({ color: '#2a2e36', roughness: 0.45, metalness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.7, metalness: 0.4 });
    this.liquid = new THREE.MeshStandardMaterial({ color: '#ff3b3b', emissive: '#ff3b3b', emissiveIntensity: 1.1 });
    const glass = new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.2 });
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(0.75, 0.82, 0.14, 24), dark, 0, 0.07, 0);
    add(new THREE.BoxGeometry(0.9, 0.42, 0.56), metal, 0, 0.35, 0);
    for (const [x, z] of [[-0.3, -0.12], [0, -0.12], [0.3, -0.12]]) {
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.56, 14), glass, x, 0.78, z);
      add(new THREE.CylinderGeometry(0.075, 0.075, 0.46, 12), this.liquid, x, 0.76, z);
      add(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14), dark, x, 1.07, z);
    }
    const screen = createBombScreen();
    this.screen = screen;
    const scr = add(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshBasicMaterial({ map: screen.texture }), 0, 0.37, 0.285);
    scr.castShadow = false;
    this.lamp = add(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff2a2a', emissiveIntensity: 3 }), 0.36, 0.62, 0.18);
    this.light = new THREE.PointLight('#ff3030', 6, 6, 2);
    this.light.position.set(0, 1.2, 0);
    g.add(this.light);
    // 락픽 진행 표시 (바닥 고리 조각)
    this.segments = [];
    const segMat = () => new THREE.MeshBasicMaterial({ color: '#3a3f48' });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.08), segMat());
      m.position.set(Math.cos(a) * 1.05, 0.03, Math.sin(a) * 1.05);
      m.rotation.y = -a + Math.PI / 2;
      g.add(m);
      this.segments.push(m);
    }
    // 해체되면 하늘로 솟는 빛기둥
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.6, 40, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: '#4dff9a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beam.position.y = 20;
    g.add(this.beam);
    this.lastText = '';
    this.blink = 0;
  }

  update(dt, time, timeLeft) {
    const b = this.bomb;
    let text, color, sub;
    if (b.state === 'defused') {
      text = 'SAFE';
      color = '#4dff9a';
      sub = `폭탄 ${b.id} · 해체됨`;
    } else if (b.state === 'exploded') {
      text = 'BOOM';
      color = '#ff5a3a';
      sub = `폭탄 ${b.id}`;
    } else {
      const s = Math.max(0, Math.ceil(timeLeft));
      text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      color = b.picker ? '#ffd23a' : '#ff4a4a';
      sub = b.picker ? `폭탄 ${b.id} · 해체 시도 중` : `폭탄 ${b.id}`;
    }
    const key = text + color + sub;
    if (key !== this.lastText) {
      this.screen.draw(text, color, sub);
      this.lastText = key;
    }
    const defused = b.state === 'defused';
    const liquid = defused ? '#4dff9a' : b.picker ? '#ffd23a' : '#ff3b3b';
    this.liquid.color.set(liquid);
    this.liquid.emissive.set(liquid);
    this.light.color.set(liquid);
    // 남은 시간이 적을수록 빨리 깜빡임
    const rate = defused ? 0 : timeLeft < 10 ? 8 : timeLeft < 30 ? 4 : 1.6;
    this.blink += dt * rate;
    const on = defused || Math.sin(this.blink * Math.PI * 2) > 0;
    this.lamp.material.emissive.set(on ? liquid : '#200000');
    this.light.intensity = defused ? 5 : on ? 7 : 2;
    const lit = Math.round(b.progress * this.segments.length);
    this.segments.forEach((m, i) => m.material.color.set(defused ? '#4dff9a' : i < lit ? '#ffd23a' : '#3a3f48'));
    this.beam.material.opacity += ((defused ? 0.32 : 0) - this.beam.material.opacity) * Math.min(1, dt * 3);
    this.beam.scale.x = this.beam.scale.z = 1 + Math.sin(time * 4) * 0.08;
  }
}

// 모든 시각 효과를 관리
export class Effects {
  constructor(scene, match) {
    this.scene = scene;
    this.match = match;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.sparks = new Sparks(this.group);

    // 총알 궤적
    this.maxTracers = 600;
    const tgeo = new THREE.BoxGeometry(1, 1, 1);
    tgeo.translate(0, 0, -0.5);
    this.tracers = new THREE.InstancedMesh(
      tgeo,
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      this.maxTracers,
    );
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    this.group.add(this.tracers);
    this.tmpM = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpV = new THREE.Vector3();
    this.tmpS = new THREE.Vector3();
    this.tmpC = new THREE.Color();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.tracerOffsets = new Map();

    // 총알 자국
    this.holes = [];
    const holeMat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const holeGeo = new THREE.PlaneGeometry(0.16, 0.16);
    for (let i = 0; i < 140; i++) {
      const m = new THREE.Mesh(holeGeo, holeMat);
      m.visible = false;
      this.group.add(m);
      this.holes.push(m);
    }
    this.holeNext = 0;

    // 총구 화염 (3인칭) + 순간 조명
    this.flashes = [];
    const glow = glowTexture();
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ffcf8a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.visible = false;
      s.scale.set(0.5, 0.5, 0.5);
      this.group.add(s);
      this.flashes.push({ sprite: s, t: 0 });
    }
    this.flashNext = 0;
    this.muzzleLights = [0, 1, 2].map(() => {
      const l = new THREE.PointLight('#ffc27a', 0, 7, 2);
      this.group.add(l);
      return { light: l, t: 0 };
    });
    this.lightNext = 0;

    this.veils = new Map();
    this.zones = new Map();
    this.pads = [];
    this.blasts = [];
    this.bombs = match.bombs.map((b) => {
      const v = new BombView(b);
      this.group.add(v.group);
      return v;
    });
    this.shake = 0;
  }

  // ── 이벤트 반응
  onShot(e, muzzlePos, isLocal) {
    // 화면에 보이는 궤적은 총구에서 시작하도록 보정
    const p = e.projectile;
    this.tracerOffsets.set(p.id, {
      x: muzzlePos.x - p.pos.x,
      y: muzzlePos.y - p.pos.y,
      z: muzzlePos.z - p.pos.z,
    });
    if (!isLocal) {
      const f = this.flashes[this.flashNext];
      this.flashNext = (this.flashNext + 1) % this.flashes.length;
      f.sprite.position.copy(muzzlePos);
      f.sprite.visible = true;
      f.t = 0.05;
      f.sprite.material.color.set(e.amp ? '#ffa13d' : '#ffcf8a');
    }
    const L = this.muzzleLights[this.lightNext];
    this.lightNext = (this.lightNext + 1) % this.muzzleLights.length;
    L.light.position.copy(muzzlePos);
    L.light.intensity = isLocal ? 5 : 8;
    L.light.color.set(e.amp ? '#ffa13d' : '#ffc27a');
    L.t = 0.05;
  }

  onImpact(e) {
    const p = { x: e.x, y: e.y, z: e.z };
    if (e.kind === 'flesh') {
      const owner = this.match.agentById(e.projectile.ownerId);
      const victimTeam = owner?.team === 'defuse' ? 'force' : 'defuse';
      this.sparks.burst(p, TEAM_INFO[victimTeam].color, 10, { speed: 3, up: 1.2, life: 0.35, gravity: 4 });
      return;
    }
    if (e.kind === 'debris') {
      this.sparks.burst(p, '#b9b0ff', 4, { speed: 1, up: 1, life: 0.3, gravity: 6 });
      return;
    }
    const n = { x: e.nx, y: e.ny, z: e.nz };
    this.sparks.burst(p, '#ffd59a', 7, { speed: 3.5, up: 1, life: 0.35, normal: n, gravity: 12 });
    this.sparks.burst(p, '#8a8f99', 4, { speed: 1.5, up: 1, life: 0.6, normal: n, gravity: 5 });
    const h = this.holes[this.holeNext];
    this.holeNext = (this.holeNext + 1) % this.holes.length;
    h.visible = true;
    h.position.set(p.x + n.x * 0.01, p.y + n.y * 0.01, p.z + n.z * 0.01);
    h.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    h.rotation.z = Math.random() * Math.PI;
  }

  onPatch(e) {
    const c = PATCH_COLORS[e.patchId];
    const a = e.agent;
    if (e.patchId === 'elasticPad') this.spawnPad(e.pos, c);
    if (e.patchId === 'resultantAmp') this.sparks.burst({ x: a.pos.x, y: a.pos.y + 1, z: a.pos.z }, c, 30, { speed: 3, up: 2, life: 0.6, gravity: -2 });
    if (e.patchId === 'gravityVeil') this.sparks.burst({ x: a.pos.x, y: a.pos.y + 1, z: a.pos.z }, c, 40, { speed: 5, up: 1, life: 0.5, gravity: 0 });
    if (e.zone?.type === 'friction') this.sparks.burst({ x: e.zone.x, y: e.zone.y + 0.1, z: e.zone.z }, c, 50, { speed: 6, up: 0.4, life: 0.6, gravity: 3 });
    if (e.zone?.type === 'collapse') this.sparks.inward({ x: e.zone.x, y: e.zone.y, z: e.zone.z }, c, 140, 9);
  }

  onHitAgent(view) {
    view?.hit();
  }

  onExplode() {
    for (const b of this.match.bombs) {
      if (b.state !== 'exploded') continue;
      const p = { x: b.x, y: 1, z: b.z };
      this.sparks.burst(p, '#ffb347', 160, { speed: 14, up: 2, life: 1.4, gravity: 6, spread: 1.4 });
      this.sparks.burst(p, '#ff5a3a', 120, { speed: 9, up: 2.5, life: 1.8, gravity: 3, spread: 1.2 });
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 16),
        new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      m.position.set(b.x, 1, b.z);
      this.group.add(m);
      const light = new THREE.PointLight('#ffb347', 400, 60, 2);
      light.position.set(b.x, 3, b.z);
      this.group.add(light);
      this.blasts.push({ mesh: m, light, t: 0 });
    }
    this.shake = 1.2;
  }

  spawnPad(pos, color) {
    const g = new THREE.Group();
    g.position.set(pos.x, pos.y + 0.02, pos.z);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, transparent: true, opacity: 1 });
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 24), mat);
    plate.position.y = 0.5;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.05, 24), mat);
    const pts = [];
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      pts.push(new THREE.Vector3(Math.cos(t * Math.PI * 10) * 0.38, t * 0.48, Math.sin(t * Math.PI * 10) * 0.38));
    }
    const spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.035, 6), mat);
    g.add(plate, base, spring);
    this.group.add(g);
    this.pads.push({ g, plate, spring, mat, t: 0 });
    this.sparks.burst({ x: pos.x, y: pos.y + 0.3, z: pos.z }, color, 36, { speed: 5, up: 2.5, life: 0.6, gravity: 8 });
  }

  // ── 매 프레임
  update(dt, alpha) {
    this.time += dt;
    const m = this.match;
    this.sparks.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);

    // 총알 궤적
    let n = 0;
    for (const p of m.projectiles) {
      if (n >= this.maxTracers) break;
      const x = p.prev.x + (p.pos.x - p.prev.x) * alpha;
      const y = p.prev.y + (p.pos.y - p.prev.y) * alpha;
      const z = p.prev.z + (p.pos.z - p.prev.z) * alpha;
      const off = this.tracerOffsets.get(p.id);
      const vx = p.vel.x, vy = p.vel.y, vz = p.vel.z;
      const speed = Math.hypot(vx, vy, vz);
      let px = x, py = y, pz = z;
      if (off) {
        off.k = (off.k ?? 1) - dt * 6;
        const k = Math.max(0, off.k);
        px += off.x * k;
        py += off.y * k;
        pz += off.z * k;
        if (k <= 0) this.tracerOffsets.delete(p.id);
      }
      const len = p.harmless ? 0.12 : Math.min(3.2, Math.max(0.15, speed * 0.02));
      const width = p.harmless || p.inVeil ? 0.05 : p.weapon === 'rifle' ? 0.022 : 0.018;
      if (speed > 0.01) this.tmpQ.setFromUnitVectors(this.fwd, this.tmpV.set(vx / speed, vy / speed, vz / speed));
      this.tmpS.set(width, width, len);
      this.tmpM.compose(this.tmpV.set(px, py, pz), this.tmpQ, this.tmpS);
      this.tracers.setMatrixAt(n, this.tmpM);
      let col;
      if (p.inVeil || p.harmless) col = PATCH_COLORS.gravityVeil;
      else if (p.amp) col = PATCH_COLORS.resultantAmp;
      else col = p.team === 'defuse' ? '#a8f0ff' : '#ffd0a8';
      this.tracers.setColorAt(n, this.tmpC.set(col));
      n++;
    }
    this.tracers.count = n;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    if (this.tracerOffsets.size > 400) this.tracerOffsets.clear();

    for (const f of this.flashes) {
      if (f.t <= 0) continue;
      f.t -= dt;
      f.sprite.visible = f.t > 0;
    }
    for (const L of this.muzzleLights) {
      L.t -= dt;
      if (L.t <= 0) L.light.intensity = 0;
    }

    this.updateVeils(dt);
    this.updateZones(dt);

    for (const pad of this.pads) {
      pad.t += dt;
      const t = pad.t;
      const sy = t < 0.07 ? 1 - (t / 0.07) * 0.7 : t < 0.22 ? 0.3 + ((t - 0.07) / 0.15) * 1.3 : 1.6 - Math.min(0.6, (t - 0.22) * 3);
      pad.spring.scale.y = sy;
      pad.plate.position.y = 0.48 * sy + 0.02;
      pad.mat.opacity = t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.5) : 1;
    }
    this.pads = this.pads.filter((pad) => {
      if (pad.t < 1.3) return true;
      this.group.remove(pad.g);
      pad.g.traverse((o) => o.geometry?.dispose());
      pad.mat.dispose();
      return false;
    });

    for (const b of this.blasts) {
      b.t += dt;
      const s = 1 + b.t * 22;
      b.mesh.scale.set(s, s, s);
      b.mesh.material.opacity = Math.max(0, 0.9 - b.t * 0.8);
      b.light.intensity = Math.max(0, 400 * (1 - b.t));
    }
    this.blasts = this.blasts.filter((b) => {
      if (b.t < 1.2) return true;
      this.group.remove(b.mesh, b.light);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      return false;
    });

    for (const bv of this.bombs) bv.update(dt, this.time, m.timeLeft);
  }

  updateVeils(dt) {
    const live = new Set();
    for (const v of this.match.veils) {
      live.add(v.id);
      let e = this.veils.get(v.id);
      if (!e) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(v.radius, 40, 24), veilMaterial(PATCH_COLORS.gravityVeil));
        this.group.add(mesh);
        e = { mesh, fade: 0 };
        this.veils.set(v.id, e);
      }
      e.data = v;
    }
    for (const [id, e] of this.veils) {
      const alive = live.has(id);
      e.fade = Math.max(0, Math.min(1, e.fade + (alive ? dt * 6 : -dt * 3)));
      const v = e.data;
      e.mesh.position.set(v.center.x, v.center.y, v.center.z);
      const pop = alive ? Math.min(1, e.fade * 1.2) : 1 + (1 - e.fade) * 0.15;
      e.mesh.scale.setScalar(pop);
      const u = e.mesh.material.uniforms;
      u.time.value = this.time;
      u.opacity.value = e.fade * (alive && v.t < 0.6 ? 0.5 + 0.5 * Math.sin(this.time * 30) : 1);
      if (!alive && e.fade <= 0) {
        this.group.remove(e.mesh);
        e.mesh.geometry.dispose();
        e.mesh.material.dispose();
        this.veils.delete(id);
      }
    }
  }

  updateZones(dt) {
    const live = new Set();
    for (const z of this.match.zones) {
      live.add(z.id);
      let e = this.zones.get(z.id);
      if (!e) {
        e = z.type === 'friction' ? this.makeFriction(z) : this.makeCollapse(z);
        this.zones.set(z.id, e);
      }
      e.data = z;
    }
    for (const [id, e] of this.zones) {
      const alive = live.has(id);
      e.fade = Math.max(0, Math.min(1, e.fade + (alive ? dt * 5 : -dt * 3)));
      const z = e.data;
      if (z.type === 'friction') {
        const u = e.disc.material.uniforms;
        u.time.value = this.time;
        u.opacity.value = e.fade * (alive && z.t < 1 ? 0.6 + 0.4 * Math.sin(this.time * 20) : 1);
        e.label.material.opacity = e.fade;
        e.label.position.y = z.y + 1.8 + Math.sin(this.time * 2) * 0.1;
        if (Math.random() < dt * 20) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * z.radius;
          this.sparks.burst({ x: z.x + Math.cos(a) * r, y: z.y + 0.05, z: z.z + Math.sin(a) * r }, PATCH_COLORS.frictionZero, 1, { speed: 0.5, up: 1, life: 0.6, gravity: -1 });
        }
      } else {
        const u = e.swirl.material.uniforms;
        u.time.value = this.time;
        u.opacity.value = e.fade;
        e.rim.material.uniforms.time.value = this.time;
        e.rim.material.uniforms.opacity.value = e.fade;
        const pulse = 1 + Math.sin(this.time * 10) * 0.06;
        e.core.scale.setScalar(e.fade * pulse);
        e.rim.scale.setScalar(e.fade * pulse * 1.15);
        e.swirl.rotation.z += dt * 2;
        e.ring.material.opacity = e.fade * (0.35 + 0.25 * Math.sin(this.time * 6));
        if (alive && Math.random() < dt * 30) this.sparks.inward({ x: z.x, y: z.y, z: z.z }, PATCH_COLORS.gravityCollapse, 3, z.radius);
        // 붙잡힌 적과 중심을 잇는 빛줄기
        const pos = e.beams.geometry.attributes.position;
        let k = 0;
        for (const aid of z.captured ?? []) {
          const a = this.match.agentById(aid);
          if (!a?.alive || a.held?.zoneId !== z.id || k >= 8) continue;
          pos.setXYZ(k * 2, z.x, z.y, z.z);
          pos.setXYZ(k * 2 + 1, a.pos.x, a.pos.y + 1.1, a.pos.z);
          k++;
        }
        e.beams.geometry.setDrawRange(0, k * 2);
        pos.needsUpdate = true;
        e.beams.material.opacity = e.fade * (0.5 + 0.5 * Math.random());
      }
      if (!alive && e.fade <= 0) {
        this.group.remove(e.root);
        e.root.traverse((o) => {
          o.geometry?.dispose();
          o.material?.dispose?.();
        });
        this.zones.delete(id);
      }
    }
  }

  makeFriction(z) {
    const root = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(z.radius, 64), discMaterial(PATCH_COLORS.frictionZero));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(z.x, z.y + 0.03, z.z);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('마찰력 0', '#9ff3ff'), transparent: true, depthWrite: false }));
    label.scale.set(2.2, 0.66, 1);
    label.position.set(z.x, z.y + 1.8, z.z);
    root.add(disc, label);
    this.group.add(root);
    return { root, disc, label, fade: 0 };
  }

  makeCollapse(z) {
    const root = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 16), new THREE.MeshBasicMaterial({ color: '#05010a' }));
    core.position.set(z.x, z.y, z.z);
    const rim = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 16), veilMaterial(PATCH_COLORS.gravityCollapse));
    rim.position.copy(core.position);
    const swirl = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), swirlMaterial(PATCH_COLORS.gravityCollapse));
    swirl.position.copy(core.position);
    swirl.rotation.x = -Math.PI / 2 + 0.25;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(z.radius - 0.15, z.radius, 72),
      new THREE.MeshBasicMaterial({ color: PATCH_COLORS.gravityCollapse, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(z.x, (z.groundY ?? 0) + 0.04, z.z);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(16 * 3), 3));
    const beams = new THREE.LineSegments(beamGeo, new THREE.LineBasicMaterial({ color: PATCH_COLORS.gravityCollapse, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    beams.frustumCulled = false;
    root.add(core, rim, swirl, ring, beams);
    this.group.add(root);
    return { root, core, rim, swirl, ring, beams, fade: 0 };
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mt of mats) {
          mt.map?.dispose();
          mt.dispose();
        }
      }
    });
  }
}
