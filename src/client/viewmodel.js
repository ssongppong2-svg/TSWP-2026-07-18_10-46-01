import * as THREE from 'three';
import { SWAP_TIME } from '../sim/constants.js';
import { WEAPONS } from '../sim/data.js';
import { flashTexture } from './textures.js';

// 1인칭 총 모델. 별도의 장면/카메라에 그려서 벽에 총이 파묻히지 않게 합니다.
export class ViewModel {
  constructor(teamColor) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#cfe0ff', '#3a3026', 1.2));
    const key = new THREE.DirectionalLight('#fff1dc', 2.4);
    key.position.set(-1, 2, 1.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(teamColor, 1.2);
    rim.position.set(1.5, 0.5, -1);
    this.scene.add(rim);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.teamColor = teamColor;
    this.mats = {
      metal: new THREE.MeshStandardMaterial({ color: '#59616e', roughness: 0.32, metalness: 0.75 }),
      dark: new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.55, metalness: 0.45 }),
      polymer: new THREE.MeshStandardMaterial({ color: '#4a5263', roughness: 0.65, metalness: 0.1 }),
      glove: new THREE.MeshStandardMaterial({ color: '#222831', roughness: 0.9 }),
      sleeve: new THREE.MeshStandardMaterial({ color: teamColor === '#ff7a2f' ? '#2b2724' : '#1f2a3a', roughness: 0.8 }),
      glow: new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 1.1 }),
      core: new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 1.8, transparent: true, opacity: 0.9 }),
    };
    this.guns = { rifle: this.buildRifle(), pistol: this.buildPistol() };
    // 총 크기는 손잡이 기준으로 줄임 (카메라 기준으로 줄이면 원근 때문에 크기가 그대로 보임)
    this.guns.rifle.group.scale.setScalar(0.54);
    this.guns.pistol.group.scale.setScalar(0.6);
    for (const g of Object.values(this.guns)) this.root.add(g.group);

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: '#ffd9a0', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.flash.visible = false;
    this.scene.add(this.flash);
    this.flashT = 0;

    this.current = 'rifle';
    this.kick = 0;
    this.sway = new THREE.Vector2();
    this.bob = 0;
    this.land = 0;
    this.lower = 0;
    this.time = 0;
  }

  part(group, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  }

  // 손과 팔: 손잡이에서 화면 아래쪽 바깥으로 뻗음
  arm(group, hand, elbow, glove = true) {
    const M = this.mats;
    const a = new THREE.Vector3(...hand), b = new THREE.Vector3(...elbow);
    const len = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.078, len), M.sleeve);
    fore.position.copy(mid);
    fore.lookAt(group.localToWorld(b.clone()));
    group.add(fore);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.084, 0.03), M.glow);
    cuff.position.copy(a.clone().lerp(b, 0.22));
    cuff.quaternion.copy(fore.quaternion);
    group.add(cuff);
    if (glove) this.part(group, new THREE.BoxGeometry(0.07, 0.075, 0.1), M.glove, ...hand);
  }

  buildRifle() {
    const g = new THREE.Group();
    const M = this.mats;
    // 몸체
    this.part(g, new THREE.BoxGeometry(0.064, 0.074, 0.34), M.metal, 0, 0.012, -0.04);
    this.part(g, new THREE.BoxGeometry(0.058, 0.05, 0.3), M.polymer, 0, -0.042, -0.02);
    this.part(g, new THREE.BoxGeometry(0.066, 0.012, 0.3), M.dark, 0, 0.055, -0.06);
    // 총열 덮개 + 빛나는 홈
    this.part(g, new THREE.BoxGeometry(0.06, 0.066, 0.26), M.polymer, 0, 0.004, -0.33);
    for (let i = 0; i < 4; i++) this.part(g, new THREE.BoxGeometry(0.062, 0.008, 0.035), M.glow, 0, 0.018, -0.25 - i * 0.05);
    this.part(g, new THREE.CylinderGeometry(0.013, 0.013, 0.2, 12), M.dark, 0, 0.008, -0.55, Math.PI / 2);
    this.part(g, new THREE.CylinderGeometry(0.02, 0.02, 0.06, 12), M.metal, 0, 0.008, -0.64, Math.PI / 2);
    // 탄창 · 손잡이 · 개머리판
    this.part(g, new THREE.BoxGeometry(0.044, 0.15, 0.07), M.dark, 0, -0.12, -0.1, 0.22);
    this.part(g, new THREE.BoxGeometry(0.046, 0.1, 0.055), M.polymer, 0, -0.1, 0.07, -0.3);
    this.part(g, new THREE.BoxGeometry(0.05, 0.08, 0.2), M.polymer, 0, -0.012, 0.22);
    this.part(g, new THREE.BoxGeometry(0.052, 0.03, 0.12), M.metal, 0, 0.04, 0.2);
    // 조준경 (홀로그램)
    this.part(g, new THREE.BoxGeometry(0.05, 0.012, 0.1), M.dark, 0, 0.068, -0.05);
    this.part(g, new THREE.TorusGeometry(0.019, 0.004, 6, 20), M.dark, 0, 0.094, -0.09);
    this.part(g, new THREE.BoxGeometry(0.008, 0.02, 0.05), M.dark, 0, 0.078, -0.07);
    this.part(g, new THREE.BoxGeometry(0.004, 0.004, 0.004), M.glow, 0, 0.094, -0.09);
    // 힘 코어 (합력 강화 때 주황색으로 빛남)
    const core = this.part(g, new THREE.CylinderGeometry(0.02, 0.02, 0.15, 14), M.core, 0.036, -0.006, -0.06, Math.PI / 2);
    // 팔
    this.arm(g, [0.0, -0.09, 0.07], [0.1, -0.32, 0.36]);
    this.arm(g, [-0.012, -0.045, -0.32], [-0.2, -0.3, -0.02]);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.008, -0.69);
    g.add(muzzle);
    return { group: g, muzzle, base: new THREE.Vector3(0.15, -0.145, -0.31), rotY: 0.05, core };
  }

  buildPistol() {
    const g = new THREE.Group();
    const M = this.mats;
    this.part(g, new THREE.BoxGeometry(0.044, 0.05, 0.21), M.metal, 0, 0.022, -0.06);
    this.part(g, new THREE.BoxGeometry(0.003, 0.008, 0.16), M.glow, 0.0225, 0.03, -0.06);
    this.part(g, new THREE.BoxGeometry(0.003, 0.008, 0.16), M.glow, -0.0225, 0.03, -0.06);
    for (let i = 0; i < 4; i++) this.part(g, new THREE.BoxGeometry(0.046, 0.03, 0.006), M.dark, 0, 0.022, 0.0 + i * 0.012);
    this.part(g, new THREE.BoxGeometry(0.04, 0.034, 0.17), M.polymer, 0, -0.016, -0.055);
    this.part(g, new THREE.BoxGeometry(0.038, 0.11, 0.052), M.polymer, 0, -0.075, 0.03, -0.24);
    this.part(g, new THREE.CylinderGeometry(0.009, 0.009, 0.03, 10), M.dark, 0, 0.022, -0.175, Math.PI / 2);
    this.part(g, new THREE.BoxGeometry(0.008, 0.012, 0.008), M.glow, 0, 0.054, -0.15);
    const core = this.part(g, new THREE.BoxGeometry(0.012, 0.018, 0.07), M.core, 0.022, -0.014, -0.06);
    this.arm(g, [0, -0.085, 0.04], [0.09, -0.3, 0.33]);
    this.arm(g, [-0.03, -0.09, 0.03], [-0.17, -0.3, 0.26]);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.022, -0.2);
    g.add(muzzle);
    return { group: g, muzzle, base: new THREE.Vector3(0.12, -0.125, -0.29), rotY: 0.06, core };
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  shot() {
    this.kick = Math.min(1.4, this.kick + 1);
    this.flashT = 0.045;
    const gun = this.guns[this.current];
    gun.muzzle.getWorldPosition(this.flash.position);
    this.flash.material.rotation = Math.random() * Math.PI;
    const s = this.current === 'rifle' ? 0.2 : 0.15;
    this.flash.scale.set(s, s, s);
  }

  landed(speed) {
    this.land = Math.min(1, speed / 12);
  }

  // 화면 공간의 총구 위치 → 메인 카메라 기준 월드 좌표 (총알 궤적 시작점)
  muzzleWorld(mainCamera, target) {
    const gun = this.guns[this.current];
    gun.muzzle.getWorldPosition(target);
    return mainCamera.localToWorld(target);
  }

  update(dt, s) {
    this.time += dt;
    this.current = s.weapon;
    for (const [id, g] of Object.entries(this.guns)) g.group.visible = id === s.weapon && s.visible;
    if (!s.visible) {
      this.flash.visible = false;
      return;
    }
    const gun = this.guns[s.weapon];
    const g = gun.group;

    this.kick = Math.max(0, this.kick - dt * (s.weapon === 'rifle' ? 9 : 7));
    this.land = Math.max(0, this.land - dt * 4);
    const k = 1 - Math.exp(-dt * 10);
    this.sway.x += (THREE.MathUtils.clamp(-s.lookDx * 0.00035, -0.04, 0.04) - this.sway.x) * k;
    this.sway.y += (THREE.MathUtils.clamp(s.lookDy * 0.00035, -0.04, 0.04) - this.sway.y) * k;
    const moving = s.onGround && s.speed > 0.6;
    this.bob += dt * (moving ? s.speed * 1.75 : 1.2);
    const bobAmp = moving ? Math.min(1, s.speed / 6) : 0.15;

    let lowerTarget = 0;
    if (s.lockpick) lowerTarget = 1;
    this.lower += (lowerTarget - this.lower) * Math.min(1, dt * 8);

    const swap = s.swapT > 0 ? s.swapT / SWAP_TIME : 0;
    const reload = s.reloadT > 0 ? 1 - s.reloadT / WEAPONS[s.weapon].reload : 0;
    const rl = reload > 0 ? Math.sin(reload * Math.PI) : 0;

    g.position.copy(gun.base);
    g.position.x += Math.sin(this.bob) * 0.012 * bobAmp + this.sway.x;
    g.position.y += Math.abs(Math.cos(this.bob)) * 0.012 * bobAmp + this.sway.y - swap * 0.28 - rl * 0.1 - this.lower * 0.4 - this.land * 0.03;
    g.position.z += this.kick * (s.weapon === 'rifle' ? 0.05 : 0.06);
    g.rotation.set(this.kick * 0.09 - rl * 0.35 + this.sway.y * 1.5, gun.rotY + this.sway.x * 1.5, rl * 0.6);

    // 합력 강화 중에는 코어가 주황색으로 맥동
    const amp = s.amp;
    const coreColor = amp ? '#ffa13d' : this.teamColor;
    gun.core.material.color.set(coreColor);
    gun.core.material.emissive.set(coreColor);
    gun.core.material.emissiveIntensity = amp ? 3 + Math.sin(this.time * 18) * 1.5 : 1.8;

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) gun.muzzle.getWorldPosition(this.flash.position);
  }
}
