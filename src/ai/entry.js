// 아군 봇 진입 명령 (레디 오어 낫식). 분대장이 문을 보고 G를 누르면 문 명령 휠:
//   문 앞 대기 · 열고 진입 · 섬광 후 진입 · 폭파 후 진입 · 걷어차고 진입 · 문 밑 확인
// 명령(match.orders[팀])에 진행 상태를 담아 두고, 그 팀 봇 중 하나가 매 틱 한 번 진행시킨다(stepEntry).
// 봇은 자기 몫의 일(o.jobs[id]: 설 곳·볼 곳·문 행동·투척·기폭)만 읽어서 움직인다.
//   대기(stack): 문 양옆 벽에 붙음 → 돌파(breach): 문을 다루는 봇(breacher)이 열기·발차기·폭파 / 투척 봇이 섬광
//   → 진입(enter): 한 명씩 0.5초 간격으로 방 구석·깊은 곳으로 → 확보(clear): 적이 안 보이면 "방 확보" → 지킴(done)
import { GEAR } from '../sim/gear.js';

export { ENTRY_COMMANDS, ENTRY_MODE, ENTRY_NAME, ENTRY_ACK } from '../sim/entry-orders.js';

const ENTRY = {
  stackTime: 8, // 대기 자리로 모이는 최대 시간 (늦으면 그냥 시작)
  kickEvery: 1.1,
  maxKicks: 6,
  blowDelay: 1.4, // C4 붙이고 물러난 뒤 기폭까지
  entrantGap: 0.5, // 한 명씩 들어가는 간격
  enterTime: 12,
  clearQuiet: 1.5, // 적이 안 보인 채 이만큼 지나면 확보
  mirrorTime: 2.6,
};

// 문 좌표 → 세계: a = 문을 따라(u), b = 명령한 쪽(side)으로 나온 거리
const at = (d, side, a, b) => ({ x: d.x + d.u.x * a + d.n.x * side * b, y: 0, z: d.z + d.u.z * a + d.n.z * side * b });

// 대기 자리 · 문 앞 자리 · 문 너머 방(칸들·진입 지점)
export function planEntry(match, d, side) {
  const map = match.map;
  const ok = (p) => {
    const { c, r } = map.toCell(p.x, p.z);
    if (!map.walkable(c, r) || map.doorCellAt(c, r)) return false;
    return match.nav.clearLine(p.x, p.z, front.x, front.z, 0.3, 0);
  };
  const front = at(d, side, 0, 1.35);
  // 벽에 붙는 자리 (양쪽 번갈아, 벽면에서 0.5 m): 문틀 바로 옆 → 조금 더 옆 → 뒤로
  // 문틀 옆이라 문에 붙인 C4가 터져도 벽이 막아 줌
  const cands = [[-1.4, 1.5], [1.4, 1.5], [-2.3, 1.5], [2.3, 1.5], [-1.4, 2.5], [1.4, 2.5], [0, 3.2], [0, 4.3], [0, 5.4]];
  const stack = cands.map(([a, b]) => at(d, side, a, b)).filter(ok);
  // 방: 문 건너편 칸에서 시작해 걸어갈 수 있는 1층 칸 (다른 문은 넘지 않음, 7칸·48칸 안)
  const sc = d.c - d.n.x * side, sr = d.r - d.n.z * side;
  const cells = [];
  const seen = new Set([map.idx(d.c, d.r)]);
  const queue = map.walkable(sc, sr) ? [[sc, sr, 0]] : [];
  if (queue.length) seen.add(map.idx(sc, sr));
  while (queue.length && cells.length < 48) {
    const [c, r, k] = queue.shift();
    cells.push({ c, r });
    if (k >= 7) continue;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (!map.inBounds(nc, nr) || seen.has(map.idx(nc, nr))) continue;
      seen.add(map.idx(nc, nr));
      if (!map.walkable(nc, nr) || map.doorCellAt(nc, nr) || map.isLift?.(nc, nr) || map.isPad?.(nc, nr)) continue;
      queue.push([nc, nr, k + 1]);
    }
  }
  // 칸마다 문 기준 좌표 (a: 옆, b: 방 안쪽 깊이)
  const loc = cells.map(({ c, r }) => {
    const x = map.cellX(c), z = map.cellZ(r);
    return { x, z, a: (x - d.x) * d.u.x + (z - d.z) * d.u.z, b: -((x - d.x) * d.n.x + (z - d.z) * d.n.z) * side };
  });
  const pick = (filter, score) => loc.filter(filter).sort((p, q) => score(q) - score(p))[0] ?? null;
  // 진입 지점: 왼쪽 구석 · 오른쪽 구석 · 깊은 왼쪽 · 깊은 오른쪽 (가까운 곳부터 확인하며 들어감)
  const pts = [
    pick((p) => p.a < -0.5 && p.b > 0.5 && p.b < 5, (p) => -p.a - Math.abs(p.b - 2.2) * 0.6),
    pick((p) => p.a > 0.5 && p.b > 0.5 && p.b < 5, (p) => p.a - Math.abs(p.b - 2.2) * 0.6),
    pick((p) => p.a <= 0.5 && p.b > 2.5, (p) => p.b - Math.abs(p.a) * 0.3),
    pick((p) => p.a >= -0.5 && p.b > 2.5, (p) => p.b - Math.abs(p.a) * 0.3),
  ].filter(Boolean);
  const points = [];
  for (const p of pts) if (!points.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1)) points.push({ x: p.x, y: 0, z: p.z });
  if (!points.length) points.push(at(d, side, 0, -2.2));
  const center = loc.length
    ? { x: loc.reduce((s, p) => s + p.x, 0) / loc.length, y: 1.3, z: loc.reduce((s, p) => s + p.z, 0) / loc.length }
    : { ...at(d, side, 0, -4), y: 1.3 };
  const deep = pick((p) => Math.abs(p.a) < 2.5, (p) => Math.min(p.b, 6)) ?? center;
  return { front, stack: stack.length ? stack : [at(d, side, 0, 3)], room: { cells, points, center, deep: { x: deep.x, y: 0, z: deep.z } } };
}

