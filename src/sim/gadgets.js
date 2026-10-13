// 전술 장비 규칙: 경보 센서(트립와이어) · 던지는 카메라 · 심장 박동 센서 · EMP. 화면과 무관한 규칙 → Node 시험 가능.
//
//   경보 센서: 벽에 붙이면 맞은편 벽까지(최대 9 m) 레이저 줄. 적의 몸이 줄을 지나가면 삐삐 울리고 그 적이 3초 동안 팀에 보임
//             (줄 높이를 보고 앉아서 밑으로·뛰어서 위로 피할 수 있음). 한 발 맞으면 부서짐
//   던지는 카메라: 처음 닿은 벽·바닥·천장에 붙음 (문짝에는 튕김). 팀 누구나 5 → 왼쪽 클릭으로 봄
//             보는 동안 화면 안 적은 팀 지도에, 왼쪽 클릭 = 적 표시(5초), 오른쪽 클릭 = 다음 카메라. 한 발 맞으면 부서짐
//   심장 박동 센서: 누르고 있으면 0.6초마다 앞쪽(약 65°) 15 m 안 적의 심장 박동이 벽 너머로 보임. 쓰는 동안 느리게 움직임
//   EMP: 반경 8 m 안 전자 장비를 끔 (벽 너머는 6할 세기) — 드론·RC카 추락, 카메라·경보 센서·C4·심박 센서·바디캠 지도 정지
import { clamp, dirFromAngles, segmentSphere } from '../core/vec.js';
import { bodyTop, chestPos, emptyIntent, eyePos } from './agent.js';
import { PLAYER } from './constants.js';
import { GEAR, placeTarget, remoteEye } from './gear.js';

export const CAM = { radius: 0.075, out: 0.06, yawLimit: 1.25, pitchMin: -1.1, pitchMax: 0.8, fov: 0.55, scanEvery: 0.2 };
export const ALARM = { radius: 0.08, minBeam: 0.8, body: PLAYER.radius };
export const PULSE = { cone: 0.42, every: 0.6, slow: 0.55, maxDy: 5 };

// 카메라가 볼 수 있는 방향: 벽은 바깥쪽 ±72°, 바닥은 사방(위로), 천장은 사방(아래로)
export function camLimits(cam, yaw, pitch) {
  if (cam.ny > 0.7) return { yaw, pitch: clamp(pitch, -0.25, 1.0) };
  if (cam.ny < -0.7) return { yaw, pitch: clamp(pitch, -1.45, 0.05) };
  const base = Math.atan2(-cam.nx, -cam.nz);
  const off = Math.atan2(Math.sin(yaw - base), Math.cos(yaw - base));
  return { yaw: base + clamp(off, -CAM.yawLimit, CAM.yawLimit), pitch: clamp(pitch, CAM.pitchMin, CAM.pitchMax) };
}
// 처음 볼 때의 방향: 벽은 바깥쪽 정면, 바닥·천장은 붙기 전 날아가던 방향
export function camBase(cam) {
  if (Math.abs(cam.ny) > 0.7) return { yaw: cam.yaw0 ?? 0, pitch: cam.ny > 0 ? 0.05 : -0.6 };
  return { yaw: Math.atan2(-cam.nx, -cam.nz), pitch: -0.1 };
}
export const camEye = (cam) => ({ x: cam.x + cam.nx * CAM.out, y: cam.y + cam.ny * CAM.out, z: cam.z + cam.nz * CAM.out });

// 심장 박동: 앞쪽 원뿔 안·range 안의 살아 있는 적 (벽은 상관없음). 화면도 같은 함수로 그림
export function pulseScan(agents, a) {
  const range = GEAR.pulse.range;
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  const out = [];
  for (const e of agents) {
    if (!e.alive || e.team === a.team) continue;
    const dx = e.pos.x - a.pos.x, dz = e.pos.z - a.pos.z, dy = e.pos.y - a.pos.y;
    const h = Math.hypot(dx, dz);
    const d = Math.hypot(h, dy);
    if (d > range || Math.abs(dy) > PULSE.maxDy) continue;
    if (h > 0.8 && (dx * fx + dz * fz) / h < PULSE.cone) continue;
    out.push({ id: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z, d });
  }
  return out.sort((p, q) => p.d - q.d);
}

