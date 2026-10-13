// 온라인 경기 동기화 (방장이 규칙을 계산, 참가자는 결과를 받아 그림)
//
// 방장 → 모두: 상태 스냅숏 (초당 20번, 4KB 이하). 요원·폭탄·패치 구역·지휘·무전 정보 + 최근 사건(총성·피격·무전 …)
// 참가자 → 방장: 입력 (초당 30번). 계속 누르는 키는 상태로, 한 번 누르는 동작은 횟수(카운터)로 보내 빠지지 않게 함
//
// 이 파일은 화면·네트워크와 무관한 순수 변환 코드라서 Node 테스트로 검증한다.
import { emptyIntent, freshAmmo } from '../sim/agent.js';
import { CONCEPTS } from '../sim/concepts.js';
import { PROJECTILE } from '../sim/constants.js';
import { AMMO_ORDER, WEAPONS } from '../sim/data.js';
import { GEAR_ORDER, THROW_ORDER, emptyGear } from '../sim/gear.js';

export const PROTOCOL = 10;
const CONCEPT_IDS = CONCEPTS.map((c) => c.id);
// 총 번호 (뒤에만 덧붙임 · 총이 늘면 PROTOCOL도 올림: ITEMS 번호가 밀리기 때문)
const WEAP = ['rifle', 'pistol', 'knife', 'sheriff', 'shotgun', 'smg', 'sniper', 'mpistol', 'carbine', 'burst', 'dmr', 'lmg'];
const ITEMS = [...WEAP, 'light', 'heavy', ...AMMO_ORDER, ...GEAR_ORDER]; // 상점에서 사는 것
const ARMOR_KINDS = [null, 'light', 'heavy'];
// 손에 든 장비: 0 없음 · 1~6 투척물 · 그다음 C4 · 기폭기 · 드론 · RC카 · 경보 센서 · 카메라 · 카메라 보기 · 심박 센서
const HELD_KINDS = ['c4', 'det', 'drone', 'rc', 'alarm', 'cam', 'camview', 'pulse'];
const encEquip = (e) => (!e ? 0 : e.kind === 'throw' ? 1 + THROW_ORDER.indexOf(e.id) : HELD_KINDS.includes(e.kind) ? 1 + THROW_ORDER.length + HELD_KINDS.indexOf(e.kind) : 0);
const decEquip = (k) => {
  if (k >= 1 && k <= THROW_ORDER.length) return { kind: 'throw', id: THROW_ORDER[k - 1] };
  const h = HELD_KINDS[k - 1 - THROW_ORDER.length];
  return h ? { kind: h } : null;
};
const REMOTE_KINDS = ['drone', 'rc'];
const PHASES = ['buy', 'live', 'roundEnd', 'ended'];
const REASONS = ['폭탄 2기 해체 완료', '해체팀 전원 제압', '포스팀 전원 제압', '제한 시간 종료 — 폭탄 폭발'];
const BOMB_STATES = ['armed', 'defused', 'exploded'];
const TEAMS_ = ['defuse', 'force'];
const IMPACT_KINDS = ['surface', 'flesh', 'shield', 'debris', 'door'];
const DOOR_MATS = ['wood', 'steel'];
// 문 행동 (사람 입력 카운터 순서와 같음)
const DOOR_ACTS = ['crack', 'kick', 'mirror', 'charge'];
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;

// 참가자 화면에서 미리 보여 준 자기 사건 (방장이 보낸 같은 사건은 건너뜀)
const PREDICTED = new Set(['shot', 'reload', 'swap', 'dryFire', 'footstep', 'land', 'melee', 'jump', 'reloadDone', 'pulse']);
// 화면에 쓰이지 않는 사건
const SKIP = new Set(['jump', 'reloadDone', 'scanPing']);
// 스냅숏이 넘칠 때 먼저 덜어내는 새 사건 (소리·자국: 빠져도 규칙·명중 표시와 무관)
const LOW_EVENTS = new Set(['f', 'i', 'o', 'l', 'r']);
// 맞음 사건의 표시들 (한 숫자에 비트로)
const HIT_FLAGS = ['headshot', 'killed', 'backstab', 'armor', 'blocked', 'armorBroke'];

const bytes = (obj) => {
  const s = JSON.stringify(obj);
  let n = s.length;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) n += 2; // 한글은 UTF-8 3바이트
  return n;
};

// 지휘 명령 중 화면에 필요한 것만 (진입 명령의 계획·봇별 할 일은 방장만 씀)
function publicOrder(o) {
  const { id, type, point, issuerId, t, yaw, mode, door, side, phase } = o;
  return { id, type, point, issuerId, t, yaw, mode, door, side, phase };
}

// ───────────────────────── 방장 ─────────────────────────
export class HostSync {
  constructor(match, { keep = 0.4, maxBytes = 3500 } = {}) {
    this.match = match;
    this.idx = new Map(match.agents.map((a, i) => [a.id, i]));
    this.keep = keep;
    this.maxBytes = maxBytes;
    this.events = [];
    this.seq = 0;
    this.sentSeq = 0; // 지난 스냅숏까지 실은(또는 덜어낸) 마지막 사건 번호
    this.n = 0;
    this.acks = {}; // 사람 요원별 마지막으로 처리한 입력 번호
    this.off = match.events.on('*', (type, payload) => this.record(type, payload));
  }

  dispose() {
    this.off?.();
  }

  ai(a) {
    return a ? this.idx.get(a.id) ?? -1 : -1;
  }

