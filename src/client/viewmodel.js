import * as THREE from 'three';
import { SWAP_TIME } from '../sim/constants.js';
import { WEAPONS } from '../sim/data.js';
import { flashTexture } from './textures.js';

// 1인칭 총 모델. 별도의 장면/카메라에 그려서 벽에 총이 파묻히지 않게 합니다.
export class ViewModel {
  constructor(teamColor) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#cfe0ff', '#3a3026', 1.6));
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
      metal: new THREE.MeshStandardMaterial({ color: '#2a2f37', roughness: 0.35, metalness: 0.85 }),
      dark: new THREE.MeshStandardMaterial({ color: '#16191e', roughness: 0.6, metalness: 0.5 }),
      polymer: new THREE.MeshStandardMaterial({ color: '#3b4250', roughness: 0.7, metalness: 0.1 }),
      glove: new THREE.MeshStandardMaterial({ color: '#222831', roughness: 0.9 }),
      sleeve: new THREE.MeshStandardMaterial({ color: teamColor === '#ff7a2f' ? '#30343b' : '#d9e1ea', roughness: 0.7 }),
      glow: new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 2.5 }),
      core: new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 1.8, transparent: true, opacity: 0.9 }),
    };
    this.guns = { rifle: this.buildRifle(), pistol: this.buildPistol() };
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

  part(group, geo, mat, x, y, z, rx = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    group.add(m);
    return m;
  }

  hands(group, gripZ, foreZ, foreY = -0.02) {
    const M = this.mats;
    this.part(group, new THREE.BoxGeometry(0.06, 0.07, 0.09), M.glove, 0.0, -0.06, gripZ);
    this.part(group, new THREE.BoxGeometry(0.075, 0.08, 0.3), M.sleeve, 0.02, -0.1, gripZ + 0.18, 0.25);
    if (foreZ !== null) {
      this.part(group, new THREE.BoxGeometry(0.07, 0.06, 0.09), M.glove, -0.01, foreY - 0.035, foreZ);
      this.part(group, new THREE.BoxGeometry(0.075, 0.08, 0.32), M.sleeve, -0.09, foreY - 0.09, foreZ + 0.17, 0.35).rotation.y = -0.45;
    }
  }

  buildRifle() {
    const g = new THREE.Group();
    const M = this.mats;
    this.part(g, new THREE.BoxGeometry(0.07, 0.1, 0.38), M.metal, 0, 0, -0.05);
    this.part(g, new THREE.BoxGeometry(0.075, 0.08, 0.26), M.polymer, 0, -0.005, -0.34);
    this.part(g, new THREE.BoxGeometry(0.078, 0.012, 0.22), M.glow, 0, 0.032, -0.34);
    const barrel = this.part(g, new THREE.CylinderGeometry(0.014, 0.014, 0.22, 10), M.dark, 0, 0.01, -0.56);
    barrel.rotation.x = Math.PI / 2;
    this.part(g, new THREE.BoxGeometry(0.05, 0.16, 0.08), M.dark, 0, -0.12, -0.08, 0.18);
    this.part(g, new THREE.BoxGeometry(0.055, 0.11, 0.06), M.polymer, 0, -0.09, 0.08, -0.35);
    this.part(g, new THREE.BoxGeometry(0.06, 0.09, 0.22), M.polymer, 0, -0.01, 0.24);
    this.part(g, new THREE.BoxGeometry(0.03, 0.05, 0.12), M.dark, 0, 0.075, -0.06);
    this.part(g, new THREE.BoxGeometry(0.012, 0.012, 0.012), M.glow, 0, 0.105, -0.06);
    const core = this.part(g, new THREE.CylinderGeometry(0.022, 0.022, 0.14, 12), M.core, 0.042, 0.0, -0.08);
    core.rotation.x = Math.PI / 2;
    this.hands(g, 0.08, -0.33);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.01, -0.68);
    g.add(muzzle);
    return { group: g, muzzle, base: new THREE.Vector3(0.19, -0.2, -0.38), core };
  }

  buildPistol() {
    const g = new THREE.Group();
    const M = this.mats;
    this.part(g, new THREE.BoxGeometry(0.048, 0.055, 0.22), M.metal, 0, 0.02, -0.06);
    this.part(g, new THREE.BoxGeometry(0.05, 0.01, 0.2), M.glow, 0, 0.05, -0.06);
    this.part(g, new THREE.BoxGeometry(0.044, 0.04, 0.17), M.polymer, 0, -0.02, -0.05);
    this.part(g, new THREE.BoxGeometry(0.042, 0.12, 0.06), M.polymer, 0, -0.08, 0.03, -0.25);
    const barrel = this.part(g, new THREE.CylinderGeometry(0.01, 0.01, 0.04, 8), M.dark, 0, 0.02, -0.18);
    barrel.rotation.x = Math.PI / 2;
    const core = this.part(g, new THREE.BoxGeometry(0.02, 0.02, 0.06), M.core, 0.026, -0.02, -0.04);
    this.hands(g, 0.03, -0.02, -0.06);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.02, -0.21);
    g.add(muzzle);
    return { group: g, muzzle, base: new THREE.Vector3(0.15, -0.17, -0.34), core };
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
    g.rotation.set(this.kick * 0.09 - rl * 0.35 + this.sway.y * 1.5, this.sway.x * 1.5, rl * 0.6);

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