// 사람 몸(원기둥)이 경보 줄(수평 선분)을 가로지르는지
export function beamCrosses(al, e) {
  const sx = al.x, sz = al.z, ex = al.ex, ez = al.ez;
  const vx = ex - sx, vz = ez - sz, l2 = vx * vx + vz * vz || 1;
  const t = clamp(((e.pos.x - sx) * vx + (e.pos.z - sz) * vz) / l2, 0, 1);
  const px = sx + vx * t, pz = sz + vz * t;
  if (Math.hypot(e.pos.x - px, e.pos.z - pz) > ALARM.body) return false;
  return al.y > e.pos.y + 0.05 && al.y < e.pos.y + bodyTop(e);
}

export class Gadgets {
  constructor(match) {
    this.match = match;
    this.cams = []; // 붙은 카메라
    this.alarms = []; // 경보 센서
  }

  reset() {
    this.cams = [];
    this.alarms = [];
  }

  camById(id) {
    return this.cams.find((c) => c.id === id) ?? null;
  }
  teamCams(team) {
    return this.cams.filter((c) => c.team === team).sort((p, q) => p.id - q.id);
  }
  off(dev) {
    return (dev.offUntil ?? -99) > this.match.time;
  }

  // ───── 던지는 카메라 ─────
  // 날아가던 카메라가 면에 닿음 → 그 자리에 붙음
  stickCam(t, n) {
    const m = this.match;
    const len = Math.hypot(n.nx, n.ny, n.nz) || 1;
    const nx = n.nx / len, ny = n.ny / len, nz = n.nz / len;
    const yaw0 = Math.atan2(-(t.vel?.x ?? 0), -(t.vel?.z ?? 0));
    const cam = { id: m.nextId++, kind: 'cam', ownerId: t.ownerId, team: t.team, x: t.pos.x, y: t.pos.y, z: t.pos.z, nx, ny, nz, yaw0, offUntil: -99 };
    this.cams.push(cam);
    m.emit('camStick', { cam });
    return cam;
  }

  // 카메라 화면: 위치·방향 (보는 요원의 camView 각도를 한계 안으로)
  view(a) {
    const v = a?.camView;
    const cam = v ? this.camById(v.id) : null;
    if (!cam) return null;
    const lim = camLimits(cam, v.yaw, v.pitch);
    return { pos: camEye(cam), yaw: lim.yaw, pitch: lim.pitch, cam, off: this.off(cam) };
  }

  // 5 → 왼쪽 클릭: 팀 카메라 보기 (지난번에 보던 것부터)
  enterCams(a, from = null) {
    const m = this.match;
    const list = this.teamCams(a.team);
    if (!list.length) {
      m.emit('gearDenied', { agent: a, which: 'gadget', reason: m.throwables.some((t) => t.kind === 'cam' && t.team === a.team) ? 'camFlying' : 'nocam' });
      return false;
    }
    if ((a.empT ?? 0) > 0) {
      m.emit('gearDenied', { agent: a, which: 'gadget', reason: 'emp' });
      return false;
    }
    const cam = list.find((c) => c.id === (from ?? a.lastCam)) ?? list[0];
    const b = camBase(cam);
    a.camView = { id: cam.id, yaw: b.yaw, pitch: b.pitch, home: { yaw: a.yaw, pitch: a.pitch }, fireLatch: true, adsLatch: true, scanT: 0 };
    a.lastCam = cam.id;
    a.reloadT = 0;
    m.emit('camView', { agent: a, on: true, cam, index: list.indexOf(cam), count: list.length });
    return true;
  }

  exitCams(a, reason = 'off') {
    const v = a.camView;
    if (!v) return;
    a.camView = null;
    a.yaw = v.home.yaw;
    a.pitch = v.home.pitch;
    this.match.emit('camView', { agent: a, on: false, reason });
  }

