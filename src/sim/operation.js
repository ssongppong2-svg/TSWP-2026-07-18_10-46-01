// CQB 작전 (레디 오어 낫식 협동): 진압팀(해체팀 쪽 5명 — 사람 + 봇) vs 건물을 점거한 무장 용의자 봇
//   목표: 용의자 전원 제압 · 장치 해체 · 연구원 구출(투입 지점까지 호송) · 연구 자료 확보
//   진행: 준비(투입 지점에서 보급) → 작전 → 끝 (모든 목표 완료 = 성공 / 진압팀 전멸·장치 폭발 = 실패)
//   장치 제한 시간은 장치가 모두 해체되면 멈춤 (그 뒤로는 서두르지 않고 수색·호송)
// 맵 정의의 op: { extract, hostages, intel, posts }가 배치를 정한다.
import { segmentAabb } from '../core/vec.js';
import { BOT_NAMES, CELL, TEAMS } from './constants.js';
import { eyePos, freshAmmo, giveWeapon } from './agent.js';
import { ARMOR } from './data.js';
import { emptyGear } from './gear.js';

export const OP = {
  prep: 45, // 준비 시간 (보급 단말기, 투입 지점 밖으로 못 나감)
  budget: 6500, // 작전 예산 (J)
  freeTime: 1.2, // 연구원 결박 풀기 (F)
  intelTime: 1.4, // 연구 자료 확보 (F)
  reach: 1.7,
  hostageHp: 100,
  hostageSpeed: 3.0, // 호송될 때 (몸을 숙이고 뜀)
  hostageRadius: 0.3,
  hostageHeight: 1.1, // 무릎 꿇은 키 (탄 판정)
  spot: 14, // 진압팀이 이 거리 안에서 직접 보면 연구원·자료 발견 (지도에 표시)
};

export const MISSIONS = [
  {
    id: 'annex',
    map: 'lab-annex',
    name: '별관 점거 사건',
    code: 'OP-01',
    time: 600,
    brief: '무장 용의자들이 응용역학 연구 별관을 점거하고 연구원들을 붙잡았다. 화학 실험실에 정체불명의 장치가 설치됨. 비 내리는 밤, 문으로 나뉜 좁은 실내 작전.',
    suspects: { easy: 6, normal: 8, hard: 10 },
  },
  {
    id: 'hall',
    map: 'science-hall-op',
    name: '과학관 야간 침입',
    code: 'OP-02',
    time: 720,
    brief: '폐관한 과학관에 무장 집단이 침입해 전시관 두 곳에 장치를 설치했다. 야간 경비 연구원들이 실험실과 강당에 붙잡혀 있음. 넓은 전시관과 2층 회랑, 좁은 실험실 문.',
    suspects: { easy: 7, normal: 9, hard: 11 },
  },
];
export const missionById = (id) => MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];

export const OBJECTIVES = [
  { id: 'neutralize', label: '용의자 전원 제압' },
  { id: 'defuse', label: '장치 해체' },
  { id: 'rescue', label: '연구원 구출' },
  { id: 'intel', label: '연구 자료 확보' },
];

const RESEARCHERS = ['김 연구원', '이 연구원', '박 연구원', '최 연구원', '정 연구원', '한 연구원'];

// 작전 명단: 진압팀 5명(해체팀 쪽) + 용의자 count명(포스팀 쪽). humans: 온라인으로 들어온 사람 [{ id, name, key }]
export function makeOpRoster(playerName, count, { me = true } = {}) {
  const roster = [];
  for (let i = 0; i < 5; i++) roster.push({ id: `defuse-${i}`, team: TEAMS.DEFUSE, isPlayer: me && i === 0, name: me && i === 0 ? playerName : BOT_NAMES.defuse[i] });
  for (let i = 0; i < count; i++) roster.push({ id: `force-${i}`, team: TEAMS.FORCE, isPlayer: false, name: `용의자 ${i + 1}` });
  return roster;
}

// 용의자 무장 (무작위): 권총 · 기관단총 · 산탄총 · 소총, 일부는 경량 방탄
const SUSPECT_ARMS = [['pistol', 0.25], ['smg', 0.32], ['shotgun', 0.18], ['rifle', 0.25]];