  // 자주 나오는 사건은 짧은 배열로
  record(type, e) {
    if (SKIP.has(type)) return;
    let p;
    switch (type) {
      case 'shot':
        p = ['s', this.ai(e.agent), WEAP.indexOf(e.weapon), r2(e.origin.x), r2(e.origin.y), r2(e.origin.z), r3(e.dir.x), r3(e.dir.y), r3(e.dir.z), e.amp ? 1 : 0, e.projectile?.id ?? 0];
        break;
      case 'footstep':
        p = ['f', this.ai(e.agent), e.loud ? 1 : 0];
        break;
      case 'impact':
        p = ['i', r2(e.x), r2(e.y), r2(e.z), r2(e.nx ?? 0), r2(e.ny ?? 0), r2(e.nz ?? 0), Math.max(0, IMPACT_KINDS.indexOf(e.kind)), e.headshot ? 1 : 0, Math.max(0, DOOR_MATS.indexOf(e.mat))];
        break;
      case 'ricochet':
        p = ['o', r2(e.x), r2(e.y), r2(e.z), r2(e.nx), r2(e.ny), r2(e.nz)];
        break;
      case 'reload':
        p = ['r', this.ai(e.agent)];
        break;
      case 'swap':
        p = ['w', this.ai(e.agent), WEAP.indexOf(e.weapon)];
        break;
      case 'land':
        p = ['l', this.ai(e.agent), r1(e.speed)];
        break;
      case 'projectileCaught':
        p = ['c', e.projectile?.id ?? 0, r2(e.projectile?.pos?.x ?? 0), r2(e.projectile?.pos?.y ?? 0), r2(e.projectile?.pos?.z ?? 0)];
        break;
      case 'hit': {
        // 맞음: 산탄 여러 알·연사로 한꺼번에 많이 나옴 → 짧게 (총은 번호, 그 밖의 무기·장비·폭발은 이름 그대로)
        const wi = WEAP.indexOf(e.weapon);
        p = ['h', this.ai(e.target), this.ai(e.attacker), r1(e.amount ?? 0), HIT_FLAGS.reduce((b, k, i) => b | (e[k] ? 1 << i : 0), 0), wi >= 0 ? wi : e.weapon ?? null];
        if (e.pos) p.push(r2(e.pos.x), r2(e.pos.y), r2(e.pos.z));
        break;
      }
      default:
        p = ['g', type, this.enc(e, 0)];
    }
    this.events.push({ s: ++this.seq, t: this.match.time, p });
  }

