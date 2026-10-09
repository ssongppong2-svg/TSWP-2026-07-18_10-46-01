import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeSolidMaterial } from './agent-view.js';
import { createBombScreen, glowTexture, holeTexture, labelTexture, smokeTexture } from './textures.js';

// 포스 패치 표시 색 (채도를 낮춘 현실적인 톤)
export const PATCH_COLORS = {
  gravityVeil: '#8fa3c9',
  elasticPad: '#a9c27a',
  resultantAmp: '#d9a25a',
  reactionRounds: '#e0c27a',
  buoyShield: '#7fb2c4',
  frictionZero: '#a8d5e0',
  elasticNet: '#c2b38a',
  weightScanner: '#d9534f',
  gravityCollapse: '#8b74b8',
  resultantSurge: '#e0a14f',
  frictionStorm: '#a08860',
};

const FRESNEL_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = position;
    vN = mat3(modelMatrix) * normal; // 크기 0으로 줄인 물체도 NaN이 나지 않게 (조각 셰이더에서 안전하게 정규화)
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

function domeMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, opacity: { value: 0 } },
    vertexShader: FRESNEL_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float time; uniform float opacity;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        // pow의 밑이 반올림 오차로 음수가 되면 실제 GPU에서 NaN → 빛번짐(블룸)이 화면 전체를 검게 만듦 → 0~1로 묶음
        vec3 n = vN / max(length(vN), 1e-4), v = vV / max(length(vV), 1e-4);
        float f = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 3.0);
        float rings = pow(clamp(0.5 + 0.5 * sin(length(vP) * 2.0 + vP.y * 6.0 - time * 4.0), 0.0, 1.0), 12.0);
        float a = (f * 0.55 + rings * 0.05 + 0.015) * opacity;
        gl_FragColor = vec4(color * (0.5 + f), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function sheenMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, opacity: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float time; uniform float opacity; varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float rim = smoothstep(0.9, 1.0, r) * 0.6;
        float streak = pow(clamp(0.5 + 0.5 * sin((p.x * 0.8 + p.y * 0.3) * 22.0 + time * 0.8), 0.0, 1.0), 14.0);
        float a = (0.1 + rim + streak * 0.12) * opacity * (1.0 - smoothstep(0.85, 1.0, r) * 0.3);
        gl_FragColor = vec4(color * (0.6 + streak * 0.8 + rim), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
}

// 파티클 풀: additive = 불꽃·빛, normal = 먼지·연기
// 카메라 가까이 오면 서서히 투명해지는 재질 (연기·먼지·검은 핵이 눈앞을 덮어 화면이 암전되지 않게).
// near0 m 안쪽은 안 보이고 near1 m부터 원래대로. 점 입자는 화면 크기에도 상한을 둠.
export function nearFade(material, near0 = 0.3, near1 = 1.3, maxPointPx = 0) {
  material.transparent = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vNearFade;')
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>\nvNearFade = smoothstep(${near0.toFixed(3)}, ${near1.toFixed(3)}, -mvPosition.z);${maxPointPx ? `\ngl_PointSize = min(gl_PointSize, ${maxPointPx.toFixed(1)});` : ''}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vNearFade;')
      .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vNearFade;\n#include <alphatest_fragment>');
  };
  material.customProgramCacheKey = () => `nearFade${near0}-${near1}-${maxPointPx}`;
  return material;
}

class Particles {
  constructor(scene, max, { additive = true, size = 0.12, map }) {
    this.max = max;
    this.additive = additive;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.total = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size,
        map,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        opacity: additive ? 1 : 0.55,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        sizeAttenuation: true,
      }),
    );
    // 눈앞의 입자는 지우고 화면 크기에 상한 (연기·먼지가 화면을 통째로 덮던 문제)
    nearFade(this.points.material, additive ? 0.15 : 0.35, additive ? 0.6 : 1.6, 240);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
  }

  burst(p, color, count, { speed = 4, up = 1.5, life = 0.45, gravity = 9, normal = null, spread = 1, drag = 0 } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      let vx = (Math.random() - 0.5) * 2 * spread, vy = Math.random() * up, vz = (Math.random() - 0.5) * 2 * spread;
      if (normal) {
        vx += normal.x * 1.3;
        vy += normal.y * 1.3;
        vz += normal.z * 1.3;
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
      this.drag[i] = drag;
    }
  }

  inward(center, color, count, radius, t = 0.55) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2, r = radius * (0.6 + Math.random() * 0.4), y = (Math.random() - 0.5) * 2;
      this.pos[i * 3] = center.x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = center.y + y;
      this.pos[i * 3 + 2] = center.z + Math.sin(a) * r;
      this.vel[i * 3] = (center.x - this.pos[i * 3]) / t + Math.sin(a) * 4;
      this.vel[i * 3 + 1] = (center.y - this.pos[i * 3 + 1]) / t;
      this.vel[i * 3 + 2] = (center.z - this.pos[i * 3 + 2]) / t - Math.cos(a) * 4;
      this.life[i] = this.total[i] = t;
      this.base[i * 3] = c.r;
      this.base[i * 3 + 1] = c.g;
      this.base[i * 3 + 2] = c.b;
      this.grav[i] = 0;
      this.drag[i] = 0;
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
      const dk = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dk;
      this.vel[i * 3 + 2] *= dk;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dk - this.grav[i] * dt;
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
      const k = this.additive ? f : Math.min(1, f * 1.5);
      this.col[i * 3] = this.base[i * 3] * k;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * k;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * k;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// 형상을 옮겨 붙일 준비: 위치·법선만 남기고 비색인화
