import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from '../sim/constants.js';
import { TILES, STORY, KIND } from '../sim/map.js';
import { grateTexture, museumTextures, posterTexture, siteDecal, sprayTexture } from './textures.js';
import { buildLabProps, buildMuseumProps } from './exhibits.js';
import { puddleRoughness } from './weather.js';
import { buildStructure, shadeFn } from './structure.js';

export const SITE_COLORS = { A: '#d9b45a', B: '#b9a0d8' };

const LAMP_STYLE = {
  sodium: { color: '#ffb35c', intensity: 30, lens: '#ffd39a' },
  fluo: { color: '#cfe0ff', intensity: 14, lens: '#dfe8f6' },
  warm: { color: '#ffd7a6', intensity: 22, lens: '#fff0dc' }, // 전시관 조명
};

// 맵(글자 격자)을 3D 메쉬로 만든다.
export function buildWorld(map, baseTex) {
  const group = new THREE.Group();
  group.name = 'world';
  // 맵 테마: 'industrial'(포스 바운드: 콘크리트·상자) / 'museum'(과학관: 광택 타일·전시물)
  const museum = map.def.theme === 'museum';
  const tex = museum ? { ...baseTex, ...museumTextures() } : baseTex;

  // 비가 오면 모든 표면이 젖어 어둡고 매끈해짐 (등불이 바닥에 번져 반사)
  const wet = map.weather === 'rain' || map.weather === 'wet';
  // 밝은 낮 조명 맵: 질감은 그대로 두고 표면 색을 밝게 (색 값 1 이상 = 질감을 밝힘)
  const day = map.def.light === 'day' || map.def.light === 'museum';
  const bright = (r, g, b) => new THREE.Color().setRGB(r, g, b);

  // ── 바닥
  tex.floor.repeat.set(map.width / 4, map.depth / 4);
  tex.floorBump.repeat.set(map.width / 4, map.depth / 4);
  // 물웅덩이는 바닥 재질의 거칠기 지도로 표현 (웅덩이 = 매끈해서 등불이 길게 비침). 바닥을 한 번만 그림
  let puddles = null;
  if (wet) {
    puddles = puddleRoughness(map.width + map.depth);
    puddles.repeat.set(map.width / 18, map.depth / 18);
  }
  const floorMat = new THREE.MeshStandardMaterial({
    map: tex.floor,
    bumpMap: tex.floorBump,
    bumpScale: museum ? 0.6 : 1.2,
    roughness: museum ? 0.4 : wet ? 0.7 : 0.9,
    roughnessMap: puddles,
    metalness: 0.02,
    color: day ? (museum ? bright(0.9, 0.88, 0.85) : bright(1.45, 1.43, 1.4)) : museum ? '#7f7c76' : wet ? '#868c94' : '#ffffff',
  });
  withFloorMarkings(floorMat, buildFloorMarkings(map), buildFloorShade(map, museum));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // ── 건물: 벽(1·2층)·창문·2층 바닥판·난간·지붕·계단 (맵의 막힌 높이 구간 그대로, 보이는 면만)
  const worldTex = (t, k = 1) => {
    const c = t.clone();
    c.repeat.set(k, k);
    c.needsUpdate = true;
    return c;
  };
  const V = { vertexColors: true };
  const wallMat = new THREE.MeshStandardMaterial({
    ...V,
    map: tex.wall,
    bumpMap: tex.wallBump,
    bumpScale: museum ? 0.8 : 2.0,
    roughness: museum ? 0.82 : wet ? 0.74 : 0.93,
    metalness: 0.02,
    color: day ? (museum ? bright(0.96, 0.94, 0.9) : bright(1.75, 1.7, 1.62)) : museum ? '#a19d96' : wet ? '#a7acb3' : '#ffffff',
  });
  const floorCol = day ? (museum ? bright(0.9, 0.88, 0.85) : bright(1.45, 1.43, 1.4)) : museum ? '#7f7c76' : wet ? '#868c94' : '#ffffff';
  const slabTex = worldTex(tex.floor);
  const mats = {
    wall: wallMat,
    wallTop: new THREE.MeshStandardMaterial({ ...V, map: tex.wallTop, roughness: 0.7, metalness: day ? 0.1 : 0.5, color: day ? bright(1.5, 1.48, 1.44) : '#ffffff' }),
    ceil: museum
      ? new THREE.MeshStandardMaterial({ ...V, color: '#c4beb2', roughness: 0.92 })
      : new THREE.MeshStandardMaterial({ ...V, map: worldTex(tex.floor), roughness: 0.95, color: day ? bright(1.3, 1.28, 1.25) : '#8e9196' }),
    slabTop: new THREE.MeshStandardMaterial({ ...V, map: slabTex, bumpMap: worldTex(tex.floorBump), bumpScale: museum ? 0.6 : 1.2, roughness: museum ? 0.4 : 0.9, metalness: 0.02, color: floorCol }),
    grate: new THREE.MeshStandardMaterial({ ...V, map: grateTexture(), roughness: 0.55, metalness: 0.65, color: day ? bright(1.6, 1.6, 1.6) : '#c8ccd0' }),
    edge: new THREE.MeshStandardMaterial({ ...V, map: tex.wall, roughness: 0.9, color: museum ? '#d9d4c9' : day ? bright(1.4, 1.38, 1.34) : '#b7b9bc' }),
    edgeSteel: new THREE.MeshStandardMaterial({ ...V, color: '#4b5157', roughness: 0.5, metalness: 0.7 }),
    rail: museum
      ? new THREE.MeshStandardMaterial({ color: '#8f7442', roughness: 0.35, metalness: 0.8 })
      : new THREE.MeshStandardMaterial({ color: '#3b4046', roughness: 0.55, metalness: 0.6 }),
    railTop: museum
      ? new THREE.MeshStandardMaterial({ color: '#7a5f45', roughness: 0.45 })
      : new THREE.MeshStandardMaterial({ color: '#d0a62a', roughness: 0.45, metalness: 0.35 }),
    railGlass: new THREE.MeshStandardMaterial({ color: '#cfe3ec', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false }),
    roofTop: new THREE.MeshStandardMaterial({ ...V, color: '#3d4044', roughness: 0.95 }),
    tread: new THREE.MeshStandardMaterial({ ...V, map: slabTex, roughness: museum ? 0.35 : 0.85, color: museum ? bright(1.08, 1.06, 1.02) : floorCol }),
    nosing: museum
      ? new THREE.MeshStandardMaterial({ ...V, color: '#b48a3e', roughness: 0.3, metalness: 0.85 })
      : new THREE.MeshStandardMaterial({ ...V, color: '#d0a62a', roughness: 0.6, metalness: 0.1 }),
  };
  group.add(buildStructure(map, mats, { museum }));

  // ── 상자들 (같은 종류끼리 인스턴스로 그려서 가볍게)
  const kinds = museum ? {} : {
    crate: { tex: tex.crate, top: '#3f432c', rough: 0.85, metal: 0.05, inset: 0.92 },
    bigCrate: { tex: tex.container, top: '#2b373c', rough: 0.6, metal: 0.55, inset: 0.98 },
    barrier: { tex: tex.barrier, top: '#77776f', rough: 0.95, metal: 0.0, inset: 0.96 },
  };
  // 과학관: 상자 대신 전시물 (진열장·키오스크·수조·전시 탁자·푸코 진자)
  if (museum) {
    const props = buildMuseumProps(map, posterAtlas());
    group.add(props);
    group.userData.tick = props.userData.tick;
  } else if (map.def.decor?.labProps) group.add(buildLabProps(map));
  const shade = shadeFn(map, museum);
  for (const [kind, style] of Object.entries(kinds)) {
    // 1층·2층 바닥 위의 상자 (map.props: 칸·높이)
    const cells = map.props.filter((p) => p.kind === kind).map(({ c, r, y }) => [c, r, y]);
    if (!cells.length) continue;
    const h = Object.values(TILES).find((t) => t.kind === kind).h;
    const geo = new THREE.BoxGeometry(CELL * style.inset, h, CELL * style.inset);
    geo.translate(0, h / 2, 0);
    const rough = wet ? style.rough * 0.6 : style.rough;
    const side = new THREE.MeshStandardMaterial({ map: style.tex, roughness: rough, metalness: style.metal, color: day ? bright(1.6, 1.55, 1.5) : wet ? '#b3b7bc' : '#ffffff' });
    const top = new THREE.MeshStandardMaterial({ color: style.top, roughness: wet ? 0.25 : style.rough, metalness: style.metal });
    const mesh = new THREE.InstancedMesh(geo, [side, side, top, top, side, side], cells.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    cells.forEach(([c, r, y], i) => {
      const rot = ((c * 7 + r * 13) % 4) * (Math.PI / 2);
      m.makeRotationY(kind === 'bigCrate' ? 0 : rot);
      m.setPosition(map.cellX(c), y, map.cellZ(r));
      mesh.setMatrixAt(i, m);
      // 실내(지붕·2층 바닥 아래)의 상자는 조금 어둡게
      const k = shade(c, r, y + h + 0.05);
      mesh.setColorAt(i, col.setRGB(k, k, k));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ── 구역 글자 (바닥 페인트)
  for (const b of map.bombs) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshStandardMaterial({ map: siteDecal(b.id, museum ? '#2b3a52' : '#d8d2bf'), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(b.x + 4.2, 0.02, b.z + 3.5);
    decal.receiveShadow = true;
    group.add(decal);
  }

  const lamps = addLamps(group, map);
  addDecor(group, map, museum);
  group.add(buildSkyline(map, day));
  group.userData.lamps = lamps;
  return group;
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
  return t;
}

// 구역 선(바닥 표시)을 바닥 재질 안에서 섞음 — 맵 전체를 덮는 반투명 층을 따로 그리지 않음
// 실내 그늘(shade: 칸마다 한 픽셀, 부드럽게 보간)도 같이 곱함
function withFloorMarkings(mat, marks, shade) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.markMap = { value: marks };
    sh.uniforms.shadeMap = { value: shade };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMarkUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarkUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D markMap;\nuniform sampler2D shadeMap;\nvarying vec2 vMarkUv;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\nvec4 mk = texture2D(markMap, vMarkUv);\ndiffuseColor.rgb = mix(diffuseColor.rgb, mk.rgb, mk.a);\ndiffuseColor.rgb *= texture2D(shadeMap, vMarkUv).r;',
      );
  };
  mat.customProgramCacheKey = () => 'floorMarks';
  return mat;
}

// 1층 바닥의 실내 그늘 지도 (지붕 아래·2층 바닥 아래는 어둡게)
function buildFloorShade(map, museum) {
  const shade = shadeFn(map, museum);
  const c = document.createElement('canvas');
  c.width = map.cols;
  c.height = map.rows;
  const g = c.getContext('2d');
  for (let r = 0; r < map.rows; r++) {
    for (let col = 0; col < map.cols; col++) {
      const v = Math.round(Math.min(1, shade(col, r, 0.1)) * 255);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(col, r, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

// 빛 웅덩이·후광용 방사형 그라데이션
let glowTex = null;
function radialGlow() {
  if (glowTex) return glowTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// 벽에 등을 달고, 광원 정보(LightRig가 가까운 등에만 실제 점광원을 배정)와
// 실제 광원이 없을 때 대신 보일 빛 웅덩이(바닥·벽)·렌즈 후광을 만든다.
function addLamps(group, map) {
  const sources = [];
  const housingMat = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.6, metalness: 0.6 });
  const fixM = new THREE.Matrix4();
  const housings = [];
  const lenses = {};
  const pool = { pos: [], uv: [], col: [], index: [] };
  const halo = { pos: [], col: [] };
  const quad = (center, ux, uy, w, h, color) => {
    const base = pool.pos.length / 3;
    for (const [sx, sy, u, v] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      pool.pos.push(center.x + ux.x * sx * w / 2 + uy.x * sy * h / 2, center.y + ux.y * sx * w / 2 + uy.y * sy * h / 2, center.z + ux.z * sx * w / 2 + uy.z * sy * h / 2);
      pool.uv.push(u, v);
      pool.col.push(color.r, color.g, color.b);
    }
    pool.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const lamp of map.def.decor?.lamps ?? []) {
    const st = LAMP_STYLE[lamp.kind];
    // 등 높이: 2층(f: 1)은 2층 바닥 위, 1층은 위에 2층 바닥이 있으면 그 아래
    const floorY = lamp.f ? STORY : 0;
    let y = floorY + 3.7;
    for (const [y0] of map.spansAt(lamp.c, lamp.r)) if (y0 > floorY + 0.5 && y0 - 0.35 < y) y = y0 - 0.35;
    // 그 높이에 벽이 있는 가장 가까운 칸 쪽으로
    const solidAt = (c, r) => map.spansAt(c, r).some(([y0, y1, k]) => (k === KIND.wall || k === KIND.lintel) && y0 <= y + 0.2 && y1 >= y + 0.2);
    let dir = null;
    for (let d = 1; d <= 3 && !dir; d++) {
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (solidAt(lamp.c + dc * d, lamp.r + dr * d)) {
          dir = { dc, dr, d };
          break;
        }
      }
    }
    if (!dir) dir = { dc: 0, dr: -1, d: 1 };
    const cx = map.cellX(lamp.c), cz = map.cellZ(lamp.r);
    // 벽면 위치 = 셀 중심에서 벽 쪽으로 (d-0.5)칸
    const wx = cx + dir.dc * (dir.d - 0.5) * CELL, wz = cz + dir.dr * (dir.d - 0.5) * CELL;
    // 등 몸체·렌즈는 모든 등을 합쳐 재질별로 한 번씩 그림
    fixM.compose(new THREE.Vector3(wx - dir.dc * 0.12, y, wz - dir.dr * 0.12), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dir.dc, -dir.dr)), new THREE.Vector3(1, 1, 1));
    housings.push(new THREE.BoxGeometry(lamp.kind === 'fluo' ? 1.3 : 0.5, 0.22, 0.24).applyMatrix4(fixM));
    (lenses[lamp.kind] ??= []).push(new THREE.BoxGeometry(lamp.kind === 'fluo' ? 1.2 : 0.38, 0.06, 0.18).translate(0, -0.12, 0.02).applyMatrix4(fixM));
    const color = new THREE.Color(st.color);
    const src = { pos: new THREE.Vector3(wx - dir.dc * 0.7, y - 0.3, wz - dir.dr * 0.7), color, intensity: st.intensity, distance: 20, poolStart: pool.col.length };
    sources.push(src);
    // 바닥 빛 웅덩이 (등에서 벽 반대쪽으로 조금 나간 곳이 가장 밝음) + 등 주변 벽
    const out = new THREE.Vector3(-dir.dc, 0, -dir.dr);
    const side = new THREE.Vector3(-out.z, 0, out.x);
    const k = lamp.kind === 'fluo' ? 0.2 : 0.34;
    quad(new THREE.Vector3(wx + out.x * 2.2, floorY + 0.025, wz + out.z * 2.2), side, out, 10, 10, color.clone().multiplyScalar(k));
    quad(new THREE.Vector3(wx + out.x * 0.04, y - 0.8, wz + out.z * 0.04), side, new THREE.Vector3(0, 1, 0), 6, 5.6, color.clone().multiplyScalar(k * 0.8));
    src.poolEnd = pool.col.length;
    const lc = new THREE.Color(st.lens);
    halo.pos.push(wx - dir.dc * 0.18, y - 0.13, wz - dir.dr * 0.18);
    halo.col.push(lc.r * 0.55, lc.g * 0.55, lc.b * 0.55);
  }
  if (housings.length) {
    const hm = new THREE.Mesh(mergeGeometries(housings), housingMat);
    hm.castShadow = true;
    group.add(hm);
    for (const [kind, list] of Object.entries(lenses)) {
      const st = LAMP_STYLE[kind];
      group.add(new THREE.Mesh(mergeGeometries(list), new THREE.MeshStandardMaterial({ color: st.lens, emissive: st.lens, emissiveIntensity: 2.6 })));
    }
  }
  // 빛 웅덩이 전체가 한 번에 그려짐 (실제 광원이 배정된 등은 LightRig 가중치만큼 흐려짐)
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pool.pos, 3));
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(pool.uv, 2));
  const baseCol = new Float32Array(pool.col);
  pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pool.col), 3));
  pg.setIndex(pool.index);
  const pools = new THREE.Mesh(
    pg,
    new THREE.MeshBasicMaterial({ map: radialGlow(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  pools.name = 'lampPools';
  pools.renderOrder = 2;
  group.add(pools);
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(halo.pos, 3));
  hg.setAttribute('color', new THREE.Float32BufferAttribute(halo.col, 3));
  // 후광: 실제 크기(지름 약 1m)로 보이되 화면에서 최대 72px, 가까이 가면 사라짐 (바로 앞의 등이 화면을 덮지 않게)
  const halos = new THREE.Points(
    hg,
    new THREE.ShaderMaterial({
      uniforms: { map: { value: radialGlow() }, uPixel: { value: 600 } },
      vertexShader: /* glsl */ `
        uniform float uPixel;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(1.0 * uPixel / d, 2.0, 72.0);
          vFade = smoothstep(3.0, 9.0, d);
          vColor = color;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor * t.a * vFade, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halos.name = 'lampHalos';
  group.add(halos);
  // 실제 광원 가중치(realW)에 맞춰 빛 웅덩이 밝기 갱신
  const colAttr = pg.attributes.color;
  const last = sources.map(() => -1);
  const syncPools = () => {
    let dirty = false;
    sources.forEach((src, i) => {
      const f = 1 - 0.8 * (src.realW ?? 0);
      if (Math.abs(f - last[i]) < 0.02) return;
      last[i] = f;
      for (let j = src.poolStart; j < src.poolEnd; j++) colAttr.array[j] = baseCol[j] * f;
      dirty = true;
    });
    if (dirty) colAttr.needsUpdate = true;
  };
  return { sources, pools, halos, syncPools };
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
  buoyancy(g, x, y) {
    g.fillStyle = 'rgba(47,111,181,0.25)';
    g.fillRect(x - 170, y - 10, 340, 110);
    g.strokeStyle = '#23262a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x - 170, y - 10);
    g.lineTo(x + 170, y - 10);
    g.stroke();
    g.fillStyle = '#23262a';
    g.fillRect(x - 45, y - 50, 90, 80);
    const arrow = (x0, y0, dy) => {
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0, y0 + dy);
      g.stroke();
      g.beginPath();
      const s = Math.sign(dy);
      g.moveTo(x0, y0 + dy + s * 18);
      g.lineTo(x0 - 14, y0 + dy);
      g.lineTo(x0 + 14, y0 + dy);
      g.fill();
    };
    arrow(x + 90, y + 60, -110);
    arrow(x - 90, y - 70, 110);
    g.font = `600 24px "IBM Plex Sans KR", sans-serif`;
    g.fillText('부력', x + 108, y - 40);
    g.fillText('중력', x - 160, y + 60);
  },
  weight(g, x, y) {
    g.strokeStyle = '#23262a';
    g.fillStyle = '#23262a';
    g.lineWidth = 5;
    g.fillRect(x - 60, y - 120, 120, 12);
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const px = x + Math.sin(t * Math.PI * 14) * 22;
      const py = y - 108 + t * 120;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.fillRect(x - 40, y + 14, 80, 70);
    g.font = `600 24px "IBM Plex Sans KR", sans-serif`;
    g.fillText('1 kg → 9.8 N', x + 60, y - 30);
  },
  equilibrium(g, x, y) {
    g.fillStyle = '#23262a';
    g.strokeStyle = '#23262a';
    g.fillRect(x - 50, y - 40, 100, 80);
    g.lineWidth = 6;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + s * 55, y);
      g.lineTo(x + s * 160, y);
      g.stroke();
      g.beginPath();
      g.moveTo(x + s * 180, y);
      g.lineTo(x + s * 155, y - 15);
      g.lineTo(x + s * 155, y + 15);
      g.fill();
    }
    g.font = `600 26px "IBM Plex Sans KR", sans-serif`;
    g.fillText('합력 = 0', x - 52, y - 70);
  },
  action(g, x, y) {
    g.fillStyle = '#23262a';
    g.strokeStyle = '#23262a';
    g.fillRect(x - 150, y - 40, 110, 80);
    g.fillRect(x + 40, y - 40, 110, 80);
    g.lineWidth = 6;
    const arrow = (x0, dir) => {
      g.beginPath();
      g.moveTo(x0, y + 70);
      g.lineTo(x0 + dir * 90, y + 70);
      g.stroke();
      g.beginPath();
      g.moveTo(x0 + dir * 108, y + 70);
      g.lineTo(x0 + dir * 86, y + 56);
      g.lineTo(x0 + dir * 86, y + 84);
      g.fill();
    };
    arrow(x - 20, 1);
    arrow(x + 20, -1);
    g.font = `600 26px "IBM Plex Sans KR", sans-serif`;
    g.fillText('작용 = 반작용', x - 80, y - 70);
  },
};

const POSTER_TOPICS = {
  gravity: { title: '중력', icon: ICONS.gravity, lines: ['지구 중심 방향으로 당기는 힘', '크기 = 무게 (단위 N)', '1 kg의 무게 ≈ 9.8 N'] },
  elastic: { title: '탄성력', icon: ICONS.elastic, lines: ['원래 형태로 복원하려는 힘', '변형시킨 힘의 반대 방향', '변형이 클수록 커짐'] },
  resultant: { title: '합력', icon: ICONS.resultant, lines: ['같은 방향: 크기를 더함', '반대 방향: 큰 힘 − 작은 힘', '방향은 큰 힘 쪽'] },
  friction: { title: '마찰력', icon: ICONS.friction, lines: ['운동을 방해하는 힘', '운동 방향의 반대', '거칠수록·무거울수록 커짐'] },
  buoyancy: { title: '부력', icon: ICONS.buoyancy, lines: ['액체·기체가 위로 밀어 올리는 힘', '중력과 반대 방향', '공기 중 무게 − 물속 무게'] },
  weight: { title: '무게와 질량', icon: ICONS.weight, lines: ['무게 = 중력의 크기 (N)', '질량 = 물체의 고유한 양 (kg)', '달에서 무게 1/6, 질량 그대로'] },
  equilibrium: { title: '힘의 평형', icon: ICONS.equilibrium, lines: ['합력이 0인 상태', '크기 같고 방향 반대', '같은 직선 위에 작용'] },
  action: { title: '작용과 반작용', icon: ICONS.action, lines: ['서로 주고받는 두 힘', '크기 같고 방향 반대', '서로 다른 물체에 작용'] },
};
const ATLAS_TOPICS = ['gravity', 'elastic', 'resultant', 'friction', 'buoyancy', 'weight', 'equilibrium', 'action'];

// 과학관 전시 설명판 8종을 한 장(가로 4 × 세로 2)에 모음 → 키오스크·전시 탁자가 한 번에 그려짐
let atlasCache = null;
function posterAtlas() {
  if (atlasCache) return atlasCache;
  const W = 512, H = 704, cols = 4, rows = 2;
  const c = document.createElement('canvas');
  c.width = W * cols;
  c.height = H * rows;
  const g = c.getContext('2d');
  ATLAS_TOPICS.forEach((key, i) => {
    const img = posterTexture({ no: i + 1, ...POSTER_TOPICS[key], museum: true }, { canvasOnly: true });
    g.drawImage(img, (i % cols) * W, Math.floor(i / cols) * H);
  });
  const atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  atlasCache = { atlas, panelCount: ATLAS_TOPICS.length };
  return atlasCache;
}

// 맵 정의(map.def.decor)에 적힌 교범 포스터·스프레이 표시를 붙임
function addDecor(group, map, museum = false) {
  const decor = map.def.decor ?? {};
  // 포스터: 한 줄로 붙인 것(posters) + 자리마다 지정한 것(posterList: 칸 좌표 c·r = 벽면 경계, rotY = 바라보는 방향)
  const list = [];
  const posters = decor.posters;
  if (posters) posters.topics.forEach((topic, i) => list.push({ c: posters.cols[i], r: posters.faceRow, rotY: 0, topic }));
  for (const p of decor.posterList ?? []) list.push(p);
  list.forEach(({ c, r, rotY, topic, f }, i) => {
    const p = { no: i + 1, ...POSTER_TOPICS[topic], museum };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.65), new THREE.MeshStandardMaterial({ map: posterTexture(p), roughness: 0.45, metalness: 0 }));
    m.position.set(map.originX + c * CELL + Math.sin(rotY) * 0.03, (f ? STORY : 0) + 1.9, map.originZ + r * CELL + Math.cos(rotY) * 0.03);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    group.add(m);
  });
  for (const s of decor.signs ?? []) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.1),
      new THREE.MeshStandardMaterial({ map: sprayTexture(s.text, s.sub), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const off = 0.03;
    m.position.set(map.originX + s.x * CELL + Math.sin(s.rotY) * off, (s.f ? STORY : 0) + 2.4, map.originZ + s.z * CELL + Math.cos(s.rotY) * off);
    m.rotation.y = s.rotY;
    m.receiveShadow = true;
    group.add(m);
  }
}

// 맵 밖: 어두운 공장 건물 실루엣
function buildSkyline(map, day = false) {
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
  // 낮에는 창문 불빛 없이 밝은 회색 건물
  const mat = day
    ? new THREE.MeshStandardMaterial({ color: '#9aa6b2', roughness: 0.9 })
    : new THREE.MeshStandardMaterial({ color: '#111418', roughness: 0.95, emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: 0.6 });
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
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshStandardMaterial({ color: day ? '#6c6a64' : '#16181b', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  g.add(ground);
  return g;
}