export class Operation {
  constructor(match, mission, { difficulty = 'normal' } = {}) {
    this.match = match;
    this.mission = mission;
    this.difficulty = difficulty;
    const map = match.map;
    const op = map.def.op ?? {};
    const cellRect = (q) => ({ x0: map.originX + q.c0 * CELL, x1: map.originX + (q.c1 + 1) * CELL, z0: map.originZ + q.r0 * CELL, z1: map.originZ + (q.r1 + 1) * CELL });
    this.extract = cellRect(op.extract ?? { r0: 0, r1: map.rows - 1, c0: 0, c1: map.cols - 1 });
    this.hostages = (op.hostages ?? []).map((h, i) => ({ id: i, name: RESEARCHERS[i % RESEARCHERS.length], home: { x: map.cellX(h.c), z: map.cellZ(h.r) }, yaw0: h.yaw ?? 0 }));
    this.intel = (op.intel ?? []).map((it, i) => ({ id: i, name: it.name ?? '연구 자료', x: map.cellX(it.c), y: 0, z: map.cellZ(it.r) }));
    this.posts = (op.posts ?? []).map((p) => ({
      x: map.cellX(p.c), y: 0, z: map.cellZ(p.r),
      look: { x: map.cellX(p.lc ?? p.c), y: 1.4, z: map.cellZ(p.lr ?? p.r) },
      patrol: p.patrol ? { x: map.cellX(p.patrol.c), y: 0, z: map.cellZ(p.patrol.r) } : null,
    }));
    match.doorKeyTeam = TEAMS.FORCE; // 용의자는 잠긴 문 열쇠가 있음
    this.reset();
  }

  reset() {
    for (const h of this.hostages) {
      Object.assign(h, { x: h.home.x, y: 0, z: h.home.z, prev: { x: h.home.x, z: h.home.z }, vel: { x: 0, z: 0 }, yaw: h.yaw0, state: 'captive', hp: OP.hostageHp, cower: 0, path: null, pathIdx: 0, freedBy: null, hurtBy: null, waitT: 0, found: false });
    }
    for (const it of this.intel) Object.assign(it, { taken: null, found: false });
    this.scanT = 0;
    this.devicesDone = false;
    this.stats = { hostageKilledBySwat: 0, hostageKilled: 0 };
    this.endedAt = null;
  }

  get swat() {
    return this.match.agents.filter((a) => a.team === TEAMS.DEFUSE);
  }

  get suspects() {
    return this.match.agents.filter((a) => a.team === TEAMS.FORCE);
  }

  // 작전 시작: 준비 단계 · 진압팀은 투입 지점에서 예산으로 보급 · 용의자는 자리(무작위)에 무장해서
  start() {
    const m = this.match;
    m.phase = 'buy';
    m.phaseT = OP.prep;
    m.liveAt = OP.prep;
    m.timeLeft = this.mission.time;
    m.devices.reset();
    m.doors.reset();
    this.reset();
    // 장치: 맵의 A·B 칸 그대로 (무작위로 옮기지 않음)
    for (const b of m.bombs) Object.assign(b, { state: 'armed', picker: null, progress: 0, alertT: -99 });
    for (const a of this.swat) {
      a.credits = OP.budget;
      a.bought = [];
      a.weapons = { pistol: freshAmmo('pistol'), knife: { mag: 0, reserve: 0 } };
      a.primary = null;
      a.secondary = 'pistol';
      a.weapon = 'pistol';
      a.gear = emptyGear();
      if (a.isPlayer || a.human) m.dealQuiz(a);
    }
    const order = this.posts.map((_, i) => i).sort(() => m.rng.next() - 0.5);
    this.suspects.forEach((a, i) => {
      const post = this.posts[order[i % order.length]];
      a.post = post;
      const [id] = SUSPECT_ARMS.find(([, p], k) => (m.rng.next() < p / SUSPECT_ARMS.slice(k).reduce((s, [, q]) => s + q, 0))) ?? ['smg'];
      a.weapons = { pistol: freshAmmo('pistol'), knife: { mag: 0, reserve: 0 } };
      if (id !== 'pistol') giveWeapon(a, id);
      a.primary = id === 'pistol' ? null : id;
      a.secondary = 'pistol';
      a.weapon = a.primary ?? 'pistol';
      const armored = m.rng.next() < (this.difficulty === 'hard' ? 0.6 : this.difficulty === 'easy' ? 0.2 : 0.4);
      a.armorKind = armored ? 'light' : null;
      a.armor = a.armorMax = armored ? ARMOR.light.dur : 0;
      a.gear = emptyGear();
      if (m.rng.next() < 0.25) a.gear.frag = 1;
    });
    this.placeAgents();
  }

