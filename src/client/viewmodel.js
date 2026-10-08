import * as THREE from 'three';
import { WEAPONS } from '../sim/data.js';
import { TEAM_INFO } from '../sim/constants.js';
import { flashTexture } from './textures.js';
import { Parts, rbox, cylG, profile, teamMaterials, makeSolidMaterial, mergeSkinned, hideableBone, withDetail } from './agent-view.js';

const sphG = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);

const V3 = THREE.Vector3;
const M4 = THREE.Matrix4;
const UP = new V3(0, 1, 0);
const ZAX = new V3(0, 0, 1);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
// a~b 구간에서 0→1→0 으로 부드럽게 올라갔다 내려옴
const bump = (u, a, b, c, d) => smooth((u - a) / (b - a)) * (1 - smooth((u - c) / (d - c)));
const rotX = (a) => new M4().makeRotationX(a);
const rotY = (a) => new M4().makeRotationY(a);
const rotZ = (a) => new M4().makeRotationZ(a);
const tr = (x, y, z) => new M4().makeTranslation(x, y, z);

// 스프링-감쇠 (총의 관성·반동 복원용). 작은 간격으로 나눠 적분해 강한 반동에도 안정적.
class Spring {
  constructor(k = 120, c = 16, max = Infinity) {
    this.k = k;
    this.c = c;
    this.max = max;
    this.x = new V3();
    this.v = new V3();
    this.f = new V3();
  }
  impulse(v) {
    this.v.add(v);
  }
  step(dt, target = null) {
    let t = dt;
    while (t > 1e-6) {
      const h = Math.min(t, 1 / 240);
      this.f.copy(this.x).multiplyScalar(-this.k).addScaledVector(this.v, -this.c);
      if (target) this.f.addScaledVector(target, this.k);
      this.v.addScaledVector(this.f, h);
      this.x.addScaledVector(this.v, h);
      t -= h;
    }
    if (this.x.length() > this.max) {
      this.x.setLength(this.max);
      this.v.multiplyScalar(0.5);
    }
  }
}

// ───────── 장갑 낀 손 (손목 = 원점, 손바닥 -y, 손등 +y, 손가락 -z, 엄지는 -x·side) ─────────
const capsuleSeg = (r, L) => new THREE.CapsuleGeometry(r, Math.max(0.002, L - r * 1.2), 3, 10);
// 손등 쪽을 둥글게 (y > 0 인 면을 가로로 휨) + 손목 쪽으로 좁아짐
const handShape = (arch, taper, z0, z1) => (g) => {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
    p.setX(i, x * (1 - taper * t));
    if (y > 0) p.setY(i, y - arch * x * x);
  }
};
function buildHand(side, pose, forearm) {
  const P = new Parts();
  const S = side;
  // 손바닥 덩어리 (손가락 쪽이 넓고 손목 쪽이 좁음) · 엄지 두덩
  P.add('glove', rbox(0.084, 0.032, 0.088, 0.014, 3), [0, 0, -0.046], [0, 0, 0], 1, handShape(2.2, 0.2, -0.09, 0.0));
  P.add('glove', sphG(1, 12, 8), [-0.025 * S, -0.012, -0.024], [0, 0.35 * S, 0], [0.019, 0.017, 0.034]);
  P.add('glove', sphG(1, 12, 8), [0.026 * S, -0.012, -0.03], [0, 0, 0], [0.016, 0.014, 0.034]);
  // 손등 보호판 · 몰딩된 너클 보호대 (경질 소재)
  P.add('gloveHard', rbox(0.054, 0.007, 0.042, 0.003, 2), [S * 0.003, 0.0165, -0.046], [0, 0, 0], 1, handShape(4, 0, 0, 1));
  P.add('gloveHard', rbox(0.082, 0.012, 0.024, 0.006, 2), [0, 0.0145, -0.085], [0, 0, 0], 1, handShape(3, 0, 0, 1));
  const fx = [-0.029, -0.0095, 0.0095, 0.0275];
  for (let f = 0; f < 4; f++) P.add('gloveHard', sphG(1, 10, 6), [fx[f] * S, 0.019 - (Math.abs(fx[f]) > 0.02 ? 0.002 : 0), -0.087], [0, 0, 0], [0.0085, 0.006, 0.0095]);
  // 손가락 4개 (마디마다 굽힘)
  const lens = [
    [0.042, 0.025, 0.021],
    [0.046, 0.028, 0.022],
    [0.043, 0.026, 0.021],
    [0.034, 0.021, 0.018],
  ];
  const rad = [0.0102, 0.0106, 0.0101, 0.0092];
  const fz = [-0.088, -0.09, -0.088, -0.083];
  for (let f = 0; f < 4; f++) {
    const curl = pose.curl[f];
    const m = tr(fx[f] * S, -0.002, fz[f]).multiply(rotY(-(pose.spread?.[f] ?? 0) * S));
    for (let j = 0; j < 3; j++) {
      m.multiply(rotX(-curl[j]));
      const L = lens[f][j];
      const r = rad[f] * (1 - j * 0.08);
      P.addM('glove', capsuleSeg(r, L + r * 0.6), m.clone().multiply(tr(0, 0, -L / 2)).multiply(rotX(Math.PI / 2)));
      if (j === 1) P.addM('gloveHard', rbox(0.0145, 0.006, 0.014, 0.0025), m.clone().multiply(tr(0, r * 0.88, -L * 0.45)));
      m.multiply(tr(0, 0, -L));
    }
  }
  // 엄지 (손바닥 옆에서 앞·안쪽으로)
  const th = pose.thumb;
  const m = tr(-0.033 * S, -0.012, -0.022).multiply(rotY(th.yaw * S)).multiply(rotZ(th.roll * S));
  const tl = [0.036, 0.03, 0.025];
  for (let j = 0; j < 3; j++) {
    m.multiply(rotX(-th.curl[j]));
    const L = tl[j];
    P.addM('glove', capsuleSeg(0.0122 - j * 0.0008, L + 0.008), m.clone().multiply(tr(0, 0, -L / 2)).multiply(rotX(Math.PI / 2)));
    if (j === 1) P.addM('gloveHard', rbox(0.0145, 0.006, 0.016, 0.0025), m.clone().multiply(tr(0, 0.0105, -L * 0.5)));
    m.multiply(tr(0, 0, -L));
  }
  // 손목 (관절을 가리는 둥근 부분) · 커프 · 찍찍이 탭
  P.add('glove', sphG(1, 14, 10), [0, -0.002, 0.006], [0, 0, 0], [0.034, 0.025, 0.03]);
  P.add('glove', cylG(0.033, 0.035, 0.045, 14), [S * 0.001, -0.002, 0.026], [Math.PI / 2, 0, 0]);
  P.add('gloveHard', rbox(0.026, 0.007, 0.034, 0.003), [S * 0.01, 0.032, 0.026], [0, 0, -0.2 * S]);
  // 아래팔 소매 (손목에서 화면 밖까지)
  if (forearm) {
    const d = forearm.dir.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d);
    const qr = new THREE.Quaternion().setFromUnitVectors(ZAX, d);
    const at = (t) => new V3(0, -0.002, 0.02).addScaledVector(d, t);
    const place = (pos, quat) => new M4().compose(pos, quat, new V3(1, 1, 1));
    P.addM('glove', cylG(0.034, 0.037, 0.05, 14), place(at(0.03), q));
    P.addM('sleeve', cylG(0.04, 0.052, 0.46, 18), place(at(0.3), q));
    P.addM('sleeve', new THREE.TorusGeometry(0.041, 0.012, 8, 20), place(at(0.07), qr));
    P.addM('sleeve', new THREE.TorusGeometry(0.044, 0.009, 8, 20), place(at(0.125), qr));
    if (forearm.watch) {
      // 손목시계 (손등 쪽)
      const upv = new V3(0, 1, 0).addScaledVector(d, -d.y).normalize();
      const wq = new THREE.Quaternion().setFromUnitVectors(UP, upv);
      const wp = at(0.052).addScaledVector(upv, 0.036);
      P.addM('watch', rbox(0.034, 0.012, 0.036, 0.005), place(wp, wq));
      P.addM('watchFace', new THREE.CylinderGeometry(0.012, 0.012, 0.002, 18), place(wp.clone().addScaledVector(upv, 0.006), wq));
    }
  }
  return P;
}

// 손 회전: 손가락이 향하는 방향 f(굽히기 전) · 손등이 향하는 방향 b
function handQ(f, b) {
  const y = b.clone().normalize();
  const z = f.clone().negate().addScaledVector(y, f.dot(y)).normalize();
  const x = new V3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new M4().makeBasis(x, y, z));
}

// 피카티니 레일 (바닥 + 톱니)
function rail(P, y, z0, z1, mat = 'metal') {
  const len = Math.abs(z1 - z0);
  P.add(mat, rbox(0.021, 0.006, len, 0.0015), [0, y, (z0 + z1) / 2]);
  const n = Math.floor(len / 0.01);
  for (let i = 0; i < n; i++) P.add(mat, rbox(0.0215, 0.0042, 0.0052, 0.001), [0, y + 0.004, Math.min(z0, z1) + 0.005 + i * 0.01]);
}

const RB = 0.045; // 소총 총열 높이
// 재질별 주변광 반사 세기 (장면 환경맵을 그대로 쓰면 비스듬한 면이 허옇게 뜸)
const ENV = { shell: 0.08, metal: 0.16, dark: 0.04, poly: 0.08, furn: 0.08, rubber: 0.03, glove: 0.05, gloveHard: 0.09, sleeve: 0.04, watch: 0.1, steel: 0.45, blade: 0.22, brass: 0.35, copper: 0.3, glass: 0.5, lensW: 0.3, accent: 0.04, core: 0.1 };
const OPTIC = { y: 0.1135, z: -0.068 };

