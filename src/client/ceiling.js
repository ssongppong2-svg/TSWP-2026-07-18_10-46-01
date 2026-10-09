import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from '../sim/constants.js';
import { KIND, ROOF, SLAB } from '../sim/map.js';

// 천장 조명: 지붕·2층 바닥판 아래 천장마다 등을 단다 (실제 광원이 아니라 빛나는 면 + 바닥의 은은한 빛 웅덩이).
//   과학관: 천장에 매립한 사각 조명판 (3칸마다)
//   공장:   높은 지붕 아래는 매달린 고천장 등, 낮은 2층 바닥판 아래는 형광등 막대
// 실제 점광원은 벽 등(addLamps)이 맡고, 이것은 실내가 "불 켜진 건물"로 보이게 하는 장식이다.

const PROP = new Set([KIND.crate, KIND.bigCrate, KIND.barrier, KIND.rail]);

// 걸을 수 있는 바닥 높이 s 위의 천장 높이 (없으면 null = 하늘)
function ceilingAbove(map, c, r, s) {
  let best = null;
  for (const [y0, , k] of map.spansAt(c, r)) {
    if (PROP.has(k) || y0 < s + 1.9) continue;
    if (best === null || y0 < best[0]) best = [y0, k];
  }
  return best;
}

// 둥근 빛 웅덩이 무늬 (가운데가 밝고 가장자리로 사라짐)
function poolTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCeilingFixtures(map, { museum = false, skip = null } = {}) {
  const group = new THREE.Group();
  group.name = 'ceilingFixtures';
  const glow = [], frame = [], pools = [];
  const M = new THREE.Matrix4();
  const at = (geo, x, y, z, rx = 0) => {
    M.makeRotationX(rx).setPosition(x, y, z);
    return geo.applyMatrix4(M);
  };
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (skip?.(c, r)) continue;
      for (const s of map.surfaces(c, r)) {
        const ceil = ceilingAbove(map, c, r, s);
        if (!ceil) continue;
        const [y, kind] = ceil;
        const high = kind === KIND.roof && y - s > 4.5;
        // 등 간격: 매립 조명판·고천장 등은 3칸마다, 낮은 형광등은 2칸마다 (칸 줄이 엇갈리게)
        const step = museum || high ? 3 : 2;
        if ((c + (s > 1 ? 1 : 0)) % step !== 1 || r % step !== 1) continue;
        const x = map.cellX(c), z = map.cellZ(r);
        if (museum) {
          frame.push(at(new THREE.BoxGeometry(1.5, 0.04, 1.5), x, y - 0.02, z));
          glow.push(at(new THREE.PlaneGeometry(1.32, 1.32), x, y - 0.045, z, Math.PI / 2));
          pools.push({ x, y: s + 0.03, z, size: 6.5, k: 0.1 });
        } else if (high) {
          // 고천장 등: 줄 + 갓 + 빛나는 아랫면
          const drop = Math.min(1.6, y - s - 4.2);
          const ly = y - drop;
          frame.push(at(new THREE.CylinderGeometry(0.015, 0.015, drop, 5), x, y - drop / 2, z));
          frame.push(at(new THREE.CylinderGeometry(0.1, 0.42, 0.32, 12, 1, true), x, ly - 0.16, z));
          frame.push(at(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 10), x, ly + 0.04, z));
          glow.push(at(new THREE.CircleGeometry(0.38, 16), x, ly - 0.31, z, Math.PI / 2));
          pools.push({ x, y: s + 0.03, z, size: 8, k: 0.16 });
        } else {
          // 형광등 막대 (2층 바닥판 밑): 몸통 + 빛나는 관
          frame.push(at(new THREE.BoxGeometry(1.35, 0.07, 0.22), x, y - 0.035, z));
          glow.push(at(new THREE.BoxGeometry(1.22, 0.035, 0.11), x, y - 0.085, z));
          pools.push({ x, y: s + 0.03, z, size: 5, k: 0.14 });
        }
      }
    }
  }
  // 공장 지붕 밑 철골: 짧은 쪽으로 걸친 H형 보(2칸마다) + 긴 쪽 가운데 도리
  if (!museum) {
    const yb = ROOF - SLAB;
    const ibeam = (len, along, x, z) => {
      const parts = [
        new THREE.BoxGeometry(0.06, 0.28, len).translate(0, -0.16, 0),
        new THREE.BoxGeometry(0.18, 0.03, len).translate(0, -0.03, 0),
        new THREE.BoxGeometry(0.18, 0.03, len).translate(0, -0.29, 0),
      ];
      const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
      if (along === 'x') g.rotateY(Math.PI / 2);
      return g.translate(x, yb, z);
    };
    for (const q of map.roofs) {
      const x0 = map.originX + q.c0 * CELL, x1 = map.originX + (q.c1 + 1) * CELL;
      const z0 = map.originZ + q.r0 * CELL, z1 = map.originZ + (q.r1 + 1) * CELL;
      const wide = x1 - x0 > z1 - z0;
      if (wide) {
        for (let x = x0 + CELL * 1.5; x < x1 - CELL; x += CELL * 2) frame.push(ibeam(z1 - z0 - 0.2, 'z', x, (z0 + z1) / 2));
        frame.push(ibeam(x1 - x0 - 0.2, 'x', (x0 + x1) / 2, (z0 + z1) / 2).translate(0, -0.3, 0));
      } else {
        for (let z = z0 + CELL * 1.5; z < z1 - CELL; z += CELL * 2) frame.push(ibeam(x1 - x0 - 0.2, 'x', (x0 + x1) / 2, z));
        frame.push(ibeam(z1 - z0 - 0.2, 'z', (x0 + x1) / 2, (z0 + z1) / 2).translate(0, -0.3, 0));
      }
    }
  }
  if (frame.length) {
    const m = new THREE.Mesh(mergeGeometries(frame.map((g) => (g.index ? g.toNonIndexed() : g))), new THREE.MeshStandardMaterial({ color: museum ? '#d7d2c8' : '#2a2d31', roughness: 0.55, metalness: museum ? 0.1 : 0.6, side: THREE.DoubleSide }));
    group.add(m);
  }
  if (glow.length) {
    const m = new THREE.Mesh(
      mergeGeometries(glow.map((g) => (g.index ? g.toNonIndexed() : g))),
      new THREE.MeshBasicMaterial({ color: museum ? '#fff6e6' : '#f4f1e6', side: THREE.DoubleSide }),
    );
    m.name = 'ceilingGlow';
    group.add(m);
  }
  if (pools.length) {
    // 빛 웅덩이: 바닥 위 얇은 사각형들 (더하기 섞기라 겹쳐도 자연스럽게 밝아짐)
    const geos = pools.map((p) => {
      const g = new THREE.PlaneGeometry(p.size, p.size).rotateX(-Math.PI / 2).translate(p.x, p.y, p.z);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3).fill(p.k);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    });
    const m = new THREE.Mesh(
      mergeGeometries(geos),
      new THREE.MeshBasicMaterial({ map: poolTexture(), color: museum ? '#fff1d8' : '#ffe7c4', vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    m.name = 'ceilingPools';
    m.renderOrder = 1;
    group.add(m);
  }
  return group;
}

// 지붕 바로 아래 높이 (아트리움 천장 장식이 붙는 곳)
export const CEILING_Y = ROOF - SLAB;
