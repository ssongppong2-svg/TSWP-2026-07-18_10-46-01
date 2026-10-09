// 시뮬레이션 전용 벡터 도우미. three.js에 의존하지 않아서 Node(테스트·서버)에서도 그대로 돌아갑니다.
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const copy = (a) => ({ x: a.x, y: a.y, z: a.z });
export const setFrom = (o, a) => {
  o.x = a.x;
  o.y = a.y;
  o.z = a.z;
  return o;
};
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function norm(a) {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

// yaw 0 = -Z(북쪽)을 바라봄, yaw가 커지면 왼쪽으로 회전. three.js 카메라(YXZ 순서)와 같은 규칙입니다.
export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function anglesFromDir(d) {
  const l = len(d) || 1;
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(clamp(d.y / l, -1, 1)) };
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// 선분 a→b 와 구(중심 c, 반지름 r)의 첫 교차 t(0~1). 없으면 -1.
export function segmentSphere(a, b, c, r) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - c.x, fy = a.y - c.y, fz = a.z - c.z;
  const A = dx * dx + dy * dy + dz * dz;
  if (A < 1e-12) return -1;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t1 = (-B - s) / (2 * A);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (C < 0) return 0; // 시작점이 이미 구 안
  return -1;
}

// 선분 a→b 와 축 정렬 상자(min/max)의 첫 교차 t(0~1). 없으면 -1.
export function segmentAabb(a, b, min, max) {
  let tmin = 0, tmax = 1;
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  const o = [a.x, a.y, a.z];
  const lo = [min.x, min.y, min.z];
  const hi = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
