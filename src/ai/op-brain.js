// CQB 작전 봇 생각 (BotBrain이 부름)
//   용의자: 자기 자리를 지킴(앉거나 서서 입구를 봄) · 순찰 자리를 오감 · 소리가 나면 다가가 확인 · 장치 해체 경보에 모임
//   진압팀: 지휘 명령이 없으면 대장(사람, 없으면 맨 앞 봇)을 따라감 · 가까운 연구원 결박 풀기·자료 확보
//          대장 봇은 방을 차례로 수색하고, 장치가 가까우면(또는 시간이 없으면) 해체
import { TEAMS } from '../sim/constants.js';

const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ───── 용의자 ─────
export function thinkSuspect(brain, match, a, visible) {
  const post = a.post;
  if (!post) return;
  const now = match.time;
  // 장치 해체 경보: 25 m 안이면 장치를 지키러 감
  const alerted = match.bombs.find((b) => b.state === 'armed' && (b.picker || now - b.alertT < 5) && d2(b, a.pos) < 25);
  if (alerted) {
    brain.goal = { point: { x: alerted.x, y: alerted.y ?? 0, z: alerted.z }, arrive: 3.5, look: { x: alerted.x, y: 1, z: alerted.z }, quiet: d2(alerted, a.pos) < 12, urgent: !!alerted.picker };
    return;
  }
  // 소리 확인: 가까운(16 m) 진압팀 소리는 반쯤의 확률로 다가가 7초 동안 살핌
  const h = brain.heard;
  if (h && now - h.t < 1.5 && h.id !== brain.checkedNoise && d2(h, a.pos) < 16 && !visible) {
    brain.checkedNoise = h.id;
    if (brain.rng.chance(0.5)) brain.investigate = { point: { x: h.x, y: h.y ?? 0, z: h.z }, until: now + 7 };
  }
  if (brain.investigate && now < brain.investigate.until && !visible) {
    const p = brain.investigate.point;
    brain.goal = { point: p, arrive: 2.2, look: { x: p.x, y: 1.3, z: p.z }, quiet: true };
    return;
  }
  brain.investigate = null;
  // 순찰: 자리와 순찰 칸을 10~16초마다 오감
  let spot = post;
  if (post.patrol) {
    brain.patrolT = (brain.patrolT ?? brain.rng.range(4, 10)) - 0.25;
    if (brain.patrolT <= 0) {
      brain.patrolAway = !brain.patrolAway;
      brain.patrolT = brain.rng.range(10, 16);
    }
    if (brain.patrolAway) spot = { ...post.patrol, look: post.look };
  }
  const at = d2(spot, a.pos) < 1;
  brain.goal = { point: { x: spot.x, y: 0, z: spot.z }, arrive: 0.7, look: post.look, quiet: true, crouchAtGoal: at && brain.holdCrouch && !post.patrol };
}

// ───── 진압팀 ─────
// 따라갈 대장: 살아 있는 사람(먼저 들어온 순) → 없으면 맨 앞 번호 봇
export function swatLeader(match) {
  const swat = match.agents.filter((x) => x.team === TEAMS.DEFUSE && x.alive);
  return swat.find((x) => x.isPlayer || x.human) ?? swat[0] ?? null;
}

// 방 수색 지점: 맵 구역 이름(callouts)마다 가운데에서 가장 가까운 걸을 수 있는 칸 (투입·호송 지점은 빼고)
export function searchPoints(match) {
  const op = match.op;
  if (op.searchPts) return op.searchPts;
  const map = match.map;
  const pts = [];
  for (const k of map.callouts) {
    if (k.f) continue;
    const cr = Math.round((k.r0 + k.r1) / 2), cc = Math.round((k.c0 + k.c1) / 2);
    let best = null;
    for (let rad = 0; rad < 4 && !best; rad++) {
      for (let dr = -rad; dr <= rad && !best; dr++) {
        for (let dc = -rad; dc <= rad && !best; dc++) {
          const c = cc + dc, r = cr + dr;
          if (r < k.r0 || r > k.r1 || c < k.c0 || c > k.c1 || !map.walkable(c, r) || map.doorCellAt(c, r)) continue;
          best = { x: map.cellX(c), y: 0, z: map.cellZ(r), name: k.name };
        }
      }
    }
    if (best && !op.inExtract(best)) pts.push(best);
  }
  // 넓은 구역은 가운데만 보면 구석을 놓침 → 연구원·자료가 있을 만한 곳(작전 정보)도 수색
  for (const h of op.hostages) pts.push({ x: h.home.x, y: 0, z: h.home.z, name: h.name });
  for (const it of op.intel) pts.push({ x: it.x, y: 0, z: it.z, name: it.name });
  op.searchPts = pts;
  op.searched = new Set();
  return pts;
}