function buildRifleParts() {
  const P = new Parts();
  // ── 하부 리시버 (탄창 삽입구 · 방아쇠울)
  P.add('metal', profile([[-0.085, 0.03], [0.125, 0.03], [0.128, -0.004], [0.133, -0.046], [0.125, -0.052], [0.046, -0.052], [0.042, -0.038], [0.04, -0.012], [0.036, -0.033], [0.0, -0.036], [-0.006, -0.03], [-0.04, -0.004], [-0.085, 0.0]], 0.024, 0.0025, [[[0.006, -0.013], [0.031, -0.013], [0.029, -0.029], [0.008, -0.03]]]));
  P.add('metal', rbox(0.029, 0.05, 0.086, 0.004), [0, -0.025, -0.086]);
  P.add('metal', rbox(0.0315, 0.008, 0.09, 0.003), [0, -0.048, -0.087]);
  for (const z of [-0.118, 0.07]) P.add('metal', cylG(0.0034, 0.0034, 0.0265, 8), [0, 0.021, z], [0, 0, Math.PI / 2]);
  P.add('dark', cylG(0.0055, 0.0055, 0.006, 12), [0.0138, 0.003, -0.04], [0, 0, Math.PI / 2]); // 탄창 멈치
  P.add('metal', rbox(0.004, 0.022, 0.012, 0.0015), [-0.0138, 0.012, -0.053]); // 노리쇠 멈치
  P.add('metal', rbox(0.003, 0.0065, 0.026, 0.0015), [-0.0138, 0.013, 0.03], [0.5, 0, 0]); // 조정간
  P.add('metal', rbox(0.003, 0.0065, 0.02, 0.0015), [0.0138, 0.013, 0.03], [0.5, 0, 0]);
  P.add('dark', rbox(0.0055, 0.022, 0.0055, 0.002), [0, -0.019, -0.018], [0.35, 0, 0]); // 방아쇠
  // ── 권총 손잡이
  P.add('furn', profile([[-0.004, 0.0], [0.007, -0.024], [0.0, -0.046], [-0.005, -0.066], [-0.019, -0.106], [-0.059, -0.114], [-0.068, -0.103], [-0.05, -0.04], [-0.043, -0.006], [-0.03, 0.004]], 0.031, 0.006));
  for (let i = 0; i < 6; i++) P.add('poly', rbox(0.026, 0.003, 0.004, 0.001), [0, -0.05 - i * 0.01, 0.052 + i * 0.0035], [-0.35, 0, 0]);
  // ── 상부 리시버 · 배출구 · 전진기 · 탄피 멈치 · 장전 손잡이
  P.add('metal', rbox(0.03, 0.034, 0.21, 0.004), [0, RB, -0.02]);
  P.add('dark', rbox(0.002, 0.014, 0.052, 0.001), [0.0152, 0.049, -0.008]);
  P.add('metal', rbox(0.0015, 0.017, 0.056, 0.0008), [0.0172, 0.034, -0.008], [0, 0, 0.5]);
  P.add('metal', rbox(0.012, 0.014, 0.03, 0.004), [0.0165, 0.056, 0.05]);
  P.add('metal', cylG(0.0068, 0.0068, 0.022, 12), [0.021, 0.056, 0.068], [Math.PI / 2, 0, 0]);
  P.add('dark', cylG(0.0055, 0.0055, 0.004, 12), [0.021, 0.056, 0.0795], [Math.PI / 2, 0, 0]);
  P.add('metal', rbox(0.008, 0.016, 0.014, 0.003), [0.0176, 0.058, 0.028]);
  P.add('metal', rbox(0.02, 0.008, 0.035, 0.002), [0, 0.066, 0.094]);
  P.add('metal', rbox(0.042, 0.007, 0.012, 0.003), [0, 0.066, 0.106]);
  rail(P, 0.0665, 0.085, -0.125);
  // ── M-LOK 핸드가드 + 레일 + 슬롯
  P.add('metal', rbox(0.05, 0.052, 0.33, 0.014, 3), [0, RB - 0.002, -0.29]);
  rail(P, 0.0745, -0.125, -0.455);
  for (let i = 0; i < 5; i++) {
    const z = -0.17 - i * 0.058;
    for (const s of [-1, 1]) {
      P.add('dark', rbox(0.0022, 0.008, 0.032, 0.001), [s * 0.0252, RB - 0.004, z]);
      P.add('dark', rbox(0.0022, 0.007, 0.03, 0.001), [s * 0.0198, RB - 0.0225, z], [0, 0, s * Math.PI / 4]);
    }
    P.add('dark', rbox(0.008, 0.0022, 0.032, 0.001), [0, RB - 0.0282, z]);
  }
  P.add('metal', cylG(0.0205, 0.0205, 0.01, 16), [0, RB, -0.122], [Math.PI / 2, 0, 0]);
  // ── 총열 · 소염기 (구멍) · 접이식 가늠자/가늠쇠
  P.add('metal', cylG(0.0095, 0.0095, 0.08, 14), [0, RB, -0.493], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.0125, 0.0125, 0.055, 14), [0, RB, -0.5605], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) P.add('dark', rbox(0.0022, 0.0075, 0.009, 0.001), [s * 0.0124, RB, -0.545 - i * 0.0135]);
  for (let i = 0; i < 2; i++) P.add('dark', rbox(0.0075, 0.0022, 0.009, 0.001), [0, RB + 0.0124, -0.55 - i * 0.016]);
  P.add('dark', cylG(0.0062, 0.0062, 0.002, 12), [0, RB, -0.5885], [Math.PI / 2, 0, 0]);
  P.add('metal', rbox(0.02, 0.011, 0.03, 0.003), [0, 0.083, -0.44]);
  P.add('metal', rbox(0.02, 0.01, 0.026, 0.003), [0, 0.076, 0.072]);
  // ── 핸드스톱 · 무기 조명
  P.add('poly', profile([[0.36, RB - 0.026], [0.405, RB - 0.026], [0.4, RB - 0.046], [0.385, RB - 0.047]], 0.022, 0.003));
  P.add('metal', rbox(0.012, 0.016, 0.03, 0.003), [0.027, RB + 0.014, -0.39], [0, 0, -0.6]);
  P.add('metal', cylG(0.011, 0.011, 0.085, 14), [0.036, RB + 0.02, -0.395], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.0135, 0.0125, 0.024, 14), [0.036, RB + 0.02, -0.448], [Math.PI / 2, 0, 0]);
  P.add('lensW', cylG(0.0112, 0.0112, 0.002, 14), [0.036, RB + 0.02, -0.4605], [Math.PI / 2, 0, 0]);
  P.add('dark', cylG(0.0048, 0.0048, 0.01, 8), [0.036, RB + 0.02, -0.348], [Math.PI / 2, 0, 0]);
  // 팀 색 테이프 (작은 표식)
  P.add('accent', rbox(0.0515, 0.0538, 0.009, 0.014), [0, RB - 0.002, -0.2]);
  // ── 완충관 · 성곽 너트 · 신축식 개머리판 (보관통 2개) · 고무 패드
  P.add('metal', cylG(0.0155, 0.0155, 0.22, 14), [0, 0.042, 0.195], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.019, 0.019, 0.012, 12), [0, 0.042, 0.092], [Math.PI / 2, 0, 0]);
  P.add('furn', profile([[-0.17, 0.064], [-0.31, 0.073], [-0.335, 0.07], [-0.338, -0.066], [-0.322, -0.072], [-0.27, -0.045], [-0.2, -0.01], [-0.172, 0.018]], 0.044, 0.007));
  for (const s of [-1, 1]) P.add('furn', cylG(0.0125, 0.0125, 0.13, 12), [s * 0.024, 0.04, 0.255], [Math.PI / 2, 0, 0]);
  P.add('rubber', rbox(0.046, 0.14, 0.014, 0.006), [0, 0.002, 0.338]);
  P.add('dark', rbox(0.01, 0.008, 0.03, 0.002), [0, 0.016, 0.2]);
  // ── 홀로그램 조준경 (본체 · 배터리부 · 후드 · 버튼 · QD 레버 · 유리창)
  P.add('poly', rbox(0.031, 0.024, 0.104, 0.004), [0, 0.081, -0.065]);
  P.add('poly', rbox(0.034, 0.018, 0.032, 0.005), [0, 0.088, -0.112]);
  for (const s of [-1, 1]) P.add('poly', rbox(0.0045, 0.046, 0.074, 0.0018), [s * 0.0198, OPTIC.y, OPTIC.z]);
  P.add('poly', rbox(0.0445, 0.0045, 0.078, 0.0018), [0, 0.1365, OPTIC.z]);
  P.add('poly', rbox(0.04, 0.005, 0.006, 0.0015), [0, 0.092, -0.03]);
  for (const x of [-0.008, 0.008]) P.add('dark', rbox(0.006, 0.005, 0.006, 0.0015), [x, 0.094, -0.024]);
  P.add('metal', rbox(0.004, 0.012, 0.026, 0.002), [-0.0185, 0.074, -0.06]);
  P.add('metal', rbox(0.004, 0.008, 0.012, 0.002), [0.0185, 0.074, -0.06]);
  P.add('glass', rbox(0.035, 0.031, 0.0015, 0.0007), [0, OPTIC.y - 0.001, -0.034]);
  P.add('glass', rbox(0.035, 0.031, 0.0015, 0.0007), [0, OPTIC.y - 0.001, -0.103]);
  return P;
}

// 30발 곡선 탄창 (원점 = 탄창 윗면 뒤쪽) + 맨 위 실탄
function buildMagParts() {
  const P = new Parts();
  P.add('furn', profile([[0.0, 0.004], [0.081, 0.004], [0.085, -0.04], [0.092, -0.09], [0.102, -0.14], [0.108, -0.162], [0.044, -0.172], [0.036, -0.152], [0.024, -0.1], [0.013, -0.05], [0.003, -0.02]], 0.0235, 0.0025));
  // 아래쪽 미끄럼 방지 홈
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const y = -0.1 - t * 0.048;
    const sMid = 0.066 + t * 0.012;
    for (const sx of [-1, 1]) P.add('poly', rbox(0.0016, 0.0036, 0.058, 0.0008), [sx * 0.0122, y, -sMid], [-0.22, 0, 0]);
  }
  // 측면 창 테두리 (PMAG 느낌)
  for (const sx of [-1, 1]) P.add('poly', rbox(0.0016, 0.05, 0.004, 0.0008), [sx * 0.0122, -0.045, -0.012], [0.12, 0, 0]);
  P.add('poly', rbox(0.029, 0.012, 0.072, 0.004), [0, -0.171, -0.077], [0.17, 0, 0]);
  P.add('dark', rbox(0.02, 0.004, 0.07, 0.001), [0, 0.002, -0.042]);
  P.add('brass', cylG(0.0048, 0.0048, 0.034, 12), [0, 0.0085, -0.03], [Math.PI / 2, 0, 0]);
  P.add('copper', cylG(0.0003, 0.0046, 0.022, 12), [0, 0.0085, -0.058], [-Math.PI / 2, 0, 0]);
  return P;
}

