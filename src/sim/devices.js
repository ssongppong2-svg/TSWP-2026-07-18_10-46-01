// 맵 장치: 힘의 원리로 움직이는 장치들. 맵 정의(devices)에 놓이고, 경기(match)가 매 틱 움직인다.
//   pad   탄성 발판 — 밟으면 용수철의 탄성력으로 정해진 곳(보통 2층)까지 튕겨 올림
//   lift  승강기 — 1층 ↔ 2층을 오르내리는 바닥판 (과학관: 부력 승강기, 공장: 도르래 승강기)
//   gate  지레 셔터 — 지렛대(F)로 무거운 셔터를 내리고 올림 (양 팀 모두 사용)
//   slide 마찰 미끄럼틀 — 마찰력이 거의 없는 경사로: 빨리 내려가지만 거슬러 오를 수 없음
//   crate 미는 상자 — 같은 방향으로 미는 사람이 많을수록(합력) 빨리 한 칸씩 밀림. 반대로 밀면 힘이 상쇄됨
import { CELL, PLAYER } from './constants.js';
import { STORY, SLAB, KIND } from './map.js';


export const DEVICE_INFO = {
  pad: { name: '탄성 발판', topic: 'elastic', line: '늘어나거나 줄어든 용수철이 되돌아가려는 힘(탄성력)이 몸을 튕겨 올린다.' },
  lift: { name: '승강기', topic: 'buoyancy', line: '물에 잠긴 부피만큼 위로 미는 힘(부력)이 바닥판을 띄워 올린다.' },
  pulley: { name: '도르래 승강기', topic: 'weight', line: '반대편 추의 무게(중력)가 줄을 당겨 바닥판을 끌어올린다.' },
  gate: { name: '지레 셔터', topic: 'equilibrium', line: '받침점에서 먼 곳에 작은 힘을 주면 무거운 셔터와 평형을 이루며 움직인다.' },
  slide: { name: '마찰 미끄럼틀', topic: 'friction', line: '마찰력이 거의 없어 빠르게 미끄러져 내려가지만 거슬러 오를 수는 없다.' },
  crate: { name: '미는 상자', topic: 'resultant', line: '같은 방향으로 미는 힘은 더해지고(합력) 반대 방향은 빼진다. 합력이 마찰력보다 커야 움직인다.' },
};

export const LIFT = { speed: 1.25, wait: 2.6 };
export const GATE = { moveTime: 0.7, cooldown: 2.5, leverRange: 1.9 };
export const SLIDE = { accel: 11, maxSpeed: 12, control: 2.2 };
// 미는 상자: 한 사람이 한 칸 미는 데 걸리는 시간(초) · 높이 · 미끄러져 옮겨 가는 시간
export const CRATE = { pushTime: 1.4, h: 1.0, moveTime: 0.35 };
const PAD_FLIGHT = 0.95; // 탄성 발판 비행 시간(초)

export class Devices {
  constructor(match) {
    this.match = match;
    this.map = match.map;
    this.list = this.map.devices.map((d) => ({ ...d, levers: d.levers ?? (d.lever ? [d.lever] : []), st: {} }));
    this.reset();
  }

  // 라운드 시작: 셔터는 처음 상태로, 승강기는 1층에서 대기
  reset() {
    for (const d of this.list) {
      if (d.type === 'gate') {
        d.st = { closed: d.open === false, t: 1, cd: 0, pending: null };
        this.applyGate(d);
      } else if (d.type === 'lift') {
        d.st = { y: 0, dir: 1, wait: LIFT.wait };
        this.applyLift(d);
      } else if (d.type === 'pad') {
        d.st = { t: 9 };
      } else if (d.type === 'crate') {
        if (d.st?.r != null) this.map.setDynamic(d.st.c, d.st.r, null);
        d.st = { r: d.r, c: d.c, fromR: d.r, fromC: d.c, t: 1, push: 0, dir: null, pushers: 0 };
        this.map.setDynamic(d.c, d.r, [0, CRATE.h, KIND.push]);
      }
    }
  }

  get gates() {
    return this.list.filter((d) => d.type === 'gate');
  }

  get lifts() {
    return this.list.filter((d) => d.type === 'lift');
  }

  applyGate(d) {
    const closedNow = d.st.closed && d.st.t >= 1;
    for (const [r, c] of d.cells) this.map.setDynamic(c, r, closedNow ? [0, STORY - SLAB, KIND.gate] : null);
  }

  // 승강기는 바닥에서 바닥판까지 꽉 찬 기둥으로 오르내림 (아래로 들어가 끼일 일이 없음)
  applyLift(d) {
    const y = d.st.y;
    this.map.setDynamic(d.c, d.r, y > 0.02 ? [0, y, KIND.lift] : null);
  }

