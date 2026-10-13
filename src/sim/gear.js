// 투척·폭발 장비 (델타포스·레디 오어 낫식). 화면과 무관한 규칙 → Node 시험 가능.
//
// 던진 물체는 중력(9.8 m/s²)을 받아 포물선을 그리며 날아가고, 벽·바닥에 부딪히면
// 튕기면서(탄성) 바닥을 구르다 마찰력 때문에 멈춘다. 신관 시간이 지나면 터진다.
//   frag  세열 수류탄: 파편 피해 (가까울수록 큼, 벽 뒤는 안전)
//   stun  이명 수류탄: 귀가 울리고 소리가 먹먹해지며 조준이 흔들리고 느려짐 (화면은 하얗게 되지 않음)
//   flash 섬광탄: 잠깐 눈부심 (보고 있던 방향일수록 강함, 짧고 견딜 만하게)
//   smoke 연막탄: 15초 동안 시야를 가리는 연기 (봇도 연기 너머를 못 봄)
//   gas   최루탄: 연기 안에서 기침·조준 흔들림·느려짐 (피해 없음)
//   c4    C4 폭약: 벽·바닥·문에 붙이고 기폭기로 터뜨림 (문 돌파)
export const GRAVITY = 9.8; // 중력가속도 (m/s²)

export const GEAR = {
  frag: { id: 'frag', name: '세열 수류탄', short: '세열', kind: 'throw', price: 300, mass: 0.45, max: 1, fuse: 2.2, radius: 6, damage: 90, pen: 2, wear: 1.6, noise: 70 },
  stun: { id: 'stun', name: '이명 수류탄', short: '이명', kind: 'throw', price: 200, mass: 0.4, max: 2, fuse: 1.6, radius: 7, time: 4, noise: 60 },
  flash: { id: 'flash', name: '섬광탄', short: '섬광', kind: 'throw', price: 250, mass: 0.35, max: 2, fuse: 1.5, radius: 14, time: 2.2, noise: 55 },
  smoke: { id: 'smoke', name: '연막탄', short: '연막', kind: 'throw', price: 300, mass: 0.5, max: 1, fuse: 1.2, radius: 4.5, time: 15, noise: 20 },
  gas: { id: 'gas', name: '최루탄', short: '최루', kind: 'throw', price: 300, mass: 0.5, max: 1, fuse: 1.2, radius: 4, time: 10, noise: 20 },
  c4: { id: 'c4', name: 'C4 폭약', short: 'C4', kind: 'place', price: 400, mass: 1.0, max: 1, radius: 5, damage: 110, pen: 3, wear: 2, reach: 2.6, arm: 0.6, noise: 85 },
  // 정찰 드론: 띄우면 드론 카메라로 조종, 보이는 적은 팀에 표시 (작용·반작용: 프로펠러가 공기를 아래로 밀면 공기가 드론을 위로 밂)
  //   배터리 45초 · 회수(F)하면 바로 손으로 돌아와 남은 배터리로 다시 띄움 (들고 있는 동안 천천히 충전) · 격추되거나 공중에서 배터리가 다 되면 잃음
  drone: { id: 'drone', name: '정찰 드론', short: '드론', kind: 'drone', price: 400, mass: 1.2, max: 1, battery: 45, range: 40, mark: 5, noise: 16 },
};
export const THROW_ORDER = ['frag', 'stun', 'flash', 'smoke', 'gas'];
export const GADGET_ORDER = ['c4', 'drone'];

