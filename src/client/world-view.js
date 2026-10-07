import * as THREE from 'three';
import { CELL } from '../sim/constants.js';
import { TILES } from '../sim/map.js';
import { posterTexture, siteDecal, sprayTexture } from './textures.js';
import { puddleTexture } from './weather.js';

export const SITE_COLORS = { A: '#d9b45a', B: '#b9a0d8' };

const LAMP_STYLE = {
  sodium: { color: '#ffb35c', intensity: 30, lens: '#ffd39a' },
  fluo: { color: '#cfe0ff', intensity: 14, lens: '#dfe8f6' },
};

// 맵(글자 격자)을 3D 메쉬로 만든다.
export function buildWorld(map, tex) {
  const group = new THREE.Group();
  group.name = 'world';

  // 비가 오면 모든 표면이 젖어 어둡고 매끈해짐 (등불이 바닥에 번져 반사)
  const wet = map.weather === 'rain';

  // ── 바닥
  tex.floor.repeat.set(map.width / 4, map.depth / 4);
  tex.floorBump.repeat.set(map.width / 4, map.depth / 4);
  const floorMat = new THREE.MeshStandardMaterial({
    map: tex.floor,
    bumpMap: tex.floorBump,
    bumpScale: 1.2,
    roughness: wet ? 0.62 : 0.9,
    metalness: 0.02,
    color: wet ? '#8d939b' : '#ffffff',
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  group.add(buildFloorMarkings(map));
  if (wet) {
    // 물웅덩이: 거의 거울처럼 매끈한 얇은 층
    const pt = puddleTexture(map.width + map.depth);
    pt.repeat.set(map.width / 18, map.depth / 18);
    const puddles = new THREE.Mesh(
      new THREE.PlaneGeometry(map.width, map.depth),
      new THREE.MeshStandardMaterial({
        color: '#07090c',
        roughness: 0.2,
        metalness: 0.0,
        envMapIntensity: 0.25,
        alphaMap: pt,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1.5,
      }),
    );
    puddles.rotation.x = -Math.PI / 2;
    puddles.position.y = 0.012;
    puddles.receiveShadow = true;
    group.add(puddles);
  }

  // ── 벽: 보이는 면만 (월드 좌표 UV라서 이어지는 벽의 무늬가 자연스럽게 연결됨)
  const sides = new QuadBuilder();
  const tops = new QuadBuilder();
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (TILES[map.charAt(c, r)]?.kind !== 'wall') continue;
      const h = map.heightAt(c, r);
      const x0 = map.originX + c * CELL, x1 = x0 + CELL;
      const z0 = map.originZ + r * CELL, z1 = z0 + CELL;
      const faces = [
        [0, -1, [x1, z0], [x0, z0], 0, 0, -1],
        [0, 1, [x0, z1], [x1, z1], 0, 0, 1],
        [-1, 0, [x0, z0], [x0, z1], -1, 0, 0],
        [1, 0, [x1, z1], [x1, z0], 1, 0, 0],
      ];
      for (const [dc, dr, a, b, nx, ny, nz] of faces) {
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
    bumpMap: tex.wallBump,
    bumpScale: 2.0,
    roughness: wet ? 0.74 : 0.93,
    metalness: 0.02,
    color: wet ? '#a7acb3' : '#ffffff',
  });
  const wallMesh = new THREE.Mesh(sides.build(), wallMat);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  group.add(wallMesh);
  const topMesh = new THREE.Mesh(tops.build(), new THREE.MeshStandardMaterial({ map: tex.wallTop, roughness: 0.7, metalness: 0.5 }));
  topMesh.castShadow = true;
  topMesh.receiveShadow = true;
  group.add(topMesh);

  // ── 상자들 (같은 종류끼리 인스턴스로 그려서 가볍게)
  const kinds = {
    crate: { tex: tex.crate, top: '#3f432c', rough: 0.85, metal: 0.05, inset: 0.92 },
    bigCrate: { tex: tex.container, top: '#2b373c', rough: 0.6, metal: 0.55, inset: 0.98 },
    barrier: { tex: tex.barrier, top: '#77776f', rough: 0.95, metal: 0.0, inset: 0.96 },
  };
  for (const [kind, style] of Object.entries(kinds)) {
    const cells = [];
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) if (TILES[map.charAt(c, r)]?.kind === kind) cells.push([c, r]);
    }
    if (!cells.length) continue;
    const h = Object.values(TILES).find((t) => t.kind === kind).h;
    const geo = new THREE.BoxGeometry(CELL * style.inset, h, CELL * style.inset);
    geo.translate(0, h / 2, 0);
    const rough = wet ? style.rough * 0.6 : style.rough;
    const side = new THREE.MeshStandardMaterial({ map: style.tex, roughness: rough, metalness: style.metal, color: wet ? '#b3b7bc' : '#ffffff' });
    const top = new THREE.MeshStandardMaterial({ color: style.top, roughness: wet ? 0.25 : style.rough, metalness: style.metal });
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

  // ── 구역 글자 (바닥 페인트)
  for (const b of map.bombs) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshStandardMaterial({ map: siteDecal(b.id, '#d8d2bf'), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(b.x + 4.2, 0.02, b.z + 3.5);
    decal.receiveShadow = true;
    group.add(decal);
  }

  const lights = addLamps(group, map);
  addDecor(group, map);
  group.add(buildSkyline(map));
  group.userData.lamps = lights;
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

// 바닥 페인트 선 (구역 경계는 노란색, 진영은 흰색) — 닳은 느낌
function buildFloorMarkings(map) {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = map.cols * S;
  c.height = map.rows * S;
  const g = c.getContext('2d');
  const edges = { a: '#c9a43a', A: '#c9a43a', b: '#c9a43a', B: '#c9a43a', F: '#cfcac0', D: '#cfcac0' };
  const group = (ch) => (ch === 'A' ? 'a' : ch === 'B' ? 'b' : ch);
  g.lineWidth = 5;
  for (let r = 0; r < map.rows; r++) {
    for (let col = 0; col < map.cols; col++) {
      const ch = map.charAt(col, r);
      if (!edges[ch]) continue;
      g.strokeStyle = edges[ch];
      g.globalAlpha = 0.5;
      const same = (dc, dr) => group(map.charAt(col + dc, r + dr)) === group(ch);
      g.beginPath();
      if (!same(0, -1)) { g.moveTo(col * S, r * S + 3); g.lineTo(col * S + S, r * S + 3); }
      if (!same(0, 1)) { g.moveTo(col * S, r * S + S - 3); g.lineTo(col * S + S, r * S + S - 3); }
      if (!same(-1, 0)) { g.moveTo(col * S + 3, r * S); g.lineTo(col * S + 3, r * S + S); }
      if (!same(1, 0)) { g.moveTo(col * S + S - 3, r * S); g.lineTo(col * S + S - 3, r * S + S); }
      g.stroke();
    }
  }
  // 닳은 부분 지우기
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 1;
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    g.globalAlpha = 0.3 + rnd() * 0.7;
    g.fillRect(rnd() * c.width, rnd() * c.height, 4 + rnd() * 18, 3 + rnd() * 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(map.width, map.depth),
    new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  mesh.receiveShadow = true;
  return mesh;
}

// 벽에 등을 달고 점광원 배치
function addLamps(group, map) {
  const out = [];
  const housingMat = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.6, metalness: 0.6 });
  for (const lamp of map.def.decor?.lamps ?? []) {
    const st = LAMP_STYLE[lamp.kind];
    // 가장 가까운 벽 방향 찾기
    let dir = null;
    for (let d = 1; d <= 3 && !dir; d++) {
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (map.heightAt(lamp.c + dc * d, lamp.r + dr * d) >= 4) {
          dir = { dc, dr, d };
          break;
        }
      }
    }
    if (!dir) dir = { dc: 0, dr: -1, d: 1 };
    const cx = map.cellX(lamp.c), cz = map.cellZ(lamp.r);
    // 벽면 위치 = 셀 중심에서 벽 쪽으로 (d-0.5)칸
    const wx = cx + dir.dc * (dir.d - 0.5) * CELL, wz = cz + dir.dr * (dir.d - 0.5) * CELL;
    const y = 3.7;
    const fixture = new THREE.Group();
    fixture.position.set(wx - dir.dc * 0.12, y, wz - dir.dr * 0.12);
    fixture.rotation.y = Math.atan2(-dir.dc, -dir.dr);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(lamp.kind === 'fluo' ? 1.3 : 0.5, 0.22, 0.24), housingMat);
    const lens = new THREE.Mesh(
      new THREE.BoxGeometry(lamp.kind === 'fluo' ? 1.2 : 0.38, 0.06, 0.18),
      new THREE.MeshStandardMaterial({ color: st.lens, emissive: st.lens, emissiveIntensity: 2.6 }),
    );
    lens.position.set(0, -0.12, 0.02);
    fixture.add(housing, lens);
    group.add(fixture);
    const light = new THREE.PointLight(st.color, st.intensity, 20, 2);
    light.position.set(wx - dir.dc * 0.7, y - 0.3, wz - dir.dr * 0.7);
    group.add(light);
    out.push(light);
  }
  return out;
}

