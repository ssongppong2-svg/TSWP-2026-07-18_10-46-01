// 새 맵 테마의 하늘·원경 (맵 밖): 달 기지 · 우주 화물선 · 거대한 새의 둥지
//   맵 가운데를 기준으로 멀리 둘러 놓음. 안개를 받지 않게(fog: false) 해서 멀어도 또렷
import * as THREE from 'three';

export function buildThemeBackdrop(map, theme) {
  const g = new THREE.Group();
  g.name = `backdrop-${theme}`;
  const R = Math.max(map.width, map.depth);
  if (theme === 'moon') {
    g.add(stars(2600, 520, 11));
    g.add(planet({ radius: 46, dir: [-0.55, 0.32, -0.77], dist: 470, kind: 'earth' }));
    g.add(ridges(R * 0.62 + 40, '#8a8986', 21, 18));
    g.add(ridges(R * 0.62 + 120, '#6a6966', 37, 34));
    g.add(moonProps(map));
  } else if (theme === 'ship') {
    g.add(stars(3200, 520, 23));
    g.add(nebula(560));
    g.add(planet({ radius: 120, dir: [0.62, -0.18, -0.76], dist: 480, kind: 'giant' }));
  } else if (theme === 'nest') {
    g.add(cloudSea(R));
    g.add(treeBranches(map));
    g.add(giantBird(map));
  }
  return g;
}

const noFog = (m) => {
  m.fog = false;
  return m;
};

// 별: 큰 구 위에 흩어진 점 (밝기·색 조금씩 다르게)
function stars(n, r, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, k = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * k * r, Math.abs(u) * r * 0.95 + r * 0.02 * (rnd() - 0.3), Math.sin(a) * k * r], i * 3);
    const b = 0.45 + rnd() ** 3 * 0.9, t = rnd();
    col.set([b * (t < 0.2 ? 1 : 0.85), b * 0.9, b * (t > 0.8 ? 1.1 : 0.95)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(geo, noFog(new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false })));
  p.frustumCulled = false;
  p.renderOrder = -10;
  return p;
}

// 행성: 지구(바다·대륙·구름) · 고리를 두른 가스 행성
function planet({ radius, dir, dist, kind }) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  if (kind === 'earth') {
    // 바다·대륙·구름을 잡음으로 (경계가 자연스럽게) · 극지방은 얼음
    const img = g.createImageData(512, 256);
    const h = (x, y) => {
      const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const vn = (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const w = (xx) => ((xx % 16) + 16) % 16; // 가로로 이어지게
      const a0 = h(w(ix), iy), a1 = h(w(ix + 1), iy), b0 = h(w(ix), iy + 1), b1 = h(w(ix + 1), iy + 1);
      return a0 + (a1 - a0) * sx + (b0 - a0) * sy + (a0 - a1 - b0 + b1) * sx * sy;
    };
    const fbm = (x, y, o = 5) => {
      let v = 0, amp = 0.5, f = 1;
      for (let i = 0; i < o; i++) {
        v += amp * vn(x * f + i * 3.1, y * f + i * 1.7);
        f *= 2;
        amp *= 0.5;
      }
      return v;
    };
    for (let y = 0; y < 256; y++) {
      const lat = Math.abs(y / 128 - 1);
      for (let x = 0; x < 512; x++) {
        const u = x / 32, v = y / 32;
        const land = fbm(u, v) - 0.04 * (1 - lat);
        const cloud = fbm(u * 1.7 + 9, v * 2.4 + 3, 4);
        let r = 22, gg = 64, b = 138; // 바다
        if (land > 0.52) {
          const dry = fbm(u * 2 + 20, v * 2, 3);
          r = dry > 0.52 ? 150 : 72;
          gg = dry > 0.52 ? 130 : 108;
          b = dry > 0.52 ? 92 : 58;
        } else if (land > 0.49) {
          r = 40; gg = 110; b = 160; // 얕은 바다
        }
        if (lat > 0.84) r = gg = b = 236; // 극지방 얼음
        const c = Math.max(0, Math.min(1, (cloud - 0.5) * 3.2));
        const i = (y * 512 + x) * 4;
        img.data[i] = r + (250 - r) * c;
        img.data[i + 1] = gg + (252 - gg) * c;
        img.data[i + 2] = b + (255 - b) * c;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  } else {
    for (let y = 0; y < 256; y++) {
      const v = Math.sin(y * 0.11) * 0.5 + Math.sin(y * 0.031 + 1) * 0.5;
      g.fillStyle = `rgb(${160 + v * 40},${120 + v * 30},${110 + v * 40})`;
      g.fillRect(0, y, 512, 1);
    }
    g.fillStyle = 'rgba(220,170,140,0.6)';
    g.beginPath();
    g.ellipse(340, 150, 34, 16, 0, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const grp = new THREE.Group();
  const d = new THREE.Vector3(...dir).normalize().multiplyScalar(dist);
  grp.position.copy(d);
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), noFog(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: kind === 'earth' ? 0.05 : 0.12 })));
  body.rotation.z = 0.35;
  grp.add(body);
  // 대기 테두리 빛
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.04, 48, 32),
    noFog(new THREE.MeshBasicMaterial({ color: kind === 'earth' ? '#6fb4ff' : '#ffb98a', transparent: true, opacity: 0.18, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })),
  );
  grp.add(halo);
  if (kind === 'giant') {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.35, radius * 2.1, 96),
      noFog(new THREE.MeshBasicMaterial({ color: '#d8c0a0', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })),
    );
    ring.rotation.set(Math.PI / 2 - 0.35, 0.2, 0);
    grp.add(ring);
  }
  grp.lookAt(0, 0, 0);
  return grp;
}