export function thinkOperator(brain, match, a, visible) {
  const op = match.op;
  const leader = swatLeader(match);
  const now = match.time;
  const pts = searchPoints(match);
  // 진압팀 누구든 다가간 수색 지점은 확인됨
  pts.forEach((p, i) => {
    if (!op.searched.has(i) && match.agents.some((x) => x.alive && x.team === TEAMS.DEFUSE && d2(p, x.pos) < 2.4)) op.searched.add(i);
  });
  // 가까운 일 (적이 안 보일 때): 연구원 결박 풀기 → 자료 확보
  if (!visible && !a.opTask) {
    const near = (list, pred) => list.filter(pred).sort((p, q) => d2(p, a.pos) - d2(q, a.pos))[0];
    const range = leader === a ? 9 : 5;
    const h = near(op.hostages, (x) => x.state === 'captive' && d2(x, a.pos) < range);
    const it = h ? null : near(op.intel, (x) => !x.taken && d2(x, a.pos) < range);
    const t = h ?? it;
    if (t) {
      brain.goal = { point: { x: t.x, y: 0, z: t.z }, arrive: 1.0, look: { x: t.x, y: 0.5, z: t.z }, quiet: true };
      if (d2(t, a.pos) < 1.4) brain.wantOpTask = true;
      return;
    }
  }
  const armed = match.bombs.filter((b) => b.state === 'armed');
  if (leader !== a) {
    // 장치를 대장이 해체 중이면 그 둘레를 엄호, 아니면 대장 뒤에 부채꼴로
    const slot = Math.max(0, brain.index - 1);
    const ang = leader.yaw + Math.PI + (slot - 1.5) * 0.6;
    const point = { x: leader.pos.x - Math.sin(ang) * 2.4, y: leader.pos.y, z: leader.pos.z - Math.cos(ang) * 2.4 };
    const far = d2(point, a.pos) > 7;
    brain.goal = {
      point,
      arrive: 1.2,
      look: { x: leader.pos.x - Math.sin(leader.yaw + (slot % 2 ? 0.5 : -0.5)) * 12, y: 1.4, z: leader.pos.z - Math.cos(leader.yaw + (slot % 2 ? 0.5 : -0.5)) * 12 },
      quiet: !far && Math.hypot(leader.vel.x, leader.vel.z) < 2.2,
      urgent: far,
      crouchAtGoal: !!leader.lockpick || (leader.crouch ?? 0) > 0.5,
    };
    return;
  }
  // 대장 봇: 장치가 가깝거나 시간이 얼마 없으면 해체
  const bomb = armed.sort((p, q) => d2(p, a.pos) - d2(q, a.pos))[0];
  if (bomb && (d2(bomb, a.pos) < 10 || match.timeLeft < 150)) {
    brain.goToBomb(match, a, bomb, match.timeLeft < 150);
    return;
  }
  // 수색: 아직 안 가 본 가장 가까운 방 (다 봤으면 처음부터 다시, 들은 소리 쪽 먼저)
  const heard = brain.heard && now - brain.heard.t < 8 ? brain.heard : null;
  if (heard && !visible) {
    brain.goal = { point: { x: heard.x, y: heard.y ?? 0, z: heard.z }, arrive: 2.2, look: { x: heard.x, y: 1.2, z: heard.z }, quiet: true };
    return;
  }
  let left = pts.map((p, i) => i).filter((i) => !op.searched.has(i));
  if (!left.length) {
    op.searched.clear();
    left = pts.map((p, i) => i);
  }
  const next = left.map((i) => pts[i]).sort((p, q) => d2(p, a.pos) - d2(q, a.pos))[0];
  if (next) brain.goal = { point: next, arrive: 1.6, look: { x: next.x, y: 1.3, z: next.z }, quiet: true };
}
