import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEAM_INFO } from '../sim/constants.js';
import { WEAPONS } from '../sim/data.js';
import { labelTexture } from './textures.js';

// ─────────────────────────────────────────────────────────────
// 팀별 전술 장비 색 (해체팀: 남색·흑색·회색 / 포스팀: 코요테·탄·올리브)
// 어두운 야간 장면에서도 실루엣과 장비가 읽히도록 밝기를 맞춤
// ─────────────────────────────────────────────────────────────
const KIT = {
  defuse: {
    camoBase: '#3a404a',
    camo: ['#323740', '#444b56', '#2c3139', '#4d5460', '#262b32'],
    carrier: '#3a3f48',
    pouch: '#40454e',
    strap: '#24272c',
    hard: '#2b2e33',
    boot: '#2c2d30',
    glove: '#34373c',
    bala: '#232529',
    helmet: '#454b54',
    helmetCamo: false,
    furn: '#2a2c30',
  },
  force: {
    camoBase: '#8c7a5b',
    camo: ['#a08d6c', '#6e6b4c', '#7a6446', '#56553e', '#3f3a2c'],
    carrier: '#7a6849',
    pouch: '#6e6a4f',
    strap: '#4a4334',
    hard: '#3a3830',
    boot: '#7b6647',
    glove: '#6a5c45',
    bala: '#4a4a3c',
    helmet: '#8a7a5c',
    helmetCamo: true,
    furn: '#8b7558',
  },
};

// ───────── 캔버스 텍스처 (위장 무늬·몰리 웨빙·코듀라 천) ─────────
const rng = (seed) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
};
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}
function grain(g, w, h, amt, seed) {
  const img = g.getImageData(0, 0, w, h);
  const r = rng(seed);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// 주기적 값 노이즈 (타일 반복)
function periodicNoise(S, cx, cy, seed) {
  const r = rng(seed);
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const fy = (y / S) * cy;
    const iy = Math.floor(fy);
    let ty = fy - iy;
    ty = ty * ty * (3 - 2 * ty);
    const y0 = iy % cy, y1 = (iy + 1) % cy;
    for (let x = 0; x < S; x++) {
      const fx = (x / S) * cx;
      const ix = Math.floor(fx);
      let tx = fx - ix;
      tx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cx, x1 = (ix + 1) % cx;
      const a = lat[y0 * cx + x0], b = lat[y0 * cx + x1], c = lat[y1 * cx + x0], d = lat[y1 * cx + x1];
      out[y * S + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}
const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// 유기적 얼룩 위장: 노이즈 층마다 문턱값을 넘는 곳에 색을 칠함 (멀티캠 느낌)
function makeCamo(team) {
  const kit = KIT[team];
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d', { willReadFrequently: true });
  const img = g.createImageData(S, S);
  const d = img.data;
  const base = hexRGB(kit.camoBase);
  const seed = team === 'defuse' ? 11 : 23;
  const layers = kit.camo.map((col, k) => {
    const n1 = periodicNoise(S, 6, 9, seed + k * 13);
    const n2 = periodicNoise(S, 12, 18, seed + k * 13 + 5);
    const n3 = periodicNoise(S, 32, 40, seed + k * 13 + 9);
    const small = k === kit.camo.length - 1;
    return { rgb: hexRGB(col), n1, n2, n3, th: small ? 0.66 : 0.57 + k * 0.012, w3: small ? 0.45 : 0.15 };
  });
  const grainR = rng(seed + 99);
  for (let i = 0; i < S * S; i++) {
    let r = base[0], gg = base[1], b = base[2];
    for (const L of layers) {
      const v = L.n1[i] * (0.7 - L.w3) + L.n2[i] * 0.3 + L.n3[i] * L.w3;
      if (v > L.th) {
        // 가장자리 살짝 부드럽게
        const t = Math.min(1, (v - L.th) / 0.02);
        r += (L.rgb[0] - r) * t;
        gg += (L.rgb[1] - gg) * t;
        b += (L.rgb[2] - b) * t;
      }
    }
    const n = (grainR() - 0.5) * 14;
    const x = i % S, y = (i / S) | 0;
    const rip = x % 8 === 0 || y % 8 === 0 ? 0.93 : 1; // 립스탑 격자
    d[i * 4] = (r + n) * rip;
    d[i * 4 + 1] = (gg + n) * rip;
    d[i * 4 + 2] = (b + n) * rip;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c);
}

// 몰리 웨빙 (2.5cm 띠 · 2.5cm 간격 · 바택 박음질) — 128px = 10cm
function makeMolle(color, seed) {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  grain(g, S, S, 18, seed);
  for (const y0 of [14, 78]) {
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(0, y0, S, 32);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, y0 + 32, S, 3);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, y0 - 1, S, 1);
    for (const x of [0, 43, 86]) {
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(x, y0, 3, 32);
    }
    // 바느질
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 0; x < S; x += 4) {
      g.fillRect(x, y0 + 3, 2, 1);
      g.fillRect(x, y0 + 28, 2, 1);
    }
  }
  return canvasTex(c);
}

