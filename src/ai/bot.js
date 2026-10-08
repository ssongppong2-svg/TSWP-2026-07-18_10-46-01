import { anglesFromDir, clamp, wrapAngle } from '../core/vec.js';
import { chestPos, emptyIntent, eyePos } from '../sim/agent.js';
import { TEAMS } from '../sim/constants.js';
import { ARMOR, PATCHES, WEAPONS } from '../sim/data.js';

export const DIFFICULTY = {
  easy: { name: '신병', reaction: 0.65, aimError: 0.08, turnSpeed: 4.5, headChance: 0.06, burst: [2, 3], lead: 0.3, recoilComp: 0.4, patchSkill: 0.45, holdFireVeil: false, hearing: 0.75 },
  normal: { name: '정규', reaction: 0.42, aimError: 0.05, turnSpeed: 7, headChance: 0.14, burst: [2, 4], lead: 0.6, recoilComp: 0.65, patchSkill: 0.75, holdFireVeil: true, hearing: 0.9 },
  hard: { name: '정예', reaction: 0.28, aimError: 0.03, turnSpeed: 10, headChance: 0.25, burst: [3, 5], lead: 0.9, recoilComp: 0.85, patchSkill: 1, holdFireVeil: true, hearing: 1 },
};

const anglesTo = (from, to) => anglesFromDir({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// 무전 문구
const NOISE_TEXT = {
  step: '발소리', land: '착지음', rifle: '소총 사격음', pistol: '권총 사격음', sheriff: '리볼버 사격음', shotgun: '산탄총 사격음',
  smg: '기관단총 사격음', sniper: '저격총 사격음', reload: '재장전 소리', knife: '근접 공격음', patch: '장비 작동음', lockpick: '해체 작업음',
};
const COMPASS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
const compass = (dx, dz) => COMPASS[Math.round(((Math.atan2(dx, -dz) / (Math.PI * 2)) * 8 + 8)) % 8];
const ORDER_ACK = {
  regroup: '수신. 분대장 위치로 집결.',
  hold: '수신. 현 위치 사수.',
  move: '수신. 지정 지점으로 이동.',
  free: '수신. 자율 교전.',
};

// 봇 한 명의 두뇌. Match가 매 틱 getIntent를 불러 "무엇을 누를지"를 받아간다.
// 적의 위치는 자기 눈으로 보거나, 소리를 듣거나, 아군 무전으로만 안다.
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
    this.crouchShooter = this.rng.chance(0.45);
    this.heardId = 0; // 마지막으로 처리한 소리 id
    this.heard = null; // 최근에 들은 적 소리 { x, z, t, kind }
    this.pauseT = 0; // 소리를 듣고 멈춰 경계하는 시간
    this.pauseCrouch = false;
    this.radioT = -99;
    this.orderId = null;
    this.orderHold = null;
    this.ackT = -1;
    this.pushDelay = this.rng.range(0, 5);
    this.holdCrouch = this.rng.chance(0.5);
    this.assignRoles(agent, match);
  }

  assignRoles(agent, match) {
    const map = match.map;
    if (agent.team === TEAMS.DEFUSE) {
      const style = match.botPlan?.defuse?.style ?? 'split';
      const side = style === 'stackA' ? 'A' : style === 'stackB' ? 'B' : this.index % 2 === 0 ? 'A' : 'B';
      this.assignedBomb = side;
      // 한 명은 중앙으로 돌아 들어감
      this.stageSide = this.index === 4 ? 'mid' : side;
      const list = map.staging[this.stageSide] ?? map.staging[side] ?? [];
      this.stage = list[this.index % Math.max(1, list.length)] ?? null;
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
    this.pauseT -= dt;

    this.updateTarget(match, a, dt);
    const target = this.targetId ? match.agentById(this.targetId) : null;
    const visible = !!target && (a.visibleEnemies ?? []).includes(target.id);

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.22 + this.rng.next() * 0.12;
      if (live) this.think(match, a, target, visible);
    }
    if (this.ackT > 0) {
      this.ackT -= dt;
      if (this.ackT <= 0) this.sendAck(match, a);
    }
    if (this.reportAck) {
      this.reportAck.t -= dt;
      if (this.reportAck.t <= 0) {
        if (a.alive) match.radio(a, this.reportAck.text, { kind: 'ack' });
        this.reportAck = null;
      }
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
      const lead = visible && w.speed ? (d / w.speed) * this.d.lead : 0;
      // 머리·가슴 높이는 상대가 앉았는지·기울였는지 반영
      const aimAt = visible ? (this.aimHead ? eyePos(target) : chestPos(target)) : { x: tp.x, y: tp.y + 1.15, z: tp.z };
      desired = anglesTo(eye, {
        x: aimAt.x + (visible ? target.vel.x * lead : 0),
        y: aimAt.y,
        z: aimAt.z + (visible ? target.vel.z * lead : 0),
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

    // ── 이동 방향 정하기 (소리를 듣고 경계 중이면 멈춤)
    let wish = null;
    const paused = this.pauseT > 0 && !visible && !this.goal?.urgent;
    if (live && this.startDelay <= 0 && !a.lockpick && this.goal?.point && !paused) {
      wish = this.navigate(match, a, this.goal.point.x, this.goal.point.z, this.goal.arrive ?? 0.8, dt);
    }
    if (!desired) {
      if (wish && Math.hypot(wish.x, wish.z) > 0.1) {
        desired = { yaw: Math.atan2(-wish.x, -wish.z), pitch: 0 };
      } else if (this.goal?.look) {
        this.scanT -= dt;
        if (this.scanT <= 0) {
          this.scanT = this.rng.range(1.4, 3.2);
          this.scanOffset = this.rng.range(-0.45, 0.45);
        }
        desired = anglesTo(eye, { ...this.goal.look, y: eye.y });
        desired.yaw += this.scanOffset;
      } else {
        desired = { yaw: this.aimYaw, pitch: 0 };
      }
    }

    this.turnToward(desired, dt);
    this.updateError(dt, target ? dist2(target.pos, a.pos) : 10);
    // 반동·피격 반동을 실력만큼 상쇄
    intent.yaw = this.aimYaw + this.err.y - a.recoilYaw * this.d.recoilComp;
    intent.pitch = clamp(this.aimPitch + this.err.p - (a.recoil + a.punch) * this.d.recoilComp, -1.4, 1.4);

    // ── 전투
    const veilActive = a.patches.some((p) => p?.id === 'gravityVeil' && p.activeT > 0);
    let engaging = false;
    if (live && visible && target && !a.lockpick) {
      engaging = true;
      const targetVeiled = match.veils.some((v) => v.ownerId === target.id) && dist2(a.pos, target.pos) > 3;
      const holdFire = veilActive || (this.d.holdFireVeil && targetVeiled);
      const aimDiff = Math.hypot(wrapAngle(desired.yaw - this.aimYaw), desired.pitch - this.aimPitch);
      const d = Math.hypot(target.pos.x - a.pos.x, target.pos.z - a.pos.z);
      const tol = Math.max(0.025, 0.5 / Math.max(d, 1));
      if (!holdFire && this.reactLeft <= 0 && aimDiff < tol) this.shoot(a, intent, dt);
      else this.burstLeft = 0;
      // 먼 거리는 정조준 (저격총은 항상 조준경), 연사할 때는 가끔 앉아서 쏨
      const wpn = WEAPONS[a.weapon];
      intent.ads = wpn.scope || (a.weapon === 'rifle' && d > 14);
      if (wpn.scope && a.adsT < 0.9) intent.fire = false;
      if (intent.fire && d > 8 && this.crouchShooter && wpn.auto) intent.crouch = true;
      // 쏠 때는 멈추고(정확도), 쉬는 동안 좌우로 조금 움직임 (권총·기관단총·산탄총은 움직이며 쏨)
      const runAndGun = a.weapon === 'pistol' || a.weapon === 'smg' || a.weapon === 'shotgun';
      if (!intent.fire || runAndGun) {
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafeT = this.rng.range(0.35, 0.8);
          this.strafeDir = this.rng.chance(0.5) ? 1 : -1;
        }
        intent.moveX = this.strafeDir;
        intent.walk = true;
      }
      if (veilActive && wish) {
        this.applyWish(intent, wish);
        intent.moveX = 0;
      }
    } else if (wish) {
      this.applyWish(intent, wish);
      // 적이 있을 만한 곳에서는 소리를 내지 않게 걷는다
      intent.walk = !!this.goal?.quiet;
    }
    if (!engaging && paused) intent.crouch = this.pauseCrouch;
    if (!engaging && !wish && this.goal?.crouchAtGoal && !a.lockpick) intent.crouch = true;

    // ── 무기 관리
    const prim = a.primary ? a.weapons[a.primary] : null;
    const primAmmo = prim ? prim.mag + prim.reserve : 0;
    const far = target && dist2(target.pos, a.pos) > 18;
    if (a.weapon === 'knife') intent.switchTo = primAmmo > 0 ? a.primary : a.secondary;
    else if (a.weapon === a.primary && primAmmo === 0) intent.switchTo = a.secondary;
    else if (a.weapon === 'shotgun' && engaging && far && a.weapons[a.secondary]?.mag > 0) intent.switchTo = a.secondary;
    else if (a.weapon === a.secondary && primAmmo > 0 && !engaging) intent.switchTo = a.primary;
    if (!engaging && !WEAPONS[a.weapon].melee && a.weapons[a.weapon].mag < WEAPONS[a.weapon].magSize * 0.4 && this.pauseT <= 0) intent.reload = true;

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

  updateError(dt, range = 10) {
    this.jitT -= dt;
    if (this.jitT <= 0) {
      this.jitT = 0.25;
      // 멀수록(어둡고 비 오는 밤) 조준이 흔들림
      const e = this.d.aimError * 0.35 * (1 + Math.max(0, range - 10) / 22);
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
        // 새 적 발견: 반응 시간(멀수록 알아보기 늦음) + 큰 조준 오차에서 시작
        this.targetId = best.id;
        // 멈춰서 그쪽을 미리 겨누고 있었으면 빨리, 움직이던 중이면 늦게 반응 (각 잡기의 이점)
        const off = Math.abs(wrapAngle(anglesTo(eyePos(a), chestPos(best)).yaw - this.aimYaw));
        const still = Math.hypot(a.vel.x, a.vel.z) < 0.6;
        const k = still && off < 0.45 ? 0.6 : still ? 0.9 : 1.15;
        this.reactLeft = this.d.reaction * this.rng.range(0.8, 1.3) * (1 + bestD / 45) * k;
        const e = this.d.aimError * 3;
        this.err.y = this.rng.range(-e, e);
        this.err.p = this.rng.range(-e, e) * 0.5;
        this.aimHead = this.rng.chance(this.d.headChance);
      }
      this.lastSeen = { x: best.pos.x, y: best.pos.y, z: best.pos.z, t: match.time };
      return;
    }
    const cur = this.targetId ? match.agentById(this.targetId) : null;
    if (!cur?.alive || !this.lastSeen || match.time - this.lastSeen.t > 1.5) {
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
        if (this.burstLeft <= 0) this.burstPause = this.rng.range(0.28, 0.55);
      }
    } else {
      this.tapT -= dt;
      if (this.tapT <= 0) {
        intent.fire = true;
        this.tapT = this.rng.range(0.28, 0.45);
      }
    }
  }

  // ───────────────────────── 판단 (0.25초마다) ─────────────────────────
  think(match, a, target, visible) {
    // 맞았는데 적이 안 보이면 총소리가 난 쪽을 봄 (총성은 아래 청각에서 처리)
    this.listen(match, a, visible);
    this.hearReport(match, a);
    // 아군 무전: 최근에 보고된 소리 위치를 경계
    if (!visible && !(this.alertLook?.until > match.time)) {
      const intel = match.intel[a.team]
        .filter((i) => match.time - i.t < 5 && i.reporterId !== a.id && dist2(i, a.pos) < 30)
        .sort((p, q) => dist2(p, a.pos) - dist2(q, a.pos))[0];
      if (intel) this.alertLook = { point: { x: intel.x, y: 1.4, z: intel.z }, until: match.time + 1.5 };
    }
    // 아군이 지금 보고 있는 적 (미니맵에 뜨는 적과 같음)
    if (!visible && !(this.alertLook?.until > match.time)) {
      const spotted = match.agents
        .filter((e) => e.alive && e.team !== a.team && match.time - e.spottedT < 0.4 && dist2(e.pos, a.pos) < 35)
        .sort((p, q) => dist2(p.pos, a.pos) - dist2(q.pos, a.pos))[0];
      if (spotted) this.alertLook = { point: { x: spotted.pos.x, y: spotted.pos.y + 1.2, z: spotted.pos.z }, until: match.time + 0.8 };
    }
    // 무게 감지기에 잡힌 적 (아군 장비가 알려 줌)
    if (!visible && !(this.alertLook?.until > match.time)) {
      const known = match.agents
        .filter((e) => e.alive && e.team !== a.team && e.revealedUntil > match.time && dist2(e.pos, a.pos) < 30)
        .sort((p, q) => dist2(p.pos, a.pos) - dist2(q.pos, a.pos))[0];
      if (known) this.alertLook = { point: { x: known.pos.x, y: known.pos.y + 1.2, z: known.pos.z }, until: match.time + 0.6 };
    }

    const order = this.followOrder(match, a);
    if (!order) {
      if (a.team === TEAMS.DEFUSE) this.thinkDefuser(match, a, visible);
      else this.thinkForce(match, a, visible);
    }
    if (!a.lockpick && !a.held && !this.pending && this.rng.next() < this.d.patchSkill) this.considerPatches(match, a, target, visible);
  }

  // 청각: 들을 수 있는 거리 안의 적 소리 → 그쪽을 보고, 가까우면 멈춰 경계, 무전으로 보고
  listen(match, a, visible) {
    let best = null, bestScore = 0;
    for (const n of match.noises) {
      if (n.id <= this.heardId) continue;
      if (n.team === a.team) continue;
      const d = Math.hypot(n.x - a.pos.x, n.z - a.pos.z);
      if (d > n.radius * this.d.hearing) continue;
      const score = n.radius / Math.max(4, d);
      if (score > bestScore) {
        bestScore = score;
        best = { n, d };
      }
    }
    for (const n of match.noises) this.heardId = Math.max(this.heardId, n.id);
    if (!best) return;
    const { n, d } = best;
    // 소리로 짐작한 위치 (멀수록 부정확)
    const e = d * 0.12;
    const guess = { x: n.x + this.rng.range(-e, e), z: n.z + this.rng.range(-e, e) };
    this.heard = { ...guess, t: match.time, kind: n.kind, sourceId: n.agentId };
    if (!visible) {
      this.alertLook = { point: { x: guess.x, y: 1.4, z: guess.z }, until: match.time + 2.5 };
      // 가까운 발소리·착지음은 멈춰서 경계 (총성은 이미 교전 중일 가능성이 큼)
      if (d < 20 && !a.lockpick && (n.kind === 'step' || n.kind === 'land' || n.kind === 'reload')) {
        this.pauseT = this.rng.range(1.2, 2.8);
        this.pauseCrouch = this.rng.chance(0.6);
      }
    }
    this.report(match, a, n, guess, d);
  }

  // 무전 보고 (같은 적은 잠시 다시 보고하지 않음, 팀 전체가 너무 시끄럽지 않게)
  report(match, a, n, guess, d) {
    const clock = match.radioClock?.[a.team];
    if (!clock || match.time - clock.t < 3.5 || match.time - this.radioT < 7) return;
    const last = clock.bySource.get(n.agentId) ?? -99;
    if (match.time - last < 7) return;
    const callout = match.map.calloutAt(guess.x, guess.z);
    const mine = match.map.calloutAt(a.pos.x, a.pos.z);
    const dir = compass(guess.x - a.pos.x, guess.z - a.pos.z);
    const place = callout ? (callout === mine ? `${callout} ${dir}쪽` : callout) : `${dir}쪽`;
    const range = d < 12 ? ' · 근거리' : d > 35 ? ' · 원거리' : '';
    clock.t = match.time;
    clock.bySource.set(n.agentId, match.time);
    this.radioT = match.time;
    match.shareIntel(a, { x: guess.x, z: guess.z, kind: n.kind });
    match.radio(a, `${NOISE_TEXT[n.kind] ?? '소음'} 포착 — ${place}${range}`, { kind: 'contact', pos: guess });
  }

  // 플레이어의 적 보고: 보고 지점에서 가장 가까운 분대원이 짧게 응답하고 그쪽을 경계
  hearReport(match, a) {
    const since = this.reportSeenT ?? match.time - 0.5;
    this.reportSeenT = match.time;
    const rep = match.intel[a.team].findLast((i) => i.t > since && (match.agentById(i.reporterId)?.isPlayer || match.agentById(i.reporterId)?.human));
    if (!rep) return;
    const mates = match.agents.filter((m) => m.alive && m.team === a.team && !m.isPlayer && !m.human);
    const nearest = mates.sort((p, q) => dist2(p.pos, rep) - dist2(q.pos, rep))[0];
    if (nearest?.id !== a.id || dist2(a.pos, rep) > 50) return;
    this.alertLook = { point: { x: rep.x, y: 1.3, z: rep.z }, until: match.time + 3 };
    const clock = match.radioClock?.[a.team];
    if (clock && match.time - (clock.ackT ?? -99) < 4) return;
    if (clock) clock.ackT = match.time;
    const place = match.map.calloutAt(rep.x, rep.z) ?? '그쪽';
    this.reportAck = { t: this.rng.range(0.6, 1.1), text: rep.kind === 'seen' ? `수신. ${place} 견제.` : `수신. ${place} 경계.` };
  }

  // ───────────────────────── 지휘 명령 ─────────────────────────
  followOrder(match, a) {
    const o = match.orders[a.team];
    if (!o) {
      this.orderId = null;
      return false;
    }
    const issuer = match.agentById(o.issuerId);
    if (!issuer?.alive || issuer.id === a.id) return false;
    if (o.id !== this.orderId) {
      this.orderId = o.id;
      this.orderHold = { x: a.pos.x, z: a.pos.z, yaw: a.yaw };
      this.pauseT = 0;
      // 살아 있는 봇 중 가장 앞 번호가 대표로 응답
      const first = match.agents.find((m) => m.alive && m.team === a.team && !m.isPlayer && !m.human && m.id !== issuer.id);
      if (first?.id === a.id) this.ackT = 0.6;
    }
    const slot = Math.max(0, this.index - 1);
    const fwd = { x: -Math.sin(o.yaw), z: -Math.cos(o.yaw) };
    switch (o.type) {
      case 'regroup': {
        // 분대장 뒤쪽에 부채꼴로 붙음
        const ang = issuer.yaw + Math.PI + (slot - 1.5) * 0.55;
        const point = { x: issuer.pos.x - Math.sin(ang) * 2.6, z: issuer.pos.z - Math.cos(ang) * 2.6 };
        const far = dist2(point, a.pos) > 8;
        this.goal = {
          point,
          arrive: 1.2,
          look: { x: issuer.pos.x - Math.sin(issuer.yaw) * 12, z: issuer.pos.z - Math.cos(issuer.yaw) * 12 },
          quiet: !far && dist2(issuer.pos, a.pos) < 10 && Math.hypot(issuer.vel.x, issuer.vel.z) < 2.2,
          urgent: far,
        };
        return true;
      }
      case 'hold': {
        const h = this.orderHold;
        this.goal = { point: { x: h.x, z: h.z }, arrive: 0.6, look: { x: h.x - Math.sin(h.yaw) * 10, z: h.z - Math.cos(h.yaw) * 10 }, crouchAtGoal: this.holdCrouch };
        return true;
      }
      case 'move': {
        const p = o.point ?? issuer.pos;
        const ang = slot * 1.6;
        const point = { x: p.x + Math.cos(ang) * 1.6, z: p.z + Math.sin(ang) * 1.6 };
        this.goal = {
          point,
          arrive: 0.9,
          look: { x: p.x + fwd.x * 12, z: p.z + fwd.z * 12 },
          quiet: dist2(point, a.pos) < 14,
          crouchAtGoal: this.holdCrouch,
        };
        return true;
      }
      case 'A':
      case 'B': {
        if (a.team === TEAMS.DEFUSE) {
          const bomb = match.bombById(o.type);
          if (!bomb || bomb.state !== 'armed') return false;
          this.assignedBomb = o.type;
          this.goToBomb(match, a, bomb, true);
          return true;
        }
        const list = match.map.holds[o.type] ?? [];
        const h = list[slot % Math.max(1, list.length)];
        if (!h) return false;
        const off = slot >= list.length ? ((slot % 2) * 2 - 1) * 1.5 : 0;
        this.goal = { point: { x: h.x + off, z: h.z }, arrive: 0.7, look: { x: h.lookX, z: h.lookZ }, quiet: dist2(h, a.pos) < 16, crouchAtGoal: this.holdCrouch };
        return true;
      }
      default:
        return false;
    }
  }

  sendAck(match, a) {
    const o = match.orders[a.team];
    if (!a.alive) return;
    let text = ORDER_ACK.free;
    if (o) {
      if (o.type === 'A' || o.type === 'B') text = a.team === TEAMS.DEFUSE ? `수신. ${o.type} 목표로 진입.` : `수신. ${o.type} 사이트 방어.`;
      else text = ORDER_ACK[o.type] ?? text;
    }
    match.radio(a, text, { kind: 'ack' });
  }

  // ───────────────────────── 해체팀 ─────────────────────────
  thinkDefuser(match, a) {
    const armed = match.bombs.filter((b) => b.state === 'armed');
    if (!armed.length) {
      this.goal = null;
      return;
    }
    let bomb = armed.find((b) => b.id === this.assignedBomb) ?? armed[0];
    if (bomb.picker && bomb.picker !== a.id) {
      const free = armed.find((b) => !b.picker);
      if (free && dist2(free, a.pos) < dist2(bomb, a.pos) + 25) bomb = free;
    }
    this.assignedBomb = bomb.id;
    // 진입 전: 집결 지점에서 대기 (팀이 함께 진입)
    const pushAt = (match.botPlan?.defuse?.pushAt ?? 20) + this.pushDelay;
    const elapsed = match.time - (match.liveAt ?? 0);
    if (elapsed < pushAt && this.stage && !this.heardRecently(match, 4)) {
      // 감시선을 피해 우회로를 먼저 지남
      if (this.stage.via && !this.viaDone) {
        if (dist2(this.stage.via, a.pos) < 2.5) this.viaDone = true;
        else {
          this.goal = { point: { x: this.stage.via.x, z: this.stage.via.z }, arrive: 2 };
          return;
        }
      }
      const near = dist2(this.stage, a.pos) < 3;
      this.goal = { point: { x: this.stage.x, z: this.stage.z }, arrive: 0.9, look: { x: this.stage.lookX, z: this.stage.lookZ }, crouchAtGoal: near && this.holdCrouch };
      return;
    }
    this.goToBomb(match, a, bomb, false);
  }

  goToBomb(match, a, bomb, ordered) {
    const d = dist2(a.pos, bomb);
    const quiet = d < 26 || this.heardRecently(match, 6);
    if (bomb.picker && bomb.picker !== a.id) {
      // 동료가 해체 중 → 옆에서 엄호 (포스팀 쪽 입구를 봄)
      const ang = this.index * 1.7;
      this.goal = {
        point: { x: bomb.x + Math.cos(ang) * 3, z: bomb.z + Math.sin(ang) * 3 },
        look: { x: bomb.x + Math.cos(ang) * 10, z: bomb.z - 10 },
        arrive: 1.2,
        quiet: true,
        crouchAtGoal: true,
      };
      return;
    }
    this.goal = { point: { x: bomb.x, z: bomb.z }, arrive: 1.0, look: { x: bomb.x, z: bomb.z - 10 }, quiet, urgent: ordered && d > 30 };
    const nearbyEnemy = (a.visibleEnemies ?? []).length > 0;
    if (d < 1.6 && !a.lockpick && !nearbyEnemy && !bomb.picker && this.pauseT <= 0) this.wantLockpick = true;
  }

  heardRecently(match, sec) {
    return !!this.heard && match.time - this.heard.t < sec;
  }

  // ───────────────────────── 포스팀 ─────────────────────────
  thinkForce(match, a) {
    const armed = match.bombs.filter((b) => b.state === 'armed');
    // 해체 경보 (폭탄 경보음은 모두에게 들림)
    const alerted = armed.find((b) => b.picker || match.time - b.alertT < 4);
    if (alerted) {
      const respond = this.homeSite === alerted.id || this.homeSite === 'mid' || armed.length === 1 || match.time - alerted.alertT > 0 && dist2(alerted, a.pos) < 30;
      if (respond) {
        const d = dist2(alerted, a.pos);
        this.goal = { point: { x: alerted.x, z: alerted.z }, arrive: 3, look: { x: alerted.x, z: alerted.z }, quiet: d < 16, urgent: !!alerted.picker };
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
    // 중앙 담당: 시간이 지나면 소리·무전으로 알게 된 적을 조용히 사냥
    if (this.homeSite === 'mid' && match.timeLeft < 90) {
      const info = [this.heard, ...match.intel[a.team]]
        .filter((i) => i && match.time - i.t < 6 && dist2(i, a.pos) < 32)
        .sort((p, q) => dist2(p, a.pos) - dist2(q, a.pos))[0];
      if (info) {
        this.goal = { point: { x: info.x, z: info.z }, arrive: 2.5, look: { x: info.x, z: info.z }, quiet: true };
        return;
      }
    }
    const atHold = dist2(hold, a.pos) < 2;
    this.goal = { point: { x: hold.x, z: hold.z }, arrive: 0.6, look: { x: hold.lookX, z: hold.lookZ }, quiet: atHold, crouchAtGoal: this.holdCrouch };
  }

  considerPatches(match, a, target, visible) {
    const eye = eyePos(a);
    const td = target ? dist2(target.pos, a.pos) : Infinity;
    const seen = (a.visibleEnemies ?? []).map((id) => match.agentById(id)).filter((e) => e?.alive);
    // 적이 뭉쳐 있거나 락픽 중인 곳 찾기
    const bestGroup = (range, groupR) => {
      let best = null, bestScore = 0;
      for (const e of seen) {
        if (dist2(e.pos, a.pos) > range - 2) continue;
        let score = seen.filter((o) => dist2(o.pos, e.pos) < groupR).length;
        if (e.lockpick) score += 2;
        if (a.hp < 50) score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      return { best, bestScore };
    };
    a.patches.forEach((p, slot) => {
      if (!p || this.pending || this.nowPatch != null) return;
      const def = PATCHES[p.id];
      const ready = def.tier === 'ultimate' ? a.ult >= 100 : p.cd <= 0;
      if (!ready) return;
      switch (p.id) {
        case 'gravityVeil':
          if (match.time - a.lastHurtT < 0.5 && a.hp < 80) this.nowPatch = slot;
          break;
        case 'resultantAmp':
        case 'reactionRounds':
          if (visible && !WEAPONS[a.weapon].melee && this.reactLeft <= 0.1 && td < 45) this.nowPatch = slot;
          break;
        case 'buoyShield':
          // 맞고 있거나 락픽을 시작하기 직전이면 위협 방향으로 방패 전개
          if (match.time - a.lastHurtT < 0.6 && this.heard && match.time - this.heard.t < 1.5) {
            this.pending = { slot, point: { x: this.heard.x, y: eye.y, z: this.heard.z }, t: 0.6, yawOnly: true };
          } else if (this.wantLockpick && this.goal?.look) {
            this.pending = { slot, point: { x: this.goal.look.x, y: eye.y, z: this.goal.look.z }, t: 0.6, yawOnly: true };
          }
          break;
        case 'elasticPad': {
          if (visible || !this.path || this.pathIdx >= this.path.length || this.goal?.quiet) break;
          const wp = this.path[this.pathIdx];
          const d = dist2(wp, a.pos);
          if (d > 11 && a.onGround && match.nav.clearLine(a.pos.x, a.pos.z, wp.x, wp.z, 0.5) && this.rng.chance(0.25)) {
            this.pending = { slot, point: { x: wp.x, y: eye.y, z: wp.z }, t: 0.8, yawOnly: true };
          }
          break;
        }
        case 'frictionZero':
        case 'elasticNet':
          if (visible && td > 5 && td < def.range - 2) {
            this.pending = { slot, point: { x: target.pos.x, y: target.pos.y + 0.05, z: target.pos.z }, t: 0.9 };
          }
          break;
        case 'weightScanner':
          // 소리 정보가 없을 때 가끔 탐지
          if (!visible && match.time - (match.liveAt ?? 0) > 12 && !this.heardRecently(match, 8) && this.rng.chance(0.12)) this.nowPatch = slot;
          break;
        case 'resultantSurge':
          if (visible && match.alive(a.team).length >= 2 && td < 40) this.nowPatch = slot;
          break;
        case 'gravityCollapse':
        case 'frictionStorm': {
          if (!visible) break;
          const { best, bestScore } = bestGroup(def.range, def.id === 'frictionStorm' ? 8 : 6);
          if (best && bestScore >= 2) this.pending = { slot, point: { x: best.pos.x, y: best.pos.y + 0.05, z: best.pos.z }, t: 1 };
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
    const expected = intent.walk ? 0.25 : 0.4;
    if (moved < expected) {
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

// 구매 (라운드 시작 때 한 번): 팀 평균 크레딧으로 정함 — 넉넉하면 풀 구매, 모자라면 아끼고(에코), 그 사이는 반만
export function botBuy(match, a, plan, rng) {
  if (!match.rounds || match.phase !== 'buy') return;
  const pistolRound = match.round === 1 || match.round === 7;
  const buy = (id) => match.buy(a, id);
  const armorTo = (want) => {
    if (a.armor >= ARMOR[want].value) return;
    if (a.credits >= ARMOR[want].price) buy(want);
  };
  if (pistolRound) {
    if (rng.chance(0.5)) buy('sheriff');
    else armorTo('light');
    return;
  }
  if (!a.primary) {
    if (plan === 'full' || a.credits >= 3900) {
      const sniper = a.credits >= 5700 && rng.chance(plan === 'full' ? 0.18 : 0.1);
      if (sniper) buy('sniper');
      else if (a.credits >= 2900) buy('rifle');
      else if (a.credits >= 1600) buy('smg');
    } else if (plan === 'half') {
      buy(a.credits >= 2000 && rng.chance(0.7) ? 'smg' : 'shotgun');
    } else if (a.credits >= 1400 && rng.chance(0.4)) {
      buy('sheriff');
    }
  }
  if (a.credits >= ARMOR.heavy.price + (plan === 'eco' ? 1500 : 0)) armorTo('heavy');
  else if (plan !== 'eco' || a.credits >= 1800) armorTo('light');
}

// 팀별로 봇 두뇌 붙이기 + 라운드 단위 작전 계획(해체팀 진입 시각·방식, 구매)
// 라운드제에서는 라운드가 새로 준비될 때마다 다시 붙임 (공수 교대하면 맡은 역할도 바뀜)
export function attachBots(match, difficulty) {
  const setup = () => {
    const rng = match.rng;
    // 해체팀이 집결 후 진입을 시작하는 시각 (맵마다 다를 수 있음)
    const [p0, p1] = match.map.def.push ?? [12, 26];
    match.botPlan = {
      defuse: { pushAt: rng.range(p0, p1), style: rng.pick(['split', 'split', 'stackA', 'stackB']) },
    };
    match.radioClock = {
      defuse: { t: -99, bySource: new Map() },
      force: { t: -99, bySource: new Map() },
    };
    const counters = { defuse: 0, force: 0 };
    for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) {
      const mates = match.agents.filter((a) => a.team === team);
      const avg = mates.reduce((s, a) => s + (a.credits ?? 0), 0) / Math.max(1, mates.length);
      const plan = avg >= 3600 ? 'full' : avg >= 2300 ? 'half' : 'eco';
      for (const a of mates) {
        if (a.isPlayer || a.human) {
          counters[team]++;
          continue;
        }
        match.setController(a.id, new BotBrain(a, match, difficulty, counters[team]++));
        botBuy(match, a, plan, rng);
      }
    }
  };
  match.botDifficulty = difficulty;
  match.botsOff?.();
  match.botsOff = match.events.on('roundPrep', setup);
  setup();
}