// 권총 프레임 (원점 = 손잡이 위)
const PB = 0.032; // 권총 총열 높이
function buildPistolFrame() {
  const P = new Parts();
  P.add('poly', profile([[-0.034, 0.018], [0.15, 0.018], [0.152, 0.006], [0.146, -0.004], [0.062, -0.004], [0.056, -0.012], [0.054, -0.033], [0.046, -0.039], [0.012, -0.039], [0.004, -0.03], [-0.03, -0.002], [-0.04, 0.012]], 0.0255, 0.003, [[[0.008, -0.011], [0.05, -0.011], [0.049, -0.03], [0.012, -0.031]]]));
  // 손잡이 (손가락 홈 · 비버테일)
  P.add('poly', profile([[0.004, -0.03], [-0.003, -0.044], [-0.002, -0.058], [-0.01, -0.07], [-0.009, -0.084], [-0.017, -0.096], [-0.02, -0.113], [-0.06, -0.116], [-0.064, -0.1], [-0.05, -0.03], [-0.048, -0.004], [-0.056, 0.006], [-0.04, 0.012], [-0.03, -0.002]], 0.0295, 0.004));
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) P.add('dark', rbox(0.0012, 0.0025, 0.03, 0.0006), [s * 0.0153, -0.04 - i * 0.01, 0.028 + i * 0.0028], [-0.3, 0, 0]);
  P.add('dark', rbox(0.0032, 0.017, 0.0045, 0.0015), [0, -0.019, -0.022], [0.25, 0, 0]); // 방아쇠
  for (let i = 0; i < 3; i++) P.add('dark', rbox(0.02, 0.0025, 0.007, 0.001), [0, -0.005, -0.08 - i * 0.012]); // 레일 홈
  P.add('metal', rbox(0.0285, 0.006, 0.012, 0.002), [0, 0.012, -0.045]); // 분해 레버
  P.add('metal', rbox(0.003, 0.006, 0.02, 0.0015), [-0.0135, 0.012, -0.015]); // 슬라이드 멈치
  return P;
}
function buildPistolSlide() {
  const P = new Parts();
  P.add('metal', profile([[-0.036, 0.018], [0.15, 0.018], [0.153, 0.03], [0.146, 0.049], [-0.031, 0.049], [-0.037, 0.042]], 0.0255, 0.0022));
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) P.add('dark', rbox(0.0012, 0.022, 0.0016, 0.0005), [s * 0.0128, 0.034, 0.012 + i * 0.0035]);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) P.add('dark', rbox(0.0012, 0.02, 0.0016, 0.0005), [s * 0.0128, 0.034, -0.114 - i * 0.0035]);
  P.add('dark', rbox(0.011, 0.002, 0.04, 0.001), [0.005, 0.0495, -0.03]); // 배출구
  P.add('metal', rbox(0.01, 0.0015, 0.035, 0.0006), [0.005, 0.0482, -0.03]);
  P.add('metal', rbox(0.0035, 0.007, 0.004, 0.001), [0, 0.0525, -0.139]); // 가늠쇠
  P.add('metal', rbox(0.0075, 0.007, 0.006, 0.0012), [-0.0068, 0.0525, 0.02]); // 가늠자 (가운데 홈)
  P.add('metal', rbox(0.0075, 0.007, 0.006, 0.0012), [0.0068, 0.0525, 0.02]);
  P.add('metal', cylG(0.0068, 0.0068, 0.004, 14), [0, PB, -0.152], [Math.PI / 2, 0, 0]);
  P.add('dark', cylG(0.0046, 0.0046, 0.0045, 12), [0, PB, -0.152], [Math.PI / 2, 0, 0]);
  P.add('tritium', new THREE.SphereGeometry(0.0013, 8, 6), [0, 0.0545, -0.1365]);
  for (const x of [-0.0068, 0.0068]) P.add('tritium', new THREE.SphereGeometry(0.0012, 8, 6), [x, 0.0535, 0.0232]);
  return P;
}
function buildPistolMag() {
  const P = new Parts();
  P.add('poly', rbox(0.019, 0.1, 0.03, 0.004), [0, -0.05, 0]);
  P.add('poly', rbox(0.025, 0.01, 0.042, 0.004), [0, -0.103, -0.002]);
  P.add('brass', cylG(0.0045, 0.0045, 0.02, 10), [0, 0.003, -0.002], [Math.PI / 2, 0, 0]);
  return P;
}

// 전술 나이프 (원점 = 손잡이 가운데, 칼날이 -z)
function buildKnifeParts() {
  const P = new Parts();
  const o = 0.058;
  P.add('blade', profile([[0.0, 0.002], [0.12, 0.0], [0.15, 0.006], [0.168, 0.014], [0.174, 0.02], [0.14, 0.024], [0.112, 0.031], [0.0, 0.031]], 0.0048, 0.0011), [0, -0.016, -o]);
  P.add('steel', profile([[0.004, 0.0005], [0.12, -0.0005], [0.15, 0.0055], [0.168, 0.0135], [0.1745, 0.0198], [0.17, 0.0205], [0.147, 0.0118], [0.12, 0.0072], [0.004, 0.0082]], 0.0056, 0.0007), [0, -0.016, -o]);
  P.add('dark', rbox(0.0058, 0.004, 0.085, 0.0015), [0, 0.006, -o - 0.06]);
  P.add('metal', rbox(0.012, 0.058, 0.008, 0.003), [0, 0.0, -o + 0.002]);
  P.add('rubber', rbox(0.024, 0.031, 0.104, 0.011), [0, 0.0, 0.0]);
  for (let i = 0; i < 6; i++) P.add('rubber', rbox(0.0262, 0.0332, 0.004, 0.0015), [0, 0, -0.04 + i * 0.016]);
  P.add('metal', rbox(0.026, 0.033, 0.014, 0.005), [0, 0.0, 0.058]);
  return P;
}

// ───────── 상점 총 (긴 총은 소총과 같은 권총 손잡이를 써서 오른손 자리가 같음) ─────────
function gripParts(P) {
  P.add('metal', profile([[-0.04, 0.0], [0.05, 0.0], [0.046, -0.04], [0.036, -0.046], [0.002, -0.044], [-0.006, -0.03], [-0.04, -0.004]], 0.024, 0.0025, [[[0.006, -0.013], [0.031, -0.013], [0.029, -0.029], [0.008, -0.03]]]));
  P.add('dark', rbox(0.0055, 0.022, 0.0055, 0.002), [0, -0.019, -0.018], [0.35, 0, 0]);
  P.add('furn', profile([[-0.004, 0.0], [0.007, -0.024], [0.0, -0.046], [-0.005, -0.066], [-0.019, -0.106], [-0.059, -0.114], [-0.068, -0.103], [-0.05, -0.04], [-0.043, -0.006], [-0.03, 0.004]], 0.031, 0.006));
  for (let i = 0; i < 6; i++) P.add('poly', rbox(0.026, 0.003, 0.004, 0.001), [0, -0.05 - i * 0.01, 0.052 + i * 0.0035], [-0.35, 0, 0]);
}

// 기관단총 (가속 SMG-9): 짧은 일체형 몸통 · 통풍구 소음기 · 곧은 탄창 · 철사 개머리판 · 도트 조준경
const SB = 0.046;
const DOT = { y: 0.1, z: -0.05 };
function buildSmgParts() {
  const P = new Parts();
  gripParts(P);
  P.add('poly', profile([[-0.08, 0.074], [0.2, 0.074], [0.212, 0.058], [0.212, 0.012], [0.14, 0.008], [0.12, -0.004], [0.05, -0.004], [0.0, 0.0], [-0.08, 0.006]], 0.038, 0.006));
  P.add('dark', rbox(0.0395, 0.004, 0.2, 0.001), [0, 0.03, -0.06]);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) P.add('dark', rbox(0.002, 0.016, 0.006, 0.001), [s * 0.0195, 0.05, -0.12 - i * 0.014]);
  P.add('metal', rbox(0.026, 0.026, 0.06, 0.004), [0, -0.006, -0.08]); // 탄창 삽입구
  rail(P, 0.077, 0.06, -0.16);
  P.add('metal', cylG(0.0075, 0.0075, 0.04, 10), [0.022, 0.058, 0.03], [Math.PI / 2, 0, 0]); // 장전 손잡이
  P.add('dark', rbox(0.012, 0.012, 0.012, 0.003), [0.022, 0.058, 0.055]);
  // 소음기 (통풍구 무늬)
  P.add('metal', cylG(0.019, 0.019, 0.17, 18), [0, SB, -0.297], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) P.add('dark', cylG(0.0193, 0.0193, 0.004, 18), [0, SB, -0.235 - i * 0.022], [Math.PI / 2, 0, 0]);
  P.add('dark', cylG(0.007, 0.007, 0.002, 12), [0, SB, -0.383], [Math.PI / 2, 0, 0]);
  // 손잡이 앞 엄지 받침
  P.add('poly', rbox(0.04, 0.012, 0.03, 0.004), [0, 0.0, -0.17]);
  // 도트 조준경 (작은 원통 + 받침)
  P.add('poly', rbox(0.024, 0.012, 0.034, 0.003), [0, 0.084, DOT.z]);
  P.add('metal', cylG(0.015, 0.015, 0.05, 16), [0, DOT.y, DOT.z], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.0165, 0.0165, 0.006, 16), [0, DOT.y, DOT.z - 0.026], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.006, 0.006, 0.01, 8), [0.017, DOT.y, DOT.z], [0, 0, Math.PI / 2]);
  P.add('glass', cylG(0.013, 0.013, 0.0015, 16), [0, DOT.y, DOT.z - 0.024], [Math.PI / 2, 0, 0]);
  // 철사 개머리판 + 고무 패드
  for (const [y, x] of [[0.05, 0.012], [0.05, -0.012], [-0.006, 0]]) P.add('steel', cylG(0.0042, 0.0042, 0.2, 8), [x, y, 0.17], [Math.PI / 2, 0, 0]);
  P.add('rubber', rbox(0.034, 0.085, 0.014, 0.005), [0, 0.022, 0.272]);
  P.add('accent', rbox(0.0392, 0.04, 0.008, 0.004), [0, 0.05, -0.185]);
  return P;
}
function buildSmgMag() {
  const P = new Parts();
  P.add('poly', rbox(0.022, 0.15, 0.034, 0.004), [0, -0.075, 0], [0.06, 0, 0]);
  for (let i = 0; i < 4; i++) P.add('dark', rbox(0.0225, 0.003, 0.03, 0.001), [0, -0.1 - i * 0.012, 0.006], [0.06, 0, 0]);
  P.add('poly', rbox(0.026, 0.012, 0.04, 0.004), [0, -0.152, 0.009]);
  P.add('brass', cylG(0.0045, 0.0045, 0.022, 10), [0, 0.003, 0.0], [Math.PI / 2, 0, 0]);
  return P;
}