function makeCordura(color, seed) {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  g.globalAlpha = 0.06;
  g.fillStyle = '#000';
  for (let i = 0; i < S; i += 2) g.fillRect(0, i, S, 1);
  g.globalAlpha = 1;
  grain(g, S, S, 22, seed);
  // 박음질 테두리 느낌의 약한 얼룩
  const r = rng(seed + 7);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`;
    g.beginPath();
    g.ellipse(r() * S, r() * S, 6 + r() * 16, 4 + r() * 10, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return canvasTex(c);
}

// 팀별 공유 재질 (요원끼리 같이 씀)
const TEAM_MATS = {};
export function teamMaterials(team) {
  if (TEAM_MATS[team]) return TEAM_MATS[team];
  const k = KIT[team];
  const camo = makeCamo(team);
  const molle = makeMolle(k.carrier, team === 'defuse' ? 31 : 37);
  const cordura = makeCordura(k.pouch, team === 'defuse' ? 41 : 47);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const accent = TEAM_INFO[team].color;
  const M = {
    camoMap: camo,
    uniform: std({ map: camo, roughness: 0.93 }),
    carrier: std({ map: molle, roughness: 0.9 }),
    pouch: std({ map: cordura, roughness: 0.9 }),
    strap: std({ color: k.strap, roughness: 0.88 }),
    hard: std({ color: k.hard, roughness: 0.55, metalness: 0.12 }),
    rubber: std({ color: '#1e1f21', roughness: 0.92 }),
    boot: std({ color: k.boot, roughness: 0.72 }),
    glove: std({ color: k.glove, roughness: 0.82 }),
    bala: std({ color: k.bala, roughness: 0.96 }),
    helmet: k.helmetCamo
      ? std({ map: camo, color: '#d8d2c4', roughness: 0.9, side: THREE.DoubleSide })
      : std({ color: k.helmet, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }),
    skin: std({ color: '#9a7461', roughness: 0.62 }),
    eye: std({ color: '#0c0c0e', roughness: 0.25 }),
    lens: std({ color: '#1a2228', roughness: 0.06, metalness: 0.75 }),
    metal: std({ color: '#2a2c30', roughness: 0.42, metalness: 0.55 }),
    poly: std({ color: '#26282b', roughness: 0.7, metalness: 0.05 }),
    furn: std({ color: k.furn, roughness: 0.68, metalness: 0.04 }),
    steel: std({ color: '#9aa0a6', roughness: 0.28, metalness: 0.9 }),
    accent: std({ color: accent, roughness: 0.6, emissive: accent, emissiveIntensity: 0.1 }),
  };
  TEAM_MATS[team] = M;
  return M;
}

// ───────── 기하 도우미 ─────────
const V3 = THREE.Vector3;
const geoCache = new Map();
const cached = (key, make) => {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
};
// 세부 단계: 2 = 1인칭 총·손(가장 정밀), 1 = 가까운 요원, 0 = 먼 요원 (작은 부품 생략, 각진 상자)
let DETAIL = 2;
export function withDetail(level, fn) {
  const prev = DETAIL;
  DETAIL = level;
  try {
    return fn();
  } finally {
    DETAIL = prev;
  }
}
// 둘레 분할 수를 세부 단계에 맞게 줄임
const sg = (n, min = 3) => (DETAIL >= 2 ? n : Math.max(min, Math.round(n * (DETAIL === 1 ? 0.7 : 0.4))));
export const rbox = (w, h, d, r = 0.01, seg = 2) => (DETAIL === 0 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, DETAIL === 1 ? 1 : seg, r));
export const cylG = (r1, r2, h, seg = 12, open = false) => new THREE.CylinderGeometry(r1, r2, h, sg(seg, 5), 1, open);
const sphG = (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, sg(ws, 6), sg(hs, 4));

// 옆모습 윤곽(s = 앞쪽, y)을 두께 t로 밀어낸 형상. 앞쪽이 -z
export function profile(points, t, bevel = 0.003, holes = []) {
  const sh = new THREE.Shape(points.map(([s, y]) => new THREE.Vector2(s, y)));
  for (const hp of holes) sh.holes.push(new THREE.Path(hp.map(([s, y]) => new THREE.Vector2(s, y))));
  const bev = DETAIL > 0 ? bevel : 0;
  const depth = Math.max(0.001, t - bev * 2);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: DETAIL >= 2 ? 2 : 1, curveSegments: DETAIL >= 2 ? 6 : DETAIL === 1 ? 4 : 2 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// 회전체 (r, y) 아래→위 순서, 스플라인으로 매끈하게
export function lathe(points, seg = 12, smooth = 20) {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  const n = DETAIL >= 2 ? smooth : Math.max(4, Math.round(smooth * (DETAIL === 1 ? 0.6 : 0.3)));
  const pts = curve.getPoints(n).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  return new THREE.LatheGeometry(pts, sg(seg, 6));
}

// 몸 둘레 띠 (단면이 사각형인 고리)
function ringG(rIn, rOut, h, seg = 20) {
  const pts = [
    [rIn, -h / 2],
    [rOut, -h / 2],
    [rOut, h / 2],
    [rIn, h / 2],
    [rIn, -h / 2],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, sg(seg, 8));
}

// 상자를 몸통 곡면에 맞게 휨: z += k·x²
export function bend(k) {
  return (g) => {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setZ(i, p.getZ(i) + k * x * x);
      // 법선도 같은 변형으로 (역전치 야코비안)
      n.setX(i, n.getX(i) - 2 * k * x * n.getZ(i));
    }
  };
}

// 길이 0인 법선이 셰이더에서 NaN이 되지 않도록 정리
function fixNormals(g) {
  const n = g.attributes.normal;
  if (!n) return;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
    const l = Math.hypot(x, y, z);
    if (!(l > 1e-6)) n.setXYZ(i, 0, 1, 0);
    else n.setXYZ(i, x / l, y / l, z / l);
  }
}

// 삼각형마다 주축에 투영한 UV (실제 크기 기준으로 무늬가 반복됨)
function boxUV(geo, density) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const a = new V3(), b = new V3(), c = new V3(), ab = new V3(), ac = new V3();
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    ab.cross(ac);
    const ax = Math.abs(ab.x), ay = Math.abs(ab.y), az = Math.abs(ab.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let u, w;
      if (ax >= ay && ax >= az) {
        u = v.z;
        w = v.y;
      } else if (ay >= az) {
        u = v.x;
        w = v.z;
      } else {
        u = v.x;
        w = v.y;
      }
      uv[(i + k) * 2] = u * density;
      uv[(i + k) * 2 + 1] = w * density;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const UV_DENSITY = { uniform: 2.2, carrier: 10, pouch: 7, helmet: 3.5, sleeve: 2.2 };

// 뼈대 하나에 붙는 부품들을 재질별로 합쳐 메시 수를 줄임
export class Parts {
  constructor() {
    this.by = {};
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
  }
  add(mat, geo, p = [0, 0, 0], r = [0, 0, 0], s = 1, post = null) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (post) post(g);
    const sc = Array.isArray(s) ? s : [s, s, s];
    this.e.set(r[0], r[1], r[2], r[3] ?? 'XYZ');
    this.m.compose(new V3(p[0], p[1], p[2]), this.q.setFromEuler(this.e), new V3(sc[0], sc[1], sc[2]));
    g.applyMatrix4(this.m);
    geo.dispose?.();
    return this.push(mat, g);
  }
  // 먼 요원: 3cm보다 작은 부품은 보이지 않으므로 생략
  push(mat, g) {
    if (DETAIL === 0) {
      g.computeBoundingBox();
      const b = g.boundingBox;
      if (Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) < 0.03) {
        g.dispose();
        return this;
      }
    }
    (this.by[mat] ??= []).push(g);
    return this;
  }
  // 이미 계산된 변환 행렬로 추가
  addM(mat, geo, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(matrix);
    geo.dispose?.();
    return this.push(mat, g);
  }
  // 두 점 사이 막대
  rod(mat, a, b, r1, r2 = r1, seg = 8) {
    const A = new V3(...a), B = new V3(...b);
    const len = A.distanceTo(B);
    const g = cylG(r1, r2, len, seg).toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize());
    this.m.compose(A.clone().add(B).multiplyScalar(0.5), q, new V3(1, 1, 1));
    g.applyMatrix4(this.m);
    return this.push(mat, g);
  }
  build() {
    const out = {};
    for (const [mat, list] of Object.entries(this.by)) {
      const g = mergeGeometries(list, false);
      fixNormals(g);
      boxUV(g, UV_DENSITY[mat] ?? 4);
      g.computeBoundingSphere();
      out[mat] = g;
      for (const x of list) x.dispose();
    }
    return out;
  }
}

// ───────── 몸 부품 ─────────
// 골반 (원점 = 골반 중심, 고관절은 (±0.095, -0.06))
function buildPelvis() {
  const P = new Parts();
  P.add('uniform', lathe([[0, -0.135], [0.09, -0.125], [0.148, -0.075], [0.165, 0.0], [0.162, 0.06], [0.15, 0.1], [0.0, 0.11]], 16), [0, 0, 0], [0, 0, 0], [1, 1, 0.7]);
  // 전투 벨트 (몰리) + 안쪽 벨트 + 버클
  P.add('carrier', ringG(0.163, 0.184, 0.052, 22), [0, 0.055, 0], [0, 0, 0], [1, 1, 0.74]);
  P.add('strap', ringG(0.158, 0.17, 0.02, 22), [0, 0.09, 0], [0, 0, 0], [1, 1, 0.74]);
  P.add('hard', rbox(0.052, 0.034, 0.014, 0.004), [0, 0.06, -0.137]);
  // 오른쪽 권총집 (홀스터)
  P.add('hard', rbox(0.042, 0.16, 0.075, 0.014), [0.205, -0.075, 0.0], [0, 0, 0.06]);
  P.add('strap', rbox(0.05, 0.03, 0.06, 0.006), [0.198, 0.045, 0.0]);
  // 왼쪽 앞 권총 탄창 주머니 ×2
  for (const z of [-0.105, -0.07]) {
    P.add('pouch', rbox(0.03, 0.075, 0.032, 0.006), [-0.16, 0.03, z - 0.02], [0, 0.55, 0]);
  }
  // 덤프 파우치 (왼쪽 뒤) · 구급 키트 (뒤)
  P.add('pouch', rbox(0.065, 0.09, 0.08, 0.02), [-0.16, -0.005, 0.085], [0, -0.5, 0]);
  P.add('pouch', rbox(0.135, 0.085, 0.05, 0.014), [0, 0.035, 0.145]);
  P.add('strap', rbox(0.02, 0.087, 0.052, 0.004), [0.04, 0.035, 0.146]);
  P.add('hard', rbox(0.03, 0.03, 0.004, 0.002), [-0.03, 0.04, 0.172]); // 구급낭 표식
  return P;
}

// 홀스터에 꽂힌 권총 (권총을 뽑으면 숨김)
function buildHolsterPistol() {
  const P = new Parts();
  P.add('poly', rbox(0.026, 0.075, 0.042, 0.008), [0.205, 0.06, 0.012], [-0.25, 0, 0.06]);
  P.add('poly', rbox(0.028, 0.03, 0.07, 0.006), [0.205, 0.015, -0.005], [0, 0, 0.06]);
  return P;
}

// 상체 (원점 = 허리, 어깨 관절 (±0.185, 0.365))
function buildTorso() {
  const P = new Parts();
  P.add('uniform', lathe([[0.0, -0.08], [0.13, -0.06], [0.15, 0.0], [0.16, 0.1], [0.175, 0.22], [0.185, 0.3], [0.172, 0.36], [0.135, 0.405], [0.075, 0.428], [0.0, 0.432]], 18), [0, 0, 0.0], [0, 0, 0], [1, 1, 0.62]);
  // 플레이트 캐리어: 앞·뒤 판, 컴머번드, 측면 판, 어깨끈
  P.add('carrier', rbox(0.29, 0.33, 0.045, 0.014), [0, 0.235, -0.128], [0.04, 0, 0], 1, bend(0.75));
  P.add('carrier', rbox(0.29, 0.34, 0.045, 0.014), [0, 0.24, 0.13], [-0.04, 0, 0], 1, bend(-0.75));
  P.add('carrier', ringG(0.17, 0.188, 0.17, 24), [0, 0.12, 0], [0, 0, 0], [1, 1, 0.7]);
  for (const s of [-1, 1]) {
    P.add('pouch', rbox(0.022, 0.13, 0.13, 0.008), [s * 0.193, 0.115, 0.0]);
    const strap = new THREE.TorusGeometry(0.13, 0.009, sg(4), sg(14, 6), Math.PI);
    P.add('carrier', strap, [s * 0.095, 0.33, 0.0], [0, Math.PI / 2, 0], [1, 0.8, 1], (g) => g.scale(1, 1, 3.0));
    P.add('strap', rbox(0.05, 0.012, 0.09, 0.004), [s * 0.1, 0.425, 0.0], [0, 0, s * -0.15]); // 어깨 패드
  }
  // 앞판: 소총 탄창 주머니 ×3 (탄창 윗부분이 보임) + 행정 주머니 + 패치
  for (const x of [-0.074, 0, 0.074]) {
    P.add('pouch', rbox(0.068, 0.1, 0.04, 0.008), [x, 0.125, -0.172]);
    P.add('strap', rbox(0.02, 0.1, 0.042, 0.004), [x, 0.125, -0.173]);
    P.add('furn', rbox(0.058, 0.07, 0.022, 0.004), [x, 0.19, -0.171], [0.06, 0, 0]);
    P.add('poly', rbox(0.062, 0.012, 0.026, 0.004), [x, 0.226, -0.173], [0.06, 0, 0]);
  }
  P.add('pouch', rbox(0.2, 0.072, 0.032, 0.01), [0, 0.29, -0.166]);
  P.add('hard', rbox(0.075, 0.045, 0.006, 0.002), [0, 0.292, -0.184]);
  // 왼쪽: 무전기 주머니 + 무전기 + 안테나, 가슴 송신 버튼
  P.add('pouch', rbox(0.055, 0.12, 0.072, 0.012), [-0.206, 0.17, 0.05]);
  P.add('hard', rbox(0.046, 0.06, 0.056, 0.008), [-0.206, 0.25, 0.05]);
  P.add('hard', cylG(0.008, 0.008, 0.02, 8), [-0.21, 0.29, 0.065]);
  P.rod('rubber', [-0.21, 0.29, 0.065], [-0.245, 0.56, 0.09], 0.0045, 0.003, 6);
  P.add('hard', rbox(0.03, 0.04, 0.016, 0.005), [-0.095, 0.365, -0.15]);
  // 오른쪽 어깨끈: 지혈대
  P.add('strap', cylG(0.017, 0.017, 0.085, 10), [0.098, 0.36, -0.148]);
  P.add('hard', rbox(0.012, 0.03, 0.012, 0.003), [0.098, 0.405, -0.157]);
  // 오른쪽 옆: 섬광탄 주머니
  P.add('pouch', rbox(0.05, 0.1, 0.05, 0.012), [0.21, 0.13, 0.04]);
  P.add('hard', cylG(0.018, 0.018, 0.03, 10), [0.21, 0.19, 0.04]);
  // 등: 수분 공급 배낭 + 압축끈 + 손잡이
  P.add('pouch', rbox(0.24, 0.3, 0.085, 0.028), [0, 0.235, 0.197]);
  for (const x of [-0.075, 0.075]) P.add('strap', rbox(0.014, 0.29, 0.088, 0.004), [x, 0.235, 0.198]);
  P.add('pouch', rbox(0.15, 0.09, 0.035, 0.012), [0, 0.15, 0.25]);
  P.add('strap', new THREE.TorusGeometry(0.03, 0.007, sg(4), sg(10, 5), Math.PI), [0, 0.39, 0.16]);
  return P;
}

// 머리 (원점 = 머리 중심; 눈 높이 ≈ +0.01)
function highCutShell(r) {
  const g = new THREE.SphereGeometry(r, sg(30, 10), sg(14, 5), 0, Math.PI * 2, 0, Math.PI * 0.5);
  const p = g.attributes.position;
  const v = new V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const th = Math.acos(Math.max(-1, Math.min(1, v.y / r)));
    const az = Math.atan2(v.x, -v.z); // 0 = 앞
    const rim = 1.3425 - 0.185 * Math.cos(az) + 0.2225 * Math.cos(2 * az); // 앞 이마 · 옆 귀 위 · 뒤 목덜미
    const th2 = (th / (Math.PI * 0.5)) * rim;
    const s = Math.sin(th2);
    const h = Math.hypot(v.x, v.z) || 1e-6;
    p.setXYZ(i, (v.x / h) * r * s, r * Math.cos(th2), (v.z / h) * r * s);
  }
  g.computeVertexNormals();
  return g;
}

function buildHead() {
  const P = new Parts();
  // 복면 머리 · 턱 · 코
  P.add('bala', sphG(0.1, 20, 14), [0, 0, 0], [0, 0, 0], [0.8, 1.04, 0.95]);
  P.add('bala', rbox(0.112, 0.07, 0.11, 0.034), [0, -0.068, -0.02]);
  P.add('bala', rbox(0.024, 0.036, 0.03, 0.01), [0, -0.024, -0.091]);
  // 눈 트임 (어두운 피부) + 눈
  P.add('skin', new THREE.SphereGeometry(0.1, sg(18, 6), 3, Math.PI * 1.5 - 0.6, 1.2, Math.PI / 2 - 0.21, 0.27), [0, 0.0, -0.002], [0, 0, 0], [0.82, 1.06, 0.975]);
  for (const s of [-1, 1]) P.add('eye', sphG(0.011, 8, 6), [s * 0.03, 0.008, -0.091], [0, 0, 0], [1.3, 0.7, 0.6]);
  // 하이컷 방탄 헬멧
  P.add('helmet', highCutShell(0.124), [0, 0.024, 0.006], [0, 0, 0], [0.97, 0.93, 1.07]);
  // 측면 레일
  for (const s of [-1, 1]) {
    P.add('hard', rbox(0.012, 0.022, 0.125, 0.004), [s * 0.116, 0.058, 0.004], [0.08, 0, s * -0.22]);
    // 청력 보호 헤드셋: 이어컵 + 연결 팔
    P.add('hard', cylG(0.037, 0.041, 0.036, 16), [s * 0.098, -0.006, 0.008], [0, 0, Math.PI / 2]);
    P.add('rubber', cylG(0.028, 0.03, 0.008, 14), [s * 0.118, -0.006, 0.008], [0, 0, Math.PI / 2]);
    P.add('hard', rbox(0.009, 0.05, 0.016, 0.003), [s * 0.112, 0.032, 0.006], [0, 0, s * -0.12]);
  }
  // 왼쪽 마이크 붐
  P.rod('rubber', [-0.1, -0.025, -0.02], [-0.045, -0.058, -0.097], 0.0035, 0.0035, 6);
  P.add('rubber', sphG(0.008, 8, 6), [-0.042, -0.06, -0.1]);
  // 야간투시경 거치대 (슈라우드 + 접힌 마운트)
  P.add('hard', rbox(0.05, 0.036, 0.016, 0.005), [0, 0.078, -0.128], [0.42, 0, 0]);
  P.add('hard', rbox(0.034, 0.03, 0.04, 0.008), [0, 0.08, -0.148], [0.42, 0, 0]);
  // 뒤: 평형추 주머니 · 피아식별 적외선 점멸등
  P.add('pouch', rbox(0.085, 0.052, 0.03, 0.01), [0, 0.058, 0.142], [-0.4, 0, 0]);
  P.add('strobe', rbox(0.024, 0.016, 0.03, 0.005), [0, 0.146, 0.05], [-0.35, 0, 0]);
  P.add('hard', rbox(0.03, 0.006, 0.036, 0.002), [0, 0.139, 0.05], [-0.35, 0, 0]);
  // 헬멧 위에 올린 고글 + 끈
  P.add('rubber', rbox(0.16, 0.05, 0.018, 0.014), [0, 0.098, -0.106], [0.62, 0, 0], 1, bend(3.2));
  P.add('lens', rbox(0.15, 0.04, 0.012, 0.012), [0, 0.101, -0.113], [0.62, 0, 0], 1, bend(3.2));
  P.add('strap', new THREE.TorusGeometry(0.119, 0.005, sg(4), sg(32, 10)), [0, 0.068, 0.006], [Math.PI / 2 + 0.24, 0, 0], [0.97, 1.07, 1]);
  return P;
}

function buildNeck() {
  const P = new Parts();
  P.add('bala', cylG(0.05, 0.056, 0.13, 12), [0, 0.04, 0]);
  return P;
}

// 넓적다리 (원점 = 고관절, -y 방향으로 무릎까지 0.43)
function buildThigh(side) {
  const P = new Parts();
  P.add('uniform', lathe([[0, -0.475], [0.036, -0.468], [0.058, -0.44], [0.066, -0.37], [0.075, -0.26], [0.083, -0.14], [0.088, -0.05], [0.082, 0.02], [0.05, 0.06], [0, 0.07]], 14));
  // 카고 주머니 + 덮개
  P.add('uniform', rbox(0.03, 0.15, 0.12, 0.012), [side * 0.074, -0.205, 0.004], [0, 0, side * -0.05]);
  P.add('uniform', rbox(0.034, 0.032, 0.126, 0.01), [side * 0.08, -0.135, 0.004], [0, 0, side * -0.05]);
  return P;
}

// 정강이 (원점 = 무릎, -y 방향으로 발목까지 0.41) + 무릎 보호대
function buildShin() {
  const P = new Parts();
  P.add('uniform', lathe([[0, -0.305], [0.046, -0.298], [0.06, -0.272], [0.053, -0.225], [0.055, -0.15], [0.061, -0.075], [0.06, 0.0], [0.054, 0.04], [0, 0.06]], 14));
  P.add('hard', rbox(0.1, 0.12, 0.036, 0.016), [0, -0.012, -0.062], [0, 0, 0], 1, bend(2.6));
  P.add('strap', cylG(0.0625, 0.0625, 0.024, 14, true), [0, -0.07, 0.002]);
  P.add('strap', cylG(0.062, 0.062, 0.02, 14, true), [0, 0.045, 0.002]);
  return P;
}

// 전투화 (원점 = 발목, 바닥은 -0.09; 앞쪽 -z)
function buildBoot() {
  const P = new Parts();
  P.add('boot', lathe([[0, -0.02], [0.055, -0.02], [0.055, 0.06], [0.054, 0.13], [0.059, 0.148], [0, 0.15]], 14));
  P.add('boot', profile([[-0.07, -0.062], [0.19, -0.062], [0.205, -0.048], [0.198, -0.026], [0.155, -0.004], [0.09, 0.018], [0.05, 0.038], [0.04, 0.055], [-0.052, 0.055], [-0.074, 0.02]], 0.098, 0.012), [0, 0, 0]);
  P.add('rubber', profile([[-0.08, -0.09], [0.2, -0.09], [0.218, -0.076], [0.214, -0.058], [-0.08, -0.058]], 0.108, 0.004), [0, 0, 0]);
  P.add('rubber', rbox(0.034, 0.008, 0.08, 0.003), [0, 0.012, -0.085], [0.42, 0, 0]);
  return P;
}

// 위팔 (원점 = 어깨 관절) + 팀 식별 완장
function buildUpperArm() {
  const P = new Parts();
  P.add('uniform', lathe([[0, -0.31], [0.033, -0.305], [0.045, -0.285], [0.049, -0.22], [0.054, -0.13], [0.058, -0.06], [0.06, -0.01], [0.053, 0.03], [0.032, 0.052], [0, 0.058]], 14));
  P.add('accent', cylG(0.0585, 0.058, 0.032, 14, true), [0, -0.105, 0]);
  return P;
}

// 아래팔 (원점 = 팔꿈치, 손목까지 0.26)
function buildForearm() {
  const P = new Parts();
  P.add('uniform', lathe([[0, -0.268], [0.03, -0.266], [0.039, -0.248], [0.043, -0.19], [0.05, -0.1], [0.053, -0.04], [0.049, 0.0], [0.036, 0.03], [0, 0.04]], 14));
  P.add('uniform', cylG(0.046, 0.044, 0.028, 14, true), [0, -0.215, 0]);
  P.add('hard', rbox(0.07, 0.085, 0.03, 0.012), [0, -0.005, 0.045], [0, 0, 0], 1, bend(-4)); // 팔꿈치 보호대
  P.add('strap', cylG(0.0505, 0.05, 0.016, 12, true), [0, -0.05, 0]);
  return P;
}

// 장갑 낀 주먹 (원점 = 손잡이가 지나는 구멍, +y = 엄지 쪽, +z = 손목 쪽, 손등 = +x·side)
function buildHand(side) {
  const P = new Parts();
  const s = side;
  P.add('glove', rbox(0.062, 0.086, 0.074, 0.02), [s * 0.008, 0, 0.024]);
  P.add('glove', rbox(0.056, 0.08, 0.032, 0.013), [s * -0.004, -0.002, -0.026]);
  P.add('glove', rbox(0.022, 0.072, 0.05, 0.009), [s * -0.03, -0.004, 0.0]);
  P.add('hard', rbox(0.014, 0.074, 0.03, 0.006), [s * 0.036, 0.0, -0.012]);
  P.add('glove', new THREE.CapsuleGeometry(0.011, 0.034, sg(3, 1), sg(8, 4)), [s * -0.012, 0.046, -0.004], [0, 0, Math.PI / 2]);
  P.add('glove', cylG(0.034, 0.037, 0.052, 12), [s * 0.006, 0, 0.085], [Math.PI / 2, 0, 0]);
  P.add('hard', rbox(0.012, 0.026, 0.034, 0.004), [s * 0.04, 0.0, 0.086]);
  return P;
}

// ───────── 3인칭 총기 (원점 = 권총 손잡이 윗부분, -z = 앞) ─────────
const RIFLE = {
  bore: 0.047,
  butt: new V3(0, 0.01, 0.305),
  muzzle: new V3(0, 0.047, -0.615),
  optic: new V3(0, 0.122, -0.055),
  magPos: new V3(0, -0.035, -0.0875),
};
function buildRifle() {
  const P = new Parts();
  // 하부 리시버 + 탄창 삽입구 + 방아쇠울 + 권총 손잡이
  P.add('metal', profile([[-0.08, 0.035], [0.13, 0.035], [0.132, -0.04], [0.124, -0.048], [0.044, -0.048], [0.04, -0.012], [0.034, -0.034], [0.002, -0.036], [-0.003, -0.03], [-0.04, 0.0], [-0.08, 0.004]], 0.026, 0.003, [[[0.006, -0.012], [0.03, -0.012], [0.028, -0.027], [0.008, -0.027]]]));
  P.add('furn', profile([[-0.002, -0.004], [0.012, -0.03], [-0.02, -0.105], [-0.058, -0.112], [-0.066, -0.1], [-0.046, -0.01], [-0.034, 0.004]], 0.032, 0.005));
  P.add('metal', rbox(0.004, 0.02, 0.004, 0.001), [0, -0.016, -0.018]);
  // 상부 리시버 · 레일 · 장전 손잡이 · 전진기 · 배출구
  P.add('metal', rbox(0.03, 0.034, 0.215, 0.005), [0, RIFLE.bore, -0.025]);
  P.add('metal', rbox(0.022, 0.009, 0.215, 0.002), [0, 0.068, -0.025]);
  P.add('metal', rbox(0.045, 0.01, 0.022, 0.003), [0, 0.06, 0.085]);
  P.add('metal', cylG(0.007, 0.007, 0.03, 8), [0.02, 0.05, 0.03], [Math.PI / 2, 0, 0]);
  P.add('poly', rbox(0.003, 0.014, 0.05, 0.001), [0.016, 0.046, -0.01]);
  // 핸드가드 (팔각) + 윗레일
  P.add('metal', cylG(0.025, 0.025, 0.33, 8), [0, RIFLE.bore, -0.3], [Math.PI / 2, 0, Math.PI / 8]);
  P.add('metal', rbox(0.02, 0.008, 0.33, 0.002), [0, 0.075, -0.3]);
  for (let i = 0; i < 5; i++) P.add('poly', rbox(0.004, 0.008, 0.026, 0.002), [0.0235, RIFLE.bore, -0.2 - i * 0.055]);
  // 총열 · 소염기 · 가늠쇠
  P.add('metal', cylG(0.0085, 0.0085, 0.13, 10), [0, RIFLE.bore, -0.53], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.013, 0.013, 0.05, 10), [0, RIFLE.bore, -0.592], [Math.PI / 2, 0, 0]);
  P.add('metal', rbox(0.006, 0.026, 0.01, 0.002), [0, 0.09, -0.45]);
  P.add('metal', rbox(0.018, 0.012, 0.018, 0.003), [0, 0.078, 0.065]);
  // 각진 손잡이 · 전술 조명
  P.add('furn', profile([[0.25, 0.025], [0.33, 0.025], [0.322, 0.004], [0.28, 0.012]], 0.022, 0.003));
  P.add('metal', cylG(0.0115, 0.0115, 0.08, 12), [0.034, 0.058, -0.4], [Math.PI / 2, 0, 0]);
  P.add('metal', cylG(0.014, 0.014, 0.016, 12), [0.034, 0.058, -0.445], [Math.PI / 2, 0, 0]);
  // 완충관 + 개머리판 + 고무 패드
  P.add('metal', cylG(0.015, 0.015, 0.2, 10), [0, 0.04, 0.17], [Math.PI / 2, 0, 0]);
  P.add('furn', profile([[-0.13, 0.064], [-0.29, 0.07], [-0.302, 0.064], [-0.302, -0.055], [-0.288, -0.062], [-0.2, -0.016], [-0.135, 0.018]], 0.042, 0.006));
  P.add('rubber', rbox(0.044, 0.124, 0.014, 0.005), [0, 0.006, 0.305]);
  // 홀로그램 조준경 (EOTech형)
  P.add('poly', rbox(0.036, 0.018, 0.095, 0.004), [0, 0.085, -0.055]);
  for (const s of [-1, 1]) P.add('poly', rbox(0.005, 0.046, 0.075, 0.002), [s * 0.019, 0.118, -0.06]);
  P.add('poly', rbox(0.043, 0.006, 0.078, 0.002), [0, 0.144, -0.06]);
  P.add('lens', rbox(0.032, 0.036, 0.003, 0.001), [0, 0.12, -0.09]);
  return P;
}
// 곡선 탄창 (원점 = 탄창 윗면 중심)
function buildRifleMag() {
  const P = new Parts();
  P.add('furn', profile([[0.0, 0.01], [0.082, 0.01], [0.09, -0.06], [0.106, -0.15], [0.11, -0.165], [0.042, -0.172], [0.035, -0.155], [0.02, -0.07], [0.0, -0.01]], 0.023, 0.003), [0, 0, 0.044]);
  P.add('poly', rbox(0.028, 0.012, 0.074, 0.003), [0, -0.168, -0.035], [0.22, 0, 0]);
  return P;
}

const PISTOL = { muzzle: new V3(0, 0.035, -0.158) };
function buildPistol() {
  const P = new Parts();
  P.add('metal', rbox(0.026, 0.03, 0.186, 0.004), [0, 0.035, -0.062]);
  for (let i = 0; i < 4; i++) P.add('poly', rbox(0.027, 0.02, 0.003, 0.001), [0, 0.035, 0.012 + i * 0.006]);
  P.add('poly', rbox(0.024, 0.018, 0.155, 0.004), [0, 0.012, -0.062]);
  P.add('poly', rbox(0.026, 0.092, 0.046, 0.009), [0, -0.036, 0.016], [-0.3, 0, 0]);
  P.add('poly', profile([[-0.004, 0.004], [0.04, 0.004], [0.038, -0.022], [0.006, -0.024]], 0.01, 0.002, [[[0.008, -0.004], [0.032, -0.004], [0.03, -0.016], [0.01, -0.017]]]));
  P.add('metal', rbox(0.006, 0.007, 0.006, 0.001), [0, 0.053, -0.148]);
  P.add('metal', rbox(0.018, 0.007, 0.006, 0.001), [0, 0.053, 0.022]);
  return P;
}
// 권총 탄창 (원점 = 윗면, 손잡이 안에 들어감)
function buildPistolMag() {
  const P = new Parts();
  P.add('poly', rbox(0.019, 0.085, 0.03, 0.004), [0, -0.044, 0.0]);
  P.add('poly', rbox(0.024, 0.01, 0.04, 0.004), [0, -0.09, 0.0]);
  return P;
}

const KNIFE = { tip: new V3(0, 0.012, -0.24) };
function buildKnife() {
  const P = new Parts();
  P.add('steel', profile([[0.0, 0.0], [0.13, 0.0], [0.168, 0.012], [0.172, 0.016], [0.12, 0.028], [0.0, 0.028]], 0.0045, 0.0012), [0, -0.012, -0.065]);
  P.add('metal', rbox(0.026, 0.05, 0.01, 0.003), [0, 0.002, -0.062]);
  P.add('poly', rbox(0.024, 0.032, 0.11, 0.01), [0, 0.0, -0.005]);
  for (let i = 0; i < 4; i++) P.add('rubber', rbox(0.026, 0.034, 0.005, 0.002), [0, 0, -0.035 + i * 0.02]);
  P.add('metal', rbox(0.02, 0.026, 0.012, 0.004), [0, 0.0, 0.054]);
  return P;
}

if (typeof window !== 'undefined') window.__AV = { THREE, lathe, Parts, buildTorso, fixNormals, boxUV, makeCamo, makeMolle, makeCordura, buildHead, buildPelvis, buildRifle, buildHand, buildBoot, buildThigh, buildShin, buildUpperArm, buildForearm, buildNeck, buildKnife, buildPistol, buildRifleMag }; // DEBUG-TEMP
// ───────── 수학 도우미 ─────────
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// 2관절 IK: 어깨(엉덩이) S → 끝 T, 관절은 pole 쪽으로 굽힘
function solveJoint(S, T, a, b, pole, out) {
  const d = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-3, S.distanceTo(T)));
  const u = _u.subVectors(T, S).normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const v = _v.copy(pole).addScaledVector(u, -pole.dot(u));
  if (v.lengthSq() < 1e-8) v.set(0, 0, -1);
  v.normalize();
  return out.copy(S).addScaledVector(u, a * cosA).addScaledVector(v, a * sinA);
}
const _u = new V3(), _v = new V3();
const _bx = new V3(), _by = new V3(), _bz = new V3(), _bm = new THREE.Matrix4();

// 뼈 방향: 로컬 -y가 from→to, 로컬 -z가 fwd 쪽
function aimBone(obj, from, to, fwd) {
  _by.subVectors(from, to).normalize();
  _bz.copy(fwd).multiplyScalar(-1);
  _bz.addScaledVector(_by, -_bz.dot(_by));
  if (_bz.lengthSq() < 1e-8) _bz.set(0, 0, 1);
  _bz.normalize();
  _bx.crossVectors(_by, _bz);
  _bm.makeBasis(_bx, _by, _bz);
  obj.quaternion.setFromRotationMatrix(_bm);
  obj.position.copy(from);
}

// 손 방향: +y = 엄지(손잡이 축), +z = 손목 쪽
function handBasis(q, thumb, wrist) {
  _by.copy(thumb).normalize();
  _bz.copy(wrist).addScaledVector(_by, -wrist.dot(_by));
  if (_bz.lengthSq() < 1e-8) _bz.set(0, 0, 1);
  _bz.normalize();
  _bx.crossVectors(_by, _bz);
  _bm.makeBasis(_bx, _by, _bz);
  return q.setFromRotationMatrix(_bm);
}

class Spring3 {
  constructor(k, c) {
    this.k = k;
    this.c = c;
    this.x = new V3();
    this.v = new V3();
  }
  step(dt) {
    let t = dt;
    while (t > 1e-5) {
      const h = Math.min(t, 1 / 120);
      this.v.addScaledVector(this.x, -this.k * h).multiplyScalar(Math.max(0, 1 - this.c * h));
      this.x.addScaledVector(this.v, h);
      t -= h;
    }
  }
}

// 무기별 손 위치 (총 로컬: p = 주먹 구멍, t = 엄지 축, w = 손목 방향)
const GRIPS = {
  rifle: {
    R: { p: new V3(0, -0.048, 0.036), t: new V3(0, 0.92, -0.39), w: new V3(0.35, 0.25, 0.92) },
    L: { p: new V3(-0.004, RIFLE.bore - 0.004, -0.27), t: new V3(0.1, 0.15, -1), w: new V3(-0.55, -0.85, 0.15) },
  },
  pistol: {
    R: { p: new V3(0, -0.034, 0.018), t: new V3(0, 0.95, -0.3), w: new V3(0.3, 0.3, 0.92) },
    L: { p: new V3(-0.03, -0.044, 0.014), t: new V3(0.3, 0.75, -0.6), w: new V3(-0.6, -0.1, 0.8) },
  },
  knife: {
    R: { p: new V3(0, 0, 0.0), t: new V3(0, 0.2, -1), w: new V3(0.2, -0.95, 0.1) },
    L: null,
  },
};

// 요원 한 명의 3D 모형 + 애니메이션 (걷기·앉기·기울이기·조준·재장전·락픽·피격 움찔·쓰러짐)
// ───────── 요원 한 명 = 스킨 메시 몇 개 ─────────
// 부품(뼈대마다 재질별로 나뉜 메시 수십 개)을 재질 묶음 5개로 합쳐 한 번에 그림.
// 뼈대는 기존 그룹을 그대로 쓰고(각 정점은 자기 뼈대 하나만 따라감), 숨길 부품은 크기를 0으로 만듦.
const TEXTURED = new Set(['uniform', 'carrier', 'pouch', 'helmet']);
const IDENTITY = new THREE.Matrix4();
const skinCache = new Map();

// 단색 부품용 재질: 색은 정점 색, 거칠기·금속성·발광은 정점 속성 (aRME)으로
export function makeSolidMaterial({ strobe = 2 } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const u = { value: strobe };
  m.userData.strobe = u;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uStrobe = u;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRME;\nvarying vec3 vRME;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRME = aRME;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRME;\nuniform float uStrobe;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRME.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRME.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vRME.z * uStrobe;');
  };
  m.customProgramCacheKey = () => 'agentSolid';
  return m;
}

// 뼈대별 부품 형상({재질: 형상})을 재질 묶음별 스킨 형상으로 합침.
// info(재질) → { cls: 묶음 이름, color, rme: [거칠기, 금속성, 발광] } (cls가 'solid'일 때만 color·rme 사용)
export function mergeSkinned(entries, info) {
  const lists = {};
  entries.forEach((parts, bone) => {
    for (const [mat, geo] of Object.entries(parts)) {
      const { cls, color, rme } = info(mat);
      const g = geo.clone();
      const n = g.attributes.position.count;
      const idx = new Uint16Array(n * 4);
      const w = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        idx[i * 4] = bone;
        w[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
      if (cls === 'solid') {
        const c = new Float32Array(n * 3);
        const r = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          c.set([color.r, color.g, color.b], i * 3);
          r.set(rme, i * 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        g.setAttribute('aRME', new THREE.BufferAttribute(r, 3));
      }
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      (lists[cls] ??= []).push(g);
    }
  });
  const out = {};
  for (const [cls, list] of Object.entries(lists)) {
    out[cls] = mergeGeometries(list, false);
    out[cls].computeBoundingSphere();
    for (const g of list) g.dispose();
  }
  return out;
}

// 숨길 수 있는 뼈대: visible = false면 크기 0 (스킨 메시는 한 덩어리라 부품별로 숨길 수 없음)
export function hideableBone(g) {
  let shown = true;
  Object.defineProperty(g, 'visible', {
    configurable: true,
    get: () => shown,
    set: (v) => {
      shown = !!v;
      g.scale.setScalar(shown ? 1 : 0);
    },
  });
  return g;
}

// 뼈대 목록(builds)으로 팀·세부 단계별 스킨 형상을 만듦 (같은 팀 요원끼리 공유)
function skinGeometry(team, level, builds) {
  const key = `${team}@${level}`;
  if (skinCache.has(key)) return skinCache.get(key);
  const T = teamMaterials(team);
  const accent = new THREE.Color(TEAM_INFO[team].color);
  const entries = builds.map(({ key: partKey, build }) => cached(`${partKey}@${level}`, () => withDetail(level, () => build().build())));
  const out = mergeSkinned(entries, (mat) => {
    if (TEXTURED.has(mat)) return { cls: mat };
    if (mat === 'strobe') return { cls: 'solid', color: accent, rme: [0.4, 0, 1] };
    const src = T[mat];
    return { cls: 'solid', color: src?.color ?? new THREE.Color('#808080'), rme: [src?.roughness ?? 0.7, src?.metalness ?? 0, 0] };
  });
  skinCache.set(key, out);
  return out;
}

export class AgentView {
  // 카메라 위치 (가까운 요원만 정밀 모델로 그림) — 게임이 매 프레임 갱신
  static eye = new THREE.Vector3(0, 1.6, 0);

  constructor(agent, { showTag }) {
    this.agent = agent;
    const team = agent.team;
    const accent = TEAM_INFO[team].color;
    this.team = team;
    this.bones = [];
    this.builds = [];

    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    this.root = root;

    // 골반·상체·머리
    this.hips = new THREE.Group();
    this.hips.rotation.order = 'YXZ';
    this.hips.position.y = 0.98;
    root.add(this.hips);
    this.mount(this.hips, 'pelvis', buildPelvis);
    this.holstered = this.mount(this.hips, 'holsterPistol', buildHolsterPistol);
    this.spine = new THREE.Group();
    this.spine.rotation.order = 'YXZ';
    this.spine.position.y = 0.08;
    this.hips.add(this.spine);
    this.mount(this.spine, 'torso', buildTorso);
    this.neck = new THREE.Group();
    this.neck.rotation.order = 'YXZ';
    this.neck.position.set(0, 0.425, 0.012);
    this.spine.add(this.neck);
    this.mount(this.neck, 'neck', buildNeck);
    this.head = new THREE.Group();
    this.head.rotation.order = 'YXZ';
    this.head.position.set(0, 0.135, -0.004);
    this.neck.add(this.head);
    this.mount(this.head, 'head', buildHead);

    // 다리 (IK; 루트 기준)
    this.thighLen = 0.43;
    this.shinLen = 0.41;
    this.legs = [-1, 1].map((side) => {
      const thigh = new THREE.Group();
      const shin = new THREE.Group();
      const foot = new THREE.Group();
      foot.rotation.order = 'YXZ';
      root.add(thigh, shin, foot);
      this.mount(thigh, `thigh${side}`, () => buildThigh(side));
      this.mount(shin, 'shin', buildShin);
      this.mount(foot, 'boot', buildBoot);
      return { side, thigh, shin, foot, hip: new V3(), ankle: new V3(), knee: new V3(), pitch: 0 };
    });

    // 팔 (IK; 상체 기준)
    this.upperLen = 0.29;
    this.foreLen = 0.262;
    this.arms = [-1, 1].map((side) => {
      const upper = new THREE.Group();
      const fore = new THREE.Group();
      const hand = new THREE.Group();
      this.spine.add(upper, fore, hand);
      this.mount(upper, 'upperArm', buildUpperArm);
      this.mount(fore, 'forearm', buildForearm);
      this.mount(hand, `hand${side}`, () => buildHand(side));
      return { side, upper, fore, hand, shoulder: new V3(side * 0.172, 0.358, 0.012), S: new V3(), W: new V3(), E: new V3(), pole: side > 0 ? new V3(0.55, -1, -0.1) : new V3(-0.4, -1, 0.05) };
    });

    // 총 (루트 기준으로 자세를 계산)
    this.gun = new THREE.Group();
    root.add(this.gun);
    this.weapons = {
      rifle: this.mount(this.gun, 'rifle', buildRifle),
      pistol: this.mount(this.gun, 'pistol', buildPistol),
      knife: this.mount(this.gun, 'knife', buildKnife),
    };
    this.rifleMag = this.mount(this.weapons.rifle, 'rifleMag', buildRifleMag);
    this.rifleMag.position.copy(RIFLE.magPos);
    this.pistolMag = this.mount(this.weapons.pistol, 'pistolMag', buildPistolMag);
    this.pistolMagHome = new V3(0, 0.005, 0.004);
    this.pistolMag.position.copy(this.pistolMagHome);
    this.pistolMag.rotation.x = -0.3;
    this.muzzles = { rifle: new THREE.Object3D(), pistol: new THREE.Object3D(), knife: new THREE.Object3D() };
    this.muzzles.rifle.position.copy(RIFLE.muzzle);
    this.muzzles.pistol.position.copy(PISTOL.muzzle);
    this.muzzles.knife.position.copy(KNIFE.tip);
    for (const [k, m] of Object.entries(this.muzzles)) this.weapons[k].add(m);
    // 소총을 안 들 때: 등에 멘 소총
    this.slung = this.mount(this.spine, 'rifle', buildRifle);
    this.slungMag = this.mount(this.slung, 'rifleMag', buildRifleMag);
    this.slungMag.position.copy(RIFLE.magPos);
    this.slung.position.set(0.02, 0.22, 0.285);
    this.slung.rotation.set(0, Math.PI / 2, 0.95, 'ZYX');
    this.buildSkin();

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

    // 애니메이션 상태
    this.phase = Math.random() * 10;
    this.gaitW = 0;
    this.st = { crouch: 0, kneel: 0, air: 0, ads: 0, lean: 0, blade: 0, draw: 0 };
    this.deathT = 0;
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
    this.fallTwist = (Math.random() - 0.5) * 0.6;
    this.flinch = new Spring3(170, 9);
    this.kick = new Spring3(420, 14);
    this.lastSince = agent.sinceShot ?? 99;
    this.lastMelee = agent.meleeCd ?? 0;
    this.swingT = 1;
    this.weaponShown = null;
    this.idle = Math.random() * 10;

    const t = () => new V3();
    this.v = { a: t(), b: t(), c: t(), d: t(), e: t(), f: t(), fwd: t() };
    this.chest = new THREE.Matrix4();
    this.invChest = new THREE.Matrix4();
    this.chestQ = new THREE.Quaternion();
    this.invChestQ = new THREE.Quaternion();
    this.gunQ = new THREE.Quaternion();
    this.slingQ = new THREE.Quaternion();
    this.q1 = new THREE.Quaternion();
    this.e1 = new THREE.Euler(0, 0, 0, 'YXZ');
    this.m1 = new THREE.Matrix4();
    this.hands = { R: { p: t(), t: t(), w: t() }, L: { p: t(), t: t(), w: t() } };
  }

  // 부품 묶음 하나 = 뼈대 하나. 숨기기(visible = false)는 크기 0으로 처리 (스킨 메시는 한 덩어리라서)
  mount(parent, key, build) {
    const g = hideableBone(new THREE.Group());
    g.name = key;
    this.bones.push(g);
    this.builds.push({ key, build });
    parent.add(g);
    return g;
  }

  buildSkin() {
    this.skeleton = new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4()));
    const T = teamMaterials(this.team);
    this.solidMat = makeSolidMaterial();
    const mats = { solid: this.solidMat, uniform: T.uniform, carrier: T.carrier, pouch: T.pouch, helmet: T.helmet };
    // [0] 가까이: 정밀 / [1] 멀리: 단순
    this.lods = [1, 0].map((level) => {
      const geos = skinGeometry(this.team, level, this.builds);
      return Object.entries(geos).map(([cls, geo]) => {
        const m = new THREE.SkinnedMesh(geo, mats[cls]);
        m.name = `agent:${cls}@${level}`;
        m.bind(this.skeleton, IDENTITY);
        m.boundingSphere = new THREE.Sphere(new V3(0, 0.9, 0), 1.7);
        m.visible = level === 1;
        this.root.add(m);
        return m;
      });
    });
    this.far = false;
  }

  setWeapon(id) {
    this.weaponShown = id;
    for (const [k, g] of Object.entries(this.weapons)) g.visible = k === id;
    this.slung.visible = id !== 'rifle';
    this.holstered.visible = id !== 'pistol';
  }

  // ───────── 매 프레임 ─────────
  update(dt, alpha, time) {
    const a = this.agent;
    const r = this.root;
    const st = this.st;
    dt = Math.max(0, Math.min(dt, 0.1)); // 프레임 시간이 음수로 들어와도 안전하게
    r.position.set(a.prev.x + (a.pos.x - a.prev.x) * alpha, a.prev.y + (a.pos.y - a.prev.y) * alpha, a.prev.z + (a.pos.z - a.prev.z) * alpha);
    // 거리에 따라 정밀/단순 모델 (경계에서 깜빡이지 않게 여유를 둠)
    const camD = r.position.distanceTo(AgentView.eye);
    const far = this.far ? camD > 11 : camD > 13;
    if (far !== this.far) {
      this.far = far;
      for (const m of this.lods[0]) m.visible = !far;
      for (const m of this.lods[1]) m.visible = far;
    }
    r.rotation.set(0, a.yaw, 0);
    if (this.weaponShown !== a.weapon) {
      this.setWeapon(a.weapon);
      this.swingT = 1;
    }
    const W = this.weaponShown;
    const melee = !!WEAPONS[W]?.melee;

    // 발사·근접 공격 감지 → 반동 / 휘두르기
    const since = a.sinceShot ?? 99;
    if (a.alive && since < this.lastSince - 1e-4 && since < 0.2 && !melee) {
      const pistol = W === 'pistol';
      this.kick.v.x += pistol ? 9 : 6 + Math.random() * 2;
      this.kick.v.z += pistol ? 2.2 : 2.8;
      this.kick.v.y += (Math.random() - 0.5) * 3;
    }
    this.lastSince = since;
    if (a.alive && melee && (a.meleeCd ?? 0) > this.lastMelee + 0.05) this.swingT = 0;
    this.lastMelee = a.meleeCd ?? 0;
    this.swingT = Math.min(1, this.swingT + dt / 0.32);
    this.flinch.step(dt);
    this.kick.step(dt);
    this.idle += dt;

    // ── 상태 값 (부드럽게)
    const dead = !a.alive;
    if (dead) this.deathT += dt;
    else this.deathT = 0;
    const kneelT = a.lockpick && !dead ? 1 : 0;
    st.kneel = damp(st.kneel, kneelT, 6, dt);
    st.crouch = damp(st.crouch, kneelT ? 0 : a.crouch ?? 0, 14, dt);
    st.air = damp(st.air, !a.onGround && !a.held && !dead ? 1 : 0, 10, dt);
    st.ads = damp(st.ads, smooth(((a.adsT ?? 0) - 0.1) / 0.8), 16, dt);
    const leanTarget = dead ? 0 : a.leanOffset != null && Math.abs(a.lean ?? 0) > 0.01 ? a.leanOffset / 0.42 : (a.lean ?? 0);
    st.lean = damp(st.lean, leanTarget, 14, dt);
    const bladeT = W === 'rifle' ? -0.3 : W === 'pistol' ? -0.06 : -0.18;
    st.blade = damp(st.blade, bladeT * (1 - st.kneel), 8, dt);
    const drawFrac = a.swapT > 0 && WEAPONS[W] ? a.swapT / WEAPONS[W].draw : 0;
    st.draw = damp(st.draw, drawFrac, 20, dt);
    const reloadDur = WEAPONS[W]?.reload ?? 2.4;
    const reload = a.reloadT > 0 && !melee && !dead ? clamp01(1 - a.reloadT / reloadDur) : 0;
    const c = st.crouch;
    const kn = st.kneel;
    // 락픽 중에는 권총·칼을 집어넣음
    if (W !== 'rifle') {
      this.weapons[W].visible = kn < 0.5;
      this.holstered.visible = W !== 'pistol' || kn >= 0.5;
    }

    // ── 걸음: 로컬 속도 → 발 궤적
    const vx = a.vel?.x ?? 0, vz = a.vel?.z ?? 0;
    const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    const vf = -vx * sy - vz * cy; // 앞
    const vr = vx * cy - vz * sy; // 오른쪽
    const speed = Math.hypot(vx, vz);
    const moving = a.onGround && speed > 0.35 && !dead && !a.held;
    this.gaitW = damp(this.gaitW, moving ? 1 : 0, 8, dt);
    const sf = clamp01(speed / 5);
    const cycle = 1.35 + 1.95 * clamp01((speed - 1) / 4);
    if (moving) this.phase += (dt * Math.PI * 2 * speed) / cycle;
    const beta = 0.62 - 0.3 * clamp01((speed - 1.5) / 3.5);
    const amp = Math.min(0.42 * (1 - 0.35 * c), (beta * cycle) / 2) * this.gaitW;
    const lift = (0.07 + 0.08 * sf) * (1 - 0.4 * c) * this.gaitW;
    const md = this.v.d.set(vr, 0, -vf);
    if (md.lengthSq() > 1e-4) md.normalize();
    else md.set(0, 0, -1);
    const backward = vf < -0.3 * speed ? -1 : 1;

    // ── 골반
    const bob = moving ? -Math.abs(Math.cos(this.phase)) * (0.018 + 0.03 * sf) * this.gaitW : 0;
    const sway = Math.sin(this.phase) * 0.012 * this.gaitW;
    const breathe = Math.sin(this.idle * 1.7) * 0.004;
    let hipY = 0.98 - c * 0.46 - kn * 0.43 + bob - st.air * 0.04;
    const fl = this.flinch.x;
    hipY -= Math.abs(fl.x) * 0.05;
    // 쓰러질 때 먼저 무릎이 꺾임
    const buckle = dead ? smooth(this.deathT / 0.3) * (1 - smooth((this.deathT - 0.25) / 0.55)) : 0;
    // 쓰러진 뒤: 가슴 장비(앞) · 배낭(뒤) 두께만큼 상체가 들림
    const rest = dead ? smooth((this.deathT - 0.6) / 0.35) : 0;
    const slump = dead ? 0.35 * smooth(this.deathT / 0.4) * (1 - rest) + rest * (this.fallDir < 0 ? -0.3 : 0.42) : 0;
    hipY -= buckle * 0.24;
    const lean = st.lean;
    this.hips.position.set(lean * 0.14 + sway * (1 - c), hipY, c * 0.04 + kn * 0.02);
    this.hips.rotation.set(0, Math.sin(this.phase) * 0.12 * this.gaitW * backward - st.blade * 0.25, -lean * 0.06);

    // ── 상체: 조준 각도 · 기울이기 · 몸 비틀기 · 피격 움찔
    const aimPitch = Math.max(-1.2, Math.min(1.2, a.pitch ?? 0));
    const spPitch = aimPitch * 0.45 - c * 0.3 - kn * 0.35 - (reload > 0 ? 0.08 : 0) + breathe * 0.5 - 0.03 * sf * this.gaitW;
    const counter = -Math.sin(this.phase) * 0.06 * this.gaitW * backward;
    const hipYaw = this.hips.rotation.y;
    this.spine.rotation.set(spPitch + fl.x - slump, st.blade - hipYaw * 0.75 + counter + fl.y, -lean * 0.5 + fl.z);
    const chestYaw = hipYaw + this.spine.rotation.y;

    // ── 목·머리: 조준 방향을 봄
    const headPitch = (aimPitch - spPitch) * 0.85 - st.ads * 0.1 - (reload > 0 ? Math.sin(reload * Math.PI) * 0.35 : 0) - kn * 0.25 - slump * 1.5;
    this.neck.rotation.set(headPitch * 0.35, -chestYaw * 0.45, lean * 0.18);
    this.head.rotation.set(headPitch * 0.65 + fl.x * 1.3, -chestYaw * 0.55 - st.ads * 0.12 + fl.y * 1.2, lean * 0.22 - st.ads * 0.16 + fl.z * 1.4);

    this.hips.updateMatrix();
    this.spine.updateMatrix();
    this.chest.multiplyMatrices(this.hips.matrix, this.spine.matrix);
    this.invChest.copy(this.chest).invert();
    this.chestQ.setFromRotationMatrix(this.chest);
    this.invChestQ.copy(this.chestQ).invert();

    // ── 총 자세 (루트 기준)
    this.poseGun(W, aimPitch, reload, dead);

    // ── 손 목표 → 팔 IK
    this.poseHands(W, reload, time);
    for (const arm of this.arms) this.solveArm(arm, arm.side < 0 ? this.hands.L : this.hands.R);

    // ── 다리 IK
    this.poseLegs(md, amp, lift, beta, backward, c, kn, dead);

    // ── 쓰러짐
    if (dead) {
      const t = this.deathT;
      const fall = clamp01((t - 0.12) / 0.7);
      const f = fall * fall;
      const settle = t > 0.82 ? Math.sin(Math.min(1, (t - 0.82) / 0.25) * Math.PI) * 0.04 : 0;
      r.rotation.set((Math.PI / 2 - 0.02) * f * this.fallDir - settle * this.fallDir, a.yaw + this.fallTwist * f, this.fallTwist * 0.3 * f, 'YXZ');
      r.position.y += 0.085 * smooth(fall);
      this.ring.visible = false;
      if (this.tag) this.tag.visible = false;
      this.solidMat.userData.strobe.value = Math.max(0, 2.4 - t * 3);
      return;
    }
    this.solidMat.userData.strobe.value = 1.6 + (Math.sin(time * 9 + this.idle) > 0.6 ? 1.6 : 0);
    if (this.tag) this.tag.visible = true;

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

  // 상체 공간의 점 → 루트 공간
  chestToRoot(v, out) {
    return out.copy(v).applyMatrix4(this.chest);
  }

  poseGun(W, aimPitch, reload, dead) {
    const st = this.st;
    const g = this.gun;
    const v = this.v;
    const ads = st.ads;
    const kn = st.kneel;
    let pitch = aimPitch;
    let yaw = 0.035;
    let roll = -st.lean * 0.35;
    const pivot = v.a;
    let butt = v.b.set(0, 0, 0);
    if (W === 'rifle') {
      butt.copy(RIFLE.butt);
      pivot.set(0.112 - 0.006 * ads, 0.33 + 0.058 * ads, -0.06 - 0.03 * ads);
      pitch += -0.17 * (1 - ads);
      yaw += 0.03 * (1 - ads);
      if (reload > 0) {
        const k = Math.sin(clamp01(reload * 1.1) * Math.PI);
        roll += 0.5 * k;
        pitch += 0.22 * k;
        pivot.y -= 0.03 * k;
        pivot.x -= 0.03 * k;
      }
    } else if (W === 'pistol') {
      pivot.set(0.04 - 0.01 * ads, 0.3 + 0.2 * ads, -0.34 - 0.15 * ads);
      pitch += -0.45 * (1 - ads);
      yaw += -0.02;
      if (reload > 0) {
        const k = Math.sin(clamp01(reload * 1.1) * Math.PI);
        pitch += 0.35 * k;
        roll += 0.35 * k;
        pivot.y -= 0.04 * k;
        pivot.z += 0.08 * k;
      }
    } else {
      pivot.set(0.15, 0.24, -0.3);
      pitch += 0.45;
      yaw += -0.1;
      roll += -0.15;
      const s = this.swingT < 1 ? Math.sin(this.swingT * Math.PI) : 0;
      if (s > 0) {
        pivot.x -= 0.2 * s;
        pivot.z -= 0.18 * s;
        pivot.y += 0.04 * s;
        yaw += 0.9 * (this.swingT - 0.5) * 2 * s;
        roll -= 0.8 * s;
      }
    }
    // 무기 꺼내기: 아래에서 올라옴
    pitch -= st.draw * 1.0;
    pivot.y -= st.draw * 0.12;
    roll += st.draw * 0.4;
    // 반동
    pitch += this.kick.x.x * 0.05 + this.flinch.x.x * 0.5;
    yaw += this.kick.x.y * 0.02;
    // 쓰러질 때 총이 아래로 처짐
    if (dead) {
      const d = smooth(this.deathT / 0.5);
      pitch -= 0.9 * d;
      roll += 0.5 * d;
      pivot.y -= 0.1 * d;
    }
    this.chestToRoot(pivot, v.c);
    this.e1.set(pitch, yaw, roll, 'YXZ');
    this.gunQ.setFromEuler(this.e1);
    g.quaternion.copy(this.gunQ);
    g.position.copy(v.c).sub(v.e.copy(butt).applyQuaternion(this.gunQ));
    g.position.addScaledVector(v.f.set(0, 0, 1).applyQuaternion(this.gunQ), this.kick.x.z * 0.012);

    // 락픽 중: 소총은 가슴 앞에 늘어뜨림 / 권총·칼은 손에서 내림
    if (kn > 0.001) {
      this.q1.setFromEuler(this.e1.set(-1.15, 0.25, 0.75, 'YXZ'));
      this.slingQ.copy(this.chestQ).multiply(this.q1);
      this.chestToRoot(v.f.set(0.02, 0.06, -0.21), v.d);
      v.d.sub(v.e.set(0, 0, 0).applyQuaternion(this.slingQ));
      g.position.lerp(v.d, kn);
      g.quaternion.slerp(this.slingQ, kn);
    }
    g.updateMatrix();
  }

  // 총 로컬 손 정의 → 상체 공간 목표
  gripTarget(out, def) {
    out.p.copy(def.p).applyMatrix4(this.gun.matrix).applyMatrix4(this.invChest);
    out.t.copy(def.t).applyQuaternion(this.gun.quaternion).applyQuaternion(this.invChestQ);
    out.w.copy(def.w).applyQuaternion(this.gun.quaternion).applyQuaternion(this.invChestQ);
    return out;
  }

  poseHands(W, reload, time) {
    const H = this.hands;
    const grips = GRIPS[W] ?? GRIPS.rifle;
    const v = this.v;
    this.gripTarget(H.R, grips.R);
    if (grips.L) this.gripTarget(H.L, grips.L);
    else {
      // 칼: 왼손은 얼굴 앞 방어 자세
      H.L.p.set(-0.08, 0.36, -0.27);
      H.L.t.set(0.25, 0.9, -0.3);
      H.L.w.set(-0.3, -0.5, 0.8);
    }
    // 재장전: 왼손이 탄창을 빼고 가슴 주머니에서 새 탄창을 가져와 끼움
    const mag = W === 'rifle' ? this.rifleMag : W === 'pistol' ? this.pistolMag : null;
    if (mag) {
      const home = W === 'rifle' ? RIFLE.magPos : this.pistolMagHome;
      mag.position.copy(home);
      mag.visible = true;
      if (reload > 0) {
        const keys = W === 'rifle' ? RELOAD_RIFLE : RELOAD_PISTOL;
        let i = 0;
        while (i < keys.length - 2 && reload > keys[i + 1].u) i++;
        const k0 = keys[i], k1 = keys[i + 1];
        const f = smooth((reload - k0.u) / Math.max(1e-4, k1.u - k0.u));
        const p0 = this.keyPoint(k0, v.a, grips.L ?? grips.R);
        const p1 = this.keyPoint(k1, v.b, grips.L ?? grips.R);
        const handW = v.c.copy(p0).lerp(p1, f);
        const lp = H.L.p.clone();
        H.L.p.copy(handW);
        const near = smooth(1 - Math.min(1, handW.distanceTo(lp) / 0.12));
        // 손 방향: 손바닥이 위를 향하게(탄창을 쥔 자세)
        H.L.t.lerp(v.d.set(0.2, 0.15, -1), 1 - near).normalize();
        H.L.w.lerp(v.e.set(-0.4, -0.9, 0.2), 1 - near).normalize();
        const state = reload < k1.u ? k0.mag : k1.mag;
        if (state === 'hand') {
          // 탄창을 왼손에 붙임 (총 로컬로 변환)
          v.f.copy(handW).applyMatrix4(this.chest);
          this.m1.copy(this.gun.matrix).invert();
          v.f.applyMatrix4(this.m1);
          mag.position.copy(v.f).add(v.e.set(0, W === 'rifle' ? 0.07 : 0.03, 0.0));
        } else if (state === 'none') mag.visible = false;
        else if (state === 'drop') {
          mag.position.y -= 0.25 * f;
          mag.visible = f < 0.7;
        }
      }
    }
    // 락픽: 두 손이 앞쪽 장치를 만짐
    const kn = this.st.kneel;
    if (kn > 0.001) {
      const jig = Math.sin(time * 7.3) * 0.012, jig2 = Math.sin(time * 5.1 + 1) * 0.015;
      v.a.set(0.075 + jig, 0.04 + jig2, -0.42);
      v.b.set(-0.075 - jig2, 0.06 + jig, -0.41);
      H.R.p.lerp(v.a, kn);
      H.L.p.lerp(v.b, kn);
      H.R.t.lerp(v.c.set(-0.6, 0.1, -0.8), kn).normalize();
      H.L.t.lerp(v.c.set(0.6, 0.1, -0.8), kn).normalize();
      H.R.w.lerp(v.c.set(0.3, 0.6, 0.6), kn).normalize();
      H.L.w.lerp(v.c.set(-0.3, 0.6, 0.6), kn).normalize();
    }
  }

  keyPoint(k, out, gripL) {
    if (k.at === 'grip') return out.copy(gripL.p).applyMatrix4(this.gun.matrix).applyMatrix4(this.invChest);
    if (k.at === 'gun') return out.copy(k.p).applyMatrix4(this.gun.matrix).applyMatrix4(this.invChest);
    return out.copy(k.p); // 상체 공간
  }

  solveArm(arm, tgt) {
    const v = this.v;
    handBasis(arm.hand.quaternion, tgt.t, tgt.w);
    arm.hand.position.copy(tgt.p);
    const Wp = arm.W.copy(v.a.set(arm.side * 0.006, 0, 0.1).applyQuaternion(arm.hand.quaternion)).add(tgt.p);
    const S = arm.S.copy(arm.shoulder);
    const reach = this.upperLen + this.foreLen;
    const d = S.distanceTo(Wp);
    if (d > reach * 0.97) {
      // 어깨를 앞으로 내밀어 닿게 함 (최대 6cm)
      const push = Math.min(0.06, d - reach * 0.97);
      S.addScaledVector(v.b.subVectors(Wp, S).normalize(), push);
    }
    const E = solveJoint(S, Wp, this.upperLen, this.foreLen, arm.pole, arm.E);
    aimBone(arm.upper, S, E, v.c.set(0, 0, -1));
    aimBone(arm.fore, E, Wp, v.c.set(0, 0, -1));
    // 손목에서 끊기지 않도록 아래팔 길이를 맞춤
    const len = E.distanceTo(Wp);
    arm.fore.scale.set(1, len / this.foreLen, 1);
  }

  poseLegs(md, amp, lift, beta, backward, c, kn, dead) {
    const v = this.v;
    const st = this.st;
    const rifleStance = this.weaponShown === 'rifle' ? 1 : 0.5;
    this.hips.updateMatrix();
    for (const leg of this.legs) {
      const s = leg.side;
      // 고관절
      leg.hip.set(s * 0.095, -0.06, 0).applyMatrix4(this.hips.matrix);
      // 기본 서기 / 앉기 / 무릎 꿇기 / 공중 발 위치
      const A = leg.ankle;
      A.set(s * 0.12, 0.09, s * 0.06 * rifleStance);
      let pitch = 0;
      if (c > 0) {
        A.x += (s * 0.145 - A.x) * c;
        A.z += ((s < 0 ? -0.22 : 0.2) - A.z) * c;
        A.y += ((s < 0 ? 0.09 : 0.1) - A.y) * c;
        pitch += (s < 0 ? 0 : -0.45) * c;
      }
      if (kn > 0) {
        A.x += ((s < 0 ? -0.13 : 0.12) - A.x) * kn;
        A.z += ((s < 0 ? -0.3 : 0.4) - A.z) * kn;
        A.y += ((s < 0 ? 0.09 : 0.14) - A.y) * kn;
        pitch += ((s < 0 ? 0 : -0.95) - pitch) * kn;
      }
      // 걸음 궤적
      if (amp > 0.001) {
        const ph = (((this.phase + (s > 0 ? Math.PI : 0)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const u = ph / (Math.PI * 2);
        let off, up = 0, fp = 0;
        if (u < beta) {
          const t = u / beta;
          off = amp * (1 - 2 * t);
          fp = t > 0.7 ? -(t - 0.7) * 1.6 : 0;
        } else {
          const t = (u - beta) / (1 - beta);
          off = amp * (-1 + 2 * smooth(t));
          up = lift * Math.sin(Math.PI * t);
          fp = -0.5 * (1 - t) + 0.3 * Math.sin(Math.PI * t * 0.9) * t;
        }
        A.addScaledVector(md, off);
        A.y += up;
        pitch += fp * this.gaitW * (backward > 0 ? 1 : -0.5);
      }
      if (st.air > 0.001) {
        A.lerp(v.a.set(s * 0.11, s < 0 ? 0.34 : 0.26, s < 0 ? -0.14 : 0.1), st.air);
        pitch += -0.35 * st.air;
      }
      if (dead) {
        const d = smooth(this.deathT / 0.35) * (1 - smooth((this.deathT - 0.3) / 0.6));
        A.z += (s < 0 ? -0.1 : 0.05) * d;
        A.x += s * 0.05 * smooth(this.deathT / 0.8);
      }
      // 발목이 골반에서 너무 멀면 당김
      const maxD = this.thighLen + this.shinLen - 0.004;
      const dd = A.distanceTo(leg.hip);
      if (dd > maxD) A.sub(leg.hip).multiplyScalar(maxD / dd).add(leg.hip);
      // 무릎은 앞쪽(+바깥)으로; 무릎 꿇은 다리는 아래로
      const pole = v.b.set(s * 0.12, 0, -1);
      if (kn > 0 && s > 0) pole.lerp(v.c.set(0.05, -1, -0.25), kn);
      const K = solveJoint(leg.hip, A, this.thighLen, this.shinLen, pole, leg.knee);
      const fwd = v.e.set(s * 0.08, 0, -1);
      aimBone(leg.thigh, leg.hip, K, fwd);
      aimBone(leg.shin, K, A, fwd);
      leg.foot.position.copy(A);
      leg.foot.rotation.set(pitch, s * -0.08, 0, 'YXZ');
    }
  }

  // 피격: 붉은 번쩍임 대신 몸이 움찔함 (상체·머리가 짧게 튕김)
  hit() {
    const f = this.flinch.v;
    f.x += 2.6 + Math.random() * 1.6;
    f.y += (Math.random() - 0.5) * 4.5;
    f.z += (Math.random() - 0.5) * 3.2;
  }

  muzzleWorld(target) {
    return this.muzzles[this.weaponShown ?? 'rifle'].getWorldPosition(target);
  }

  dispose() {
    this.solidMat.dispose();
    this.skeleton.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    if (this.tag) {
      this.tag.material.map?.dispose();
      this.tag.material.dispose();
    }
  }
}

// 재장전 키프레임 (u = 진행도, at = 손 위치 기준, mag = 탄창 상태)
const RELOAD_RIFLE = [
  { u: 0.0, at: 'grip', mag: 'gun' },
  { u: 0.12, at: 'gun', p: new V3(-0.01, -0.09, -0.09), mag: 'hand' },
  { u: 0.24, at: 'gun', p: new V3(-0.03, -0.22, -0.1), mag: 'hand' },
  { u: 0.32, at: 'chest', p: new V3(-0.1, 0.12, -0.26), mag: 'none' },
  { u: 0.42, at: 'chest', p: new V3(-0.074, 0.19, -0.2), mag: 'hand' },
  { u: 0.5, at: 'chest', p: new V3(-0.06, 0.2, -0.25), mag: 'hand' },
  { u: 0.62, at: 'gun', p: new V3(-0.01, -0.2, -0.09), mag: 'hand' },
  { u: 0.7, at: 'gun', p: new V3(-0.01, -0.09, -0.09), mag: 'gun' },
  { u: 0.78, at: 'gun', p: new V3(-0.035, 0.03, 0.0), mag: 'gun' },
  { u: 0.9, at: 'grip', mag: 'gun' },
  { u: 1.01, at: 'grip', mag: 'gun' },
];
const RELOAD_PISTOL = [
  { u: 0.0, at: 'grip', mag: 'gun' },
  { u: 0.1, at: 'gun', p: new V3(-0.04, -0.06, 0.04), mag: 'drop' },
  { u: 0.3, at: 'chest', p: new V3(-0.13, -0.04, -0.2), mag: 'none' },
  { u: 0.42, at: 'chest', p: new V3(-0.15, -0.03, -0.17), mag: 'hand' },
  { u: 0.62, at: 'gun', p: new V3(-0.01, -0.13, 0.04), mag: 'hand' },
  { u: 0.72, at: 'gun', p: new V3(-0.01, -0.09, 0.035), mag: 'gun' },
  { u: 0.88, at: 'grip', mag: 'gun' },
  { u: 1.01, at: 'grip', mag: 'gun' },
];
