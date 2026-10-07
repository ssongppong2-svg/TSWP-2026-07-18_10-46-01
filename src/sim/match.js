import { Emitter } from '../core/events.js';
import { createRng } from '../core/rng.js';
import { clamp, copy, dirFromAngles, dist, scale, segmentAabb, segmentSphere } from '../core/vec.js';
import { bodyTop, chestPos, createAgent, emptyIntent, eyePos, stepMovement } from './agent.js';
import {
  BOMB, BOT_NAMES, NOISE, PLAYER, PRE_ROUND_TIME, PROJECTILE, ROUND_TIME, TEAM_SIZE, TEAMS, ULT,
} from './constants.js';
import { PATCHES, WEAPONS } from './data.js';
import { CARD_COUNT, generatePuzzle, isSolved } from './lockpick.js';
import { GameMap } from './map.js';
import { NavGrid } from './nav.js';

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

export class Match {
  constructor({ map = null, mapId = undefined, playerTeam = null, playerName = '나', loadouts = new Map(), seed = Date.now() } = {}) {
    this.map = map ?? new GameMap(mapId);
    this.nav = new NavGrid(this.map);
    this.rng = createRng(seed);
    this.events = new Emitter();
    this.playerTeam = playerTeam;
    this.agents = [];
    this.controllers = new Map();
    this.projectiles = [];
    this.veils = [];
    this.zones = [];
    this.shields = [];
    this.noises = []; // 최근 소리 (봇의 청각·무게 감지기·무전 보고에 사용)
    this.scans = []; // 작동 중인 무게 감지기
    this.orders = { defuse: null, force: null }; // 팀 지휘 명령
    this.intel = { defuse: [], force: [] }; // 무전으로 공유된 소리 정보
    this.nextId = 1;
    this.time = 0;
    this.liveAt = PRE_ROUND_TIME;
    this.phase = 'prestart';
    this.phaseT = PRE_ROUND_TIME;
    this.timeLeft = ROUND_TIME;
    this.winner = null;
    this.reason = '';
    this.endT = 0;
    this.visT = 0;
    this.warned = new Set();
    this.forceWipedSent = false;
    this.bombs = this.map.bombs.map((b) => ({ id: b.id, x: b.x, y: 0, z: b.z, state: 'armed', picker: null, progress: 0, alertT: -99 }));

    const roster = makeRoster(playerTeam, playerName);
    for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) {
      const members = roster.filter((m) => m.team === team);
      const spawns = this.map.spawns[team];
      members.forEach((m, i) => {
        const s = spawns[Math.round((i * (spawns.length - 1)) / Math.max(1, members.length - 1))];
        const spawn = { x: s.x + this.rng.range(-0.3, 0.3), z: s.z + this.rng.range(-0.3, 0.3) };
        this.agents.push(
          createAgent({
            ...m,
            spawn,
            yaw: team === TEAMS.FORCE ? Math.PI : 0,
            loadout: loadouts.get(m.id) ?? [],
          }),
        );
      });
    }
    this.byId = new Map(this.agents.map((a) => [a.id, a]));
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
  tick(dt) {
    this.time += dt;
    if (this.phase === 'ended') {
      this.endT += dt;
      this.updateVeils(dt);
      this.updateShields(dt);
      this.updateProjectiles(dt);
      return;
    }
    if (this.phase === 'prestart') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'live';
        this.liveAt = this.time;
        this.emit('roundStart', {});
      }
    }
    const live = this.phase === 'live';

    this.updateZones(dt);
    for (const a of this.agents) {
      if (!a.alive) {
        a.deadT += dt;
        stepMovement(a, emptyIntent(a), this.map, dt, false);
        continue;
      }
      const ctrl = this.controllers.get(a.id);
      const intent = ctrl ? ctrl.getIntent(this, a, dt) : emptyIntent(a);
      this.stepAgent(a, intent, dt, live);
    }
    this.separateAgents();
    this.updateVeils(dt);
    this.updateShields(dt);
    this.updateProjectiles(dt);
    this.updateVisibility(dt);
    this.noises = this.noises.filter((n) => this.time - n.t < NOISE.memory);
    this.scans = this.scans.filter((s) => s.until > this.time);
    for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) this.intel[team] = this.intel[team].filter((i) => this.time - i.t < 8);

    if (live) {
      this.timeLeft -= dt;
      for (const w of [60, 30, 10]) {
        if (this.timeLeft <= w && !this.warned.has(w)) {
          this.warned.add(w);
          this.emit('timeWarning', { left: w });
        }
      }
      this.checkEnd();
    }
  }

  stepAgent(a, intent, dt, live) {
    a.yaw = intent.yaw;
    a.pitch = clamp(intent.pitch, -1.45, 1.45);
    for (const p of a.patches) {
      if (!p) continue;
      if (p.cd > 0) p.cd = Math.max(0, p.cd - dt);
      if (p.activeT > 0) p.activeT = Math.max(0, p.activeT - dt);
    }
    if (a.ampT > 0) a.ampT = Math.max(0, a.ampT - dt);
    if (a.bounceT > 0) a.bounceT = Math.max(0, a.bounceT - dt);
    if (a.tagT > 0) a.tagT = Math.max(0, a.tagT - dt);
    a.punch *= Math.exp(-dt * 8);
    if (live) a.ult = Math.min(ULT.max, a.ult + ULT.perSecond * dt);

    const canAct = live && !a.held;
    if (intent.command && live) this.issueCommand(a, intent.command);
    if (live) {
      if (a.lockpick) this.stepLockpick(a, intent, dt);
      else if (intent.interact && canAct) this.tryStartLockpick(a);
      if (canAct && !a.lockpick) {
        intent.patch.forEach((pressed, i) => {
          if (pressed) this.usePatch(a, i);
        });
      }
    }
    // 정조준: 총을 들고 있고 재장전·교체 중이 아닐 때만
    const w = WEAPONS[a.weapon];
    a.ads = live && !!intent.ads && !w.melee && !a.lockpick && !a.held && a.reloadT <= 0 && a.swapT <= 0;
    a.adsT = clamp(a.adsT + (a.ads ? 1 : -1) * dt * 7, 0, 1);
    this.stepWeapon(a, intent, dt, live && !a.lockpick);

    const wasGround = a.onGround;
    const vy = a.vel.y;
    stepMovement(a, intent, this.map, dt, live && !a.lockpick);
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

  // ───────────────────────── 소리 ─────────────────────────
  // 소리를 남김: 적 봇은 들을 수 있는 거리 안이면 듣고, 무게 감지기는 발걸음·총성을 탐지
  makeNoise(a, kind, at = null) {
    const loudKinds = kind === 'rifle' || kind === 'pistol';
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
    let point = null;
    if (cmd.type === 'move') point = this.aimPoint(a, 45);
    else if (cmd.type === 'regroup' || cmd.type === 'hold') point = { x: a.pos.x, y: a.pos.y, z: a.pos.z };
    const order = cmd.type === 'free' ? null : { id: this.nextId++, type: cmd.type, point, issuerId: a.id, t: this.time, yaw: a.yaw };
    this.orders[a.team] = order;
    this.emit('command', { agent: a, team: a.team, type: cmd.type, order });
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
    const ws = a.weapons[a.weapon];
    a.fireCd = Math.max(0, a.fireCd - dt);
    a.meleeCd = Math.max(0, a.meleeCd - dt);
    a.sinceShot += dt;
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

    if (intent.switchTo && intent.switchTo !== a.weapon && WEAPONS[intent.switchTo] && !a.lockpick) {
      a.weapon = intent.switchTo;
      a.swapT = WEAPONS[a.weapon].draw;
      a.reloadT = 0;
      a.bloom = 0;
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
      this.makeNoise(a, 'reload');
      this.emit('reload', { agent: a, weapon: w.id });
    };
    if ((intent.reload && ws.mag < w.magSize && ws.reserve > 0) || (ws.mag === 0 && ws.reserve > 0 && a.fireCd <= 0)) {
      if (!a.lockpick) startReload();
      a.triggerLatch = intent.fire;
      return;
    }
    const pressed = intent.fire && !a.triggerLatch;
    const want = w.auto ? intent.fire : pressed;
    a.triggerLatch = intent.fire;
    if (!want || !canFire || a.fireCd > 0) return;
    if (ws.mag <= 0) {
      if (pressed) this.emit('dryFire', { agent: a });
      return;
    }
    this.fire(a, w, ws);
  }

  fire(a, w, ws) {
    ws.mag--;
    a.fireCd = 60 / w.rpm;
    if (a.sinceShot > 0.4) a.sprayIndex = 0;
    a.sinceShot = 0;
    const moving = Math.hypot(a.vel.x, a.vel.z) > 1.2;
    let spread = w.spreadBase + a.bloom + (moving ? w.spreadMove : 0) + (!a.onGround ? w.spreadAir : 0);
    spread *= (1 + (w.adsSpread - 1) * a.adsT) * (1 + (w.crouchSpread - 1) * a.crouch);
    if (a.held) spread += w.spreadMove * 0.5;
    const dir = spreadDir(dirFromAngles(a.yaw + a.recoilYaw, a.pitch + a.recoil + a.punch), spread, this.rng);
    const amp = w.id === 'rifle' && a.ampT > 0;
    const damage = w.damage + (amp ? PATCHES.resultantAmp.bonus : 0);
    const origin = eyePos(a);
    const p = {
      id: this.nextId++,
      ownerId: a.id,
      team: a.team,
      weapon: w.id,
      damage,
      amp,
      bounces: a.bounceT > 0 ? 1 : 0,
      pos: origin,
      prev: copy(origin),
      vel: scale(dir, w.speed),
      life: PROJECTILE.life,
      harmless: false,
      inVeil: false,
    };
    this.projectiles.push(p);
    // 연사 반동 패턴 (정조준·앉기 중에는 줄어듦)
    const i = a.sprayIndex++;
    const rm = (1 + (w.adsRecoil - 1) * a.adsT) * (a.crouch > 0.5 ? 0.85 : 1);
    a.recoil = Math.min(w.recoilMax, a.recoil + w.recoilPitch[Math.min(i, w.recoilPitch.length - 1)] * rm);
    const yawKick = w.recoilYaw[i % w.recoilYaw.length] + (this.rng.next() * 2 - 1) * (w.recoilYawRand ?? 0);
    a.recoilYaw = clamp(a.recoilYaw + yawKick * rm, -w.recoilYawMax, w.recoilYawMax);
    a.bloom = Math.min(w.bloomMax, a.bloom + w.bloomPerShot);
    this.makeNoise(a, w.id);
    this.emit('shot', { agent: a, weapon: w.id, origin, dir, amp, projectile: p });
  }

  melee(a, heavy) {
    const w = WEAPONS.knife;
    const m = heavy ? w.heavy : w.light;
    a.meleeCd = m.rate;
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
    this.applyDamage(best, m.damage * (backstab ? w.backstabMult : 1), a, { weapon: 'knife', pos: chestPos(best), backstab });
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
      if (!p.harmless) {
        for (const a of this.agents) {
          if (!a.alive || a.team === p.team) continue;
          const th = segmentSphere(p.pos, next, eyePos(a), PLAYER.headRadius);
          if (th >= 0 && th < tHit) {
            tHit = th;
            target = a;
            head = true;
            shield = null;
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
          }
        }
      }
      const at = (t) => ({ x: p.pos.x + (next.x - p.pos.x) * t, y: p.pos.y + (next.y - p.pos.y) * t, z: p.pos.z + (next.z - p.pos.z) * t });
      if (target) {
        const hitPos = at(tHit);
        const owner = this.agentById(p.ownerId);
        const mult = head ? WEAPONS[p.weapon].headMult : 1;
        this.emit('impact', { ...hitPos, kind: 'flesh', projectile: p, headshot: head });
        this.applyDamage(target, p.damage * mult, owner, { headshot: head, weapon: p.weapon, pos: hitPos });
        continue;
      }
      if (shield) {
        const hp = at(tHit);
        if (!p.harmless) shield.hp -= p.damage;
        this.emit('impact', { ...hp, nx: -Math.sin(shield.yaw), ny: 0, nz: -Math.cos(shield.yaw), kind: 'shield', projectile: p });
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

  applyDamage(t, amount, attacker, { headshot = false, weapon = null, pos = null, backstab = false } = {}) {
    if (!t.alive || this.phase === 'ended') return;
    amount = Math.round(amount);
    const dealt = Math.min(t.hp, amount);
    t.hp -= amount;
    t.lastHurtT = this.time;
    t.lastHurtBy = attacker?.id ?? null;
    // 피격 반응: 조준이 위로 튀고 잠깐 느려짐
    t.tagT = PLAYER.tagTime;
    t.punch = Math.min(0.12, t.punch + (headshot ? 0.06 : 0.035));
    if (t.lockpick) this.cancelLockpick(t, 'hit');
    if (attacker) {
      attacker.stats.damage += dealt;
      attacker.ult = Math.min(ULT.max, attacker.ult + dealt * ULT.perDamage);
      if (headshot) attacker.stats.headshots++;
    }
    const killed = t.hp <= 0;
    this.emit('hit', { target: t, attacker, amount: dealt, headshot, killed, weapon, pos, backstab });
    if (killed) this.kill(t, attacker, { headshot, weapon });
  }

  kill(t, attacker, { headshot = false, weapon = null } = {}) {
    t.alive = false;
    t.hp = 0;
    t.deadT = 0;
    t.held = null;
    t.slippery = false;
    t.mired = false;
    t.ads = false;
    t.stats.deaths++;
    if (t.lockpick) this.cancelLockpick(t, 'dead');
    if (attacker && attacker !== t) {
      attacker.stats.kills++;
      attacker.ult = Math.min(ULT.max, attacker.ult + ULT.perKill);
    }
    this.emit('kill', { victim: t, killer: attacker, headshot, weapon });
    if (!this.forceWipedSent && this.alive(TEAMS.FORCE).length === 0 && this.alive(TEAMS.DEFUSE).length > 0) {
      this.forceWipedSent = true;
      this.emit('forceWiped', {});
    }
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
          return this.map.walkable(c, r) && this.map.lineOfSight(eyePos(a), { x: a.pos.x + fx * dd, y: a.pos.y + 1, z: a.pos.z + fz * dd });
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
          if (n.team === a.team || this.time - n.t > 1 || !['step', 'land', 'rifle', 'pistol'].includes(n.kind)) continue;
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
    else p.cd = def.cooldown;
    a.stats.patchUses++;
    this.makeNoise(a, 'patch');
    this.emit('patch', payload);
    return true;
  }

  // 조준한 곳의 바닥 지점 (벽 너머·맵 밖으로 나가지 않게)
  aimPoint(a, range) {
    const eye = eyePos(a);
    const d = dirFromAngles(a.yaw, a.pitch);
    const end = { x: eye.x + d.x * range, y: eye.y + d.y * range, z: eye.z + d.z * range };
    const hit = this.map.raycast(eye, end);
    let p = hit ? { x: hit.x, y: hit.y, z: hit.z } : end;
    if (hit && hit.ny === 0) {
      p.x += hit.nx * 0.6;
      p.z += hit.nz * 0.6;
    }
    const valid = (q) => {
      const { c, r } = this.map.toCell(q.x, q.z);
      const h = this.map.heightAt(c, r);
      return h < 4 && h <= Math.max(q.y, 0) + 0.05;
    };
    if (!valid(p)) {
      const steps = Math.ceil(dist(eye, p));
      for (let i = steps; i >= 0; i--) {
        const q = { x: eye.x + (p.x - eye.x) * (i / steps), y: eye.y + (p.y - eye.y) * (i / steps), z: eye.z + (p.z - eye.z) * (i / steps) };
        if (valid(q)) {
          p = q;
          break;
        }
        if (i === 0) p = { x: a.pos.x, y: a.pos.y, z: a.pos.z };
      }
    }
    const { c, r } = this.map.toCell(p.x, p.z);
    const h = this.map.heightAt(c, r);
    const y = h <= Math.max(p.y, 0) + 0.05 ? h : 0;
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
    return true;
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
    a.lockpick = a.isPlayer
      ? { bombId: bomb.id, kind: 'puzzle', puzzle: generatePuzzle(this.rng), selected: Array(CARD_COUNT).fill(false), turnT: 0 }
      : { bombId: bomb.id, kind: 'timed', t: 0, need: this.rng.range(BOMB.botTimeMin, BOMB.botTimeMax) };
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
        bomb.progress = Math.min(1, lp.turnT / BOMB.turnTime);
        if (lp.turnT >= BOMB.turnTime) this.defuse(a, bomb);
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
    bomb.state = 'defused';
    bomb.picker = null;
    bomb.progress = 1;
    a.lockpick = null;
    a.stats.defuses++;
    a.ult = Math.min(ULT.max, a.ult + ULT.perDefuse);
    this.emit('lockpickEnd', { agent: a, bomb, reason: 'done' });
    this.emit('bombDefused', { agent: a, bomb });
  }

  // ───────────────────────── 시야 (봇 판단용) ─────────────────────────
  // 각자 자기 눈으로 본 적만 안다 (팀 공유 없음). 비 오는 밤에는 멀리 못 봄.
  updateVisibility(dt) {
    this.visT -= dt;
    if (this.visT > 0) return;
    this.visT = 0.15;
    const maxSight = this.map.weather === 'rain' ? 36 : 60;
    for (const a of this.agents) a.visibleEnemies = [];
    for (const a of this.agents) {
      if (!a.alive) continue;
      const eye = eyePos(a);
      const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
      for (const e of this.agents) {
        if (!e.alive || e.team === a.team) continue;
        const ch = chestPos(e);
        const dx = ch.x - eye.x, dz = ch.z - eye.z;
        const d = Math.hypot(dx, dz);
        // 멀리서 앉아 멈춰 있는 적은 어둠 속에서 잘 안 보임
        const still = Math.hypot(e.vel.x, e.vel.z) < 0.5 && e.crouch > 0.5;
        if (d > (still ? maxSight * 0.55 : maxSight)) continue;
        if (d > 3 && (dx * fx + dz * fz) / d < 0.4) continue;
        if (!this.clearLine(eye, eyePos(e)) && !this.clearLine(eye, ch)) continue;
        a.visibleEnemies.push(e.id);
        e.spottedT = this.time;
      }
    }
  }

  // ───────────────────────── 승패 ─────────────────────────
  checkEnd() {
    if (this.bombs.every((b) => b.state === 'defused')) return this.end(TEAMS.DEFUSE, '폭탄 2기 해체 완료.');
    if (this.alive(TEAMS.DEFUSE).length === 0) return this.end(TEAMS.FORCE, '해체팀 전원 제압.');
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      for (const b of this.bombs) if (b.state === 'armed') b.state = 'exploded';
      this.emit('explode', { bombs: this.bombs.filter((b) => b.state === 'exploded') });
      return this.end(TEAMS.FORCE, '제한 시간 종료 — 폭탄 폭발.');
    }
    return null;
  }

  end(winner, reason) {
    this.phase = 'ended';
    this.winner = winner;
    this.reason = reason;
    this.endT = 0;
    for (const a of this.agents) if (a.lockpick) this.cancelLockpick(a, 'end');
    this.emit('matchEnd', { winner, reason });
    return winner;
  }
}