  // 일반 사건: 요원·폭탄은 번호로, 나머지는 숫자를 줄여서
  enc(v, d) {
    if (v == null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return r3(v);
    if (typeof v !== 'object' || d > 4) return null;
    if (Array.isArray(v)) return v.map((x) => this.enc(x, d + 1));
    if (v.stats && v.pos && v.team) return { $a: this.ai(v) };
    if ('progress' in v && 'picker' in v) return { $b: v.id };
    if (v.st && v.type && this.match.devices?.list.includes(v)) return { $d: v.id };
    if (v.st && v.leaves && this.match.doors?.list.includes(v)) return { $o: v.id };
    if (this.match.op?.hostages.includes(v)) return { $h: v.id };
    if (this.match.op?.intel.includes(v)) return { $n: v.id };
    const o = {};
    for (const k in v) {
      if (k === 'prev' || k === 'projectile') continue;
      o[k] = this.enc(v[k], d + 1);
    }
    return o;
  }

  snapshot({ withStats = false } = {}) {
    const m = this.match;
    this.n++;
    // 오래된 사건은 버림 (참가자는 여러 스냅숏 중 하나만 받아도 빠지지 않도록 keep초 동안 반복해서 보냄)
    this.events = this.events.filter((e) => m.time - e.t <= this.keep);
    const A = m.agents.map((a) => {
      const flags = (a.alive ? 1 : 0) | (a.onGround ? 2 : 0) | (a.mired ? 4 : 0) | (a.slippery ? 8 : 0) | (a.ads ? 16 : 0) | (a.team === 'force' ? 32 : 0);
      return [
        r2(a.pos.x), r2(a.pos.y), r2(a.pos.z), r1(a.vel.x), r1(a.vel.y), r1(a.vel.z), r3(a.yaw), r3(a.pitch),
        Math.max(0, Math.round(a.hp)), flags, WEAP.indexOf(a.weapon), r2(a.crouch), r2(a.lean ?? 0), r2(a.leanOffset ?? 0),
        r2(a.adsT), r2(a.reloadT), r2(a.swapT), r2(Math.min(9, a.sinceShot)), r2(a.meleeCd), r2(a.ampT),
        r2(Math.max(0, a.revealedUntil - m.time)), a.held?.zoneId ?? 0, a.lockpick ? (a.lockpick.bombId === 'A' ? 1 : 2) : 0,
        Math.round(a.armor ?? 0), r2(Math.max(-1, Math.min(9, m.time - a.spottedT))),
        a.primary ? WEAP.indexOf(a.primary) : -1, WEAP.indexOf(a.secondary ?? 'pistol'),
        Math.max(0, ARMOR_KINDS.indexOf(a.armorKind ?? null)),
        encEquip(a.equip),
        a.mirror ? (a.mirror.door + 1) * a.mirror.side : 0, // 문 밑 카메라 (문 번호+1, 부호 = 보는 쪽)
        a.kickT > 0 ? 1 : 0, // 발차기 동작 중
      ];
    });
    // 사람이 조종하는 요원만: 탄약·패치 대기·필살 게이지·해체 문제·입력 확인 번호
    const H = {};
    m.agents.forEach((a, i) => {
      if (!a.isPlayer && !a.human) return;
      const ammo = (id) => (id ? [WEAP.indexOf(id), a.weapons[id]?.mag ?? 0, a.weapons[id]?.reserve ?? 0] : [-1, 0, 0]);
      H[i] = {
        m: [...ammo(a.primary), ...ammo(a.secondary)],
        $: a.credits ?? 0,
        am: a.armorMax ?? 0,
        ao: Math.max(0, AMMO_ORDER.indexOf(a.ammo ?? 'fmj')),
        sp: Math.round(a.stamina ?? 100),
        g: GEAR_ORDER.map((id) => a.gear?.[id] ?? 0),
        db: r1(a.droneBat ?? 0), // 손에 있는 드론 배터리
        rb: r1(a.rcBat ?? 0), // 손에 있는 RC카 배터리
        em: r1(a.empT ?? 0), // EMP로 장비가 먹통인 남은 시간
        cv: a.camView ? [a.camView.id, r3(a.camView.yaw), r3(a.camView.pitch)] : 0, // 보고 있는 카메라
        fx: [r2(a.stunT ?? 0), r2(a.flashT ?? 0), r2(a.gasT ?? 0)],
        bt: (a.bought ?? []).map((b) => ITEMS.indexOf(b.item)),
        pc: a.patches.map((p) => (p ? [r2(p.cd), r2(p.activeT)] : 0)),
        u: Math.round(a.ult),
        lp: a.lockpick?.kind === 'puzzle' ? { b: a.lockpick.bombId, z: a.lockpick.puzzle, s: a.lockpick.selected, t: r2(a.lockpick.turnT) } : 0,
        q: a.quiz ? [a.quiz.id, a.quiz.done ? 1 : 0, a.quiz.ok == null ? -1 : a.quiz.ok ? 1 : 0, a.quiz.choice ?? -1] : 0,
        ak: this.acks[a.id] ?? 0,
        rc: [r3(a.recoil), r3(a.recoilYaw), r3(a.punch)],
        ot: a.opTask ? [a.opTask.kind === 'free' ? 0 : 1, a.opTask.id, r2(a.opTask.t), a.opTask.need] : 0, // CQB: 결박 풀기·자료 확보 진행
      };
    });
    const snap = {
      n: this.n,
      M: [
        r2(m.time), PHASES.indexOf(m.phase), r2(m.phaseT), r2(m.timeLeft), r2(m.liveAt), m.winner ? TEAMS_.indexOf(m.winner) : -1,
        m.round ?? 1, m.score?.defuse ?? 0, m.score?.force ?? 0, m.roundWinner ? TEAMS_.indexOf(m.roundWinner) : -1, REASONS.indexOf(m.roundReason), m.swapped ? 1 : 0,
      ],
      A,
      H,
      B: m.bombs.map((b) => [BOMB_STATES.indexOf(b.state), b.picker ? this.idx.get(b.picker) : -1, r2(b.progress), r2(b.x), r2(b.z), r2(b.y ?? 0)]),
      Z: m.zones.map((z) => this.enc(z, 1)),
      V: m.veils.map((v) => this.enc(v, 1)),
      S: m.shields.map((s) => this.enc(s, 1)),
      O: TEAMS_.map((t) => (m.orders[t] ? this.enc(publicOrder(m.orders[t]), 1) : 0)),
      I: TEAMS_.map((t) => m.intel[t].slice(-6).map((i) => [r1(i.x), r1(i.z), i.kind, this.idx.get(i.reporterId) ?? -1, r2(i.t), r1(i.y ?? 0)])),
      C: m.concepts.map((c) => c.takenBy.map((id) => this.idx.get(id))),
      D: m.devices.pack(), // 맵 장치 (셔터 닫힘·승강기 높이·발판 반동)
      X: m.doors.pack(), // 문 (각도·잠김·부서짐)
      G: (m.throwables ?? []).map((t) => [t.id, GEAR_ORDER.indexOf(t.kind), r2(t.pos.x), r2(t.pos.y), r2(t.pos.z), t.rest ? 1 : 0]), // 투척물 · 날아가는 카메라
      K: (m.charges ?? []).map((c) => [c.id, this.ai(m.agentById(c.ownerId)), r2(c.x), r2(c.y), r2(c.z), r2(c.nx), r2(c.ny), r2(c.nz), r1(Math.max(0, (c.offUntil ?? -99) - m.time))]), // C4
      Q: (m.drones ?? []).map((d) => [d.id, this.ai(m.agentById(d.ownerId)), r2(d.pos.x), r2(d.pos.y), r2(d.pos.z), r3(d.yaw), r3(d.pitch), r1(d.battery), REMOTE_KINDS.indexOf(d.kind ?? 'drone')]), // 드론 · RC카
      W: m.gadgets.cams.map((c) => [c.id, this.ai(m.agentById(c.ownerId)), TEAMS_.indexOf(c.team), r2(c.x), r2(c.y), r2(c.z), r2(c.nx), r2(c.ny), r2(c.nz), r2(c.yaw0 ?? 0), r1(Math.max(0, (c.offUntil ?? -99) - m.time))]), // 던진 카메라
      L: m.gadgets.alarms.map((l) => [l.id, this.ai(m.agentById(l.ownerId)), TEAMS_.indexOf(l.team), r2(l.x), r2(l.y), r2(l.z), r2(l.nx), r2(l.nz), r2(l.ex), r2(l.ez), r1(Math.max(0, (l.offUntil ?? -99) - m.time)), r1(Math.min(9, m.time - (l.trippedT ?? -99)))]), // 경보 센서
      P: m.op ? m.op.pack((id) => this.idx.get(id) ?? -1) : 0, // CQB 작전 (연구원·자료·발견·장치 해체)
      E: this.events.map((e) => [e.s, e.p]),
    };
    if (m.phase === 'ended') snap.R = m.reason;
    if (withStats) {
      snap.T = m.agents.map((a) => [a.stats.kills, a.stats.deaths, a.stats.damage, a.stats.defuses, a.stats.patchUses, a.stats.headshots, a.stats.assists ?? 0, a.credits ?? 0]);
      snap.Y = (m.history ?? []).map((h) => [TEAMS_.indexOf(h.squad), TEAMS_.indexOf(h.side), REASONS.indexOf(h.reason)]);
    }
    // 크기 제한: 넘으면 ① 이미 보낸 사건(잃어버린 스냅숏 대비로 다시 싣는 것) ② 새 사건 중 소리·자국 ③ 그래도 넘으면 오래된 것부터 덜어냄
    const size = snap.E.map((e) => bytes(e) + 1);
    let total = bytes({ ...snap, E: [] }) + size.reduce((x, y) => x + y, 0);
    if (total > this.maxBytes) {
      const keep = snap.E.map(() => true);
      const drop = (test) => {
        for (let i = 0; i < snap.E.length && total > this.maxBytes; i++) {
          if (keep[i] && test(snap.E[i])) {
            keep[i] = false;
            total -= size[i];
          }
        }
      };
      drop(([seq]) => seq <= this.sentSeq);
      drop(([, p]) => LOW_EVENTS.has(p[0]));
      drop(() => true);
      snap.E = snap.E.filter((_, i) => keep[i]);
    }
    this.sentSeq = this.seq;
    return snap;
  }
}

// ───────────────────────── 참가자 ─────────────────────────
export class ClientSync {
  constructor(match, localId) {
    this.match = match;
    this.local = match.agentById(localId);
    this.localIdx = match.agents.indexOf(this.local);
    this.lastN = 0;
    this.lastSeq = 0;
    this.pendingCardSeq = 0; // 해체 카드: 방장이 이 입력을 처리하기 전까지는 화면의 선택을 유지
    this.started = false;
  }