// 산탄총 (탄성 SG-12): 펌프식 · 아래 탄창관 · 옆 탄띠 · 구슬 가늠쇠
const GB = 0.056;
function buildShotgunParts() {
  const P = new Parts();
  gripParts(P);
  P.add('metal', profile([[-0.07, 0.086], [0.15, 0.086], [0.155, 0.074], [0.155, 0.006], [0.05, 0.004], [0.0, 0.002], [-0.07, 0.01]], 0.04, 0.005));
  P.add('dark', rbox(0.0405, 0.012, 0.06, 0.002), [0.0, 0.056, -0.03]);
  P.add('dark', rbox(0.002, 0.018, 0.05, 0.001), [0.0205, 0.06, -0.03]); // 배출구
  // 총열 + 탄창관 + 고정 링
  P.add('metal', cylG(0.0115, 0.0115, 0.52, 18), [0, GB + 0.016, -0.41], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.013, 0.013, 0.45, 18), [0, 0.03, -0.37], [Math.PI / 2, 0, 0]);
  P.add('metal', rbox(0.03, 0.05, 0.016, 0.004), [0, 0.05, -0.6]);
  P.add('steel', new THREE.SphereGeometry(0.0035, 10, 8), [0, GB + 0.03, -0.664]);
  P.add('dark', cylG(0.009, 0.009, 0.002, 14), [0, GB + 0.016, -0.671], [Math.PI / 2, 0, 0]);
  // 옆 탄띠 (빨간 산탄 4발)
  P.add('poly', rbox(0.006, 0.034, 0.075, 0.003), [-0.0235, 0.048, -0.035]);
  for (let i = 0; i < 4; i++) {
    P.add('shell', cylG(0.0075, 0.0075, 0.036, 12), [-0.03, 0.048, -0.005 - i * 0.019]);
    P.add('brass', cylG(0.0078, 0.0078, 0.008, 12), [-0.03, 0.03, -0.005 - i * 0.019]);
  }
  // 개머리판
  P.add('furn', profile([[-0.065, 0.082], [-0.33, 0.05], [-0.345, 0.044], [-0.345, -0.09], [-0.33, -0.096], [-0.2, -0.048], [-0.12, -0.03], [-0.065, 0.0]], 0.042, 0.007));
  P.add('rubber', rbox(0.044, 0.142, 0.016, 0.006), [0, -0.022, 0.348]);
  P.add('steel', rbox(0.006, 0.012, 0.008, 0.002), [0, 0.094, 0.05]); // 가늠자
  return P;
}
function buildShotgunPump() {
  const P = new Parts();
  P.add('furn', rbox(0.046, 0.044, 0.17, 0.014), [0, 0, 0]);
  for (let i = 0; i < 6; i++) P.add('poly', rbox(0.0475, 0.038, 0.006, 0.002), [0, -0.002, -0.07 + i * 0.028]);
  P.add('metal', rbox(0.004, 0.006, 0.12, 0.001), [0.024, 0.016, 0.06]); // 펌프 막대
  return P;
}

// 저격총 (중력 OP-1): 노리쇠식 · 굵은 홈 총열 · 제퇴기 · 4배율 조준경 · 볼 받침 개머리판 · 접힌 양각대
const NB = 0.046;
const SCOPE = { y: 0.122, z: -0.06 };
function buildSniperParts() {
  const P = new Parts();
  gripParts(P);
  P.add('metal', rbox(0.044, 0.05, 0.3, 0.006), [0, 0.042, -0.04]);
  P.add('poly', profile([[0.11, 0.07], [0.52, 0.066], [0.53, 0.05], [0.53, -0.004], [0.11, -0.01]], 0.054, 0.006));
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) P.add('dark', rbox(0.002, 0.012, 0.03, 0.001), [s * 0.0272, 0.032, -0.17 - i * 0.05]);
  // 총열 (홈 6줄) + 제퇴기
  P.add('metal', cylG(0.0155, 0.013, 0.5, 18), [0, NB, -0.78], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    P.add('dark', rbox(0.003, 0.003, 0.26, 0.001), [Math.cos(a) * 0.0145, NB + Math.sin(a) * 0.0145, -0.7]);
  }
  P.add('metal', rbox(0.036, 0.032, 0.06, 0.006), [0, NB, -1.055]);
  for (const s of [-1, 1]) P.add('dark', rbox(0.002, 0.02, 0.012, 0.001), [s * 0.0185, NB, -1.055]);
  // 조준경 (경통 · 대물/접안 · 다이얼 · 고정 링)
  P.add('metal', cylG(0.0165, 0.0165, 0.27, 20), [0, SCOPE.y, SCOPE.z], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.029, 0.017, 0.07, 20), [0, SCOPE.y, SCOPE.z - 0.165], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.029, 0.029, 0.03, 20), [0, SCOPE.y, SCOPE.z - 0.212], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.02, 0.0165, 0.05, 20), [0, SCOPE.y, SCOPE.z + 0.16], [Math.PI / 2, 0, 0]);
  P.add('rubber', cylG(0.021, 0.021, 0.02, 20), [0, SCOPE.y, SCOPE.z + 0.19], [Math.PI / 2, 0, 0]);
  P.add('glass', cylG(0.026, 0.026, 0.002, 20), [0, SCOPE.y, SCOPE.z - 0.226], [Math.PI / 2, 0, 0]);
  P.add('dark', cylG(0.016, 0.016, 0.002, 20), [0, SCOPE.y, SCOPE.z + 0.2], [Math.PI / 2, 0, 0]);
  P.add('glass', cylG(0.0165, 0.0165, 0.002, 20), [0, SCOPE.y, SCOPE.z + 0.199], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.012, 0.012, 0.022, 14), [0, SCOPE.y + 0.026, SCOPE.z]);
  P.add('metal', cylG(0.012, 0.012, 0.022, 14), [0.026, SCOPE.y, SCOPE.z], [0, 0, Math.PI / 2]);
  for (const z of [SCOPE.z - 0.085, SCOPE.z + 0.075]) {
    P.add('metal', rbox(0.038, 0.012, 0.02, 0.003), [0, 0.072, z]);
    P.add('metal', rbox(0.006, 0.05, 0.02, 0.002), [0.019, 0.095, z]);
    P.add('metal', rbox(0.006, 0.05, 0.02, 0.002), [-0.019, 0.095, z]);
  }
  rail(P, 0.069, 0.1, -0.2);
  // 노리쇠 손잡이
  P.add('steel', cylG(0.0045, 0.0045, 0.055, 10), [0.034, 0.05, 0.075], [0, 0, Math.PI / 2 - 0.45]);
  P.add('steel', new THREE.SphereGeometry(0.0095, 12, 10), [0.057, 0.039, 0.075]);
  // 개머리판 (볼 받침 · 손잡이 구멍)
  P.add('furn', profile([[-0.1, 0.07], [-0.36, 0.07], [-0.372, 0.06], [-0.372, -0.098], [-0.35, -0.104], [-0.25, -0.05], [-0.2, -0.04], [-0.1, -0.02]], 0.046, 0.007, [[[-0.17, 0.035], [-0.27, 0.035], [-0.27, -0.01], [-0.17, -0.004]]]));
  P.add('furn', rbox(0.04, 0.026, 0.14, 0.008), [0, 0.095, 0.24]);
  P.add('rubber', rbox(0.048, 0.17, 0.016, 0.006), [0, -0.012, 0.375]);
  // 접힌 양각대
  for (const s of [-1, 1]) {
    P.add('metal', cylG(0.0048, 0.0048, 0.2, 8), [s * 0.016, 0.0, -0.41], [Math.PI / 2, 0, 0]);
    P.add('rubber', rbox(0.012, 0.012, 0.02, 0.003), [s * 0.016, 0.0, -0.3]);
  }
  P.add('accent', rbox(0.0545, 0.03, 0.01, 0.004), [0, 0.032, -0.24]);
  return P;
}
function buildSniperMag() {
  const P = new Parts();
  P.add('poly', rbox(0.032, 0.062, 0.085, 0.005), [0, -0.031, 0]);
  P.add('brass', cylG(0.006, 0.006, 0.05, 10), [0, 0.004, 0.0], [Math.PI / 2, 0, 0]);
  return P;
}