  // 보는 동안의 입력: 마우스 = 카메라 방향 · 왼쪽 클릭 표시 · 오른쪽 클릭 다음 · 움직이거나 F·5·무기 바꾸면 거둠. 몸은 앉아서 가만히
  control(a, intent) {
    const m = this.match;
    const v = a.camView;
    const cam = this.camById(v.id);
    if (!cam) {
      // 보던 카메라가 부서짐 → 다음 카메라, 없으면 몸으로
      const next = this.teamCams(a.team)[0];
      if (next && (a.empT ?? 0) <= 0) {
        const b = camBase(next);
        Object.assign(v, { id: next.id, yaw: b.yaw, pitch: b.pitch });
        a.lastCam = next.id;
        m.emit('camView', { agent: a, on: true, cam: next, index: 0, count: this.teamCams(a.team).length, lost: true });
      } else {
        this.exitCams(a, 'lost');
        return { ...intent, yaw: a.yaw, pitch: a.pitch };
      }
    }
    const lim = camLimits(this.camById(v.id), intent.yaw, intent.pitch);
    v.yaw = lim.yaw;
    v.pitch = lim.pitch;
    const mark = intent.fire && !v.fireLatch;
    v.fireLatch = intent.fire;
    const next = intent.ads && !v.adsLatch;
    v.adsLatch = intent.ads;
    const leave = intent.interact || intent.equip || intent.switchTo || intent.jump || Math.hypot(intent.moveX, intent.moveZ) > 0.3 || intent.door;
    if (leave) {
      this.exitCams(a, 'off');
      return { ...emptyIntent(a), yaw: a.yaw, pitch: a.pitch, crouch: intent.crouch };
    }
    if (next && !m.client) {
      const list = this.teamCams(a.team);
      if (list.length > 1) {
        const i = list.findIndex((c) => c.id === v.id);
        const n = list[(i + 1) % list.length];
        const b = camBase(n);
        Object.assign(v, { id: n.id, yaw: b.yaw, pitch: b.pitch });
        a.lastCam = n.id;
        m.emit('camView', { agent: a, on: true, cam: n, index: (i + 1) % list.length, count: list.length });
      }
    }
    if (mark && !m.client) this.camMark(a);
    return { ...emptyIntent(a), crouch: true, yaw: v.home.yaw, pitch: v.home.pitch };
  }

  // 카메라 화면 가운데(약 7°)에 보이는 적 → 5초 동안 팀에 보임 + 무전
  camMark(a) {
    const m = this.match;
    const v = this.view(a);
    if (!v) return null;
    if (v.off) {
      m.emit('camMark', { agent: a, target: null, reason: 'emp' });
      return null;
    }
    const fwd = dirFromAngles(v.yaw, v.pitch);
    let best = null, bestCos = Math.cos(0.12);
    for (const e of m.agents) {
      if (!e.alive || e.team === a.team) continue;
      const c = chestPos(e);
      const vx = c.x - v.pos.x, vy = c.y - v.pos.y, vz = c.z - v.pos.z;
      const l = Math.hypot(vx, vy, vz);
      if (l > GEAR.cam.range + 4) continue;
      const cs = (vx * fwd.x + vy * fwd.y + vz * fwd.z) / l;
      if (cs < bestCos || !m.clearLine(v.pos, c)) continue;
      bestCos = cs;
      best = e;
    }
    m.emit('camMark', { agent: a, target: best });
    if (!best) return null;
    best.revealedUntil = Math.max(best.revealedUntil, m.time + GEAR.cam.mark);
    best.spottedT = m.time;
    const place = m.map.calloutAt(best.pos.x, best.pos.z, best.pos.y) ?? '카메라 앞';
    m.shareIntel(a, { x: best.pos.x, y: best.pos.y, z: best.pos.z, kind: 'seen' });
    m.radio(a, `카메라: 적 표시 — ${place}`, { kind: 'contact', pos: { ...best.pos }, report: true });
    return best;
  }

  // ───── 경보 센서 ─────
  placeAlarm(a) {
    const m = this.match;
    if (!((a.gear?.alarm ?? 0) > 0)) return false;
    if ((a.empT ?? 0) > 0) {
      m.emit('gearDenied', { agent: a, which: 'gadget', reason: 'emp' });
      return false;
    }
    const spot = placeTarget(m.map, eyePos(a), dirFromAngles(a.yaw, a.pitch), GEAR.alarm.reach);
    return this.attachAlarm(a, spot);
  }