  // 스냅숏 적용. now = 이 화면의 시계(초)
  apply(snap, now = 0) {
    const m = this.match;
    if (!snap || snap.n <= this.lastN) return false;
    this.lastN = snap.n;
    const [time, ph, phaseT, timeLeft, liveAt, win, round, sd, sf, rw, rr, swapped] = snap.M;
    // 시계: 크게 어긋나면 맞추고, 작으면 조금씩 따라감
    if (Math.abs(time - m.time) > 0.3) m.time = time;
    else m.time += (time - m.time) * 0.2;
    m.phase = PHASES[ph] ?? m.phase;
    m.phaseT = phaseT;
    m.timeLeft = timeLeft;
    m.liveAt = liveAt;
    m.winner = win >= 0 ? TEAMS_[win] : null;
    if (snap.R) m.reason = snap.R;
    if (round != null) {
      m.round = round;
      m.score = { defuse: sd, force: sf };
      m.roundWinner = rw >= 0 ? TEAMS_[rw] : null;
      m.roundReason = REASONS[rr] ?? '';
      m.swapped = !!swapped;
    }

    snap.A.forEach((s, i) => {
      const a = m.agents[i];
      if (!a) return;
      const [x, y, z, vx, vy, vz, yaw, pitch, hp, flags, w, crouch, lean, leanOffset, adsT, reloadT, swapT, sinceShot, meleeCd, ampT, reveal, heldZ, lpBomb, armor, spotted, pw, sw, ak, eq, mi, kk] = s;
      const alive = !!(flags & 1);
      if (!alive && a.alive) a.deadT = 0;
      a.alive = alive;
      a.hp = hp;
      a.armor = armor ?? 0;
      a.armorKind = ARMOR_KINDS[ak] ?? null;
      a.equip = decEquip(eq ?? 0); // 손에 든 장비 (이 화면 요원도 방장 값을 따름)
      a.team = flags & 32 ? 'force' : 'defuse';
      a.spottedT = spotted >= 0 ? m.time - spotted : -99;
      a.mired = !!(flags & 4);
      a.slippery = !!(flags & 8);
      a.ampT = ampT;
      a.revealedUntil = reveal > 0 ? m.time + reveal : -99;
      a.held = heldZ ? { zoneId: heldZ, x, y, z } : null;
      // 문 밑 카메라: 이 화면 요원은 카메라 방향(yaw·pitch)을 그대로 두고 문·쪽만 맞춤
      if (mi) {
        const door = Math.abs(mi) - 1, side = Math.sign(mi);
        if (a.mirror?.door !== door || a.mirror?.side !== side) a.mirror = { door, side, home: { yaw: a.yaw, pitch: a.pitch } };
      } else a.mirror = null;
      a.kickT = kk ? Math.max(a.kickT ?? 0, 0.01) : 0;
      if (i === this.localIdx) {
        this.reconcile(a, x, y, z, vx, vy, vz, lpBomb);
        return;
      }
      a.net = { x, y, z, vx, vy, vz, t: now };
      // 다른 요원이 가진 총 (3인칭 모형·등에 멘 총·관전 화면)
      if (pw !== undefined) {
        a.primary = WEAP[pw] ?? null;
        a.secondary = WEAP[sw] ?? 'pistol';
      }
      a.yaw = yaw;
      a.pitch = pitch;
      a.onGround = !!(flags & 2);
      a.ads = !!(flags & 16);
      a.weapon = WEAP[w] ?? a.weapon;
      a.crouch = crouch;
      a.lean = lean;
      a.leanOffset = leanOffset;
      a.adsT = adsT;
      a.reloadT = reloadT;
      a.swapT = swapT;
      a.sinceShot = sinceShot;
      a.meleeCd = meleeCd;
      a.lockpick = lpBomb ? { bombId: lpBomb === 1 ? 'A' : 'B', kind: 'remote' } : null;
      if (!this.started) {
        a.pos.x = a.prev.x = x;
        a.pos.y = a.prev.y = y;
        a.pos.z = a.prev.z = z;
      }
    });
    this.started = true;

    // 이 화면 요원의 비공개 정보
    const h = snap.H?.[this.localIdx];
    if (h) {
      const a = this.local;
      const [pi, pm, pr, si, sm, sr] = h.m;
      const prim = WEAP[pi] ?? null, sec = WEAP[si] ?? null;
      // 가진 총이 바뀌었으면 (상점·새 라운드) 방장이 쥐여 준 총으로
      if (prim !== a.primary || sec !== a.secondary) {
        const keep = { knife: { mag: 0, reserve: 0 } };
        for (const id of [prim, sec]) if (id) keep[id] = a.weapons[id] ?? freshAmmo(id);
        a.weapons = keep;
        a.primary = prim;
        a.secondary = sec;
        const hw = WEAP[snap.A[this.localIdx]?.[10]];
        a.weapon = hw && a.weapons[hw] ? hw : prim ?? sec ?? 'knife';
        a.reloadT = 0;
      }
      // 탄약: 쏘는 중이 아니면 방장 값으로 맞춤 (미리 쏜 것과 1~2발 차이는 허용)
      const setAmmo = (id, mag, reserve) => {
        if (!id || !a.weapons[id]) return;
        if (a.sinceShot > 0.35 && a.reloadT <= 0) a.weapons[id].mag = mag;
        a.weapons[id].reserve = reserve;
      };
      setAmmo(prim, pm, pr);
      setAmmo(sec, sm, sr);
      a.credits = h.$ ?? 0;
      a.armorMax = h.am ?? 0;
      a.ammo = AMMO_ORDER[h.ao] ?? 'fmj';
      a.gear = emptyGear();
      (h.g ?? []).forEach((n, k) => (a.gear[GEAR_ORDER[k]] = n));
      if (h.db != null) a.droneBat = h.db;
      if (h.rb != null) a.rcBat = h.rb;
      a.empT = h.em ?? 0;
      // 카메라 보기: 들어가거나 다른 카메라로 바뀌면 방장 방향으로 시작 (그 뒤 방향은 이 화면에서 미리)
      if (h.cv) {
        const [cid, cyaw, cpitch] = h.cv;
        if (!a.camView || a.camView.id !== cid) a.camView = { id: cid, yaw: cyaw, pitch: cpitch, home: { yaw: a.yaw, pitch: a.pitch }, fresh: true };
      } else if (a.camView) a.camView = null;
      if (h.fx) [a.stunT, a.flashT, a.gasT] = h.fx;
      // 지구력: 이 화면도 같은 규칙으로 계산하므로 많이 어긋날 때만 맞춤
      if (h.sp != null && Math.abs(h.sp - (a.stamina ?? 100)) > 8) {
        a.stamina = h.sp;
        if (h.sp <= 0) a.tired = true;
      }
      a.bought = (h.bt ?? []).map((k) => ({ item: ITEMS[k] }));
      h.pc.forEach((p, i) => {
        const mine = a.patches[i];
        if (!mine || !p) return;
        mine.cd = p[0];
        mine.activeT = p[1];
      });
      a.ult = h.u;
      if (h.lp) {
        const keepLocal = a.lockpick?.kind === 'puzzle' && h.ak < this.pendingCardSeq;
        a.lockpick = { bombId: h.lp.b, kind: 'puzzle', puzzle: h.lp.z, selected: keepLocal ? a.lockpick.selected : h.lp.s, turnT: h.lp.t };
      } else if (a.lockpick) a.lockpick = null;
      if (h.q) a.quiz = { id: h.q[0], done: !!h.q[1], ok: h.q[2] < 0 ? null : h.q[2] === 1, choice: h.q[3] };
      else a.quiz = null;
      a.opTask = h.ot ? { kind: h.ot[0] ? 'intel' : 'free', id: h.ot[1], t: h.ot[2], need: h.ot[3], at: { x: a.pos.x, z: a.pos.z } } : null;
    }

    snap.B.forEach(([st, pk, pr, bx, bz, by], i) => {
      const b = m.bombs[i];
      if (!b) return;
      if (bx != null) {
        b.x = bx;
        b.z = bz;
        b.y = by ?? 0;
      }
      b.state = BOMB_STATES[st];
      b.picker = pk >= 0 ? m.agents[pk]?.id ?? null : null;
      b.progress = pr;
    });
    if (snap.P && m.op) {
      m.op.unpack(snap.P, (k) => m.agents[k] ?? null);
      // 작전 결과는 받은 상태로 이 화면에서 계산 (목표·감점·등급이 방장과 같음)
      if (m.phase === 'ended' && !m.op.result) m.op.result = m.op.score(m.winner === 'defuse', m.reason);
    }
    if (snap.D) m.devices.unpack(snap.D);
    if (snap.X) m.doors.unpack(snap.X);
    // 투척물·C4: 같은 번호는 이어서 (화면에서 부드럽게 움직이게 이전 위치를 남김)
    if (snap.G) {
      const old = new Map((m.throwables ?? []).map((t) => [t.id, t]));
      m.throwables = snap.G.map(([id, k, tx, ty, tz, rest]) => {
        const t = old.get(id) ?? { id, kind: GEAR_ORDER[k] ?? 'frag', pos: { x: tx, y: ty, z: tz }, prev: { x: tx, y: ty, z: tz }, vel: { x: 0, y: 0, z: 0 } };
        t.prev = { ...t.pos };
        t.pos = { x: tx, y: ty, z: tz };
        t.rest = !!rest;
        return t;
      });
    }
    // 드론: 내 드론은 이 화면에서 미리 날리므로 많이 어긋날 때만 맞춤, 다른 드론은 받은 위치로
    if (snap.Q) {
      const old = new Map((m.drones ?? []).map((d) => [d.id, d]));
      m.drones = snap.Q.map(([id, oi, dx, dy, dz, yaw, pitch, battery, kk]) => {
        const owner = m.agents[oi];
        const kind = REMOTE_KINDS[kk] ?? 'drone';
        const d = old.get(id) ?? { id, kind, ownerId: owner?.id ?? null, team: owner?.team ?? null, pos: { x: dx, y: dy, z: dz }, prev: { x: dx, y: dy, z: dz }, vel: { x: 0, y: 0, z: 0 }, yaw, pitch, onGround: kind === 'rc' };
        d.battery = battery;
        if (owner === this.local && d.predicted) {
          const err = Math.hypot(dx - d.pos.x, dy - d.pos.y, dz - d.pos.z);
          if (err > 1.5) d.pos = { x: dx, y: dy, z: dz };
          else if (err > 0.05) {
            d.pos.x += (dx - d.pos.x) * 0.1;
            d.pos.y += (dy - d.pos.y) * 0.1;
            d.pos.z += (dz - d.pos.z) * 0.1;
          }
        } else {
          d.prev = { ...d.pos };
          d.pos = { x: dx, y: dy, z: dz };
          d.yaw = yaw;
          d.pitch = pitch;
        }
        return d;
      });
      for (const a of m.agents) a.drone = m.drones.find((d) => d.ownerId === a.id)?.id ?? null;
    }
    if (snap.K) m.charges = snap.K.map(([id, oi, cx, cy, cz, nx, ny, nz, off]) => ({ id, kind: 'c4', ownerId: m.agents[oi]?.id ?? null, team: m.agents[oi]?.team ?? null, x: cx, y: cy, z: cz, nx, ny, nz, offUntil: off > 0 ? m.time + off : -99 }));
    // 던진 카메라 · 경보 센서
    if (snap.W) m.gadgets.cams = snap.W.map(([id, oi, ti, cx, cy, cz, nx, ny, nz, yaw0, off]) => ({ id, kind: 'cam', ownerId: m.agents[oi]?.id ?? null, team: TEAMS_[ti] ?? null, x: cx, y: cy, z: cz, nx, ny, nz, yaw0, offUntil: off > 0 ? m.time + off : -99 }));
    if (snap.L) {
      m.gadgets.alarms = snap.L.map(([id, oi, ti, lx, ly, lz, nx, nz, ex, ez, off, ago]) => ({
        id, kind: 'alarm', ownerId: m.agents[oi]?.id ?? null, team: TEAMS_[ti] ?? null, x: lx, y: ly, z: lz, nx, nz, ex, ey: ly, ez, len: Math.hypot(ex - lx, ez - lz), offUntil: off > 0 ? m.time + off : -99, trippedT: m.time - ago,
      }));
    }
    m.zones = mergeById(m.zones, snap.Z);
    m.veils = mergeById(m.veils, snap.V);
    m.shields = mergeById(m.shields, snap.S);
    TEAMS_.forEach((t, i) => {
      m.orders[t] = snap.O[i] ? this.dec(snap.O[i]) : null;
      m.intel[t] = snap.I[i].map(([ix, iz, kind, rep, it, iy]) => ({ x: ix, y: iy ?? 0, z: iz, kind, reporterId: m.agents[rep]?.id ?? null, t: it }));
    });
    snap.C.forEach((takers, i) => {
      if (m.concepts[i]) m.concepts[i].takenBy = takers.map((k) => m.agents[k]?.id).filter(Boolean);
    });
    if (snap.T) snap.T.forEach((st, i) => {
      const a = m.agents[i];
      if (!a) return;
      [a.stats.kills, a.stats.deaths, a.stats.damage, a.stats.defuses, a.stats.patchUses, a.stats.headshots, a.stats.assists] = st;
      if (a !== this.local && st[7] != null) a.credits = st[7];
    });
    if (snap.Y) m.history = snap.Y.map(([q, sd2, rs], i) => ({ round: i + 1, squad: TEAMS_[q], side: TEAMS_[sd2], reason: REASONS[rs] ?? '' }));

    // 새 사건 재생 (이미 본 번호는 건너뜀)
    for (const [seq, p] of snap.E) {
      if (seq <= this.lastSeq) continue;
      this.lastSeq = seq;
      this.replay(p);
    }
    return true;
  }

