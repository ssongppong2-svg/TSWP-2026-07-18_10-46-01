import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OP } from '../sim/operation.js';

// CQB 작전 화면: 붙잡힌 연구원(실험복 · 결박 · 무릎 꿇기 → 호송 → 구출 · 웅크림 · 쓰러짐),
// 연구 자료(방탄 가방 위 노트북), 호송 지점 바닥 표시. 상태는 match.op에서 읽기만 한다.

const V3 = THREE.Vector3;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const FONT = '"IBM Plex Sans KR", "Noto Sans KR", sans-serif';

const SKIN = ['#d9ae8a', '#c99b74', '#e2bc9a', '#b9876a'];
const HAIR = ['#1d1a18', '#3a2c22', '#2a2622', '#5a4a3a'];
const PANTS = ['#2f3540', '#3a3a3c', '#28303a', '#4a4236'];

// 연구원 한 명의 몸 (마디마다 무리: 골반 → 상체 → 머리·팔, 골반 → 다리)
function buildResearcher(i) {
  const mats = {
    coat: new THREE.MeshStandardMaterial({ color: '#e8ebee', roughness: 0.85 }),
    shirt: new THREE.MeshStandardMaterial({ color: ['#6d8fb3', '#9aa7b4', '#7f9a7a', '#b39a7a'][i % 4], roughness: 0.8 }),
    skin: new THREE.MeshStandardMaterial({ color: SKIN[i % SKIN.length], roughness: 0.7 }),
    hair: new THREE.MeshStandardMaterial({ color: HAIR[i % HAIR.length], roughness: 0.9 }),
    pants: new THREE.MeshStandardMaterial({ color: PANTS[i % PANTS.length], roughness: 0.85 }),
    shoe: new THREE.MeshStandardMaterial({ color: '#1c1c1e', roughness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.5 }),
    badge: new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.5, emissive: '#2a3a52', emissiveIntensity: 0.15 }),
  };
  const mesh = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  };
  const root = new THREE.Group();
  const hips = new THREE.Group();
  root.add(hips);
  // 상체: 실험복(어깨가 넓은 캡슐) + 셔츠 깃 + 신분증 + 실험복 자락
  const torso = new THREE.Group();
  hips.add(torso);
  const body = mesh(new THREE.CapsuleGeometry(0.15, 0.32, 4, 10).scale(1.18, 1, 0.78).translate(0, 0.27, 0), mats.coat);
  const collar = mesh(new THREE.BoxGeometry(0.16, 0.06, 0.05).translate(0, 0.53, -0.09), mats.shirt);
  const badge = mesh(new THREE.BoxGeometry(0.06, 0.08, 0.01).translate(0.07, 0.36, -0.125), mats.badge);
  const skirt = mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.42, 12, 1, true).scale(1, 1, 0.82).translate(0, -0.12, 0.01), mats.coat);
  skirt.material = mats.coat.clone();
  skirt.material.side = THREE.DoubleSide;
  torso.add(body, collar, badge, skirt);
  // 머리: 얼굴 + 머리카락 + 안경
  const head = new THREE.Group();
  head.position.set(0, 0.6, 0);
  torso.add(head);
  head.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8).translate(0, -0.02, 0), mats.skin));
  head.add(mesh(new THREE.SphereGeometry(0.105, 14, 12).scale(0.92, 1.05, 1).translate(0, 0.1, 0), mats.skin));
  head.add(mesh(new THREE.SphereGeometry(0.11, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.96, 1, 1.02).translate(0, 0.115, 0.01), mats.hair));
  const glasses = mergeGeometries([
    new THREE.TorusGeometry(0.026, 0.004, 6, 14).translate(-0.037, 0.105, -0.098),
    new THREE.TorusGeometry(0.026, 0.004, 6, 14).translate(0.037, 0.105, -0.098),
    new THREE.BoxGeometry(0.024, 0.005, 0.005).translate(0, 0.108, -0.098),
  ]);
  head.add(mesh(glasses, mats.dark));
  // 팔 (어깨 → 팔꿈치 → 손)
  const arm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2, 0.47, 0);
    torso.add(shoulder);
    shoulder.add(mesh(new THREE.CapsuleGeometry(0.052, 0.2, 4, 8).translate(0, -0.14, 0), mats.coat));
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.28, 0);
    shoulder.add(elbow);
    elbow.add(mesh(new THREE.CapsuleGeometry(0.045, 0.18, 4, 8).translate(0, -0.12, 0), mats.coat));
    elbow.add(mesh(new THREE.SphereGeometry(0.045, 8, 6).scale(0.8, 1.1, 0.6).translate(0, -0.27, 0), mats.skin));
    return { shoulder, elbow };
  };
  const arms = [arm(-1), arm(1)];
  // 손목을 묶은 케이블 타이 (등 뒤, 결박 중에만)
  const tie = mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 16).rotateX(Math.PI / 2).translate(0, 0.12, 0.2), mats.dark);
  torso.add(tie);
  // 다리 (엉덩이 → 무릎 → 발)
  const leg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.095, 0, 0);
    hips.add(hip);
    hip.add(mesh(new THREE.CapsuleGeometry(0.068, 0.3, 4, 8).translate(0, -0.21, 0), mats.pants));
    const knee = new THREE.Group();
    knee.position.set(0, -0.43, 0);
    hip.add(knee);
    knee.add(mesh(new THREE.CapsuleGeometry(0.056, 0.3, 4, 8).translate(0, -0.2, 0), mats.pants));
    knee.add(mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(0, -0.42, -0.05), mats.shoe));
    return { hip, knee };
  };
  const legs = [leg(-1), leg(1)];
  return { root, hips, torso, head, arms, legs, tie, mats };
}