// 드론 비행: 원하는 속도로 다가감(관성), 벽에 막힘. 높이는 천장 아래(실외는 하늘 40 m)까지 자유롭게
//   recharge: 손에 있을 때 초당 충전되는 배터리(초) · minLaunch: 이만큼은 있어야 띄움
export const DRONE = { radius: 0.22, speed: 6, accel: 6, climb: 4, minAlt: 0.35, maxAlt: 40, fov: 0.5, scanEvery: 0.15, recharge: 0.5, minLaunch: 3 };
export function stepDrone(map, d, inp, dt) {
  d.yaw = inp.yaw;
  d.pitch = Math.max(-1.3, Math.min(1.2, inp.pitch ?? 0));
  let mx = inp.mx ?? 0, mz = inp.mz ?? 0;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  }
  const sin = Math.sin(d.yaw), cos = Math.cos(d.yaw);
  const tx = (-sin * mz + cos * mx) * DRONE.speed, tz = (-cos * mz - sin * mx) * DRONE.speed;
  const ty = ((inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * DRONE.climb;
  const k = 1 - Math.exp(-DRONE.accel * dt);
  d.vel.x += (tx - d.vel.x) * k;
  d.vel.y += (ty - d.vel.y) * k;
  d.vel.z += (tz - d.vel.z) * k;
  d.pos.x += d.vel.x * dt;
  d.pos.z += d.vel.z * dt;
  map.collideCircle(d.pos, DRONE.radius, d.pos.y - 0.12, 0, d.vel, 0.24);
  d.pos.y += d.vel.y * dt;
  const ground = map.groundHeight(d.pos.x, d.pos.z, DRONE.radius, d.pos.y + 0.1);
  const ceil = map.ceilingHeight(d.pos.x, d.pos.z, DRONE.radius, d.pos.y - 0.05);
  const top = Math.min(ceil - 0.25, ground + DRONE.maxAlt);
  if (d.pos.y < ground + DRONE.minAlt) {
    d.pos.y = ground + DRONE.minAlt;
    d.vel.y = Math.max(0, d.vel.y);
  } else if (d.pos.y > top) {
    d.pos.y = Math.max(ground + DRONE.minAlt, top);
    d.vel.y = Math.min(0, d.vel.y);
  }
}
export const GEAR_ORDER = [...THROW_ORDER, ...GADGET_ORDER];

// 던지는 힘: 멀리(왼쪽 클릭) · 가까이(오른쪽 클릭, 낮게 굴림)
export const THROW = {
  long: { speed: 15, up: 0.12 }, // up: 조준보다 살짝 위로 (손을 놓는 각도)
  short: { speed: 6.5, up: 0.05 },
  bounce: 0.38, // 부딪힌 뒤 남는 속도 (반발)
  roll: 2.6, // 바닥에서 구를 때 마찰로 줄어드는 정도 (초당)
  radius: 0.06, // 물체 크기 (벽에 파묻히지 않게)
  maxLife: 8,
};

// 효과 세기 (지속 시간에 곱함): 거리·벽·바라보는 방향
export const EFFECT = {
  stunSlow: 0.8, // 이명: 이동 속도
  stunSpread: 0.03, // 이명: 조준 흔들림 (최대)
  gasSlow: 0.85,
  gasSpread: 0.025,
  flashBlind: 0.55, // 섬광: 이 이상이면 봇은 아무것도 못 봄
  knock: 6, // 폭발에 밀려나는 최대 속도 (m/s)
};

// 던지는 순간의 처음 속도 (눈에서 조준 방향 + 살짝 위, 달리던 속도도 더해짐 = 관성)
export function throwVelocity(dir, mode = 'long', carry = null) {
  const t = THROW[mode] ?? THROW.long;
  let x = dir.x, y = dir.y + t.up, z = dir.z;
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  return { x: x * t.speed + (carry?.x ?? 0) * 0.6, y: y * t.speed + Math.max(0, carry?.y ?? 0) * 0.3, z: z * t.speed + (carry?.z ?? 0) * 0.6 };
}

// 던진 물체 한 틱: 중력 → 이동 → 벽·바닥 충돌(튕김) → 바닥에서 구름(마찰). 부딪히면 { bounced, speed }
export function stepThrown(map, t, dt) {
  const R = THROW.radius;
  t.vel.y -= GRAVITY * dt;
  const next = { x: t.pos.x + t.vel.x * dt, y: t.pos.y + t.vel.y * dt, z: t.pos.z + t.vel.z * dt };
  let bounced = null;
  const hit = map.raycast(t.pos, next);
  if (hit) {
    const vn = t.vel.x * hit.nx + t.vel.y * hit.ny + t.vel.z * hit.nz;
    const speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z);
    // 면에 수직인 속도는 뒤집고 줄임(반발), 면을 따라가는 속도는 마찰로 조금 줄임
    const k = THROW.bounce;
    t.vel.x = (t.vel.x - (1 + k) * vn * hit.nx) * 0.8;
    t.vel.y = t.vel.y - (1 + k) * vn * hit.ny;
    t.vel.z = (t.vel.z - (1 + k) * vn * hit.nz) * 0.8;
    t.pos.x = hit.x + hit.nx * R;
    t.pos.y = Math.max(R, hit.y + hit.ny * R);
    t.pos.z = hit.z + hit.nz * R;
    if (hit.ny > 0.7 && Math.abs(t.vel.y) < 1.2) {
      // 바닥에 내려앉음: 더 튀지 않고 굴러감
      t.vel.y = 0;
      t.rest = true;
    }
    if (speed > 1.5) bounced = { speed, nx: hit.nx, ny: hit.ny, nz: hit.nz };
  } else {
    t.pos.x = next.x;
    t.pos.y = next.y;
    t.pos.z = next.z;
  }
  if (t.rest) {
    // 바닥 위: 마찰력이 운동 반대 방향으로 작용해 멈춤. 발밑 바닥이 없어지면 다시 떨어짐
    const k = Math.exp(-THROW.roll * dt);
    t.vel.x *= k;
    t.vel.z *= k;
    const g = map.groundHeight(t.pos.x, t.pos.z, 0.02, t.pos.y + 0.05);
    if (t.pos.y - g > 0.08) t.rest = false;
    else {
      t.pos.y = g + R;
      t.vel.y = 0;
    }
  }
  return bounced;
}

