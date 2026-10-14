// 문 동작 (레디 오어 낫식): 경기(match)가 매 틱 움직인다. 모양은 door-geo.js.
//   F            열기 / 닫기 — 여는 사람 반대쪽으로 밀어서 열림
//   살짝 열기     틈만 천천히 열어 안을 엿봄 (다시 하면 천천히 닫음)
//   발차기        걷어차 단숨에 엶. 문 뒤에 서 있던 사람은 문에 맞아 휘청. 잠긴 문은 확률로 부서짐
//   문 밑 카메라  닫힌 문 밑으로 카메라를 넣어 건너편을 봄 (보이는 적은 팀에 보임, 클릭하면 5초 표시)
//   폭약(C4)     문에 붙여 터뜨리면 문이 부서지고 건너편 사람은 충격으로 비틀거림
//   산탄총        잠긴 문의 손잡이 쪽을 쏘면 자물쇠가 부서짐
// 문짝은 얇은 판이라 사람·총알·시야·투척물·드론이 모두 막힌다 (나무 문은 관통력 있는 탄이 뚫음).
import { clamp, dirFromAngles } from '../core/vec.js';
import { chestPos, emptyIntent } from './agent.js';
import { PLAYER } from './constants.js';
import { DOOR, DOOR_MAT, closestOnSegment, leafSegment } from './door-geo.js';

export { DOOR, DOOR_MAT };

// 문 밑 카메라 (옵티완드): 문 건너편 바닥 바로 위에서 봄
export const MIRROR = {
  out: 0.3, // 문짝에서 건너편으로 나간 거리
  height: 0.09, // 바닥에서 높이
  yawLimit: 1.35, // 정면에서 좌우로 돌릴 수 있는 각도
  pitchMin: -0.3,
  pitchMax: 0.8,
  fov: 0.42, // 시야 (cos) — 화면이 넓은 광각 카메라
  range: 24,
  mark: 5, // 클릭으로 표시한 적이 팀에 보이는 시간
};

const sign = (v) => (v < 0 ? -1 : 1);

export class Doors {
  constructor(match) {
    this.match = match;
    this.map = match.map;
    this.list = this.map.doors;
    this.reset();
  }

  // 잠긴 문을 열쇠로 열 수 있는 팀 (CQB 작전의 용의자). 없으면 아무도
  get keyTeam() {
    return this.match.doorKeyTeam ?? null;
  }

  // 라운드 시작: 맵(또는 작전)에 정해진 처음 상태로 — 부서진 문도 다시 달림
  reset() {
    for (const d of this.list) {
      const o = { ...d.def, ...(this.match.doorSetup?.[d.id] ?? {}) };
      const ang = o.open ? sign(o.open) * DOOR.open : 0;
      d.st = { ang, tgt: ang, spd: 0, kick: false, locked: !!o.locked, lockHp: DOOR.lockHp, kicks: 0, broken: false, hit: [], blockT: 0, by: null };
    }
    for (const a of this.match.agents ?? []) {
      a.mirror = null;
      a.kickT = 0;
    }
    this.sync();
  }

  // 문짝 선분을 맵에 넣음 (충돌·총알·시야가 씀) + 문에 붙은 C4를 문짝을 따라 옮김
  sync() {
    const leaves = [];
    for (const d of this.list) {
      if (d.st.broken) continue;
      d.leaves.forEach((leaf, k) => {
        const s = leafSegment(d, leaf, d.st.ang);
        leaves.push({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1, y0: DOOR.gap, y1: DOOR.height, door: d.id, leaf: k });
      });
    }
    this.map.leaves = leaves;
    for (const c of this.match.charges ?? []) {
      if (c.doorId == null || !c.onLeaf) continue;
      const d = this.list[c.doorId];
      if (!d || d.st.broken) continue;
      const leaf = d.leaves[c.onLeaf.leaf];
      const s = leafSegment(d, leaf, d.st.ang);
      // 문짝 면의 법선 (붙인 쪽)
      const nx = -s.dz * c.onLeaf.side, nz = s.dx * c.onLeaf.side;
      c.x = leaf.hx + s.dx * c.onLeaf.t + nx * 0.04;
      c.z = leaf.hz + s.dz * c.onLeaf.t + nz * 0.04;
      c.nx = nx;
      c.nz = nz;
    }
  }

  // 문 가운데를 기준으로 어느 쪽에 있는지 (+1: n 쪽)
  side(d, p) {
    return sign((p.x - d.x) * d.n.x + (p.z - d.z) * d.n.z);
  }