// 성운: 큰 판 몇 장에 흐린 보랏빛·푸른빛 구름
function nebula(r) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (const [x, y, rad, col] of [[90, 120, 110, 'rgba(150,90,255,0.35)'], [170, 100, 90, 'rgba(60,160,255,0.28)'], [130, 170, 70, 'rgba(255,90,160,0.22)']]) {
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, col);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.4, r * 1.4), noFog(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  m.position.set(-r * 0.6, r * 0.35, r * 0.65);
  m.lookAt(0, 0, 0);
  m.renderOrder = -9;
  return m;
}

// 먼 산등성이 고리 (달의 고지대): 들쭉날쭉한 봉우리 · 꼭대기는 햇빛에 밝고 아래는 어둡게
function ridges(radius, color, seed, hMax) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const seg = 120;
  const pos = [];
  const col = [];
  const hs = [];
  for (let i = 0; i <= seg; i++) hs.push(4 + rnd() * hMax * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.21 + seed))));
  hs[seg] = hs[0];
  const base = new THREE.Color(color);
  const lo = base.clone().multiplyScalar(0.45), hi = base.clone().multiplyScalar(1.25);
  const push = (x, y, z, c) => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius, x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
    push(x0, -2, z0, lo);
    push(x1, -2, z1, lo);
    push(x1, hs[i + 1], z1, hi);
    push(x0, -2, z0, lo);
    push(x1, hs[i + 1], z1, hi);
    push(x0, hs[i], z0, hi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, flatShading: true }));
}

// 달 기지 바깥 소품: 통신 안테나 · 착륙선 다리
function moonProps(map) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#e8eaec', roughness: 0.5, metalness: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: '#c9a03a', roughness: 0.35, metalness: 0.8 });
  const R = Math.max(map.width, map.depth) * 0.62 + 30;
  // 기지 벽 너머로도 보이게 크게 (멀리 있는 큰 구조물)
  // 접시 안테나 (북동쪽)
  const dish = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.3, 26, 10), white);
  mast.position.y = 13;
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(11, 24, 12, 0, Math.PI * 2, 0, 0.9), new THREE.MeshStandardMaterial({ color: '#e8eaec', roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }));
  bowl.position.y = 28;
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 9, 6), white);
  feed.position.set(0, 31, 3.5);
  feed.rotation.x = -0.9;
  bowl.rotation.x = -0.9;
  dish.add(mast, bowl, feed);
  dish.position.set(R * 0.7, 0, -R * 0.7);
  g.add(dish);
  // 착륙선 (남서쪽): 금박 몸통 + 다리 4개
  const lander = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 3, 8), gold);
  body.position.y = 4.5;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.6, 3.6), white);
  cab.position.y = 7.3;
  lander.add(body, cab);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5.5, 6), white);
    leg.position.set(Math.cos(a) * 3.6, 2.4, Math.sin(a) * 3.6);
    leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    lander.add(leg);
  }
  lander.scale.setScalar(2.4);
  lander.position.set(-R * 0.75, 0, R * 0.6);
  g.add(lander);
  return g;
}