// 궤적 미리 보기 (화면의 포물선 표시 · 봇의 조준): 점 목록과 처음 닿는 곳
export function previewArc(map, pos, vel, { dt = 1 / 30, maxT = 3 } = {}) {
  const t = { pos: { ...pos }, vel: { ...vel }, rest: false };
  const pts = [{ ...t.pos }];
  let land = null;
  for (let s = 0; s < maxT / dt; s++) {
    const b = stepThrown(map, t, dt);
    pts.push({ ...t.pos });
    if (b && !land) {
      land = { x: t.pos.x, y: t.pos.y, z: t.pos.z, nx: b.nx, ny: b.ny, nz: b.nz };
      break;
    }
    if (t.rest && !land) {
      land = { ...t.pos, nx: 0, ny: 1, nz: 0 };
      break;
    }
  }
  return { pts, land: land ?? pts.at(-1) };
}

// 봇 조준: from에서 to까지 speed로 던질 때의 위 방향 각도(낮은 쪽 해). 닿지 못하면 null
// 포물선 운동: 수평 거리 x, 높이 차 y, 속력 v → tanθ = (v² − √(v⁴ − g(gx² + 2yv²))) / (gx)
export function aimForTarget(from, to, speed) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const x = Math.hypot(dx, dz), y = to.y - from.y;
  const v2 = speed * speed, g = GRAVITY;
  const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (disc < 0 || x < 0.1) return null;
  const pitch = Math.atan((v2 - Math.sqrt(disc)) / (g * x));
  return { yaw: Math.atan2(-dx, -dz), pitch };
}

// 폭발·섬광이 그 사람에게 닿는 정도 (0~1): 거리 + 벽에 가렸는지
export function exposure(map, center, point, radius) {
  const d = Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z);
  if (d > radius) return 0;
  if (!map.lineOfSight(center, point)) return 0;
  return 1 - d / radius;
}

// 한 칸(2 m)보다 가까운 벽에 붙이는 C4: 눈에서 조준 방향으로 reach 안의 면
export function placeTarget(map, eye, dir, reach) {
  const end = { x: eye.x + dir.x * reach, y: eye.y + dir.y * reach, z: eye.z + dir.z * reach };
  const hit = map.raycast(eye, end);
  if (!hit) return null;
  const spot = { x: hit.x + hit.nx * 0.04, y: hit.y + hit.ny * 0.04, z: hit.z + hit.nz * 0.04, nx: hit.nx, ny: hit.ny, nz: hit.nz };
  // 문짝에 붙이면 그 문 (문을 따라 움직이고, 터지면 문이 부서짐)
  if (hit.door != null) Object.assign(spot, { door: hit.door, leaf: hit.leaf });
  return spot;
}

export const gearCount = (a) => GEAR_ORDER.reduce((s, id) => s + (a.gear?.[id] ?? 0), 0);
export const emptyGear = () => Object.fromEntries(GEAR_ORDER.map((id) => [id, 0]));
// 다음에 손에 들 투척물 (가진 것 중 지금 것 다음)
export function nextThrowable(a, current = null) {
  const owned = THROW_ORDER.filter((id) => (a.gear?.[id] ?? 0) > 0);
  if (!owned.length) return null;
  const i = owned.indexOf(current);
  return owned[(i + 1) % owned.length];
}
