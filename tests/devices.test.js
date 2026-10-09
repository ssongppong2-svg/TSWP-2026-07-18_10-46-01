import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { emptyIntent } from '../src/sim/agent.js';
import { STORY } from '../src/sim/map.js';
import { LIFT } from '../src/sim/devices.js';
import { MAP_ORDER } from '../src/sim/maps/index.js';

// 진행 중인 경기에서 한 요원만 남기고(나머지는 멀리 쓰러진 상태) 장치를 시험
function setup(mapId) {
  const m = new Match({ mapId, seed: 3, playerTeam: TEAMS.DEFUSE });
  m.phase = 'live';
  const me = m.player;
  for (const a of m.agents) if (a !== me) a.alive = false;
  let intent = null;
  m.setController(me.id, { getIntent: (mm, a) => ({ ...emptyIntent(a), ...(intent ?? {}), yaw: a.yaw }) });
  const put = (r, c, f = 0) => {
    me.pos.x = me.prev.x = m.map.cellX(c);
    me.pos.z = me.prev.z = m.map.cellZ(r);
    me.pos.y = me.prev.y = f ? STORY : 0;
    me.vel.x = me.vel.y = me.vel.z = 0;
    me.onGround = true;
  };
  const run = (sec, fn) => {
    for (let i = 0; i < sec * 60; i++) {
      intent = fn?.(i) ?? null;
      m.tick(DT);
    }
    intent = null;
  };
  const dev = (type) => m.devices.list.find((d) => d.type === type);
  return { m, me, put, run, dev };
}

test('맵 장치: 모든 맵에 탄성 발판·승강기·지레 셔터·미끄럼틀이 하나 이상', () => {
  for (const id of MAP_ORDER) {
    const { dev } = setup(id);
    for (const t of ['pad', 'lift', 'gate', 'slide']) assert.ok(dev(t), `${id} ${t}`);
  }
});

test('탄성 발판: 밟으면 정해진 2층 칸으로 튕겨 올라가 내려앉음', () => {
  for (const id of MAP_ORDER) {
    const { m, me, put, run, dev } = setup(id);
    const pad = dev('pad');
    put(pad.r, pad.c);
    run(2.5);
    const cell = m.map.toCell(me.pos.x, me.pos.z);
    assert.ok(Math.abs(me.pos.y - STORY) < 0.05, `${id}: 2층에 내려앉음 (y=${me.pos.y.toFixed(2)})`);
    assert.ok(Math.abs(cell.r - pad.to.r) <= 1 && Math.abs(cell.c - pad.to.c) <= 1, `${id}: 목표 칸 근처 (${cell.r}, ${cell.c})`);
  }
});

test('승강기: 바닥판에 서 있으면 2층까지 올라가고, 다시 내려옴', () => {
  for (const id of MAP_ORDER) {
    const { m, me, put, run, dev } = setup(id);
    const lift = dev('lift');
    put(lift.r, lift.c);
    run(LIFT.wait + STORY / LIFT.speed + 0.5);
    assert.ok(Math.abs(me.pos.y - STORY) < 0.05, `${id}: 2층 높이 (y=${me.pos.y.toFixed(2)})`);
    // 2층에서 내려서 기다리면 바닥판은 다시 1층으로
    run(LIFT.wait + STORY / LIFT.speed + 0.5);
    assert.ok(lift.st.y < 0.05 || lift.st.dir === 1, `${id}: 바닥판이 내려옴`);
  }
});

test('지레 셔터: 지렛대(F)로 내리면 문이 막혀 탄·길찾기가 막히고, 다시 올리면 열림', () => {
  for (const id of MAP_ORDER) {
    const { m, me, put, run, dev } = setup(id);
    const gate = dev('gate');
    const [gr, gc] = gate.cells[0];
    const lever = gate.levers[0];
    const map = m.map;
    const through = () => map.lineOfSight({ x: map.cellX(gc) - 3, y: 1.4, z: map.cellZ(gr) }, { x: map.cellX(gc) + 3, y: 1.4, z: map.cellZ(gr) });
    assert.ok(!map.dynBlocked(gc, gr) && through(), `${id}: 처음엔 열림`);
    put(lever.r, lever.c);
    run(1.2, (i) => (i === 0 ? { interact: true } : null));
    assert.ok(gate.st.closed && map.dynBlocked(gc, gr), `${id}: 닫힘`);
    assert.ok(!through(), `${id}: 닫힌 셔터가 탄을 막음`);
    const p = m.nav.findPath({ x: map.cellX(gc) - 3, y: 0, z: map.cellZ(gr) }, { x: map.cellX(gc) + 3, y: 0, z: map.cellZ(gr) });
    assert.ok(p && p.every((q) => !gate.cells.some(([r, c]) => map.toCell(q.x, q.z).r === r && map.toCell(q.x, q.z).c === c)), `${id}: 길찾기가 셔터를 피함`);
    run(3, (i) => (i === 0 ? { interact: true } : null)); // 재사용 대기 중에는 무시됨
    run(1.2, (i) => (i === 0 ? { interact: true } : null));
    assert.ok(!gate.st.closed && !map.dynBlocked(gc, gr) && through(), `${id}: 다시 열림`);
  }
});