const ICONS = {
  gravity(g, x, y) {
    g.strokeStyle = '#23262a';
    g.fillStyle = '#23262a';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(x, y + 60, 70, Math.PI, 0);
    g.stroke();
    g.beginPath();
    g.moveTo(x, y - 110);
    g.lineTo(x, y - 10);
    g.stroke();
    g.beginPath();
    g.moveTo(x - 22, y - 30);
    g.lineTo(x + 22, y - 30);
    g.lineTo(x, y);
    g.fill();
    g.font = `600 26px "IBM Plex Sans KR", sans-serif`;
    g.fillText('W = mg', x + 40, y - 60);
  },
  elastic(g, x, y) {
    g.strokeStyle = '#23262a';
    g.lineWidth = 6;
    g.beginPath();
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const px = x - 120 + t * 200;
      const py = y + Math.sin(t * Math.PI * 12) * 34;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = '#23262a';
    g.fillRect(x - 160, y - 60, 30, 120);
    g.fillRect(x + 80, y - 26, 60, 52);
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x + 150, y);
    g.lineTo(x + 200, y);
    g.stroke();
  },
  resultant(g, x, y) {
    const arrow = (x0, y0, len, w) => {
      g.lineWidth = w;
      g.strokeStyle = '#23262a';
      g.fillStyle = '#23262a';
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + len - 22, y0);
      g.stroke();
      g.beginPath();
      g.moveTo(x0 + len, y0);
      g.lineTo(x0 + len - 28, y0 - 16);
      g.lineTo(x0 + len - 28, y0 + 16);
      g.fill();
    };
    arrow(x - 170, y - 50, 160, 6);
    arrow(x, y - 50, 110, 6);
    arrow(x - 170, y + 50, 280, 10);
  },
  friction(g, x, y) {
    g.fillStyle = '#23262a';
    g.fillRect(x - 60, y - 40, 120, 80);
    g.fillRect(x - 180, y + 42, 360, 8);
    g.lineWidth = 6;
    g.strokeStyle = '#23262a';
    g.beginPath();
    g.moveTo(x + 70, y);
    g.lineTo(x + 170, y);
    g.stroke();
    g.beginPath();
    g.moveTo(x - 70, y + 20);
    g.lineTo(x - 150, y + 20);
    g.stroke();
  },
};