  // 칸 위·안에 있는 요원 (반지름 포함)
  agentsInCell(c, r, y0 = -1, y1 = 99) {
    const m = this.map;
    const x0 = m.originX + c * CELL - PLAYER.radius, x1 = x0 + CELL + PLAYER.radius * 2;
    const z0 = m.originZ + r * CELL - PLAYER.radius, z1 = z0 + CELL + PLAYER.radius * 2;
    return this.match.agents.filter((a) => a.alive && a.pos.x > x0 && a.pos.x < x1 && a.pos.z > z0 && a.pos.z < z1 && a.pos.y + 1.8 > y0 && a.pos.y < y1);
  }

  update(dt) {
    const match = this.match;
    for (const d of this.list) {
      const st = d.st;
      if (d.type === 'gate') {
        if (st.cd > 0) st.cd -= dt;
        if (st.t < 1) {
          // 닫히는 중에 문간에 누가 있으면 멈췄다가 비면 마저 닫힘
          if (st.closed && st.t > 0.6 && d.cells.some(([r, c]) => this.agentsInCell(c, r, 0, STORY - SLAB).length)) continue;
          st.t = Math.min(1, st.t + dt / GATE.moveTime);
          if (st.t >= 1) {
            this.applyGate(d);
            match.emit('gate', { device: d, closed: st.closed, done: true });
          }
        }
      } else if (d.type === 'lift') {
        if (st.wait > 0) {
          st.wait -= dt;
          continue;
        }
        const next = st.y + st.dir * LIFT.speed * dt;
        st.y = Math.max(0, Math.min(STORY, next));
        if (st.y >= STORY || st.y <= 0) {
          st.dir = st.y >= STORY ? -1 : 1;
          st.wait = LIFT.wait;
          match.emit('lift', { device: d, at: st.y >= STORY ? 'top' : 'bottom' });
        }
        this.applyLift(d);
      } else if (d.type === 'crate') {
        this.updateCrate(d, dt);
      } else if (d.type === 'pad') {
        st.t += dt;
        for (const a of this.agentsInCell(d.c, d.r, -1, (d.f ? STORY : 0) + 0.3)) {
          if (!a.onGround || (a.padT ?? 0) > match.time) continue;
          const cx = this.map.cellX(d.c), cz = this.map.cellZ(d.r);
          if (Math.hypot(a.pos.x - cx, a.pos.z - cz) > CELL * 0.45) continue;
          this.launch(a, d);
        }
      }
    }
  }

  // 미는 상자: 상자 면에 붙어서 그쪽으로 걸으려는 요원 수만큼 힘이 더해짐 (반대쪽은 빼짐)
  updateCrate(d, dt) {
    const st = d.st;
    if (st.t < 1) st.t = Math.min(1, st.t + dt / CRATE.moveTime);
    const m = this.map;
    const x0 = m.originX + st.c * CELL, x1 = x0 + CELL, z0 = m.originZ + st.r * CELL, z1 = z0 + CELL;
    const R = PLAYER.radius + 0.08;
    const net = { x: 0, z: 0 };
    let pushers = 0;
    if (st.t >= 1) {
      for (const a of this.match.agents) {
        if (!a.alive || !a.onGround || a.pos.y > 0.3 || !a.wish || a.lockpick || a.held) continue;
        const w = a.wish;
        if (Math.hypot(w.x, w.z) < 0.5) continue;
        const inZ = a.pos.z > z0 + 0.15 && a.pos.z < z1 - 0.15, inX = a.pos.x > x0 + 0.15 && a.pos.x < x1 - 0.15;
        // 상자의 어느 면에 붙어 있는지 → 그 면을 미는 방향 (서쪽 면에서 동쪽으로 밀면 +x …)
        let push = null;
        if (inZ && a.pos.x < x0 && x0 - a.pos.x < R && w.x > 0.7) push = ['x', 1];
        else if (inZ && a.pos.x > x1 && a.pos.x - x1 < R && w.x < -0.7) push = ['x', -1];
        else if (inX && a.pos.z < z0 && z0 - a.pos.z < R && w.z > 0.7) push = ['z', 1];
        else if (inX && a.pos.z > z1 && a.pos.z - z1 < R && w.z < -0.7) push = ['z', -1];
        if (!push) continue;
        net[push[0]] += push[1];
        pushers++;
      }
    }
    st.pushers = pushers;
    // 합력이 가장 큰 축으로만 밀림 (같은 축 반대 방향은 상쇄)
    const ax = Math.abs(net.x) >= Math.abs(net.z) ? 'x' : 'z';
    const f = net[ax];
    const dir = f === 0 ? null : ax === 'x' ? [Math.sign(f), 0] : [0, Math.sign(f)];
    if (!dir || (st.dir && (st.dir[0] !== dir[0] || st.dir[1] !== dir[1]))) st.push = Math.max(0, st.push - dt * 1.5);
    if (dir) {
      st.dir = dir;
      st.push += (Math.abs(f) * dt) / CRATE.pushTime;
      st.force = Math.abs(f);
      if (st.push >= 1) {
        st.push = 0;
        const nc = st.c + dir[0], nr = st.r + dir[1];
        if (this.crateFree(nc, nr)) {
          m.setDynamic(st.c, st.r, null);
          st.fromR = st.r;
          st.fromC = st.c;
          st.r = nr;
          st.c = nc;
          st.t = 0;
          m.setDynamic(nc, nr, [0, CRATE.h, KIND.push]);
          this.match.emit('cratePush', { device: d, force: Math.abs(f) });
        } else {
          this.match.emit('crateBlocked', { device: d });
        }
      }
    } else st.force = 0;
  }

