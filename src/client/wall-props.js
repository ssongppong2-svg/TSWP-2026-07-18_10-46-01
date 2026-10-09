import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from '../sim/constants.js';
import { KIND } from '../sim/map.js';
import { makeSolidMaterial } from './agent-view.js';
import { part } from './exhibits.js';

// 벽에 붙은 소품: 공간을 채우는 장식 (모두 벽면에서 0.4m 안쪽이라 움직임·탄에는 영향 없음)
//   공장: 배관 줄(벽 한 줄 전체) · 배전함 + 전선관 · 환풍구 · 소화기 · 경고 표지 · 실외기
//   과학관: 소화전함 · 전시 설명판 · 안내 화면 · 비상구 표지
// 칸·방향마다 정해진 난수로 고르므로 매번 같은 자리에 놓인다.

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const hash = (...v) => {
  let h = 2166136261;
  for (const x of v) h = Math.imul(h ^ (Math.round(x * 10) | 0), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// 벽 칸이 그 높이 구간을 통째로 막고 있는지 (창문·문틀 자리에는 붙이지 않음)
const covers = (map, c, r, y0, y1) => map.inBounds(c, r) && map.spansAt(c, r).some(([a, b, k]) => k === KIND.wall && a <= y0 + 1e-3 && b >= y1 - 1e-3);

// 표지판 무늬 묶음 (가로 4 × 세로 2칸)
const SIGNS = {
  danger: 0, helmet: 1, forklift: 2, fire: 3, exit: 4, staff: 5, exhibit: 6, lab: 7,
};
function signAtlas() {
  const T = 128;
  const c = document.createElement('canvas');
  c.width = T * 4;
  c.height = T * 2;
  const g = c.getContext('2d');
  const font = (px, w = 700) => `${w} ${px}px 'IBM Plex Sans KR', 'Noto Sans KR', sans-serif`;
  const tile = (i, bg, draw) => {
    const x = (i % 4) * T, y = Math.floor(i / 4) * T;
    g.save();
    g.translate(x, y);
    g.fillStyle = bg;
    g.fillRect(2, 2, T - 4, T - 4);
    draw();
    g.restore();
  };
  const text = (s, y, px, col, w) => {
    g.fillStyle = col;
    g.font = font(px, w);
    g.textAlign = 'center';
    g.fillText(s, T / 2, y);
  };
  tile(SIGNS.danger, '#f2c230', () => {
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(64, 14);
    g.lineTo(108, 84);
    g.lineTo(20, 84);
    g.closePath();
    g.fill();
    g.fillStyle = '#f2c230';
    g.font = font(40);
    g.textAlign = 'center';
    g.fillText('!', 64, 76);
    text('고압 주의', 112, 20, '#111');
  });
  tile(SIGNS.helmet, '#f4f4f0', () => {
    g.fillStyle = '#1f5fa8';
    g.beginPath();
    g.arc(64, 52, 36, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(64, 60, 20, Math.PI, 0);
    g.fill();
    g.fillRect(40, 60, 48, 6);
    text('안전모 착용', 112, 18, '#1f5fa8');
  });
  tile(SIGNS.forklift, '#111', () => {
    for (let i = -2; i < 6; i++) {
      g.fillStyle = '#f2c230';
      g.beginPath();
      g.moveTo(i * 26, 0);
      g.lineTo(i * 26 + 13, 0);
      g.lineTo(i * 26 + 13 + 30, 30);
      g.lineTo(i * 26 + 30, 30);
      g.fill();
    }
    text('지게차 통행', 76, 22, '#f2c230');
    text('FORKLIFT', 104, 14, '#f2c230', 600);
  });
  tile(SIGNS.fire, '#c62d22', () => {
    text('소화기', 74, 30, '#fff');
    text('FIRE EXT.', 104, 14, '#fff', 600);
  });
  tile(SIGNS.exit, '#1b8a4c', () => {
    g.fillStyle = '#fff';
    g.fillRect(16, 40, 34, 44);
    g.fillStyle = '#1b8a4c';
    g.fillRect(22, 46, 22, 38);
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(60, 62);
    g.lineTo(108, 62);
    g.moveTo(96, 50);
    g.lineTo(110, 62);
    g.lineTo(96, 74);
    g.stroke();
    text('비상구', 112, 20, '#fff');
  });
  tile(SIGNS.staff, '#f4f4f0', () => {
    g.fillStyle = '#c62d22';
    g.fillRect(2, 2, T - 4, 34);
    text('출입 제한', 28, 20, '#fff');
    text('관계자 외', 70, 20, '#c62d22');
    text('출입 금지', 98, 20, '#c62d22');
  });
  tile(SIGNS.exhibit, '#f6f2ea', () => {
    g.fillStyle = '#1f3b5c';
    g.fillRect(2, 2, 10, T - 4);
    text('전시 안내', 34, 17, '#1f3b5c');
    g.fillStyle = 'rgba(40,40,40,0.55)';
    for (let i = 0; i < 6; i++) g.fillRect(22, 48 + i * 11, 84 - (i % 3) * 14, 4);
  });
  tile(SIGNS.lab, '#e9e6de', () => {
    g.fillStyle = '#d9822b';
    g.fillRect(2, 2, T - 4, 26);
    text('F-LAB 07', 21, 16, '#fff');
    text('힘 연구구역', 66, 18, '#2b2b2b');
    text('FORCE RESEARCH', 92, 12, '#555', 600);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 표지판 판 하나 (아틀라스의 i번째 칸)
function signPlane(i, w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  const u0 = (i % 4) / 4, v1 = 1 - Math.floor(i / 4) / 2;
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / 4, v1 - (1 - uv.getY(k)) / 2);
  return g;
}

export function buildWallProps(map, { museum = false } = {}) {
  const group = new THREE.Group();
  group.name = 'wallProps';
  const solid = [], signs = [], lit = [];
  const basis = new THREE.Matrix4();
  // 벽면 좌표계: x = 벽을 따라, y = 위, z = 벽에서 방 쪽으로
  const place = (geos, list, M) => {
    for (const g of geos) list.push(g.applyMatrix4(M));
  };
  const P = (geo, color, rough, metal, p, r = [0, 0, 0], emit = 0) => part(geo, color, rough, metal, p, r, 1, emit);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r1, r2, h, s = 10) => new THREE.CylinderGeometry(r1, r2, h, s);

  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      for (const s of map.surfaces(c, r)) {
        DIRS.forEach(([dc, dr], k) => {
          const nc = c + dc, nr = r + dr;
          if (!map.inBounds(nc, nr) || !covers(map, nc, nr, s + 0.2, s + 2.2)) return;
          const fx = map.cellX(c) + (dc * CELL) / 2, fz = map.cellZ(r) + (dr * CELL) / 2;
          // 축: 벽을 따라 (−dr, dc) · 위 · 방 쪽 (−dc, −dr)
          basis.makeBasis(new THREE.Vector3(-dr, 0, dc), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-dc, 0, -dr)).setPosition(fx, s, fz);
          const M = basis.clone();
          // 배관 줄: 벽 한 줄 전체에 이어지게 (그 벽 줄의 번호로 정함)
          const line = k < 2 ? nr : nc;
          if (!museum && hash(7, k, line, s) < 0.24 && covers(map, nc, nr, s + 2.5, s + 3.25)) {
            place([
              P(cyl(0.065, 0.065, CELL + 0.02, 12), '#5d6870', 0.45, 0.6, [0, 2.78, 0.13], [0, 0, Math.PI / 2]),
              P(cyl(0.045, 0.045, CELL + 0.02, 10), '#8a6040', 0.55, 0.5, [0, 3.05, 0.11], [0, 0, Math.PI / 2]),
              P(box(0.05, 0.4, 0.2), '#3a3d40', 0.6, 0.5, [0.3, 2.9, 0.08]),
            ], solid, M);
          }
          const roll = hash(3, c, r, k, s);
          const off = (hash(5, c, r, k, s) - 0.5) * 0.9; // 벽을 따라 조금씩 다른 자리
          if (!museum) {
            if (roll < 0.06 && covers(map, nc, nr, s + 0.9, s + 3.3)) {
              // 배전함 + 전선관 + 경고 표지
              place([
                P(box(0.46, 0.62, 0.16), '#a3a8aa', 0.5, 0.4, [off, 1.55, 0.08]),
                P(box(0.42, 0.012, 0.005), '#55595c', 0.6, 0.3, [off, 1.55, 0.162]),
                P(box(0.03, 0.08, 0.03), '#2b2d2f', 0.5, 0.5, [off + 0.18, 1.5, 0.17]),
                P(cyl(0.022, 0.022, 1.45, 8), '#7d8386', 0.5, 0.5, [off - 0.1, 2.58, 0.06]),
              ], solid, M);
              signs.push(signPlane(SIGNS.danger, 0.2, 0.2).applyMatrix4(new THREE.Matrix4().makeTranslation(off, 1.62, 0.166)).applyMatrix4(M));
            } else if (roll < 0.11 && covers(map, nc, nr, s + 2.0, s + 2.65)) {
              // 환풍구: 틀 + 가로 날개
              const parts = [P(box(0.74, 0.48, 0.08), '#8d9396', 0.5, 0.5, [off, 2.32, 0.04])];
              for (let i = 0; i < 5; i++) parts.push(P(box(0.66, 0.035, 0.05), '#2c2f31', 0.6, 0.4, [off, 2.16 + i * 0.08, 0.08], [0.5, 0, 0]));
              place(parts, solid, M);
            } else if (roll < 0.15 && covers(map, nc, nr, s + 0.4, s + 1.8)) {
              // 소화기 + 걸이 + 표지
              place([
                P(cyl(0.075, 0.075, 0.46, 12), '#c0281e', 0.4, 0.2, [off, 0.78, 0.12]),
                P(cyl(0.03, 0.03, 0.08, 8), '#2b2b2b', 0.5, 0.4, [off, 1.05, 0.12]),
                P(box(0.1, 0.03, 0.16), '#2b2b2b', 0.5, 0.4, [off + 0.04, 1.08, 0.14], [0, 0, -0.3]),
                P(box(0.2, 0.06, 0.04), '#3a3a3a', 0.6, 0.4, [off, 0.98, 0.03]),
              ], solid, M);
              signs.push(signPlane(SIGNS.fire, 0.28, 0.28).applyMatrix4(new THREE.Matrix4().makeTranslation(off, 1.5, 0.012)).applyMatrix4(M));
            } else if (roll < 0.21 && covers(map, nc, nr, s + 1.4, s + 2.1)) {
              const kinds = [SIGNS.helmet, SIGNS.forklift, SIGNS.staff, SIGNS.lab, SIGNS.danger];
              signs.push(signPlane(kinds[Math.floor(hash(9, c, r, k) * kinds.length)], 0.5, 0.5).applyMatrix4(new THREE.Matrix4().makeTranslation(off, 1.75, 0.012)).applyMatrix4(M));
            } else if (roll < 0.235 && s === 0 && covers(map, nc, nr, 0, 0.9)) {
              // 실외기 (바닥, 벽에 붙임) + 팬 덮개 + 배관
              place([
                P(box(0.92, 0.74, 0.38), '#c9cbc6', 0.6, 0.15, [off, 0.37, 0.2]),
                P(cyl(0.27, 0.27, 0.02, 18), '#2e3133', 0.6, 0.3, [off + 0.1, 0.4, 0.39], [Math.PI / 2, 0, 0]),
                P(box(0.92, 0.04, 0.4), '#8f928d', 0.6, 0.2, [off, 0.76, 0.2]),
                P(cyl(0.025, 0.025, 1.6, 8), '#d8d8d2', 0.5, 0.2, [off - 0.38, 1.5, 0.05]),
              ], solid, M);
            }
          } else {
            if (roll < 0.05 && covers(map, nc, nr, s + 0.6, s + 1.8)) {
              // 소화전함: 빨간 틀 + 유리 + 안의 소화기
              place([
                P(box(0.56, 0.86, 0.1), '#b8261d', 0.45, 0.2, [off, 1.15, 0.05]),
                P(box(0.48, 0.78, 0.01), '#d8e4e8', 0.08, 0.3, [off, 1.15, 0.104]),
                P(cyl(0.07, 0.07, 0.42, 12), '#c0281e', 0.4, 0.2, [off, 1.05, 0.07]),
              ], solid, M);
              signs.push(signPlane(SIGNS.fire, 0.24, 0.24).applyMatrix4(new THREE.Matrix4().makeTranslation(off, 1.78, 0.012)).applyMatrix4(M));
            } else if (roll < 0.14 && covers(map, nc, nr, s + 1.1, s + 1.9)) {
              // 전시 설명판 (금속 틀)
              place([P(box(0.7, 0.5, 0.03), '#3a3c40', 0.4, 0.6, [off, 1.48, 0.015])], solid, M);
              signs.push(signPlane(SIGNS.exhibit, 0.64, 0.44).applyMatrix4(new THREE.Matrix4().makeTranslation(off, 1.48, 0.032)).applyMatrix4(M));
            } else if (roll < 0.18 && covers(map, nc, nr, s + 1.3, s + 2.1)) {
              // 안내 화면 (어두운 테두리 + 빛나는 화면)
              place([P(box(1.04, 0.62, 0.06), '#1d1f22', 0.3, 0.4, [off, 1.72, 0.03])], solid, M);
              lit.push(new THREE.PlaneGeometry(0.96, 0.54).applyMatrix4(new THREE.Matrix4().makeTranslation(off, 1.72, 0.062)).applyMatrix4(M));
            } else if (roll < 0.205 && covers(map, nc, nr, s + 2.3, s + 2.8)) {
              // 비상구 표지 (빛나는 초록 상자)
              place([P(box(0.5, 0.26, 0.08), '#e8e8e2', 0.4, 0.1, [off, 2.55, 0.04])], solid, M);
              signs.push(signPlane(SIGNS.exit, 0.44, 0.22).applyMatrix4(new THREE.Matrix4().makeTranslation(off, 2.55, 0.082)).applyMatrix4(M));
            }
          }
        });
      }
    }
  }
  if (solid.length) {
    const m = new THREE.Mesh(mergeGeometries(solid), makeSolidMaterial({ strobe: 0 }));
    m.castShadow = false;
    m.receiveShadow = true;
    group.add(m);
  }
  if (signs.length) {
    const m = new THREE.Mesh(mergeGeometries(signs), new THREE.MeshStandardMaterial({ map: signAtlas(), roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }));
    group.add(m);
  }
  if (lit.length) {
    // 안내 화면: 개념 그림이 도는 듯한 은은한 청록 화면
    const m = new THREE.Mesh(mergeGeometries(lit), new THREE.MeshBasicMaterial({ color: '#7fd6e6' }));
    group.add(m);
  }
  return group;
}