  isClosed(d) {
    return !d.st.broken && Math.abs(d.st.ang) < 0.05 && Math.abs(d.st.tgt) < 0.05;
  }

  canOpen(a, d) {
    return !d.st.locked || (this.keyTeam && a.team === this.keyTeam);
  }

  // 손이 닿고 바라보고 있는 문 (가장 가까운 것)
  doorAt(a, reach = DOOR.reach) {
    if (!this.list.length || a.pos.y > 0.8) return null;
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    let best = null, bestS = Infinity;
    for (const d of this.list) {
      if (d.st.broken) continue;
      const dx = d.x - a.pos.x, dz = d.z - a.pos.z;
      const l = Math.hypot(dx, dz);
      if (l > reach) continue;
      const facing = l < 0.5 ? 1 : (dx * fx + dz * fz) / l;
      if (facing < 0.35) continue;
      const score = l * (1.6 - facing);
      if (score < bestS) {
        bestS = score;
        best = d;
      }
    }
    return best;
  }

  // 지금 그 문에 할 수 있는 일 (화면 안내·봇이 씀)
  options(a, d) {
    const st = d.st;
    const closed = Math.abs(st.ang) < 0.05;
    return {
      locked: st.locked && !this.canOpen(a, d),
      closed,
      cracked: !closed && Math.abs(st.tgt) <= DOOR.crack + 0.05 && st.tgt !== 0,
      open: Math.abs(st.tgt) > DOOR.crack + 0.05,
      kick: Math.abs(st.ang) < 0.7,
      mirror: closed && Math.abs(st.tgt) < 0.05,
      charge: (a.gear?.c4 ?? 0) > 0 && Math.abs(st.ang) < 0.3,
    };
  }

  // 문을 돌리기 시작
  swing(d, tgt, spd, a, act) {
    const st = d.st;
    st.tgt = tgt;
    st.spd = spd;
    st.kick = false;
    st.blockT = 0;
    st.by = a?.id ?? null;
    this.match.emit('door', { door: d, act, agent: a });
    if (a) this.match.makeNoise(a, act === 'crack' || act === 'crackClose' ? 'doorQuiet' : 'door', { x: d.x, y: 1, z: d.z });
  }

  rattle(a, d) {
    d.st.knownLocked = true; // 잠긴 걸 확인한 문 (지도에 붉게)
    this.match.emit('door', { door: d, act: 'locked', agent: a });
    this.match.makeNoise(a, 'doorQuiet', { x: d.x, y: 1, z: d.z });
    return true;
  }

  // F: 열기 / 닫기. 문을 다뤘으면 true
  use(a, d = this.doorAt(a)) {
    if (!d) return false;
    const st = d.st;
    const normal = DOOR.open / DOOR.openTime;
    if (Math.abs(st.tgt) >= DOOR.open - 0.05) this.swing(d, 0, normal, a, 'close');
    else if (Math.abs(st.tgt) > 0.05) this.swing(d, sign(st.tgt) * DOOR.open, normal, a, 'open');
    else if (Math.abs(st.ang) > 0.05) this.swing(d, sign(st.ang) * DOOR.open, normal, a, 'open'); // 닫히던 문을 다시 엶
    else if (!this.canOpen(a, d)) return this.rattle(a, d);
    else this.swing(d, -this.side(d, a.pos) * DOOR.open, normal, a, 'open');
    return true;
  }

  // 살짝 열기 / 살짝 닫기 (천천히)
  crack(a, d = this.doorAt(a)) {
    if (!d) return false;
    const st = d.st;
    const slow = (to) => Math.max(DOOR.crack / DOOR.crackTime, Math.abs(st.ang - to) / 1.2);
    if (Math.abs(st.tgt) > DOOR.crack + 0.05) {
      const to = sign(st.tgt) * DOOR.crack;
      this.swing(d, to, slow(to), a, 'crackClose');
    } else if (Math.abs(st.tgt) > 0.05 || Math.abs(st.ang) > 0.05) this.swing(d, 0, slow(0), a, 'crackClose');
    else if (!this.canOpen(a, d)) return this.rattle(a, d);
    else {
      const to = -this.side(d, a.pos) * DOOR.crack;
      this.swing(d, to, slow(to), a, 'crack');
    }
    return true;
  }

  // 발차기: 발을 드는 동안(kickWindup) 기다렸다가 update에서 판정
  kick(a, d = this.doorAt(a)) {
    if (!d || (a.kickT ?? 0) > 0 || Math.abs(d.st.ang) > 0.7) return false;
    a.kickT = DOOR.kickWindup;
    a.kickDoor = d.id;
    this.match.emit('kick', { agent: a, door: d });
    return true;
  }