const near = (a, p, r) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < r;

// 그 팀의 봇이 매 틱 부름 (한 틱에 한 번만 진행)
export function stepEntry(match, o) {
  if (o.stepT === match.time) return;
  const dt = o.stepT == null ? 0 : match.time - o.stepT;
  o.stepT = match.time;
  const d = match.doors.list[o.door];
  if (!d) return;
  const team = match.agents.filter((m) => m.alive && m.team === o.team && !m.isPlayer && !m.human && m.id !== o.issuerId);
  if (!o.plan) {
    o.plan = planEntry(match, d, o.side);
    o.phase = 'stack';
    o.phaseT = 0;
    o.jobs = {};
    o.done = {};
    o.kicks = 0;
  }
  const P = o.plan;
  o.phaseT += dt;
  // 역할: 문에 가장 가까운 봇이 문을 다루고(breacher, 폭파면 C4를 가진 봇), 섬광·이명을 가진 봇이 던짐(thrower)
  // 쓰러지면 다음 봇이 이어받음
  const byDist = [...team].sort((p, q) => Math.hypot(p.pos.x - d.x, p.pos.z - d.z) - Math.hypot(q.pos.x - d.x, q.pos.z - d.z));
  const hasFlash = (m) => (m.gear?.flash ?? 0) + (m.gear?.stun ?? 0) > 0;
  if (!team.some((m) => m.id === o.breacher)) o.breacher = (o.mode === 'breach' ? byDist.find((m) => (m.gear?.c4 ?? 0) > 0) : null)?.id ?? byDist[0]?.id ?? null;
  if (!team.some((m) => m.id === o.thrower) || (o.thrower === o.breacher && team.length > 1) || !o.thrownAt && !hasFlash(match.agentById(o.thrower))) {
    const others = byDist.filter((m) => m.id !== o.breacher);
    o.thrower = (others.find(hasFlash) ?? byDist.find(hasFlash) ?? others[0] ?? byDist[0])?.id ?? null;
  }
  const slots = team.map((m) => m.id);
  const breacher = match.agentById(o.breacher);
  const look = { x: d.x, y: 1.2, z: d.z };
  const stackJob = (m) => ({ point: P.stack[slots.indexOf(m.id) % P.stack.length], look, quiet: true, crouch: true });
  for (const m of team) o.jobs[m.id] = stackJob(m);
  if (!team.length) return;
  const radio = (m, text, kind = 'ack') => m && match.radio(m, text, { kind });
  const st = d.st;
  const opened = st.broken || Math.abs(st.ang) > 1.0;

  switch (o.phase) {
    case 'stack': {
      if (o.mode === 'stack') break;
      const ready = team.every((m) => near(m, o.jobs[m.id].point, 0.9));
      if (ready || o.phaseT > ENTRY.stackTime) setPhase(o, 'breach');
      break;
    }
    case 'breach': {
      if (!breacher) break;
      const front = { point: P.front, look, quiet: true };
      const atFront = near(breacher, P.front, 0.6);
      // 열기·섬광: 먼저 문을 엶 (잠겼으면 걷어차기로)
      if ((o.mode === 'open' || o.mode === 'flash') && !opened) {
        o.jobs[breacher.id] = front;
        if (atFront && !o.tried) {
          o.tried = true;
          if (match.doors.options(breacher, d).locked) {
            radio(breacher, '잠겼다. 걷어찬다.');
            o.mode = o.mode === 'flash' ? 'flashKick' : 'kick';
          } else o.jobs[breacher.id] = { ...front, act: 'open', actId: `${o.id}open` };
        }
        if (o.phaseT > 6 && !opened) o.mode = o.mode === 'flash' ? 'flashKick' : 'kick';
        break;
      }
      if ((o.mode === 'kick' || o.mode === 'flashKick') && !opened) {
        o.jobs[breacher.id] = front;
        if (atFront && (o.nextKick ?? 0) <= match.time && !(breacher.kickT > 0)) {
          if (o.kicks >= ENTRY.maxKicks) {
            radio(breacher, '문이 안 열린다. 대기.');
            o.mode = 'stack';
            setPhase(o, 'stack');
            break;
          }
          o.kicks++;
          o.nextKick = match.time + ENTRY.kickEvery;
          o.jobs[breacher.id] = { ...front, act: 'kick', actId: `${o.id}kick${o.kicks}` };
        }
        break;
      }
      if (o.mode === 'breach') {
        if (st.broken) {
          if (!o.enterAt) o.enterAt = match.time + 0.4;
        } else if (!o.charged) {
          if (match.charges.some((c) => c.ownerId === breacher.id && c.doorId === d.id)) {
            // 붙였음 → 대기 자리로 물러난 뒤 기폭
            o.charged = true;
            o.blowAt = match.time + ENTRY.blowDelay;
            radio(breacher, '폭약 설치. 물러나.');
          } else if (!((breacher.gear?.c4 ?? 0) > 0)) {
            // 폭약: 가진 봇이 문을 다룸 (아무도 없으면 걷어차기)
            const has = team.find((m) => (m.gear?.c4 ?? 0) > 0);
            if (has) o.breacher = has.id;
            else {
              radio(breacher, '폭약 없음. 걷어찬다.');
              o.mode = 'kick';
            }
          } else {
            o.jobs[breacher.id] = front;
            if (atFront) o.jobs[breacher.id] = { ...front, act: 'charge', actId: `${o.id}charge` };
          }
        } else if (match.time >= o.blowAt && !o.blown) {
          // 물러난 뒤 기폭 (모두 벽 뒤에 있을 때까지 조금 더 기다림)
          const safe = team.every((m) => near(m, o.jobs[m.id].point, 1.0)) || match.time > o.blowAt + 2.5;
          if (safe) {
            o.blown = true;
            o.jobs[breacher.id] = { ...stackJob(breacher), act: 'detonate', actId: `${o.id}blow` };
          }
        }
        if (o.enterAt && match.time >= o.enterAt) setPhase(o, 'enter');
        break;
      }
      if (o.mode === 'flash' || o.mode === 'flashKick') {
        // 문이 열렸으면 투척 봇이 문 앞에서 방 안쪽으로 섬광(없으면 이명)
        const thrower = match.agentById(o.thrower) ?? breacher;
        const id = ['flash', 'stun'].find((g) => (thrower.gear?.[g] ?? 0) > 0);
        if (!o.thrownAt) {
          if (!id) {
            radio(thrower, '섬광 없음. 그냥 진입.');
            o.thrownAt = match.time - GEAR.flash.fuse;
          } else {
            o.jobs[thrower.id] = { point: P.front, look: P.room.deep, quiet: true };
            if (near(thrower, P.front, 0.7)) {
              o.jobs[thrower.id] = { point: P.front, look: P.room.deep, act: 'throw', gear: id, target: P.room.deep, actId: `${o.id}throw` };
              if ((thrower.gear?.[id] ?? 0) < (o.had ?? 99)) o.thrownAt = match.time;
              o.had ??= thrower.gear[id];
            }
            if (o.phaseT > 8) o.thrownAt = match.time; // 못 던지면 그냥 진입
          }
          break;
        }
        o.avoid = { until: o.thrownAt + GEAR.flash.fuse + 0.3, from: look };
        if (match.time >= o.thrownAt + GEAR.flash.fuse + 0.35) setPhase(o, 'enter');
        break;
      }
      if (o.mode === 'mirror') {
        o.jobs[breacher.id] = front;
        if (atFront && !o.mirrorAt) {
          o.mirrorAt = match.time;
          o.seen = new Set();
          o.jobs[breacher.id] = { ...front, act: 'mirror', actId: `${o.id}mirrorOn` };
        }
        if (o.mirrorAt) {
          for (const id of breacher.mirror ? breacher.visibleEnemies ?? [] : []) o.seen.add(id);
          if (match.time - o.mirrorAt > ENTRY.mirrorTime) {
            // 보고 + 본 적은 5초 표시, 카메라 거두고 문 앞 대기
            const seen = [...o.seen].map((id) => match.agentById(id)).filter((e) => e?.alive);
            for (const e of seen) e.revealedUntil = Math.max(e.revealedUntil, match.time + 5);
            if (seen.length) {
              const e = seen[0];
              match.shareIntel(breacher, { x: e.pos.x, y: e.pos.y, z: e.pos.z, kind: 'seen' });
              radio(breacher, `문 밑 확인: 적 ${seen.length}명`, 'contact');
            } else radio(breacher, '문 밑 확인: 이상 없음.');
            if (breacher.mirror) o.jobs[breacher.id] = { ...front, act: 'mirror', actId: `${o.id}mirrorOff` };
            o.mode = 'stack';
            o.phase = 'stack';
          }
        }
        break;
      }
      // 걷어차기·열기가 끝나 문이 열렸음
      if (opened) setPhase(o, 'enter');
      break;
    }
    case 'enter': {
      // 문을 다룬 봇은 맨 뒤에 들어감
      const order = [...team.filter((m) => m.id !== o.breacher), ...team.filter((m) => m.id === o.breacher)];
      order.forEach((m, k) => {
        if (o.phaseT < k * ENTRY.entrantGap) return; // 아직 차례가 아님 (대기 자리)
        const p = P.room.points[k % P.room.points.length];
        o.jobs[m.id] = { point: p, look: P.room.center, urgent: true };
        if (near(m, p, 0.9)) o.done[m.id] = true;
      });
      if (order.every((m) => o.done[m.id]) || o.phaseT > ENTRY.enterTime) setPhase(o, 'clear');
      break;
    }
    case 'clear':
    case 'done': {
      const order = [...team.filter((m) => m.id !== o.breacher), ...team.filter((m) => m.id === o.breacher)];
      order.forEach((m, k) => (o.jobs[m.id] = { point: P.room.points[k % P.room.points.length], look: P.room.center, crouch: o.phase === 'done' }));
      if (o.phase === 'clear') {
        const contact = team.some((m) => (m.visibleEnemies ?? []).length);
        o.quietT = contact ? 0 : (o.quietT ?? 0) + dt;
        if (o.quietT >= ENTRY.clearQuiet) {
          radio(order[0], '방 확보!');
          match.emit('roomClear', { order: o, door: d, team: o.team });
          o.phase = 'done';
        }
      }
      break;
    }
    default:
      break;
  }
}

function setPhase(o, phase) {
  o.phase = phase;
  o.phaseT = 0;
  o.tried = false;
}
