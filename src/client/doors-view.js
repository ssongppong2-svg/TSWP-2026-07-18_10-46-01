import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOOR, leafSegment } from '../sim/door-geo.js';

// 문 화면: 문짝(철문·나무문, 손잡이·경첩·창·발판) + 문틀 테두리·문턱 + 부서진 문 파편.
// 상태(각도·잠김·부서짐)는 경기(match.doors)에서 읽기만 한다. 문틀 벽은 structure.js가 벽과 같이 그림.

const V3 = THREE.Vector3;

// 문짝 면 무늬 (캔버스): steel = 칠한 철문 · wood = 짙은 원목 · oak = 밝은 원목(과학관)
const texCache = new Map();
function leafTexture(kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const rnd = mulberry(kind.length * 97 + 13);
  if (kind === 'steel') {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#5d6e78');
    grd.addColorStop(1, '#4b5a63');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // 칠 얼룩·긁힘
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.04})`;
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 2);
    }
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(200,205,210,${0.06 + rnd() * 0.1})`;
      g.lineWidth = 0.6;
      g.beginPath();
      const x = rnd() * W, y = H * (0.45 + rnd() * 0.5);
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 8);
      g.stroke();
    }
    // 아래쪽 발자국 때 · 테두리 홈
    const dirt = g.createLinearGradient(0, H * 0.78, 0, H);
    dirt.addColorStop(0, 'rgba(30,25,20,0)');
    dirt.addColorStop(1, 'rgba(30,25,20,0.35)');
    g.fillStyle = dirt;
    g.fillRect(0, H * 0.78, W, H * 0.22);
    g.strokeStyle = 'rgba(20,24,28,0.45)';
    g.lineWidth = 3;
    g.strokeRect(14, 14, W - 28, H - 28);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    g.strokeRect(17, 17, W - 34, H - 34);
  } else {
    // 원목: 과학관은 밝은 참나무, 공장은 짙은 호두나무 (채도를 낮춰 조명에 주황으로 뜨지 않게)
    const base = kind === 'oak' ? ['#a88a66', '#8f7352', '#bba07c'] : ['#4e3b2e', '#3e2e23', '#62493a'];
    g.fillStyle = base[0];
    g.fillRect(0, 0, W, H);
    // 나뭇결: 세로로 흐르는 물결 선
    for (let i = 0; i < 140; i++) {
      const x0 = rnd() * W;
      g.strokeStyle = rnd() < 0.5 ? hexA(base[1], 0.35 + rnd() * 0.3) : hexA(base[2], 0.25 + rnd() * 0.25);
      g.lineWidth = 0.6 + rnd() * 1.6;
      g.beginPath();
      for (let y = 0; y <= H; y += 16) {
        const x = x0 + Math.sin(y * 0.012 + i) * (3 + rnd() * 2);
        if (y === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // 판 두 장 (위 짧게, 아래 길게): 그늘·빛 테두리로 도드라지게
    const panel = (x, y, w, h) => {
      g.strokeStyle = 'rgba(20,12,6,0.55)';
      g.lineWidth = 4;
      g.strokeRect(x, y, w, h);
      g.strokeStyle = 'rgba(255,235,200,0.16)';
      g.lineWidth = 2;
      g.strokeRect(x + 5, y + 5, w - 10, h - 10);
    };
    panel(34, 40, W - 68, H * 0.3);
    panel(34, H * 0.42, W - 68, H * 0.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(kind, tex);
  return tex;
}

// 철망 유리 (안이 비치지 않는 젖빛 유리 + 철망)
let wireTex = null;
function wireGlass() {
  if (wireTex) return wireTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#7f949e';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(40,46,52,0.75)';
  g.lineWidth = 1;
  for (let i = 0; i <= 64; i += 8) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 64);
    g.moveTo(0, i);
    g.lineTo(64, i);
    g.stroke();
  }
  wireTex = new THREE.CanvasTexture(c);
  wireTex.colorSpace = THREE.SRGBColorSpace;
  wireTex.wrapS = wireTex.wrapT = THREE.RepeatWrapping;
  wireTex.repeat.set(2, 5);
  return wireTex;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function mulberry(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r, h, x, y, z, rx = 0, seg = 12) => {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  if (rx) g.rotateX(rx);
  return g.translate(x, y, z);
};

export class DoorsView {
  constructor(scene, match, { museum = false } = {}) {
    this.match = match;
    this.map = match.map;
    this.group = new THREE.Group();
    this.group.name = 'doors';
    scene.add(this.group);
    this.museum = museum;
    this.mats = {
      steel: new THREE.MeshStandardMaterial({ map: leafTexture('steel'), roughness: 0.6, metalness: 0.25, color: '#dfe7ee' }),
      wood: new THREE.MeshStandardMaterial({ map: leafTexture(museum ? 'oak' : 'wood'), roughness: 0.66, metalness: 0.02, color: '#e6e0da' }),
      edgeSteel: new THREE.MeshStandardMaterial({ color: '#4c575e', roughness: 0.5, metalness: 0.55 }),
      edgeWood: new THREE.MeshStandardMaterial({ color: museum ? '#8c6a42' : '#4a321f', roughness: 0.7 }),
      handle: new THREE.MeshStandardMaterial({ color: museum ? '#b48a3e' : '#c9ced2', roughness: 0.28, metalness: 0.9 }),
      plate: new THREE.MeshStandardMaterial({ color: '#9ea6ab', roughness: 0.32, metalness: 0.85 }),
      frame: new THREE.MeshStandardMaterial({ color: museum ? '#6e5434' : '#363c41', roughness: 0.55, metalness: museum ? 0.1 : 0.5 }),
      glass: new THREE.MeshStandardMaterial({ map: wireGlass(), roughness: 0.18, metalness: 0.35, color: '#c7d6dc' }),
      dark: new THREE.MeshStandardMaterial({ color: '#202428', roughness: 0.6, metalness: 0.4 }),
    };
    this.views = this.map.doors.map((d) => this.build(d));
    this.debris = [];
  }

  // 문 하나: 문틀 테두리·문턱(고정) + 문짝(경첩에서 도는 무리)
  build(d) {
    const root = new THREE.Group();
    root.name = `door${d.id}`;
    const steel = d.mat === 'steel';
    const M = this.mats;
    // 문 좌표 → 세계: (따라 u, 위 y, 지나가는 쪽 n)
    const at = (a, y, b) => new V3(d.x + d.u.x * a + d.n.x * b, y, d.z + d.u.z * a + d.n.z * b);
    const yaw = Math.atan2(-d.u.z, d.u.x); // 로컬 +x = u
    // 문틀 테두리 (문 면에 붙은 얇은 틀): 양옆 + 위 + 문턱
    const frame = [
      box(0.06, DOOR.frameTop + 0.03, 0.16, -d.w / 2 - 0.0, (DOOR.frameTop + 0.03) / 2, 0),
      box(0.06, DOOR.frameTop + 0.03, 0.16, d.w / 2 + 0.0, (DOOR.frameTop + 0.03) / 2, 0),
      box(d.w + 0.06, 0.06, 0.16, 0, DOOR.frameTop, 0),
    ];
    const fm = new THREE.Mesh(mergeGeometries(frame), M.frame);
    const sill = new THREE.Mesh(box(d.w, 0.016, 0.2, 0, 0.008, 0), steel ? M.plate : M.edgeWood);
    for (const m of [fm, sill]) {
      m.position.copy(at(0, 0, 0));
      m.rotation.y = yaw;
      m.receiveShadow = true;
      root.add(m);
    }
    // 문짝
    const leaves = d.leaves.map((leaf) => {
      const pivot = new THREE.Group();
      pivot.position.set(leaf.hx, 0, leaf.hz);
      const L = leaf.len - 0.012;
      const H = DOOR.height - DOOR.gap;
      const T = DOOR.thick;
      const face = steel ? M.steel : M.wood;
      const edge = steel ? M.edgeSteel : M.edgeWood;
      // BoxGeometry 면 순서: +x −x +y −y +z −z → 앞뒤(±z)만 무늬
      const slab = new THREE.Mesh(box(L, H, T, 0.006 + L / 2, DOOR.gap + H / 2, 0), [edge, edge, edge, edge, face, face]);
      slab.castShadow = true;
      slab.receiveShadow = true;
      pivot.add(slab);
      const parts = [];
      const hx = L - 0.085; // 손잡이 (문 끝 쪽)
      for (const s of [1, -1]) {
        const z = s * (T / 2);
        parts.push(cyl(0.034, 0.012, hx, 1.0, z + s * 0.006, Math.PI / 2, 16)); // 장식판
        parts.push(cyl(0.011, 0.05, hx, 1.0, z + s * 0.03, Math.PI / 2, 8)); // 목
        parts.push(box(0.13, 0.022, 0.022, hx - 0.06, 1.0, z + s * 0.055)); // 레버
        parts.push(box(0.03, 0.06, 0.012, hx, 0.9, z + s * 0.006)); // 열쇠 구멍 판
      }
      pivot.add(new THREE.Mesh(mergeGeometries(parts), M.handle));
      // 경첩 (문 축)
      const hinge = [0.28, 1.08, 1.9].map((y) => cyl(0.014, 0.11, 0.0, y, 0, 0, 10));
      pivot.add(new THREE.Mesh(mergeGeometries(hinge), M.dark));
      if (steel) {
        // 아래 발차기 판 · 철망 유리창 · 위 도어 클로저
        const kick = new THREE.Mesh(box(L - 0.08, 0.24, T + 0.006, 0.006 + L / 2, DOOR.gap + 0.14, 0), M.plate);
        const win = new THREE.Mesh(box(0.2, 0.52, T + 0.008, L - 0.34, 1.56, 0), M.glass);
        const winFrame = new THREE.Mesh(mergeGeometries([
          box(0.24, 0.025, T + 0.014, L - 0.34, 1.83, 0), box(0.24, 0.025, T + 0.014, L - 0.34, 1.29, 0),
          box(0.025, 0.56, T + 0.014, L - 0.46, 1.56, 0), box(0.025, 0.56, T + 0.014, L - 0.22, 1.56, 0),
        ]), M.edgeSteel);
        const closer = new THREE.Mesh(mergeGeometries([box(0.32, 0.065, 0.06, 0.3, DOOR.height - 0.12, -(T / 2 + 0.035)), box(0.24, 0.016, 0.016, 0.46, DOOR.height - 0.05, -(T / 2 + 0.05))]), M.dark);
        pivot.add(kick, win, winFrame, closer);
      }
      root.add(pivot);
      return { leaf, pivot };
    });
    this.group.add(root);
    return { door: d, root, leaves, shake: 0, shakeT: 0 };
  }

  // 사건: 잠긴 문 발차기 실패 → 문이 덜컹, 폭파 → 파편
  onDoor(e) {
    const v = this.views[e.door?.id];
    if (!v) return;
    if (e.act === 'kickFail' || e.act === 'locked') {
      v.shake = e.act === 'kickFail' ? 1 : 0.35;
      v.shakeT = 0;
    }
    if (e.act === 'breach') this.burst(v, e.side ?? 1);
  }

  // 부서진 문짝 조각이 폭파 반대쪽으로 날아감
  burst(v, side) {
    const d = v.door;
    const steel = d.mat === 'steel';
    const mat = steel ? this.mats.edgeSteel : this.mats.edgeWood;
    const face = steel ? this.mats.steel : this.mats.wood;
    const n = steel ? 9 : 16;
    for (let i = 0; i < n; i++) {
      const w = steel ? 0.18 + Math.random() * 0.35 : 0.06 + Math.random() * 0.22;
      const h = steel ? 0.2 + Math.random() * 0.5 : 0.25 + Math.random() * 0.9;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, DOOR.thick * (steel ? 0.8 : 0.6)), [mat, mat, mat, mat, face, face]);
      const a = (Math.random() - 0.5) * d.w, y = 0.3 + Math.random() * 1.7;
      m.position.set(d.x + d.u.x * a, y, d.z + d.u.z * a);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.castShadow = true;
      const out = -side * (3 + Math.random() * 6);
      const vel = new V3(d.n.x * out + d.u.x * (Math.random() - 0.5) * 3, 1 + Math.random() * 3.5, d.n.z * out + d.u.z * (Math.random() - 0.5) * 3);
      const spin = new V3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      this.group.add(m);
      this.debris.push({ m, vel, spin, t: 0, half: h / 2 });
    }
  }

  update(dt, alpha) {
    for (const v of this.views) {
      const st = v.door.st;
      if (!st) continue;
      const show = !st.broken;
      for (const l of v.leaves) l.pivot.visible = show;
      if (!show) continue;
      const prev = st.prev ?? st.ang;
      let ang = prev + (st.ang - prev) * alpha;
      if (v.shake > 0) {
        v.shakeT += dt;
        v.shake = Math.max(0, v.shake - dt * 2.2);
        ang += Math.sin(v.shakeT * 55) * 0.028 * v.shake;
      }
      for (const l of v.leaves) {
        const s = leafSegment(v.door, l.leaf, ang);
        l.pivot.rotation.y = Math.atan2(-s.dz, s.dx);
      }
    }
    // 파편: 중력으로 떨어져 바닥에서 구르다 6초 뒤 사라짐
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const p = this.debris[i];
      p.t += dt;
      p.vel.y -= 9.8 * dt;
      p.m.position.addScaledVector(p.vel, dt);
      p.m.rotation.x += p.spin.x * dt;
      p.m.rotation.y += p.spin.y * dt;
      p.m.rotation.z += p.spin.z * dt;
      const floor = 0.03;
      if (p.m.position.y < floor) {
        p.m.position.y = floor;
        p.vel.y = Math.abs(p.vel.y) * 0.25;
        p.vel.x *= 0.55;
        p.vel.z *= 0.55;
        p.spin.multiplyScalar(0.5);
        if (Math.abs(p.vel.y) < 0.4) {
          p.vel.y = 0;
          // 바닥에 눕힘
          p.m.rotation.x += (Math.round(p.m.rotation.x / (Math.PI / 2)) * (Math.PI / 2) - p.m.rotation.x) * Math.min(1, dt * 6);
          p.m.rotation.z += (Math.round(p.m.rotation.z / (Math.PI / 2)) * (Math.PI / 2) - p.m.rotation.z) * Math.min(1, dt * 6);
        }
      }
      if (p.t > 6) {
        const k = Math.max(0, 1 - (p.t - 6) / 0.8);
        p.m.scale.setScalar(k);
        if (k <= 0) {
          this.group.remove(p.m);
          p.m.geometry.dispose();
          this.debris.splice(i, 1);
        }
      }
    }
  }

  // 새 라운드: 남은 파편 치움
  clearDebris() {
    for (const p of this.debris) {
      this.group.remove(p.m);
      p.m.geometry.dispose();
    }
    this.debris = [];
  }

  dispose() {
    this.clearDebris();
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