// 자세 (각도: 라디안). y = 골반 높이 · torso/head: 앞으로 숙임 · sh/el: 팔을 앞으로 듦/팔꿈치를 굽힘 [앞뒤, 벌림]
// hip: 허벅지를 앞으로 듦 · knee: 무릎 (음수 = 정강이가 뒤로 접힘)
const POSES = {
  // 무릎 꿇고 손은 등 뒤로 묶임, 고개를 숙임
  captive: { y: 0.5, torso: 0.12, head: 0.32, sh: [-0.5, 0.12], el: [0, 0], hip: 0, knee: -1.55 },
  // 웅크림: 몸을 앞으로 접고 팔로 얼굴을 가림
  cower: { y: 0.44, torso: 0.9, head: 0.45, sh: [1.1, 0.25], el: [1.4, 0], hip: 0.1, knee: -1.7 },
  // 호송: 몸을 숙이고 뜀 (팔은 굽혀 흔듦)
  run: { y: 0.84, torso: 0.5, head: -0.25, sh: [-0.15, 0.15], el: [1.4, 0], hip: 0.35, knee: -0.25 },
  // 구출: 꿇어앉아 숨을 고름 (손은 무릎에)
  rescued: { y: 0.5, torso: 0.3, head: 0.2, sh: [0.5, 0.15], el: [0.6, 0], hip: 0, knee: -1.5 },
};

class HostageView {
  constructor(h, scene) {
    this.h = h;
    this.body = buildResearcher(h.id);
    scene.add(this.body.root);
    this.p = { ...POSES.captive, sh: [...POSES.captive.sh], el: [...POSES.captive.el] };
    this.phase = Math.random() * 10;
    this.fall = 0;
    this.idle = Math.random() * 10;
  }

