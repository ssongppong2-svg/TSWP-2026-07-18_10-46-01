import { Emitter } from '../core/events.js';
import { createRng } from '../core/rng.js';
import { clamp, copy, dirFromAngles, dist, scale, segmentAabb, segmentSphere } from '../core/vec.js';
import { bodyTop, chestPos, createAgent, emptyIntent, eyePos, freshAmmo, giveWeapon, stepMovement } from './agent.js';
import {
  BOMB, BOT_NAMES, ECON, MASTERY, NOISE, PLAYER, PRE_ROUND_TIME, PROJECTILE, ROUND_TIME, ROUNDS, STAMINA, SUPPRESS, TEAM_SIZE, TEAMS, ULT, otherTeam,
} from './constants.js';
import { AMMO, ARMOR, PATCHES, WEAPONS, falloffAt } from './data.js';
import { hitArmor } from './ballistics.js';
import { BAT_KEY, DRONE, EFFECT, GEAR, RC, emptyGear, exposure, nextThrowable, placeTarget, remoteEye, remoteHitSphere, stepDrone, stepRC, stepThrown, throwVelocity } from './gear.js';
import { Gadgets, PULSE } from './gadgets.js';
import { CONCEPTS, CONCEPT_BY_ID, PATCH_CONCEPT } from './concepts.js';
import { CARD_COUNT, PUZZLE_INFO, generatePuzzle, isSolved } from './lockpick.js';
import { GameMap, STORY } from './map.js';
import { NavGrid } from './nav.js';
import { Devices } from './devices.js';
import { Doors, MIRROR } from './doors.js';
import { ENTRY_MODE, ENTRY_REACH } from './entry-orders.js';
import { Operation, makeOpRoster, missionById } from './operation.js';
import { leafSegment } from './door-geo.js';

// 팀 명단 (포스 패치 선택 화면과 경기에서 같은 id를 씀)
export function makeRoster(playerTeam, playerName = '나') {
  const roster = [];
  for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) {
    for (let i = 0; i < TEAM_SIZE; i++) {
      const isPlayer = team === playerTeam && i === 0;
      roster.push({
        id: `${team}-${i}`,
        team,
        isPlayer,
        name: isPlayer ? playerName : BOT_NAMES[team][i],
      });
    }
  }
  return roster;
}

function spreadDir(dir, spread, rng) {
  if (spread <= 0) return dir;
  // dir에 수직인 두 축
  const up = Math.abs(dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let rx = up.y * dir.z - up.z * dir.y, ry = up.z * dir.x - up.x * dir.z, rz = up.x * dir.y - up.y * dir.x;
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl; ry /= rl; rz /= rl;
  const ux = dir.y * rz - dir.z * ry, uy = dir.z * rx - dir.x * rz, uz = dir.x * ry - dir.y * rx;
  const a = rng.next() * Math.PI * 2;
  const r = spread * Math.sqrt(rng.next());
  const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
  const x = dir.x + rx * ca + ux * sa, y = dir.y + ry * ca + uy * sa, z = dir.z + rz * ca + uz * sa;
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}

// 선분 a→b 와 세워진 방패 판(가로 2·halfW, 세로 y0~y1)의 교차 t(0~1). 없으면 -1.
export function segmentShield(a, b, sh) {
  const nx = -Math.sin(sh.yaw), nz = -Math.cos(sh.yaw);
  const da = (a.x - sh.x) * nx + (a.z - sh.z) * nz;
  const db = (b.x - sh.x) * nx + (b.z - sh.z) * nz;
  if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) return -1;
  const t = da / (da - db);
  const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t, pz = a.z + (b.z - a.z) * t;
  const lx = (px - sh.x) * Math.cos(sh.yaw) - (pz - sh.z) * Math.sin(sh.yaw);
  if (Math.abs(lx) > sh.halfW || py < sh.y0 || py > sh.y1) return -1;
  return t;
}

// 총을 쏠 때 움직이는 빠르기에 따른 빗나감 (0 = 멈춤, 1 = 달리기). 걷기는 절반쯤
const moveFactor = (a) => clamp((Math.hypot(a.vel.x, a.vel.z) - 0.8) / (PLAYER.runSpeed - 0.8), 0, 1);