// 리볼버 (줄 M-6): 강철 틀 · 홈 파인 실린더 · 위 리브 · 나무 손잡이
const RVB = 0.04;
function buildSheriffParts() {
  const P = new Parts();
  // 틀: 실린더 뒤 받침 + 위 띠 + 아래 틀 (실린더가 보이게 가운데는 비움)
  P.add('steel', profile([[-0.046, 0.058], [-0.002, 0.06], [-0.002, 0.0], [-0.026, -0.002], [-0.05, 0.03]], 0.026, 0.003));
  P.add('steel', rbox(0.016, 0.009, 0.056, 0.003), [0, 0.057, -0.028]);
  P.add('steel', rbox(0.02, 0.01, 0.054, 0.003), [0, 0.002, -0.028]);
  P.add('steel', profile([[0.004, -0.004], [0.034, -0.004], [0.032, -0.028], [0.008, -0.03]], 0.008, 0.002, [[[0.01, -0.008], [0.028, -0.008], [0.026, -0.022], [0.012, -0.022]]]));
  P.add('dark', rbox(0.004, 0.018, 0.005, 0.0015), [0, -0.012, -0.016], [0.3, 0, 0]);
  // 총열 · 위 리브 · 가늠쇠 · 배출봉
  P.add('steel', rbox(0.02, 0.026, 0.155, 0.004), [0, RVB, -0.13]);
  P.add('steel', rbox(0.008, 0.01, 0.155, 0.002), [0, RVB + 0.016, -0.13]);
  for (let i = 0; i < 6; i++) P.add('dark', rbox(0.0085, 0.002, 0.008, 0.0005), [0, RVB + 0.0215, -0.07 - i * 0.022]);
  P.add('steel', rbox(0.004, 0.01, 0.006, 0.0015), [0, RVB + 0.024, -0.2]);
  P.add('dark', cylG(0.0055, 0.0055, 0.002, 12), [0, RVB, -0.208], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.006, 0.006, 0.12, 10), [0, RVB - 0.02, -0.12], [Math.PI / 2, 0, 0]);
  P.add('steel', rbox(0.008, 0.018, 0.016, 0.002), [0, 0.066, 0.035], [-0.6, 0, 0]); // 공이치기
  // 나무 손잡이
  P.add('furn', profile([[0.004, -0.004], [-0.002, -0.03], [-0.012, -0.06], [-0.026, -0.09], [-0.056, -0.096], [-0.062, -0.08], [-0.05, -0.03], [-0.046, 0.012], [-0.02, 0.01]], 0.032, 0.007));
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) P.add('dark', rbox(0.0012, 0.0025, 0.026, 0.0006), [s * 0.0165, -0.03 - i * 0.012, 0.03 + i * 0.004], [-0.3, 0, 0]);
  return P;
}
// 실린더 (발사할 때마다 한 칸 돎)
function buildCylinder() {
  const P = new Parts();
  P.add('steel', cylG(0.022, 0.022, 0.044, 18), [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    P.add('dark', rbox(0.006, 0.006, 0.034, 0.002), [Math.cos(a) * 0.021, Math.sin(a) * 0.021, 0]);
    const b = (i / 6) * Math.PI * 2;
    P.add('brass', cylG(0.0045, 0.0045, 0.002, 10), [Math.cos(b) * 0.0125, Math.sin(b) * 0.0125, 0.023], [Math.PI / 2, 0, 0]);
  }
  return P;
}

// 1인칭 팔과 총. 별도 장면/카메라에 그려 벽에 총이 파묻히지 않게 하고, 화면 처리(렌즈·노이즈)는 함께 받는다.
export class ViewModel {
  constructor(team, { detail = 2 } = {}) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight('#7d8aa2', '#1a1712', 0.7);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#f3dcc0', 1.25);
    this.key.position.set(0.7, 1.2, 0.35);
    this.scene.add(this.key);
    const fill = new THREE.DirectionalLight('#9fb6d8', 0.4);
    fill.position.set(-1, 0.3, 0.3);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight('#c9d6ea', 0.7);
    rim.position.set(-0.4, 0.7, -1.2);
    this.scene.add(rim);
    this.muzzleLight = new THREE.PointLight('#ffb866', 0, 2.5, 2);
    this.scene.add(this.muzzleLight);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    const T = teamMaterials(team);
    const force = team === 'force';
    const accent = TEAM_INFO[team].color;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.mats = {
      metal: std({ color: '#25272b', roughness: 0.5, metalness: 0.25 }),
      dark: std({ color: '#0e0f10', roughness: 0.7, metalness: 0.1 }),
      poly: std({ color: '#25262a', roughness: 0.74, metalness: 0.0 }),
      furn: std({ color: force ? '#86714f' : '#3f4247', roughness: 0.72, metalness: 0.02 }),
      rubber: std({ color: '#141516', roughness: 0.9 }),
      glove: std({ color: force ? '#62574a' : '#3a3d43', roughness: 0.86 }),
      gloveHard: std({ color: force ? '#3c372d' : '#1b1c1f', roughness: 0.5, metalness: 0.08 }),
      sleeve: std({ map: T.camoMap, color: force ? '#c4bba8' : '#848b98', roughness: 0.93 }),
      watch: std({ color: '#18191b', roughness: 0.55, metalness: 0.2 }),
      watchFace: new THREE.MeshBasicMaterial({ color: '#2f8a63' }),
      steel: std({ color: '#b6bcc2', roughness: 0.22, metalness: 0.95 }),
      blade: std({ color: '#2a2c30', roughness: 0.42, metalness: 0.55 }),
      brass: std({ color: '#b58a3c', roughness: 0.32, metalness: 0.9 }),
      copper: std({ color: '#a86a42', roughness: 0.35, metalness: 0.85 }),
      glass: std({ color: '#2c4450', roughness: 0.04, metalness: 0.4, transparent: true, opacity: 0.22, depthWrite: false }),
      lensW: std({ color: '#aab4bb', roughness: 0.1, metalness: 0.3, emissive: '#3a3f44', emissiveIntensity: 0.4 }),
      tritium: new THREE.MeshBasicMaterial({ color: '#7dff8a' }),
      accent: std({ color: accent, roughness: 0.6, emissive: accent, emissiveIntensity: 0.02 }),
      shell: std({ color: '#a8261d', roughness: 0.55 }),
      core: std({ color: '#2a2d31', emissive: '#d9822b', emissiveIntensity: 0, roughness: 0.4 }),
    };
    this.reticleMat = new THREE.MeshBasicMaterial({ color: '#ff3a26', transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });

    // 손·총 부품은 총마다 스킨 메시 몇 개로 합쳐 그림 (그리기 호출 54 → 약 5)
    this.solidMat = makeSolidMaterial({ strobe: 1 });
    this.skeletons = [];
    this.guns = {};
    const GUNS = [
      ['rifle', () => this.buildRifle()], ['pistol', () => this.buildPistol()], ['knife', () => this.buildKnife()],
      ['smg', () => this.buildSmg()], ['shotgun', () => this.buildShotgun()], ['sniper', () => this.buildSniper()], ['sheriff', () => this.buildSheriff()],
    ];
    for (const [id, build] of GUNS) {
      this.pending = [];
      this.guns[id] = withDetail(detail, build);
      this.bake(this.guns[id].group);
    }
    for (const g of Object.values(this.guns)) this.root.add(g.group);

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: '#ffd7a0', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.flash.visible = false;
    this.flash.scale.setScalar(0.1);
    this.scene.add(this.flash);
    this.flashT = 0;

    this.current = 'rifle';
    this.sway = new Spring(90, 14, 0.08); // 시점 회전에 따른 관성
    this.inertia = new Spring(70, 12, 0.08); // 이동 가속에 따른 관성
    this.kick = new Spring(190, 19, 0.09); // 반동: 위치 (m)
    this.kickRot = new Spring(150, 15.5, 0.4); // 반동: 회전 (rad)
    this.bob = 0;
    this.land = 0;
    this.lower = 0;
    this.time = 0;
    this.insp = 0;
    this.prevVel = new V3();
    this.swingT = 0;
    this.swingDur = 1;
    this.swingHeavy = false;
    this.slideT = 0;
    this.seated = false;
    this.tmpV = new V3();
    this.tmpE = new THREE.Euler();
  }

  // 부품 묶음 = 뼈대 하나 (형상은 bake에서 총 단위로 합침)
  mount(parent, parts) {
    const g = new THREE.Group();
    this.pending.push({ bone: g, geos: parts.build() });
    parent.add(g);
    return g;
  }

  // 총 하나(손 포함)의 부품을 재질 묶음별 스킨 메시로: 단색(정점 색) · 소매(위장 무늬) · 유리(반투명)
  bake(group) {
    const list = this.pending;
    this.pending = [];
    const bones = list.map((x) => x.bone);
    const skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
    this.skeletons.push(skeleton);
    const emissive = { watchFace: 1, tritium: 1.4, lensW: 0.15 };
    const geos = mergeSkinned(list.map((x) => x.geos), (mat) => {
      if (mat === 'sleeve' || mat === 'glass') return { cls: mat };
      const src = this.mats[mat];
      return { cls: 'solid', color: src.color, rme: [src.roughness ?? 1, src.metalness ?? 0, emissive[mat] ?? 0] };
    });
    for (const [cls, geo] of Object.entries(geos)) {
      const m = new THREE.SkinnedMesh(geo, cls === 'solid' ? this.solidMat : this.mats[cls]);
      m.name = `vm:${cls}`;
      m.bind(skeleton, new THREE.Matrix4());
      m.frustumCulled = false;
      if (cls === 'glass') m.renderOrder = 2;
      group.add(m);
    }
  }

  // 손: 손 로컬 anchor 점이 총 로컬 at 에 오도록. f = 손가락 방향, b = 손등 방향, arm = 팔뚝 방향 (모두 총 로컬)
  hand(parent, side, pose, { at, f, b, anchor = new V3(0, -0.028, -0.072), arm, watch = false }) {
    const q = handQ(f, b);
    const dir = arm.clone().normalize().applyQuaternion(q.clone().invert());
    const g = this.mount(parent, buildHand(side, pose, { dir, watch }));
    g.quaternion.copy(q);
    g.position.copy(at).sub(anchor.clone().applyQuaternion(q));
    return g;
  }

  buildRifle() {
    const g = new THREE.Group();
    this.mount(g, buildRifleParts());
    // 합력 강화 코어 (핸드가드 왼쪽 모듈)
    const core = new THREE.Mesh(cylG(0.0075, 0.0075, 0.06, 12), this.mats.core);
    core.rotation.x = Math.PI / 2;
    core.position.set(-0.0285, RB + 0.004, -0.255);
    g.add(core);
    const coreHouse = new THREE.Mesh(rbox(0.012, 0.022, 0.074, 0.004), this.mats.poly);
    coreHouse.position.set(-0.031, RB + 0.004, -0.255);
    g.add(coreHouse);
    // 탄창
    const mag = hideableBone(new THREE.Group());
    const magHome = new V3(0, -0.032, -0.044);
    mag.position.copy(magHome);
    this.mount(mag, buildMagParts());
    g.add(mag);
    // 무한 원점에 맺히는 홀로그램 조준선 (총 방향을 그대로 따름 → 정조준 시 화면 중앙)
    const reticle = new THREE.Group();
    reticle.position.set(0, OPTIC.y, OPTIC.z);
    const D = 2.5;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(D * Math.tan(0.0026), 16), this.reticleMat);
    dot.position.z = -D;
    const ring = new THREE.Mesh(new THREE.RingGeometry(D * Math.tan(0.0235), D * Math.tan(0.0262), 48), this.reticleMat);
    ring.position.z = -D;
    reticle.add(dot, ring);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(D * 0.0026, D * 0.009), this.reticleMat);
      const a = (i * Math.PI) / 2;
      tick.position.set(Math.sin(a) * D * 0.0295, Math.cos(a) * D * 0.0295, -D);
      tick.rotation.z = -a;
      reticle.add(tick);
    }
    for (const m of reticle.children) m.renderOrder = 5;
    reticle.visible = false;
    g.add(reticle);
    // 오른손: 권총 손잡이 (검지는 방아쇠에)
    this.hand(g, 1, {
      curl: [[0.55, 1.15, 0.55], [1.45, 1.5, 0.9], [1.5, 1.5, 0.9], [1.5, 1.45, 0.85]],
      spread: [-0.12, 0, 0.05, 0.12],
      thumb: { yaw: 0.9, roll: 0.9, curl: [0.15, 0.35, 0.3] },
    }, { at: new V3(0, -0.052, 0.034), f: new V3(0, -0.36, -0.93), b: new V3(1, 0.12, 0.05), arm: new V3(0.28, -0.42, 0.86) });
    // 왼손: C자 파지 — 손등은 왼쪽, 손가락은 핸드가드 아래로 감싸고 엄지는 위로 넘겨 앞을 향함
    const left = this.hand(g, -1, {
      curl: [[0.9, 1.0, 0.6], [0.95, 1.05, 0.6], [1.0, 1.05, 0.6], [1.05, 1.0, 0.6]],
      spread: [0.05, 0, -0.05, -0.1],
      thumb: { yaw: 0.55, roll: -0.5, curl: [0.25, 0.3, 0.2] },
    }, { at: new V3(0, RB, -0.3), f: new V3(0.3, -0.95, 0.05), b: new V3(-0.95, -0.3, 0), anchor: new V3(0, -0.043, -0.052), arm: new V3(-0.34, -0.78, 0.52), watch: true });
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, RB, -0.6);
    g.add(muzzle);
    const port = new THREE.Object3D();
    port.position.set(0.02, 0.05, -0.008);
    g.add(port);
    return {
      group: g, muzzle, port, core, mag, magHome, left, leftHome: left.position.clone(), leftQ: left.quaternion.clone(), leftAt: new V3(0, RB, -0.3), reticle,
      kind: 'long',
      scale: 0.8,
      hip: new V3(0.17, -0.152, -0.34), hipRot: new THREE.Euler(0.02, 0.035, 0.07),
      sight: new V3(0, OPTIC.y, OPTIC.z), eye: 0.2,
    };
  }

  buildPistol() {
    const g = new THREE.Group();
    this.mount(g, buildPistolFrame());
    const slide = new THREE.Group();
    this.mount(slide, buildPistolSlide());
    g.add(slide);
    const mag = hideableBone(new THREE.Group());
    const magHome = new V3(0, 0.0, -0.002);
    mag.position.copy(magHome);
    mag.rotation.x = -0.36;
    this.mount(mag, buildPistolMag());
    g.add(mag);
    const core = new THREE.Mesh(rbox(0.003, 0.008, 0.05, 0.001), this.mats.core);
    core.position.set(0.0132, 0.008, -0.085);
    g.add(core);
    this.hand(g, 1, {
      curl: [[0.45, 1.1, 0.5], [1.45, 1.5, 0.9], [1.5, 1.5, 0.9], [1.5, 1.45, 0.85]],
      spread: [-0.1, 0, 0.05, 0.12],
      thumb: { yaw: 0.85, roll: 0.7, curl: [0.1, 0.2, 0.15] },
    }, { at: new V3(0, -0.055, 0.026), f: new V3(0, -0.37, -0.93), b: new V3(1, 0.1, 0.05), arm: new V3(0.2, -0.45, 0.87) });
    // 왼손: 오른손을 감싸 쥠 (엄지는 프레임을 따라 앞으로)
    const left = this.hand(g, -1, {
      curl: [[1.1, 1.3, 0.8], [1.15, 1.35, 0.8], [1.2, 1.3, 0.8], [1.25, 1.3, 0.8]],
      spread: [0, 0, -0.05, -0.1],
      thumb: { yaw: 0.25, roll: 0.0, curl: [0.0, 0.05, 0.05] },
    }, { at: new V3(-0.006, -0.06, -0.012), f: new V3(0.1, -0.3, -0.95), b: new V3(-1, -0.05, 0.1), anchor: new V3(0, -0.04, -0.075), arm: new V3(-0.42, -0.55, 0.72), watch: true });
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, PB, -0.156);
    g.add(muzzle);
    const port = new THREE.Object3D();
    port.position.set(0.014, 0.046, -0.03);
    g.add(port);
    return {
      group: g, muzzle, port, core, slide, mag, magHome, left, leftHome: left.position.clone(), leftQ: left.quaternion.clone(), leftAt: new V3(-0.006, -0.06, -0.012),
      kind: 'side',
      scale: 1,
      hip: new V3(0.13, -0.122, -0.38), hipRot: new THREE.Euler(0.05, 0.1, 0.0),
      sight: new V3(0, 0.0555, 0.02), eye: 0.26,
    };
  }

  buildKnife() {
    const g = new THREE.Group();
    const knife = new THREE.Group();
    this.mount(knife, buildKnifeParts());
    g.add(knife);
    this.hand(g, 1, {
      curl: [[1.35, 1.45, 0.8], [1.45, 1.5, 0.85], [1.5, 1.5, 0.85], [1.5, 1.45, 0.85]],
      spread: [-0.05, 0, 0.05, 0.12],
      thumb: { yaw: 0.9, roll: 1.0, curl: [0.2, 0.45, 0.3] },
    }, { at: new V3(0, 0, 0.004), f: new V3(-0.6, 0.8, 0), b: new V3(-0.8, -0.6, 0), anchor: new V3(0, -0.031, -0.07), arm: new V3(0.55, -0.55, 0.62) });
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -0.23);
    g.add(muzzle);
    return {
      group: g, muzzle, port: muzzle, core: null, knife,
      kind: 'knife',
      scale: 0.85,
      hip: new V3(0.11, -0.112, -0.3), hipRot: new THREE.Euler(0.3, 0.4, -0.35),
    };
  }

  // 긴 총 공통: 총 부품 + 탄창(또는 펌프) + 합력 코어 + 두 손
  buildLong({ parts, mag, magHome, leftAt, muzzleZ, bore, port, sight, eye, hip, hipRot, scale, kind = 'long', coreAt, dot = null }) {
    const g = new THREE.Group();
    this.mount(g, parts);
    let magBone = null;
    if (mag) {
      magBone = hideableBone(new THREE.Group());
      magBone.position.copy(magHome);
      this.mount(magBone, mag);
      g.add(magBone);
    }
    const core = new THREE.Mesh(cylG(0.006, 0.006, 0.05, 12), this.mats.core);
    core.rotation.x = Math.PI / 2;
    core.position.copy(coreAt);
    g.add(core);
    this.hand(g, 1, {
      curl: [[0.55, 1.15, 0.55], [1.45, 1.5, 0.9], [1.5, 1.5, 0.9], [1.5, 1.45, 0.85]],
      spread: [-0.12, 0, 0.05, 0.12],
      thumb: { yaw: 0.9, roll: 0.9, curl: [0.15, 0.35, 0.3] },
    }, { at: new V3(0, -0.052, 0.034), f: new V3(0, -0.36, -0.93), b: new V3(1, 0.12, 0.05), arm: new V3(0.28, -0.42, 0.86) });
    const left = this.hand(g, -1, {
      curl: [[0.9, 1.0, 0.6], [0.95, 1.05, 0.6], [1.0, 1.05, 0.6], [1.05, 1.0, 0.6]],
      spread: [0.05, 0, -0.05, -0.1],
      thumb: { yaw: 0.55, roll: -0.5, curl: [0.25, 0.3, 0.2] },
    }, { at: leftAt.clone(), f: new V3(0.3, -0.95, 0.05), b: new V3(-0.95, -0.3, 0), anchor: new V3(0, -0.043, -0.052), arm: new V3(-0.34, -0.78, 0.52), watch: true });
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, bore, muzzleZ);
    g.add(muzzle);
    const portO = new THREE.Object3D();
    portO.position.copy(port);
    g.add(portO);
    // 도트 조준경 점 (정조준 때만)
    let reticle = null;
    if (dot) {
      reticle = new THREE.Group();
      reticle.position.copy(dot);
      const D = 2.5;
      const m = new THREE.Mesh(new THREE.CircleGeometry(D * Math.tan(0.0032), 16), this.reticleMat);
      m.position.z = -D;
      m.renderOrder = 5;
      reticle.add(m);
      reticle.visible = false;
      g.add(reticle);
    }
    return {
      group: g, muzzle, port: portO, core, mag: magBone, magHome: magHome?.clone(), left, leftHome: left.position.clone(), leftQ: left.quaternion.clone(), leftAt: leftAt.clone(), reticle,
      kind, scale, hip, hipRot, sight, eye,
    };
  }

  buildSmg() {
    return this.buildLong({
      parts: buildSmgParts(), mag: buildSmgMag(), magHome: new V3(0, -0.012, -0.08),
      leftAt: new V3(0, SB, -0.24), muzzleZ: -0.385, bore: SB, port: new V3(0.02, 0.05, -0.04),
      coreAt: new V3(-0.021, 0.03, -0.12), dot: new V3(0, DOT.y, DOT.z),
      sight: new V3(0, DOT.y, DOT.z), eye: 0.22, scale: 0.85,
      hip: new V3(0.16, -0.15, -0.33), hipRot: new THREE.Euler(0.02, 0.04, 0.07),
    });
  }

  buildShotgun() {
    const gun = this.buildLong({
      parts: buildShotgunParts(), mag: buildShotgunPump(), magHome: new V3(0, 0.03, -0.32),
      leftAt: new V3(0, 0.03, -0.32), muzzleZ: -0.672, bore: GB + 0.016, port: new V3(0.022, 0.06, -0.03),
      coreAt: new V3(-0.022, 0.07, -0.08), kind: 'pump',
      sight: new V3(0, 0.1, 0.05), eye: 0.24, scale: 0.78,
      hip: new V3(0.17, -0.16, -0.35), hipRot: new THREE.Euler(0.02, 0.035, 0.07),
    });
    gun.pump = gun.mag;
    return gun;
  }

  buildSniper() {
    return this.buildLong({
      parts: buildSniperParts(), mag: buildSniperMag(), magHome: new V3(0, -0.006, -0.075),
      leftAt: new V3(0, 0.032, -0.36), muzzleZ: -1.09, bore: NB, port: new V3(0.024, 0.06, 0.02),
      coreAt: new V3(-0.029, 0.035, -0.3),
      sight: new V3(0, SCOPE.y, SCOPE.z + 0.2), eye: 0.12, scale: 0.72,
      hip: new V3(0.18, -0.18, -0.4), hipRot: new THREE.Euler(0.02, 0.03, 0.06),
    });
  }

  buildSheriff() {
    const g = new THREE.Group();
    this.mount(g, buildSheriffParts());
    const cyl = new THREE.Group();
    cyl.position.set(0, 0.03, -0.026);
    this.mount(cyl, buildCylinder());
    g.add(cyl);
    const core = new THREE.Mesh(rbox(0.003, 0.008, 0.05, 0.001), this.mats.core);
    core.position.set(0.0105, RVB, -0.13);
    g.add(core);
    this.hand(g, 1, {
      curl: [[0.45, 1.1, 0.5], [1.45, 1.5, 0.9], [1.5, 1.5, 0.9], [1.5, 1.45, 0.85]],
      spread: [-0.1, 0, 0.05, 0.12],
      thumb: { yaw: 0.85, roll: 0.7, curl: [0.1, 0.2, 0.15] },
    }, { at: new V3(0, -0.055, 0.026), f: new V3(0, -0.37, -0.93), b: new V3(1, 0.1, 0.05), arm: new V3(0.2, -0.45, 0.87) });
    const left = this.hand(g, -1, {
      curl: [[1.1, 1.3, 0.8], [1.15, 1.35, 0.8], [1.2, 1.3, 0.8], [1.25, 1.3, 0.8]],
      spread: [0, 0, -0.05, -0.1],
      thumb: { yaw: 0.25, roll: 0.0, curl: [0.0, 0.05, 0.05] },
    }, { at: new V3(-0.006, -0.06, -0.012), f: new V3(0.1, -0.3, -0.95), b: new V3(-1, -0.05, 0.1), anchor: new V3(0, -0.04, -0.075), arm: new V3(-0.42, -0.55, 0.72), watch: true });
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, RVB, -0.21);
    g.add(muzzle);
    const port = new THREE.Object3D();
    port.position.set(0.014, 0.03, -0.026);
    g.add(port);
    return {
      group: g, muzzle, port, core, cyl, left, leftHome: left.position.clone(), leftQ: left.quaternion.clone(), leftAt: new V3(-0.006, -0.06, -0.012),
      kind: 'revolver',
      scale: 1,
      hip: new V3(0.13, -0.122, -0.38), hipRot: new THREE.Euler(0.05, 0.1, 0.0),
      sight: new V3(0, RVB + 0.028, 0.03), eye: 0.26,
    };
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // 발사 반동: 총구가 크게 들리고 뒤로 밀리며 살짝 비틀림 (권총은 강하게 튐)
  shot(ads) {
    const s = ads ? 0.62 : 1;
    const r = () => Math.random() - 0.5;
    const kind = this.guns[this.current]?.kind;
    if (kind === 'side' || kind === 'revolver') {
      const k = kind === 'revolver' ? 1.5 : 1;
      this.kick.impulse(new V3(r() * 0.06 * s, 0.11 * s * k, 0.85 * s * k));
      this.kickRot.impulse(new V3((3.4 + Math.random() * 0.8) * s * k, r() * 0.7 * s, r() * 1.1 * s));
      this.slideT = 0.07;
      this.cylT = 0.12;
    } else {
      // 무기마다 반동 세기: 기관단총은 가볍게, 산탄총·저격총은 크게
      const k = { smg: 0.55, shotgun: 1.9, sniper: 2.3 }[this.current] ?? 1;
      this.kick.impulse(new V3(r() * 0.07 * s, 0.07 * s * k, 0.95 * s * Math.sqrt(k)));
      this.kickRot.impulse(new V3((1.9 + Math.random() * 0.7) * s * k, r() * 0.8 * s, r() * 1.6 * s * Math.min(1.4, k)));
      if (kind === 'pump') this.pumpT = 0.55;
    }
    this.flashT = 0.045;
    this.flash.material.rotation = Math.random() * Math.PI;
    const big = { rifle: 0.2, shotgun: 0.3, sniper: 0.32, smg: 0.12, sheriff: 0.2 }[this.current] ?? 0.14;
    const sz = big * (0.85 + Math.random() * 0.3) * (ads ? 0.8 : 1);
    this.flash.scale.set(sz, sz, sz);
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
    dt = Math.max(0, Math.min(dt, 0.1)); // 프레임 시간이 음수로 들어와도 반동·섬광이 거꾸로 돌지 않게
    this.time += dt;
    // 무대가 넣어 준 환경맵을 재질별 세기로 적용
    if (this.scene.environment && this.envSet !== this.scene.environment) {
      this.envSet = this.scene.environment;
      for (const [k, m] of Object.entries(this.mats)) {
        if (!m.isMeshStandardMaterial) continue;
        m.envMap = this.envSet;
        m.envMapIntensity = ENV[k] ?? 0.1;
        m.needsUpdate = true;
      }
    }
    if (this.current !== s.weapon) {
      this.insp = 0;
      this.swingT = 0;
    }
    this.current = s.weapon;
    for (const [id, g] of Object.entries(this.guns)) g.group.visible = id === s.weapon && s.visible;
    if (!s.visible) {
      this.flash.visible = false;
      this.muzzleLight.intensity = 0;
      return;
    }
    const gun = this.guns[s.weapon];
    const g = gun.group;
    const W = WEAPONS[s.weapon];
    const adsRaw = s.adsT ?? 0;
    const ads = smooth(adsRaw);
    const settle = 1 - adsRaw * 0.8;

    // 관성: 시점 회전 → 총이 늦게 따라옴, 이동 가속 → 총이 반대로 밀림
    this.sway.impulse(this.tmpV.set(-(s.lookDx ?? 0) * 0.00006, (s.lookDy ?? 0) * 0.00006, 0));
    this.sway.step(dt);
    const vel = new V3(s.velLocal?.x ?? 0, s.velLocal?.y ?? 0, s.velLocal?.z ?? 0);
    const acc = vel.clone().sub(this.prevVel);
    this.prevVel.copy(vel);
    if (acc.length() < 20) this.inertia.impulse(acc.multiplyScalar(-0.0035));
    this.inertia.step(dt);
    this.kick.step(dt);
    this.kickRot.step(dt);

    const moving = s.onGround && s.speed > 0.5;
    this.bob += dt * (moving ? s.speed * 1.7 : 1.1);
    const bobAmp = (moving ? Math.min(1, s.speed / 5) : 0.12) * settle * (s.crouch > 0.5 ? 0.6 : 1);
    this.land = Math.max(0, this.land - dt * 3.5);
    this.lower += ((s.lockpick ? 1 : 0) - this.lower) * Math.min(1, dt * 8);

    const draw = s.swapT > 0 ? clamp01(s.swapT / W.draw) : 0;
    const reload = s.reloadT > 0 && !W.melee ? clamp01(1 - s.reloadT / W.reload) : 0;
    const rl = reload > 0 ? bump(reload, 0, 0.12, 0.84, 1) : 0;
    // 탄창 확인 (T): 재장전·꺼내기·락픽 중에는 억제
    const inspTarget = reload > 0 || draw > 0.05 || s.lockpick || adsRaw > 0.5 ? 0 : clamp01(s.inspect ?? 0);
    this.insp = damp(this.insp, inspTarget, reload > 0 ? 18 : 9, dt);
    const ie = smooth(this.insp);

    // 정조준 위치: 조준점(sight)이 눈 앞 eye 거리, 화면 정중앙에 오도록
    const sc = gun.scale ?? 1;
    const adsPos = gun.sight ? this.tmpV.set(-gun.sight.x * sc, -gun.sight.y * sc, -gun.eye - gun.sight.z * sc) : gun.hip;
    const pos = gun.hip.clone().lerp(adsPos, ads);
    pos.x += Math.sin(this.bob) * 0.011 * bobAmp + this.sway.x.x + this.inertia.x.x;
    pos.y += -Math.abs(Math.cos(this.bob)) * 0.01 * bobAmp + Math.sin(this.time * 1.6) * 0.0015 * settle + this.sway.x.y + this.inertia.x.y;
    pos.y += -draw * 0.22 - this.lower * 0.35 - this.land * 0.025 - (s.crouch ?? 0) * 0.008 * (1 - ads);
    pos.z += this.inertia.x.z * 0.5;
    pos.add(this.kick.x);
    const rot = this.tmpE.set(
      gun.hipRot.x * (1 - ads) + this.kickRot.x.x + draw * 0.6 + this.sway.x.y * 1.2,
      gun.hipRot.y * (1 - ads) + this.kickRot.x.y + this.sway.x.x * 1.4,
      gun.hipRot.z * (1 - ads) + this.kickRot.x.z + Math.sin(this.bob) * 0.012 * bobAmp,
    );
    // 재장전 중 총 기울임
    const kind = gun.kind;
    const long = kind === 'long' || kind === 'pump';
    if (long) {
      pos.x += -0.04 * rl;
      pos.y += 0.02 * rl;
      pos.z += 0.03 * rl;
      rot.x += 0.18 * rl;
      rot.y += -0.12 * rl;
      rot.z += 0.5 * rl;
    } else if (kind === 'side' || kind === 'revolver') {
      pos.y += 0.02 * rl;
      pos.z += 0.04 * rl;
      rot.x += 0.45 * rl;
      rot.z += (kind === 'revolver' ? 0.8 : 0.35) * rl;
    }
    // 탄창 확인: 총을 몸 쪽으로 당겨 기울여 왼쪽 면과 탄창을 보여줌
    if (ie > 0.001) {
      if (long) {
        pos.x += -0.07 * ie;
        pos.y += 0.1 * ie;
        pos.z += 0.07 * ie;
        rot.x += 0.22 * ie;
        rot.y += 0.18 * ie;
        rot.z += 0.95 * ie;
      } else if (kind === 'side' || kind === 'revolver') {
        pos.x += -0.04 * ie;
        pos.y += 0.06 * ie;
        pos.z += 0.035 * ie;
        rot.x += 0.2 * ie;
        rot.y += 0.35 * ie;
        rot.z += -0.6 * ie;
      } else {
        // 칼: 날을 눕혀 옆면을 보여 주고 천천히 돌려 봄
        pos.x += -0.075 * ie;
        pos.y += 0.04 * ie;
        pos.z += 0.03 * ie;
        rot.x += 0.3 * ie;
        rot.y += 0.85 * ie;
        rot.z += (0.35 + Math.sin(this.time * 1.3) * 0.15) * ie;
      }
    }
    g.position.copy(pos);
    g.rotation.copy(rot);
    g.scale.setScalar(sc);

    // 홀로그램 조준선: 정조준이 거의 끝났을 때만
    if (gun.reticle) gun.reticle.visible = adsRaw > 0.6 && reload === 0;

    // 재장전: 왼손이 탄창을 빼서 새 탄창을 끼움 / 탄창 확인: 탄창을 살짝 빼서 기울임
    if (gun.mag && kind === 'long') {
      const u = reload;
      const out = u > 0 ? bump(u, 0.12, 0.26, 0.48, 0.64) : 0;
      gun.mag.position.copy(gun.magHome);
      gun.mag.rotation.set(0, 0, 0);
      gun.mag.position.y -= out * 0.3;
      gun.mag.position.z += out * 0.04;
      gun.mag.rotation.x = out * 0.5;
      gun.mag.visible = !(u > 0.3 && u < 0.46);
      const reach = u > 0 ? bump(u, 0.04, 0.12, 0.78, 0.92) : 0;
      const slap = u > 0 ? bump(u, 0.68, 0.72, 0.76, 0.84) : 0;
      // 탄창이 끼워지는 순간 총이 살짝 튐
      if (u > 0.64 && !this.seated) {
        this.seated = true;
        this.kick.impulse(new V3(0, 0.25, 0.1));
        this.kickRot.impulse(new V3(-0.6, 0, 0.4));
      }
      if (u === 0 || u < 0.6) this.seated = false;
      // 왼손 목표 (손이 쥐는 점) → 손 위치
      const at = this.tmpV.copy(gun.leftAt);
      if (reach > 0) {
        at.lerp(new V3(-0.005, -0.1 - out * 0.3, -0.088 + out * 0.04), reach);
        at.lerp(new V3(-0.02, 0.012, -0.05), slap);
      }
      // 탄창 확인: 탄창을 3cm 빼서 위쪽(실탄)이 보이게 기울임
      if (ie > 0.001 && u === 0) {
        gun.mag.position.y -= 0.03 * ie;
        gun.mag.position.z += 0.008 * ie;
        gun.mag.rotation.x = 0.22 * ie;
        gun.mag.rotation.z = -0.12 * ie;
        at.lerp(new V3(-0.006, -0.125, -0.085), ie);
      }
      gun.left.quaternion.copy(gun.leftQ);
      gun.left.position.copy(gun.leftHome).add(at).sub(gun.leftAt);
      if (reach > 0) gun.left.rotateX(-0.35 * reach);
    } else if (kind === 'pump') {
      // 펌프: 쏜 뒤 당겼다 밀기 · 재장전은 왼손이 아래에서 한 발씩 밀어 넣음
      this.pumpT = Math.max(0, (this.pumpT ?? 0) - dt);
      const k = this.pumpT > 0 && this.pumpT < 0.42 ? Math.sin((1 - this.pumpT / 0.42) * Math.PI) : 0;
      gun.pump.position.copy(gun.magHome);
      gun.pump.position.z += 0.075 * k;
      gun.left.quaternion.copy(gun.leftQ);
      gun.left.position.copy(gun.leftHome);
      gun.left.position.z += 0.075 * k;
      if (reload > 0) {
        const feed = Math.abs(Math.sin(reload * Math.PI * 4)) * bump(reload, 0.05, 0.15, 0.85, 0.95);
        gun.left.position.y -= 0.05 + feed * 0.05;
        gun.left.position.z += 0.2 * bump(reload, 0.05, 0.15, 0.85, 0.95);
        gun.left.rotateX(-0.5 * bump(reload, 0.05, 0.15, 0.85, 0.95));
      }
    } else if (kind === 'revolver') {
      // 실린더: 쏠 때마다 한 칸, 재장전 때 옆으로 빠짐
      this.cylT = Math.max(0, (this.cylT ?? 0) - dt);
      this.cylTurns = (this.cylTurns ?? 0) + (this.cylT > 0 ? dt / 0.12 : 0);
      gun.cyl.rotation.z = (this.cylTurns * Math.PI) / 3;
      const out = reload > 0 ? bump(reload, 0.08, 0.2, 0.75, 0.88) : 0;
      gun.cyl.position.set(-0.035 * out, 0.03 - 0.012 * out, -0.026);
      gun.left.quaternion.copy(gun.leftQ);
      gun.left.position.copy(gun.leftHome);
      gun.left.position.y -= out * 0.06;
      gun.left.position.x -= out * 0.03;
    } else if (kind === 'side') {
      const u = reload;
      const drop = u > 0 ? smooth((u - 0.08) / 0.22) * (u < 0.4 ? 1 : 0) : 0;
      const insert = u >= 0.4 ? 1 - smooth((u - 0.45) / 0.22) : 0;
      gun.mag.position.copy(gun.magHome);
      gun.mag.position.y -= drop * 0.25 + insert * 0.2;
      gun.mag.visible = !(u > 0.3 && u < 0.42);
      const reach = u > 0 ? bump(u, 0.15, 0.3, 0.72, 0.86) : 0;
      gun.left.position.copy(gun.leftHome);
      gun.left.quaternion.copy(gun.leftQ);
      gun.left.position.y -= reach * (0.12 + insert * 0.18);
      gun.left.position.x -= reach * 0.03;
      // 슬라이드 멈치 해제: 슬라이드가 앞으로 튕김
      const rack = u > 0.74 && u < 0.86 ? Math.sin(((u - 0.74) / 0.12) * Math.PI) : 0;
      if (ie > 0.001 && u === 0) {
        gun.mag.position.y -= 0.025 * ie;
        gun.mag.rotation.x = -0.36 - 0.15 * ie;
        gun.left.position.lerp(new V3(-0.02, -0.12, 0.035), ie);
        gun.left.rotateX(-0.4 * ie);
      }
      this.slideT = Math.max(0, this.slideT - dt);
      gun.slide.position.z = (this.slideT > 0 ? 0.032 * (this.slideT / 0.07) : 0) + rack * 0.03 + (u > 0.3 && u < 0.74 ? 0.03 : 0);
    }

    // 칼 휘두르기
    if (s.weapon === 'knife' && this.swingT > 0) {
      this.swingT -= dt;
      const p = clamp01(1 - this.swingT / this.swingDur);
      const k = Math.sin(p * Math.PI);
      if (this.swingHeavy) {
        g.position.z -= k * 0.18;
        g.position.y += Math.sin(p * Math.PI * 0.5) * 0.04 - 0.02;
        g.rotation.x -= k * 0.6;
      } else {
        g.position.x -= k * 0.2;
        g.position.y += k * 0.03;
        g.rotation.z += -1.2 + p * 2.2;
        g.rotation.y += k * 0.7;
      }
    }

    // 합력 강화 중: 소총 옆 코어가 주황색으로 빛남
    if (gun.core) gun.core.material.emissiveIntensity = s.amp ? 2.4 + Math.sin(this.time * 14) * 0.8 : 0;

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    gun.muzzle.getWorldPosition(this.flash.position);
    this.muzzleLight.position.copy(this.flash.position);
    this.muzzleLight.intensity = this.flashT > 0 ? 2.8 : 0;
    // 낮 맵에서는 총·손도 밝게 (장면 밝기에 맞춤)
    const day = s.day ? 1 : 0;
    this.hemi.intensity = 0.7 + day * 0.9;
    this.key.intensity = 1.25 + day * 1.1 + (s.light ?? 0) * 0.6;
  }
}