  // 이 화면 요원: 미리 움직인 위치와 방장 위치가 많이 다르면 바로잡음
  reconcile(a, x, y, z, vx, vy, vz) {
    const dx = x - a.pos.x, dy = y - a.pos.y, dz = z - a.pos.z;
    const err = Math.hypot(dx, dy, dz);
    if (!a.alive || err > 1.6 || a.held || this.snapLocal) {
      this.snapLocal = false;
      a.pos.x = a.prev.x = x;
      a.pos.y = a.prev.y = y;
      a.pos.z = a.prev.z = z;
      a.vel.x = vx;
      a.vel.y = vy;
      a.vel.z = vz;
    } else if (err > 0.05) {
      // 조금씩 끌어당김 (화면이 튀지 않게)
      a.pos.x += dx * 0.08;
      a.pos.z += dz * 0.08;
      if (Math.abs(dy) > 0.4) a.pos.y += dy * 0.3;
    }
    // 튕겨 오름(탄성판)처럼 큰 속도 변화는 방장 값을 따름
    if (Math.hypot(vx - a.vel.x, vy - a.vel.y, vz - a.vel.z) > 3.5) {
      a.vel.x = vx;
      a.vel.y = vy;
      a.vel.z = vz;
    }
  }

  dec(v) {
    if (v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => this.dec(x));
    if ('$a' in v) return this.match.agents[v.$a] ?? null;
    if ('$b' in v) return this.match.bombById(v.$b);
    if ('$d' in v) return this.match.devices?.list[v.$d] ?? null;
    if ('$o' in v) return this.match.doors?.list[v.$o] ?? null;
    if ('$h' in v) return this.match.op?.hostages[v.$h] ?? null;
    if ('$n' in v) return this.match.op?.intel[v.$n] ?? null;
    const o = {};
    for (const k in v) o[k] = this.dec(v[k]);
    return o;
  }