  resolveKick(a, d) {
    const st = d.st;
    if (st.broken || Math.hypot(d.x - a.pos.x, d.z - a.pos.z) > DOOR.reach + 0.4) return;
    if (Math.abs(st.ang) > 0.7) return;
    const m = this.match;
    m.makeNoise(a, 'kick', { x: d.x, y: 1, z: d.z });
    if (!this.canOpen(a, d)) {
      st.kicks++;
      const chance = DOOR.kickBreak + DOOR.kickBreakAdd * (st.kicks - 1);
      if (m.rng.next() >= chance) {
        m.emit('door', { door: d, act: 'kickFail', agent: a });
        return;
      }
      st.locked = false;
      m.emit('door', { door: d, act: 'lockBreak', agent: a, how: 'kick' });
    }
    st.tgt = -this.side(d, a.pos) * DOOR.open;
    st.spd = DOOR.kickSpeed;
    st.kick = true;
    st.hit = [];
    st.blockT = 0;
    st.by = a.id;
    m.emit('door', { door: d, act: 'kick', agent: a });
  }

  // C4·폭발로 문이 부서짐: 문짝이 날아가고 건너편 사람은 충격으로 비틀거림
  breach(d, at, owner = null) {
    const st = d.st;
    if (st.broken) return false;
    st.broken = true;
    st.locked = false;
    const s = this.side(d, at);
    for (const a of this.match.agents) {
      if (a.mirror?.door === d.id) this.endMirror(a, 'breach');
      if (!a.alive || this.side(d, a.pos) === s) continue;
      const l = Math.hypot(a.pos.x - d.x, a.pos.z - d.z);
      if (l > DOOR.breachRange) continue;
      a.stunT = Math.max(a.stunT ?? 0, DOOR.breachStun * (1 - (l / DOOR.breachRange) * 0.5));
      if (a.lockpick) this.match.cancelLockpick(a, 'stunned');
    }
    this.sync();
    this.match.emit('door', { door: d, act: 'breach', agent: owner, side: s, x: at.x, y: at.y, z: at.z });
    return true;
  }

  // 총알이 문짝에 맞음: 산탄총은 자물쇠를 부수고, 관통력이 충분하면 뚫고 지나감 (true = 계속 날아감)
  shot(d, hit, p) {
    const st = d.st;
    if (p.weapon === 'shotgun' && st.locked && !p.harmless) {
      // 자물쇠: 문 끝(외문) / 두 문짝이 만나는 곳(양문)의 손잡이 높이
      const leaf = d.leaves[hit.leaf ?? 0];
      const s = leafSegment(d, leaf, st.ang);
      const hx = leaf.hx + s.dx * (leaf.len - 0.12), hz = leaf.hz + s.dz * (leaf.len - 0.12);
      if (Math.hypot(hit.x - hx, hit.z - hz, hit.y - 1.0) < DOOR.lockRadius) {
        st.lockHp--;
        if (st.lockHp <= 0) {
          st.locked = false;
          const shooter = this.match.agentById(p.ownerId);
          const from = p.from ?? hit;
          this.match.emit('door', { door: d, act: 'lockBreak', agent: shooter, how: 'shotgun' });
          // 자물쇠가 부서지며 문이 조금 밀려 열림
          const to = -this.side(d, from) * 0.22;
          st.tgt = to;
          st.spd = 2.5;
          st.kick = false;
        }
      }
    }
    const mat = DOOR_MAT[d.mat] ?? DOOR_MAT.wood;
    if (p.harmless || (p.pen ?? 0) < mat.penNeed) return false;
    p.damage *= mat.through;
    p.pen = (p.pen ?? 0) - 1;
    return true;
  }

  // 문짝이 ang에 있을 때 겹치는 사람
  agentsOnLeaf(d, ang) {
    const out = [];
    const R = PLAYER.radius + DOOR.thick / 2 + 0.01;
    for (const a of this.match.agents) {
      if (!a.alive || a.pos.y > DOOR.height || Math.abs(a.pos.x - d.x) > 3 || Math.abs(a.pos.z - d.z) > 3) continue;
      for (const leaf of d.leaves) {
        const s = leafSegment(d, leaf, ang);
        const q = closestOnSegment(a.pos.x, a.pos.z, s.x0, s.z0, s.x1, s.z1);
        if (Math.hypot(a.pos.x - q.x, a.pos.z - q.z) < R) {
          out.push({ a, leaf, s, q });
          break;
        }
      }
    }
    return out;
  }

