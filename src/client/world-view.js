import * as THREE from 'three';
import { CELL } from '../sim/constants.js';
import { TILES } from '../sim/map.js';
import { posterTexture, signTexture, siteDecal } from './textures.js';

export const SITE_COLORS = { A: '#ffc24a', B: '#b98cff' };

// 맵(글자 격자)을 3D 메쉬로 만듭니다.
export function buildWorld(map, tex) {
  const group = new THREE.Group();
  group.name = 'world';

  // ── 바닥
  const floorMat = new THREE.MeshStandardMaterial({ map: tex.floor, roughness: 0.82, metalness: 0.08 });
  tex.floor.repeat.set(map.width / 4, map.depth / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // 바닥 구역 표시 (구역 색칠 + 테두리)
  group.add(buildFloorMarkings(map));

  // ── 벽: 보이는 면만 만들기 (월드 좌표 UV라서 이어지는 벽의 무늬가 자연스럽게 연결됨)
  const sides = new QuadBuilder();
  const tops = new QuadBuilder();
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (TILES[map.charAt(c, r)]?.kind !== 'wall') continue;
      const h = map.heightAt(c, r);
      const x0 = map.originX + c * CELL, x1 = x0 + CELL;
      const z0 = map.originZ + r * CELL, z1 = z0 + CELL;
      const sidesToCheck = [
        [0, -1, [x1, z0], [x0, z0], 0, 0, -1],
        [0, 1, [x0, z1], [x1, z1], 0, 0, 1],
        [-1, 0, [x0, z0], [x0, z1], -1, 0, 0],
        [1, 0, [x1, z1], [x1, z0], 1, 0, 0],
      ];
      for (const [dc, dr, a, b, nx, ny, nz] of sidesToCheck) {
        if (!map.inBounds(c + dc, r + dr)) continue;
        const nh = map.heightAt(c + dc, r + dr);
        if (nh >= h) continue;
        const y0 = Math.max(0, nh);
        const ua = (nx !== 0 ? a[1] * -nx : a[0] * nz) / 4;
        const ub = (nx !== 0 ? b[1] * -nx : b[0] * nz) / 4;
        sides.quad(
          [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], h, b[1]], [a[0], h, a[1]],
          [nx, ny, nz],
          [ua, y0 / 4.8], [ub, y0 / 4.8], [ub, h / 4.8], [ua, h / 4.8],
        );
      }
      tops.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1]);
    }
  }
  const wallMat = new THREE.MeshStandardMaterial({
    map: tex.wall,
    emissiveMap: tex.wallEmissive,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 1.4,
    roughness: 0.7,
    metalness: 0.15,
  });
  const wallMesh = new THREE.Mesh(sides.build(), wallMat);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  group.add(wallMesh);
  const topMesh = new THREE.Mesh(tops.build(), new THREE.MeshStandardMaterial({ map: tex.wallTop, roughness: 0.6, metalness: 0.3 }));
  topMesh.castShadow = true;
  topMesh.receiveShadow = true;
  group.add(topMesh);

  // ── 상자들 (같은 종류끼리 인스턴스로 그려서 가볍게)
  const kinds = {
    crate: { tex: tex.crate, top: '#b77a22', rough: 0.6, metal: 0.1 },
    bigCrate: { tex: tex.container, top: '#24525c', rough: 0.45, metal: 0.45 },
    barrier: { tex: tex.barrier, top: '#2a2d33', rough: 0.85, metal: 0.05 },
  };
  for (const [kind, style] of Object.entries(kinds)) {
    const cells = [];
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) if (TILES[map.charAt(c, r)]?.kind === kind) cells.push([c, r]);
    }
    if (!cells.length) continue;
    const h = TILES[Object.keys(TILES).find((k) => TILES[k].kind === kind)].h;
    const geo = new THREE.BoxGeometry(CELL * 0.98, h, CELL * 0.98);
    geo.translate(0, h / 2, 0);
    const side = new THREE.MeshStandardMaterial({ map: style.tex, roughness: style.rough, metalness: style.metal });
    const top = new THREE.MeshStandardMaterial({ color: style.top, roughness: style.rough, metalness: style.metal });
    const mesh = new THREE.InstancedMesh(geo, [side, side, top, top, side, side], cells.length);
    const m = new THREE.Matrix4();
    cells.forEach(([c, r], i) => {
      const rot = ((c * 7 + r * 13) % 4) * (Math.PI / 2);
      m.makeRotationY(kind === 'bigCrate' ? 0 : rot);
      m.setPosition(map.cellX(c), 0, map.cellZ(r));
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ── 구역 글자 (바닥) + 구역 조명
  for (const b of map.bombs) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: siteDecal(b.id, SITE_COLORS[b.id]), transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(b.x, 0.02, b.z);
    group.add(decal);
    const light = new THREE.PointLight(SITE_COLORS[b.id], 30, 18, 2);
    light.position.set(b.x, 4.2, b.z);
    group.add(light);
  }

  // ── 표지판·포스터
  addDecor(group, map);

  // ── 맵 밖 풍경 (먼 건물들)
  group.add(buildSkyline(map));
  return group;
}

class QuadBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }
  quad(a, b, c, d, n, ua, ub, uc, ud) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(...p);
    for (let i = 0; i < 4; i++) this.nor.push(...n);
    for (const u of [ua, ub, uc, ud]) this.uv.push(...u);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function buildFloorMarkings(map) {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = map.cols * S;
  c.height = map.rows * S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const fills = { a: 'rgba(255,194,74,0.16)', A: 'rgba(255,194,74,0.16)', b: 'rgba(185,140,255,0.16)', B: 'rgba(185,140,255,0.16)', F: 'rgba(255,122,47,0.22)', D: 'rgba(63,216,255,0.22)' };
  const edges = { a: '#ffc24a', A: '#ffc24a', b: '#b98cff', B: '#b98cff', F: '#ff7a2f', D: '#3fd8ff' };
  const group = (ch) => (ch === 'A' ? 'a' : ch === 'B' ? 'b' : ch);
  for (let r = 0; r < map.rows; r++) {
    for (let col = 0; col < map.cols; col++) {
      const ch = map.charAt(col, r);
      if (!fills[ch]) continue;
      g.fillStyle = fills[ch];
      g.fillRect(col * S, r * S, S, S);
      g.strokeStyle = edges[ch];
      g.lineWidth = 3;
      g.globalAlpha = 0.7;
      const same = (dc, dr) => group(map.charAt(col + dc, r + dr)) === group(ch);
      g.beginPath();
      if (!same(0, -1)) { g.moveTo(col * S, r * S + 1.5); g.lineTo(col * S + S, r * S + 1.5); }
      if (!same(0, 1)) { g.moveTo(col * S, r * S + S - 1.5); g.lineTo(col * S + S, r * S + S - 1.5); }
      if (!same(-1, 0)) { g.moveTo(col * S + 1.5, r * S); g.lineTo(col * S + 1.5, r * S + S); }
      if (!same(1, 0)) { g.moveTo(col * S + S - 1.5, r * S); g.lineTo(col * S + S - 1.5, r * S + S); }
      g.stroke();
      g.globalAlpha = 1;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(map.width, map.depth),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  return mesh;
}

const ICONS = {
  gravity(g, x, y, color) {
    g.fillStyle = '#2b3550';
    g.beginPath();
    g.arc(x, y + 40, 70, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(x, y - 110);
    g.lineTo(x, y - 20);
    g.stroke();
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x - 26, y - 34);
    g.lineTo(x + 26, y - 34);
    g.lineTo(x, y);
    g.fill();
  },
  elastic(g, x, y, color) {
    g.strokeStyle = color;
    g.lineWidth = 10;
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const px = x + Math.sin(t * Math.PI * 10) * 50;
      const py = y + 90 - t * 170;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = '#dfe8f5';
    g.fillRect(x - 70, y + 92, 140, 16);
  },
  resultant(g, x, y, color) {
    const arrow = (x0, y0, len, col, w) => {
      g.strokeStyle = col;
      g.fillStyle = col;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + len - 24, y0);
      g.stroke();
      g.beginPath();
      g.moveTo(x0 + len, y0);
      g.lineTo(x0 + len - 30, y0 - 20);
      g.lineTo(x0 + len - 30, y0 + 20);
      g.fill();
    };
    arrow(x - 150, y - 60, 150, '#8fb8ff', 12);
    arrow(x, y - 60, 100, '#8fb8ff', 12);
    arrow(x - 150, y + 50, 250, color, 18);
  },
  friction(g, x, y, color) {
    g.fillStyle = '#dfe8f5';
    g.fillRect(x - 60, y - 40, 120, 80);
    g.strokeStyle = color;
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(x - 150, y + 48);
    g.lineTo(x + 150, y + 48);
    g.stroke();
    g.strokeStyle = '#ff7a7a';
    g.beginPath();
    g.moveTo(x - 70, y + 20);
    g.lineTo(x - 150, y + 20);
    g.stroke();
    g.fillStyle = '#ff7a7a';
    g.beginPath();
    g.moveTo(x - 170, y + 20);
    g.lineTo(x - 140, y);
    g.lineTo(x - 140, y + 40);
    g.fill();
  },
};

function addDecor(group, map) {
  const posters = [
    { title: '중력', color: '#8a9dff', icon: ICONS.gravity, lines: ['지구가 물체를 당기는 힘', '방향: 지구 중심 쪽', '크기 = 무게 (단위 N)'] },
    { title: '탄성력', color: '#8dff5a', icon: ICONS.elastic, lines: ['원래 모양으로', '되돌아가려는 힘', '많이 변형될수록 커요'] },
    { title: '합력', color: '#ffa13d', icon: ICONS.resultant, lines: ['같은 방향: 더하기', '반대 방향: 빼기', '방향은 큰 힘 쪽'] },
    { title: '마찰력', color: '#7fe9ff', icon: ICONS.friction, lines: ['운동을 방해하는 힘', '운동 방향과 반대', '거칠수록 · 무거울수록 ↑'] },
  ];
  // 해체팀 시작 홀의 북쪽 벽(31번째 줄 남쪽 면)에 포스터
  const wallRow = 31;
  const faceZ = map.originZ + (wallRow + 1) * CELL + 0.03;
  const posterCols = [9, 12.5, 22.5, 26];
  posters.forEach((p, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.34), new THREE.MeshBasicMaterial({ map: posterTexture(p) }));
    m.position.set(map.originX + posterCols[i] * CELL, 2.2, faceZ);
    group.add(m);
  });
  // 길 안내 표지판 { 위치(칸 단위), 바라보는 방향 }
  const signs = [
    // 해체팀 시작 홀 북쪽 벽 (남쪽을 바라봄)
    { text: 'A', color: '#ffc24a', sub: '← A 구역', x: 7.7, z: 32, rotY: 0 },
    { text: 'B', color: '#b98cff', sub: 'B 구역 →', x: 28.3, z: 32, rotY: 0 },
    // 중앙 통로 양쪽 벽
    { text: 'A', color: '#ffc24a', sub: 'A 구역', x: 15, z: 15.3, rotY: Math.PI / 2 },
    { text: 'B', color: '#b98cff', sub: 'B 구역', x: 21, z: 15.3, rotY: -Math.PI / 2 },
    // 포스팀 진영 (4번째 줄 벽의 북쪽 면)
    { text: 'A', color: '#ffc24a', sub: 'A 구역 →', x: 8.5, z: 4, rotY: Math.PI },
    { text: 'B', color: '#b98cff', sub: '← B 구역', x: 27.5, z: 4, rotY: Math.PI },
  ];
  for (const s of signs) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: signTexture(s.text, s.color, s.sub) }));
    const off = 0.03;
    m.position.set(
      map.originX + s.x * CELL + Math.sin(s.rotY) * off,
      3.2,
      map.originZ + s.z * CELL + Math.cos(s.rotY) * off,
    );
    m.rotation.y = s.rotY;
    group.add(m);
  }
}