  // 벽(세운 면)에만 · 문짝 안 됨 · 맞은편까지 0.8 m 이상
  alarmSpot(spot) {
    const m = this.match;
    if (!spot) return { reason: 'far' };
    if (spot.door != null || Math.abs(spot.ny) > 0.5) return { reason: 'wall' };
    const l = Math.hypot(spot.nx, spot.nz) || 1;
    const nx = spot.nx / l, nz = spot.nz / l;
    const from = { x: spot.x + nx * 0.03, y: spot.y, z: spot.z + nz * 0.03 };
    const to = { x: from.x + nx * GEAR.alarm.beam, y: from.y, z: from.z + nz * GEAR.alarm.beam };
    const hit = m.map.raycast(from, to);
    const end = hit ? { x: hit.x, y: hit.y, z: hit.z } : to;
    const len = Math.hypot(end.x - from.x, end.z - from.z);
    if (len < ALARM.minBeam) return { reason: 'short' };
    return { x: spot.x, y: spot.y, z: spot.z, nx, nz, ex: end.x, ey: from.y, ez: end.z, len };
  }

  attachAlarm(a, spot) {
    const m = this.match;
    const s = this.alarmSpot(spot);
    if (s.reason) {
      m.emit('gearDenied', { agent: a, which: 'alarm', reason: s.reason });
      return false;
    }
    a.gear.alarm--;
    const al = { id: m.nextId++, kind: 'alarm', ownerId: a.id, team: a.team, ...s, offUntil: -99, cdUntil: m.time + 0.8, trippedT: -99 };
    this.alarms.push(al);
    if (a.equip?.kind === 'alarm' && !(a.gear.alarm > 0)) {
      a.equip = null;
      a.swapT = 0.35;
    }
    m.makeNoise(a, 'patch');
    m.emit('alarmPlaced', { agent: a, alarm: al });
    return al;
  }

