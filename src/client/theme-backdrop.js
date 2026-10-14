// 새 맵 테마의 하늘·원경 (맵 밖): 달 기지 · 우주 화물선 · 거대한 세상 (움직이는 원경은 userData.tick)
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
  } else if (theme === 'giant') {
    const city = giantCity(map);
    g.add(city);
    g.userData.tick = city.userData.tick;
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

// ───────────────────────── 거대한 세상 (거인들의 도시) ─────────────────────────
// 거인 크기 ×25: 건물 한 층이 75 m, 자동차 바퀴가 16 m, 사람 키가 40 m

// 거인 건물 벽면: 층마다 큰 유리창(하늘이 비침) · 콘크리트 테 · 몇 개는 불 켜짐
function facadeTexture(seed, tint) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = tint;
  g.fillRect(0, 0, 256, 512);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // 콘크리트 결 · 층 띠
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? 0 : 255},${rnd() < 0.5 ? 0 : 255},${rnd() < 0.5 ? 0 : 255},0.03)`;
    g.fillRect(rnd() * 256, rnd() * 512, 2 + rnd() * 10, 1 + rnd() * 4);
  }
  for (let y = 0; y < 512; y += 128) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, y + 118, 256, 10);
    for (let x = 0; x < 256; x += 128) {
      const lit = rnd() < 0.12;
      // 유리: 위는 하늘빛, 아래는 짙게 (반사) · 창틀 · 가로 창살
      const grd = g.createLinearGradient(x, y, x + 40, y + 110);
      grd.addColorStop(0, lit ? '#fbe8bc' : '#bcd8ee');
      grd.addColorStop(0.55, lit ? '#e6c88a' : '#6a90b4');
      grd.addColorStop(1, lit ? '#c8a060' : '#2c4462');
      g.fillStyle = '#4a4e54';
      g.fillRect(x + 10, y + 12, 108, 100);
      g.fillStyle = grd;
      g.fillRect(x + 14, y + 16, 100, 92);
      g.fillStyle = '#4a4e54';
      g.fillRect(x + 62, y + 16, 4, 92);
      g.fillRect(x + 14, y + 58, 100, 3);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath();
      g.moveTo(x + 14, y + 16);
      g.lineTo(x + 50, y + 16);
      g.lineTo(x + 14, y + 70);
      g.fill();
      // 창 아래 빗물 자국
      g.fillStyle = 'rgba(40,36,30,0.12)';
      g.fillRect(x + 20, y + 112, 6, 14);
      g.fillRect(x + 92, y + 112, 6, 10);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function giantCity(map) {
  const g = new THREE.Group();
  const R = Math.max(map.width, map.depth) * 0.62 + 40;
  let s = 77;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const tints = ['#b8b0a4', '#8e959c', '#c4b49a', '#a0a8b0', '#b49a8a'];
  const mats = tints.map((t, i) => new THREE.MeshStandardMaterial({ map: facadeTexture(500 + i, t), roughness: 0.6, metalness: 0.1 }));
  // 둘레의 거인 건물 (한 변 50~110 m · 높이 180~420 m)
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.15;
    const d = R + 95 + rnd() * 80; // 건물은 바깥 고리 (거인이 걷는 길 바깥)
    const w = 50 + rnd() * 60, dd = 50 + rnd() * 60, h = 180 + rnd() * 240;
    const geo = new THREE.BoxGeometry(w, h, dd);
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 75), uv.getY(k) * (h / 150));
    const b = new THREE.Mesh(geo, mats[i % mats.length]);
    b.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d);
    b.rotation.y = -a;
    g.add(b);
  }
  // 서쪽에 세워 둔 거인 자동차 (맵 쪽으로 옆면): 바퀴 넷 · 문·손잡이·창문이 그려진 차체 · 유리 지붕칸
  const car = giantCar();
  car.position.set(-(R - 18), 0, 8); // 맵 서쪽 벽 바로 너머 (거인이 걷는 길보다 안쪽)
  g.add(car);
  // 북동쪽 거인 신호등 (초록·빨강이 번갈아)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 90, 16), new THREE.MeshStandardMaterial({ color: '#4a5a52', roughness: 0.5, metalness: 0.4 }));
  pole.position.set(R * 0.7, 45, -R * 0.7);
  const head = new THREE.Mesh(new THREE.BoxGeometry(8, 18, 6), new THREE.MeshStandardMaterial({ color: '#202428', roughness: 0.5 }));
  head.position.set(R * 0.7 - 6, 82, -R * 0.7);
  const red = new THREE.MeshBasicMaterial({ color: '#ff3a2a', toneMapped: false });
  const green = new THREE.MeshBasicMaterial({ color: '#2aff8a', toneMapped: false });
  const lampR = new THREE.Mesh(new THREE.CircleGeometry(2.4, 20), red);
  const lampG = new THREE.Mesh(new THREE.CircleGeometry(2.4, 20), green);
  lampR.position.set(R * 0.7 - 6, 86, -R * 0.7 + 3.05);
  lampG.position.set(R * 0.7 - 6, 78, -R * 0.7 + 3.05);
  g.add(pole, head, lampR, lampG);
  // 걸어 다니는 거인 셋: 맵 둘레를 따라 천천히 (다리·팔이 번갈아 흔들림)
  const giants = [
    { radius: R + 22, speed: 0.022, phase: 0.4, shirt: '#c84a3a', pants: '#2c3e64', skin: '#e2b896' },
    { radius: R + 62, speed: -0.016, phase: 2.6, shirt: '#3a8a5a', pants: '#3c3c44', skin: '#8a5a3a' },
    { radius: R + 42, speed: 0.012, phase: 4.4, shirt: '#e0c050', pants: '#6a4a3a', skin: '#c49270' },
  ].map((o) => ({ ...o, rig: giantPerson(o) }));
  for (const gi of giants) g.add(gi.rig.root);
  g.userData.tick = (t) => {
    lampR.visible = Math.floor(t / 12) % 2 === 0;
    lampG.visible = !lampR.visible;
    for (const gi of giants) {
      const a = gi.phase + t * gi.speed;
      gi.rig.root.position.set(Math.cos(a) * gi.radius, 0, Math.sin(a) * gi.radius);
      gi.rig.root.rotation.y = -a + (gi.speed > 0 ? 0 : Math.PI); // 얼굴·발끝(+z)이 걷는 쪽으로
      const w = t * Math.abs(gi.speed) * gi.radius * 0.12; // 걸음 주기 (보폭에 맞춤)
      gi.rig.walk(w);
    }
  };
  return g;
}

// 거인 자동차 한 대 (길이 112 m): 옆면 그림(문 틈·손잡이·바퀴 집·문턱) · 앞뒤(전조등·미등·번호판) · 유리 지붕칸
function giantCar() {
  const car = new THREE.Group();
  const paint = '#2a5ab8';
  const side = carSideTexture(paint);
  const ends = [carEndTexture(paint, true), carEndTexture(paint, false)];
  const bodyM = (map) => new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : paint, roughness: 0.28, metalness: 0.55 });
  const under = new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.9 });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(40, 22, 112), [bodyM(side), bodyM(side), bodyM(null), under, bodyM(ends[0]), bodyM(ends[1])]);
  shell.position.set(0, 22.4, 0);
  const glass = new THREE.MeshStandardMaterial({ map: carGlassTexture(), roughness: 0.08, metalness: 0.7 });
  const roofM = bodyM(null);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(34, 17, 60), [glass, glass, roofM, under, glass, glass]);
  cabin.position.set(0, 33.4 + 8.5, -6);
  car.add(shell, cabin);
  const tire = new THREE.MeshStandardMaterial({ color: '#1c1d20', roughness: 0.92 });
  const rim = new THREE.MeshStandardMaterial({ color: '#c8ced4', roughness: 0.25, metalness: 0.9 });
  for (const z of [-36, 36]) {
    for (const x of [-16, 16]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(6.2, 2.8, 14, 36), tire);
      t.position.set(x, 9, z);
      t.rotation.y = Math.PI / 2;
      const w = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 4.2, 20), rim);
      w.position.set(x, 9, z);
      w.rotation.z = Math.PI / 2;
      car.add(t, w);
    }
  }
  // 옆 거울
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(5, 3.4, 2.4), bodyM(null));
  mirror.position.set(21.5, 36, 22);
  car.add(mirror);
  car.traverse((m) => m.isMesh && (m.castShadow = false));
  return car;
}

function carSideTexture(paint) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 200;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, '#5a8ae0');
  grad.addColorStop(0.35, paint);
  grad.addColorStop(1, '#173a80');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 200);
  // 허리선 반사
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(0, 46, 1024, 6);
  // 바퀴 집 (아래쪽 반원) — 바퀴 z = ±36 → u = (56 ∓ 36) / 112
  g.fillStyle = '#121418';
  for (const u of [20 / 112, 92 / 112]) {
    g.beginPath();
    g.arc(u * 1024, 200, 92, Math.PI, 0);
    g.fill();
  }
  // 문 틈 · 손잡이
  g.strokeStyle = 'rgba(10,20,40,0.85)';
  g.lineWidth = 4;
  for (const x of [330, 520, 700]) {
    g.beginPath();
    g.moveTo(x, 6);
    g.lineTo(x - 8, 196);
    g.stroke();
  }
  g.fillStyle = '#c8d0dc';
  for (const x of [470, 650]) g.fillRect(x, 70, 40, 10);
  // 문턱 (검은 띠)
  g.fillStyle = '#1a1d22';
  g.fillRect(250, 180, 520, 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function carEndTexture(paint, front) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 300;
  const g = c.getContext('2d');
  g.fillStyle = paint;
  g.fillRect(0, 0, 512, 300);
  g.fillStyle = '#16181c';
  g.fillRect(0, 210, 512, 90); // 범퍼 아래
  const lamp = front ? '#fff6d8' : '#ff3020';
  g.fillStyle = lamp;
  g.shadowColor = lamp;
  g.shadowBlur = 24;
  g.fillRect(24, 70, 120, 46);
  g.fillRect(368, 70, 120, 46);
  g.shadowBlur = 0;
  if (front) {
    g.fillStyle = '#1a1c20';
    g.fillRect(180, 80, 152, 70); // 그릴
    g.strokeStyle = '#8a9098';
    g.lineWidth = 4;
    for (let y = 92; y < 150; y += 14) {
      g.beginPath();
      g.moveTo(184, y);
      g.lineTo(328, y);
      g.stroke();
    }
  }
  g.fillStyle = '#f2f2ea';
  g.fillRect(196, 170, 120, 34); // 번호판
  g.fillStyle = '#1a1c22';
  g.font = 'bold 26px sans-serif';
  g.textAlign = 'center';
  g.fillText('거인 12가 3456', 256, 196);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function carGlassTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#2a5ab8';
  g.fillRect(0, 0, 512, 160);
  const glass = g.createLinearGradient(0, 0, 0, 160);
  glass.addColorStop(0, '#9ab8d8');
  glass.addColorStop(0.5, '#3a4a5e');
  glass.addColorStop(1, '#1a2230');
  g.fillStyle = glass;
  g.fillRect(16, 16, 230, 136);
  g.fillRect(266, 16, 230, 136);
  g.fillStyle = 'rgba(255,255,255,0.22)'; // 비친 하늘 줄무늬
  for (const x of [60, 320]) {
    g.beginPath();
    g.moveTo(x, 16);
    g.lineTo(x + 50, 16);
    g.lineTo(x - 10, 152);
    g.lineTo(x - 60, 152);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 거인 한 명 (모형 키 약 46 m × 1.6배): 엉덩이에서 다리·발, 어깨에서 팔이 흔들림
function giantPerson({ shirt, pants, skin }) {
  const root = new THREE.Group();
  const M = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const pantsM = M(pants), shirtM = M(shirt), skinM = M(skin, 0.7), shoeM = M('#efefea', 0.6), soleM = M('#2a2a2a', 0.9);
  const limb = (r1, r2, len, mat) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 14), mat);
    m.position.y = -len / 2;
    const pivot = new THREE.Group();
    pivot.add(m);
    return pivot;
  };
  const hipY = 20;
  const legs = [];
  for (const sx of [-1, 1]) {
    const thigh = limb(3.2, 2.6, 10, pantsM);
    thigh.position.set(sx * 3.4, hipY, 0);
    const shin = limb(2.5, 2.1, 10, pantsM);
    shin.position.y = -10;
    thigh.add(shin);
    const shoe = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.6, 9.5), shoeM);
    upper.position.set(0, -0.6, 1.6);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.8, 10), soleM);
    sole.position.set(0, -2.1, 1.6);
    shoe.add(upper, sole);
    shoe.position.y = -10;
    shin.add(shoe);
    root.add(thigh);
    legs.push({ thigh, shin });
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(13, 16, 7), shirtM);
  torso.position.y = hipY + 8;
  const hips = new THREE.Mesh(new THREE.BoxGeometry(11.5, 4, 6.5), pantsM);
  hips.position.y = hipY + 1;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 2.4, 12), skinM);
  neck.position.y = hipY + 17;
  const head = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 16), skinM);
  head.scale.set(0.9, 1.08, 0.95);
  head.position.y = hipY + 21.5;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(4.35, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M('#2a2018', 0.9));
  hair.position.copy(head.position);
  // 얼굴 (걷는 쪽 = +z): 눈·코·입 · 귀
  const dark = M('#1c1814', 0.6);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), dark);
    eye.position.set(sx * 1.4, hipY + 22.2, 3.7);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), skinM);
    ear.scale.set(0.5, 1, 0.8);
    ear.position.set(sx * 3.8, hipY + 21.6, 0);
    root.add(eye, ear);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 8), skinM);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, hipY + 21.2, 4.2);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.3, 0.3), M('#8a3a30', 0.7));
  mouth.position.set(0, hipY + 19.9, 3.75);
  // 둥근 어깨 · 깃 · 허리띠
  const shoulders = [-1, 1].map((sx) => {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 10), shirtM);
    sh.position.set(sx * 6.2, hipY + 14.6, 0);
    return sh;
  });
  const collar = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.6, 8, 20), M('#f0ece4', 0.8));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = hipY + 16.2;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(11.8, 1.1, 6.8), M('#3a2a1e', 0.6));
  belt.position.y = hipY + 2.6;
  root.add(torso, hips, neck, head, hair, nose, mouth, collar, belt, ...shoulders);
  const arms = [];
  for (const sx of [-1, 1]) {
    const upper = limb(1.7, 1.5, 9, shirtM);
    upper.position.set(sx * 7.6, hipY + 15, 0);
    const fore = limb(1.4, 1.2, 8, skinM);
    fore.position.y = -9;
    upper.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), skinM);
    hand.position.y = -8.6;
    fore.add(hand);
    root.add(upper);
    arms.push({ upper, fore });
  }
  root.traverse((m) => m.isMesh && (m.castShadow = false));
  root.scale.setScalar(1.6); // 키 약 74 m — 4.8 m 담 너머로도 거인임이 한눈에 보이게
  return {
    root,
    walk(w) {
      const sw = Math.sin(w);
      legs[0].thigh.rotation.x = sw * 0.45;
      legs[1].thigh.rotation.x = -sw * 0.45;
      legs[0].shin.rotation.x = Math.max(0, -Math.cos(w)) * 0.6;
      legs[1].shin.rotation.x = Math.max(0, Math.cos(w)) * 0.6;
      arms[0].upper.rotation.x = -sw * 0.35;
      arms[1].upper.rotation.x = sw * 0.35;
      arms[0].fore.rotation.x = arms[1].fore.rotation.x = -0.25;
      root.position.y = Math.abs(Math.cos(w)) * 1.3; // 걸을 때 몸이 살짝 오르내림
    },
  };
}