  update(dt, alpha) {
    const h = this.h;
    const b = this.body;
    const px = h.prev ? h.prev.x + (h.x - h.prev.x) * alpha : h.x;
    const pz = h.prev ? h.prev.z + (h.z - h.prev.z) * alpha : h.z;
    b.root.position.set(px, 0, pz);
    // 호송 중에는 가는 방향을, 아니면 처음 방향
    let yaw = b.root.rotation.y;
    const target = h.yaw ?? 0;
    let d = target - yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    yaw += d * Math.min(1, dt * 8);
    b.root.rotation.y = yaw;
    const moving = h.state === 'free' && Math.hypot(h.vel?.x ?? 0, h.vel?.z ?? 0) > 0.3;
    let pose = h.state === 'rescued' ? POSES.rescued : h.state === 'free' ? (moving ? POSES.run : POSES.cower) : POSES.captive;
    if (h.cower > 0.3 && h.state !== 'dead') pose = POSES.cower;
    const p = this.p;
    const k = 7;
    p.y = damp(p.y, pose.y, k, dt);
    p.torso = damp(p.torso, pose.torso, k, dt);
    p.head = damp(p.head, pose.head, k, dt);
    p.hip = damp(p.hip, pose.hip, k, dt);
    p.knee = damp(p.knee, pose.knee, k, dt);
    for (let i = 0; i < 2; i++) {
      p.sh[i] = damp(p.sh[i], pose.sh[i], k, dt);
      p.el[i] = damp(p.el[i], pose.el[i], k, dt);
    }
    this.idle += dt;
    if (moving) this.phase += dt * 9;
    const breathe = Math.sin(this.idle * 2.2) * 0.02;
    const look = h.state === 'captive' ? Math.sin(this.idle * 0.37) * 0.35 : 0;
    // 몸통·머리
    b.hips.position.y = p.y + breathe * 0.3;
    b.torso.rotation.x = -(p.torso + breathe);
    b.head.rotation.set(-p.head, look, 0);
    // 팔: 결박 중에는 등 뒤로 (두 손이 허리 뒤에서 만남)
    const tied = h.state === 'captive';
    b.tie.visible = tied && h.state !== 'dead';
    b.arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      const swing = moving ? -Math.sin(this.phase + i * Math.PI) * 0.5 : 0; // 다리와 반대로
      // 결박: 팔을 뒤로 빼고 팔꿈치를 안쪽으로 굽혀 두 손이 허리 뒤에서 만남
      a.shoulder.rotation.set(p.sh[0] + swing, 0, side * p.sh[1]);
      a.elbow.rotation.set(tied ? 0 : p.el[0], 0, tied ? -side * 0.9 : 0);
    });
    // 다리: 허벅지를 앞뒤로 흔들고, 뒤로 간 다리는 무릎을 더 접음
    b.legs.forEach((l, i) => {
      const s = moving ? Math.sin(this.phase + i * Math.PI) : 0;
      l.hip.rotation.x = p.hip + s * 0.7;
      l.knee.rotation.x = p.knee - (moving ? Math.max(0, -s) * 1.1 : 0);
    });
    // 쓰러짐: 옆으로 누움
    this.fall = damp(this.fall, h.state === 'dead' ? 1 : 0, 5, dt);
    b.root.rotation.z = this.fall * (Math.PI / 2 - 0.05);
    b.root.position.y = this.fall * 0.12;
    if (this.fall > 0.5) b.hips.position.y = damp(b.hips.position.y, 0.5, 5, dt);
  }

  dispose() {
    this.body.root.parent?.remove(this.body.root);
    this.body.root.traverse((o) => o.geometry?.dispose());
    for (const m of Object.values(this.body.mats)) m.dispose();
  }
}