  replay(p) {
    const m = this.match;
    const ag = (i) => m.agents[i] ?? null;
    const mine = (a) => a && a === this.local;
    switch (p[0]) {
      case 's': {
        const [, ai, wi, ox, oy, oz, dx, dy, dz, amp, pid] = p;
        const a = ag(ai);
        if (!a || mine(a)) return;
        const weapon = WEAP[wi] ?? 'rifle';
        const speed = WEAPONS[weapon]?.speed ?? 300;
        const proj = { id: `n${pid}`, pos: { x: ox, y: oy, z: oz }, prev: { x: ox, y: oy, z: oz }, vel: { x: dx * speed, y: dy * speed, z: dz * speed }, life: PROJECTILE.life, amp: !!amp, weapon, team: a.team, ownerId: a.id };
        m.projectiles.push(proj);
        a.sinceShot = 0;
        m.emit('shot', { agent: a, weapon, origin: { x: ox, y: oy, z: oz }, dir: { x: dx, y: dy, z: dz }, amp: !!amp, projectile: proj });
        return;
      }
      case 'f': {
        const a = ag(p[1]);
        if (a && !mine(a)) m.emit('footstep', { agent: a, loud: !!p[2] });
        return;
      }
      case 'i':
        m.emit('impact', { x: p[1], y: p[2], z: p[3], nx: p[4], ny: p[5], nz: p[6], kind: IMPACT_KINDS[p[7]] ?? 'surface', headshot: !!p[8], mat: DOOR_MATS[p[9]] ?? 'wood' });
        return;
      case 'o':
        m.emit('ricochet', { x: p[1], y: p[2], z: p[3], nx: p[4], ny: p[5], nz: p[6] });
        return;
      case 'r': {
        const a = ag(p[1]);
        if (a && !mine(a)) m.emit('reload', { agent: a });
        return;
      }
      case 'w': {
        const a = ag(p[1]);
        if (a && !mine(a)) m.emit('swap', { agent: a, weapon: WEAP[p[2]] });
        return;
      }
      case 'l': {
        const a = ag(p[1]);
        if (a && !mine(a)) m.emit('land', { agent: a, speed: p[2] });
        return;
      }
      case 'c':
        m.emit('projectileCaught', { projectile: { id: p[1], pos: { x: p[2], y: p[3], z: p[4] } } });
        return;
      case 'h': {
        const [, ti, ai, amount, flags, w, x, y, z] = p;
        const e = { target: ag(ti), attacker: ag(ai), amount, weapon: typeof w === 'number' ? WEAP[w] ?? null : w, pos: x != null ? { x, y, z } : null };
        HIT_FLAGS.forEach((k, i) => (e[k] = !!(flags & (1 << i))));
        if (e.target) m.emit('hit', e);
        return;
      }
      case 'g': {
        const type = p[1];
        const e = this.dec(p[2]) ?? {};
        if (PREDICTED.has(type) && mine(e.agent)) return;
        if (type === 'kill' && e.victim) e.victim.alive = false;
        if (type === 'roundPrep') {
          // 새 라운드: 남아 있던 총알 궤적 등 지우고, 모두 살아남 (위치는 다음 스냅숏이 맞춰 줌)
          m.projectiles = [];
          for (const a of m.agents) {
            a.alive = true;
            a.deadT = 0;
            a.lockpick = null;
          }
          this.snapLocal = true;
        }
        m.emit(type, e);
        return;
      }
    }
  }