  // 걷어찬 문이 사람을 침: 문이 도는 쪽으로 밀어내고 휘청이게 함 (한 번만)
  doorHit(d, { a, s, q }, dir) {
    const st = d.st;
    // 문짝이 도는 쪽 (문짝에 수직)
    const nx = -s.dz * dir, nz = s.dx * dir;
    const R = PLAYER.radius + DOOR.thick / 2 + 0.03;
    a.pos.x = q.x + nx * R;
    a.pos.z = q.z + nz * R;
    if (st.hit.includes(a.id)) return;
    st.hit.push(a.id);
    a.vel.x = nx * DOOR.kickKnock;
    a.vel.z = nz * DOOR.kickKnock;
    a.stunT = Math.max(a.stunT ?? 0, DOOR.kickStun);
    a.punch = (a.punch ?? 0) + 0.12;
    if (a.lockpick) this.match.cancelLockpick(a, 'stunned');
    if (a.mirror) this.endMirror(a, 'hit');
    this.match.emit('doorHit', { door: d, agent: a, by: this.match.agentById(st.by) });
  }

  update(dt) {
    const m = this.match;
    const host = !m.client;
    // 발차기: 발을 든 뒤 차는 순간
    for (const a of m.agents) {
      if (!((a.kickT ?? 0) > 0)) continue;
      a.kickT = Math.max(0, a.kickT - dt);
      if (a.kickT === 0 && host && a.alive) {
        const d = this.list[a.kickDoor];
        if (d) this.resolveKick(a, d);
      }
    }
    let dirty = false;
    for (const d of this.list) {
      const st = d.st;
      st.prev = st.ang; // 화면 보간용 (직전 틱 각도)
      if (st.broken || st.ang === st.tgt) continue;
      const step = st.spd * dt;
      const next = st.ang + clamp(st.tgt - st.ang, -step, step);
      if (host) {
        const on = this.agentsOnLeaf(d, next);
        if (on.length) {
          if (st.kick) {
            const dir = sign(st.tgt - st.ang);
            for (const o of on) this.doorHit(d, o, dir);
          } else {
            // 사람이 막고 있으면 멈춰 기다리다가, 오래 막히면 그 자리에 섬
            st.blockT += dt;
            if (st.blockT > 1.2) {
              st.tgt = st.ang;
              st.spd = 0;
            }
            continue;
          }
        }
      }
      st.ang = next;
      dirty = true;
      if (st.ang === st.tgt) {
        if (st.tgt === 0) m.emit('door', { door: d, act: 'shut', agent: null });
        st.kick = false;
        st.spd = 0;
      }
    }
    if (dirty) this.sync();
    if (host) {
      for (const a of m.agents) {
        if (!a.mirror) continue;
        const d = this.list[a.mirror.door];
        if (!a.alive || !d || d.st.broken || Math.abs(d.st.ang) > 0.06 || Math.hypot(a.pos.x - d.x, a.pos.z - d.z) > DOOR.reach + 0.5) this.endMirror(a, 'lost');
      }
    }
  }

  // ───── 문 밑 카메라 ─────
  startMirror(a, d = this.doorAt(a)) {
    if (!d || a.mirror || a.drone || !this.options(a, d).mirror) return false;
    const s = this.side(d, a.pos);
    a.mirror = { door: d.id, side: -s, home: { yaw: a.yaw, pitch: a.pitch } };
    a.ads = false;
    a.reloadT = 0;
    this.match.emit('mirror', { agent: a, door: d, on: true });
    return true;
  }

  endMirror(a, reason = 'off') {
    if (!a.mirror) return;
    const d = this.list[a.mirror.door];
    if (a.mirror.home) {
      a.yaw = a.mirror.home.yaw;
      a.pitch = a.mirror.home.pitch;
    }
    a.mirror = null;
    this.match.emit('mirror', { agent: a, door: d, on: false, reason });
  }

  // 카메라 위치·방향 (조종 입력 yaw·pitch를 카메라가 돌 수 있는 범위로)
  mirrorView(a, yaw = a.mirror?.yaw ?? null, pitch = a.mirror?.pitch ?? 0) {
    const mr = a.mirror;
    const d = mr ? this.list[mr.door] : null;
    if (!d) return null;
    const fx = d.n.x * mr.side, fz = d.n.z * mr.side;
    const base = Math.atan2(-fx, -fz);
    let off = yaw == null ? 0 : yaw - base;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    const y = base + clamp(off, -MIRROR.yawLimit, MIRROR.yawLimit);
    return {
      pos: { x: d.x + fx * MIRROR.out, y: MIRROR.height, z: d.z + fz * MIRROR.out },
      yaw: y,
      pitch: clamp(pitch, MIRROR.pitchMin, MIRROR.pitchMax),
      door: d,
    };
  }

