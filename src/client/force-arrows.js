// 힘 화살표: 힘이 작용하는 순간 그 자리에 화살표로 보여 줌 (중1 과학 「힘」: 크기 N · 방향 · 작용점)
//   꼬리의 빛나는 점 = 작용점 · 화살표 방향 = 힘의 방향 · 길이와 글자 = 힘의 크기 (N)
//   한 번 생기는 힘(폭발력·탄성력·반작용 …)은 add, 계속 작용하는 힘(상자를 미는 합력·블랙홀 중력)은 매 프레임 live
//   내 요원이 받은 힘은 1인칭이라 3D 화살표 대신 onSelf로 알려 HUD에 표시
import * as THREE from 'three';
import { carriedMass } from '../sim/agent.js';

export const FORCE_KIND = {
  blast: { name: '폭발력', color: '#ff8a3d' },
  elastic: { name: '탄성력', color: '#5fe08a' },
  net: { name: '합력', color: '#4fe3ff' },
  gravity: { name: '중력', color: '#b48cff' },
  friction: { name: '마찰력', color: '#ff6a5a' },
  action: { name: '작용', color: '#ffd84a' },
  reaction: { name: '반작용', color: '#ffd84a' },
  buoyancy: { name: '부력', color: '#6fc8ff' },
  weight: { name: '무게', color: '#d7c2ff' },
};

// 요원 질량 = 몸(70 kg) + 가진 장비 (HUD의 '지구력 kg'은 장비만)
export const BODY_KG = 70;
export const agentMass = (a) => BODY_KG + carriedMass(a);

// 9,000 · 640 · 33,000 처럼 앞 두 자리만 (읽기 쉽게)
export function fmtN(N) {
  const v = Math.max(1, Math.abs(N));
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
  return (Math.round(v / p) * p).toLocaleString('en-US');
}

// 화살표 길이(m): 힘이 클수록 길게 (로그 눈금 · 0.5~3 m)
const arrowLen = (N) => Math.min(3, Math.max(0.5, 0.5 + 0.55 * Math.log10(Math.max(N, 10) / 50)));

function labelTexture(text, color) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '700 30px "Pretendard", "Noto Sans KR", system-ui, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 28;
  c.width = w;
  c.height = 46;
  g.font = font;
  g.fillStyle = 'rgba(8, 12, 18, 0.72)';
  g.beginPath();
  if (g.roundRect) g.roundRect(1, 1, w - 2, 44, 8);
  else g.rect(1, 1, w - 2, 44);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.fillText(text, 14, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: w / 46 };
}

const UP = new THREE.Vector3(0, 1, 0);