  // 다른 요원: 받은 위치로 부드럽게 (받은 뒤 지난 시간만큼 속도로 앞당겨 추정)
  smooth(dt, now) {
    for (const a of this.match.agents) {
      if (a === this.local || !a.net) continue;
      const n = a.net;
      const lead = Math.min(0.12, Math.max(0, now - n.t));
      const tx = n.x + n.vx * lead, ty = n.y + (a.onGround ? 0 : n.vy * lead), tz = n.z + n.vz * lead;
      a.prev.x = a.pos.x;
      a.prev.y = a.pos.y;
      a.prev.z = a.pos.z;
      const k = 1 - Math.exp(-dt * 14);
      if (Math.hypot(tx - a.pos.x, tz - a.pos.z) > 4) {
        a.pos.x = tx;
        a.pos.y = ty;
        a.pos.z = tz;
      } else {
        a.pos.x += (tx - a.pos.x) * k;
        a.pos.y += (ty - a.pos.y) * k;
        a.pos.z += (tz - a.pos.z) * k;
      }
      a.vel.x = n.vx;
      a.vel.y = n.vy;
      a.vel.z = n.vz;
    }
  }
}

// 패치 구역 등: 같은 번호는 그 자리에서 고쳐 써서 화면 효과가 다시 만들어지지 않게
function mergeById(list, incoming) {
  const byId = new Map(list.map((o) => [o.id, o]));
  return incoming.map((o) => {
    const cur = byId.get(o.id);
    return cur ? Object.assign(cur, o) : o;
  });
}

// ───────────────────────── 입력 ─────────────────────────
// 한 번 누르는 동작의 카운터 순서
const ACT = { reload: 0, interact: 1, patch0: 2, report: 6, command: 7, fire: 8, equipThrow: 9, equipGadget: 10, ads: 11, door0: 12 };
const ACT_COUNT = 12 + DOOR_ACTS.length;

// 참가자: 키보드·마우스 조종자를 감싸 입력을 기록하고, 방장만 처리할 동작은 이 화면의 예측에서 뺌
export class InputRecorder {
  constructor(base) {
    this.base = base;
    this.c = Array(ACT_COUNT).fill(0);
    this.cards = [];
    this.cardN = 0;
    this.buys = [];
    this.buyN = 0;
    this.quizN = 0;
    this.qz = null;
    this.seq = 0;
    this.cmd = null;
    this.latest = null;
    this.wasFire = false;
    this.onCard = null;
  }

  getIntent(match, a, dt) {
    const i = this.base.getIntent(match, a, dt);
    if (i.reload) this.c[ACT.reload]++;
    if (i.interact) this.c[ACT.interact]++;
    i.patch.forEach((p, k) => {
      if (p) this.c[ACT.patch0 + k]++;
    });
    if (i.report) this.c[ACT.report]++;
    if (i.command) {
      this.c[ACT.command]++;
      this.cmd = i.command.type;
    }
    if (i.fire && !this.wasFire) this.c[ACT.fire]++;
    this.wasFire = i.fire;
    if (i.ads && !this.wasAds) this.c[ACT.ads]++;
    this.wasAds = i.ads;
    if (i.equip === 'throw') this.c[ACT.equipThrow]++;
    if (i.equip === 'gadget') this.c[ACT.equipGadget]++;
    if (i.door && DOOR_ACTS.includes(i.door)) this.c[ACT.door0 + DOOR_ACTS.indexOf(i.door)]++;
    if (i.card >= 0) {
      this.cardN++;
      this.cards.push([this.cardN, i.card]);
      if (this.cards.length > 6) this.cards.shift();
      // 해체 카드는 바로 화면에 반영 (방장 확인 전까지 유지)
      if (a.lockpick?.kind === 'puzzle') a.lockpick.selected[i.card] = !a.lockpick.selected[i.card];
      this.onCard?.(this.seq + 1);
    }
    if (i.quiz >= 0) this.qz = [++this.quizN, i.quiz];
    if (i.buy) {
      this.buyN++;
      this.buys.push([this.buyN, ITEMS.indexOf(i.buy)]);
      if (this.buys.length > 6) this.buys.shift();
    }
    const weapon = i.switchTo ?? a.weapon;
    this.latest = {
      s: ++this.seq,
      mx: i.moveX,
      mz: i.moveZ,
      y: r3(i.yaw),
      p: r3(i.pitch),
      b: (i.fire ? 1 : 0) | (i.ads ? 2 : 0) | (i.walk ? 4 : 0) | (i.jump ? 8 : 0) | (i.crouch ? 16 : 0),
      l: i.lean,
      w: WEAP.indexOf(weapon),
      a: [...this.c],
      cm: this.cmd,
      cd: this.cards.map((c) => [...c]),
      by: this.buys.map((c) => [...c]),
      qz: this.qz,
    };
    // 이 화면에서는 이동·사격·재장전·무기 교체만 미리 보여 줌
    i.interact = false;
    i.patch = [false, false, false, false];
    i.command = null;
    i.report = false;
    i.card = -1;
    i.buy = null; // 구매는 방장이 처리
    i.quiz = -1; // 점검 답도 방장이 채점
    i.equip = null; // 장비 들기도 방장이 (화면은 방장 값을 따름)
    i.door = null; // 문도 방장이 (문 각도는 방장 값을 따름)
    return i;
  }
}

// 방장: 참가자가 보낸 최신 입력으로 그 요원을 조종
export class RemoteController {
  constructor(getInput, onAck) {
    this.getInput = getInput;
    this.onAck = onAck;
    this.seen = null;
    this.cardSeen = 0;
    this.buySeen = 0;
  }