// 둥지 아래·주변의 구름 바다 (둥지는 아주 높은 나무 꼭대기)
function cloudSea(R) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, 256, 256);
  let s = 5;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 256, y = rnd() * 256, rad = 10 + rnd() * 34;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  const sea = new THREE.Mesh(new THREE.CircleGeometry(R * 6, 48), new THREE.MeshBasicMaterial({ map: tex, color: '#f4f8ff', transparent: true, opacity: 0.9, depthWrite: false }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -40;
  const under = new THREE.Mesh(new THREE.CircleGeometry(R * 6, 48), new THREE.MeshBasicMaterial({ color: '#cfe2f4' }));
  under.rotation.x = -Math.PI / 2;
  under.position.y = -46;
  const grp = new THREE.Group();
  grp.add(under, sea);
  return grp;
}

// 둥지를 받친 거대한 나무: 둥지 밖으로 뻗은 굵은 가지 + 아래로 내려가는 줄기
function treeBranches(map) {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: '#5e4430', roughness: 0.95 });
  const leaf = new THREE.MeshStandardMaterial({ color: '#4f7a3a', roughness: 0.9, flatShading: true });
  const R = Math.max(map.width, map.depth) * 0.5;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.35, R * 0.55, 60, 16), bark);
  trunk.position.y = -32;
  g.add(trunk);
  let s = 9;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.3;
    const len = R * (0.9 + rnd() * 0.9);
    const br = new THREE.Mesh(new THREE.CylinderGeometry(1.6 + rnd() * 1.5, 3 + rnd() * 2, len, 10), bark);
    br.position.set(Math.cos(a) * (R * 0.75 + len / 2), -3 - rnd() * 10, Math.sin(a) * (R * 0.75 + len / 2));
    br.rotation.set(0, -a, Math.PI / 2 - 0.12 - rnd() * 0.3);
    g.add(br);
    // 가지 끝 잎 덩어리
    const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + rnd() * 6, 1), leaf);
    tuft.position.set(Math.cos(a) * (R * 0.75 + len), -2 - rnd() * 8, Math.sin(a) * (R * 0.75 + len));
    g.add(tuft);
  }
  return g;
}

// 거대한 새: 둥지 북쪽 너머에서 둥지를 내려다보는 머리·목·날개 (몸통은 둥지 밖)
function giantBird(map) {
  const g = new THREE.Group();
  const feather = new THREE.MeshStandardMaterial({ color: '#3d4a66', roughness: 0.75, flatShading: true });
  const featherLight = new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.8, flatShading: true });
  const beakM = new THREE.MeshStandardMaterial({ color: '#e0a23a', roughness: 0.45 });
  const eyeM = new THREE.MeshStandardMaterial({ color: '#111216', roughness: 0.1, metalness: 0.2 });
  const irisM = new THREE.MeshBasicMaterial({ color: '#f2c14a' });
  const D = map.depth / 2 + 46;
  // 몸통 (둥지 북쪽 밖, 아래쪽으로 묻힘)
  const body = new THREE.Mesh(new THREE.SphereGeometry(34, 24, 18), feather);
  body.scale.set(1.3, 0.9, 1);
  body.position.set(0, 6, -D - 18);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(26, 20, 14), featherLight);
  chest.position.set(0, 10, -D + 6);
  // 목과 머리 (둥지를 내려다봄)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(9, 14, 30, 14), feather);
  neck.position.set(0, 34, -D + 2);
  neck.rotation.x = 0.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(13, 20, 14), feather);
  head.position.set(0, 50, -D + 10);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(5, 18, 12), beakM);
  beak.position.set(0, 47, -D + 26);
  beak.rotation.x = Math.PI / 2 + 0.45;
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 10), eyeM);
    eye.position.set(sx * 9.5, 53, -D + 17);
    const iris = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.4, 20), irisM);
    iris.position.copy(eye.position);
    iris.lookAt(eye.position.x * 3, eye.position.y, eye.position.z + 20);
    eyes.push(eye, iris);
  }
  // 날개 (양옆으로 반쯤 편 깃털 판)
  for (const sx of [-1, 1]) {
    const wing = new THREE.Group();
    for (let k = 0; k < 9; k++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(46 - k * 2.5, 1.2, 7), k % 3 ? feather : featherLight);
      f.position.set(sx * (24 + k * 1.5), 30 - k * 4.2, -D - 10 + k * 1.2);
      f.rotation.set(0.1, sx * 0.25, sx * (0.35 + k * 0.05));
      wing.add(f);
    }
    g.add(wing);
  }
  g.add(body, chest, neck, head, beak, ...eyes);
  return g;
}