  // 상자를 옮길 수 있는 칸: 1층 빈 바닥 (계단·장치·폭탄·다른 상자·사람이 없는 곳)
  crateFree(c, r) {
    const m = this.map;
    if (!m.inBounds(c, r) || !m.walkable(c, r) || m.dyn.has(m.idx(c, r))) return false;
    if (m.isLift(c, r) || m.isSlide(c, r)) return false;
    if (this.list.some((d) => d.type === 'pad' && d.r === r && d.c === c)) return false;
    if (this.match.bombs?.some((b) => (b.y ?? 0) < 1 && m.toCell(b.x, b.z).c === c && m.toCell(b.x, b.z).r === r)) return false;
    return this.agentsInCell(c, r, -1, CRATE.h + 0.5).length === 0;
  }

  // 탄성 발판: 목표 칸 가운데에 PAD_FLIGHT초 뒤 내려앉는 포물선 속도
  launch(a, d) {
    const m = this.map;
    const tx = m.cellX(d.to.c), tz = m.cellZ(d.to.r), ty = (d.to.f ? STORY : 0) + 0.2;
    const T = PAD_FLIGHT, g = PLAYER.gravity;
    a.vel.x = (tx - a.pos.x) / T;
    a.vel.z = (tz - a.pos.z) / T;
    a.vel.y = (ty - a.pos.y + 0.5 * g * T * T) / T;
    a.onGround = false;
    a.padT = this.match.time + 0.8;
    d.st.t = 0;
    this.match.emit('padLaunch', { device: d, agent: a });
  }

  // 그 요원 가까이 있는 지렛대 { d, lever } (셔터마다 지렛대가 안팎에 하나씩 있을 수 있음)
  leverAt(a) {
    for (const d of this.gates) {
      for (const lever of d.levers) {
        const lx = this.map.cellX(lever.c), lz = this.map.cellZ(lever.r);
        if (Math.hypot(a.pos.x - lx, a.pos.z - lz) <= GATE.leverRange && Math.abs(a.pos.y - (lever.f ? STORY : 0)) <= 1.2) return { d, lever, x: lx, z: lz };
      }
    }
    return null;
  }

  // 지렛대 사용 (F): 가까운 지렛대가 있으면 셔터를 올리거나 내림. 처리했으면 true
  tryUse(a) {
    const hit = this.leverAt(a);
    if (hit) {
      const { d, x: lx, z: lz } = hit;
      const st = d.st;
      if (st.cd > 0 || st.t < 1) return true;
      st.closed = !st.closed;
      st.t = 0;
      st.cd = GATE.cooldown;
      if (!st.closed) this.applyGate(d); // 올리기 시작하면 바로 지나갈 수 있음
      this.match.emit('gate', { device: d, closed: st.closed, by: a });
      this.match.makeNoise?.(a, 'lockpick', { x: lx, y: a.pos.y, z: lz });
      return true;
    }
    return false;
  }

  // 온라인: 상태 압축 / 복원
  pack() {
    const r2 = (v) => Math.round(v * 100) / 100;
    return this.list.map((d) => {
      const st = d.st;
      if (d.type === 'gate') return [st.closed ? 1 : 0, r2(st.t)];
      if (d.type === 'lift') return [r2(st.y), st.dir];
      if (d.type === 'pad') return [r2(Math.min(9, st.t))];
      if (d.type === 'crate') return [st.r, st.c, st.fromR, st.fromC, r2(st.t), r2(st.push), st.pushers];
      return 0;
    });
  }

  unpack(arr) {
    if (!Array.isArray(arr)) return;
    arr.forEach((v, i) => {
      const d = this.list[i];
      if (!d || !Array.isArray(v)) return;
      if (d.type === 'gate') {
        d.st.closed = !!v[0];
        d.st.t = v[1];
        this.applyGate(d);
      } else if (d.type === 'lift') {
        d.st.y = v[0];
        d.st.dir = v[1];
        this.applyLift(d);
      } else if (d.type === 'pad') d.st.t = v[0];
      else if (d.type === 'crate') {
        const st = d.st;
        if (st.r !== v[0] || st.c !== v[1]) {
          this.map.setDynamic(st.c, st.r, null);
          this.map.setDynamic(v[1], v[0], [0, CRATE.h, KIND.push]);
        }
        [st.r, st.c, st.fromR, st.fromC, st.t, st.push, st.pushers] = v;
      }
    });
  }
}