  getIntent(match, a) {
    const i = emptyIntent(a);
    const inp = this.getInput();
    if (!inp || !Array.isArray(inp.a)) return i;
    i.yaw = inp.y;
    i.pitch = inp.p;
    i.moveX = Math.max(-1, Math.min(1, inp.mx | 0));
    i.moveZ = Math.max(-1, Math.min(1, inp.mz | 0));
    i.fire = !!(inp.b & 1);
    i.ads = !!(inp.b & 2);
    i.walk = !!(inp.b & 4);
    i.jump = !!(inp.b & 8);
    i.crouch = !!(inp.b & 16);
    i.lean = Math.max(-1, Math.min(1, inp.l | 0));
    const w = WEAP[inp.w];
    if (w && w !== a.weapon && a.weapons[w]) i.switchTo = w;
    const c = inp.a;
    if (!this.seen) {
      // 처음 받은 입력: 그때까지의 횟수는 이미 지난 일
      this.seen = [...c];
      this.cardSeen = Math.max(0, ...((inp.cd ?? []).map((x) => x[0])));
      this.buySeen = Math.max(0, ...((inp.by ?? []).map((x) => x[0])));
      this.quizSeen = Array.isArray(inp.qz) ? inp.qz[0] - 1 : 0;
    }
    const fresh = (k) => (c[k] ?? 0) > (this.seen[k] ?? 0);
    if (fresh(ACT.reload)) i.reload = true;
    if (fresh(ACT.interact)) i.interact = true;
    for (let k = 0; k < 4; k++) if (fresh(ACT.patch0 + k)) i.patch[k] = true;
    if (fresh(ACT.report)) i.report = true;
    if (fresh(ACT.command) && inp.cm) i.command = { type: inp.cm };
    // 짧게 눌렀다 뗀 사격(권총)·투척도 놓치지 않게
    if (fresh(ACT.fire) && !i.fire) i.fire = true;
    if (fresh(ACT.ads) && !i.ads && a.equip) i.ads = true;
    if (fresh(ACT.equipThrow)) i.equip = 'throw';
    else if (fresh(ACT.equipGadget)) i.equip = 'gadget';
    const door = DOOR_ACTS.findIndex((_, k) => fresh(ACT.door0 + k));
    if (door >= 0) i.door = DOOR_ACTS[door];
    this.seen = [...c];
    // 해체 카드: 한 틱에 하나씩
    const next = (inp.cd ?? []).find(([n]) => n > this.cardSeen);
    if (next) {
      this.cardSeen = next[0];
      i.card = next[1];
    }
    // 구매: 한 틱에 하나씩
    const nb = (inp.by ?? []).find(([n]) => n > this.buySeen);
    if (nb) {
      this.buySeen = nb[0];
      i.buy = ITEMS[nb[1]] ?? null;
    }
    // 개념 점검 답 (한 번만)
    if (Array.isArray(inp.qz) && inp.qz[0] > (this.quizSeen ?? 0)) {
      this.quizSeen = inp.qz[0];
      i.quiz = inp.qz[1] | 0;
    }
    this.onAck?.(inp.s);
    return i;
  }
}

// ───────────────────────── 경기 시작 정보 ─────────────────────────
// players: [{ key, name, team, load: [패치 id …] }] (들어온 순서). 팀마다 5자리, 빈자리는 봇.
// 결과: { roster: [{ id, team, name, key }], loadouts: [[id, [패치 4개]] …] }
export function planMatch(players, { teamSize = 5, botNames, draft, rng } = {}) {
  const roster = [];
  for (const team of TEAMS_) {
    const humans = players.filter((p) => p.team === team).slice(0, teamSize);
    for (let i = 0; i < teamSize; i++) {
      const h = humans[i];
      roster.push({ id: `${team}-${i}`, team, name: h ? String(h.name || '요원').slice(0, 8) : botNames[team][i], key: h?.key ?? null, mas: h ? (h.mastery ?? []).filter((x) => typeof x === 'string').slice(0, 20) : [] });
    }
  }
  // 패치: 사람은 고른 것 중 팀 재고(2기) 안에서 들어온 순서대로, 나머지는 자동
  const loadouts = [];
  for (const team of TEAMS_) {
    const members = roster.filter((r) => r.team === team);
    const d = new draft(members.map((r) => r.id));
    for (const r of members) {
      if (!r.key) continue;
      const want = players.find((p) => p.key === r.key)?.load ?? [];
      for (const id of want) if (d.isFeasibleAfter(r.id, id)) d.pick(r.id, id);
    }
    d.autoFill(rng, members.filter((r) => r.key).map((r) => r.id));
    for (const [id, l] of d.loadouts()) loadouts.push([id, l]);
  }
  return { roster, loadouts };
}

// CQB 작전 명단: 사람은 모두 진압팀(들어온 순서, 5명까지), 빈자리는 봇 · 용의자 suspects명은 봇
export function planOp(players, { botNames, suspects }) {
  const humans = players.slice(0, 5);
  const roster = [];
  for (let i = 0; i < 5; i++) {
    const h = humans[i];
    roster.push({ id: `defuse-${i}`, team: 'defuse', name: h ? String(h.name || '요원').slice(0, 8) : botNames.defuse[i], key: h?.key ?? null, mas: h ? (h.mastery ?? []).filter((x) => typeof x === 'string').slice(0, 20) : [] });
  }
  for (let i = 0; i < suspects; i++) roster.push({ id: `force-${i}`, team: 'force', name: `용의자 ${i + 1}`, key: null, mas: [] });
  return { roster, loadouts: [], op: true };
}

// 이 화면 기준 명단 (내 요원 = isPlayer, 다른 사람 = human)
export function rosterFor(plan, myKey) {
  return plan.roster.map((r) => ({ id: r.id, team: r.team, name: r.name, isPlayer: !!r.key && r.key === myKey, human: !!r.key && r.key !== myKey, mastery: r.mas ?? [] }));
}

// 시작 정보를 작게 (presence 4KB 안에 경기 상태와 같이 들어가야 함): 패치는 번호로, 봇 이름은 생략
export function packPlan(plan, patchOrder) {
  return {
    h: plan.roster.filter((r) => r.key).map((r) => [r.id, r.key, r.name, (r.mas ?? []).map((c) => CONCEPT_IDS.indexOf(c)).filter((k) => k >= 0)]),
    l: plan.roster.map((r) => (new Map(plan.loadouts).get(r.id) ?? []).map((id) => (id ? patchOrder.indexOf(id) : -1))),
    n: TEAMS_.map((t) => plan.roster.filter((r) => r.team === t).length),
    op: plan.op ? 1 : 0,
  };
}

export function unpackPlan(packed, patchOrder, botNames) {
  const humans = new Map(packed.h.map(([id, key, name, mas]) => [id, { key, name, mas: (mas ?? []).map((k) => CONCEPT_IDS[k]).filter(Boolean) }]));
  const roster = [];
  TEAMS_.forEach((team, k) => {
    const n = packed.n?.[k] ?? 5;
    for (let i = 0; i < n; i++) {
      const id = `${team}-${i}`;
      const h = humans.get(id);
      const bot = packed.op && team === 'force' ? `용의자 ${i + 1}` : botNames[team][i];
      roster.push({ id, team, name: h ? h.name : bot, key: h?.key ?? null, mas: h?.mas ?? [] });
    }
  });
  const loadouts = roster.map((r, i) => [r.id, (packed.l[i] ?? []).map((k) => (k >= 0 ? patchOrder[k] : null))]);
  return { roster, loadouts };
}
