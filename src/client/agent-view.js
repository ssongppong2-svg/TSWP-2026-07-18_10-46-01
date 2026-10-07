import * as THREE from 'three';
import { TEAM_INFO } from '../sim/constants.js';
import { PATCHES, PATCH_TIERS } from '../sim/data.js';
import { labelTexture } from './textures.js';

const SUIT = {
  defuse: { body: '#dfe6ef', dark: '#5b6b7f', accent: TEAM_INFO.defuse.color },
  force: { body: '#2d3138', dark: '#15171b', accent: TEAM_INFO.force.color },
};

const geoCache = new Map();
function box(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(key);
}

// 요원 한 명의 3D 모형 + 애니메이션
export class AgentView {
  constructor(agent, { showTag }) {
    this.agent = agent;
    const s = SUIT[agent.team];
    const mats = {
      body: new THREE.MeshStandardMaterial({ color: s.body, roughness: 0.55, metalness: 0.2 }),
      dark: new THREE.MeshStandardMaterial({ color: s.dark, roughness: 0.7, metalness: 0.3 }),
      glow: new THREE.MeshStandardMaterial({ color: s.accent, emissive: s.accent, emissiveIntensity: 2.2, roughness: 0.4 }),
      visor: new THREE.MeshStandardMaterial({ color: '#0c1118', emissive: s.accent, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.6 }),
      gun: new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.4, metalness: 0.7 }),
    };
    this.mats = mats;
    const root = new THREE.Group();
    root.rotation.order = 'YXZ'; // 쓰러질 때 자기 몸 기준으로 뒤로 넘어지게
    this.root = root;

    const add = (parent, geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // 다리 (엉덩이 기준으로 흔들림)
    this.legs = [-0.13, 0.13].map((x) => {
      const hip = new THREE.Group();
      hip.position.set(x, 0.86, 0);
      add(hip, box(0.2, 0.5, 0.22), mats.dark, 0, -0.22, 0);
      add(hip, box(0.18, 0.42, 0.2), mats.body, 0, -0.62, 0);
      add(hip, box(0.2, 0.08, 0.3), mats.dark, 0, -0.82, -0.04);
      root.add(hip);
      return hip;
    });

    // 몸통
    this.torso = new THREE.Group();
    this.torso.position.y = 0.88;
    root.add(this.torso);
    add(this.torso, box(0.5, 0.36, 0.3), mats.body, 0, 0.42, 0);
    add(this.torso, box(0.44, 0.24, 0.26), mats.dark, 0, 0.14, 0);
    add(this.torso, box(0.52, 0.05, 0.31), mats.glow, 0, 0.3, 0);
    add(this.torso, box(0.34, 0.36, 0.14), mats.dark, 0, 0.36, 0.2); // 등의 패치 장치
    // 어깨 배지 = 장착한 포스 패치 (등급 색)
    this.badges = agent.patches.map((p, i) => {
      const tier = PATCH_TIERS[PATCHES[p.id]?.tier ?? 'normal'];
      const m = new THREE.MeshStandardMaterial({ color: tier.color, emissive: tier.color, emissiveIntensity: 1.6 });
      return add(this.torso, box(0.12, 0.12, 0.04), m, i === 0 ? -0.31 : 0.31, 0.5, 0.06);
    });

    // 머리
    this.head = new THREE.Group();
    this.head.position.y = 0.72;
    this.torso.add(this.head);
    const helmet = add(this.head, new THREE.SphereGeometry(0.17, 16, 12), mats.body, 0, 0.04, 0);
    helmet.scale.set(1, 1.08, 1.05);
    add(this.head, box(0.26, 0.09, 0.08), mats.visor, 0, 0.05, -0.14);
    add(this.head, box(0.05, 0.12, 0.05), mats.glow, 0.17, 0.06, 0);

    // 팔과 총 (앞으로 겨눔)
    this.arms = new THREE.Group();
    this.arms.position.set(0, 0.5, 0);
    this.torso.add(this.arms);
    add(this.arms, box(0.12, 0.12, 0.42), mats.body, -0.2, -0.04, -0.2);
    add(this.arms, box(0.12, 0.12, 0.42), mats.body, 0.2, -0.06, -0.18);
    this.gun = add(this.arms, box(0.08, 0.12, 0.62), mats.gun, 0.06, 0.0, -0.42);
    add(this.arms, box(0.085, 0.03, 0.4), mats.glow, 0.06, 0.07, -0.4);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0.06, 0.0, -0.76);
    this.arms.add(this.muzzle);

    // 상태 효과용 고리 (합력 강화·마찰 미끄러짐·중력 붕괴)
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.035, 8, 40),
      new THREE.MeshBasicMaterial({ color: '#ffa13d', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    root.add(this.ring);

    // 팀원 이름표
    if (showTag) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(agent.name, s.accent), depthTest: false, transparent: true }));
      tag.scale.set(1.1, 0.33, 1);
      tag.position.y = 2.25;
      tag.renderOrder = 10;
      root.add(tag);
      this.tag = tag;
    }

    this.walkPhase = Math.random() * 10;
    this.deathT = 0;
    this.flash = 0;
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
    const speed = Math.hypot(a.vel.x, a.vel.z);

    if (!a.alive) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.55);
      const ease = 1 - (1 - t) * (1 - t);
      r.rotation.x = ease * 1.48;
      r.position.y += ease * 0.2;
      this.torso.position.y = 0.88;
      this.arms.rotation.x = -ease * 0.6;
      for (const l of this.legs) l.rotation.x = 0;
      this.ring.visible = false;
      if (this.tag) this.tag.visible = false;
      this.mats.glow.emissiveIntensity = Math.max(0, 2.2 - this.deathT * 2);
      this.mats.visor.emissiveIntensity = Math.max(0, 0.9 - this.deathT);
      return;
    }

    r.rotation.x = 0;
    // 걷기
    const moving = a.onGround && speed > 0.5;
    this.walkPhase += dt * (moving ? speed * 1.9 : 0);
    const swing = moving ? Math.sin(this.walkPhase) * Math.min(0.75, speed * 0.12) : 0;
    const air = !a.onGround && !a.held;
    this.legs[0].rotation.x += ((air ? -0.6 : swing) - this.legs[0].rotation.x) * Math.min(1, dt * 14);
    this.legs[1].rotation.x += ((air ? 0.3 : -swing) - this.legs[1].rotation.x) * Math.min(1, dt * 14);
    const crouch = a.lockpick ? 0.35 : 0;
    this.torso.position.y += (0.88 - crouch + Math.abs(swing) * 0.03 - this.torso.position.y) * Math.min(1, dt * 12);
    this.torso.rotation.x = 0;
    this.head.rotation.x = a.pitch * 0.5;
    this.arms.rotation.x = a.lockpick ? -0.9 : a.pitch * 0.85;

    // 피격 반짝임
    this.flash = Math.max(0, this.flash - dt * 5);
    this.mats.body.emissive.setRGB(this.flash, this.flash * 0.3, this.flash * 0.3);

    // 상태 효과 고리
    let ring = null;
    if (a.held) ring = '#c47dff';
    else if (a.slippery) ring = '#9ff3ff';
    else if (a.ampT > 0) ring = '#ffa13d';
    this.ring.visible = !!ring;
    if (ring) {
      this.ring.material.color.set(ring);
      this.ring.position.y = 0.1 + Math.sin(time * 6) * 0.05;
      this.ring.rotation.z += dt * 3;
      const sc = 1 + Math.sin(time * 8) * 0.08;
      this.ring.scale.set(sc, sc, sc);
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
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose?.();
      }
    });
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