export class ForceArrows {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'forceArrows';
    scene.add(this.group);
    this.shaftGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 10);
    this.shaftGeo.translate(0, 0.5, 0);
    this.headGeo = new THREE.ConeGeometry(0.11, 0.26, 14);
    this.dotGeo = new THREE.SphereGeometry(0.075, 12, 8);
    this.items = []; // 한 번 생기는 힘
    this.lives = new Map(); // key → 계속 작용하는 힘
    this.enabled = true;
    this.onSelf = null; // (kind, N, dir) → 내 요원이 받은 힘
    this.tmp = new THREE.Vector3();
  }

  // xray: 물체를 뚫고 보임 (상자를 미는 힘처럼 화살표가 물체 안으로 들어갈 때)
  make(kind, xray = false) {
    const k = FORCE_KIND[kind] ?? FORCE_KIND.net;
    const mat = new THREE.MeshBasicMaterial({ color: k.color, transparent: true, depthWrite: false, depthTest: !xray, toneMapped: false });
    const root = new THREE.Group();
    const shaft = new THREE.Mesh(this.shaftGeo, mat);
    const head = new THREE.Mesh(this.headGeo, mat);
    const dot = new THREE.Mesh(this.dotGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, depthTest: !xray, toneMapped: false }));
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: !xray, sizeAttenuation: false }));
    for (const o of [shaft, head, dot, label]) o.renderOrder = 20;
    const arrow = new THREE.Group();
    arrow.add(shaft, head);
    root.add(arrow, dot, label);
    this.group.add(root);
    return { root, arrow, shaft, head, dot, label, mat, kind, text: '', labelAt: 0 };
  }

  // 화살표 모양 맞추기: at = 작용점, dir = 방향(단위 벡터), N = 크기
  shape(it, at, dir, N, grow = 1) {
    const L = arrowLen(N) * grow;
    it.root.position.set(at.x, at.y, at.z);
    it.arrow.quaternion.setFromUnitVectors(UP, this.tmp.set(dir.x, dir.y, dir.z).normalize());
    it.shaft.scale.set(1, Math.max(0.01, L - 0.24), 1);
    it.head.position.set(0, Math.max(0.12, L - 0.12), 0);
    const tip = this.tmp.multiplyScalar(L + 0.2);
    it.label.position.set(tip.x, tip.y + 0.3, tip.z);
    const text = `${FORCE_KIND[it.kind]?.name ?? '힘'} ${fmtN(N)} N`;
    const now = performance.now();
    // 글자는 바뀔 때만 다시 그림 (계속 변하는 힘은 초당 6번까지)
    if (text !== it.text && now - it.labelAt > 160) {
      it.label.material.map?.dispose();
      const { tex, aspect } = labelTexture(text, FORCE_KIND[it.kind]?.color ?? '#ffffff');
      it.label.material.map = tex;
      it.label.material.needsUpdate = true;
      it.label.scale.set(0.055 * aspect, 0.055, 1);
      it.text = text;
      it.labelAt = now;
    }
  }

  setAlpha(it, a) {
    it.mat.opacity = a;
    it.dot.material.opacity = a;
    it.label.material.opacity = a;
  }

  // 한 번 작용하는 힘 · follow = 이 요원을 따라감 (밀려나는 동안 작용점이 같이 움직임)
  add({ at, dir, N, kind, life = 1.7, follow = null, self = false }) {
    if (!this.enabled || !(N > 0)) return;
    if (self) {
      this.onSelf?.(kind, N, dir);
      return;
    }
    if (this.items.length >= 16) this.drop(this.items.shift());
    const it = this.make(kind);
    Object.assign(it, { at: { ...at }, dir: { ...dir }, N, t: 0, life, follow, off: follow ? { x: at.x - follow.pos.x, y: at.y - follow.pos.y, z: at.z - follow.pos.z } : null });
    this.shape(it, at, dir, N, 0.2);
    this.items.push(it);
  }

  // 계속 작용하는 힘: 매 프레임 불러야 보임
  live(key, { at, dir, N, kind, self = false, xray = false }) {
    if (!this.enabled || !(N > 0)) return;
    if (self) {
      this.onSelf?.(kind, N, dir, true);
      return;
    }
    let it = this.lives.get(key);
    if (!it || it.kind !== kind) {
      if (it) this.drop(it);
      it = this.make(kind, xray);
      it.fade = 0;
      this.lives.set(key, it);
    }
    it.seen = true;
    it.fade = Math.min(1, it.fade + 0.12);
    this.shape(it, at, dir, N);
    this.setAlpha(it, 0.95 * it.fade);
  }

  update(dt) {
    this.items = this.items.filter((it) => {
      it.t += dt;
      if (it.t >= it.life) {
        this.drop(it);
        return false;
      }
      const at = it.follow ? { x: it.follow.pos.x + it.off.x, y: it.follow.pos.y + it.off.y, z: it.follow.pos.z + it.off.z } : it.at;
      const grow = 1 - Math.pow(1 - Math.min(1, it.t / 0.14), 3);
      this.shape(it, at, it.dir, it.N, grow);
      this.setAlpha(it, 0.95 * Math.min(1, (it.life - it.t) / 0.4));
      return true;
    });
    // 이번 프레임에 다시 불리지 않은 계속 힘은 지움
    for (const [key, it] of this.lives) {
      if (!it.seen) {
        this.drop(it);
        this.lives.delete(key);
      } else it.seen = false;
    }
  }

  drop(it) {
    this.group.remove(it.root);
    it.mat.dispose();
    it.dot.material.dispose();
    it.label.material.map?.dispose();
    it.label.material.dispose();
  }

  clear() {
    for (const it of this.items) this.drop(it);
    for (const it of this.lives.values()) this.drop(it);
    this.items = [];
    this.lives.clear();
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
    this.shaftGeo.dispose();
    this.headGeo.dispose();
    this.dotGeo.dispose();
  }
}