const POSTER_TOPICS = {
  gravity: { title: '중력', icon: ICONS.gravity, lines: ['지구 중심 방향으로 당기는 힘', '크기 = 무게 (단위 N)', '1 kg의 무게 ≈ 9.8 N'] },
  elastic: { title: '탄성력', icon: ICONS.elastic, lines: ['원래 형태로 복원하려는 힘', '변형시킨 힘의 반대 방향', '변형이 클수록 커짐'] },
  resultant: { title: '합력', icon: ICONS.resultant, lines: ['같은 방향: 크기를 더함', '반대 방향: 큰 힘 − 작은 힘', '방향은 큰 힘 쪽'] },
  friction: { title: '마찰력', icon: ICONS.friction, lines: ['운동을 방해하는 힘', '운동 방향의 반대', '거칠수록·무거울수록 커짐'] },
};

// 맵 정의(map.def.decor)에 적힌 교범 포스터·스프레이 표시를 붙임
function addDecor(group, map) {
  const decor = map.def.decor ?? {};
  const posters = decor.posters;
  if (posters) {
    const faceZ = map.originZ + posters.faceRow * CELL + 0.03;
    posters.topics.forEach((key, i) => {
      const p = { no: i + 1, ...POSTER_TOPICS[key] };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.65), new THREE.MeshStandardMaterial({ map: posterTexture(p), roughness: 0.45, metalness: 0 }));
      m.position.set(map.originX + posters.cols[i] * CELL, 1.9, faceZ);
      m.receiveShadow = true;
      group.add(m);
    });
  }
  for (const s of decor.signs ?? []) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.1),
      new THREE.MeshStandardMaterial({ map: sprayTexture(s.text, s.sub), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const off = 0.03;
    m.position.set(map.originX + s.x * CELL + Math.sin(s.rotY) * off, 2.4, map.originZ + s.z * CELL + Math.cos(s.rotY) * off);
    m.rotation.y = s.rotY;
    m.receiveShadow = true;
    group.add(m);
  }
}

// 맵 밖: 어두운 공장 건물 실루엣
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
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 4; y < 128; y += 12) {
    for (let x = 4; x < 64; x += 12) {
      if (rnd() < 0.08) {
        wg.fillStyle = rnd() < 0.8 ? '#ffb35c' : '#cfe0ff';
        wg.fillRect(x, y, 5, 4);
      }
    }
  }
  const winTex = new THREE.CanvasTexture(winCanvas);
  winTex.colorSpace = THREE.SRGBColorSpace;
  winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
  winTex.repeat.set(2, 3);
  const mat = new THREE.MeshStandardMaterial({ color: '#111418', roughness: 0.95, emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: 0.6 });
  const count = 40;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const R = Math.max(map.width, map.depth) * 0.75;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.sin(i * 12.9) * 0.05;
    const r = R + 18 + ((i * 37) % 50);
    const w = 14 + ((i * 13) % 20), d = 10 + ((i * 7) % 14), h = 10 + ((i * 29) % 30);
    m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(w, h, d));
    mesh.setMatrixAt(i, m);
  }
  g.add(mesh);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  g.add(ground);
  return g;
}
