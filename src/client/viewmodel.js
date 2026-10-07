import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPONS } from '../sim/data.js';
import { camoTexture, flashTexture } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const rb = (w, h, d, r = 0.004) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));

// 스프링-감쇠 (총의 관성·반동 복원용)
class Spring {
  constructor(k = 120, c = 16) {
    this.k = k;
    this.c = c;
    this.x = new THREE.Vector3();
    this.v = new THREE.Vector3();
  }
  impulse(v) {
    this.v.add(v);
  }
  step(dt, target = null) {
    const f = this.x.clone().multiplyScalar(-this.k).addScaledVector(this.v, -this.c);
    if (target) f.addScaledVector(target, this.k);
    this.v.addScaledVector(f, dt);
    this.x.addScaledVector(this.v, dt);
  }
}

// 1인칭 팔과 총. 별도 장면/카메라에 그려 벽에 총이 파묻히지 않게 하고, 화면 처리(렌즈·노이즈)는 함께 받는다.
export class ViewModel {
  constructor(team) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#7f8ea6', '#1a1510', 0.5));
    this.key = new THREE.DirectionalLight('#ffd9a8', 0.8);
    this.key.position.set(0.6, 1.4, 0.6);
    this.scene.add(this.key);
    const fill = new THREE.DirectionalLight('#9fb6d8', 0.28);
    fill.position.set(-1, 0.4, -0.5);
    this.scene.add(fill);
    this.muzzleLight = new THREE.PointLight('#ffb866', 0, 2.5, 2);
    this.scene.add(this.muzzleLight);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    const camo = camoTexture(team);
    this.mats = {
      metal: new THREE.MeshStandardMaterial({ color: '#2c3035', roughness: 0.5, metalness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: '#1c1e21', roughness: 0.55, metalness: 0.5 }),
      polymer: new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.75, metalness: 0.08 }),
      tan: new THREE.MeshStandardMaterial({ color: team === 'force' ? '#6e6047' : '#3c444e', roughness: 0.7, metalness: 0.1 }),
      glove: new THREE.MeshStandardMaterial({ color: '#202225', roughness: 0.82 }),
      gloveHard: new THREE.MeshStandardMaterial({ color: '#2f3237', roughness: 0.45, metalness: 0.2 }),
      sleeve: new THREE.MeshStandardMaterial({ map: camo, roughness: 0.92 }),
      skin: new THREE.MeshStandardMaterial({ color: '#8a6a55', roughness: 0.7 }),
      steel: new THREE.MeshStandardMaterial({ color: '#b6bcc2', roughness: 0.22, metalness: 0.95 }),
      brass: new THREE.MeshStandardMaterial({ color: '#b58a3c', roughness: 0.35, metalness: 0.9 }),
      glass: new THREE.MeshStandardMaterial({ color: '#1e2c33', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.35 }),
      dot: new THREE.MeshBasicMaterial({ color: '#ff3b2f' }),
      tritium: new THREE.MeshBasicMaterial({ color: '#7dff8a' }),
      accent: new THREE.MeshStandardMaterial({ color: team === 'force' ? '#b8742f' : '#3f8796', roughness: 0.6 }),
      core: new THREE.MeshStandardMaterial({ color: '#2a2d31', emissive: '#d9822b', emissiveIntensity: 0, roughness: 0.4 }),
    };
    this.guns = { rifle: this.buildRifle(), pistol: this.buildPistol(), knife: this.buildKnife() };
    for (const g of Object.values(this.guns)) this.root.add(g.group);

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: '#ffd7a0', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.flash.visible = false;
    this.scene.add(this.flash);
    this.flashT = 0;

    this.current = 'rifle';
    this.sway = new Spring(90, 14); // 시점 회전에 따른 관성
    this.inertia = new Spring(70, 12); // 이동 가속에 따른 관성
    this.kick = new Spring(260, 22); // 반동
    this.kickRot = new Spring(220, 20);
    this.bob = 0;
    this.land = 0;
    this.lower = 0;
    this.time = 0;
    this.prevVel = new THREE.Vector3();
    this.swingT = 0;
    this.swingHeavy = false;
  }

  part(group, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  }

  // 팔뚝 + 소매 (손목에서 dir 방향으로 화면 밖까지)
  forearm(hand, wrist, dir, { watch = false } = {}) {
    const M = this.mats;
    const d = new THREE.Vector3(...dir).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().negate());
    const at = (t) => new THREE.Vector3(...wrist).addScaledVector(d, t);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.05, 14), M.glove);
    cuff.position.copy(at(0.02));
    cuff.quaternion.copy(q);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.056, 0.5, 16), M.sleeve);
    arm.position.copy(at(0.3));
    arm.quaternion.copy(q);
    const roll = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.011, 8, 18), M.sleeve);
    roll.position.copy(at(0.06));
    roll.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    hand.add(cuff, arm, roll);
    if (watch) {
      const w = new THREE.Mesh(rb(0.03, 0.012, 0.034, 0.004), M.dark);
      w.position.copy(at(0.09)).add(new THREE.Vector3(0, 0.035, 0).applyQuaternion(q));
      w.quaternion.copy(q);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.011, 16), new THREE.MeshBasicMaterial({ color: '#3fae7a' }));
      face.position.copy(w.position).add(new THREE.Vector3(0, 0.007, 0).applyQuaternion(q));
      face.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      hand.add(w, face);
    }
  }

  // 손잡이를 쥔 오른손 (y = 손잡이 축 위쪽, -z = 앞)
  gripHand(trigger = true) {
    const M = this.mats;
    const h = new THREE.Group();
    this.part(h, rb(0.03, 0.09, 0.07, 0.012), M.glove, 0.03, -0.005, 0.005); // 손바닥
    this.part(h, rb(0.012, 0.06, 0.045, 0.006), M.gloveHard, 0.048, 0.008, 0.0); // 손등 보호대
    for (let i = 0; i < 3; i++) {
      const y = 0.0 - i * 0.022;
      this.part(h, rb(0.068, 0.019, 0.024, 0.008), M.glove, 0.0, y, -0.034); // 손가락 (앞쪽 감싸기)
      this.part(h, rb(0.02, 0.018, 0.034, 0.008), M.glove, -0.028, y, -0.016); // 손끝
    }
    if (trigger) this.part(h, rb(0.017, 0.017, 0.055, 0.007), M.glove, 0.012, 0.045, -0.052, 0, -0.15, 0); // 검지(방아쇠 옆)
    this.part(h, rb(0.02, 0.022, 0.06, 0.009), M.glove, -0.024, 0.05, -0.01, 0.2, 0.25, 0); // 엄지
    this.forearm(h, [0.03, -0.06, 0.03], [0.32, -0.62, 0.72]);
    return h;
  }

  // 총열 덮개를 받친 왼손 (y = 위, -z = 앞)
  supportHand() {
    const M = this.mats;
    const h = new THREE.Group();
    this.part(h, rb(0.075, 0.028, 0.09, 0.012), M.glove, 0, -0.045, 0);
    for (let i = 0; i < 4; i++) this.part(h, rb(0.02, 0.05, 0.019, 0.008), M.glove, 0.038, -0.012, -0.033 + i * 0.022);
    this.part(h, rb(0.022, 0.05, 0.022, 0.009), M.glove, -0.04, -0.005, -0.04, 0, 0, 0.15);
    this.part(h, rb(0.06, 0.012, 0.05, 0.005), M.gloveHard, 0.0, -0.064, 0.0);
    this.forearm(h, [-0.01, -0.06, 0.05], [-0.5, -0.55, 0.68], { watch: true });
    return h;
  }

  buildRifle() {
    const g = new THREE.Group();
    const M = this.mats;
    const P = (...a) => this.part(g, ...a);
    P(rb(0.05, 0.06, 0.24, 0.006), M.polymer, 0, -0.01, -0.04);
    P(rb(0.052, 0.05, 0.3, 0.006), M.metal, 0, 0.042, -0.08);
    for (let i = 0; i < 13; i++) P(rb(0.046, 0.008, 0.012, 0.002), M.dark, 0, 0.071, -0.22 + i * 0.022);
    P(rb(0.06, 0.06, 0.28, 0.01), M.tan, 0, 0.036, -0.37);
    for (const x of [-0.031, 0.031]) for (let i = 0; i < 4; i++) P(rb(0.004, 0.012, 0.035, 0.002), M.dark, x, 0.03, -0.29 - i * 0.055);
    P(rb(0.004, 0.012, 0.1, 0.002), M.accent, 0.031, 0.05, -0.38);
    P(new THREE.CylinderGeometry(0.011, 0.011, 0.12, 12), M.dark, 0, 0.036, -0.56, Math.PI / 2);
    P(new THREE.CylinderGeometry(0.017, 0.017, 0.06, 12), M.metal, 0, 0.036, -0.64, Math.PI / 2);
    for (const y of [0.046, 0.026]) P(rb(0.036, 0.003, 0.01, 0.001), M.dark, 0, y, -0.65);
    const mag = new THREE.Group();
    mag.position.set(0, -0.04, -0.12);
    g.add(mag);
    this.part(mag, rb(0.034, 0.11, 0.068, 0.006), M.dark, 0, -0.05, 0, 0.15);
    this.part(mag, rb(0.034, 0.08, 0.064, 0.006), M.dark, 0, -0.13, 0.016, 0.32);
    this.part(mag, new THREE.CylinderGeometry(0.004, 0.004, 0.01, 6), M.brass, 0, 0.012, -0.01, Math.PI / 2);
    P(rb(0.034, 0.1, 0.045, 0.01), M.polymer, 0, -0.08, 0.02, -0.35);
    P(rb(0.008, 0.008, 0.07, 0.002), M.dark, 0, -0.052, -0.03);
    P(rb(0.04, 0.07, 0.22, 0.012), M.polymer, 0, 0.01, 0.2);
    P(rb(0.045, 0.11, 0.025, 0.006), M.dark, 0, -0.005, 0.31);
    P(rb(0.02, 0.014, 0.03, 0.003), M.dark, 0, 0.068, 0.06);
    P(rb(0.004, 0.022, 0.05, 0.002), M.dark, 0.027, 0.045, -0.06);
    const core = P(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 12), M.core, -0.03, 0.04, -0.18, Math.PI / 2);
    // 반사식 조준경
    P(rb(0.036, 0.02, 0.07, 0.004), M.dark, 0, 0.085, -0.08);
    P(rb(0.006, 0.04, 0.012, 0.002), M.dark, -0.022, 0.112, -0.11);
    P(rb(0.006, 0.04, 0.012, 0.002), M.dark, 0.022, 0.112, -0.11);
    P(rb(0.05, 0.006, 0.012, 0.002), M.dark, 0, 0.134, -0.11);
    P(new THREE.PlaneGeometry(0.038, 0.036), M.glass, 0, 0.113, -0.11);
    const dot = P(new THREE.CircleGeometry(0.0018, 10), M.dot, 0, 0.113, -0.112);
    const right = this.gripHand(true);
    right.position.set(0, -0.08, 0.02);
    right.rotation.x = -0.35;
    g.add(right);
    const left = this.supportHand();
    left.position.set(0, 0.03, -0.4);
    g.add(left);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.036, -0.68);
    g.add(muzzle);
    const port = new THREE.Object3D();
    port.position.set(0.03, 0.045, -0.06);
    g.add(port);
    g.scale.setScalar(0.55);
    return {
      group: g, muzzle, port, core, mag, left, leftHome: left.position.clone(), dot,
      hip: new THREE.Vector3(0.15, -0.148, -0.3), hipRot: new THREE.Euler(0.03, 0.06, 0),
      ads: new THREE.Vector3(0, -0.113 * 0.55, -0.11 * 0.55 - 0.16),
    };
  }

  buildPistol() {
    const g = new THREE.Group();
    const M = this.mats;
    const P = (...a) => this.part(g, ...a);
    const slide = new THREE.Group();
    g.add(slide);
    this.part(slide, rb(0.03, 0.034, 0.19, 0.005), M.metal, 0, 0.045, -0.07);
    for (let i = 0; i < 6; i++) this.part(slide, rb(0.032, 0.026, 0.003, 0.001), M.dark, 0, 0.045, 0.0 + i * 0.006);
    this.part(slide, rb(0.006, 0.008, 0.006, 0.001), M.dark, 0, 0.066, -0.155);
    this.part(slide, rb(0.022, 0.008, 0.006, 0.001), M.dark, 0, 0.066, 0.015);
    this.part(slide, new THREE.SphereGeometry(0.0018, 6, 4), M.tritium, 0, 0.071, -0.155);
    for (const x of [-0.007, 0.007]) this.part(slide, new THREE.SphereGeometry(0.0016, 6, 4), M.tritium, x, 0.071, 0.018);
    P(rb(0.028, 0.026, 0.16, 0.005), M.polymer, 0, 0.016, -0.065);
    P(rb(0.03, 0.1, 0.05, 0.01), M.polymer, 0, -0.04, 0.0, -0.25);
    P(rb(0.006, 0.006, 0.05, 0.002), M.dark, 0, -0.012, -0.045);
    P(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10), M.dark, 0, 0.042, -0.166, Math.PI / 2);
    const core = P(rb(0.004, 0.01, 0.05, 0.002), M.core, 0.0145, 0.016, -0.08);
    const right = this.gripHand(true);
    right.position.set(0, -0.04, 0.0);
    right.rotation.x = -0.25;
    g.add(right);
    // 왼손은 오른손을 감싸 쥠
    const left = new THREE.Group();
    this.part(left, rb(0.028, 0.085, 0.07, 0.012), M.glove, -0.035, -0.005, 0.0);
    for (let i = 0; i < 3; i++) this.part(left, rb(0.07, 0.019, 0.022, 0.008), M.glove, -0.005, -0.012 - i * 0.022, -0.06);
    this.part(left, rb(0.02, 0.02, 0.06, 0.008), M.glove, -0.03, 0.035, -0.05);
    this.forearm(left, [-0.035, -0.05, 0.03], [-0.42, -0.6, 0.68], { watch: true });
    left.position.set(0, -0.045, 0.0);
    left.rotation.x = -0.25;
    g.add(left);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.042, -0.18);
    g.add(muzzle);
    const port = new THREE.Object3D();
    port.position.set(0.02, 0.05, -0.04);
    g.add(port);
    g.scale.setScalar(0.62);
    return {
      group: g, muzzle, port, core, slide, left, leftHome: left.position.clone(),
      hip: new THREE.Vector3(0.12, -0.112, -0.3), hipRot: new THREE.Euler(0.03, 0.08, 0),
      ads: new THREE.Vector3(0, -0.07 * 0.62, -0.07 * 0.62 - 0.17),
    };
  }

  buildKnife() {
    const g = new THREE.Group();
    const M = this.mats;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.17, 0.0);
    shape.quadraticCurveTo(0.2, 0.012, 0.19, 0.028);
    shape.lineTo(0.06, 0.03);
    shape.lineTo(0, 0.024);
    shape.lineTo(0, 0);
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.002, bevelSegments: 1 }), M.steel);
    blade.rotation.y = Math.PI / 2;
    blade.position.set(-0.002, -0.01, -0.06);
    g.add(blade);
    this.part(g, rb(0.026, 0.05, 0.012, 0.003), M.dark, 0, 0.005, -0.055);
    this.part(g, rb(0.022, 0.03, 0.11, 0.008), M.polymer, 0, 0.0, 0.0);
    for (let i = 0; i < 5; i++) this.part(g, rb(0.024, 0.032, 0.004, 0.001), M.dark, 0, 0, -0.04 + i * 0.018);
    const hand = new THREE.Group();
    this.part(hand, rb(0.07, 0.075, 0.1, 0.014), M.glove, 0.0, 0.0, 0.0);
    this.part(hand, rb(0.075, 0.022, 0.09, 0.008), M.gloveHard, 0.0, 0.04, 0.0);
    this.part(hand, rb(0.02, 0.02, 0.05, 0.008), M.glove, -0.035, 0.03, -0.04, 0, 0.3, 0);
    this.forearm(hand, [0, -0.01, 0.05], [0.28, -0.5, 0.82]);
    g.add(hand);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -0.2);
    g.add(muzzle);
    g.scale.setScalar(0.85);
    return {
      group: g, muzzle, port: muzzle, core: null,
      hip: new THREE.Vector3(0.14, -0.15, -0.3), hipRot: new THREE.Euler(0.15, 0.25, -0.35),
      ads: new THREE.Vector3(0.14, -0.15, -0.3),
    };
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  shot(ads) {
    const s = ads ? 0.55 : 1;
    const pistol = this.current === 'pistol';
    this.kick.impulse(new THREE.Vector3((Math.random() - 0.5) * 0.04 * s, 0.06 * s, (pistol ? 0.5 : 0.42) * s));
    this.kickRot.impulse(new THREE.Vector3((pistol ? 1.4 : 0.9) * s, (Math.random() - 0.5) * 0.3 * s, (Math.random() - 0.5) * 0.5 * s));
    this.flashT = 0.04;
    this.flash.material.rotation = Math.random() * Math.PI;
    const sz = (this.current === 'rifle' ? 0.17 : 0.12) * (0.85 + Math.random() * 0.3);
    this.flash.scale.set(sz, sz, sz);
    if (pistol) this.slideT = 0.08;
  }

  swing(heavy) {
    this.swingT = heavy ? 0.5 : 0.32;
    this.swingDur = this.swingT;
    this.swingHeavy = heavy;
  }

  landed(speed) {
    this.land = Math.min(1, speed / 10);
  }

  // 화면 공간의 점 → 메인 카메라 기준 월드 좌표 (총알 궤적·탄피 시작점)
  toWorld(obj, mainCamera, target) {
    obj.getWorldPosition(target);
    return mainCamera.localToWorld(target);
  }

  muzzleWorld(mainCamera, target) {
    return this.toWorld(this.guns[this.current].muzzle, mainCamera, target);
  }

  portWorld(mainCamera, target) {
    return this.toWorld(this.guns[this.current].port, mainCamera, target);
  }

  update(dt, s) {
    this.time += dt;
    this.current = s.weapon;
    for (const [id, g] of Object.entries(this.guns)) g.group.visible = id === s.weapon && s.visible;
    if (!s.visible) {
      this.flash.visible = false;
      this.muzzleLight.intensity = 0;
      return;
    }
    const gun = this.guns[s.weapon];
    const g = gun.group;
    const ads = s.adsT ?? 0;
    const settle = 1 - ads * 0.75;

    // 관성: 시점 회전 → 총이 늦게 따라옴, 이동 가속 → 총이 반대로 밀림
    this.sway.impulse(new THREE.Vector3(-s.lookDx * 0.00006, s.lookDy * 0.00006, 0));
    this.sway.x.clampLength(0, 0.06);
    this.sway.step(dt);
    const vel = new THREE.Vector3(s.velLocal?.x ?? 0, s.velLocal?.y ?? 0, s.velLocal?.z ?? 0);
    const acc = vel.clone().sub(this.prevVel);
    this.prevVel.copy(vel);
    this.inertia.impulse(acc.multiplyScalar(-0.0035));
    this.inertia.step(dt);
    this.kick.step(dt);
    this.kickRot.step(dt);

    const moving = s.onGround && s.speed > 0.5;
    this.bob += dt * (moving ? s.speed * 1.7 : 1.1);
    const bobAmp = (moving ? Math.min(1, s.speed / 5) : 0.12) * settle * (s.crouch > 0.5 ? 0.6 : 1);
    this.land = Math.max(0, this.land - dt * 3.5);
    this.lower += ((s.lockpick ? 1 : 0) - this.lower) * Math.min(1, dt * 8);

    const draw = s.swapT > 0 ? s.swapT / WEAPONS[s.weapon].draw : 0;
    const reload = s.reloadT > 0 && !WEAPONS[s.weapon].melee ? 1 - s.reloadT / WEAPONS[s.weapon].reload : 0;
    const rl = reload > 0 ? Math.sin(Math.min(1, reload * 1.25) * Math.PI) : 0;

    const pos = gun.hip.clone().lerp(gun.ads, ads);
    pos.x += Math.sin(this.bob) * 0.011 * bobAmp + this.sway.x.x + this.inertia.x.x;
    pos.y += -Math.abs(Math.cos(this.bob)) * 0.01 * bobAmp + Math.sin(this.time * 1.6) * 0.0015 * settle + this.sway.x.y + this.inertia.x.y;
    pos.y += -draw * 0.22 - rl * 0.035 - this.lower * 0.35 - this.land * 0.025 - (s.crouch ?? 0) * 0.008;
    pos.z += this.inertia.x.z * 0.5;
    pos.add(this.kick.x.clone().multiplyScalar(0.02));
    g.position.copy(pos);
    const rot = new THREE.Euler(
      gun.hipRot.x * (1 - ads) + this.kickRot.x.x * 0.05 - rl * 0.25 + draw * 0.6 + this.sway.x.y * 1.2,
      gun.hipRot.y * (1 - ads) + this.kickRot.x.y * 0.03 + this.sway.x.x * 1.4,
      gun.hipRot.z * (1 - ads) + this.kickRot.x.z * 0.03 + rl * 0.55 + Math.sin(this.bob) * 0.012 * bobAmp,
    );
    g.rotation.copy(rot);

    // 재장전: 왼손이 탄창을 빼서 새 탄창을 끼움
    if (gun.mag) {
      const t = reload;
      const out = t > 0.2 && t < 0.62 ? Math.sin(((t - 0.2) / 0.42) * Math.PI) : 0;
      gun.mag.position.y = -0.04 - out * 0.28;
      gun.mag.visible = !(t > 0.35 && t < 0.45);
      const reach = t > 0.1 && t < 0.75 ? Math.sin(((t - 0.1) / 0.65) * Math.PI) : 0;
      gun.left.position.copy(gun.leftHome).lerp(new THREE.Vector3(0, -0.12 - out * 0.25, -0.13), reach);
    } else if (gun.left && gun.leftHome) {
      gun.left.position.copy(gun.leftHome).add(new THREE.Vector3(0, -rl * 0.08, 0));
    }
    // 권총 슬라이드 후퇴
    if (gun.slide) {
      this.slideT = Math.max(0, (this.slideT ?? 0) - dt);
      gun.slide.position.z = this.slideT > 0 ? 0.03 : 0;
    }
    // 칼 휘두르기
    if (s.weapon === 'knife' && this.swingT > 0) {
      this.swingT -= dt;
      const p = 1 - this.swingT / this.swingDur;
      if (this.swingHeavy) {
        g.position.z -= Math.sin(p * Math.PI) * 0.16;
        g.rotation.x -= Math.sin(p * Math.PI) * 0.5;
      } else {
        g.position.x -= Math.sin(p * Math.PI) * 0.18;
        g.rotation.z += -1.2 + p * 2.2;
        g.rotation.y += Math.sin(p * Math.PI) * 0.6;
      }
    }

    // 합력 강화 중: 소총 옆 코어가 주황색으로 빛남
    if (gun.core) gun.core.material.emissiveIntensity = s.amp ? 2.4 + Math.sin(this.time * 14) * 0.8 : 0;

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    gun.muzzle.getWorldPosition(this.flash.position);
    this.muzzleLight.position.copy(this.flash.position);
    this.muzzleLight.intensity = this.flashT > 0 ? 2.5 : 0;
    this.key.intensity = 0.8 + (s.light ?? 0) * 0.6;
  }
}