  // 카메라를 쥔 동안: 시점은 카메라로, 왼쪽 클릭 = 적 표시, 움직이거나 F·다시 누르면 거둠
  mirrorControl(a, intent) {
    const mr = a.mirror;
    mr.yaw = intent.yaw;
    mr.pitch = intent.pitch;
    const mark = intent.fire && !mr.fireLatch;
    mr.fireLatch = intent.fire;
    const leave = intent.interact || intent.door === 'mirror' || intent.switchTo || intent.equip || intent.jump || Math.hypot(intent.moveX, intent.moveZ) > 0.3;
    if (leave) {
      this.endMirror(a, 'off');
      return { ...emptyIntent(a), yaw: a.yaw, pitch: a.pitch, crouch: intent.crouch };
    }
    if (mark && !this.match.client) this.mirrorMark(a);
    return { ...emptyIntent(a), crouch: true, yaw: mr.home.yaw, pitch: mr.home.pitch };
  }

  // 카메라 화면 가운데(약 7°)에 보이는 적 → 5초 동안 팀에 보임 + 무전
  mirrorMark(a) {
    const m = this.match;
    const v = this.mirrorView(a);
    if (!v) return null;
    const fwd = dirFromAngles(v.yaw, v.pitch);
    let best = null, bestCos = Math.cos(0.12);
    for (const e of m.agents) {
      if (!e.alive || e.team === a.team) continue;
      const c = chestPos(e);
      const vx = c.x - v.pos.x, vy = c.y - v.pos.y, vz = c.z - v.pos.z;
      const l = Math.hypot(vx, vy, vz);
      if (l > MIRROR.range) continue;
      const cs = (vx * fwd.x + vy * fwd.y + vz * fwd.z) / l;
      if (cs < bestCos || !m.clearLine(v.pos, c)) continue;
      bestCos = cs;
      best = e;
    }
    m.emit('mirrorMark', { agent: a, target: best });
    if (!best) return null;
    best.revealedUntil = Math.max(best.revealedUntil, m.time + MIRROR.mark);
    best.spottedT = m.time;
    const place = m.map.calloutAt(best.pos.x, best.pos.z, best.pos.y) ?? '문 너머';
    m.shareIntel(a, { x: best.pos.x, y: best.pos.y, z: best.pos.z, kind: 'seen' });
    m.radio(a, `문 밑 카메라: 적 확인 — ${place}`, { kind: 'contact', pos: { ...best.pos }, report: true });
    return best;
  }

  // 사람·봇이 쓰는 문 행동 하나 ('open'은 F와 같음)
  act(a, what, d = this.doorAt(a)) {
    // 봇은 문 번호를 직접 고름: 손이 닿는 거리인지만 확인
    if (!d || d.st.broken || Math.hypot(d.x - a.pos.x, d.z - a.pos.z) > DOOR.reach + 0.3) return false;
    if (what === 'open') return this.use(a, d);
    if (what === 'crack') return this.crack(a, d);
    if (what === 'kick') return this.kick(a, d);
    if (what === 'mirror') return a.mirror ? (this.endMirror(a, 'off'), true) : this.startMirror(a, d);
    if (what === 'charge') return this.match.placeDoorCharge(a, d);
    return false;
  }

  // 온라인: [각도, 목표 각도, 빠르기, 상태 비트(1 잠김 · 2 부서짐 · 4 발차기)]
  pack() {
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return this.list.map((d) => {
      const st = d.st;
      return [r3(st.ang), r3(st.tgt), Math.round(st.spd * 10) / 10, (st.locked ? 1 : 0) | (st.broken ? 2 : 0) | (st.kick ? 4 : 0)];
    });
  }

  unpack(arr) {
    if (!Array.isArray(arr)) return;
    let dirty = false;
    arr.forEach((v, i) => {
      const d = this.list[i];
      if (!d || !Array.isArray(v)) return;
      const st = d.st;
      const broken = !!(v[3] & 2);
      if (st.ang !== v[0] || st.broken !== broken) dirty = true;
      st.ang = v[0];
      st.tgt = v[1];
      st.spd = v[2];
      st.locked = !!(v[3] & 1);
      st.broken = broken;
      st.kick = !!(v[3] & 4);
    });
    if (dirty) this.sync();
  }
}
