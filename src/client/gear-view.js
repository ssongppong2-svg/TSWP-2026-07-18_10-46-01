import * as THREE from 'three';
import { GEAR, previewArc, throwVelocity } from '../sim/gear.js';
import { eyePos } from '../sim/agent.js';
import { dirFromAngles } from '../core/vec.js';
import { glowTexture, smokeTexture } from './textures.js';
import { BlastView } from './blast-view.js';

// 투척·폭발 장비의 3D 모습
//   날아가는 투척물 · 붙여 둔 C4(빨간 불이 깜빡임) · 연막(회색 연기 덩어리)·최루(누런 연기)
//   세열·C4 폭발(불꽃·먼지·빛) · 섬광(하얀 번쩍) · 이명(충격 고리)
//   손에 투척물을 들고 있으면 날아갈 길(포물선)과 떨어질 곳을 미리 보여 줌 — 중력 때문에 휘어지는 길
const BODY = {
  frag: { color: '#4a5236', r: 0.045, s: [1, 1.2, 1] },
  stun: { color: '#2c2f33', r: 0.035, s: [1, 2.2, 1] },
  flash: { color: '#8d939a', r: 0.035, s: [1, 2.2, 1] },
  smoke: { color: '#55613f', r: 0.042, s: [1, 2.2, 1] },
  gas: { color: '#b7a03a', r: 0.042, s: [1, 2.2, 1] },
  emp: { color: '#3d5a78', r: 0.04, s: [1, 2.1, 1] },
  cam: { color: '#25282c', r: 0.05, s: [1, 0.75, 1] },
};
// 심장 박동 표시 (벽 너머로 보이는 붉은 하트 · 박동마다 커졌다 작아짐)
function heartTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const glow = g.createRadialGradient(32, 32, 4, 32, 32, 31);
  glow.addColorStop(0, 'rgba(255,90,80,0.55)');
  glow.addColorStop(1, 'rgba(255,90,80,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ff5a4f';
  g.beginPath();
  g.moveTo(32, 48);
  g.bezierCurveTo(14, 36, 14, 18, 25, 18);
  g.bezierCurveTo(29, 18, 32, 22, 32, 25);
  g.bezierCurveTo(32, 22, 35, 18, 39, 18);
  g.bezierCurveTo(50, 18, 50, 36, 32, 48);
  g.fill();
  g.strokeStyle = 'rgba(255,230,225,0.9)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(17, 31);
  g.lineTo(26, 31);
  g.lineTo(29, 25);
  g.lineTo(33, 38);
  g.lineTo(36, 30);
  g.lineTo(47, 30);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const CLOUD = {
  smoke: { color: '#b9bcbf', puffs: 58, size: 2.7, opacity: 0.7 },
  gas: { color: '#b8b57a', puffs: 30, size: 2.2, opacity: 0.38 },
};

export class GearView {
  constructor(scene, match, effects, lights = null) {
    this.scene = scene;
    this.match = match;
    this.effects = effects;
    this.lights = lights;
    this.group = new THREE.Group();
    this.group.name = 'gear';
    scene.add(this.group);
    this.time = 0;
    this.smokeMap = smokeTexture();
    this.glowMap = glowTexture();
    this.things = new Map(); // 투척물 id → mesh
    this.c4s = new Map(); // C4 id → { root, led }
    this.clouds = new Map(); // 연막·최루 구역 id → { root, puffs }
    this.droneViews = new Map(); // 드론 id → { root, rotors, led } · RC카 id → { root, wheels, led }
    this.camViews = new Map(); // 던진 카메라 id → { root, head, led }
    this.alarmViews = new Map(); // 경보 센서 id → { root, beam, led }
    this.hearts = []; // 심장 박동 표시 (재사용)
    this.heartMap = heartTexture();
    this.heartBeat = 0;
    this.pops = []; // 섬광·이명·폭발 빛 (잠깐)
    this.geo = new THREE.SphereGeometry(1, 12, 8);
    this.mats = Object.fromEntries(Object.entries(BODY).map(([k, b]) => [k, new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.55, metalness: 0.3 })]));
    // 포물선 미리 보기: 멀리(밝은 실선) · 가까이(흐린 점선) + 떨어질 곳 고리
    const arc = (color, opacity, dashed) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(120 * 3), 3));
      const m = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.18, gapSize: 0.14, depthWrite: false })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      const l = new THREE.Line(g, m);
      l.frustumCulled = false;
      l.visible = false;
      l.renderOrder = 5;
      this.group.add(l);
      return l;
    };
    this.arcLong = arc('#9fdfe8', 0.85, false);
    this.arcShort = arc('#9fdfe8', 0.4, true);
    this.landMark = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 32),
      new THREE.MeshBasicMaterial({ color: '#9fdfe8', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.landMark.visible = false;
    this.landMark.renderOrder = 5;
    this.group.add(this.landMark);
    this.tmpV = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    // 세열·C4 폭발 연출 (불덩이·충격파·파편·그을음)
    this.blasts = new BlastView(scene, match.map, effects, lights);
  }

  // 터짐: 종류별 효과. cameraPos = 보는 사람 눈 (가까우면 화면이 흔들림)
  onDetonate(e, cameraPos) {
    const p = { x: e.x, y: e.y, z: e.z };
    const fx = this.effects;
    const near = cameraPos ? Math.hypot(cameraPos.x - p.x, cameraPos.y - p.y, cameraPos.z - p.z) : 99;
    if (e.kind === 'frag' || e.kind === 'c4') {
      // 플라스마 폭발: 흰빛·주황 불티 + 보랏빛 파편 + 어두운 보랏빛 먼지
      //   (불덩이·충격파·달궈진 파편·그을음·폭발 빛은 BlastView)
      const big = e.kind === 'c4' ? 1.4 : 1;
      fx.sparks.burst(p, '#ffd9a8', Math.round(70 * big), { speed: 13 * big, up: 2, life: 0.9, gravity: 6, spread: 1.4 });
      fx.sparks.burst(p, '#c39bff', Math.round(50 * big), { speed: 10 * big, up: 2, life: 0.8, gravity: 2, spread: 1.5 });
      fx.dust.burst(p, '#2f2a3a', Math.round(60 * big), { speed: 7 * big, up: 2, life: 2.4, gravity: 0.6, spread: 1.3, drag: 1.4 });
      fx.smoke.burst(p, '#2a2734', Math.round(10 * big), { speed: 3, up: 2.2, life: 3.5, gravity: -0.6, spread: 1, drag: 0.9 });
      this.blasts?.spawn(e, e.kind);
      if (near < 18) fx.shake = Math.max(fx.shake, (1 - near / 18) * 1.2 * big);
    } else if (e.kind === 'flash') {
      fx.sparks.burst(p, '#ffffff', 40, { speed: 6, up: 1, life: 0.25, gravity: 0 });
      this.pop(p, '#ffffff', 1400, 30, 0.35);
      fx.smoke.burst(p, '#8a8a8a', 6, { speed: 0.6, up: 0.6, life: 2, gravity: -0.3, drag: 1 });
    } else if (e.kind === 'stun') {
      fx.sparks.burst(p, '#ffe2b0', 24, { speed: 5, up: 1, life: 0.2, gravity: 0 });
      this.pop(p, '#ffd9a0', 500, 18, 0.25);
      const ring = fx.makePulse({ x: p.x, y: p.y - 0.1, z: p.z }, GEAR.stun.radius, '#ffe2b0');
      fx.pulses.push(ring);
      fx.smoke.burst(p, '#77736c', 8, { speed: 1, up: 0.8, life: 2, gravity: -0.3, drag: 1 });
      if (near < 10) fx.shake = Math.max(fx.shake, 0.4);
    } else if (e.kind === 'smoke' || e.kind === 'gas') {
      fx.dust.burst(p, e.kind === 'gas' ? '#a6a46d' : '#9fa2a5', 18, { speed: 2.5, up: 1, life: 1.2, gravity: 0, drag: 2 });
    } else if (e.kind === 'emp') {
      // 전자기 펄스: 푸른 번쩍임 + 퍼지는 고리 + 지직거리는 불꽃
      fx.sparks.burst(p, '#9fd2ff', 60, { speed: 7, up: 1.5, life: 0.35, gravity: 0, spread: 1.6 });
      fx.sparks.burst(p, '#ffffff', 16, { speed: 3, up: 0.5, life: 0.2, gravity: 0 });
      this.pop(p, '#6fb8ff', 700, 22, 0.45);
      fx.pulses.push(fx.makePulse({ x: p.x, y: p.y - 0.1, z: p.z }, GEAR.emp.radius, '#7fc4ff'));
      fx.smoke.burst(p, '#5b6470', 6, { speed: 0.8, up: 0.6, life: 1.6, gravity: -0.3, drag: 1 });
      if (near < 9) fx.shake = Math.max(fx.shake, 0.25);
    }
  }

  // 카메라·경보 센서가 부서짐: 불꽃 + 파편
  onBroken(e) {
    const p = { x: e.x, y: e.y, z: e.z };
    this.effects.sparks.burst(p, '#a8ecff', 18, { speed: 3, up: 1, life: 0.45, gravity: 9 });
    this.effects.dust.burst(p, '#2c2f33', 8, { speed: 2, up: 1, life: 0.8, gravity: 6 });
  }

  // 짧게 번쩍이는 빛 (광원 예산에서 먼저 배정)
  pop(p, color, intensity, distance, dur) {
    const light = { pos: new THREE.Vector3(p.x, p.y + 0.5, p.z), color: new THREE.Color(color), intensity, distance, priority: 5 };
    this.lights?.add(light);
    this.pops.push({ light, t: 0, dur, peak: intensity });
  }

  // 손에 든 투척물의 날아갈 길
  updateArc(agent, show) {
    this.arcLong.visible = this.arcShort.visible = this.landMark.visible = false;
    if (!show || !agent?.alive || (agent.equip?.kind !== 'throw' && agent.equip?.kind !== 'cam')) return;
    const eye = eyePos(agent);
    const dir = dirFromAngles(agent.yaw, agent.pitch);
    const start = { x: eye.x + dir.x * 0.35, y: eye.y - 0.1 + dir.y * 0.35, z: eye.z + dir.z * 0.35 };
    const draw = (line, mode) => {
      const { pts, land } = previewArc(this.match.map, start, throwVelocity(dir, mode, agent.vel), { dt: 1 / 30, maxT: 3 });
      const pos = line.geometry.attributes.position;
      const n = Math.min(pts.length, 120);
      // 눈앞 처음 몇 점은 화면을 가리므로 빼고 그림
      const skip = Math.min(3, n - 2);
      for (let i = skip; i < n; i++) pos.setXYZ(i - skip, pts[i].x, pts[i].y, pts[i].z);
      line.geometry.setDrawRange(0, Math.max(0, n - skip));
      pos.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      if (line.material.isLineDashedMaterial) line.computeLineDistances();
      line.visible = true;
      return land;
    };
    const land = draw(this.arcLong, 'long');
    draw(this.arcShort, 'short');
    this.landMark.position.set(land.x, land.y + 0.03, land.z);
    this.tmpV.set(land.nx ?? 0, land.ny ?? 1, land.nz ?? 0);
    this.landMark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.tmpV);
    const s = 1 + Math.sin(this.time * 6) * 0.08;
    this.landMark.scale.set(s, s, s);
    this.landMark.visible = true;
  }

  // 정찰 드론 모형: 몸통 + 팔 4개 + 도는 프로펠러 + 카메라 + 팀색 불빛
  makeDrone(d) {
    const root = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.5, metalness: 0.4 });
    const shell = new THREE.MeshStandardMaterial({ color: '#4b5058', roughness: 0.45, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.22), shell);
    const cam = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: '#0d1013', roughness: 0.1, metalness: 0.6 }));
    cam.position.set(0, -0.03, -0.1);
    root.add(body, cam);
    const rotors = [];
    const blade = new THREE.MeshBasicMaterial({ color: '#9aa2aa', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.2), dark);
      arm.position.set(x * 0.08, 0.01, z * 0.08);
      arm.rotation.y = Math.atan2(x, z);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 10), dark);
      motor.position.set(x * 0.15, 0.025, z * 0.15);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.085, 20), blade);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x * 0.15, 0.045, z * 0.15);
      root.add(arm, motor, disc);
      rotors.push(disc);
    }
    const team = this.match.agentById(d.ownerId)?.squad;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: team === 'force' ? '#e08a3c' : '#5ec4d6' }));
    led.position.set(0, 0.035, 0.1);
    root.add(led);
    this.group.add(root);
    return { root, rotors, led };
  }

  // RC카: 낮은 차체 + 바퀴 4개 + 카메라 기둥 + 안테나 + 팀색 불빛 (원점 = 바퀴가 닿는 바닥)
  makeRC(d) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const shell = new THREE.MeshStandardMaterial({ color: '#3d4247', roughness: 0.5, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: '#16181a', roughness: 0.75 });
    const tire = new THREE.MeshStandardMaterial({ color: '#0f1011', roughness: 0.95 });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.3), shell);
    chassis.position.y = 0.075;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.035, 0.16), dark);
    deck.position.set(0, 0.115, 0.02);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), shell);
    mast.position.set(0, 0.15, -0.09);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 12), new THREE.MeshStandardMaterial({ color: '#0d1013', roughness: 0.1, metalness: 0.6 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.155, -0.12);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.16, 5), dark);
    ant.position.set(0.06, 0.2, 0.11);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.025, 0.02), dark);
    bumper.position.set(0, 0.06, -0.16);
    body.add(chassis, deck, mast, lens, ant, bumper);
    const wheels = [];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14), tire);
      w.rotation.z = Math.PI / 2;
      w.position.set(x * 0.115, 0.045, z * 0.1);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.042, 8), shell);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(w.position);
      root.add(w, hub);
      wheels.push(w);
    }
    const team = this.match.agentById(d.ownerId)?.squad;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), new THREE.MeshBasicMaterial({ color: team === 'force' ? '#e08a3c' : '#5ec4d6' }));
    led.position.set(0, 0.14, 0.1);
    body.add(led);
    this.group.add(root);
    return { root, body, wheels, led, rc: true, spin: 0 };
  }

  // 던진 카메라: 붙은 면에 받침 + 돔 + 렌즈 (렌즈는 보는 방향으로 돎) · 초록 불빛(EMP면 꺼짐)
  makeCam(c) {
    const root = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: '#25282c', roughness: 0.55, metalness: 0.3 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 16), dark);
    base.position.y = 0.01;
    const head = new THREE.Group();
    head.position.y = 0.04;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3a3f45', roughness: 0.3, metalness: 0.4 }));
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.03, 12), new THREE.MeshStandardMaterial({ color: '#07090b', roughness: 0.05, metalness: 0.7 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.018, -0.04);
    head.add(dome, lens);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), new THREE.MeshBasicMaterial({ color: '#5cff9a' }));
    led.position.set(0.03, 0.03, -0.02);
    head.add(led);
    root.add(base, head);
    root.position.set(c.x, c.y, c.z);
    root.quaternion.setFromUnitVectors(this.up, this.tmpV.set(c.nx, c.ny, c.nz).normalize());
    this.group.add(root);
    return { root, head, led };
  }

  // 경보 센서: 벽에 붙은 작은 상자 + 렌즈 + 맞은편까지 붉은 레이저 줄 (적에게는 아주 희미하게)
  makeAlarm(al, mine) {
    const root = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.035), new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.6, metalness: 0.3 }));
    box.position.z = 0.0175;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.012, 12), new THREE.MeshBasicMaterial({ color: '#ff3a26' }));
    lens.position.z = 0.0355;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 4), new THREE.MeshBasicMaterial({ color: '#5cff9a' }));
    led.position.set(0.024, 0.015, 0.036);
    root.add(box, lens, led);
    root.position.set(al.x, al.y, al.z);
    root.lookAt(al.x + al.nx, al.y, al.z + al.nz);
    this.group.add(root);
    const len = Math.hypot(al.ex - al.x, al.ez - al.z);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#ff2a18', transparent: true, opacity: mine ? 0.55 : 0.16, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, 5, 1, true), beamMat);
    beam.position.set((al.x + al.ex) / 2, al.y, (al.z + al.ez) / 2);
    beam.quaternion.setFromUnitVectors(this.up, this.tmpV.set(al.ex - al.x, 0, al.ez - al.z).normalize());
    this.group.add(beam);
    return { root, beam, led, lens, base: beamMat.opacity };
  }

  // 심장 박동: 박동(0.6초)마다 커졌다 사라지는 하트 (벽 너머로 보임)
  updateHearts(dt, hits) {
    this.heartBeat = (this.heartBeat + dt) % 0.6;
    const k = this.heartBeat / 0.6;
    const scale = 0.32 * (1 + Math.max(0, 0.35 - k) * 1.6);
    for (let i = 0; i < Math.max(hits.length, this.hearts.length); i++) {
      let s = this.hearts[i];
      if (!s && i < hits.length) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.heartMap, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
        s.renderOrder = 20;
        this.group.add(s);
        this.hearts.push(s);
      }
      if (!s) continue;
      const h = hits[i];
      s.visible = !!h;
      if (!h) continue;
      s.position.set(h.x, h.y + 1.2, h.z);
      s.scale.setScalar(scale);
      s.material.opacity = 0.95 - k * 0.45;
    }
  }

  update(dt, alpha, hideDrone = null, { viewer = null, pulseHits = null } = {}) {
    this.time += dt;
    const m = this.match;
    this.updateHearts(dt, pulseHits ?? []);
    // 정찰 드론 · RC카
    const dseen = new Set();
    for (const d of m.drones ?? []) {
      dseen.add(d.id);
      let v = this.droneViews.get(d.id);
      if (!v) {
        v = d.kind === 'rc' ? this.makeRC(d) : this.makeDrone(d);
        this.droneViews.set(d.id, v);
      }
      const pv = d.prev ?? d.pos;
      if (v.rc) {
        // 바퀴는 달린 거리만큼 돎 · 달리면 차체가 살짝 뒤로 들림 · 공중이면 앞이 숙여짐
        v.root.position.set(pv.x + (d.pos.x - pv.x) * alpha, pv.y + (d.pos.y - pv.y) * alpha, pv.z + (d.pos.z - pv.z) * alpha);
        v.root.rotation.set(0, d.yaw, 0);
        const sp = Math.hypot(d.vel?.x ?? 0, d.vel?.z ?? 0);
        const fwd = (d.vel?.x ?? 0) * -Math.sin(d.yaw) + (d.vel?.z ?? 0) * -Math.cos(d.yaw);
        v.spin += (fwd / 0.045) * dt;
        for (const w of v.wheels) w.rotation.x = -v.spin;
        v.body.rotation.x = d.onGround === false ? -0.15 : Math.min(0.06, sp * 0.008) + Math.sin(this.time * 40) * 0.004 * Math.min(1, sp);
        v.led.visible = Math.sin(this.time * 9) > -0.3;
        v.root.visible = d.id !== hideDrone;
        continue;
      }
      v.root.position.set(pv.x + (d.pos.x - pv.x) * alpha, pv.y + (d.pos.y - pv.y) * alpha + Math.sin(this.time * 7 + d.id) * 0.01, pv.z + (d.pos.z - pv.z) * alpha);
      v.root.rotation.set(0, d.yaw, 0);
      // 앞으로 날면 앞으로 기울어짐 (프로펠러가 미는 힘의 방향)
      v.root.rotateX(-Math.min(0.35, Math.hypot(d.vel?.x ?? 0, d.vel?.z ?? 0) * 0.05));
      for (const r of v.rotors) r.rotation.z += dt * 60;
      v.led.visible = Math.sin(this.time * 9) > -0.3;
      v.root.visible = d.id !== hideDrone;
    }
    for (const [id, v] of this.droneViews) {
      if (dseen.has(id)) continue;
      this.group.remove(v.root);
      this.droneViews.delete(id);
    }
    // 던진 카메라: 누가 보고 있으면 렌즈가 그쪽으로 (보는 사람이 나면 숨김 — 카메라 안이니까)
    const viewers = new Map(m.agents.filter((a) => a.alive && a.camView).map((a) => [a.camView.id, a]));
    const cseen2 = new Set();
    for (const c of m.gadgets?.cams ?? []) {
      cseen2.add(c.id);
      let v = this.camViews.get(c.id);
      if (!v) {
        v = this.makeCam(c);
        this.camViews.set(c.id, v);
      }
      const off = (c.offUntil ?? -99) > m.time;
      v.led.material.color.set(off ? (Math.random() < 0.15 ? '#9fd2ff' : '#111') : viewers.has(c.id) ? '#ff3a26' : '#5cff9a');
      const who = viewers.get(c.id);
      if (who) {
        // 카메라 받침 좌표계에서 보는 방향 (보는 사람 방향을 받침 기준으로 돌림)
        const yaw = who.camView.yaw, pitch = who.camView.pitch;
        const dir = this.tmpV.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        dir.applyQuaternion(v.root.quaternion.clone().invert());
        v.head.rotation.y = Math.atan2(-dir.x, -dir.z);
      }
      v.root.visible = viewer?.camView?.id !== c.id;
    }
    for (const [id, v] of this.camViews) {
      if (cseen2.has(id)) continue;
      this.group.remove(v.root);
      this.camViews.delete(id);
    }
    // 경보 센서: 레이저는 우리 팀에게 또렷하게, 상대에게는 희미하게 (가까이 보면 보임) · 울리면 깜빡 · EMP면 꺼짐
    const aseen = new Set();
    const myTeam = viewer?.team;
    for (const al of m.gadgets?.alarms ?? []) {
      aseen.add(al.id);
      let v = this.alarmViews.get(al.id);
      if (!v) {
        v = this.makeAlarm(al, al.team === myTeam);
        this.alarmViews.set(al.id, v);
      }
      const off = (al.offUntil ?? -99) > m.time;
      const hot = m.time - (al.trippedT ?? -99) < 1.2;
      v.beam.visible = !off;
      v.beam.material.opacity = hot ? (Math.sin(this.time * 30) > 0 ? 0.9 : 0.25) : v.base * (0.85 + Math.sin(this.time * 3 + al.id) * 0.15);
      v.lens.material.color.set(off ? '#220806' : '#ff3a26');
      v.led.material.color.set(off ? (Math.random() < 0.15 ? '#9fd2ff' : '#111') : hot ? '#ff3a26' : '#5cff9a');
    }
    for (const [id, v] of this.alarmViews) {
      if (aseen.has(id)) continue;
      this.group.remove(v.root, v.beam);
      v.beam.geometry.dispose();
      v.beam.material.dispose();
      this.alarmViews.delete(id);
    }
    // 날아가는·굴러가는 투척물
    const seen = new Set();
    for (const t of m.throwables ?? []) {
      seen.add(t.id);
      let mesh = this.things.get(t.id);
      if (!mesh) {
        const b = BODY[t.kind] ?? BODY.frag;
        mesh = new THREE.Mesh(this.geo, this.mats[t.kind] ?? this.mats.frag);
        mesh.scale.set(b.r * b.s[0], b.r * b.s[1], b.r * b.s[2]);
        mesh.castShadow = false;
        this.group.add(mesh);
        this.things.set(t.id, mesh);
      }
      const px = t.prev ? t.prev.x + (t.pos.x - t.prev.x) * alpha : t.pos.x;
      const py = t.prev ? t.prev.y + (t.pos.y - t.prev.y) * alpha : t.pos.y;
      const pz = t.prev ? t.prev.z + (t.pos.z - t.prev.z) * alpha : t.pos.z;
      mesh.position.set(px, py, pz);
      if (!t.rest) {
        mesh.rotation.x += dt * 9;
        mesh.rotation.z += dt * 5;
      } else if (t.kind === 'smoke' || t.kind === 'gas') {
        // 터지기 직전 깡통에서 연기가 새어 나옴
        if (Math.random() < dt * 20) this.effects.smoke.burst({ x: px, y: py + 0.05, z: pz }, t.kind === 'gas' ? '#a6a46d' : '#9fa2a5', 1, { speed: 0.6, up: 0.8, life: 1, gravity: -0.4, drag: 1 });
      }
    }
    for (const [id, mesh] of this.things) {
      if (seen.has(id)) continue;
      this.group.remove(mesh);
      this.things.delete(id);
    }
    // 붙여 둔 C4: 빨간 불이 깜빡임 (기폭 준비가 되면 빨리)
    const cseen = new Set();
    for (const c of m.charges ?? []) {
      cseen.add(c.id);
      let v = this.c4s.get(c.id);
      if (!v) {
        v = this.makeCharge(c);
        this.c4s.set(c.id, v);
      }
      const ready = (c.armAt ?? 0) <= m.time;
      v.led.material.color.set(Math.sin(this.time * (ready ? 14 : 5)) > 0 ? '#ff3a26' : '#3a0b08');
      // 문에 붙인 C4는 문을 따라 움직임
      v.root.position.set(c.x, c.y, c.z);
      v.root.quaternion.setFromUnitVectors(this.up, this.tmpV.set(c.nx ?? 0, c.ny ?? 1, c.nz ?? 0).normalize());
    }
    for (const [id, v] of this.c4s) {
      if (cseen.has(id)) continue;
      this.group.remove(v.root);
      this.c4s.delete(id);
    }
    // 연막·최루 연기
    const zseen = new Set();
    for (const z of m.zones) {
      if (z.type !== 'smoke' && z.type !== 'gas') continue;
      zseen.add(z.id);
      let c = this.clouds.get(z.id);
      if (!c) {
        c = this.makeCloud(z);
        this.clouds.set(z.id, c);
      }
      c.data = z;
      c.alive = true;
    }
    for (const [id, c] of this.clouds) {
      if (!zseen.has(id)) c.alive = false;
      const z = c.data;
      // 피어오름(2.5초) → 유지 → 걷힘(마지막 2초 · 끝난 뒤 1.5초)
      c.fade = c.alive ? Math.min(1, z.age / 2.5) * Math.min(1, z.t / 2 + 0.25) : Math.max(0, (c.fade ?? 1) - dt / 1.5);
      const spread = c.alive ? Math.min(1, 0.35 + z.age / 2.5) : 1 + (1 - c.fade) * 0.3;
      for (const p of c.puffs) {
        p.ang += p.spin * dt;
        p.s.position.set(z.x + p.x * spread + Math.sin(this.time * 0.3 + p.ph) * 0.15, z.y + p.y * Math.min(1, spread * 1.1) + Math.sin(this.time * 0.5 + p.ph) * 0.06, z.z + p.z * spread);
        p.s.material.opacity = c.cfg.opacity * c.fade * p.k;
        p.s.material.rotation = p.ang;
      }
      if (!c.alive && c.fade <= 0) {
        this.group.remove(c.root);
        for (const p of c.puffs) p.s.material.dispose();
        this.clouds.delete(id);
      }
    }
    // 번쩍이는 빛
    this.pops = this.pops.filter((p) => {
      p.t += dt;
      p.light.intensity = Math.max(0, p.peak * (1 - p.t / p.dur));
      if (p.t < p.dur) return true;
      this.lights?.remove(p.light);
      return false;
    });
  }

  makeCharge(c) {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.11), new THREE.MeshStandardMaterial({ color: '#c9b58c', roughness: 0.9 }));
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.062, 0.112), new THREE.MeshStandardMaterial({ color: '#2b3a52', roughness: 0.8 }));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.05), new THREE.MeshStandardMaterial({ color: '#2c2f33', roughness: 0.5, metalness: 0.3 }));
    box.position.y = 0.045;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3a26' }));
    led.position.set(0.015, 0.064, 0.012);
    root.add(body, tape, box, led);
    root.position.set(c.x, c.y, c.z);
    // 붙은 면의 바깥쪽이 위(+y)가 되게
    root.quaternion.setFromUnitVectors(this.up, this.tmpV.set(c.nx ?? 0, c.ny ?? 1, c.nz ?? 0).normalize());
    this.group.add(root);
    return { root, led };
  }

  makeCloud(z) {
    const cfg = CLOUD[z.type];
    const root = new THREE.Group();
    const puffs = [];
    for (let i = 0; i < cfg.puffs; i++) {
      // 반구 안에 고르게: 아래쪽이 두껍게 (바닥에 깔림)
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * z.radius * 0.9;
      const h = Math.pow(Math.random(), 1.4) * 2.6 + 0.5;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeMap, color: cfg.color, transparent: true, depthWrite: false, opacity: 0 }));
      const size = cfg.size * (0.75 + Math.random() * 0.6);
      s.scale.set(size, size, 1);
      root.add(s);
      puffs.push({ s, x: Math.cos(a) * r, y: h, z: Math.sin(a) * r, ang: Math.random() * 6, spin: (Math.random() - 0.5) * 0.25, ph: Math.random() * 6, k: 0.65 + Math.random() * 0.35 });
    }
    this.group.add(root);
    return { root, puffs, cfg, data: z, alive: true, fade: 0 };
  }

  dispose() {
    this.blasts.dispose();
    for (const p of this.pops) this.lights?.remove(p.light);
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material && !Object.values(this.mats).includes(o.material)) o.material.dispose?.();
    });
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
