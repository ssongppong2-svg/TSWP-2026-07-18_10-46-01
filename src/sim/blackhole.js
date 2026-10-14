// 폭탄 폭발 → 블랙홀: 남은 폭탄마다 거대한 블랙홀이 생겨 맵의 모든 요원(쓰러진 몸 포함)을 빨아들인다.
// 라운드는 이미 끝난 뒤의 연출이라 벽·충돌은 무시하고 끌려감 (흡수는 처치·사망 기록에 넣지 않음)
//   0초: 폭발 · 블랙홀이 커지기 시작 (grow초 동안 radius까지)
//   가까울수록·시간이 갈수록 세게 끌어당김 (중력은 거리가 가까울수록 커짐) + 둘레를 돌며 빨려듦
//   지평선(horizon) 안에 들어가면 흡수 · time초가 되면 남은 요원도 모두 흡수
// 방장과 참가자 화면이 같은 함수를 씀 (참가자는 자기 요원만 미리 움직이고 나머지는 방장 위치를 따름)
export const BLACKHOLE = { grow: 1.4, radius: 7, height: 4.5, horizon: 2.2, time: 4.6, pull: 1.5, spin: 0.55, maxSpeed: 70 };

const smooth = (k) => k * k * (3 - 2 * k);

export function holeRadius(h, now) {
  const k = Math.min(1, Math.max(0, (now - h.t0) / BLACKHOLE.grow));
  return BLACKHOLE.radius * smooth(k);
}

// 폭발한 폭탄들 위에 블랙홀
export function makeHoles(bombs, now) {
  return bombs.map((b) => ({ id: b.id, x: b.x, y: (b.y ?? 0) + BLACKHOLE.height, z: b.z, t0: now }));
}

// 끌려가는 정도 (0~1): 가까울수록·시간이 갈수록 큼 — 화면에서 몸이 늘어나는 정도
export function pullAmount(pos, holes, now) {
  let best = 0;
  for (const h of holes) {
    const d = Math.hypot(h.x - pos.x, h.y - (pos.y + 0.9), h.z - pos.z);
    best = Math.max(best, Math.min(1, Math.max(0, 1 - (d - BLACKHOLE.horizon) / 30) * Math.min(1, (now - h.t0) / 1.2)));
  }
  return best;
}

// 요원 하나를 가장 가까운 블랙홀로 끌어당김 · 흡수되면 true
export function pullAgent(a, holes, now, dt) {
  if (a.absorbed || !holes.length) return false;
  const cy = a.pos.y + 0.9;
  let h = holes[0], best = Infinity;
  for (const o of holes) {
    const d = Math.hypot(o.x - a.pos.x, o.y - cy, o.z - a.pos.z);
    if (d < best) {
      best = d;
      h = o;
    }
  }
  const age = now - h.t0;
  a.prev = { x: a.pos.x, y: a.pos.y, z: a.pos.z };
  const dx = h.x - a.pos.x, dy = h.y - cy, dz = h.z - a.pos.z;
  const dist = Math.hypot(dx, dy, dz) || 1e-3;
  a.pulled = Math.min(1, Math.max(0, 1 - (dist - BLACKHOLE.horizon) / 30) * Math.min(1, age / 1.2));
  if (dist < BLACKHOLE.horizon || age >= BLACKHOLE.time) {
    a.absorbed = true;
    a.pulled = 1;
    a.pos.x = h.x;
    a.pos.y = h.y - 0.9;
    a.pos.z = h.z;
    a.vel = { x: 0, y: 0, z: 0 };
    return true;
  }
  if (age < 0.25) return false;
  // 가까울수록·시간이 갈수록 빨라짐 · 둘레를 돌며(수평 접선 방향) 빨려듦
  //   (가까운 요원은 2초쯤, 맵 끝의 요원은 마지막 순간 빠르게 빨려 듦)
  const speed = Math.min(BLACKHOLE.maxSpeed, (1 + age * age * 1.6) * (1 + 8 / Math.max(dist, 4)));
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;
  const h2 = Math.hypot(ux, uz) || 1;
  const tx = -uz / h2, tz = ux / h2;
  const spin = BLACKHOLE.spin * Math.min(1, dist / 12);
  const vx = (ux + tx * spin) * speed, vy = uy * speed, vz = (uz + tz * spin) * speed;
  // 지평선을 지나쳐 넘어가지 않게 남은 거리까지만
  const step = Math.min(1, dist / Math.max(1e-3, Math.hypot(vx, vy, vz) * dt));
  a.pos.x += vx * dt * step;
  a.pos.y += vy * dt * step;
  a.pos.z += vz * dt * step;
  a.vel = { x: vx, y: vy, z: vz };
  a.onGround = false;
  return false;
}