  // 진압팀은 투입 지점, 용의자는 자기 자리 (바라볼 곳을 봄)
  placeAgents() {
    const m = this.match;
    const spawns = m.map.spawns.defuse;
    this.swat.forEach((a, i) => {
      const s = spawns[Math.round((i * (spawns.length - 1)) / Math.max(1, 4))] ?? spawns[0];
      this.put(a, s.x + m.rng.range(-0.3, 0.3), s.z + m.rng.range(-0.3, 0.3), 0);
    });
    for (const a of this.suspects) {
      const p = a.post ?? this.posts[0];
      this.put(a, p.x + m.rng.range(-0.25, 0.25), p.z + m.rng.range(-0.25, 0.25), Math.atan2(-(p.look.x - p.x), -(p.look.z - p.z)));
    }
  }

  put(a, x, z, yaw) {
    a.pos.x = a.prev.x = x;
    a.pos.z = a.prev.z = z;
    a.pos.y = a.prev.y = 0;
    a.vel.x = a.vel.y = a.vel.z = 0;
    a.yaw = yaw;
    a.pitch = 0;
  }

  inExtract(p) {
    const e = this.extract;
    return p.x > e.x0 && p.x < e.x1 && p.z > e.z0 && p.z < e.z1;
  }

  // ───── F: 연구원 결박 풀기 · 연구 자료 확보 (진압팀, 잠깐 멈춰서 함) ─────
  targetFor(a) {
    if (a.team !== TEAMS.DEFUSE || !a.alive) return null;
    let best = null, bestD = OP.reach;
    for (const h of this.hostages) {
      if (h.state !== 'captive') continue;
      const d = Math.hypot(h.x - a.pos.x, h.z - a.pos.z);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'free', item: h };
      }
    }
    for (const it of this.intel) {
      if (it.taken) continue;
      const d = Math.hypot(it.x - a.pos.x, it.z - a.pos.z);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'intel', item: it };
      }
    }
    return best;
  }

  interact(a) {
    if (this.match.phase !== 'live' || a.opTask) return false;
    const t = this.targetFor(a);
    if (!t) return false;
    a.opTask = { kind: t.kind, id: t.item.id, t: 0, need: t.kind === 'free' ? OP.freeTime : OP.intelTime, at: { x: a.pos.x, z: a.pos.z } };
    t.item.found = true;
    a.vel.x = a.vel.z = 0;
    this.match.emit('opTask', { agent: a, kind: t.kind, item: t.item, state: 'start' });
    return true;
  }

  cancelTask(a, reason) {
    if (!a.opTask) return;
    const t = a.opTask;
    a.opTask = null;
    this.match.emit('opTask', { agent: a, kind: t.kind, item: t.kind === 'free' ? this.hostages[t.id] : this.intel[t.id], state: 'cancel', reason });
  }

  stepTask(a, intent, dt) {
    const t = a.opTask;
    const item = t.kind === 'free' ? this.hostages[t.id] : this.intel[t.id];
    // 움직이려 하거나(이동 키·점프) 밀려나면 취소
    const moved = Math.hypot(intent.moveX, intent.moveZ) > 0.3 || intent.jump || Math.hypot(a.pos.x - t.at.x, a.pos.z - t.at.z) > 0.6;
    if (!a.alive || moved || intent.fire || !item || (t.kind === 'free' ? item.state !== 'captive' : !!item.taken)) return this.cancelTask(a, 'moved');
    t.t += dt;
    if (t.t < t.need) return;
    a.opTask = null;
    if (t.kind === 'free') this.freeHostage(item, a);
    else {
      item.taken = a.id;
      this.match.emit('opTask', { agent: a, kind: 'intel', item, state: 'done' });
      this.match.radio(a, `연구 자료 확보 — ${item.name} (${this.intel.filter((x) => x.taken).length}/${this.intel.length})`, { kind: 'order' });
    }
  }

  // 결박을 풀면 연구원은 몸을 숙인 채 호송 지점(투입 지점)까지 스스로 이동
  freeHostage(h, a) {
    h.state = 'free';
    h.freedBy = a?.id ?? null;
    h.path = null;
    h.cower = 0;
    this.match.emit('opTask', { agent: a, kind: 'free', item: h, state: 'done' });
    if (a) this.match.radio(a, `${h.name} 결박 해제. 투입 지점으로 호송.`, { kind: 'order' });
  }

  // ───── 매 틱 ─────
  update(dt) {
    const m = this.match;
    if (m.phase !== 'live') return;
    // 장치가 모두 해체되면 제한 시간이 멈춤
    if (!this.devicesDone && m.bombs.length && m.bombs.every((b) => b.state === 'defused')) {
      this.devicesDone = true;
      m.emit('opDevices', {});
    }
    if (this.devicesDone) m.timeLeft = Math.max(m.timeLeft, 1);
    for (const h of this.hostages) this.stepHostage(h, dt);
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.25;
      this.scan();
    }
  }

  // 발견: 진압팀 누군가 직접 본 연구원·자료 (지도에 표시, 무전 보고)
  scan() {
    const m = this.match;
    const eyes = this.swat.filter((a) => a.alive).map((a) => ({ a, eye: eyePos(a) }));
    const look = (list, kind, y) => {
      for (const t of list) {
        if (t.found || (kind === 'intel' && t.taken)) continue;
        const p = { x: t.x, y, z: t.z };
        const by = eyes.find(({ eye }) => Math.hypot(eye.x - p.x, eye.z - p.z) < OP.spot && m.map.lineOfSight(eye, p));
        if (!by) continue;
        t.found = true;
        m.emit('opFound', { kind, item: t, agent: by.a });
      }
    };
    look(this.hostages, 'hostage', 0.8);
    look(this.intel, 'intel', 1.0);
  }

  stepHostage(h, dt) {
    const m = this.match;
    h.prev.x = h.x;
    h.prev.z = h.z;
    h.cower = Math.max(0, h.cower - dt);
    // 사람과 겹치지 않게 (사람을 밀어냄)
    for (const a of m.agents) {
      if (!a.alive || a.pos.y > 1) continue;
      const dx = a.pos.x - h.x, dz = a.pos.z - h.z;
      const d = Math.hypot(dx, dz), R = OP.hostageRadius + 0.35;
      if (d > 1e-4 && d < R && h.state !== 'dead') {
        a.pos.x += (dx / d) * (R - d);
        a.pos.z += (dz / d) * (R - d);
      }
    }
    if (h.state !== 'free') return;
    if (this.inExtract(h)) {
      h.state = 'rescued';
      h.vel.x = h.vel.z = 0;
      m.emit('hostageRescued', { hostage: h });
      const a = m.agentById(h.freedBy) ?? this.swat.find((x) => x.alive);
      if (a) m.radio(a, `${h.name} 구출 완료 (${this.hostages.filter((x) => x.state === 'rescued').length}/${this.hostages.length})`, { kind: 'order' });
      return;
    }
    if (h.cower > 0.4) {
      h.vel.x = h.vel.z = 0;
      return; // 섬광·폭발에 웅크림
    }
    if (!h.path || h.repathT <= 0) {
      const e = this.extract;
      const goal = { x: (e.x0 + e.x1) / 2, y: 0, z: (e.z0 + e.z1) / 2 };
      h.path = m.nav.findPath({ x: h.x, y: 0, z: h.z }, goal, { avoid: h.avoid }) ?? [];
      h.pathIdx = 0;
      h.repathT = 5;
    }
    h.repathT -= dt;
    while (h.pathIdx < h.path.length && Math.hypot(h.path[h.pathIdx].x - h.x, h.path[h.pathIdx].z - h.z) < 0.6) h.pathIdx++;
    const wp = h.path[h.pathIdx];
    if (!wp) {
      h.path = null;
      return;
    }
    let dx = wp.x - h.x, dz = wp.z - h.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // 길 앞의 닫힌 문은 염 (잠긴 문이면 기다림)
    const hit = m.map.leaves.length ? m.map.raycastLeaves({ x: h.x, y: 1, z: h.z }, { x: h.x + dx * 1.4, y: 1, z: h.z + dz * 1.4 }, 1) : null;
    if (hit) {
      const d = m.doors.list[hit.door];
      h.vel.x = h.vel.z = 0;
      h.waitT -= dt;
      if (d && h.waitT <= 0 && !(Math.abs(d.st.tgt) > 1 && d.st.ang !== d.st.tgt)) {
        h.waitT = 1;
        h.team = 'civ';
        h.pos = { x: h.x, y: 0, z: h.z };
        // 잠긴 문: 한 번 손잡이를 돌려 보고, 그 문을 피하는 다른 길로 (없으면 그 자리에서 기다림)
        if (d.st.locked) {
          m.doors.rattle(h, d);
          h.avoid ??= new Set();
          h.avoid.add(m.map.idx(d.c, d.r));
          h.path = null;
          h.repathT = 0;
          h.waitT = 3;
        } else m.doors.use(h, d);
      }
      return;
    }
    h.yaw = Math.atan2(-dx, -dz);
    h.vel.x = dx * OP.hostageSpeed;
    h.vel.z = dz * OP.hostageSpeed;
    const pos = { x: h.x + h.vel.x * dt, y: 0, z: h.z + h.vel.z * dt };
    m.map.collideCircle(pos, OP.hostageRadius, 0, 0.45, h.vel, 1.5);
    h.x = pos.x;
    h.z = pos.z;
  }

  // ───── 피해 ─────
  // 총알 선분과 연구원 (무릎 꿇으면 낮게, 호송 중이면 숙인 키)
  hitTest(a, b, tMax) {
    let best = null;
    for (const h of this.hostages) {
      if (h.state === 'dead' || h.state === 'rescued') continue;
      const top = h.state === 'captive' ? OP.hostageHeight : 1.45;
      const t = segmentAabb(a, b, { x: h.x - 0.28, y: 0, z: h.z - 0.28 }, { x: h.x + 0.28, y: top, z: h.z + 0.28 });
      if (t >= 0 && t < tMax && (!best || t < best.t)) best = { t, hostage: h };
    }
    return best;
  }

  hurtHostage(h, amount, attacker) {
    if (h.state === 'dead' || h.state === 'rescued' || this.match.phase !== 'live') return;
    h.hp -= amount;
    h.cower = Math.max(h.cower, 1.2);
    this.match.emit('hostageHit', { hostage: h, attacker, amount });
    if (h.hp > 0) return;
    h.hp = 0;
    h.state = 'dead';
    this.stats.hostageKilled++;
    if (attacker?.team === TEAMS.DEFUSE) this.stats.hostageKilledBySwat++;
    this.match.emit('hostageDown', { hostage: h, attacker });
    const a = this.swat.find((x) => x.alive);
    if (a) this.match.radio(a, `${h.name} 사망 확인.${attacker?.team === TEAMS.DEFUSE ? ' 아군 사격.' : ''}`, { kind: 'lost' });
  }

  // 섬광·이명·폭발: 가까운 연구원은 웅크림 (폭발은 피해도)
  onBlast(at, def, owner, exposureOf) {
    for (const h of this.hostages) {
      if (h.state === 'dead' || h.state === 'rescued') continue;
      const k = exposureOf({ x: h.x, y: 0.7, z: h.z });
      if (k <= 0) continue;
      h.cower = Math.max(h.cower, 2.5 * k + 0.5);
      if (def?.damage) this.hurtHostage(h, def.damage * Math.pow(k, 1.15), owner);
    }
  }

  // ───── 목표 · 끝 ─────
  objectives() {
    const m = this.match;
    const down = this.suspects.filter((a) => !a.alive).length, total = this.suspects.length;
    const defused = m.bombs.filter((b) => b.state === 'defused').length;
    const rescued = this.hostages.filter((h) => h.state === 'rescued').length;
    const dead = this.hostages.filter((h) => h.state === 'dead').length;
    const taken = this.intel.filter((i) => i.taken).length;
    return [
      { id: 'neutralize', label: '용의자 전원 제압', done: down === total, detail: `${down}/${total}` },
      { id: 'defuse', label: m.bombs.length > 1 ? `장치 ${m.bombs.length}기 해체` : '장치 해체', done: defused === m.bombs.length, failed: m.bombs.some((b) => b.state === 'exploded'), detail: `${defused}/${m.bombs.length}` },
      { id: 'rescue', label: '연구원 구출', done: rescued + dead === this.hostages.length && rescued > 0, failed: dead > 0, detail: `${rescued}/${this.hostages.length}${dead ? ` · 사망 ${dead}` : ''}` },
      { id: 'intel', label: '연구 자료 확보', done: taken === this.intel.length, detail: `${taken}/${this.intel.length}` },
    ];
  }

  checkEnd() {
    const m = this.match;
    if (m.phase !== 'live') return null;
    if (m.alive(TEAMS.DEFUSE).length === 0) return this.finish(false, '진압팀 전원 쓰러짐');
    if (m.timeLeft <= 0 && m.bombs.some((b) => b.state === 'armed')) {
      m.timeLeft = 0;
      for (const b of m.bombs) if (b.state === 'armed') b.state = 'exploded';
      m.emit('explode', { bombs: m.bombs.filter((b) => b.state === 'exploded') });
      return this.finish(false, '제한 시간 종료 — 장치 폭발');
    }
    const obj = this.objectives();
    const hostagesSettled = this.hostages.every((h) => h.state === 'rescued' || h.state === 'dead');
    if (obj[0].done && obj[1].done && obj[3].done && hostagesSettled) return this.finish(true, '모든 목표 완료');
    return null;
  }

  finish(success, reason) {
    const m = this.match;
    this.endedAt = m.time;
    this.result = this.score(success, reason);
    return m.end(success ? TEAMS.DEFUSE : TEAMS.FORCE, reason);
  }

  // 평가: 목표 4개 각 25점 (부분 점수) − 아군 사격으로 숨진 연구원 · 쓰러진 대원
  score(success, reason) {
    const obj = this.objectives();
    const m = this.match;
    const frac = (s) => {
      const [a, b] = s.split('/').map((x) => parseInt(x, 10));
      return b ? a / b : 1;
    };
    const parts = obj.map((o) => ({ ...o, points: Math.round(25 * (o.failed && o.id === 'defuse' ? 0 : frac(o.detail))) }));
    const swatDown = this.swat.filter((a) => !a.alive).length;
    const penalty = this.stats.hostageKilledBySwat * 15 + swatDown * 4;
    let total = Math.max(0, parts.reduce((s, p) => s + p.points, 0) - penalty);
    if (!success) total = Math.min(total, 60);
    const grade = total >= 95 ? 'S' : total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 50 ? 'C' : 'D';
    return {
      success,
      reason,
      mission: this.mission.id,
      objectives: parts,
      penalty,
      swatDown,
      hostagesKilledBySwat: this.stats.hostageKilledBySwat,
      time: Math.max(0, m.time - (m.liveAt ?? 0)),
      total,
      grade,
    };
  }

  // 온라인: [연구원 상태 번호, x, z, 방향, 체력, 웅크림] · 자료를 가져간 요원 번호
  pack(idx) {
    const r2 = (v) => Math.round(v * 100) / 100;
    const ST = ['captive', 'free', 'rescued', 'dead'];
    return {
      h: this.hostages.map((h) => [ST.indexOf(h.state), r2(h.x), r2(h.z), r2(h.yaw), Math.round(h.hp), r2(h.cower)]),
      i: this.intel.map((it) => (it.taken ? idx(it.taken) : -1)),
      d: this.devicesDone ? 1 : 0,
      f: [...this.hostages, ...this.intel].reduce((bits, t, k) => bits | (t.found ? 1 << k : 0), 0),
    };
  }

  unpack(s, agentAt) {
    if (!s) return;
    const ST = ['captive', 'free', 'rescued', 'dead'];
    (s.h ?? []).forEach((v, k) => {
      const h = this.hostages[k];
      if (!h) return;
      h.prev.x = h.x;
      h.prev.z = h.z;
      [h.state, h.x, h.z, h.yaw, h.hp, h.cower] = [ST[v[0]] ?? h.state, v[1], v[2], v[3], v[4], v[5]];
    });
    (s.i ?? []).forEach((v, k) => {
      if (this.intel[k]) this.intel[k].taken = v >= 0 ? agentAt(v)?.id ?? 'x' : null;
    });
    this.devicesDone = !!s.d;
    [...this.hostages, ...this.intel].forEach((t, k) => (t.found = !!((s.f ?? 0) & (1 << k))));
  }
}