function buildSkyline(map) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const winCanvas = document.createElement('canvas');
  winCanvas.width = 64;
  winCanvas.height = 128;
  const wg = winCanvas.getContext('2d');
  wg.fillStyle = '#000';
  wg.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 128; y += 10) {
    for (let x = 4; x < 64; x += 10) {
      if (Math.random() < 0.35) {
        wg.fillStyle = Math.random() < 0.7 ? '#ffd9a0' : '#9fdcff';
        wg.fillRect(x, y, 5, 5);
      }
    }
  }
  const winTex = new THREE.CanvasTexture(winCanvas);
  winTex.colorSpace = THREE.SRGBColorSpace;
  winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
  winTex.repeat.set(2, 3);
  const mat = new THREE.MeshStandardMaterial({ color: '#1a2030', roughness: 0.9, emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: 0.9 });
  const count = 46;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const R = Math.max(map.width, map.depth) * 0.75;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.sin(i * 12.9) * 0.05;
    const r = R + 15 + ((i * 37) % 50);
    const w = 8 + ((i * 13) % 14), d = 8 + ((i * 7) % 12), h = 14 + ((i * 29) % 46);
    m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(w, h, d));
    mesh.setMatrixAt(i, m);
  }
  g.add(mesh);
  // 바깥 땅
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshStandardMaterial({ color: '#1f2530', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  g.add(ground);
  return g;
}