export class Match {
  // rules: 'rounds' 발로란트식 라운드제 (구매 시간·상점·7선승·공수 교대) / 'single' 한 판으로 끝 (시험·연습용)
  // conceptIds: 개념 카드로 먼저 놓을 개념 (아직 도감에 없는 것 등). conceptCount: 맵에 놓을 카드 수
  // roster: 직접 정한 명단 (온라인: 사람 여러 명 + 봇). client: 온라인 참가자 화면용 — 규칙 계산은 방장이 하고
  //         여기서는 자기 요원의 이동·사격 연출만 미리 보여 줌 (피해·패치·해체는 방장 결과를 받아 씀)
  // rules: 'single' 한 판 · 'rounds' 라운드제 5대5 · 'cqb' CQB 작전 (mission: 작전 id 또는 정의, opDifficulty: 용의자 수·무장)
  constructor({ map = null, mapId = undefined, playerTeam = null, playerName = '나', loadouts = new Map(), seed = Date.now(), conceptIds = null, conceptCount = 4, roster = null, client = false, rules = 'single', playerMastery = [], mission = null, opDifficulty = 'normal' } = {}) {
    const op = rules === 'cqb' ? (typeof mission === 'object' && mission ? mission : missionById(mission)) : null;
    if (op && !map && !mapId) mapId = op.map;
    this.map = map ?? new GameMap(mapId);
    this.nav = new NavGrid(this.map);
    this.rng = createRng(seed);
    this.events = new Emitter();
    this.playerTeam = playerTeam;
    this.agents = [];
    this.devices = new Devices(this); // 탄성 발판·승강기·지레 셔터·미끄럼틀
    this.charges = []; // 붙여 둔 C4 (문에 붙은 것은 문을 따라 움직임)
    this.doors = new Doors(this); // 문 (열기·살짝 열기·발차기·폭파·문 밑 카메라)
    this.controllers = new Map();
    this.projectiles = [];
    this.veils = [];
    this.zones = [];
    this.shields = [];
    this.throwables = []; // 날아가거나 바닥에 있는 투척물 (gear.js)
    this.drones = []; // 날고 있는 정찰 드론 · 달리는 RC카 (kind: 'drone' | 'rc')
    this.gadgets = new Gadgets(this); // 경보 센서 · 던지는 카메라 · 심장 박동 센서 · EMP
    this.noises = []; // 최근 소리 (봇의 청각·무게 감지기·무전 보고에 사용)
    this.scans = []; // 작동 중인 무게 감지기
    this.orders = { defuse: null, force: null }; // 팀 지휘 명령
    this.intel = { defuse: [], force: [] }; // 무전으로 공유된 소리 정보
    this.nextId = 1;
    this.time = 0;
    this.rules = rules;
    this.liveAt = PRE_ROUND_TIME;
    this.phase = 'buy'; // buy 시작 전(구매) → live 진행 → roundEnd 라운드 결과 → (다음 라운드 buy) … → ended
    this.phaseT = PRE_ROUND_TIME;
    this.timeLeft = ROUND_TIME;
    this.winner = null; // 경기에서 이긴 분대 (분대 이름 = 처음 맡은 쪽)
    this.reason = '';
    this.endT = 0;
    this.visT = 0;
    this.warned = new Set();
    // 라운드제 기록
    this.round = 1;
    this.score = { defuse: 0, force: 0 }; // 분대별 이긴 라운드 수
    this.lossStreak = { defuse: 0, force: 0 };
    this.history = []; // 라운드마다 { round, squad(이긴 분대), side(이긴 쪽), reason }
    this.roundWinner = null; // 방금 끝난 라운드에서 이긴 쪽 (해체/포스)
    this.roundReason = '';
    this.swapped = false; // 공수 교대 후
    this.bombs = this.map.bombs.map((b) => ({ id: b.id, x: b.x, y: b.y ?? 0, z: b.z, state: 'armed', picker: null, progress: 0, alertT: -99 }));
    this.client = client;
    this.localAgent = null; // client 모드에서 이 화면의 요원
    this.barriers = this.makeBarriers();

    roster ??= op ? makeOpRoster(playerName, op.suspects[opDifficulty] ?? op.suspects.normal) : makeRoster(playerTeam, playerName);
    for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) {
      for (const m of roster.filter((x) => x.team === team)) {
        this.agents.push(createAgent({ ...m, spawn: { x: 0, z: 0 }, loadout: loadouts.get(m.id) ?? [], kit: rules === 'single' ? 'full' : 'pistol' }));
        const a = this.agents.at(-1);
        a.human = !!m.human; // 온라인으로 들어온 다른 사람 (봇이 조종하지 않음)
        // 숙달한 개념 (사람만): 관련 패치 재사용 대기가 짧아짐
        a.mastered = new Set(m.mastery ?? (m.isPlayer ? playerMastery : []));
      }
    }
    this.byId = new Map(this.agents.map((a) => [a.id, a]));
    if (op) {
      // CQB 작전: 준비(보급) → 작전, 라운드·경제 없음
      this.op = new Operation(this, op, { difficulty: opDifficulty });
      this.op.start();
    } else this.placeAgents();
    if (rules === 'rounds') {
      for (const a of this.agents) a.credits = ECON.start;
      this.startRound();
    }
    this.concepts = this.placeConcepts(conceptIds, conceptCount);
  }

  get rounds() {
    return this.rules === 'rounds';
  }

  // 구매 시간(보급 단말기)이 있는 규칙: 라운드제 · CQB 작전 준비
  get canBuy() {
    return this.rules === 'rounds' || this.rules === 'cqb';
  }

  // 그 패치와 관련된 개념을 숙달했는지
  isMastered(a, patchId) {
    const c = PATCH_CONCEPT[patchId];
    return !!c && !!a.mastered?.has(c);
  }

  // 구매 시간 개념 점검: 사람 요원마다 라운드마다 한 문제 (숙달하지 않은 개념을 먼저)
  dealQuiz(a) {
    const recent = a.quizSeen ?? [];
    const pool = CONCEPTS.filter((c) => !recent.includes(c.id));
    const fresh = pool.filter((c) => !a.mastered?.has(c.id));
    const c = this.rng.pick(fresh.length ? fresh : pool.length ? pool : CONCEPTS);
    a.quiz = { id: c.id, done: false, ok: null };
    a.quizSeen = [...recent, c.id].slice(-6);
  }

  answerQuiz(a, choice) {
    const q = a.quiz;
    if (!q || q.done || this.phase !== 'buy' || !this.canBuy) return false;
    const c = CONCEPT_BY_ID[q.id];
    q.done = true;
    q.ok = choice === c.answer;
    q.choice = choice;
    if (q.ok) a.credits = Math.min(ECON.max, a.credits + ECON.quiz);
    this.emit('quizAnswer', { agent: a, conceptId: q.id, correct: q.ok, choice, bonus: q.ok ? ECON.quiz : 0 });
    return true;
  }

  // 지금 그 쪽(해체/포스)을 맡은 분대
  squadOf(side) {
    return this.agents.find((a) => a.team === side)?.squad ?? side;
  }

  // 시작 위치에 세움 (팀마다 시작 칸을 고르게 나눠 씀)
  placeAgents() {
    if (this.op) return this.op.placeAgents();
    for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) {
      const members = this.agents.filter((a) => a.team === team);
      const spawns = this.map.spawns[team];
      members.forEach((a, i) => {
        const s = spawns[Math.round((i * (spawns.length - 1)) / Math.max(1, members.length - 1))];
        a.pos.x = a.prev.x = s.x + this.rng.range(-0.3, 0.3);
        a.pos.z = a.prev.z = s.z + this.rng.range(-0.3, 0.3);
        a.pos.y = a.prev.y = 0;
        a.vel.x = a.vel.y = a.vel.z = 0;
        a.yaw = team === TEAMS.FORCE ? Math.PI : 0;
        a.pitch = 0;
      });
    }
  }

  // 구매 시간에 나갈 수 없는 시작 구역 (시작 칸들을 둘러싼 사각형)
  makeBarriers() {
    const out = {};
    for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) {
      const sp = this.map.spawns[team];
      if (!sp.length) continue;
      const xs = sp.map((s) => s.x), zs = sp.map((s) => s.z);
      const hx = 8, hz = 5; // 가로 ±8m, 세로 ±5m 정도 여유
      out[team] = {
        x0: Math.max(this.map.originX, Math.min(...xs) - hx),
        x1: Math.min(this.map.originX + this.map.width, Math.max(...xs) + hx),
        z0: Math.max(this.map.originZ, Math.min(...zs) - hz),
        z1: Math.min(this.map.originZ + this.map.depth, Math.max(...zs) + hz),
      };
    }
    return out;
  }

  // ───────────────────────── 라운드 ─────────────────────────
  // 폭탄 2기를 A·B 구역 안 무작위 칸에 놓음 (모두에게 위치가 보임)
  placeBombs() {
    const map = this.map;
    for (const b of this.bombs) {
      // 그 칸과 이웃 두 칸 이상이 같은 층 바닥인 곳 (2층 통로 위에도 놓일 수 있음)
      const cells = (map.siteCells[b.id] ?? []).filter(({ c, r, y }) =>
        map.walkableAt(c, r, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => map.walkableAt(c + dc, r + dr, y)).length >= 2);
      const cell = cells.length ? cells[Math.floor(this.rng.next() * cells.length)] : { ...map.toCell(b.x, b.z), y: b.y ?? 0 };
      Object.assign(b, { x: map.cellX(cell.c), z: map.cellZ(cell.r), y: cell.y ?? 0, state: 'armed', picker: null, progress: 0, alertT: -99 });
    }
  }

  // 새 라운드 준비: 모두 되살려 시작 구역에, 살아남았던 요원은 총·방탄 유지, 포스 패치는 다시 충전
  startRound() {
    this.forceWiped = false;
    this.projectiles = [];
    this.veils = [];
    this.zones = [];
    this.shields = [];
    this.throwables = [];
    this.charges = [];
    this.drones = [];
    this.gadgets.reset();
    this.noises = [];
    this.scans = [];
    this.orders = { defuse: null, force: null };
    this.intel = { defuse: [], force: [] };
    this.warned = new Set();
    this.timeLeft = ROUND_TIME;
    this.roundWinner = null;
    this.roundReason = '';
    this.devices.reset();
    this.doors.reset();
    this.placeBombs();
    if (!this.client) for (const a of this.agents) if (a.isPlayer || a.human) this.dealQuiz(a);
    const firstOfHalf = this.round === 1 || this.round === ROUNDS.half + 1;
    for (const a of this.agents) {
      if (!a.alive || firstOfHalf) {
        // 쓰러졌던 요원: 산 총·방탄을 잃고 기본 권총만
        a.weapons = { pistol: freshAmmo('pistol'), knife: { mag: 0, reserve: 0 } };
        a.primary = null;
        a.secondary = 'pistol';
        a.armor = a.armorMax = 0;
        a.armorKind = null;
        a.gear = emptyGear();
      } else {
        for (const id of Object.keys(a.weapons)) a.weapons[id] = freshAmmo(id);
      }
      a.weapon = a.primary ?? a.secondary;
      a.ammo = 'fmj'; // 탄종은 라운드마다 새로 보급
      a.equip = null;
      a.drone = null;
      a.droneBat = GEAR.drone.battery; // 라운드마다 드론·RC카 배터리 가득
      a.rcBat = GEAR.rc.battery;
      a.mirror = null;
      a.camView = null;
      a.empT = 0;
      a.pulseOn = false;
      a.pulseHits = [];
      a.kickT = 0;
      a.stunT = a.flashT = a.gasT = 0;
      a.alive = true;
      a.hp = PLAYER.maxHp;
      a.deadT = 0;
      a.held = null;
      a.lockpick = null;
      a.slippery = a.mired = false;
      a.ads = false;
      a.adsT = 0;
      a.reloadT = a.swapT = a.fireCd = a.meleeCd = 0;
      a.bloom = a.recoil = a.recoilYaw = a.punch = 0;
      a.sprayIndex = a.burstLeft = 0;
      a.suppress = a.suppressHold = 0;
      a.ampT = a.bounceT = a.tagT = 0;
      a.crouch = a.lean = a.leanOffset = 0;
      a.stamina = STAMINA.max;
      a.tired = false;
      a.onGround = true;
      a.revealedUntil = a.lastHurtT = a.spottedT = -99;
      a.lastHurtBy = null;
      a.visibleEnemies = [];
      a.bought = []; // 이번 구매 시간에 산 것 (다시 누르면 환불)
      a.round = { kills: 0, damage: 0, by: {} };
      for (const p of a.patches) if (p) p.cd = p.activeT = 0;
    }
    this.placeAgents();
    this.phase = 'buy';
    this.phaseT = firstOfHalf ? ROUNDS.buyTimeFirst : ROUNDS.buyTime;
    this.emit('roundPrep', { round: this.round });
  }

  // 라운드 승패: 점수·크레딧을 주고 결과를 잠깐 보여 준 뒤 다음 라운드 (7승이면 경기 끝)
  endRound(side, reason) {
    const squad = this.squadOf(side);
    const loser = this.squadOf(otherTeam(side));
    this.score[squad]++;
    this.roundWinner = side;
    this.roundReason = reason;
    this.history.push({ round: this.round, squad, side, reason });
    for (const a of this.agents) if (a.lockpick) this.cancelLockpick(a, 'end');
    const lossPay = ECON.loss[Math.min(this.lossStreak[loser], ECON.loss.length - 1)];
    this.lossStreak[squad] = 0;
    this.lossStreak[loser]++;
    for (const a of this.agents) this.pay(a, a.squad === squad ? ECON.win : lossPay);
    const halftime = this.round === ROUNDS.half;
    this.phase = 'roundEnd';
    this.phaseT = halftime ? ROUNDS.halftimeTime : ROUNDS.endTime;
    this.emit('roundEnd', { round: this.round, side, squad, reason, score: { ...this.score }, halftime });
    if (this.score[squad] >= ROUNDS.winTo) this.end(squad, reason);
    return side;
  }

  nextRound() {
    this.round++;
    if (this.round === ROUNDS.half + 1) {
      // 공수 교대: 맡은 쪽을 바꾸고 크레딧·장비를 처음처럼
      this.swapped = true;
      for (const a of this.agents) {
        a.team = otherTeam(a.team);
        a.credits = ECON.start;
      }
      this.lossStreak = { defuse: 0, force: 0 };
      this.emit('halftime', { score: { ...this.score } });
    }
    this.startRound();
  }

  pay(a, amount) {
    a.credits = Math.min(ECON.max, (a.credits ?? 0) + amount);
  }

  // 상점 (구매 시간에만). 이번 구매 시간에 산 것을 다시 누르면 환불
  buy(a, item) {
    if (!this.canBuy || this.phase !== 'buy' || !a.alive) return false;
    a.bought ??= [];
    const refund = (match) => {
      const i = a.bought.findIndex(match);
      if (i < 0) return 0;
      const [b] = a.bought.splice(i, 1);
      a.credits += b.price;
      return b.price;
    };
    const armor = ARMOR[item];
    if (armor) {
      const mine = a.bought.find((b) => ARMOR[b.item]);
      const before = mine ? a.bought.prevArmor : { v: a.armor, max: a.armorMax, kind: a.armorKind };
      if (mine?.item === item) {
        // 같은 방탄을 다시 누르면 환불하고 원래 방탄으로
        refund((b) => b === mine);
        a.armor = before.v;
        a.armorMax = before.max;
        a.armorKind = before.kind;
        this.emit('buy', { agent: a, item, sold: true });
        return true;
      }
      // 이미 입은 방탄이 같거나 더 높은 등급이고 새것과 같은 상태면 살 필요 없음 (닳았으면 새것으로 바꿀 수 있음)
      const have = before.kind && before.v > 0 ? ARMOR[before.kind] : null;
      const better = have && (have.cls > armor.cls || (have.cls === armor.cls && before.v >= armor.dur));
      if (better || a.credits + (mine?.price ?? 0) < armor.price) {
        this.emit('buyDenied', { agent: a, item, reason: better ? 'have' : 'money' });
        return false;
      }
      if (mine) refund((b) => b === mine);
      else a.bought.prevArmor = before;
      a.credits -= armor.price;
      a.armor = a.armorMax = armor.dur;
      a.armorKind = item;
      a.bought.push({ item, price: armor.price });
      this.emit('buy', { agent: a, item });
      return true;
    }
    // 투척·폭발 장비: 누를 때마다 하나씩 (최대 개수까지), 최대인데 다시 누르면 이번에 산 것 하나를 반납
    const gear = GEAR[item];
    if (gear) {
      a.gear ??= emptyGear();
      const have = a.gear[item] ?? 0;
      if (have >= gear.max || a.credits < gear.price) {
        const i = a.bought.findLastIndex((b) => b.item === item);
        if (i >= 0 && have > 0) {
          const [b] = a.bought.splice(i, 1);
          a.credits += b.price;
          a.gear[item] = have - 1;
          if (a.equip && (a.equip.id === item || a.equip.kind === item) && !a.gear[item]) a.equip = null;
          this.emit('buy', { agent: a, item, sold: true });
          return true;
        }
        this.emit('buyDenied', { agent: a, item, reason: have >= gear.max ? 'full' : 'money' });
        return false;
      }
      a.credits -= gear.price;
      a.gear[item] = have + 1;
      if (BAT_KEY[item]) a[BAT_KEY[item]] = gear.battery; // 새 드론·RC카는 가득
      a.bought.push({ item, price: gear.price });
      this.emit('buy', { agent: a, item });
      return true;
    }
    // 탄종: 이번 라운드 가진 모든 총에. 같은 것을 다시 누르거나 일반탄을 고르면 환불
    const ammo = AMMO[item];
    if (ammo) {
      const mine = a.bought.find((b) => AMMO[b.item]);
      if (mine && (mine.item === item || item === 'fmj')) {
        refund((b) => b === mine);
        a.ammo = 'fmj';
        this.emit('buy', { agent: a, item: mine.item, sold: true });
        return true;
      }
      if (item === 'fmj' || a.ammo === item) return false;
      if (a.credits + (mine?.price ?? 0) < ammo.price) {
        this.emit('buyDenied', { agent: a, item, reason: 'money' });
        return false;
      }
      if (mine) refund((b) => b === mine);
      a.credits -= ammo.price;
      a.ammo = item;
      a.bought.push({ item, price: ammo.price });
      this.emit('buy', { agent: a, item });
      return true;
    }
    const w = WEAPONS[item];
    if (!w || w.melee) return false;
    if (a[w.slot] === item) {
      // 이번에 산 총이면 환불 (전 라운드부터 가진 총은 그대로)
      if (!a.bought.some((b) => b.item === item)) return false;
      refund((b) => b.item === item);
      const prev = a.bought.prevWeapon?.[w.slot];
      delete a.weapons[item];
      a[w.slot] = prev ?? (w.slot === 'secondary' ? 'pistol' : null);
      if (a[w.slot]) a.weapons[a[w.slot]] = freshAmmo(a[w.slot]);
      if (a.weapon === item) a.weapon = a.primary ?? a.secondary;
      this.emit('buy', { agent: a, item, sold: true });
      return true;
    }
    const sameSlot = (b) => WEAPONS[b.item]?.slot === w.slot;
    const back = a.bought.find(sameSlot);
    if (a.credits + (back?.price ?? 0) < w.price) {
      this.emit('buyDenied', { agent: a, item, reason: 'money' });
      return false;
    }
    if (back) refund(sameSlot);
    else (a.bought.prevWeapon ??= {})[w.slot] = a[w.slot];
    a.credits -= w.price;
    giveWeapon(a, item);
    a.bought.push({ item, price: w.price });
    // 산 총을 바로 손에
    if (a.weapon !== item) {
      a.weapon = item;
      a.swapT = Math.min(0.4, w.draw);
      a.reloadT = 0;
    }
    this.emit('buy', { agent: a, item });
    return true;
  }

  // 개념 카드: 맵이 정한 자리 중 몇 곳에 무작위로 (사람만 주울 수 있음, 각자 따로)
  placeConcepts(prefer, count) {
    const spots = [...(this.map.def.concepts ?? [])];
    const n = Math.min(count, spots.length);
    if (!n) return [];
    const picked = [];
    for (let i = 0; i < n; i++) picked.push(spots.splice(Math.floor(this.rng.next() * spots.length), 1)[0]);
    const ids = [...new Set((prefer ?? []).filter((id) => CONCEPTS.some((c) => c.id === id)))];
    const rest = CONCEPTS.map((c) => c.id).filter((id) => !ids.includes(id));
    while (rest.length) ids.push(rest.splice(Math.floor(this.rng.next() * rest.length), 1)[0]);
    return picked.map((s, i) => ({ key: i, id: ids[i], x: this.map.cellX(s.c), y: s.f ? STORY : 0, z: this.map.cellZ(s.r), takenBy: [] }));
  }

  updateConcepts() {
    for (const c of this.concepts) {
      for (const a of this.agents) {
        if (!a.alive || !(a.isPlayer || a.human) || Math.abs(a.pos.y - (c.y ?? 0)) > 1.2) continue;
        if (Math.hypot(a.pos.x - c.x, a.pos.z - c.z) > 1.1 || c.takenBy.includes(a.id)) continue;
        c.takenBy.push(a.id);
        (a.concepts ??= []).push(c.id);
        this.emit('conceptPicked', { agent: a, concept: c });
      }
    }
  }

  get player() {
    return this.agents.find((a) => a.isPlayer) ?? null;
  }

  agentById(id) {
    return this.byId.get(id) ?? null;
  }

  bombById(id) {
    return this.bombs.find((b) => b.id === id) ?? null;
  }

  setController(agentId, controller) {
    this.controllers.set(agentId, controller);
  }

  alive(team) {
    return this.agents.filter((a) => a.alive && (!team || a.team === team));
  }

  emit(type, payload) {
    this.events.emit(type, payload);
  }

  // ───────────────────────── 한 틱 진행 ─────────────────────────
  // 움직일 수 있는 때: 진행 중, 라운드 결과 화면, 라운드제의 구매 시간(시작 구역 안에서만)
  get mobile() {
    return this.phase === 'live' || this.phase === 'roundEnd' || (this.phase === 'buy' && this.canBuy);
  }

  tick(dt) {
    if (this.client) return this.clientTick(dt);
    this.time += dt;
    if (this.phase === 'ended') {
      this.endT += dt;
      this.updateVeils(dt);
      this.updateShields(dt);
      this.updateProjectiles(dt);
      return;
    }
    if (this.phase === 'buy') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'live';
        this.liveAt = this.time;
        // 구매 시간에 뛰어다녀 닳은 지구력은 교전 시작 때 다시 가득
        for (const a of this.agents) {
          a.stamina = STAMINA.max;
          a.tired = false;
        }
        this.emit('roundStart', { round: this.round });
      }
    } else if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) return this.nextRound();
    }
    const live = this.phase === 'live';
    const mobile = this.mobile;

    this.updateZones(dt);
    this.devices.update(dt);
    this.doors.update(dt);
    for (const a of this.agents) {
      if (!a.alive) {
        a.deadT += dt;
        stepMovement(a, emptyIntent(a), this.map, dt, false);
        continue;
      }
      const ctrl = this.controllers.get(a.id);
      const intent = ctrl ? ctrl.getIntent(this, a, dt) : emptyIntent(a);
      if (intent.buy) this.buy(a, intent.buy);
      if (intent.quiz >= 0) this.answerQuiz(a, intent.quiz);
      this.stepAgent(a, intent, dt, live, mobile);
    }
    this.separateAgents();
    this.op?.update(dt);
    this.updateConcepts();
    this.updateVeils(dt);
    this.updateShields(dt);
    this.updateProjectiles(dt);
    this.updateThrowables(dt);
    this.updateDrones(dt);
    this.gadgets.update(dt);
    this.updateVisibility(dt);
    this.noises = this.noises.filter((n) => this.time - n.t < NOISE.memory);
    this.scans = this.scans.filter((s) => s.until > this.time);
    for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) this.intel[team] = this.intel[team].filter((i) => this.time - i.t < 8);

    if (live) {
      // CQB 작전: 장치를 모두 해체하면 제한 시간이 멈춤
      if (!this.op?.devicesDone) this.timeLeft -= dt;
      for (const w of [60, 30, 10]) {
        if (this.timeLeft <= w && !this.warned.has(w)) {
          this.warned.add(w);
          this.emit('timeWarning', { left: w });
        }
      }
      this.checkEnd();
    }
  }

  stepAgent(a, intent, dt, live, mobile = live) {
    // 드론을 조종하는 동안: 입력은 드론으로, 몸은 앉은 채 가만히 (시점도 그대로)
    if (a.drone) intent = this.droneControl(a, intent);
    // 던진 카메라를 보는 동안: 시점은 카메라로, 몸은 앉은 채 가만히
    else if (a.camView) intent = this.gadgets.control(a, intent);
    // 문 밑 카메라를 쥔 동안: 시점은 카메라로, 몸은 앉은 채 가만히
    else if (a.mirror) intent = this.doors.mirrorControl(a, intent);
    a.yaw = intent.yaw;
    a.pitch = clamp(intent.pitch, -1.45, 1.45);
    for (const p of a.patches) {
      if (!p) continue;
      if (p.cd > 0) p.cd = Math.max(0, p.cd - dt);
      if (p.activeT > 0) p.activeT = Math.max(0, p.activeT - dt);
    }
    if (a.ampT > 0) a.ampT = Math.max(0, a.ampT - dt);
    if (a.bounceT > 0) a.bounceT = Math.max(0, a.bounceT - dt);
    // 손에 있는 드론·RC카는 천천히 충전
    for (const kind of ['drone', 'rc']) {
      const key = BAT_KEY[kind], full = GEAR[kind].battery;
      if ((a.gear?.[kind] ?? 0) > 0 && (a[key] ?? full) < full) a[key] = Math.min(full, (a[key] ?? 0) + (kind === 'rc' ? RC : DRONE).recharge * dt);
    }
    if (a.tagT > 0) a.tagT = Math.max(0, a.tagT - dt);
    this.decayEffects(a, dt);
    a.punch *= Math.exp(-dt * 8);
    if (live) a.ult = Math.min(ULT.max, a.ult + ULT.perSecond * dt);
    if (intent.equip && !a.lockpick && !a.held) this.equipGear(a, intent.equip);
    else if (intent.equipKind && !a.lockpick && !a.held) this.equipTo(a, intent.equipKind);
    if (intent.useGear && live && !a.lockpick && !a.held) this.throwGear(a, intent.useGear.id, intent.useGear.mode);

    const canAct = live && !a.held;
    if (intent.command && live) this.issueCommand(a, intent.command);
    if (intent.report && live) this.reportContact(a);
    if (live) {
      if (a.lockpick) this.stepLockpick(a, intent, dt);
      // CQB 작전: 연구원 결박 풀기·자료 확보 중 (잠깐 멈춰 서서)
      else if (a.opTask) this.op.stepTask(a, intent, dt);
      // F: 지렛대 → 폭탄 해체 → (작전) 연구원·자료 → 문 순서로
      else if (intent.interact && canAct && !this.devices.tryUse(a) && !this.tryStartLockpick(a) && !this.op?.interact(a)) this.doors.use(a);
      if (intent.door && canAct && !a.lockpick && !a.drone) this.doors.act(a, intent.door, intent.doorId != null ? this.doors.list[intent.doorId] : undefined);
      if (canAct && !a.lockpick) {
        intent.patch.forEach((pressed, i) => {
          if (pressed) this.usePatch(a, i);
        });
      }
    }
    // 정조준: 총을 들고 있고 재장전·교체 중이 아닐 때만
    const w = WEAPONS[a.weapon];
    a.ads = live && !!intent.ads && !w.melee && !a.lockpick && !a.held && a.reloadT <= 0 && a.swapT <= 0;
    a.adsT = clamp(a.adsT + (a.ads ? 1 : -1) * dt * (w.adsRate ?? 7), 0, 1);
    this.stepWeapon(a, intent, dt, live && !a.lockpick && !(a.kickT > 0) && !a.opTask);
    // 심장 박동 센서를 보는 동안: 화면을 보느라 느리게 걸음
    this.gadgets.stepPulse(a, dt);
    if (a.pulseOn) intent = { ...intent, moveX: intent.moveX * PULSE.slow, moveZ: intent.moveZ * PULSE.slow, jump: false };
    this.moveAgent(a, intent, dt, live, mobile && !a.opTask);
  }

  // 이동 + 착지 소리 + 발걸음 (방장·참가자 화면이 같이 씀)
  moveAgent(a, intent, dt, live, mobile = live) {
    const wasGround = a.onGround;
    const vy = a.vel.y;
    stepMovement(a, intent, this.map, dt, mobile && !a.lockpick);
    if (this.phase === 'buy' && this.canBuy) this.keepInBarrier(a);
    if (wasGround && !a.onGround && a.vel.y > 1) this.emit('jump', { agent: a });
    if (!wasGround && a.onGround && vy < -4) {
      this.emit('land', { agent: a, speed: -vy });
      if (live) this.makeNoise(a, 'land');
    }
    // 발걸음: 달리면 적에게 들리고, 걷거나 앉아 움직이면 거의 들리지 않음
    const speed = Math.hypot(a.vel.x, a.vel.z);
    if (a.onGround && speed > 0.5) {
      a.stepAcc = (a.stepAcc ?? 0) + speed * dt;
      if (a.stepAcc >= PLAYER.stride) {
        a.stepAcc = 0;
        const loud = speed >= PLAYER.quietSpeed && !a.slippery;
        this.emit('footstep', { agent: a, loud });
        if (loud && live) this.makeNoise(a, 'step');
      }
    } else {
      a.stepAcc = PLAYER.stride * 0.6;
    }
  }

  // 구매 시간: 시작 구역 밖으로 나가지 못함
  keepInBarrier(a) {
    const b = this.barriers[a.team];
    if (!b) return;
    const r = PLAYER.radius;
    if (a.pos.x < b.x0 + r) { a.pos.x = b.x0 + r; a.vel.x = Math.max(0, a.vel.x); }
    if (a.pos.x > b.x1 - r) { a.pos.x = b.x1 - r; a.vel.x = Math.min(0, a.vel.x); }
    if (a.pos.z < b.z0 + r) { a.pos.z = b.z0 + r; a.vel.z = Math.max(0, a.vel.z); }
    if (a.pos.z > b.z1 - r) { a.pos.z = b.z1 - r; a.vel.z = Math.min(0, a.vel.z); }
  }

  // ───────────────────────── 소리 ─────────────────────────
  // 소리를 남김: 적 봇은 들을 수 있는 거리 안이면 듣고, 무게 감지기는 발걸음·총성을 탐지
  makeNoise(a, kind, at = null) {
    if (this.client) return null; // 소리 판정(봇 청각·무게 감지기)은 방장만
    const loudKinds = !!WEAPONS[kind] && !WEAPONS[kind].melee;
    const radius = (NOISE[kind] ?? 10) * (this.map.weather === 'rain' && !loudKinds ? NOISE.rainMult : 1);
    const p = at ?? a.pos;
    const n = { id: this.nextId++, kind, x: p.x, y: p.y ?? 0, z: p.z, team: a.team, agentId: a.id, radius, t: this.time };
    this.noises.push(n);
    // 무게 감지기: 바닥에 큰 힘을 가하는 소리(달리기·착지·사격)만 탐지
    if (kind === 'step' || kind === 'land' || loudKinds) {
      for (const s of this.scans) {
        if (s.team === a.team || Math.hypot(p.x - s.x, p.z - s.z) > s.radius) continue;
        a.revealedUntil = Math.max(a.revealedUntil, this.time + 1.2);
        this.emit('scanPing', { scan: s, agent: a, kind, pos: { x: p.x, y: p.y ?? 0, z: p.z } });
      }
    }
    return n;
  }

  // ───────────────────────── 지휘 · 무전 ─────────────────────────
  // 분대장(플레이어)의 명령: regroup 집결 / hold 위치 사수 / move 지정 지점 / A·B 목표 / free 자율
  issueCommand(a, cmd) {
    if (!cmd?.type) return;
    // 문 진입 명령: 바라보는 문(4.5 m 안)을 기준으로 — 대기 → 돌파 → 진입 → 확보 (봇이 ai/entry.js로 진행)
    if (ENTRY_MODE[cmd.type]) {
      const d = this.doors.doorAt(a, ENTRY_REACH);
      if (!d) {
        this.emit('commandDenied', { agent: a, type: cmd.type, reason: 'door' });
        return;
      }
      const order = { id: this.nextId++, type: cmd.type, mode: ENTRY_MODE[cmd.type], door: d.id, side: this.doors.side(d, a.pos), team: a.team, phase: 'stack', point: { x: d.x, y: 0, z: d.z }, issuerId: a.id, t: this.time, yaw: a.yaw };
      this.orders[a.team] = order;
      this.emit('command', { agent: a, team: a.team, type: cmd.type, order });
      return;
    }
    let point = null;
    if (cmd.type === 'move') point = this.aimPoint(a, 45);
    else if (cmd.type === 'regroup' || cmd.type === 'hold') point = { x: a.pos.x, y: a.pos.y, z: a.pos.z };
    // '자율 교전'은 명령 해제 (CQB 작전에서는 대장을 따르지 않고 스스로 수색하라는 명령)
    const order = cmd.type === 'free' && !this.op ? null : { id: this.nextId++, type: cmd.type, point, issuerId: a.id, t: this.time, yaw: a.yaw };
    this.orders[a.team] = order;
    this.emit('command', { agent: a, team: a.team, type: cmd.type, order });
  }

  // 적 보고 (플레이어): 조준한 곳을 구역 이름과 함께 무전으로 알림 → 아군 봇이 그쪽을 경계·수색
  // 직접 보고 있는 적이 그 근처에 있으면 '발견', 아니면 '의심' (보고자가 아는 것 이상은 알려 주지 않음)
  reportContact(a) {
    if (this.time - (a.reportAt ?? -99) < 1.5) return false;
    a.reportAt = this.time;
    // 조준선 가까이(약 7°)에 보이는 적이 있으면 그 적의 위치, 없으면 조준한 바닥·벽 지점
    const eye = eyePos(a);
    const dir = dirFromAngles(a.yaw, a.pitch);
    let p = null, best = Infinity;
    for (const id of a.visibleEnemies ?? []) {
      const e = this.agentById(id);
      if (!e?.alive) continue;
      const c = chestPos(e);
      const vx = c.x - eye.x, vy = c.y - eye.y, vz = c.z - eye.z;
      const d = Math.hypot(vx, vy, vz);
      const cos = (vx * dir.x + vy * dir.y + vz * dir.z) / d;
      if (cos > 0.992 && d < best) {
        best = d;
        p = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
      }
    }
    const seen = !!p;
    p ??= this.aimPoint(a, 60);
    const callout = this.map.calloutAt(p.x, p.z, p.y ?? 0);
    const d = Math.hypot(p.x - a.pos.x, p.z - a.pos.z);
    const place = callout ?? `${Math.round(d)}m 앞`;
    this.shareIntel(a, { x: p.x, y: p.y ?? 0, z: p.z, kind: seen ? 'seen' : 'report' });
    this.radio(a, `${seen ? '적 발견' : '적 의심'} — ${place}`, { kind: 'contact', pos: p, report: true });
    return true;
  }

  // 무전: 같은 팀에게만 전달되는 짧은 보고
  radio(a, text, extra = {}) {
    this.emit('radio', { agent: a, team: a.team, text, t: this.time, ...extra });
  }

  // 소리로 들은 적 위치를 팀에 공유 (무전 보고)
  shareIntel(a, info) {
    this.intel[a.team].push({ ...info, reporterId: a.id, t: this.time });
  }

  separateAgents() {
    const list = this.agents.filter((a) => a.alive && !a.held);
    const minD = PLAYER.radius * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d >= minD || d < 1e-5) continue;
        const push = (minD - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push;
        a.pos.z -= nz * push;
        b.pos.x += nx * push;
        b.pos.z += nz * push;
        this.map.collideCircle(a.pos, PLAYER.radius, a.pos.y, PLAYER.stepHeight, null);
        this.map.collideCircle(b.pos, PLAYER.radius, b.pos.y, PLAYER.stepHeight, null);
      }
    }
  }

  // ───────────────────────── 총기 ─────────────────────────
  stepWeapon(a, intent, dt, canFire) {
    const w = WEAPONS[a.weapon];
    if (a.equip?.kind !== 'pulse') a.pulseOn = false; // 심박 센서를 내려놓으면 꺼짐
    const ws = a.weapons[a.weapon];
    a.fireCd = Math.max(0, a.fireCd - dt);
    a.meleeCd = Math.max(0, a.meleeCd - dt);
    a.sinceShot += dt;
    // 제압은 잠깐 머문 뒤 줄어듦
    if ((a.suppress ?? 0) > 0) {
      a.suppressHold = (a.suppressHold ?? 0) - dt;
      if (a.suppressHold <= 0) a.suppress = Math.max(0, a.suppress - SUPPRESS.decay * dt);
    }
    if (!w.melee) {
      a.bloom = Math.max(0, a.bloom - w.bloomRecover * dt);
      if (a.sinceShot > 0.12) {
        a.recoil = Math.max(0, a.recoil - w.recoilRecover * dt);
        const ry = w.recoilRecover * 0.5 * dt;
        a.recoilYaw = Math.abs(a.recoilYaw) <= ry ? 0 : a.recoilYaw - Math.sign(a.recoilYaw) * ry;
      }
    } else {
      a.recoil = Math.max(0, a.recoil - 0.4 * dt);
      a.recoilYaw = 0;
    }

    // 장비를 들고 있으면: 왼쪽 클릭 = 멀리 던지기·설치·기폭, 오른쪽 클릭 = 가까이 던지기. 무기 키를 누르면 다시 총으로
    if (a.equip) {
      if (intent.switchTo && !a.lockpick) {
        a.equip = null;
        a.swapT = Math.min(0.35, WEAPONS[a.weapon]?.draw ?? 0.35);
        if (intent.switchTo !== a.weapon && WEAPONS[intent.switchTo] && a.weapons[intent.switchTo]) a.weapon = intent.switchTo;
        a.triggerLatch = intent.fire;
        a.adsLatch = intent.ads;
        this.emit('swap', { agent: a, weapon: a.weapon });
        return;
      }
      this.stepGearHand(a, intent, canFire, dt);
      return;
    }
    if (intent.switchTo && intent.switchTo !== a.weapon && WEAPONS[intent.switchTo] && a.weapons[intent.switchTo] && !a.lockpick) {
      a.weapon = intent.switchTo;
      a.swapT = WEAPONS[a.weapon].draw;
      a.reloadT = 0;
      a.bloom = 0;
      a.burstLeft = 0;
      a.triggerLatch = intent.fire;
      a.adsLatch = intent.ads;
      this.emit('swap', { agent: a, weapon: a.weapon });
      return;
    }
    if (a.swapT > 0) {
      a.swapT = Math.max(0, a.swapT - dt);
      a.triggerLatch = intent.fire;
      a.adsLatch = intent.ads;
      return;
    }

    // 근접 무기: 왼쪽 클릭 = 베기, 오른쪽 클릭 = 찌르기
    if (w.melee) {
      const heavyPressed = intent.ads && !a.adsLatch;
      a.adsLatch = intent.ads;
      a.triggerLatch = intent.fire;
      if (canFire && a.meleeCd <= 0) {
        if (intent.fire) this.melee(a, false);
        else if (heavyPressed || intent.ads) this.melee(a, true);
      }
      return;
    }
    a.adsLatch = intent.ads;

    if (a.reloadT > 0) {
      a.reloadT -= dt;
      if (a.reloadT <= 0) {
        a.reloadT = 0;
        const take = Math.min(w.magSize - ws.mag, ws.reserve);
        ws.mag += take;
        ws.reserve -= take;
        this.emit('reloadDone', { agent: a });
      }
      a.triggerLatch = intent.fire;
      return;
    }
    const startReload = () => {
      a.reloadT = w.reload;
      a.burstLeft = 0;
      this.makeNoise(a, 'reload');
      this.emit('reload', { agent: a, weapon: w.id });
    };
    if ((intent.reload && ws.mag < w.magSize && ws.reserve > 0) || (ws.mag === 0 && ws.reserve > 0 && a.fireCd <= 0)) {
      if (!a.lockpick) startReload();
      a.triggerLatch = intent.fire;
      return;
    }
    const pressed = intent.fire && !a.triggerLatch;
    a.triggerLatch = intent.fire;
    // 점사 총: 한 번 당기면 w.burst발이 이어서 나감 (손을 떼도 끝까지 · 탄이 떨어지거나 못 쏘게 되면 멈춤)
    if (w.burst && a.burstLeft > 0) {
      if (!canFire || ws.mag <= 0) a.burstLeft = 0;
      else if (a.fireCd <= 0) this.fire(a, w, ws);
      return;
    }
    const want = w.auto ? intent.fire : pressed;
    if (!want || !canFire || a.fireCd > 0) return;
    if (ws.mag <= 0) {
      if (pressed) this.emit('dryFire', { agent: a });
      return;
    }
    if (w.burst) {
      a.burstLeft = w.burst;
      a.sprayIndex = 0; // 점사마다 같은 반동 무늬
    }
    this.fire(a, w, ws);
  }

  fire(a, w, ws) {
    ws.mag--;
    if (w.burst) {
      // 점사 안에서는 빠르게, 점사가 끝나면 다음 점사까지 쉼
      a.burstLeft = Math.max(0, (a.burstLeft ?? 0) - 1);
      a.fireCd = 60 / (a.burstLeft > 0 ? w.burstRpm : w.rpm);
    } else a.fireCd = 60 / w.rpm;
    if (a.sinceShot > 0.4) a.sprayIndex = 0;
    a.sinceShot = 0;
    // 빗나감: 움직이는 빠르기만큼 커짐 (멈춰 서서 쏘면 정확) · 공중에서는 크게
    let spread = w.spreadBase + a.bloom + w.spreadMove * moveFactor(a) + (!a.onGround ? w.spreadAir : 0);
    spread *= (1 + (w.adsSpread - 1) * a.adsT) * (1 + (w.crouchSpread - 1) * a.crouch);
    if (a.held) spread += w.spreadMove * 0.5;
    // 이명·최루: 조준이 흔들림
    if ((a.stunT ?? 0) > 0) spread += EFFECT.stunSpread * Math.min(1, a.stunT / 2);
    if ((a.gasT ?? 0) > 0) spread += EFFECT.gasSpread;
    // 제압: 총알이 바로 옆을 스치면 손이 떨림
    spread += SUPPRESS.spread * (a.suppress ?? 0);
    // 숨이 차면 조준이 흔들림 (지구력이 바닥날수록)
    if ((a.stamina ?? STAMINA.max) < STAMINA.swayBelow) spread += ((STAMINA.swayBelow - a.stamina) / STAMINA.swayBelow) * STAMINA.sway;
    const aim = dirFromAngles(a.yaw + a.recoilYaw, a.pitch + a.recoil + a.punch);
    const amp = a.ampT > 0 && (w.ampBonus ?? 0) > 0;
    const ammo = AMMO[a.ammo] ?? AMMO.fmj;
    const damage = (w.damage + (amp ? w.ampBonus : 0)) * ammo.dmg;
    const origin = eyePos(a);
    const pellets = w.pellets ?? 1;
    let first = null;
    for (let k = 0; k < pellets; k++) {
      const dir = spreadDir(pellets > 1 ? spreadDir(aim, w.pelletSpread, this.rng) : aim, spread, this.rng);
      const p = {
        id: this.nextId++,
        ownerId: a.id,
        team: a.team,
        weapon: w.id,
        damage,
        amp,
        pen: (w.pen ?? 0) + ammo.pen, // 관통력 (방탄 등급과 비교)
        wear: ammo.wear,
        ammo: ammo.id,
        bounces: a.bounceT > 0 ? 1 : 0,
        pos: copy(origin),
        prev: copy(origin),
        from: copy(origin), // 거리별 피해 계산용
        vel: scale(dir, w.speed),
        life: w.life ?? PROJECTILE.life,
        harmless: false,
        inVeil: false,
        pellet: pellets > 1,
      };
      this.projectiles.push(p);
      first ??= { p, dir };
    }
    // 연사 반동 패턴 (정조준·앉기 중에는 줄어듦)
    const i = a.sprayIndex++;
    const rm = (1 + (w.adsRecoil - 1) * a.adsT) * (a.crouch > 0.5 ? 0.85 : 1);
    a.recoil = Math.min(w.recoilMax, a.recoil + w.recoilPitch[Math.min(i, w.recoilPitch.length - 1)] * rm);
    const yawKick = w.recoilYaw[i % w.recoilYaw.length] + (this.rng.next() * 2 - 1) * (w.recoilYawRand ?? 0);
    a.recoilYaw = clamp(a.recoilYaw + yawKick * rm, -w.recoilYawMax, w.recoilYawMax);
    a.bloom = Math.min(w.bloomMax, a.bloom + w.bloomPerShot);
    this.makeNoise(a, w.id);
    this.emit('shot', { agent: a, weapon: w.id, origin, dir: first.dir, amp, projectile: first.p, pellets });
  }

  melee(a, heavy) {
    const w = WEAPONS.knife;
    const m = heavy ? w.heavy : w.light;
    a.meleeCd = m.rate;
    if (this.client) {
      // 참가자 화면: 휘두르는 동작만 (맞았는지는 방장이 판정)
      this.emit('melee', { agent: a, heavy, target: null });
      return;
    }
    this.makeNoise(a, 'knife');
    const eye = eyePos(a);
    const d = dirFromAngles(a.yaw, a.pitch);
    let best = null, bestD = Infinity;
    for (const e of this.agents) {
      if (!e.alive || e.team === a.team) continue;
      const c = chestPos(e);
      const vx = c.x - eye.x, vy = c.y - eye.y, vz = c.z - eye.z;
      const dd = Math.hypot(vx, vy, vz);
      if (dd > m.range + 0.35) continue;
      if (dd > 0.9 && (vx * d.x + vy * d.y + vz * d.z) / dd < 0.78) continue;
      if (!this.clearLine(eye, c)) continue;
      if (dd < bestD) {
        bestD = dd;
        best = e;
      }
    }
    this.emit('melee', { agent: a, heavy, target: best });
    if (!best) return;
    // 등 뒤에서 찌르면 피해 1.5배
    const fx = -Math.sin(best.yaw), fz = -Math.cos(best.yaw);
    const tx = best.pos.x - a.pos.x, tz = best.pos.z - a.pos.z;
    const tl = Math.hypot(tx, tz) || 1;
    const backstab = (fx * tx + fz * tz) / tl > 0.5;
    this.applyDamage(best, m.damage * (backstab ? w.backstabMult : 1), a, { weapon: 'knife', pos: chestPos(best), backstab, pen: w.pen });
  }

  // ───────────────────────── 온라인 참가자 화면 ─────────────────────────
  // 방장이 보낸 상태를 적용하는 사이사이, 자기 요원만 미리 움직이고 총알 궤적은 화면용으로만 날림
  clientTick(dt) {
    this.time += dt;
    if (this.phase === 'live') this.timeLeft = Math.max(0, this.timeLeft - dt);
    // 승강기·탄성 발판·문은 화면에서도 미리 움직임 (방장 상태를 받으면 맞춤)
    this.devices.update(dt);
    this.doors.update(dt);
    const a = this.localAgent;
    const myDrone = a?.drone ? this.drones.find((d) => d.id === a.drone) : null;
    if (a?.alive && myDrone && this.phase !== 'ended') {
      // 내 드론: 방장 결과를 기다리지 않고 이 화면에서 미리 날림 (몸은 그대로)
      const ctrl = this.controllers.get(a.id);
      const intent = ctrl ? ctrl.getIntent(this, a, dt) : emptyIntent(a);
      myDrone.prev = { ...myDrone.pos };
      (myDrone.kind === 'rc' ? stepRC : stepDrone)(this.map, myDrone, { mx: intent.moveX, mz: intent.moveZ, up: intent.jump, down: intent.crouch, yaw: intent.yaw, pitch: intent.pitch }, dt);
      myDrone.predicted = true;
    } else if (a?.alive && a.camView && this.phase !== 'ended') {
      // 던진 카메라: 몸은 그대로, 카메라 방향만 이 화면에서 바로 (바꾸기·표시·거두기는 방장이 처리)
      const ctrl = this.controllers.get(a.id);
      const intent = ctrl ? ctrl.getIntent(this, a, dt) : emptyIntent(a);
      a.camView.yaw = intent.yaw;
      a.camView.pitch = intent.pitch;
    } else if (a?.alive && a.mirror && this.phase !== 'ended') {
      // 문 밑 카메라: 몸은 그대로, 카메라 방향만 이 화면에서 바로 (거두기 등 동작은 방장이 처리)
      const ctrl = this.controllers.get(a.id);
      const intent = ctrl ? ctrl.getIntent(this, a, dt) : emptyIntent(a);
      a.mirror.yaw = intent.yaw;
      a.mirror.pitch = intent.pitch;
    } else if (a?.alive && this.phase !== 'ended') {
      const ctrl = this.controllers.get(a.id);
      const intent = ctrl ? ctrl.getIntent(this, a, dt) : emptyIntent(a);
      const live = this.phase === 'live';
      a.yaw = intent.yaw;
      a.pitch = clamp(intent.pitch, -1.45, 1.45);
      a.punch *= Math.exp(-dt * 8);
      const w = WEAPONS[a.weapon];
      a.ads = live && !!intent.ads && !w.melee && !a.lockpick && !a.held && a.reloadT <= 0 && a.swapT <= 0;
      a.adsT = clamp(a.adsT + (a.ads ? 1 : -1) * dt * (w.adsRate ?? 7), 0, 1);
      this.stepWeapon(a, intent, dt, live && !a.lockpick && !a.held);
      this.gadgets.stepPulse(a, dt);
      const move = a.pulseOn ? { ...intent, moveX: intent.moveX * PULSE.slow, moveZ: intent.moveZ * PULSE.slow, jump: false } : intent;
      if (!a.held) this.moveAgent(a, move, dt, live, this.mobile);
    }
    // 다른 요원의 총알 궤적 (화면용)
    const keep = [];
    for (const p of this.projectiles) {
      p.prev.x = p.pos.x;
      p.prev.y = p.pos.y;
      p.prev.z = p.pos.z;
      const next = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt, z: p.pos.z + p.vel.z * dt };
      const wall = this.map.raycast(p.pos, next);
      // 이 화면에서도 스침 판정 (휙 소리·화면 가장자리 — 피해는 방장이 판정)
      this.nearMiss(p, p.pos, wall ? { x: wall.x, y: wall.y, z: wall.z } : next, null, !!wall);
      if (wall) continue;
      p.pos.x = next.x;
      p.pos.y = next.y;
      p.pos.z = next.z;
      p.life -= dt;
      if (p.life > 0) keep.push(p);
    }
    this.projectiles = keep;
  }

  // ───────────────────────── 투사체 ─────────────────────────
  updateProjectiles(dt) {
    const keep = [];
    for (const p of this.projectiles) {
      p.prev.x = p.pos.x;
      p.prev.y = p.pos.y;
      p.prev.z = p.pos.z;
      let veil = null;
      for (const v of this.veils) {
        if (dist(p.pos, v.center) < v.radius) {
          veil = v;
          break;
        }
      }
      if (veil) {
        const k = Math.exp(-PROJECTILE.veilDrag * dt);
        p.vel.x *= k;
        p.vel.y *= k;
        p.vel.z *= k;
        if (!p.inVeil) this.emit('projectileCaught', { projectile: p, veil });
        p.life = Math.max(p.life, 0.5);
      }
      p.inVeil = !!veil;
      const speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      if (!p.harmless && speed < PROJECTILE.harmlessSpeed) {
        p.harmless = true;
        p.life = PROJECTILE.debrisLife;
      }
      // 장막 밖의 멈춘 투사체는 중력 때문에 아래로 떨어짐
      if (p.harmless && !veil) p.vel.y -= PLAYER.gravity * dt;

      const next = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt, z: p.pos.z + p.vel.z * dt };
      const mh = this.map.raycast(p.pos, next);
      let tHit = mh ? mh.t : Infinity;
      let target = null, head = false, shield = null;
      for (const sh of this.shields) {
        const ts = segmentShield(p.pos, next, sh);
        if (ts >= 0 && ts < tHit) {
          tHit = ts;
          shield = sh;
        }
      }
      let drone = null, device = null;
      if (!p.harmless) {
        for (const d of this.drones) {
          if (d.team === p.team) continue;
          const hs = remoteHitSphere(d);
          const td = segmentSphere(p.pos, next, hs.c, hs.r);
          if (td >= 0 && td < tHit) {
            tHit = td;
            drone = d;
            shield = null;
          }
        }
        // 적 카메라·경보 센서 (한 발에 부서짐)
        const dh = this.gadgets.hitTest(p.pos, next, p.team, tHit);
        if (dh) {
          tHit = dh.t;
          device = dh.dev;
          drone = null;
          shield = null;
        }
        for (const a of this.agents) {
          if (!a.alive || a.team === p.team) continue;
          const th = segmentSphere(p.pos, next, eyePos(a), PLAYER.headRadius);
          if (th >= 0 && th < tHit) {
            tHit = th;
            target = a;
            head = true;
            shield = null;
            drone = null;
            device = null;
          }
          const tb = segmentAabb(
            p.pos,
            next,
            { x: a.pos.x - PLAYER.bodyHalf, y: a.pos.y, z: a.pos.z - PLAYER.bodyHalf },
            { x: a.pos.x + PLAYER.bodyHalf, y: a.pos.y + bodyTop(a), z: a.pos.z + PLAYER.bodyHalf },
          );
          if (tb >= 0 && tb < tHit) {
            tHit = tb;
            target = a;
            head = false;
            shield = null;
            drone = null;
            device = null;
          }
        }
      }
      const at = (t) => ({ x: p.pos.x + (next.x - p.pos.x) * t, y: p.pos.y + (next.y - p.pos.y) * t, z: p.pos.z + (next.z - p.pos.z) * t });
      // 머리 옆을 스친 탄 → 제압 (맞은 요원은 제외, 벽·문에 박힌 곳까지만)
      if (!p.harmless) this.nearMiss(p, p.pos, tHit <= 1 ? at(tHit) : next, target, tHit <= 1);
      // CQB 작전: 연구원 (누가 쏜 탄이든 맞음)
      const hh = !p.harmless && this.op ? this.op.hitTest(p.pos, next, tHit) : null;
      if (hh) {
        const hitPos = at(hh.t);
        const w = WEAPONS[p.weapon];
        this.emit('impact', { ...hitPos, kind: 'flesh', projectile: p });
        this.op.hurtHostage(hh.hostage, p.damage * falloffAt(w, p.from ? dist(p.from, hitPos) : 0), this.agentById(p.ownerId));
        continue;
      }
      if (drone) {
        // 드론·RC카는 한 발에 떨어짐
        this.emit('impact', { ...at(tHit), kind: 'surface', projectile: p });
        this.endDrone(drone, 'shot');
        continue;
      }
      if (device) {
        this.emit('impact', { ...at(tHit), kind: 'surface', projectile: p });
        this.gadgets.destroy(device, 'shot', this.agentById(p.ownerId));
        continue;
      }
      if (target) {
        const hitPos = at(tHit);
        const owner = this.agentById(p.ownerId);
        const w = WEAPONS[p.weapon];
        const mult = (head ? w.headMult : 1) * falloffAt(w, p.from ? dist(p.from, hitPos) : 0);
        this.emit('impact', { ...hitPos, kind: 'flesh', projectile: p, headshot: head });
        this.applyDamage(target, p.damage * mult, owner, { headshot: head, weapon: p.weapon, pos: hitPos, pellet: p.pellet, pen: p.pen ?? 0, wear: p.wear ?? 1 });
        continue;
      }
      if (shield) {
        const hp = at(tHit);
        if (!p.harmless) shield.hp -= p.damage;
        this.emit('impact', { ...hp, nx: -Math.sin(shield.yaw), ny: 0, nz: -Math.cos(shield.yaw), kind: 'shield', projectile: p });
        continue;
      }
      if (mh && mh.door != null) {
        // 문짝: 산탄은 자물쇠를 부수고, 관통력이 있는 탄은 뚫고 지나감 (피해가 줄어듦)
        const d = this.doors.list[mh.door];
        const through = !!d && this.doors.shot(d, mh, p);
        this.emit('impact', { x: mh.x, y: mh.y, z: mh.z, nx: mh.nx, ny: mh.ny, nz: mh.nz, kind: p.harmless ? 'debris' : 'door', mat: d?.mat ?? 'wood', projectile: p });
        if (through) {
          const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
          p.pos.x = mh.x + (p.vel.x / sp) * 0.05;
          p.pos.y = mh.y + (p.vel.y / sp) * 0.05;
          p.pos.z = mh.z + (p.vel.z / sp) * 0.05;
          p.life -= dt;
          if (p.life > 0) keep.push(p);
        }
        continue;
      }
      if (mh) {
        // 작용·반작용 도탄: 벽이 탄을 같은 크기의 힘으로 밀어내 반사
        if (p.bounces > 0 && !p.harmless) {
          const vn = p.vel.x * mh.nx + p.vel.y * mh.ny + p.vel.z * mh.nz;
          const k = PROJECTILE.bounceKeep;
          p.vel.x = (p.vel.x - 2 * vn * mh.nx) * k;
          p.vel.y = (p.vel.y - 2 * vn * mh.ny) * k;
          p.vel.z = (p.vel.z - 2 * vn * mh.nz) * k;
          p.damage *= k;
          p.bounces--;
          p.bounced = true;
          p.pos.x = mh.x + mh.nx * 0.03;
          p.pos.y = mh.y + mh.ny * 0.03;
          p.pos.z = mh.z + mh.nz * 0.03;
          this.emit('ricochet', { x: mh.x, y: mh.y, z: mh.z, nx: mh.nx, ny: mh.ny, nz: mh.nz, projectile: p });
          keep.push(p);
          continue;
        }
        this.emit('impact', { x: mh.x, y: mh.y, z: mh.z, nx: mh.nx, ny: mh.ny, nz: mh.nz, kind: p.harmless ? 'debris' : 'surface', projectile: p });
        continue;
      }
      p.pos.x = next.x;
      p.pos.y = next.y;
      p.pos.z = next.z;
      p.life -= dt;
      if (p.life > 0) keep.push(p);
    }
    this.projectiles = keep;
  }

  // 총알이 머리 옆을 스침 → 제압 (같은 편·맞은 요원·이 탄이 이미 스친 요원은 제외)
  //   a0→a1 = 이번 틱에 탄이 지난 구간. final = 여기서 멈춤(벽·몸) → 끝점이 가장 가까울 수 있음
  nearMiss(p, a0, a1, hitAgent, final) {
    if (p.harmless || p.team == null) return;
    const R = SUPPRESS.radius;
    const dx = a1.x - a0.x, dy = a1.y - a0.y, dz = a1.z - a0.z;
    const L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1e-9) return;
    for (const a of this.agents) {
      if (!a.alive || a.team === p.team || a === hitAgent || p.whiz?.includes(a.id)) continue;
      const e = eyePos(a);
      let t = ((e.x - a0.x) * dx + (e.y - a0.y) * dy + (e.z - a0.z) * dz) / L2;
      // 가장 가까운 점이 아직 앞에 있으면 다음 틱에 (단, 여기서 멈추면 끝점), 이미 지나갔으면 이전 틱에서 처리됨
      if (t > 1 && !final) continue;
      if (t < 0) continue;
      t = Math.min(1, t);
      const cx = a0.x + dx * t, cy = a0.y + dy * t, cz = a0.z + dz * t;
      const d = Math.hypot(e.x - cx, e.y - cy, e.z - cz);
      if (d > R) continue;
      (p.whiz ??= []).push(a.id);
      const w = WEAPONS[p.weapon];
      const k = clamp((w?.damage ?? 11) / 11, 0.7, 1.8) * (w?.supp ?? 1) * (p.pellet ? 0.25 : 1);
      const near = 1 - d / R;
      a.suppress = Math.min(1, (a.suppress ?? 0) + SUPPRESS.add * k * (0.35 + 0.65 * near));
      a.suppressHold = SUPPRESS.hold;
      this.emit('nearMiss', { agent: a, x: cx, y: cy, z: cz, d, weapon: p.weapon, owner: p.ownerId ?? null });
    }
  }

  // pen: 탄의 관통력, wear: 방탄을 닳게 하는 배율 (탄종). 방탄이 덮는 곳(몸통, 중량은 머리도)에 맞으면 관통 판정
  applyDamage(t, amount, attacker, { headshot = false, weapon = null, pos = null, backstab = false, pellet = false, pen = 0, wear = 1 } = {}) {
    if (!t.alive || this.phase !== 'live') return;
    amount = Math.round(amount);
    let hpLoss = amount, armorLoss = 0, armorHit = null;
    const kind = ARMOR[t.armorKind];
    if ((t.armor ?? 0) > 0 && kind && (!headshot || kind.helmet)) {
      const r = hitArmor({ damage: amount, pen, wear, cls: kind.cls, dur: t.armor, max: t.armorMax || kind.dur }, this.rng.next());
      hpLoss = Math.round(r.hp);
      armorLoss = Math.min(t.armor, r.wear);
      t.armor -= armorLoss;
      if (t.armor < 0.5) {
        t.armor = 0; // 부서짐
        t.armorKind = null;
      }
      armorHit = r.penetrated ? 'pen' : 'block';
    }
    // 저격총 머리: 헬멧이 있어도 한 방 (헬멧은 그대로 닳음)
    if (headshot && WEAPONS[weapon]?.headKill) {
      hpLoss = Math.max(hpLoss, t.hp);
      if (armorHit) armorHit = 'pen';
    }
    const dealt = Math.round(armorLoss) + Math.min(Math.max(0, t.hp), hpLoss);
    t.hp -= hpLoss;
    t.lastHurtT = this.time;
    t.lastHurtBy = attacker?.id ?? null;
    // 드론 조종 중에 몸이 맞으면 화면이 몸으로 돌아옴
    if (t.drone && hpLoss > 0) this.endDrone(this.drones.find((d) => d.id === t.drone), 'hurt');
    if (t.camView && hpLoss > 0) this.gadgets.exitCams(t, 'hurt');
    if (t.mirror && hpLoss > 0) this.doors.endMirror(t, 'hurt');
    if (t.opTask && hpLoss > 0) this.op.cancelTask(t, 'hit');
    // 피격 반응: 조준이 위로 튀고 잠깐 느려짐
    t.tagT = PLAYER.tagTime;
    t.punch = Math.min(0.08, t.punch + (pellet ? 0.006 : headshot ? 0.04 : 0.022));
    if (t.lockpick) this.cancelLockpick(t, 'hit');
    if (attacker) {
      attacker.stats.damage += dealt;
      if (attacker.round) attacker.round.damage += dealt;
      attacker.ult = Math.min(ULT.max, attacker.ult + dealt * ULT.perDamage);
      if (headshot) attacker.stats.headshots++;
      if (t.round && attacker.team !== t.team) t.round.by[attacker.id] = (t.round.by[attacker.id] ?? 0) + dealt;
    }
    const killed = t.hp <= 0;
    // armor: 방탄에 맞음 · blocked: 방탄이 막음(충격만) · armorBroke: 이번 탄으로 방탄이 부서짐
    this.emit('hit', { target: t, attacker, amount: dealt, headshot, killed, weapon, pos, backstab, armor: !!armorHit, blocked: armorHit === 'block', armorBroke: !!armorHit && t.armor <= 0 });
    if (killed) this.kill(t, attacker, { headshot, weapon });
  }

  kill(t, attacker, { headshot = false, weapon = null } = {}) {
    t.alive = false;
    t.hp = 0;
    t.armor = 0;
    t.armorKind = null;
    t.equip = null;
    if (t.drone) this.endDrone(this.drones.find((d) => d.id === t.drone), 'dead');
    if (t.camView) this.gadgets.exitCams(t, 'dead');
    t.pulseOn = false;
    if (t.mirror) this.doors.endMirror(t, 'dead');
    if (t.opTask) this.op.cancelTask(t, 'dead');
    t.kickT = 0;
    t.stunT = t.flashT = t.gasT = 0;
    t.deadT = 0;
    t.held = null;
    t.slippery = false;
    t.mired = false;
    t.ads = false;
    t.stats.deaths++;
    if (t.lockpick) this.cancelLockpick(t, 'dead');
    if (attacker && attacker !== t) {
      attacker.stats.kills++;
      if (attacker.round) attacker.round.kills++;
      attacker.ult = Math.min(ULT.max, attacker.ult + ULT.perKill);
      this.pay(attacker, ECON.kill);
    }
    // 도움: 이번 라운드에 이 요원에게 피해를 준 다른 적
    const assists = Object.keys(t.round?.by ?? {}).filter((id) => id !== attacker?.id).map((id) => this.agentById(id)).filter(Boolean);
    for (const x of assists) x.stats.assists = (x.stats.assists ?? 0) + 1;
    this.emit('kill', { victim: t, killer: attacker, headshot, weapon, assists, streak: attacker?.round?.kills ?? 0 });
  }

  // ───────────────────────── 포스 패치 ─────────────────────────
  usePatch(a, slot) {
    const p = a.patches[slot];
    if (!p) return false;
    const def = PATCHES[p.id];
    if (def.tier === 'ultimate') {
      if (a.ult < ULT.max) {
        this.emit('patchDenied', { agent: a, slot, reason: 'gauge' });
        return false;
      }
    } else if (p.cd > 0) {
      this.emit('patchDenied', { agent: a, slot, reason: 'cooldown' });
      return false;
    }
    const payload = { agent: a, patchId: p.id, slot };
    switch (p.id) {
      case 'gravityVeil': {
        const veil = {
          id: this.nextId++,
          ownerId: a.id,
          team: a.team,
          t: def.duration,
          duration: def.duration,
          radius: def.radius,
          center: { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z },
        };
        this.veils.push(veil);
        p.activeT = def.duration;
        payload.veil = veil;
        break;
      }
      case 'elasticPad': {
        payload.pos = copy(a.pos);
        a.vel.x = -Math.sin(a.yaw) * def.launchSpeed;
        a.vel.z = -Math.cos(a.yaw) * def.launchSpeed;
        a.vel.y = def.launchUp;
        a.onGround = false;
        break;
      }
      case 'resultantAmp': {
        a.ampT = def.duration;
        p.activeT = def.duration;
        break;
      }
      case 'frictionZero': {
        const pt = this.aimPoint(a, def.range);
        const zone = { id: this.nextId++, type: 'friction', ownerId: a.id, team: a.team, ...pt, radius: def.radius, t: def.duration, duration: def.duration, age: 0 };
        this.zones.push(zone);
        payload.zone = zone;
        break;
      }
      case 'reactionRounds': {
        a.bounceT = def.duration;
        p.activeT = def.duration;
        break;
      }
      case 'buoyShield': {
        const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
        let d = 2.0;
        const clear = (dd) => {
          const { c, r } = this.map.toCell(a.pos.x + fx * dd, a.pos.z + fz * dd);
          return this.map.walkableAt(c, r, a.pos.y) && this.map.lineOfSight(eyePos(a), { x: a.pos.x + fx * dd, y: a.pos.y + 1, z: a.pos.z + fz * dd });
        };
        while (d > 0.8 && !clear(d)) d -= 0.3;
        const base = a.pos.y + 0.2;
        const shield = {
          id: this.nextId++,
          ownerId: a.id,
          team: a.team,
          x: a.pos.x + fx * d,
          z: a.pos.z + fz * d,
          yaw: a.yaw,
          y0: base,
          y1: base + def.height,
          halfW: def.width / 2,
          hp: def.hp,
          maxHp: def.hp,
          t: def.duration,
          duration: def.duration,
        };
        this.shields.push(shield);
        payload.shield = shield;
        break;
      }
      case 'elasticNet': {
        const pt = this.aimPoint(a, def.range);
        const zone = { id: this.nextId++, type: 'net', ownerId: a.id, team: a.team, ...pt, radius: def.radius, t: def.holdTime, duration: def.holdTime, age: 0, captured: [] };
        for (const e of this.agents) {
          if (!e.alive || e.team === a.team || e.held) continue;
          if (Math.hypot(e.pos.x - pt.x, e.pos.z - pt.z) > def.radius || Math.abs(e.pos.y - pt.y) > 2) continue;
          if (!this.map.lineOfSight({ x: pt.x, y: pt.y + 1, z: pt.z }, chestPos(e))) continue;
          e.held = { zoneId: zone.id, x: e.pos.x, y: e.pos.y + 0.35, z: e.pos.z };
          zone.captured.push(e.id);
          if (e.lockpick) this.cancelLockpick(e, 'captured');
          this.emit('captured', { agent: e, zone });
        }
        this.zones.push(zone);
        payload.zone = zone;
        break;
      }
      case 'weightScanner': {
        // 작동 순간 직전 1초 안에 큰 소리를 낸 적 + 이후 4초간 소리를 내는 적만 표시
        const scan = { id: this.nextId++, team: a.team, ownerId: a.id, x: a.pos.x, z: a.pos.z, radius: def.radius, until: this.time + def.duration };
        this.scans.push(scan);
        const revealed = [];
        for (const n of this.noises) {
          if (n.team === a.team || this.time - n.t > 1 || !(n.kind === 'step' || n.kind === 'land' || (WEAPONS[n.kind] && !WEAPONS[n.kind].melee))) continue;
          if (Math.hypot(n.x - scan.x, n.z - scan.z) > def.radius) continue;
          const e = this.agentById(n.agentId);
          if (!e?.alive || revealed.includes(e.id)) continue;
          e.revealedUntil = Math.max(e.revealedUntil, this.time + 1.2);
          revealed.push(e.id);
        }
        payload.revealed = revealed;
        payload.scan = scan;
        payload.radius = def.radius;
        payload.pos = copy(a.pos);
        break;
      }
      case 'resultantSurge': {
        payload.affected = [];
        for (const m of this.agents) {
          if (!m.alive || m.team !== a.team) continue;
          m.ampT = Math.max(m.ampT, def.duration);
          payload.affected.push(m.id);
        }
        break;
      }
      case 'frictionStorm': {
        const pt = this.aimPoint(a, def.range);
        const zone = { id: this.nextId++, type: 'storm', ownerId: a.id, team: a.team, ...pt, radius: def.radius, t: def.duration, duration: def.duration, age: 0 };
        this.zones.push(zone);
        payload.zone = zone;
        break;
      }
      case 'gravityCollapse': {
        const pt = this.aimPoint(a, def.range);
        const total = def.pullTime + def.holdTime;
        const zone = {
          id: this.nextId++,
          type: 'collapse',
          ownerId: a.id,
          team: a.team,
          x: pt.x,
          y: pt.y + 1.6,
          z: pt.z,
          groundY: pt.y,
          radius: def.radius,
          pullT: def.pullTime,
          t: total,
          duration: total,
          age: 0,
          captured: [],
        };
        this.zones.push(zone);
        payload.zone = zone;
        break;
      }
      default:
        return false;
    }
    if (def.tier === 'ultimate') a.ult = 0;
    else p.cd = def.cooldown * (this.isMastered(a, p.id) ? MASTERY.cooldownMult : 1);
    a.stats.patchUses++;
    this.makeNoise(a, 'patch');
    this.emit('patch', payload);
    return true;
  }

  // 조준한 곳의 바닥 지점 (벽 너머·맵 밖으로 나가지 않게). 2층 바닥·상자 위도 그 높이로
  aimPoint(a, range) {
    const eye = eyePos(a);
    const d = dirFromAngles(a.yaw, a.pitch);
    const end = { x: eye.x + d.x * range, y: eye.y + d.y * range, z: eye.z + d.z * range };
    const hit = this.map.raycast(eye, end);
    let p = hit ? { x: hit.x, y: hit.y, z: hit.z } : end;
    // 벽에 맞으면 벽 앞으로 조금 물림
    if (hit && Math.abs(hit.ny) < 0.5) {
      p.x += hit.nx * 0.6;
      p.z += hit.nz * 0.6;
    }
    // 그 지점 아래의 바닥 (허공이면 눈에서 그 지점까지 거슬러 가며 처음 바닥이 있는 곳)
    const support = (q) => {
      const { c, r } = this.map.toCell(q.x, q.z);
      if (!this.map.inBounds(c, r)) return null;
      const y = this.map.dropToGround(q.x, q.z, Math.max(q.y, 0) + 0.3);
      return y <= Math.max(q.y, 0) + 0.35 && Math.max(q.y, 0) - y < 4 ? y : null;
    };
    let y = support(p);
    if (y == null) {
      const steps = Math.ceil(dist(eye, p));
      for (let i = steps; i >= 0; i--) {
        const q = { x: eye.x + (p.x - eye.x) * (i / steps), y: eye.y + (p.y - eye.y) * (i / steps), z: eye.z + (p.z - eye.z) * (i / steps) };
        y = support(q);
        if (y != null) {
          p = q;
          break;
        }
      }
      if (y == null) {
        p = { x: a.pos.x, y: a.pos.y, z: a.pos.z };
        y = a.pos.y;
      }
    }
    return { x: p.x, y, z: p.z };
  }

  updateVeils(dt) {
    const keep = [];
    for (const v of this.veils) {
      const owner = this.agentById(v.ownerId);
      v.t -= dt;
      if (!owner || !owner.alive) v.t = 0;
      else {
        v.center.x = owner.pos.x;
        v.center.y = owner.pos.y + 1;
        v.center.z = owner.pos.z;
      }
      if (v.t > 0) keep.push(v);
      else this.emit('veilEnd', { veil: v });
    }
    this.veils = keep;
  }

  updateShields(dt) {
    const keep = [];
    for (const sh of this.shields) {
      sh.t -= dt;
      if (sh.t > 0 && sh.hp > 0) keep.push(sh);
      else this.emit('shieldEnd', { shield: sh, broken: sh.hp <= 0 });
    }
    this.shields = keep;
  }

  // 벽과 부력 방패를 모두 고려한 직선 시야
  clearLine(a, b) {
    if (!this.map.lineOfSight(a, b)) return false;
    for (const sh of this.shields) if (segmentShield(a, b, sh) >= 0) return false;
    if (this.smokeBetween(a, b)) return false;
    return true;
  }

  // 연막이 두 점 사이 시야를 가리는지 (연기 구 안을 지나가는 거리가 1.2 m를 넘으면)
  smokeBetween(a, b) {
    for (const z of this.zones) {
      if (z.type !== 'smoke' || z.age < 0.8) continue;
      const r = z.radius * Math.min(1, z.age / 2.5) * (z.t < 2 ? z.t / 2 : 1); // 피어오르고 걷힘
      const c = { x: z.x, y: z.y + 1.4, z: z.z };
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const L2 = dx * dx + dy * dy + dz * dz;
      if (L2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / L2));
      const px = a.x + dx * t - c.x, py = (a.y + dy * t - c.y) * 1.6, pz = a.z + dz * t - c.z;
      const d2 = px * px + py * py + pz * pz;
      if (d2 >= r * r) continue;
      const chord = 2 * Math.sqrt(r * r - d2);
      if (chord > 1.2) return true;
    }
    return false;
  }

  updateZones(dt) {
    for (const a of this.agents) {
      a.slippery = false;
      a.mired = false;
    }
    const keep = [];
    for (const z of this.zones) {
      z.t -= dt;
      z.age += dt;
      if (z.type === 'friction') {
        for (const a of this.agents) {
          if (!a.alive || a.team === z.team || !a.onGround) continue;
          if (Math.hypot(a.pos.x - z.x, a.pos.z - z.z) <= z.radius && Math.abs(a.pos.y - z.y) < 0.6) a.slippery = true;
        }
      } else if (z.type === 'storm') {
        for (const a of this.agents) {
          if (!a.alive || a.team === z.team) continue;
          if (Math.hypot(a.pos.x - z.x, a.pos.z - z.z) <= z.radius && Math.abs(a.pos.y - z.y) < 1.2) a.mired = true;
        }
      } else if (z.type === 'gas' && z.age > 0.6) {
        // 최루 가스: 안에 있는 사람은 (아군도) 기침·느려짐·조준 흔들림
        const r = z.radius * Math.min(1, z.age / 2);
        for (const a of this.agents) {
          if (!a.alive) continue;
          if (Math.hypot(a.pos.x - z.x, a.pos.z - z.z) <= r && a.pos.y + 1 > z.y - 0.5 && a.pos.y < z.y + 2.5) a.gasT = Math.max(a.gasT ?? 0, 0.8);
        }
      } else if (z.type === 'collapse' && z.age <= z.pullT) {
        for (const a of this.agents) {
          if (!a.alive || a.team === z.team || a.held) continue;
          if (Math.hypot(a.pos.x - z.x, a.pos.z - z.z) > z.radius || Math.abs(a.pos.y + 1 - z.y) > 4) continue;
          if (!this.map.lineOfSight({ x: z.x, y: z.y, z: z.z }, chestPos(a))) continue;
          const i = z.captured.length;
          const ang = i * 2.4;
          const rr = i === 0 ? 0 : 0.85;
          a.held = { zoneId: z.id, x: z.x + Math.cos(ang) * rr, y: z.y - 1.1, z: z.z + Math.sin(ang) * rr };
          z.captured.push(a.id);
          if (a.lockpick) this.cancelLockpick(a, 'captured');
          this.emit('captured', { agent: a, zone: z });
        }
      }
      if (z.t > 0) keep.push(z);
      else {
        if (z.type === 'collapse') {
          for (const id of z.captured) {
            const a = this.agentById(id);
            if (a?.held?.zoneId === z.id) {
              a.held = null;
              a.vel.x = a.vel.y = a.vel.z = 0;
            }
          }
        }
        if (z.type === 'net') {
          // 늘어난 그물이 복원되며 바깥쪽으로 튕겨냄
          const def = PATCHES.elasticNet;
          for (const id of z.captured) {
            const a = this.agentById(id);
            if (a?.held?.zoneId !== z.id) continue;
            a.held = null;
            let dx = a.pos.x - z.x, dz = a.pos.z - z.z;
            let l = Math.hypot(dx, dz);
            if (l < 0.2) {
              const ang = this.rng.next() * Math.PI * 2;
              dx = Math.cos(ang);
              dz = Math.sin(ang);
              l = 1;
            }
            a.vel.x = (dx / l) * def.throwSpeed;
            a.vel.z = (dz / l) * def.throwSpeed;
            a.vel.y = def.throwUp;
            a.onGround = false;
          }
          this.emit('netRelease', { zone: z });
        }
        this.emit('zoneEnd', { zone: z });
      }
    }
    this.zones = keep;
  }

  // ───────────────────────── 투척·폭발 장비 ─────────────────────────
  decayEffects(a, dt) {
    if (a.stunT > 0) a.stunT = Math.max(0, a.stunT - dt);
    if (a.flashT > 0) a.flashT = Math.max(0, a.flashT - dt);
    if (a.gasT > 0) a.gasT = Math.max(0, a.gasT - dt);
    if (a.empT > 0) a.empT = Math.max(0, a.empT - dt);
  }

  // 4: 투척물 들기 (들고 있으면 다음 종류로) · 5: C4 → 붙였으면 기폭기
  equipGear(a, which) {
    a.gear ??= emptyGear();
    const before = a.equip;
    if (which === 'throw') {
      const id = nextThrowable(a, a.equip?.kind === 'throw' ? a.equip.id : null);
      if (!id) return this.emit('gearDenied', { agent: a, which, reason: 'none' });
      a.equip = { kind: 'throw', id };
    } else if (which === 'gadget') {
      // 5: 가진 것 중 돌아가며 (C4 → 기폭기 → 드론 → RC카 → 경보 센서 → 카메라 → 카메라 보기 → 심박 센서)
      const opts = this.gadgetOptions(a);
      if (!opts.length) return this.emit('gearDenied', { agent: a, which, reason: 'none' });
      const i = opts.indexOf(a.equip?.kind);
      a.equip = { kind: opts[(i + 1) % opts.length] };
    } else return;
    this.heldChanged(a, before);
  }

  // 봇: 원하는 장비를 바로 손에 (5를 여러 번 누르는 것과 같음)
  equipTo(a, kind) {
    if (a.equip?.kind === kind || !this.gadgetOptions(a).includes(kind)) return;
    const before = a.equip;
    a.equip = { kind };
    this.heldChanged(a, before);
  }

  heldChanged(a, before) {
    if (before?.kind === a.equip.kind && before?.id === a.equip.id) return;
    a.reloadT = 0;
    a.ads = false;
    a.swapT = 0.25; // 손에 쥐는 시간
    a.triggerLatch = true;
    a.adsLatch = true;
    this.emit('equip', { agent: a, equip: { ...a.equip } });
  }

  // 5로 손에 들 수 있는 것 (가진 것만, 이 순서로 돌아감)
  gadgetOptions(a) {
    const opts = [];
    if ((a.gear?.c4 ?? 0) > 0) opts.push('c4');
    if (this.charges.some((c) => c.ownerId === a.id)) opts.push('det');
    if ((a.gear?.drone ?? 0) > 0 && !a.drone) opts.push('drone');
    if ((a.gear?.rc ?? 0) > 0 && !a.drone) opts.push('rc');
    if ((a.gear?.alarm ?? 0) > 0) opts.push('alarm');
    if ((a.gear?.cam ?? 0) > 0) opts.push('cam');
    if (this.gadgets.teamCams(a.team).length || (a.equip?.kind === 'camview' && this.throwables.some((t) => t.kind === 'cam' && t.ownerId === a.id))) opts.push('camview');
    if ((a.gear?.pulse ?? 0) > 0) opts.push('pulse');
    return opts;
  }

  // 장비를 든 손: 쥐는 중이 아니면 누른 순간 한 번 동작 (심박 센서는 누르고 있는 동안)
  stepGearHand(a, intent, canAct, dt) {
    a.pulseOn = a.equip?.kind === 'pulse' && a.swapT <= 0 && canAct && !!intent.fire && !((a.empT ?? 0) > 0);
    if (a.swapT > 0) {
      a.swapT = Math.max(0, a.swapT - dt);
      a.triggerLatch = intent.fire;
      a.adsLatch = intent.ads;
      return;
    }
    const left = intent.fire && !a.triggerLatch;
    const right = intent.ads && !a.adsLatch;
    a.triggerLatch = intent.fire;
    a.adsLatch = intent.ads;
    a.ads = false;
    a.adsT = 0;
    if (!canAct || (!left && !right) || this.client) return;
    const e = a.equip;
    if (e.kind === 'throw') this.throwGear(a, e.id, left ? 'long' : 'short');
    else if (e.kind === 'cam') this.throwGear(a, 'cam', left ? 'long' : 'short');
    else if (e.kind === 'c4' && left) this.placeCharge(a);
    else if (e.kind === 'det' && left) this.detonate(a);
    else if ((e.kind === 'drone' || e.kind === 'rc') && left) this.launchDrone(a, null, e.kind);
    else if (e.kind === 'alarm' && left) this.gadgets.placeAlarm(a);
    else if (e.kind === 'camview' && left) this.gadgets.enterCams(a);
  }

  // ───── 정찰 드론 · RC카 ─────
  // 띄우기: 드론은 눈앞에서 떠오르고 RC카는 발 앞 바닥에 내려놓음. 사람은 그 카메라로 조종(입력이 장비로), 봇은 목표까지 자동
  launchDrone(a, autopilot = null, kind = 'drone') {
    if (!((a.gear?.[kind] ?? 0) > 0) || a.drone || this.client) return false;
    const key = BAT_KEY[kind];
    const bat = a[key] ?? GEAR[kind].battery;
    if ((a.empT ?? 0) > 0) {
      this.emit('gearDenied', { agent: a, which: 'gadget', reason: 'emp', kind });
      return false;
    }
    const min = (kind === 'rc' ? RC : DRONE).minLaunch;
    if (bat < min) {
      this.emit('gearDenied', { agent: a, which: 'gadget', reason: 'battery', left: bat, kind });
      return false;
    }
    a.gear[kind]--;
    a[key] = 0; // 배터리는 장비와 함께 나감
    const f = { x: -Math.sin(a.yaw), z: -Math.cos(a.yaw) };
    const eye = eyePos(a);
    let pos, vel;
    if (kind === 'rc') {
      // 발 앞 0.6 m 바닥 (벽에 막히면 발밑)
      pos = { x: a.pos.x + f.x * 0.6, y: a.pos.y + 0.05, z: a.pos.z + f.z * 0.6 };
      if (!this.map.lineOfSight({ x: a.pos.x, y: a.pos.y + 0.3, z: a.pos.z }, { x: pos.x, y: pos.y + 0.25, z: pos.z })) Object.assign(pos, { x: a.pos.x, z: a.pos.z });
      vel = { x: f.x * 1.2, y: 0, z: f.z * 1.2 };
    } else {
      pos = { x: eye.x + f.x * 0.5, y: eye.y - 0.2, z: eye.z + f.z * 0.5 };
      if (!this.map.lineOfSight(eye, pos)) Object.assign(pos, { x: eye.x, y: eye.y - 0.2, z: eye.z });
      vel = { x: f.x * 1.5, y: 1.2, z: f.z * 1.5 };
    }
    const d = { id: this.nextId++, kind, ownerId: a.id, team: a.team, pos, vel, yaw: a.yaw, pitch: kind === 'rc' ? 0 : -0.1, battery: bat, scanT: 0, buzzT: 0, autopilot, marks: [], onGround: kind === 'rc' };
    this.drones.push(d);
    a.drone = d.id;
    a.droneHome = { yaw: a.yaw, pitch: a.pitch };
    a.equip = null;
    a.reloadT = 0;
    this.emit('droneLaunch', { agent: a, drone: d });
    return true;
  }

  // 드론 조종 입력: 이동·위(점프)·아래(앉기)·시점 → 드론 / 왼쪽 클릭 = 적 표시 / F·5 = 복귀
  droneControl(a, intent) {
    const d = this.drones.find((x) => x.id === a.drone);
    if (!d) {
      a.drone = null;
      return intent;
    }
    if (!d.autopilot) {
      d.input = { mx: intent.moveX, mz: intent.moveZ, up: intent.jump, down: intent.crouch, yaw: intent.yaw, pitch: intent.pitch };
      const mark = intent.fire && !d.fireLatch;
      d.fireLatch = intent.fire;
      if (mark) this.droneMark(a, d);
      if (intent.interact || intent.equip === 'gadget' || intent.switchTo) {
        this.endDrone(d, 'recall');
        return { ...emptyIntent(a), yaw: a.yaw, pitch: a.pitch };
      }
    }
    // 몸: 앉아서 가만히 (총도 쏘지 않음)
    return { ...emptyIntent(a), crouch: true, yaw: a.droneHome?.yaw ?? a.yaw, pitch: a.droneHome?.pitch ?? 0 };
  }

  // 드론·RC카 화면 가운데(약 6°)에 보이는 적을 표시 → 5초 동안 벽 너머로도 팀에 보임 + 무전
  droneMark(a, d) {
    const def = GEAR[d.kind ?? 'drone'];
    const eye = remoteEye(d);
    const fwd = dirFromAngles(d.yaw, d.pitch);
    let best = null, bestCos = Math.cos(0.11);
    for (const e of this.agents) {
      if (!e.alive || e.team === d.team) continue;
      const c = chestPos(e);
      const vx = c.x - eye.x, vy = c.y - eye.y, vz = c.z - eye.z;
      const l = Math.hypot(vx, vy, vz);
      if (l > def.range + 5) continue;
      const cs = (vx * fwd.x + vy * fwd.y + vz * fwd.z) / l;
      if (cs < bestCos || !this.clearLine(eye, c)) continue;
      bestCos = cs;
      best = e;
    }
    if (!best) {
      this.emit('droneMark', { agent: a, drone: d, target: null });
      return null;
    }
    best.revealedUntil = Math.max(best.revealedUntil, this.time + def.mark);
    best.spottedT = this.time;
    const place = this.map.calloutAt(best.pos.x, best.pos.z, best.pos.y) ?? (d.kind === 'rc' ? 'RC카 앞' : '드론 앞');
    this.shareIntel(a, { x: best.pos.x, y: best.pos.y, z: best.pos.z, kind: 'seen' });
    this.radio(a, `${d.kind === 'rc' ? 'RC카' : '드론'}: 적 표시 — ${place}`, { kind: 'contact', pos: { ...best.pos }, report: true });
    this.emit('droneMark', { agent: a, drone: d, target: best });
    return best;
  }

  endDrone(d, reason = 'battery') {
    if (!d) return;
    this.drones = this.drones.filter((x) => x !== d);
    const a = this.agentById(d.ownerId);
    if (a?.drone === d.id) {
      a.drone = null;
      if (a.droneHome) {
        a.yaw = a.droneHome.yaw;
        a.pitch = a.droneHome.pitch;
      }
    }
    // 회수(또는 조종 중 몸이 맞아 급히 거둠): 바로 손으로 돌아옴 (남은 배터리 그대로 · 바로 다시 띄울 수 있음)
    const kind = d.kind ?? 'drone';
    if ((reason === 'recall' || reason === 'hurt') && a?.alive) {
      a.gear[kind] = Math.min(GEAR[kind].max, (a.gear[kind] ?? 0) + 1);
      a[BAT_KEY[kind]] = Math.max(0, d.battery);
    }
    this.emit('droneEnd', { drone: d, agent: a, reason, x: d.pos.x, y: d.pos.y, z: d.pos.z });
  }

  updateDrones(dt) {
    if (!this.drones.length) return;
    for (const d of [...this.drones]) {
      const a = this.agentById(d.ownerId);
      if (!a?.alive) {
        this.endDrone(d, 'dead');
        continue;
      }
      d.battery -= dt;
      if (d.battery <= 0) {
        this.endDrone(d, 'battery');
        continue;
      }
      // 봇 자동 비행: 길을 따라 목표로, 도착하면 잠시 둘러봄
      if (d.autopilot) {
        const ap = d.autopilot;
        const wp = ap.path?.[ap.i];
        if (wp && Math.hypot(wp.x - d.pos.x, wp.z - d.pos.z) < 1.2) ap.i++;
        const tgt = ap.path?.[ap.i];
        if (tgt) {
          const yaw = Math.atan2(-(tgt.x - d.pos.x), -(tgt.z - d.pos.z));
          if (d.kind === 'rc') {
            // RC카: 바닥을 따라 달림 · 0.6초 넘게 제자리면 깡충
            ap.stuck = Math.hypot(d.vel.x, d.vel.z) < 0.6 ? (ap.stuck ?? 0) + dt : 0;
            d.input = { mx: 0, mz: 0.85, up: ap.stuck > 0.6, down: false, yaw, pitch: 0.05 };
          } else {
            const want = (tgt.y ?? 0) + 1.8;
            d.input = { mx: 0, mz: 0.8, up: d.pos.y < want - 0.3, down: d.pos.y > want + 0.3, yaw, pitch: -0.15 };
          }
        } else {
          ap.look = (ap.look ?? 0) + dt;
          d.input = { mx: 0, mz: 0, up: false, down: false, yaw: d.yaw + dt * 1.6, pitch: -0.25 };
          if (ap.look > 3) {
            this.endDrone(d, 'recall');
            continue;
          }
        }
      }
      d.prev = { ...d.pos };
      (d.kind === 'rc' ? stepRC : stepDrone)(this.map, d, d.input ?? { yaw: d.yaw, pitch: d.pitch }, dt);
      // 윙 소리·모터 소리 (가까운 적이 들음 · RC카가 더 조용)
      d.buzzT -= dt;
      if (d.buzzT <= 0) {
        d.buzzT = 0.9;
        if (d.kind !== 'rc' || Math.hypot(d.vel.x, d.vel.z) > 0.5) this.makeNoise(a, d.kind ?? 'drone', d.pos);
      }
      // 드론 카메라에 보이는 적은 팀 미니맵에 (아군이 보고 있는 적과 같음), 봇 드론은 자동으로 표시까지
      d.scanT -= dt;
      if (d.scanT <= 0) {
        const spec = d.kind === 'rc' ? RC : DRONE, def = GEAR[d.kind ?? 'drone'];
        d.scanT = spec.scanEvery;
        const eye = remoteEye(d);
        const fwd = dirFromAngles(d.yaw, d.pitch);
        d.seen = [];
        for (const e of this.agents) {
          if (!e.alive || e.team === d.team) continue;
          const c = chestPos(e);
          const vx = c.x - eye.x, vy = c.y - eye.y, vz = c.z - eye.z;
          const l = Math.hypot(vx, vy, vz);
          if (l > def.range || (l > 2 && (vx * fwd.x + vy * fwd.y + vz * fwd.z) / l < spec.fov)) continue;
          if (!this.clearLine(eye, c)) continue;
          e.spottedT = this.time;
          d.seen.push(e.id);
          if (d.autopilot && !d.marks.includes(e.id)) {
            d.marks.push(e.id);
            e.revealedUntil = Math.max(e.revealedUntil, this.time + def.mark);
            this.shareIntel(a, { x: e.pos.x, y: e.pos.y, z: e.pos.z, kind: 'seen' });
          }
        }
      }
    }
  }

  // 던지기: 눈 앞에서 조준 방향으로 (달리던 속도도 더해짐 = 관성)
  throwGear(a, id, mode = 'long') {
    const def = GEAR[id];
    if (!def || (def.kind !== 'throw' && def.kind !== 'stick') || !((a.gear?.[id] ?? 0) > 0) || this.client) return false;
    a.gear[id]--;
    const dir = dirFromAngles(a.yaw, a.pitch);
    const eye = eyePos(a);
    const start = { x: eye.x + dir.x * 0.35, y: eye.y - 0.1 + dir.y * 0.35, z: eye.z + dir.z * 0.35 };
    // 벽에 붙어 서서 던지면 벽 안으로 들어가지 않게 눈 위치에서 시작
    const pos = this.map.lineOfSight(eye, start) ? start : { ...eye };
    const t = { id: this.nextId++, kind: id, ownerId: a.id, team: a.team, pos, prev: { ...pos }, vel: throwVelocity(dir, mode, a.vel), fuse: def.fuse, age: 0, rest: false };
    this.throwables.push(t);
    if (a.equip?.kind === 'throw') {
      // 같은 종류가 남았으면 그대로, 없으면 다른 투척물, 그것도 없으면 총으로
      const next = (a.gear[id] ?? 0) > 0 ? id : nextThrowable(a, id);
      a.equip = next ? { kind: 'throw', id: next } : null;
      a.swapT = next ? 0.45 : Math.min(0.4, WEAPONS[a.weapon]?.draw ?? 0.4);
    } else if (a.equip?.kind === 'cam') {
      // 카메라: 남았으면 그대로, 다 던졌으면 '카메라 보기'로 (바로 왼쪽 클릭하면 봄)
      a.equip = (a.gear.cam ?? 0) > 0 ? { kind: 'cam' } : { kind: 'camview' };
      a.swapT = 0.35;
    }
    a.stats.gearUses = (a.stats.gearUses ?? 0) + 1;
    this.makeNoise(a, 'throw');
    this.emit('throw', { agent: a, throwable: t, mode });
    return true;
  }

  placeCharge(a) {
    if (!((a.gear?.c4 ?? 0) > 0)) return false;
    const spot = placeTarget(this.map, eyePos(a), dirFromAngles(a.yaw, a.pitch), GEAR.c4.reach);
    if (!spot) {
      this.emit('gearDenied', { agent: a, which: 'c4', reason: 'far' });
      return false;
    }
    return this.attachCharge(a, spot);
  }

  // 문 행동 '폭약': C4를 손에 들지 않아도 문짝 자물쇠 옆(내 쪽 면)에 바로 붙임
  placeDoorCharge(a, d) {
    if (!((a.gear?.c4 ?? 0) > 0) || !d || d.st.broken || Math.abs(d.st.ang) > 0.3) {
      this.emit('gearDenied', { agent: a, which: 'c4', reason: (a.gear?.c4 ?? 0) > 0 ? 'door' : 'none' });
      return false;
    }
    const s = this.doors.side(d, a.pos);
    const leaf = d.leaves[0];
    const t = d.double ? leaf.len - 0.15 : leaf.len * 0.78;
    const x = leaf.hx + leaf.dx * t, z = leaf.hz + leaf.dz * t;
    return this.attachCharge(a, { x: x + d.n.x * s * 0.04, y: 1.15, z: z + d.n.z * s * 0.04, nx: d.n.x * s, ny: 0, nz: d.n.z * s, door: d.id, leaf: 0 });
  }

  // C4를 붙임. 문짝에 붙이면 문을 따라 움직이고, 터지면 문이 부서짐
  attachCharge(a, spot) {
    a.gear.c4--;
    const { door = null, leaf = null, ...pos } = spot;
    const c = { id: this.nextId++, kind: 'c4', ownerId: a.id, team: a.team, ...pos, armAt: this.time + GEAR.c4.arm, doorId: door };
    if (door != null) {
      // 문짝 위 자리 (경첩에서 거리 · 높이 · 붙인 면)
      const d = this.doors.list[door];
      const lf = d.leaves[leaf ?? 0];
      const sg = leafSegment(d, lf, d.st.ang);
      const t = (pos.x - lf.hx) * sg.dx + (pos.z - lf.hz) * sg.dz;
      const side = Math.sign(-sg.dz * pos.nx + sg.dx * pos.nz) || 1;
      c.onLeaf = { leaf: leaf ?? 0, t: Math.max(0.05, Math.min(lf.len - 0.05, t)), side };
    }
    this.charges.push(c);
    a.equip = { kind: 'det' };
    a.swapT = 0.35;
    this.makeNoise(a, 'patch');
    this.emit('chargePlaced', { agent: a, charge: c });
    return true;
  }

  // 기폭기: 내가 붙인 C4를 모두 터뜨림 (붙인 직후 잠깐은 안 됨)
  detonate(a) {
    const mine = this.charges.filter((c) => c.ownerId === a.id);
    // EMP를 맞은 C4는 잠깐 신호를 못 받음
    const ready = mine.filter((c) => this.time >= c.armAt && !((c.offUntil ?? -99) > this.time));
    if (!ready.length) {
      this.emit('gearDenied', { agent: a, which: 'det', reason: !mine.length ? 'none' : mine.some((c) => (c.offUntil ?? -99) > this.time) ? 'emp' : 'arming' });
      return false;
    }
    this.charges = this.charges.filter((c) => !ready.includes(c));
    for (const c of ready) this.blast(c, GEAR.c4, a);
    a.equip = (a.gear?.c4 ?? 0) > 0 ? { kind: 'c4' } : null;
    if (!a.equip) a.swapT = Math.min(0.4, WEAPONS[a.weapon]?.draw ?? 0.4);
    return true;
  }

  updateThrowables(dt) {
    if (!this.throwables.length) return;
    const keep = [];
    for (const t of this.throwables) {
      t.prev = { ...t.pos };
      t.age += dt;
      const b = stepThrown(this.map, t, dt);
      if (t.kind === 'cam' && !this.client) {
        // 던진 카메라: 처음 닿은 벽·바닥·천장에 붙음 (문짝에는 튕겨 나감)
        if (t.hit && t.hit.door == null) {
          this.gadgets.stickCam(t, t.hit);
          continue;
        }
        if (t.rest) {
          this.gadgets.stickCam(t, { nx: 0, ny: 1, nz: 0 });
          continue;
        }
      }
      if (b) this.emit('gearBounce', { throwable: t, speed: b.speed, x: t.pos.x, y: t.pos.y, z: t.pos.z });
      if (t.age >= t.fuse) {
        this.detonateThrowable(t);
        continue;
      }
      if (t.age < 8) keep.push(t);
    }
    this.throwables = keep;
  }

  detonateThrowable(t) {
    const def = GEAR[t.kind];
    const owner = this.agentById(t.ownerId);
    const at = { x: t.pos.x, y: t.pos.y + 0.15, z: t.pos.z };
    const payload = { kind: t.kind, x: at.x, y: at.y, z: at.z, ownerId: t.ownerId, team: t.team, id: t.id, hit: [] };
    if (t.kind === 'frag') {
      this.blast({ ...at, kind: 'frag', team: t.team, ownerId: t.ownerId }, def, owner);
      return;
    }
    if (t.kind === 'stun' || t.kind === 'flash') {
      // 아군·자신도 맞음 (조심해서 던져야 함)
      for (const a of this.agents) {
        if (!a.alive) continue;
        const eye = eyePos(a);
        let k = exposure(this.map, at, eye, def.radius);
        if (k <= 0) continue;
        if (t.kind === 'flash') {
          // 보고 있던 방향일수록 강함 (등지고 있으면 4분의 1)
          const dx = at.x - eye.x, dy = at.y - eye.y, dz = at.z - eye.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          const f = dirFromAngles(a.yaw, a.pitch);
          const facing = (dx * f.x + dy * f.y + dz * f.z) / d;
          k = Math.min(1, (0.35 + 0.65 * k) * (facing > 0.5 ? 1 : facing > 0 ? 0.6 : 0.25));
          a.flashT = Math.max(a.flashT ?? 0, def.time * k);
        } else {
          k = 0.35 + 0.65 * k;
          a.stunT = Math.max(a.stunT ?? 0, def.time * k);
          if (a.lockpick) this.cancelLockpick(a, 'stunned');
        }
        payload.hit.push({ id: a.id, k: Math.round(k * 100) / 100 });
      }
      // CQB 작전: 연구원은 웅크림 (피해 없음)
      this.op?.onBlast(at, null, owner, (pt) => exposure(this.map, at, pt, def.radius));
    } else if (t.kind === 'smoke' || t.kind === 'gas') {
      const zone = { id: this.nextId++, type: t.kind, ownerId: t.ownerId, team: t.team, x: at.x, y: t.pos.y - 0.05, z: at.z, radius: def.radius, t: def.time, duration: def.time, age: 0 };
      this.zones.push(zone);
      payload.zone = zone;
    } else if (t.kind === 'emp') {
      this.gadgets.emp(at, def, owner, payload);
    }
    if (owner) this.makeNoise(owner, 'gear', at);
    this.emit('detonate', payload);
  }

  // 폭발 (세열 수류탄·C4): 가까울수록 큰 피해, 벽 뒤는 안전, 바깥쪽으로 밀려남. 피해는 적에게만
  blast(at, def, owner) {
    const hits = [];
    // C4: 붙인 문(또는 바로 옆 문)이 부서진 뒤에 폭발이 퍼짐 (건너편까지 닿음)
    if (def.id === 'c4') {
      for (const d of this.doors.list) {
        if (d.id === at.doorId || Math.hypot(d.x - at.x, d.z - at.z) < 1.3) this.doors.breach(d, at, owner);
      }
    }
    for (const a of this.agents) {
      if (!a.alive) continue;
      const c = chestPos(a);
      const k = Math.max(exposure(this.map, at, c, def.radius), exposure(this.map, at, eyePos(a), def.radius) * 0.8);
      if (k <= 0) continue;
      // 폭발이 미는 힘: 폭발 지점에서 바깥쪽으로 속도가 생김
      const dx = c.x - at.x, dz = c.z - at.z, l = Math.hypot(dx, dz) || 1;
      if (!a.held) {
        a.vel.x += (dx / l) * EFFECT.knock * k;
        a.vel.z += (dz / l) * EFFECT.knock * k;
        a.vel.y = Math.max(a.vel.y, 2.5 * k);
        a.onGround = false;
      }
      a.stunT = Math.max(a.stunT ?? 0, 1.5 * k);
      if (owner && a.team === owner.team) continue;
      if (!owner && a.team === at.team) continue;
      hits.push(a.id);
      this.applyDamage(a, def.damage * Math.pow(k, 1.15), owner, { weapon: at.kind ?? def.id, pos: c, pen: def.pen, wear: def.wear });
    }
    // CQB 작전: 연구원도 다치고 웅크림
    this.op?.onBlast(at, def, owner, (pt) => exposure(this.map, at, pt, def.radius));
    // 가까운 카메라·경보 센서는 부서짐
    this.gadgets.blast(at, def.radius);
    if (owner) this.makeNoise(owner, 'blast', at);
    this.emit('detonate', { kind: def.id === 'c4' ? 'c4' : 'frag', x: at.x, y: at.y, z: at.z, nx: at.nx ?? 0, ny: at.ny ?? 1, nz: at.nz ?? 0, ownerId: owner?.id ?? null, team: at.team, id: at.id, hits, doorId: at.doorId ?? null });
  }

  // ───────────────────────── 폭탄 · 락픽 ─────────────────────────
  nearestBomb(a, range) {
    let best = null, bestD = range;
    for (const b of this.bombs) {
      if (b.state !== 'armed') continue;
      const d = Math.hypot(a.pos.x - b.x, a.pos.z - b.z);
      if (d <= bestD && Math.abs(a.pos.y - b.y) < 1.5) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  tryStartLockpick(a) {
    if (a.team !== TEAMS.DEFUSE) return false;
    const bomb = this.nearestBomb(a, BOMB.interactRange);
    if (!bomb) return false;
    if (bomb.picker && bomb.picker !== a.id) {
      this.emit('lockpickBusy', { agent: a, bomb });
      return false;
    }
    bomb.picker = a.id;
    bomb.progress = 0;
    bomb.alertT = this.time;
    if (a.isPlayer || a.human) {
      const puzzle = generatePuzzle(this.rng);
      // 숙달한 개념의 잠금: 계산 결과(요구 힘)가 바로 보이고 더 빨리 돌아감
      if (a.mastered?.has(PUZZLE_INFO[puzzle.kind]?.concept)) {
        puzzle.mastered = true;
        puzzle.hidden = false;
      }
      a.lockpick = { bombId: bomb.id, kind: 'puzzle', puzzle, selected: Array(CARD_COUNT).fill(false), turnT: 0 };
    } else a.lockpick = { bombId: bomb.id, kind: 'timed', t: 0, need: this.rng.range(BOMB.botTimeMin, BOMB.botTimeMax) };
    a.vel.x = 0;
    a.vel.z = 0;
    this.makeNoise(a, 'lockpick', bomb);
    this.emit('lockpickStart', { agent: a, bomb });
    return true;
  }

  stepLockpick(a, intent, dt) {
    const lp = a.lockpick;
    const bomb = this.bombById(lp.bombId);
    if (!bomb || bomb.state !== 'armed') {
      this.cancelLockpick(a, 'gone');
      return;
    }
    if (intent.interact) {
      this.cancelLockpick(a, 'cancel');
      return;
    }
    bomb.alertT = this.time;
    if (lp.kind === 'puzzle') {
      if (intent.card >= 0 && intent.card < lp.selected.length) {
        lp.selected[intent.card] = !lp.selected[intent.card];
        this.emit('lockpickCard', { agent: a, card: intent.card, on: lp.selected[intent.card] });
      }
      if (isSolved(lp.puzzle, lp.selected)) {
        if (lp.turnT === 0) this.emit('lockpickMatch', { agent: a, bomb });
        lp.turnT += dt;
        const turn = BOMB.turnTime * (lp.puzzle.mastered ? MASTERY.turnMult : 1);
        bomb.progress = Math.min(1, lp.turnT / turn);
        if (lp.turnT >= turn) this.defuse(a, bomb);
      } else {
        lp.turnT = 0;
        bomb.progress = 0;
      }
    } else {
      lp.t += dt;
      bomb.progress = Math.min(1, lp.t / lp.need);
      if (lp.t >= lp.need) this.defuse(a, bomb);
    }
  }

  cancelLockpick(a, reason) {
    const lp = a.lockpick;
    if (!lp) return;
    const bomb = this.bombById(lp.bombId);
    if (bomb && bomb.picker === a.id) {
      bomb.picker = null;
      bomb.progress = 0;
    }
    a.lockpick = null;
    this.emit('lockpickEnd', { agent: a, bomb, reason });
  }

  defuse(a, bomb) {
    const puzzleKind = a.lockpick?.puzzle?.kind ?? null;
    bomb.state = 'defused';
    bomb.picker = null;
    bomb.progress = 1;
    a.lockpick = null;
    a.stats.defuses++;
    a.ult = Math.min(ULT.max, a.ult + ULT.perDefuse);
    this.pay(a, ECON.defuse);
    this.emit('lockpickEnd', { agent: a, bomb, reason: 'done', puzzleKind });
    this.emit('bombDefused', { agent: a, bomb });
  }

  // ───────────────────────── 시야 (봇 판단용) ─────────────────────────
  // 각자 자기 눈으로 본 적만 안다 (팀 공유 없음). 비 오는 밤에는 멀리 못 봄.
  updateVisibility(dt) {
    this.visT -= dt;
    if (this.visT > 0) return;
    this.visT = 0.15;
    const maxSight = this.map.def.sight ?? (this.map.weather === 'rain' ? 36 : 60);
    for (const a of this.agents) a.visibleEnemies = [];
    for (const a of this.agents) {
      if (!a.alive) continue;
      // 섬광에 눈이 부시면 아무것도 못 봄
      if ((a.flashT ?? 0) > GEAR.flash.time * EFFECT.flashBlind) continue;
      // 문 밑 카메라를 쥐었으면 카메라 자리에서 넓게 봄
      const view = a.mirror ? this.doors.mirrorView(a) : null;
      const eye = view ? view.pos : eyePos(a);
      const lookYaw = view ? view.yaw : a.yaw;
      const fx = -Math.sin(lookYaw), fz = -Math.cos(lookYaw);
      const fovCos = view ? MIRROR.fov : 0.4;
      for (const e of this.agents) {
        if (!e.alive || e.team === a.team) continue;
        const ch = chestPos(e);
        const dx = ch.x - eye.x, dz = ch.z - eye.z;
        const d = Math.hypot(dx, dz);
        // 멀리서 앉아 멈춰 있는 적은 어둠 속에서 잘 안 보임
        const still = Math.hypot(e.vel.x, e.vel.z) < 0.5 && e.crouch > 0.5;
        if (d > (still ? maxSight * 0.55 : maxSight)) continue;
        if (d > 3 && (dx * fx + dz * fz) / d < fovCos) continue;
        if (view && d > MIRROR.range) continue;
        if (!this.clearLine(eye, eyePos(e)) && !this.clearLine(eye, ch)) continue;
        a.visibleEnemies.push(e.id);
        e.spottedT = this.time;
      }
    }
  }

  // ───────────────────────── 승패 ─────────────────────────
  checkEnd() {
    if (this.op) return this.op.checkEnd();
    const done = (side, reason) => (this.rounds ? this.endRound(side, reason) : this.end(this.squadOf(side), reason));
    if (this.bombs.every((b) => b.state === 'defused')) return done(TEAMS.DEFUSE, '폭탄 2기 해체 완료');
    if (this.alive(TEAMS.DEFUSE).length === 0) return done(TEAMS.FORCE, '해체팀 전원 제압');
    // 포스팀을 모두 쓰러뜨려도 끝나지 않음: 남은 폭탄을 시간 안에 해체해야 이김 (못 하면 폭발 → 포스팀 승리)
    if (this.rounds && !this.forceWiped && this.alive(TEAMS.FORCE).length === 0) {
      this.forceWiped = true;
      this.emit('forceWiped', { left: this.bombs.filter((b) => b.state === 'armed').length, timeLeft: this.timeLeft });
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      for (const b of this.bombs) if (b.state === 'armed') b.state = 'exploded';
      this.emit('explode', { bombs: this.bombs.filter((b) => b.state === 'exploded') });
      return done(TEAMS.FORCE, '제한 시간 종료 — 폭탄 폭발');
    }
    return null;
  }

  end(winner, reason) {
    this.phase = 'ended';
    this.winner = winner;
    this.reason = reason;
    this.endT = 0;
    for (const a of this.agents) if (a.lockpick) this.cancelLockpick(a, 'end');
    this.emit('matchEnd', { winner, reason, score: { ...this.score } });
    return winner;
  }
}