test('마찰 미끄럼틀: 위에서 들어서면 빠르게 1층까지 미끄러지고, 아래에서는 거슬러 오를 수 없음', () => {
  for (const id of MAP_ORDER) {
    const { m, me, put, run, dev } = setup(id);
    const s = dev('slide');
    const rp = m.map.ramp(s.c0, s.r0);
    const RUP = [null, [0, -1], [0, 1], [-1, 0], [1, 0]][rp.dir];
    // 오르는 쪽 끝 칸(위) · 내려가는 쪽 끝 칸(아래)
    const cells = [];
    for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) cells.push([r, c, m.map.ramp(c, r).h1]);
    const top = cells.reduce((a, b) => (b[2] > a[2] ? b : a));
    const bottom = cells.reduce((a, b) => (b[2] < a[2] ? b : a));
    // 위 칸에서 미끄러짐
    put(top[0], top[1]);
    me.pos.y = me.prev.y = m.map.ramp(top[1], top[0]).h0 + 0.6;
    run(2.5);
    assert.ok(me.pos.y < 0.05, `${id}: 1층까지 내려옴 (y=${me.pos.y.toFixed(2)})`);
    // 아래에서 오르려고 계속 걸어도 못 오름 (오르는 방향으로 이동 입력)
    put(bottom[0] - RUP[1], bottom[1] - RUP[0]);
    me.yaw = Math.atan2(-RUP[0], -RUP[1]);
    run(3, () => ({ moveZ: 1 }));
    assert.ok(me.pos.y < 1.2, `${id}: 거슬러 오르지 못함 (y=${me.pos.y.toFixed(2)})`);
  }
});

test('미는 상자: 한 명이 밀면 천천히, 두 명이 같은 방향으로 밀면(합력) 더 빨리 한 칸씩 밀림', () => {
  const { m, me, run, dev } = setup('force-bound');
  const crate = dev('crate');
  const map = m.map;
  const start = { r: crate.st.r, c: crate.st.c };
  assert.ok(map.dynBlocked(start.c, start.r), '상자 칸은 막혀 있음');
  // 상자 서쪽 면에 붙어서 동쪽(+x)으로 밀기
  const place = (a, dz) => {
    a.alive = true;
    a.pos.x = a.prev.x = map.originX + start.c * 2 - 0.36;
    a.pos.z = a.prev.z = map.cellZ(start.r) + dz;
    a.pos.y = a.prev.y = 0;
    a.onGround = true;
    a.yaw = -Math.PI / 2; // 동쪽을 봄
  };
  place(me, 0);
  let moved1 = null;
  run(3, (i) => {
    if (moved1 == null && crate.st.c !== start.c) moved1 = i / 60;
    return { moveZ: 1 };
  });
  assert.ok(moved1 != null, '한 명이 밀어도 움직임');
  // 처음 자리로 되돌리고 두 명이 함께
  m.devices.reset();
  const mate = m.agents.find((a) => a !== me && a.team === me.team);
  m.setController(mate.id, { getIntent: (mm, a) => ({ ...emptyIntent(a), moveZ: 1, yaw: a.yaw }) });
  place(me, -0.45);
  place(mate, 0.45);
  let moved2 = null;
  run(3, (i) => {
    if (moved2 == null && crate.st.c !== start.c) moved2 = i / 60;
    return { moveZ: 1 };
  });
  assert.ok(moved2 != null && moved2 < moved1 * 0.75, `두 명이면 더 빨리 (${moved1.toFixed(2)}s → ${moved2?.toFixed(2)}s)`);
  assert.ok(!map.dynBlocked(start.c, start.r) && map.dynBlocked(crate.st.c, crate.st.r), '막힌 칸도 따라 옮겨감');
});
