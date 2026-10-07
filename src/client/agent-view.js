import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TEAM_INFO } from '../sim/constants.js';
import { camoTexture, labelTexture } from './textures.js';

// 팀별 전술 장비 색
const KIT = {
  defuse: { vest: '#23272d', helmet: '#3a424c', pouch: '#2b3038', boots: '#17191c', glove: '#1b1d20' },
  force: { vest: '#4b4634', helmet: '#6e6047', pouch: '#5a5340', boots: '#2a241c', glove: '#2b2620' },
};

const geoCache = new Map();
const cached = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};
const rbox = (w, h, d, r = 0.02) => cached(`rb${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, 2, r));
const capsule = (r, len) => cached(`cap${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const cyl = (r, h, seg = 12) => cached(`cyl${r}|${h}`, () => new THREE.CylinderGeometry(r, r, h, seg));

const camoCache = {};
const UP = new THREE.Vector3(0, 1, 0);

// 2관절 팔 IK: 어깨 S → 손 T, 팔꿈치는 pole 쪽으로 굽힘
function solveElbow(S, T, a, b, pole, out) {
  const d = Math.min(a + b - 1e-3, S.distanceTo(T));
  const u = new THREE.Vector3().subVectors(T, S).normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const v = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
  return out.copy(S).addScaledVector(u, a * cosA).addScaledVector(v, a * sinA);
}

function placeBetween(mesh, A, B) {
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, new THREE.Vector3().subVectors(B, A).normalize());
}

// 요원 한 명의 3D 모형 + 애니메이션 (걷기·앉기·기울이기·조준·락픽·쓰러짐)
export class AgentView {
  constructor(agent, { showTag }) {
    this.agent = agent;
    const team = agent.team;
    const kit = KIT[team];
    camoCache[team] ??= camoTexture(team);
    const camo = camoCache[team];
    const accent = TEAM_INFO[team].color;
    const M = {
      camo: new THREE.MeshStandardMaterial({ map: camo, roughness: 0.92 }),
      vest: new THREE.MeshStandardMaterial({ color: kit.vest, roughness: 0.85 }),
      pouch: new THREE.MeshStandardMaterial({ color: kit.pouch, roughness: 0.9 }),
      helmet: new THREE.MeshStandardMaterial({ color: kit.helmet, roughness: 0.75, metalness: 0.1 }),
      dark: new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.8 }),
      glove: new THREE.MeshStandardMaterial({ color: kit.glove, roughness: 0.85 }),
      boots: new THREE.MeshStandardMaterial({ color: kit.boots, roughness: 0.8 }),
      glass: new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.1, metalness: 0.8 }),
      gun: new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.45, metalness: 0.7 }),
      gunPoly: new THREE.MeshStandardMaterial({ color: '#2c2f34', roughness: 0.7, metalness: 0.15 }),
      band: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 }),
      strobe: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.2 }),
    };
    this.mats = M;
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    this.root = root;
    const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // ── 골반과 다리
    this.hips = new THREE.Group();
    this.hips.position.y = 0.98;
    root.add(this.hips);
    add(this.hips, rbox(0.34, 0.2, 0.22, 0.05), M.camo, 0, 0.02, 0);
    add(this.hips, rbox(0.37, 0.06, 0.25, 0.015), M.dark, 0, 0.11, 0);
    add(this.hips, rbox(0.1, 0.12, 0.06, 0.015), M.pouch, 0.16, 0.06, 0.06); // 허리 파우치
    this.legs = [-0.1, 0.1].map((x) => {
      const hip = new THREE.Group();
      hip.position.set(x, -0.05, 0);
      this.hips.add(hip);
      add(hip, capsule(0.078, 0.3), M.camo, 0, -0.21, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.43;
      hip.add(knee);
      add(knee, rbox(0.12, 0.13, 0.07, 0.025), M.dark, 0, 0.01, -0.07);
      add(knee, capsule(0.066, 0.28), M.camo, 0, -0.2, 0);
      const foot = new THREE.Group();
      foot.position.y = -0.43;
      knee.add(foot);
      add(foot, rbox(0.12, 0.11, 0.28, 0.035), M.boots, 0, -0.03, -0.05);
      return { hip, knee, foot };
    });
    add(this.legs[1].hip, rbox(0.05, 0.18, 0.1, 0.02), M.dark, 0.08, -0.2, 0); // 다리 권총집

    // ── 상체
    this.spine = new THREE.Group();
    this.spine.position.y = 0.1;
    this.hips.add(this.spine);
    add(this.spine, rbox(0.34, 0.44, 0.21, 0.07), M.camo, 0, 0.24, 0);
    add(this.spine, rbox(0.38, 0.36, 0.28, 0.04), M.vest, 0, 0.27, 0);
    for (const x of [-0.11, 0, 0.11]) add(this.spine, rbox(0.085, 0.13, 0.06, 0.012), M.pouch, x, 0.17, -0.16);
    add(this.spine, rbox(0.12, 0.1, 0.05, 0.012), M.pouch, -0.1, 0.36, -0.155); // 무전기
    add(this.spine, cyl(0.012, 0.18), M.dark, -0.12, 0.47, -0.15).rotation.z = 0.2; // 안테나
    add(this.spine, rbox(0.3, 0.34, 0.12, 0.04), M.pouch, 0, 0.25, 0.19); // 배낭
    add(this.spine, rbox(0.4, 0.05, 0.3, 0.015), M.dark, 0, 0.1, 0); // 조끼 아래 띠
    // 목·머리
    this.neck = new THREE.Group();
    this.neck.position.y = 0.49;
    this.spine.add(this.neck);
    add(this.neck, cyl(0.055, 0.1), M.dark, 0, 0.03, 0);
    this.head = new THREE.Group();
    this.head.position.y = 0.13;
    this.neck.add(this.head);
    add(this.head, new THREE.SphereGeometry(0.105, 16, 12), M.dark, 0, 0, 0); // 복면
    const helmet = add(this.head, new THREE.SphereGeometry(0.13, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.helmet, 0, 0.02, 0.005);
    helmet.scale.set(1, 0.95, 1.08);
    add(this.head, rbox(0.2, 0.055, 0.05, 0.02), M.glass, 0, 0.0, -0.095); // 고글
    add(this.head, rbox(0.05, 0.04, 0.04, 0.01), M.dark, 0, 0.09, -0.12); // 야간투시경 거치대
    for (const x of [-0.12, 0.12]) add(this.head, cyl(0.045, 0.04), M.dark, x, -0.01, 0).rotation.z = Math.PI / 2; // 헤드셋
    add(this.head, rbox(0.03, 0.02, 0.02, 0.006), M.strobe, 0, 0.13, 0.07); // 아군 식별등

    // ── 팔 (IK로 총을 잡음)
    this.upperLen = 0.28;
    this.foreLen = 0.27;
    this.arms = [-1, 1].map((side) => {
      const upper = add(this.spine, capsule(0.058, this.upperLen - 0.1), M.camo);
      const band = add(this.spine, cyl(0.064, 0.05), M.band);
      const fore = add(this.spine, capsule(0.052, this.foreLen - 0.09), M.camo);
      const hand = add(this.spine, rbox(0.075, 0.09, 0.1, 0.025), M.glove);
      return { side, upper, band, fore, hand, shoulder: new THREE.Vector3(side * 0.21, 0.42, 0) };
    });

    // ── 총 (가슴 높이, 앞을 향함)
    this.gun = new THREE.Group();
    this.gun.position.set(0.07, 0.3, -0.12);
    this.spine.add(this.gun);
    this.buildRifle();

    // 상태 효과 고리
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.025, 8, 40),
      new THREE.MeshBasicMaterial({ color: '#d9a25a', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    root.add(this.ring);

    if (showTag) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(agent.name, accent), depthTest: false, transparent: true, opacity: 0.85 }));
      tag.scale.set(0.95, 0.21, 1);
      tag.position.y = 2.15;
      tag.renderOrder = 10;
      root.add(tag);
      this.tag = tag;
    }

    this.walkPhase = Math.random() * 10;
    this.deathT = 0;
    this.flash = 0;
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
    this.weaponShown = null;
    this.tmp = { e: new THREE.Vector3(), t: new THREE.Vector3(), s: new THREE.Vector3() };
  }

  buildRifle() {
    const M = this.mats;
    const g = this.gun;
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    this.rifleParts = [
      add(rbox(0.055, 0.08, 0.36, 0.012), M.gun, 0, 0, -0.1),
      add(rbox(0.06, 0.065, 0.26, 0.012), M.gunPoly, 0, 0, -0.38),
      add(cyl(0.012, 0.16, 8), M.gun, 0, 0.005, -0.58),
      add(rbox(0.04, 0.14, 0.07, 0.01), M.gun, 0, -0.1, -0.15),
      add(rbox(0.045, 0.09, 0.2, 0.015), M.gunPoly, 0, -0.01, 0.16),
      add(rbox(0.04, 0.05, 0.09, 0.01), M.dark, 0, 0.07, -0.12),
    ];
    this.rifleParts[2].rotation.x = Math.PI / 2;
    this.rifleParts[3].rotation.x = 0.2;
    this.pistolParts = [add(rbox(0.035, 0.05, 0.18, 0.01), M.gun, 0, 0.02, -0.25), add(rbox(0.032, 0.1, 0.05, 0.01), M.gunPoly, 0, -0.04, -0.18)];
    this.pistolParts[1].rotation.x = -0.25;
    this.knifeParts = [add(rbox(0.008, 0.03, 0.18, 0.004), new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.9, roughness: 0.25 }), 0.12, -0.02, -0.18)];
    this.muzzle = new THREE.Object3D();
    g.add(this.muzzle);
  }

  // 무기에 따라 손 위치(척추 기준)를 바꿔 팔 자세 계산
  setWeapon(id) {
    this.weaponShown = id;
    for (const p of this.rifleParts) p.visible = id === 'rifle';
    for (const p of this.pistolParts) p.visible = id === 'pistol';
    for (const p of this.knifeParts) p.visible = id === 'knife';
    if (id === 'rifle') {
      this.grip = [new THREE.Vector3(0.06, 0.26, -0.46), new THREE.Vector3(0.07, 0.23, -0.12)];
      this.muzzle.position.set(0, 0.005, -0.67);
    } else if (id === 'pistol') {
      this.grip = [new THREE.Vector3(0.03, 0.26, -0.33), new THREE.Vector3(0.07, 0.27, -0.3)];
      this.muzzle.position.set(0, 0.02, -0.35);
    } else {
      this.grip = [new THREE.Vector3(-0.12, 0.12, -0.2), new THREE.Vector3(0.19, 0.27, -0.3)];
      this.muzzle.position.set(0.12, -0.02, -0.28);
    }
  }

  layoutArms(reload = 0) {
    const { e, t } = this.tmp;
    for (const arm of this.arms) {
      t.copy(this.grip[arm.side < 0 ? 0 : 1]);
      if (arm.side < 0 && reload > 0) t.lerp(new THREE.Vector3(0.02, 0.1, -0.16), Math.sin(reload * Math.PI)); // 재장전: 왼손이 탄창으로
      const pole = new THREE.Vector3(arm.side * 0.9, -1, 0.3);
      solveElbow(arm.shoulder, t, this.upperLen, this.foreLen, pole, e);
      placeBetween(arm.upper, arm.shoulder, e);
      placeBetween(arm.fore, e, t);
      arm.band.position.copy(arm.shoulder).lerp(e, 0.35);
      arm.band.quaternion.copy(arm.upper.quaternion);
      arm.hand.position.copy(t);
      arm.hand.quaternion.copy(arm.fore.quaternion);
    }
  }

  update(dt, alpha, time) {
    const a = this.agent;
    const r = this.root;
    r.position.set(
      a.prev.x + (a.pos.x - a.prev.x) * alpha,
      a.prev.y + (a.pos.y - a.prev.y) * alpha,
      a.prev.z + (a.pos.z - a.prev.z) * alpha,
    );
    r.rotation.y = a.yaw;
    if (this.weaponShown !== a.weapon) this.setWeapon(a.weapon);
    const speed = Math.hypot(a.vel.x, a.vel.z);

    if (!a.alive) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.6);
      const ease = t * t * (3 - 2 * t);
      r.rotation.x = ease * 1.45 * this.fallDir;
      r.position.y += ease * 0.12;
      this.hips.position.y = 0.98;
      this.spine.rotation.set(0, 0, 0);
      for (const l of this.legs) {
        l.hip.rotation.x = ease * 0.2 * this.fallDir;
        l.knee.rotation.x = -ease * 0.3;
      }
      this.ring.visible = false;
      if (this.tag) this.tag.visible = false;
      this.mats.strobe.emissiveIntensity = Math.max(0, 2.2 - this.deathT * 3);
      return;
    }
    r.rotation.x = 0;

    // ── 다리: 걷기·앉기·락픽(한쪽 무릎 꿇기)
    const moving = a.onGround && speed > 0.4;
    this.walkPhase += dt * (moving ? speed * 2.1 : 0);
    const sf = Math.min(1, speed / 5);
    const swing = moving ? Math.sin(this.walkPhase) * 0.55 * sf : 0;
    const k = Math.min(1, dt * 12);
    const c = a.lockpick ? 1 : a.crouch;
    const air = !a.onGround && !a.held;
    const legTargets = this.legs.map((_, i) => {
      const s = i === 0 ? swing : -swing;
      const kneeBend = moving ? -Math.max(0, Math.sin(this.walkPhase + (i === 0 ? 0.6 : 0.6 + Math.PI))) * 0.8 * sf : 0;
      let hip = s, knee = kneeBend;
      if (a.lockpick) {
        hip = i === 0 ? 1.35 : 0.05;
        knee = i === 0 ? -1.4 : -1.75;
      } else if (c > 0) {
        hip = hip * (1 - c) + c * (i === 0 ? 1.25 : 0.95);
        knee = knee * (1 - c) + c * (i === 0 ? -1.9 : -1.55);
      }
      if (air) {
        hip = i === 0 ? 0.6 : 0.15;
        knee = -0.9;
      }
      return { hip, knee };
    });
    this.legs.forEach((l, i) => {
      l.hip.rotation.x += (legTargets[i].hip - l.hip.rotation.x) * k;
      l.knee.rotation.x += (legTargets[i].knee - l.knee.rotation.x) * k;
      l.foot.rotation.x = -(l.hip.rotation.x + l.knee.rotation.x) * 0.8;
    });
    const hipY = 0.98 - c * 0.4 + (moving ? Math.abs(Math.cos(this.walkPhase)) * 0.025 * sf : 0);
    this.hips.position.y += (hipY - this.hips.position.y) * k;

    // ── 상체: 조준 각도·기울이기
    const lean = a.lean ?? 0;
    this.hips.position.x += (lean * 0.1 - this.hips.position.x) * k;
    this.spine.rotation.order = 'YXZ';
    const pitch = a.lockpick ? -0.6 : a.pitch;
    this.spine.rotation.x += (pitch * 0.75 + (c > 0.5 ? -0.12 : 0) - this.spine.rotation.x) * k;
    this.spine.rotation.z += (-lean * 0.5 - this.spine.rotation.z) * k;
    this.head.rotation.x = pitch * 0.25;
    const reload = a.reloadT > 0 ? 1 - a.reloadT / 2.4 : 0;
    this.gun.rotation.z = reload > 0 ? Math.sin(reload * Math.PI) * 0.6 : 0;
    this.layoutArms(reload);

    // 피격 반짝임 (어두운 붉은빛)
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mats.camo.emissive.setRGB(this.flash * 0.35, 0, 0);

    // 상태 효과 고리
    let ring = null;
    if (a.held) ring = '#9b7fd1';
    else if (a.mired) ring = '#a08860';
    else if (a.slippery) ring = '#8fd3e0';
    else if (a.ampT > 0) ring = '#d9a25a';
    this.ring.visible = !!ring;
    if (ring) {
      this.ring.material.color.set(ring);
      this.ring.position.y = 0.06 + Math.sin(time * 5) * 0.03;
      this.ring.rotation.z += dt * 2;
    }
  }

  hit() {
    this.flash = 1;
  }

  muzzleWorld(target) {
    return this.muzzle.getWorldPosition(target);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.material?.map && o.material.map !== camoCache[this.agent.team]) o.material.map.dispose();
    });
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