function placed(geo, x, y, z, ry = 0) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
// 단색 부품에 정점 색·거칠기·금속성을 붙임 (makeSolidMaterial 한 재질로 그림)
function tinted(geo, color, rough, metal, emit = 0) {
  const n = geo.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  const rme = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col.set([c.r, c.g, c.b], i * 3);
    rme.set([rough, metal, emit], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aRME', new THREE.BufferAttribute(rme, 3));
  return geo;
}

// 폭탄 하나: 재질 묶음별로 합쳐 그리기 호출을 줄임 (부품 36개 → 6개)
class BombView {
  constructor(bomb) {
    this.bomb = bomb;
    const g = new THREE.Group();
    g.position.set(bomb.x, bomb.y ?? 0, bomb.z);
    this.group = g;
    this.liquid = new THREE.MeshStandardMaterial({ color: '#b2281f', emissive: '#b2281f', emissiveIntensity: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: '#9fb6c2', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2 });
    // 단색 부품 (받침·몸체·마개·전선)
    const solid = [
      tinted(placed(new RoundedBoxGeometry(1.0, 0.16, 0.7, 2, 0.03), 0, 0.08, 0), '#121417', 0.8, 0.3),
      tinted(placed(new RoundedBoxGeometry(0.86, 0.42, 0.52, 2, 0.03), 0, 0.37, 0), '#3d4130', 0.85, 0),
    ];
    const glassParts = [];
    const liquidParts = [];
    for (const x of [-0.3, 0, 0.3]) {
      glassParts.push(placed(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 14), x, 0.83, -0.08));
      liquidParts.push(placed(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 12), x, 0.8, -0.08));
      solid.push(tinted(placed(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14), x, 1.1, -0.08), '#2b2e33', 0.5, 0.75));
      solid.push(tinted(placed(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 14), x, 0.6, -0.08), '#2b2e33', 0.5, 0.75));
    }
    // 전선
    for (let i = 0; i < 3; i++) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.3 + i * 0.3, 1.12, -0.08), new THREE.Vector3(-0.2 + i * 0.2, 1.2, 0.1), new THREE.Vector3(0.0, 0.62, 0.24),
      ]);
      solid.push(tinted(placed(new THREE.TubeGeometry(curve, 16, 0.008, 5), 0, 0, 0), ['#8a2a20', '#2a4a8a', '#c9a43a'][i], 0.6, 0));
    }
    const mesh = (geo, mat, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      g.add(m);
      return m;
    };
    mesh(mergeGeometries(solid), makeSolidMaterial({ strobe: 0 }));
    mesh(mergeGeometries(glassParts), glass, false);
    mesh(mergeGeometries(liquidParts), this.liquid);
    const screen = createBombScreen();
    this.screen = screen;
    const scr = mesh(new THREE.PlaneGeometry(0.42, 0.21), new THREE.MeshBasicMaterial({ map: screen.texture }), false);
    scr.position.set(0, 0.42, 0.262);
    this.lamp = mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff2a2a', emissiveIntensity: 3 }), false);
    this.lamp.position.set(0.34, 0.62, 0.2);
    // 경고등 (실제 점광원은 LightRig가 가까울 때만 배정)
    this.light = { pos: new THREE.Vector3(bomb.x, (bomb.y ?? 0) + 1.0, bomb.z + 0.3), color: new THREE.Color('#ff3020'), intensity: 3, distance: 5, priority: 0.5 };
    // 해체 진행 표시: 바닥 고리 16칸 (한 메시, 칸마다 정점 색)
    const segs = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      segs.push(placed(new THREE.BoxGeometry(0.2, 0.02, 0.05), Math.cos(a) * 1.05, 0.02, Math.sin(a) * 1.05, -a + Math.PI / 2));
    }
    this.segPer = segs[0].attributes.position.count;
    const segGeo = mergeGeometries(segs);
    segGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segGeo.attributes.position.count * 3), 3));
    this.segColors = segGeo.attributes.color;
    mesh(segGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), false);
    this.segKey = '';
    this.segCount = 16;
    // 해체 완료 신호 (녹색 섬광등 + 희미한 빛기둥)
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.35, 30, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#4dbf7a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beam.position.y = 15;
    this.beam.visible = false;
    g.add(this.beam);
    this.lastText = '';
    this.blink = 0;
  }

  setSegments(defused, lit) {
    const key = defused ? 'd' : String(lit);
    if (key === this.segKey) return;
    this.segKey = key;
    const on = new THREE.Color(defused ? '#3f9a62' : '#c08a2a');
    const off = new THREE.Color('#2a2d32');
    const arr = this.segColors.array;
    for (let i = 0; i < this.segCount; i++) {
      const c = defused || i < lit ? on : off;
      for (let v = 0; v < this.segPer; v++) arr.set([c.r, c.g, c.b], (i * this.segPer + v) * 3);
    }
    this.segColors.needsUpdate = true;
  }

  update(dt, time, timeLeft) {
    const b = this.bomb;
    // 라운드마다 놓이는 자리가 바뀜
    const by = b.y ?? 0;
    if (this.group.position.x !== b.x || this.group.position.z !== b.z || this.group.position.y !== by) {
      this.group.position.set(b.x, by, b.z);
      this.light.pos.set(b.x, by + 1.0, b.z + 0.3);
    }
    let text, color, sub;
    if (b.state === 'defused') {
      text = 'SAFE';
      color = '#5fd38a';
      sub = `폭탄 ${b.id} · 해체 완료`;
    } else if (b.state === 'exploded') {
      text = '----';
      color = '#d9534f';
      sub = `폭탄 ${b.id}`;
    } else {
      const s = Math.max(0, Math.ceil(timeLeft));
      text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      color = b.picker ? '#e6b450' : '#e05a3a';
      sub = b.picker ? `폭탄 ${b.id} · 해체 진행` : `폭탄 ${b.id} · 작동 중`;
    }
    const key = text + color + sub;
    if (key !== this.lastText) {
      this.screen.draw(text, color, sub);
      this.lastText = key;
    }
    const defused = b.state === 'defused';
    const liquid = defused ? '#3f9a62' : b.picker ? '#c08a2a' : '#b2281f';
    this.liquid.color.set(liquid);
    this.liquid.emissive.set(liquid);
    this.light.color.set(liquid);
    const rate = defused ? 0 : timeLeft < 10 ? 8 : timeLeft < 30 ? 4 : 1.5;
    this.blink += dt * rate;
    const on = defused || Math.sin(this.blink * Math.PI * 2) > 0;
    this.lamp.material.emissive.set(on ? liquid : '#200000');
    this.light.intensity = defused ? 3 : on ? 4 : 1;
    this.setSegments(defused, Math.round(b.progress * this.segCount));
    this.beam.material.opacity += ((defused ? 0.12 : 0) - this.beam.material.opacity) * Math.min(1, dt * 3);
    this.beam.visible = this.beam.material.opacity > 0.004;
  }
}

