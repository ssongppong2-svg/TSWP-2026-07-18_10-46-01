import { anglesFromDir, clamp, wrapAngle } from '../core/vec.js';
import { emptyIntent, eyePos } from '../sim/agent.js';
import { PLAYER, TEAMS } from '../sim/constants.js';
import { PATCHES, WEAPONS } from '../sim/data.js';

export const DIFFICULTY = {
  easy: { name: '쉬움', reaction: 0.6, aimError: 0.075, turnSpeed: 4.5, headChance: 0.1, burst: [2, 4], lead: 0.3, recoilComp: 0.3, patchSkill: 0.45, holdFireVeil: false },
  normal: { name: '보통', reaction: 0.4, aimError: 0.045, turnSpeed: 7, headChance: 0.22, burst: [3, 5], lead: 0.6, recoilComp: 0.6, patchSkill: 0.75, holdFireVeil: true },
  hard: { name: '어려움', reaction: 0.25, aimError: 0.025, turnSpeed: 11, headChance: 0.4, burst: [4, 7], lead: 0.9, recoilComp: 0.85, patchSkill: 1, holdFireVeil: true },
};

const anglesTo = (from, to) => anglesFromDir({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// 봇 한 명의 두뇌. Match가 매 틱 getIntent를 불러 "무엇을 누를지"를 받아갑니다.
export class BotBrain {
  constructor(agent, match, difficulty = 'normal', index = 0) {
    this.d = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
    this.rng = match.rng;
    this.index = index;
    this.aimYaw = agent.yaw;
    this.aimPitch = 0;
    this.err = { y: 0, p: 0 };
    this.jit = { y: 0, p: 0 };
    this.jitT = 0;
    this.thinkT = this.rng.range(0, 0.3);
    this.startDelay = this.rng.range(0, 1.2);
    this.path = null;
    this.pathIdx = 0;
    this.pathGoal = null;
    this.repathT = 0;
    this.goal = null;
    this.targetId = null;
    this.reactLeft = 0;
    this.aimHead = false;
    this.lastSeen = null;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.tapT = 0;
    this.strafeDir = 1;
    this.strafeT = 0;
    this.stuckT = 0;
    this.stuckRef = { x: agent.pos.x, z: agent.pos.z };
    this.stuckClock = 0;
    this.pending = null;
    this.alertLook = null;
    this.scanT = 0;
    this.scanOffset = 0;
    this.wantLockpick = false;
    this.assignRoles(agent, match);
  }

  assignRoles(agent, match) {
    const map = match.map;
    if (agent.team === TEAMS.DEFUSE) {
      this.assignedBomb = this.index % 2 === 0 ? 'A' : 'B';
    } else {
      const order = [
        ['A', 0], ['B', 0], ['A', 1], ['B', 1], ['mid', 0],
      ];
      const [site, i] = order[this.index % order.length];
      const list = map.holds[site] ?? [];
      this.homeSite = site;
      this.hold = list[i] ?? list[0] ?? null;
      if (!this.hold) {
        const b = map.bombs[this.index % map.bombs.length];
        this.hold = { x: b.x, z: b.z + 3, lookX: b.x, lookZ: b.z + 10 };
      }
    }
  }

  // ───────────────────────── 매 틱 ─────────────────────────
  getIntent(match, a, dt) {
    const intent = emptyIntent(a);
    const live = match.phase === 'live';
    const eye = eyePos(a);
    this.startDelay -= dt;

    this.updateTarget(match, a, dt);
    const target = this.targetId ? match.agentById(this.targetId) : null;
    const visible = !!target && (a.visibleEnemies ?? []).includes(target.id);

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.22 + this.rng.next() * 0.12;
      if (live) this.think(match, a, target, visible);
    }

    // ── 조준 방향 정하기
    let desired = null;
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) this.pending = null;
      else desired = anglesTo(eye, this.pending.point);
    }
    if (!desired && target && (visible || this.lastSeen)) {
      const w = WEAPONS[a.weapon];
      const tp = visible ? target.pos : this.lastSeen;
      const d = Math.hypot(tp.x - eye.x, tp.z - eye.z);
      const lead = visible ? (d / w.speed) * this.d.lead : 0;
      const aimY = this.aimHead ? PLAYER.headY : 1.15;
      desired = anglesTo(eye, {
        x: tp.x + (visible ? target.vel.x * lead : 0),
        y: tp.y + aimY,
        z: tp.z + (visible ? target.vel.z * lead : 0),
      });
    }
    if (!desired && a.lockpick) {
      const b = match.bombById(a.lockpick.bombId);
      if (b) desired = anglesTo(eye, { x: b.x, y: 0.4, z: b.z });
    }
    if (!desired && this.alertLook && this.alertLook.until > match.time) {
      desired = anglesTo(eye, this.alertLook.point);
      desired.pitch = clamp(desired.pitch, -0.2, 0.2);
    }

    // ── 이동 방향 정하기
    let wish = null;
    if (live && this.startDelay <= 0 && !a.lockpick && this.goal?.point) {
      wish = this.navigate(match, a, this.goal.point.x, this.goal.point.z, this.goal.arrive ?? 0.8, dt);
    }
    if (!desired) {
      if (wish && Math.hypot(wish.x, wish.z) > 0.1) {
        desired = { yaw: Math.atan2(-wish.x, -wish.z), pitch: 0 };
      } else if (this.goal?.look) {
        this.scanT -= dt;
        if (this.scanT <= 0) {
          this.scanT = this.rng.range(1.2, 2.6);
          this.scanOffset = this.rng.range(-0.45, 0.45);
        }
        desired = anglesTo(eye, { ...this.goal.look, y: eye.y });
        desired.yaw += this.scanOffset;
      } else {
        desired = { yaw: this.aimYaw, pitch: 0 };
      }
    }

    this.turnToward(desired, dt);
    this.updateError(dt);
    intent.yaw = this.aimYaw + this.err.y;
    intent.pitch = clamp(this.aimPitch + this.err.p - a.recoil * this.d.recoilComp, -1.4, 1.4);

    // ── 전투
    const veilActive = a.patches.some((p) => p.id === 'gravityVeil' && p.activeT > 0);
    let engaging = false;
    if (live && visible && target && !a.lockpick) {
      engaging = true;
      const targetVeiled = match.veils.some((v) => v.ownerId === target.id) && dist2(a.pos, target.pos) > 3;
      const holdFire = veilActive || (this.d.holdFireVeil && targetVeiled);
      const aimDiff = Math.hypot(wrapAngle(desired.yaw - this.aimYaw), desired.pitch - this.aimPitch);
      const d = Math.hypot(target.pos.x - a.pos.x, target.pos.z - a.pos.z);
      const tol = Math.max(0.03, 0.55 / Math.max(d, 1));
      if (!holdFire && this.reactLeft <= 0 && aimDiff < tol) this.shoot(a, intent, dt);
      else this.burstLeft = 0;
      // 쏠 때는 멈추고(정확도), 쉬는 동안 좌우로 움직임
      if (!intent.fire || a.weapon === 'pistol') {
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafeT = this.rng.range(0.3, 0.75);
          this.strafeDir = this.rng.chance(0.5) ? 1 : -1;
        }
        intent.moveX = this.strafeDir;
      }
      if (veilActive && wish) {
        this.applyWish(intent, wish);
        intent.moveX = 0;
      }
    } else if (wish) {
      this.applyWish(intent, wish);
    }

    // ── 무기 관리
    const rifle = a.weapons.rifle;
    if (a.weapon === 'rifle' && rifle.mag + rifle.reserve === 0) intent.switchTo = 'pistol';
    else if (a.weapon === 'pistol' && rifle.mag + rifle.reserve > 0 && !engaging) intent.switchTo = 'rifle';
    if (!engaging && a.weapons[a.weapon].mag < WEAPONS[a.weapon].magSize * 0.4) intent.reload = true;

    // ── 락픽
    if (live && a.team === TEAMS.DEFUSE) {
      if (a.lockpick) {
        const danger = (a.visibleEnemies ?? []).some((id) => {
          const e = match.agentById(id);
          return e && dist2(e.pos, a.pos) < 15;
        });
        if (danger) intent.interact = true;
      } else if (this.wantLockpick && !engaging) {
        intent.interact = true;
        this.wantLockpick = false;
      }
    }

    // ── 대기 중이던 포스 패치 발동
    if (this.pending && live) {
      const aimErr = Math.hypot(wrapAngle(desired.yaw - this.aimYaw), (desired.pitch - this.aimPitch) * (this.pending.yawOnly ? 0 : 1));
      if (aimErr < 0.06) {
        intent.yaw = this.aimYaw;
        intent.pitch = this.aimPitch;
        intent.patch[this.pending.slot] = true;
        this.pending = null;
      }
    }
    if (this.nowPatch !== undefined && this.nowPatch !== null) {
      intent.patch[this.nowPatch] = true;
      this.nowPatch = null;
    }

    // ── 끼임 방지
    if (wish && !engaging && live) this.unstick(match, a, intent, dt);
    return intent;
  }

  applyWish(intent, wish) {
    const yaw = intent.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    intent.moveZ = wish.x * fx + wish.z * fz;
    intent.moveX = wish.x * rx + wish.z * rz;
  }

  turnToward(desired, dt) {
    const max = this.d.turnSpeed * dt;
    this.aimYaw = wrapAngle(this.aimYaw + clamp(wrapAngle(desired.yaw - this.aimYaw), -max, max));
    this.aimPitch += clamp(desired.pitch - this.aimPitch, -max, max);
  }

  updateError(dt) {
    this.jitT -= dt;
    if (this.jitT <= 0) {
      this.jitT = 0.25;
      const e = this.d.aimError * 0.35;
      this.jit.y = this.rng.range(-e, e);
      this.jit.p = this.rng.range(-e, e) * 0.6;
    }
    const k = 1 - Math.exp(-dt / (this.d.reaction * 0.9));
    this.err.y += (this.jit.y - this.err.y) * k;
    this.err.p += (this.jit.p - this.err.p) * k;
    this.reactLeft -= dt;
  }

  updateTarget(match, a, dt) {
    const vis = a.visibleEnemies ?? [];
    let best = null, bestD = Infinity;
    for (const id of vis) {
      const e = match.agentById(id);
      if (!e?.alive) continue;
      const d = dist2(e.pos, a.pos);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) {
      if (best.id !== this.targetId) {
        // 새 적 발견: 반응 시간 + 큰 조준 오차에서 시작
        this.targetId = best.id;
        this.reactLeft = this.d.reaction * this.rng.range(0.8, 1.3);
        const e = this.d.aimError * 3;
        this.err.y = this.rng.range(-e, e);
        this.err.p = this.rng.range(-e, e) * 0.5;
        this.aimHead = this.rng.chance(this.d.headChance);
      }
      this.lastSeen = { x: best.pos.x, y: best.pos.y, z: best.pos.z, t: match.time };
      return;
    }
    const cur = this.targetId ? match.agentById(this.targetId) : null;
    if (!cur?.alive || !this.lastSeen || match.time - this.lastSeen.t > 1.2) {
      this.targetId = null;
      this.lastSeen = null;
    }
  }

  shoot(a, intent, dt) {
    const w = WEAPONS[a.weapon];
    if (w.auto) {
      if (this.burstPause > 0) {
        this.burstPause -= dt;
        return;
      }
      if (this.burstLeft <= 0) this.burstLeft = this.rng.int(this.d.burst[0], this.d.burst[1]);
      intent.fire = true;
      if (a.fireCd <= dt) {
        this.burstLeft--;
        if (this.burstLeft <= 0) this.burstPause = this.rng.range(0.22, 0.45);
      }
    } else {
      this.tapT -= dt;
      if (this.tapT <= 0) {
        intent.fire = true;
        this.tapT = this.rng.range(0.2, 0.36);
      }
    }
  }

  // ───────────────────────── 판단 (0.25초마다) ─────────────────────────
  think(match, a, target, visible) {
    // 맞았는데 적이 안 보이면 맞은 쪽을 봄
    if (!visible && a.lastHurtBy && match.time - a.lastHurtT < 0.6) {
      const src = match.agentById(a.lastHurtBy);
      if (src) this.alertLook = { point: { x: src.pos.x, y: src.pos.y + 1.2, z: src.pos.z }, until: match.time + 1.5 };
    }
    // 가까운 총소리
    if (!visible && !(this.alertLook?.until > match.time)) {
      for (const n of match.noises) {
        if (n.team === a.team) continue;
        if (Math.hypot(n.x - a.pos.x, n.z - a.pos.z) < 28) {
          this.alertLook = { point: { x: n.x, y: 1.4, z: n.z }, until: match.time + 1.2 };
          break;
        }
      }
    }
    if (a.team === TEAMS.DEFUSE) this.thinkDefuser(match, a, visible);
    else this.thinkForce(match, a, visible);
    if (!a.lockpick && !a.held && !this.pending && this.rng.next() < this.d.patchSkill) this.considerPatches(match, a, target, visible);
  }

  thinkDefuser(match, a, visible) {
    const armed = match.bombs.filter((b) => b.state === 'armed');
    if (!armed.length) {
      this.goal = null;
      return;
    }
    let bomb = armed.find((b) => b.id === this.assignedBomb) ?? armed[0];
    if (bomb.picker && bomb.picker !== a.id) {
      const free = armed.find((b) => !b.picker);
      if (free) bomb = free;
    }
    this.assignedBomb = bomb.id;
    if (bomb.picker && bomb.picker !== a.id) {
      // 동료가 락픽 중 → 옆에서 엄호
      const ang = this.index * 1.7;
      this.goal = {
        point: { x: bomb.x + Math.cos(ang) * 3, z: bomb.z + Math.sin(ang) * 3 },
        look: { x: bomb.x, z: bomb.z - 12 },
        arrive: 1.2,
      };
      return;
    }
    this.goal = { point: { x: bomb.x, z: bomb.z }, arrive: 1.0, look: { x: bomb.x, z: bomb.z - 10 } };
    const d = dist2(a.pos, bomb);
    const nearbyEnemy = (a.visibleEnemies ?? []).length > 0;
    if (d < 1.6 && !a.lockpick && !nearbyEnemy && !bomb.picker) this.wantLockpick = true;
  }

  thinkForce(match, a, visible) {
    const armed = match.bombs.filter((b) => b.state === 'armed');
    const alerted = armed.find((b) => b.picker);
    if (alerted) {
      const respond = this.homeSite === alerted.id || this.homeSite === 'mid' || match.time - alerted.alertT < 0.3 || armed.length === 1;
      if (respond) {
        this.goal = { point: { x: alerted.x, z: alerted.z }, arrive: 3, look: { x: alerted.x, z: alerted.z } };
        return;
      }
    }
    let hold = this.hold;
    if (armed.length === 1 && this.homeSite !== armed[0].id) {
      const list = match.map.holds[armed[0].id] ?? [];
      hold = list[this.index % Math.max(1, list.length)] ?? hold;
      // 같은 자리에 겹치지 않게 살짝 비킴
      hold = { ...hold, x: hold.x + ((this.index % 3) - 1) * 1.4 };
    }
    // 미드 담당은 시간이 지나면 최근에 발견된 적을 사냥
    if (this.homeSite === 'mid' && match.timeLeft < 95) {
      const known = match.agents
        .filter((e) => e.alive && e.team !== a.team && match.time - e.spottedT < 3)
        .sort((p, q) => dist2(p.pos, a.pos) - dist2(q.pos, a.pos))[0];
      if (known && dist2(known.pos, a.pos) < 30) {
        this.goal = { point: { x: known.spottedPos.x, z: known.spottedPos.z }, arrive: 2, look: { x: known.pos.x, z: known.pos.z } };
        return;
      }
    }
    this.goal = { point: { x: hold.x, z: hold.z }, arrive: 0.6, look: { x: hold.lookX, z: hold.lookZ } };
  }

  considerPatches(match, a, target, visible) {
    const eye = eyePos(a);
    a.patches.forEach((p, slot) => {
      if (this.pending || this.nowPatch != null) return;
      const def = PATCHES[p.id];
      const ready = def.tier === 'ultimate' ? a.ult >= 100 : p.cd <= 0;
      if (!ready) return;
      const td = target ? dist2(target.pos, a.pos) : Infinity;
      switch (p.id) {
        case 'gravityVeil':
          if (match.time - a.lastHurtT < 0.5 && a.hp < 80) this.nowPatch = slot;
          break;
        case 'resultantAmp':
          if (visible && a.weapon === 'rifle' && this.reactLeft <= 0.1 && td < 45) this.nowPatch = slot;
          break;
        case 'elasticPad': {
          if (visible || !this.path || this.pathIdx >= this.path.length) break;
          const wp = this.path[this.pathIdx];
          const d = dist2(wp, a.pos);
          if (d > 11 && a.onGround && match.nav.clearLine(a.pos.x, a.pos.z, wp.x, wp.z, 0.5) && this.rng.chance(0.35)) {
            this.pending = { slot, point: { x: wp.x, y: eye.y, z: wp.z }, t: 0.8, yawOnly: true };
          }
          break;
        }
        case 'frictionZero':
          if (visible && td > 5 && td < def.range - 2) {
            this.pending = { slot, point: { x: target.pos.x, y: target.pos.y + 0.05, z: target.pos.z }, t: 0.9 };
          }
          break;
        case 'gravityCollapse': {
          if (!visible) break;
          const seen = (a.visibleEnemies ?? []).map((id) => match.agentById(id)).filter((e) => e?.alive);
          let best = null, bestScore = 0;
          for (const e of seen) {
            if (dist2(e.pos, a.pos) > def.range - 2) continue;
            const group = seen.filter((o) => dist2(o.pos, e.pos) < 6);
            let score = group.length;
            if (e.lockpick) score += 2;
            if (a.hp < 50) score += 1;
            if (score > bestScore) {
              bestScore = score;
              best = e;
            }
          }
          if (best && bestScore >= 2) {
            this.pending = { slot, point: { x: best.pos.x, y: best.pos.y + 0.05, z: best.pos.z }, t: 1 };
          }
          break;
        }
        default:
          break;
      }
    });
  }

  // ───────────────────────── 길찾기 ─────────────────────────
  navigate(match, a, gx, gz, arrive, dt) {
    this.repathT -= dt;
    const goalMoved = !this.pathGoal || Math.hypot(this.pathGoal.x - gx, this.pathGoal.z - gz) > 1.5;
    if (!this.path || goalMoved || this.repathT <= 0) {
      this.path = match.nav.findPath(a.pos.x, a.pos.z, gx, gz) ?? [];
      this.pathIdx = 0;
      this.pathGoal = { x: gx, z: gz };
      this.repathT = 4;
    }
    const p = this.path;
    while (this.pathIdx < p.length) {
      const last = this.pathIdx === p.length - 1;
      if (dist2(a.pos, p[this.pathIdx]) < (last ? arrive : 0.7)) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= p.length) return null;
    const wp = p[this.pathIdx];
    const dx = wp.x - a.pos.x, dz = wp.z - a.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  unstick(match, a, intent, dt) {
    this.stuckClock += dt;
    if (this.stuckClock < 0.8) return;
    const moved = Math.hypot(a.pos.x - this.stuckRef.x, a.pos.z - this.stuckRef.z);
    this.stuckClock = 0;
    this.stuckRef = { x: a.pos.x, z: a.pos.z };
    if (moved < 0.4) {
      this.stuckT += 0.8;
      intent.jump = true;
      if (this.stuckT > 1.6) {
        this.path = null;
        this.stuckT = 0;
      }
    } else {
      this.stuckT = 0;
    }
  }
}

// 팀별로 봇 두뇌 붙이기
export function attachBots(match, difficulty) {
  const counters = { defuse: 0, force: 0 };
  for (const a of match.agents) {
    if (a.isPlayer) {
      counters[a.team]++;
      continue;
    }
    match.setController(a.id, new BotBrain(a, match, difficulty, counters[a.team]++));
  }
}
