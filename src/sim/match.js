import { Emitter } from '../core/events.js';
import { createRng } from '../core/rng.js';
import { clamp, copy, dirFromAngles, dist, scale, segmentAabb, segmentSphere } from '../core/vec.js';
import { createAgent, emptyIntent, eyePos, chestPos, stepMovement } from './agent.js';
import {
  BOMB, BOT_NAMES, PLAYER, PRE_ROUND_TIME, PROJECTILE, ROUND_TIME, SWAP_TIME, TEAM_SIZE, TEAMS, ULT,
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

export class Match {
  constructor({ map = null, playerTeam = null, playerName = '나', loadouts = new Map(), seed = Date.now() } = {}) {
    this.map = map ?? new GameMap();
    this.nav = new NavGrid(this.map);
    this.rng = createRng(seed);
    this.events = new Emitter();
    this.playerTeam = playerTeam;
    this.agents = [];
    this.controllers = new Map();
    this.projectiles = [];
    this.veils = [];
    this.zones = [];
    this.noises = [];
    this.nextId = 1;
    this.time = 0;
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
      this.updateProjectiles(dt);
      return;
    }
    if (this.phase === 'prestart') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'live';
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
    this.updateProjectiles(dt);
    this.updateVisibility(dt);
    this.noises = this.noises.filter((n) => this.time - n.t < 1.2);

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
      if (p.cd > 0) p.cd = Math.max(0, p.cd - dt);
      if (p.activeT > 0) p.activeT = Math.max(0, p.activeT - dt);
    }
    if (a.ampT > 0) a.ampT = Math.max(0, a.ampT - dt);
    if (live) a.ult = Math.min(ULT.max, a.ult + ULT.perSecond * dt);

    const canAct = live && !a.held;
    if (live) {
      if (a.lockpick) this.stepLockpick(a, intent, dt);
      else if (intent.interact && canAct) this.tryStartLockpick(a);
      if (canAct && !a.lockpick) {
        intent.patch.forEach((pressed, i) => {
          if (pressed) this.usePatch(a, i);
        });
      }
    }
    this.stepWeapon(a, intent, dt, live && !a.lockpick);

    const wasGround = a.onGround;
    const vy = a.vel.y;
    stepMovement(a, intent, this.map, dt, live && !a.lockpick);
    if (wasGround && !a.onGround && a.vel.y > 1) this.emit('jump', { agent: a });
    if (!wasGround && a.onGround && vy < -4) this.emit('land', { agent: a, speed: -vy });
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
    let w = WEAPONS[a.weapon];
    let ws = a.weapons[a.weapon];
    a.fireCd = Math.max(0, a.fireCd - dt);
    a.sinceShot += dt;
    a.bloom = Math.max(0, a.bloom - w.bloomRecover * dt);
    if (a.sinceShot > 0.12) a.recoil = Math.max(0, a.recoil - w.recoilRecover * dt);

    if (intent.switchTo && intent.switchTo !== a.weapon && WEAPONS[intent.switchTo] && !a.lockpick) {
      a.weapon = intent.switchTo;
      a.swapT = SWAP_TIME;
      a.reloadT = 0;
      a.bloom = 0;
      a.triggerLatch = intent.fire;
      this.emit('swap', { agent: a, weapon: a.weapon });
      return;
    }
    if (a.swapT > 0) {
      a.swapT = Math.max(0, a.swapT - dt);
      a.triggerLatch = intent.fire;
      return;
    }
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
    a.sinceShot = 0;
    const moving = Math.hypot(a.vel.x, a.vel.z) > 1.2;
    let spread = w.spreadBase + a.bloom + (moving ? w.spreadMove : 0) + (!a.onGround ? w.spreadAir : 0);
    if (a.held) spread += w.spreadMove * 0.5;
    const dir = spreadDir(dirFromAngles(a.yaw, a.pitch + a.recoil), spread, this.rng);
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
      pos: origin,
      prev: copy(origin),
      vel: scale(dir, w.speed),
      life: PROJECTILE.life,
      harmless: false,
      inVeil: false,
    };
    this.projectiles.push(p);
    a.bloom = Math.min(w.bloomMax, a.bloom + w.bloomPerShot);
    a.recoil = Math.min(w.recoilMax, a.recoil + w.recoilKick);
    this.noises.push({ x: a.pos.x, z: a.pos.z, team: a.team, agentId: a.id, t: this.time });
    this.emit('shot', { agent: a, weapon: w.id, origin, dir, amp, projectile: p });
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
      let target = null, head = false;
      if (!p.harmless) {
        for (const a of this.agents) {
          if (!a.alive || a.team === p.team) continue;
          const hc = { x: a.pos.x, y: a.pos.y + PLAYER.headY, z: a.pos.z };
          const th = segmentSphere(p.pos, next, hc, PLAYER.headRadius);
          if (th >= 0 && th < tHit) {
            tHit = th;
            target = a;
            head = true;
          }
          const tb = segmentAabb(
            p.pos,
            next,
            { x: a.pos.x - PLAYER.bodyHalf, y: a.pos.y, z: a.pos.z - PLAYER.bodyHalf },
            { x: a.pos.x + PLAYER.bodyHalf, y: a.pos.y + PLAYER.bodyTop, z: a.pos.z + PLAYER.bodyHalf },
          );
          if (tb >= 0 && tb < tHit) {
            tHit = tb;
            target = a;
            head = false;
          }
        }
      }
      if (target) {
        const hitPos = {
          x: p.pos.x + (next.x - p.pos.x) * tHit,
          y: p.pos.y + (next.y - p.pos.y) * tHit,
          z: p.pos.z + (next.z - p.pos.z) * tHit,
        };
        const owner = this.agentById(p.ownerId);
        const mult = head ? WEAPONS[p.weapon].headMult : 1;
        this.emit('impact', { ...hitPos, kind: 'flesh', projectile: p });
        this.applyDamage(target, p.damage * mult, owner, { headshot: head, weapon: p.weapon, pos: hitPos });
        continue;
      }
      if (mh) {
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

  applyDamage(t, amount, attacker, { headshot = false, weapon = null, pos = null } = {}) {
    if (!t.alive || this.phase === 'ended') return;
    amount = Math.round(amount);
    const dealt = Math.min(t.hp, amount);
    t.hp -= amount;
    t.lastHurtT = this.time;
    t.lastHurtBy = attacker?.id ?? null;
    if (t.lockpick) this.cancelLockpick(t, 'hit');
    if (attacker) {
      attacker.stats.damage += dealt;
      attacker.ult = Math.min(ULT.max, attacker.ult + dealt * ULT.perDamage);
      if (headshot) attacker.stats.headshots++;
    }
    const killed = t.hp <= 0;
    this.emit('hit', { target: t, attacker, amount: dealt, headshot, killed, weapon, pos });
    if (killed) this.kill(t, attacker, { headshot, weapon });
  }

  kill(t, attacker, { headshot = false, weapon = null } = {}) {
    t.alive = false;
    t.hp = 0;
    t.deadT = 0;
    t.held = null;
    t.slippery = false;
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

  updateZones(dt) {
    for (const a of this.agents) a.slippery = false;
    const keep = [];
    for (const z of this.zones) {
      z.t -= dt;
      z.age += dt;
      if (z.type === 'friction') {
        for (const a of this.agents) {
          if (!a.alive || a.team === z.team || !a.onGround) continue;
          if (Math.hypot(a.pos.x - z.x, a.pos.z - z.z) <= z.radius && Math.abs(a.pos.y - z.y) < 0.6) a.slippery = true;
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

  // ───────────────────────── 시야 (미니맵·봇 공용) ─────────────────────────
  updateVisibility(dt) {
    this.visT -= dt;
    if (this.visT > 0) return;
    this.visT = 0.15;
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
        if (d > 80) continue;
        if (d > 3 && (dx * fx + dz * fz) / d < 0.3) continue;
        const head = { x: e.pos.x, y: e.pos.y + PLAYER.headY, z: e.pos.z };
        if (!this.map.lineOfSight(eye, head) && !this.map.lineOfSight(eye, ch)) continue;
        a.visibleEnemies.push(e.id);
        e.spottedT = this.time;
        e.spottedPos = copy(e.pos);
      }
    }
  }

  // ───────────────────────── 승패 ─────────────────────────
  checkEnd() {
    if (this.bombs.every((b) => b.state === 'defused')) return this.end(TEAMS.DEFUSE, '폭탄 2개를 모두 해체했어요!');
    if (this.alive(TEAMS.DEFUSE).length === 0) return this.end(TEAMS.FORCE, '해체팀이 모두 쓰러졌어요!');
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      for (const b of this.bombs) if (b.state === 'armed') b.state = 'exploded';
      this.emit('explode', { bombs: this.bombs.filter((b) => b.state === 'exploded') });
      return this.end(TEAMS.FORCE, '2분이 지나 폭탄이 터졌어요!');
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