  // ───── EMP ─────
  // 세기 k(0~1): 가까울수록 세고, 벽 너머는 6할
  empAt(at, radius, p) {
    const d = Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z);
    if (d > radius) return 0;
    const k = 1 - d / radius;
    return this.match.map.lineOfSight(at, p) ? k : k * 0.6;
  }

  emp(at, def, owner, payload) {
    const m = this.match;
    const until = (k) => m.time + def.time * (0.5 + 0.5 * k);
    let devices = 0;
    for (const d of [...m.drones]) {
      if (this.empAt(at, def.radius, remoteEye(d)) <= 0) continue;
      m.endDrone(d, 'emp');
      devices++;
    }
    for (const dev of [...this.cams, ...this.alarms]) {
      const k = this.empAt(at, def.radius, dev);
      if (k <= 0) continue;
      dev.offUntil = Math.max(dev.offUntil ?? -99, until(k));
      devices++;
    }
    for (const c of m.charges) {
      const k = this.empAt(at, def.radius, c);
      if (k <= 0) continue;
      c.offUntil = Math.max(c.offUntil ?? -99, until(k));
      devices++;
    }
    for (const a of m.agents) {
      if (!a.alive) continue;
      const k = this.empAt(at, def.radius, chestPos(a));
      if (k <= 0) continue;
      a.empT = Math.max(a.empT ?? 0, def.time * (0.4 + 0.6 * k));
      a.pulseOn = false;
      payload.hit.push({ id: a.id, k: Math.round(k * 100) / 100 });
    }
    payload.devices = devices;
  }

  // ───── 부서짐 (총알 · 폭발) ─────
  // 선분 p0→p1에서 tMax보다 먼저 맞는 적 장비 { t, dev }
  hitTest(p0, p1, team, tMax) {
    let best = null;
    for (const c of this.cams) {
      if (c.team === team) continue;
      const t = segmentSphere(p0, p1, c, CAM.radius + 0.04);
      if (t >= 0 && t < (best?.t ?? tMax)) best = { t, dev: c };
    }
    for (const al of this.alarms) {
      if (al.team === team) continue;
      const t = segmentSphere(p0, p1, al, ALARM.radius + 0.04);
      if (t >= 0 && t < (best?.t ?? tMax)) best = { t, dev: al };
    }
    return best;
  }

  destroy(dev, reason = 'shot', by = null) {
    const m = this.match;
    if (dev.kind === 'cam') {
      this.cams = this.cams.filter((c) => c !== dev); // 보던 사람은 control()에서 다음 카메라로 넘어감
    } else this.alarms = this.alarms.filter((x) => x !== dev);
    // 적이 쏴서 부수면 신호가 끊기며 설치한 팀이 알아챔 → 쏜 적 근처를 팀 지도에 '?'로 (봇도 그쪽을 경계)
    let place = null;
    const owner = m.agentById(dev.ownerId);
    if (reason === 'shot' && by && owner && by.team !== dev.team) {
      place = m.map.calloutAt(by.pos.x, by.pos.z, by.pos.y) ?? null;
      m.shareIntel(owner, { x: by.pos.x, y: by.pos.y, z: by.pos.z, kind: 'report' });
    }
    m.emit('gadgetBroken', { dev, reason, by, place, x: dev.x, y: dev.y, z: dev.z });
  }

  // 세열·C4 폭발: 반경 6할 안(벽 뒤 제외)의 카메라·경보 센서는 부서짐
  blast(at, radius) {
    for (const dev of [...this.cams, ...this.alarms]) {
      const d = Math.hypot(dev.x - at.x, dev.y - at.y, dev.z - at.z);
      if (d > radius * 0.6) continue;
      const out = { x: dev.x + (dev.nx ?? 0) * 0.1, y: dev.y + (dev.ny ?? 0) * 0.1, z: dev.z + (dev.nz ?? 0) * 0.1 };
      if (!this.match.map.lineOfSight(at, out)) continue;
      this.destroy(dev, 'blast');
    }
  }

  // ───── 매 틱 (방장) ─────
  update(dt) {
    const m = this.match;
    if (m.client) return;
    // 경보: 적이 줄을 지나가면
    for (const al of this.alarms) {
      if (this.off(al) || m.time < al.cdUntil) continue;
      const e = m.agents.find((x) => x.alive && x.team !== al.team && beamCrosses(al, x));
      if (e) this.trip(al, e);
    }
    // 카메라를 보는 동안: 화면 안 적은 팀 지도에 (드론과 같음)
    for (const a of m.agents) {
      if (!a.camView || !a.alive) continue;
      a.camView.scanT = (a.camView.scanT ?? 0) - dt;
      if (a.camView.scanT > 0) continue;
      a.camView.scanT = CAM.scanEvery;
      const v = this.view(a);
      if (!v || v.off) continue;
      const fwd = dirFromAngles(v.yaw, v.pitch);
      for (const e of m.agents) {
        if (!e.alive || e.team === a.team) continue;
        const c = chestPos(e);
        const vx = c.x - v.pos.x, vy = c.y - v.pos.y, vz = c.z - v.pos.z;
        const l = Math.hypot(vx, vy, vz);
        if (l > GEAR.cam.range || (l > 1.5 && (vx * fwd.x + vy * fwd.y + vz * fwd.z) / l < CAM.fov)) continue;
        if (m.clearLine(v.pos, c)) e.spottedT = m.time;
      }
    }
  }

  trip(al, e) {
    const m = this.match;
    al.cdUntil = m.time + GEAR.alarm.cooldown;
    al.trippedT = m.time;
    e.revealedUntil = Math.max(e.revealedUntil, m.time + GEAR.alarm.mark);
    e.spottedT = m.time;
    const owner = m.agentById(al.ownerId);
    if (owner) {
      const place = m.map.calloutAt(e.pos.x, e.pos.z, e.pos.y) ?? '경보 센서';
      m.shareIntel(owner, { x: e.pos.x, y: e.pos.y, z: e.pos.z, kind: 'seen' });
      m.radio(owner, `경보: 적 통과 — ${place}`, { kind: 'contact', pos: { ...e.pos }, report: true });
      m.makeNoise(owner, 'alarm', al);
    }
    m.emit('alarmTrip', { alarm: al, agent: e });
  }

  // 심장 박동 센서 (방장·참가자 화면 둘 다: 결과는 같은 함수로)
  stepPulse(a, dt) {
    if (!a.pulseOn) {
      a.pulseT = 0;
      return;
    }
    a.pulseT = (a.pulseT ?? 0) - dt;
    if (a.pulseT > 0) return;
    a.pulseT = PULSE.every;
    const m = this.match;
    a.pulseHits = pulseScan(m.agents, a);
    m.emit('pulse', { agent: a, hits: a.pulseHits.length, near: a.pulseHits[0]?.d ?? null });
    // 봇: 찾은 적 중 가장 가까운 하나를 팀에 무전 (소리로 들은 것과 같은 정보)
    if (!m.client && !a.isPlayer && !a.human && a.pulseHits[0]) {
      const h = a.pulseHits[0];
      m.shareIntel(a, { x: h.x, y: h.y, z: h.z, kind: 'heard' });
    }
  }
}