// 연구 자료: 방탄 가방 위에 펼쳐진 노트북 (화면에 '기밀') + 깜빡이는 표시등
function screenTexture(name) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#071423';
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#c23a32';
  g.fillRect(0, 0, 256, 26);
  g.fillStyle = '#fff';
  g.font = `700 16px ${FONT}`;
  g.fillText('기밀 · CLASSIFIED', 10, 18);
  g.fillStyle = '#8fd0ff';
  g.font = `600 15px ${FONT}`;
  g.fillText(name, 10, 52);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(143,208,255,${0.25 + (i % 3) * 0.15})`;
    g.fillRect(10, 70 + i * 13, 60 + ((i * 53) % 170), 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 연구 자료: 하드 케이스 위에 열어 둔 노트북 (화면은 그 방 가운데 = 들어오는 쪽을 봄)
function buildIntel(it, map) {
  const g = new THREE.Group();
  g.position.set(it.x, 0, it.z);
  const room = map.callouts.find((k) => k.f == null && map.toCell(it.x, it.z).r >= k.r0 && map.toCell(it.x, it.z).r <= k.r1 && map.toCell(it.x, it.z).c >= k.c0 && map.toCell(it.x, it.z).c <= k.c1);
  const cx = room ? map.cellX((room.c0 + room.c1) / 2) : it.x, cz = room ? map.cellZ((room.r0 + room.r1) / 2) : it.z + 1;
  g.rotation.y = Math.atan2(cx - it.x, cz - it.z) + ((it.id % 2) - 0.5) * 0.5;
  const caseMat = new THREE.MeshStandardMaterial({ color: '#1f2226', roughness: 0.55, metalness: 0.2 });
  const shell = new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.35, metalness: 0.6 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.48, 0.42).translate(0, 0.24, 0), caseMat);
  // 케이스 테두리 홈 (하드 케이스 느낌)
  const ridges = new THREE.Mesh(mergeGeometries([0.12, 0.34].map((y) => new THREE.BoxGeometry(0.64, 0.025, 0.44).translate(0, y, 0))), shell);
  const latches = new THREE.Mesh(mergeGeometries([new THREE.BoxGeometry(0.06, 0.05, 0.02).translate(-0.18, 0.4, 0.215), new THREE.BoxGeometry(0.06, 0.05, 0.02).translate(0.18, 0.4, 0.215)]), shell);
  // 노트북: 본체(키보드 판)는 가방 위, 화면은 뒤쪽 경첩에서 15° 뒤로 젖혀 열림 (앞 = +z)
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.25).translate(0, 0.49, 0.02), shell);
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11).rotateX(-Math.PI / 2).translate(0, 0.501, 0.0), new THREE.MeshStandardMaterial({ color: '#0e0f11', roughness: 0.8 }));
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.06).rotateX(-Math.PI / 2).translate(0, 0.501, 0.1), new THREE.MeshStandardMaterial({ color: '#3a3e43', roughness: 0.4, metalness: 0.4 }));
  const lid = new THREE.Group();
  lid.position.set(0, 0.5, -0.1);
  lid.rotation.x = -0.26;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.012).translate(0, 0.12, 0), shell);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.2), new THREE.MeshBasicMaterial({ map: screenTexture(it.name) }));
  screen.position.set(0, 0.125, 0.0065);
  lid.add(back, screen);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb347' }));
  led.position.set(0.25, 0.42, 0.215);
  for (const m of [box, latches, base, back]) m.castShadow = true;
  g.add(box, ridges, latches, base, keys, pad, lid, led);
  return { root: g, led, screen };
}

// 호송 지점: 바닥에 점선 테두리 + '호송 지점' 글자 (밤에도 보이게 살짝 빛남)
function buildExtract(op) {
  const e = op.extract;
  const w = e.x1 - e.x0, d = e.z1 - e.z0;
  const c = document.createElement('canvas');
  const s = 16; // 1m = 16px
  c.width = Math.min(2048, Math.round(w * s));
  c.height = Math.min(1024, Math.round(d * s));
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(120, 220, 160, 0.85)';
  g.lineWidth = 6;
  g.setLineDash([24, 16]);
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.setLineDash([]);
  g.fillStyle = 'rgba(120, 220, 160, 0.8)';
  g.font = `800 ${Math.round(c.height * 0.22)}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('호송 지점 · EXTRACT', c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, d - 0.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -3 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set((e.x0 + e.x1) / 2, 0.025, (e.z0 + e.z1) / 2);
  m.renderOrder = 2;
  return m;
}

export class OpView {
  constructor(scene, match) {
    this.match = match;
    this.op = match.op;
    this.group = new THREE.Group();
    this.group.name = 'operation';
    scene.add(this.group);
    this.hostages = this.op.hostages.map((h) => new HostageView(h, this.group));
    this.intel = this.op.intel.map((it) => ({ it, ...buildIntel(it, match.map) }));
    for (const v of this.intel) this.group.add(v.root);
    this.extract = buildExtract(this.op);
    this.group.add(this.extract);
    this.time = 0;
  }

  update(dt, alpha) {
    this.time += dt;
    for (const v of this.hostages) v.update(dt, alpha);
    for (const v of this.intel) {
      v.root.visible = !v.it.taken;
      v.led.material.color.set(Math.sin(this.time * 4 + v.it.id) > 0.2 ? '#ffb347' : '#3a2410');
    }
    this.extract.material.opacity = 0.42 + Math.sin(this.time * 2) * 0.1;
  }

  dispose() {
    for (const v of this.hostages) v.dispose();
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material && !Array.isArray(o.material)) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    this.group.parent?.remove(this.group);
  }
}

export { OP };