// 모든 시각 효과
export class Effects {
  constructor(scene, match, lights = null) {
    this.lights = lights;
    this.scene = scene;
    this.match = match;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    const glow = glowTexture();
    const smoke = smokeTexture();
    this.sparks = new Particles(this.group, 700, { additive: true, size: 0.08, map: glow });
    this.dust = new Particles(this.group, 700, { additive: false, size: 0.42, map: smoke });
    this.smoke = new Particles(this.group, 300, { additive: false, size: 0.7, map: smoke });

    // 총알 궤적 (흐릿한 예광)
    this.maxTracers = 600;
    const tgeo = new THREE.BoxGeometry(1, 1, 1);
    tgeo.translate(0, 0, -0.5);
    this.tracers = new THREE.InstancedMesh(tgeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), this.maxTracers);
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

    // 탄흔
    this.holes = [];
    const holeMat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const holeGeo = new THREE.PlaneGeometry(0.12, 0.12);
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(holeGeo, holeMat);
      m.visible = false;
      this.group.add(m);
      this.holes.push(m);
    }
    this.holeNext = 0;

    // 탄피
    this.maxCasings = 48;
    const cgeo = new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6);
    cgeo.rotateZ(Math.PI / 2);
    this.casingMesh = new THREE.InstancedMesh(cgeo, new THREE.MeshStandardMaterial({ color: '#b58a3c', metalness: 0.9, roughness: 0.35 }), this.maxCasings);
    this.casingMesh.frustumCulled = false;
    this.group.add(this.casingMesh);
    this.casings = Array.from({ length: this.maxCasings }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), bounced: false }));
    this.casingNext = 0;
    this.onCasingBounce = null;

    // 3인칭 총구 화염 + 섬광 조명
    this.flashes = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ffc27a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.visible = false;
      s.scale.set(0.45, 0.45, 0.45);
      this.group.add(s);
      this.flashes.push({ sprite: s, t: 0 });
    }
    this.flashNext = 0;

    this.veils = new Map();
    this.zones = new Map();
    this.shields = new Map();
    this.pads = [];
    this.pulses = [];
    this.blasts = [];
    this.bombs = match.bombs.map((b) => {
      const v = new BombView(b);
      this.group.add(v.group);
      lights?.add(v.light);
      return v;
    });
    // 무게 감지기로 탐지된 적 표시 (벽 너머로 보임)
    this.markers = match.agents.map(() => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(), color: '#ff5a4f', depthTest: false, transparent: true }));
      s.scale.set(0.5, 0.5, 1);
      s.renderOrder = 20;
      s.visible = false;
      this.group.add(s);
      return s;
    });
    this.shake = 0;
    this.flash = 0;
    this.buildBarriers(match.barriers ?? {});
  }

  // 구매 시간 장벽: 시작 구역 둘레의 반투명 빗살 벽 (구매 시간이 끝나면 사라짐)
  buildBarriers(barriers) {
    this.barrierMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color('#4fe0c0') } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        varying float vY;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vY = uv.y;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlpha;
        uniform vec3 uColor;
        varying vec3 vW;
        varying float vY;
        void main() {
          float s = fract((vW.x + vW.z) * 0.9 + vW.y * 1.4 - uTime * 0.5);
          float stripe = smoothstep(0.42, 0.5, s) * (1.0 - smoothstep(0.62, 0.7, s));
          float edge = smoothstep(0.0, 0.06, vY) * (1.0 - smoothstep(0.75, 1.0, vY));
          float a = (0.05 + 0.15 * stripe + 0.3 * (1.0 - smoothstep(0.0, 0.08, vY))) * edge * uAlpha;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.barrierGroup = new THREE.Group();
    const H = 3.2;
    for (const b of Object.values(barriers)) {
      const edges = [[b.x0, b.z0, b.x1, b.z0], [b.x1, b.z0, b.x1, b.z1], [b.x1, b.z1, b.x0, b.z1], [b.x0, b.z1, b.x0, b.z0]];
      for (const [x0, z0, x1, z1] of edges) {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), this.barrierMat);
        m.position.set((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
        m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
        m.renderOrder = 3;
        this.barrierGroup.add(m);
      }
    }
    this.group.add(this.barrierGroup);
  }

  // ── 이벤트 반응
  onShot(e, muzzlePos, isLocal, portPos, camera) {
    const p = e.projectile;
    this.tracerOffsets.set(p.id, { x: muzzlePos.x - p.pos.x, y: muzzlePos.y - p.pos.y, z: muzzlePos.z - p.pos.z });
    if (!isLocal) {
      const f = this.flashes[this.flashNext];
      this.flashNext = (this.flashNext + 1) % this.flashes.length;
      f.sprite.position.copy(muzzlePos);
      f.sprite.visible = true;
      f.t = 0.05;
      f.sprite.material.color.set(e.amp ? '#ffb15a' : '#ffc27a');
    }
    this.lights?.flash(muzzlePos, isLocal ? 9 : 14);
    // 총구 연기
    this.smoke.burst(muzzlePos, '#9a9ea3', isLocal ? 2 : 1, { speed: 0.5, up: 1.2, life: 1.2, gravity: -0.6, spread: 0.6, drag: 2 });
    // 탄피 (가까운 사격만)
    if (portPos && camera && e.weapon !== 'knife') {
      const c = this.casings[this.casingNext];
      this.casingNext = (this.casingNext + 1) % this.maxCasings;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
      c.p.copy(portPos);
      c.v.copy(right).multiplyScalar(2.2 + Math.random()).addScaledVector(up, 1.6 + Math.random()).addScaledVector(back, 0.4);
      c.w.set(Math.random() * 30, Math.random() * 30, Math.random() * 30);
      c.r.set(0, Math.atan2(right.x, right.z), 0);
      c.life = 2.2;
      c.bounced = false;
      c.floor = this.match.map.dropToGround(portPos.x, portPos.z, portPos.y) + 0.01;
    }
  }

  onImpact(e) {
    const p = { x: e.x, y: e.y, z: e.z };
    if (e.kind === 'flesh') {
      this.dust.burst(p, '#4a1612', e.headshot ? 10 : 6, { speed: 1.2, up: 0.8, life: 0.35, gravity: 2, drag: 4 });
      return;
    }
    if (e.kind === 'debris') {
      this.sparks.burst(p, '#8fa3c9', 3, { speed: 1, up: 1, life: 0.25, gravity: 6 });
      return;
    }
    const n = { x: e.nx ?? 0, y: e.ny ?? 1, z: e.nz ?? 0 };
    if (e.kind === 'shield') {
      this.sparks.burst(p, '#ffd29a', 10, { speed: 4, up: 1, life: 0.3, normal: n, gravity: 10 });
      return;
    }
    this.sparks.burst(p, '#ffcf8a', 4, { speed: 3.5, up: 1, life: 0.22, normal: n, gravity: 14 });
    this.dust.burst(p, '#7d7b76', 6, { speed: 1.3, up: 0.8, life: 0.9, normal: n, gravity: 1.5, drag: 3 });
    const h = this.holes[this.holeNext];
    this.holeNext = (this.holeNext + 1) % this.holes.length;
    h.visible = true;
    h.position.set(p.x + n.x * 0.01, p.y + n.y * 0.01, p.z + n.z * 0.01);
    h.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    h.rotation.z = Math.random() * Math.PI;
  }

  onRicochet(e) {
    const n = { x: e.nx, y: e.ny, z: e.nz };
    this.sparks.burst(e, '#ffe0a0', 12, { speed: 5, up: 1, life: 0.3, normal: n, gravity: 10 });
  }

  onPatch(e) {
    const c = PATCH_COLORS[e.patchId];
    const a = e.agent;
    const at = { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z };
    switch (e.patchId) {
      case 'elasticPad':
        this.spawnPad(e.pos, c);
        break;
      case 'resultantAmp':
      case 'reactionRounds':
        this.sparks.burst(at, c, 18, { speed: 2, up: 2, life: 0.5, gravity: -1 });
        break;
      case 'gravityVeil':
        this.dust.burst({ ...at, y: a.pos.y + 0.1 }, '#6c7078', 24, { speed: 3, up: 0.3, life: 0.8, gravity: 0, drag: 3 });
        break;
      case 'weightScanner':
        this.pulses.push(this.makePulse(e.pos ?? a.pos, e.radius ?? 28, c));
        break;
      case 'resultantSurge':
        for (const id of e.affected ?? []) {
          const m = this.match.agentById(id);
          if (m) this.sparks.burst({ x: m.pos.x, y: m.pos.y + 1, z: m.pos.z }, c, 22, { speed: 2, up: 2.5, life: 0.6, gravity: -1 });
        }
        break;
      default:
        break;
    }
    if (e.zone?.type === 'friction') this.dust.burst({ x: e.zone.x, y: e.zone.y + 0.1, z: e.zone.z }, '#9fc4cc', 30, { speed: 4, up: 0.2, life: 0.8, gravity: 0, drag: 3 });
    if (e.zone?.type === 'collapse') this.dust.inward({ x: e.zone.x, y: e.zone.y, z: e.zone.z }, '#4a4650', 160, 9);
    if (e.zone?.type === 'storm') this.dust.burst({ x: e.zone.x, y: e.zone.y + 0.5, z: e.zone.z }, '#8a7a5e', 80, { speed: 8, up: 0.6, life: 1.6, gravity: 0, drag: 1.5, spread: 1.4 });
    if (e.zone?.type === 'net') this.sparks.burst({ x: e.zone.x, y: e.zone.y + 0.4, z: e.zone.z }, '#c2b38a', 20, { speed: 3, up: 1, life: 0.4 });
  }

  onExplode(cameraPos) {
    for (const b of this.match.bombs) {
      if (b.state !== 'exploded') continue;
      const p = { x: b.x, y: 1, z: b.z };
      this.sparks.burst(p, '#ffb347', 180, { speed: 16, up: 2, life: 1.2, gravity: 8, spread: 1.4 });
      this.dust.burst(p, '#3b3631', 160, { speed: 9, up: 2.2, life: 3, gravity: 0.5, spread: 1.3, drag: 1.2 });
      this.smoke.burst(p, '#2c2a28', 60, { speed: 4, up: 3, life: 4.5, gravity: -0.8, spread: 1, drag: 0.8 });
      // 폭발 빛: 광원 예산에서 가장 먼저 배정됨
      const light = { pos: new THREE.Vector3(b.x, 3, b.z), color: new THREE.Color('#ffb347'), intensity: 900, distance: 70, priority: 5 };
      this.lights?.add(light);
      this.blasts.push({ light, t: 0 });
      if (cameraPos) this.flash = Math.max(this.flash, Math.max(0, 1 - Math.hypot(cameraPos.x - b.x, cameraPos.z - b.z) / 45));
    }
    this.shake = 1.4;
  }

  makePulse(pos, radius, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 96),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, pos.y + 0.05, pos.z);
    this.group.add(ring);
    return { ring, t: 0, radius };
  }

  spawnPad(pos, color) {
    const g = new THREE.Group();
    g.position.set(pos.x, pos.y + 0.02, pos.z);
    const steel = new THREE.MeshStandardMaterial({ color: '#4a4f55', metalness: 0.85, roughness: 0.35, transparent: true });
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 24), steel);
    plate.position.y = 0.4;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.06, 24), steel);
    const pts = [];
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      pts.push(new THREE.Vector3(Math.cos(t * Math.PI * 10) * 0.34, t * 0.38, Math.sin(t * Math.PI * 10) * 0.34));
    }
    const spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.03, 6), steel);
    g.add(plate, base, spring);
    this.group.add(g);
    this.pads.push({ g, plate, spring, mat: steel, t: 0 });
    this.dust.burst({ x: pos.x, y: pos.y + 0.1, z: pos.z }, '#6f6c66', 24, { speed: 3, up: 0.5, life: 0.8, gravity: 0, drag: 3 });
  }

  // ── 매 프레임
  update(dt, alpha, viewerTeam) {
    this.time += dt;
    const m = this.match;
    // 구매 시간 장벽: 구매 시간에만 (끝나면 빠르게 사라짐)
    const u = this.barrierMat.uniforms;
    u.uTime.value = this.time;
    u.uAlpha.value += ((m.phase === 'buy' && m.rounds ? 1 : 0) - u.uAlpha.value) * Math.min(1, dt * 6);
    this.barrierGroup.visible = u.uAlpha.value > 0.01;
    this.sparks.update(dt);
    this.dust.update(dt);
    this.smoke.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.flash = Math.max(0, this.flash - dt * 1.4);

    // 총알 궤적
    let n = 0;
    for (const p of m.projectiles) {
      if (n >= this.maxTracers) break;
      const off = this.tracerOffsets.get(p.id);
      let px = p.prev.x + (p.pos.x - p.prev.x) * alpha;
      let py = p.prev.y + (p.pos.y - p.prev.y) * alpha;
      let pz = p.prev.z + (p.pos.z - p.prev.z) * alpha;
      if (off) {
        off.k = (off.k ?? 1) - dt * 6;
        const k = Math.max(0, off.k);
        px += off.x * k;
        py += off.y * k;
        pz += off.z * k;
        if (k <= 0) this.tracerOffsets.delete(p.id);
      }
      const vx = p.vel.x, vy = p.vel.y, vz = p.vel.z;
      const speed = Math.hypot(vx, vy, vz);
      const len = p.harmless ? 0.08 : Math.min(2.4, Math.max(0.1, speed * 0.015));
      const width = p.harmless || p.inVeil ? 0.03 : 0.012;
      if (speed > 0.01) this.tmpQ.setFromUnitVectors(this.fwd, this.tmpV.set(vx / speed, vy / speed, vz / speed));
      this.tmpS.set(width, width, len);
      this.tmpM.compose(this.tmpV.set(px, py, pz), this.tmpQ, this.tmpS);
      this.tracers.setMatrixAt(n, this.tmpM);
      let col = '#ffd9a0';
      if (p.inVeil || p.harmless) col = PATCH_COLORS.gravityVeil;
      else if (p.bounced) col = PATCH_COLORS.reactionRounds;
      else if (p.amp) col = '#ffb15a';
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

    // 탄피 물리
    for (let i = 0; i < this.maxCasings; i++) {
      const c = this.casings[i];
      if (c.life > 0) {
        c.life -= dt;
        c.v.y -= 18 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt;
        c.r.z += c.w.z * dt;
        if (c.p.y < (c.floor ?? 0.01)) {
          c.p.y = c.floor ?? 0.01;
          if (Math.abs(c.v.y) > 0.6 && !c.bounced) this.onCasingBounce?.(c.p);
          c.bounced = true;
          c.v.y *= -0.35;
          c.v.x *= 0.6;
          c.v.z *= 0.6;
          c.w.multiplyScalar(0.5);
        }
        this.tmpQ.setFromEuler(c.r);
        this.tmpM.compose(c.p, this.tmpQ, this.tmpS.set(1, 1, 1));
      } else {
        this.tmpM.makeScale(0, 0, 0);
      }
      this.casingMesh.setMatrixAt(i, this.tmpM);
    }
    this.casingMesh.instanceMatrix.needsUpdate = true;

    this.updateVeils(dt);
    this.updateZones(dt);
    this.updateShields(dt);

    for (const pad of this.pads) {
      pad.t += dt;
      const t = pad.t;
      const sy = t < 0.06 ? 1 - (t / 0.06) * 0.7 : t < 0.18 ? 0.3 + ((t - 0.06) / 0.12) * 1.2 : 1.5 - Math.min(0.5, (t - 0.18) * 2.5);
      pad.spring.scale.y = sy;
      pad.plate.position.y = 0.38 * sy + 0.02;
      pad.mat.opacity = t > 1.0 ? Math.max(0, 1 - (t - 1.0) / 0.5) : 1;
    }
    this.pads = this.pads.filter((pad) => {
      if (pad.t < 1.5) return true;
      this.group.remove(pad.g);
      pad.g.traverse((o) => o.geometry?.dispose());
      pad.mat.dispose();
      return false;
    });

    for (const p of this.pulses) {
      p.t += dt;
      const r = Math.min(1, p.t / 0.9) * p.radius;
      p.ring.scale.set(r, r, r);
      p.ring.material.opacity = Math.max(0, 0.8 - p.t * 0.7);
    }
    this.pulses = this.pulses.filter((p) => {
      if (p.t < 1.2) return true;
      this.group.remove(p.ring);
      p.ring.geometry.dispose();
      p.ring.material.dispose();
      return false;
    });

    for (const b of this.blasts) {
      b.t += dt;
      b.light.intensity = Math.max(0, 900 * (1 - b.t / 1.2));
    }
    this.blasts = this.blasts.filter((b) => {
      if (b.t < 1.2) return true;
      this.lights?.remove(b.light);
      return false;
    });

    // 탐지된 적 표시: 보는 사람의 팀이 탐지한 적만
    m.agents.forEach((a, i) => {
      const s = this.markers[i];
      const show = a.alive && a.team !== viewerTeam && a.revealedUntil > m.time;
      s.visible = show;
      if (show) {
        s.position.set(a.pos.x, a.pos.y + 1.0 + (a.crouch ?? 0) * -0.3, a.pos.z);
        s.material.opacity = 0.65 + Math.sin(this.time * 10) * 0.25;
      }
    });

    for (const bv of this.bombs) bv.update(dt, this.time, m.timeLeft);
  }

  updateVeils(dt) {
    const live = new Set();
    for (const v of this.match.veils) {
      live.add(v.id);
      let e = this.veils.get(v.id);
      if (!e) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(v.radius, 40, 24), domeMaterial(PATCH_COLORS.gravityVeil));
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
      e.mesh.scale.setScalar(alive ? Math.min(1, 0.4 + e.fade * 0.6) : 1 + (1 - e.fade) * 0.1);
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

  updateShields(dt) {
    const live = new Set();
    for (const sh of this.match.shields) {
      live.add(sh.id);
      let e = this.shields.get(sh.id);
      if (!e) {
        e = this.makeShield(sh);
        this.shields.set(sh.id, e);
      }
      e.data = sh;
    }
    for (const [id, e] of this.shields) {
      const alive = live.has(id);
      e.fade = Math.max(0, Math.min(1, e.fade + (alive ? dt * 5 : -dt * 4)));
      const sh = e.data;
      e.root.position.set(sh.x, (sh.y0 + sh.y1) / 2 + Math.sin(this.time * 1.8 + id) * 0.04, sh.z);
      e.root.rotation.y = sh.yaw;
      e.root.rotation.z = Math.sin(this.time * 1.3 + id) * 0.015;
      e.root.scale.setScalar(0.6 + e.fade * 0.4);
      const hpf = Math.max(0, sh.hp / sh.maxHp);
      e.edge.color.setRGB(0.9 - hpf * 0.4, 0.3 + hpf * 0.4, 0.3 + hpf * 0.45);
      if (!alive && e.fade <= 0) {
        this.group.remove(e.root);
        e.root.traverse((o) => {
          o.geometry?.dispose();
          o.material?.dispose?.();
        });
        this.shields.delete(id);
      }
    }
  }

  makeShield(sh) {
    const root = new THREE.Group();
    const w = sh.halfW * 2, h = sh.y1 - sh.y0;
    // 방탄 판: 비쳐 보이는 강화 수지 판 (가까이 볼수록 더 투명) — 전개한 사람의 화면을 검게 가리지 않게.
    // 탄은 그대로 막고, 둘레의 틀·부력 장치·빛 띠로 판이 어디 있는지 알 수 있음
    const plate = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, 0.05, 2, 0.02),
      nearFade(new THREE.MeshStandardMaterial({ color: '#8fc2d2', metalness: 0.2, roughness: 0.06, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }), 0.5, 2.6),
    );
    plate.renderOrder = 2;
    const frameMat = new THREE.MeshStandardMaterial({ color: '#3a4046', metalness: 0.8, roughness: 0.4 });
    for (const [fw, fh, x, y] of [[w, 0.06, 0, h / 2 - 0.03], [w, 0.06, 0, -h / 2 + 0.03], [0.06, h, -w / 2 + 0.03, 0], [0.06, h, w / 2 - 0.03, 0]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.08), frameMat);
      bar.position.set(x, y, 0);
      root.add(bar);
    }
    const edge = new THREE.MeshStandardMaterial({ color: '#7fb2c4', emissive: '#7fb2c4', emissiveIntensity: 0.9 });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.03, 0.09), edge);
    strip.position.y = h / 2 - 0.08;
    root.add(plate, strip);
    // 네 귀퉁이 부력 장치
    for (const [x, y] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 12), new THREE.MeshStandardMaterial({ color: '#2a2e33', metalness: 0.6, roughness: 0.4 }));
      pod.rotation.x = Math.PI / 2;
      pod.position.set(x * 0.95, y * 0.95, 0);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12), edge);
      glow.position.set(x * 0.95, y * 0.95, 0.115);
      root.add(pod, glow);
    }
    this.group.add(root);
    return { root, edge, fade: 0 };
  }

  updateZones(dt) {
    const live = new Set();
    for (const z of this.match.zones) {
      live.add(z.id);
      let e = this.zones.get(z.id);
      if (!e) {
        e = this.makeZone(z);
        this.zones.set(z.id, e);
      }
      e.data = z;
    }
    for (const [id, e] of this.zones) {
      const alive = live.has(id);
      e.fade = Math.max(0, Math.min(1, e.fade + (alive ? dt * 5 : -dt * 3)));
      const z = e.data;
      if (e.disc) {
        const u = e.disc.material.uniforms;
        u.time.value = this.time;
        u.opacity.value = e.fade * (alive && z.t < 1 ? 0.6 + 0.4 * Math.sin(this.time * 20) : 1);
      }
      if (e.label) e.label.material.opacity = e.fade * 0.9;
      if (z.type === 'storm' && alive && Math.random() < dt * 40) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * z.radius;
        this.dust.burst({ x: z.x + Math.cos(a) * r, y: z.y + 0.3 + Math.random() * 1.5, z: z.z + Math.sin(a) * r }, '#8a7a5e', 2, { speed: 3, up: 0.3, life: 1.2, gravity: 0, drag: 0.5 });
      }
      if (z.type === 'collapse') {
        const pulse = 1 + Math.sin(this.time * 10) * 0.05;
        e.core.scale.setScalar(Math.max(0.001, e.fade * pulse));
        e.rim.material.uniforms.time.value = this.time;
        e.rim.material.uniforms.opacity.value = e.fade;
        e.rim.scale.setScalar(Math.max(0.001, e.fade * pulse * 1.25));
        e.ring.material.opacity = e.fade * (0.25 + 0.15 * Math.sin(this.time * 6));
        if (alive && Math.random() < dt * 30) this.dust.inward({ x: z.x, y: z.y, z: z.z }, '#3e3a44', 3, z.radius);
      }
      if (e.beams) {
        const pos = e.beams.geometry.attributes.position;
        let k = 0;
        for (const aid of z.captured ?? []) {
          const a = this.match.agentById(aid);
          if (!a?.alive || a.held?.zoneId !== z.id || k >= 8) continue;
          if (z.type === 'net') {
            // 그물: 붙잡힌 사람을 덮는 줄
            for (let s = 0; s < 6 && k < 8 * 6; s++) {
              const ang = (s / 6) * Math.PI * 2;
              pos.setXYZ(k * 2, a.pos.x + Math.cos(ang) * 0.9, a.pos.y + 0.05, a.pos.z + Math.sin(ang) * 0.9);
              pos.setXYZ(k * 2 + 1, a.pos.x, a.pos.y + 1.9, a.pos.z);
              k++;
            }
          } else {
            pos.setXYZ(k * 2, z.x, z.y, z.z);
            pos.setXYZ(k * 2 + 1, a.pos.x, a.pos.y + 1.1, a.pos.z);
            k++;
          }
        }
        e.beams.geometry.setDrawRange(0, k * 2);
        pos.needsUpdate = true;
        e.beams.material.opacity = e.fade * (z.type === 'net' ? 0.9 : 0.4 + 0.3 * Math.random());
      }
      if (!alive && e.fade <= 0) {
        this.group.remove(e.root);
        e.root.traverse((o) => {
          o.geometry?.dispose();
          if (o.material && !o.material.map) o.material.dispose?.();
        });
        this.zones.delete(id);
      }
    }
  }

  makeZone(z) {
    const root = new THREE.Group();
    const e = { root, fade: 0 };
    if (z.type === 'friction' || z.type === 'storm') {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(z.radius, 64), sheenMaterial(z.type === 'friction' ? PATCH_COLORS.frictionZero : PATCH_COLORS.frictionStorm));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(z.x, z.y + 0.03, z.z);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(z.type === 'friction' ? '마찰력 0' : '고마찰 구역', z.type === 'friction' ? PATCH_COLORS.frictionZero : PATCH_COLORS.frictionStorm), transparent: true, depthWrite: false }));
      label.scale.set(1.5, 0.34, 1);
      label.position.set(z.x, z.y + 2.2, z.z);
      root.add(disc, label);
      Object.assign(e, { disc, label });
    } else if (z.type === 'collapse') {
      // 검은 핵: 끌려가 가까이 붙은 사람의 화면을 가리지 않게 가까우면 투명해짐
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 16), nearFade(new THREE.MeshBasicMaterial({ color: '#030304', depthWrite: false }), 1.2, 3.0));
      core.position.set(z.x, z.y, z.z);
      const rim = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 16), domeMaterial(PATCH_COLORS.gravityCollapse));
      rim.position.copy(core.position);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(z.radius - 0.1, z.radius, 72),
        new THREE.MeshBasicMaterial({ color: PATCH_COLORS.gravityCollapse, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(z.x, (z.groundY ?? 0) + 0.04, z.z);
      root.add(core, rim, ring);
      Object.assign(e, { core, rim, ring });
    }
    if (z.type === 'collapse' || z.type === 'net') {
      const beamGeo = new THREE.BufferGeometry();
      beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 6 * 2 * 3), 3));
      const beams = new THREE.LineSegments(beamGeo, new THREE.LineBasicMaterial({ color: z.type === 'net' ? '#c2b38a' : PATCH_COLORS.gravityCollapse, transparent: true, depthWrite: false }));
      beams.frustumCulled = false;
      root.add(beams);
      e.beams = beams;
    }
    this.group.add(root);
    return e;
  }

  dispose() {
    this.scene.remove(this.group);
    // 광원 예산에서 이 경기의 광원(폭탄 경고등·폭발) 제거
    for (const v of this.bombs) this.lights?.remove(v.light);
    for (const b of this.blasts) this.lights?.remove(b.light);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        for (const mt of Array.isArray(o.material) ? o.material : [o.material]) {
          mt.map?.dispose();
          mt.dispose();
        }
      }
    });
  }
}

let markerTex = null;
function markerTexture() {
  if (markerTex) return markerTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#ffffff';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(32, 6);
  g.lineTo(58, 32);
  g.lineTo(32, 58);
  g.lineTo(6, 32);
  g.closePath();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(32, 32, 7, 0, Math.PI * 2);
  g.fill();
  markerTex = new THREE.CanvasTexture(c);
  return markerTex;
}
