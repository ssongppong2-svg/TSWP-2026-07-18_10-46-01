import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { emptyIntent, eyePos } from '../src/sim/agent.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { GEAR, RC, placeTarget } from '../src/sim/gear.js';
import { CAM, beamCrosses, camLimits, pulseScan } from '../src/sim/gadgets.js';
import { dirFromAngles } from '../src/core/vec.js';

const live = (seed = 3) => {
  const m = new Match({ seed, playerTeam: TEAMS.DEFUSE });
  m.phase = 'live';
  return m;
};
function placeAt(a, x, z, yaw = 0, y = 0) {
  a.pos.x = a.prev.x = x;
  a.pos.z = a.prev.z = z;
  a.pos.y = a.prev.y = y;
  a.vel.x = a.vel.y = a.vel.z = 0;
  a.yaw = yaw;
  a.pitch = 0;
}
const drive = (m, a, input) => m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: ag.pitch, ...input() }) });
const still = (m) => m.agents.forEach((a) => m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: ag.pitch }) }));
const step = (m, s) => {
  for (let i = 0; i < Math.round(s / DT); i++) m.tick(DT);
};
// 손에 든 장비로 왼쪽(또는 오른쪽) 클릭 한 번
const click = (m, a, ads = false) => {
  a.swapT = 0;
  a.triggerLatch = false;
  a.adsLatch = false;
  m.stepWeapon(a, { ...emptyIntent(a), fire: !ads, ads }, DT, true);
};
// 다른 요원은 멀리 치움 (시험이 엉키지 않게)
const clearOthers = (m, keep) => m.agents.forEach((a, i) => !keep.includes(a) && placeAt(a, m.map.spawns.force[0].x + i * 0.01, m.map.spawns.force[0].z));
// 경보 센서를 붙일 수 있는 벽 찾기: 스폰 근처에서 시선을 돌리며
function findAlarmWall(m, a) {
  const s = m.map.spawns.defuse[0];
  for (let r = 0; r < 6; r++) {
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const x = s.x + Math.cos(ang) * r * 1.5, z = s.z + Math.sin(ang) * r * 1.5;
      if (m.map.groundHeight(x, z, 0.3, 0.5) > 0.05) continue;
      for (let j = 0; j < 8; j++) {
        const yaw = (j / 8) * Math.PI * 2;
        placeAt(a, x, z, yaw);
        a.pitch = -0.35;
        const spot = placeTarget(m.map, eyePos(a), dirFromAngles(a.yaw, a.pitch), GEAR.alarm.reach);
        const v = m.gadgets.alarmSpot(spot);
        if (!v.reason && v.len > 2) return { x, z, yaw, pitch: -0.35, beam: v };
      }
    }
  }
  return null;
}

test('5 키 장비 순서: 가진 것만 C4 → 기폭기 → 드론 → RC카 → 경보 → 카메라 → 카메라 보기 → 심박', () => {
  const m = live(2);
  const me = m.player;
  Object.assign(me.gear, { c4: 1, drone: 1, rc: 1, alarm: 1, cam: 1, pulse: 1 });
  assert.deepEqual(m.gadgetOptions(me), ['c4', 'drone', 'rc', 'alarm', 'cam', 'pulse']);
  m.gadgets.cams.push({ id: 999, kind: 'cam', team: me.team, ownerId: me.id, x: 0, y: 1, z: 0, nx: 1, ny: 0, nz: 0 });
  assert.deepEqual(m.gadgetOptions(me), ['c4', 'drone', 'rc', 'alarm', 'cam', 'camview', 'pulse']);
  const seen = [];
  for (let i = 0; i < 7; i++) {
    m.equipGear(me, 'gadget');
    seen.push(me.equip.kind);
  }
  assert.deepEqual(seen, ['c4', 'drone', 'rc', 'alarm', 'cam', 'camview', 'pulse']);
});

test('RC카: 바닥에 내려 달리고(땅에 붙음) Space로 깡충 · 회수하면 남은 배터리로 바로 손에 · 배터리 60초', () => {
  const m = live(4);
  still(m);
  const me = m.player;
  clearOthers(m, [me]);
  const s = m.map.spawns.defuse[0];
  placeAt(me, s.x, s.z, 0);
  me.gear.rc = 1;
  me.rcBat = GEAR.rc.battery;
  me.equip = { kind: 'rc' };
  click(m, me);
  assert.equal(m.drones.length, 1);
  const d = m.drones[0];
  assert.equal(d.kind, 'rc');
  assert.equal(me.gear.rc, 0);
  assert.equal(me.drone, d.id);
  // 앞으로 달림: 바닥에 붙어 있음
  let maxSpeed = 0;
  drive(m, me, () => ({ moveZ: 1, yaw: me.yaw }));
  for (let i = 0; i < 60; i++) {
    m.tick(DT);
    maxSpeed = Math.max(maxSpeed, Math.hypot(d.vel.x, d.vel.z));
  }
  const g = m.map.groundHeight(d.pos.x, d.pos.z, RC.radius * 0.9, d.pos.y + RC.step);
  assert.ok(Math.abs(d.pos.y - g) < 0.05, `바닥에 붙음 (y ${d.pos.y.toFixed(2)} / 바닥 ${g.toFixed(2)})`);
  assert.ok(maxSpeed > 4, `빠르게 달림 (${maxSpeed.toFixed(1)} m/s)`);
  // 깡충
  const y0 = d.pos.y;
  drive(m, me, () => ({ jump: true, yaw: me.yaw }));
  let top = y0;
  for (let i = 0; i < 20; i++) {
    m.tick(DT);
    top = Math.max(top, d.pos.y);
  }
  assert.ok(top > y0 + 0.4, `깡충 (${(top - y0).toFixed(2)} m)`);
  // 배터리가 줄어듦 → 회수하면 남은 만큼 손에
  const left = d.battery;
  assert.ok(left < GEAR.rc.battery && left > GEAR.rc.battery - 3);
  drive(m, me, () => ({ interact: true, yaw: me.yaw }));
  m.tick(DT);
  assert.equal(me.drone, null);
  assert.equal(me.gear.rc, 1);
  assert.ok(Math.abs(me.rcBat - left) < 0.1);
});

test('경보 센서: 벽에 붙이면 맞은편까지 줄 · 적이 지나가면 울리고 3초 표시 · 줄 밑으로 앉아 지나가면 안 울림 · 한 발에 부서짐', () => {
  const m = live(6);
  still(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  clearOthers(m, [me, e]);
  const w = findAlarmWall(m, me);
  assert.ok(w, '붙일 벽이 있음');
  placeAt(me, w.x, w.z, w.yaw);
  me.pitch = w.pitch;
  me.gear.alarm = 2;
  me.equip = { kind: 'alarm' };
  click(m, me);
  assert.equal(m.gadgets.alarms.length, 1);
  assert.equal(me.gear.alarm, 1);
  const al = m.gadgets.alarms[0];
  assert.ok(al.len > 2 && al.len <= GEAR.alarm.beam + 0.01);
  // 줄 가운데에 적을 세움 (설치 직후 잠깐은 준비 중)
  const mx = (al.x + al.ex) / 2, mz = (al.z + al.ez) / 2;
  const gy = m.map.groundHeight(mx, mz, 0.3, al.y);
  let trips = 0;
  m.events.on('alarmTrip', () => trips++);
  // 줄 높이가 낮으면(무릎) 서 있는 적에게 걸림
  placeAt(e, mx, mz, 0, gy);
  assert.ok(al.y > gy + 0.3 && al.y < gy + 1.6, `줄 높이 ${(al.y - gy).toFixed(2)} m`);
  assert.equal(beamCrosses(al, e), true);
  step(m, 1.0);
  assert.equal(trips, 1, '울림 (다시 울리기 전 잠깐 쉼)');
  assert.ok(e.revealedUntil > m.time + 1.5, '팀에 표시');
  // 지나간 뒤 다시 들어오면 쉬는 시간 뒤 또 울림
  step(m, GEAR.alarm.cooldown);
  assert.equal(trips, 2);
  // 줄을 높게 옮긴 경우: 앉으면 밑으로 지나감
  al.y = gy + 1.3;
  al.cdUntil = 0;
  e.crouch = 1;
  assert.equal(beamCrosses(al, e), false, '앉은 몸 위로 지나감');
  e.crouch = 0;
  assert.equal(beamCrosses(al, e), true, '서 있으면 걸림');
  // 적 총알 한 발에 부서짐
  const from = { x: al.x + al.nx * 3, y: al.y, z: al.z + al.nz * 3 };
  const hit = m.gadgets.hitTest(from, { x: al.x - al.nx * 0.2, y: al.y, z: al.z - al.nz * 0.2 }, e.team, 1);
  assert.ok(hit && hit.dev === al);
  assert.equal(m.gadgets.hitTest(from, { x: al.x, y: al.y, z: al.z }, me.team, 1), null, '아군 탄은 지나감');
  m.gadgets.destroy(al, 'shot');
  assert.equal(m.gadgets.alarms.length, 0);
});

test('던지는 카메라: 벽에 붙고 팀이 봄 · 화면 가운데 적 표시 · 다음 카메라 · 움직이면 거둠 · 부서지면 다음으로', () => {
  const m = live(7);
  still(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  clearOthers(m, [me, e]);
  const w = findAlarmWall(m, me);
  assert.ok(w);
  placeAt(me, w.x, w.z, w.yaw);
  me.pitch = w.pitch;
  me.gear.cam = 1;
  me.equip = { kind: 'cam' };
  click(m, me);
  assert.equal(me.gear.cam, 0);
  assert.equal(me.equip.kind, 'camview', '다 던지면 카메라 보기로');
  step(m, 0.6);
  assert.equal(m.gadgets.cams.length, 1, '벽에 붙음');
  const cam = m.gadgets.cams[0];
  // 카메라 바깥쪽 정면 4 m에 적
  const cx = cam.x + cam.nx * 4, cz = cam.z + cam.nz * 4;
  placeAt(e, cx, cz, 0, m.map.groundHeight(cx, cz, 0.3, cam.y + 1));
  // 보기
  click(m, me);
  assert.ok(me.camView && me.camView.id === cam.id);
  const body = { ...me.pos };
  // 마우스로 적 쪽을 봄
  const v0 = m.gadgets.view(me);
  const c = { x: e.pos.x, y: e.pos.y + 1.2, z: e.pos.z };
  const yaw = Math.atan2(-(c.x - v0.pos.x), -(c.z - v0.pos.z));
  const pitch = Math.atan2(c.y - v0.pos.y, Math.hypot(c.x - v0.pos.x, c.z - v0.pos.z));
  drive(m, me, () => ({ yaw, pitch }));
  step(m, 0.3);
  assert.ok(Math.hypot(me.pos.x - body.x, me.pos.z - body.z) < 0.1, '몸은 그대로');
  assert.ok(m.time - e.spottedT < 0.3, '보는 동안 화면 안 적은 팀에 보임');
  let marked = null;
  m.events.on('camMark', (x) => (marked = x.target));
  drive(m, me, () => ({ yaw, pitch, fire: true }));
  step(m, DT * 2);
  assert.equal(marked, e, '가운데 적 표시');
  assert.ok(e.revealedUntil > m.time + GEAR.cam.mark - 0.2);
  // 오른쪽 클릭: 다음 카메라 (팀 카메라가 둘이면)
  const cam2 = { id: 9001, kind: 'cam', ownerId: me.id, team: me.team, x: cam.x, y: cam.y + 0.5, z: cam.z, nx: cam.nx, ny: cam.ny, nz: cam.nz, offUntil: -99 };
  m.gadgets.cams.push(cam2);
  drive(m, me, () => ({ yaw, pitch, ads: true }));
  step(m, DT * 2);
  assert.equal(me.camView.id, cam2.id, '다음 카메라');
  m.gadgets.cams = m.gadgets.cams.filter((x) => x !== cam2);
  step(m, DT * 2);
  assert.equal(me.camView.id, cam.id, '보던 카메라가 사라지면 남은 카메라로');
  // 움직이면 거둠
  drive(m, me, () => ({ moveZ: 1 }));
  step(m, DT);
  assert.equal(me.camView, null);
  // 한계: 벽 카메라는 바깥쪽 ±72°
  const lim = camLimits(cam, Math.atan2(cam.nx, cam.nz), 0);
  const base = Math.atan2(-cam.nx, -cam.nz);
  assert.ok(Math.abs(Math.atan2(Math.sin(lim.yaw - base), Math.cos(lim.yaw - base))) <= CAM.yawLimit + 1e-6);
  // 다시 보고 있다가 카메라가 부서지면 몸으로 (남은 카메라가 없음)
  drive(m, me, () => ({}));
  step(m, DT);
  m.gadgets.enterCams(me);
  assert.ok(me.camView);
  m.gadgets.destroy(cam, 'shot');
  step(m, DT * 2);
  assert.equal(me.camView, null);
});

test('심장 박동 센서: 누르고 있으면 앞쪽 15 m 안 적이 벽 너머로 · 뒤·멀리는 안 보임 · 쓰는 동안 느림', () => {
  const m = live(8);
  still(m);
  const me = m.player;
  const foes = m.agents.filter((a) => a.team === TEAMS.FORCE);
  clearOthers(m, [me, ...foes]);
  placeAt(me, 0, 0, 0);
  placeAt(foes[0], 0, -10, 0); // 앞 10 m
  placeAt(foes[1], 0, 8, 0); // 뒤
  placeAt(foes[2], 0, -17, 0); // 너무 멂
  placeAt(foes[3], 6, -6, 0); // 앞 오른쪽 45°
  placeAt(foes[4], 40, 40, 0);
  const hits = pulseScan(m.agents, me).map((h) => h.id);
  assert.deepEqual(hits.sort(), [foes[0].id, foes[3].id].sort());
  // 손에 들고 누르는 동안만 켜짐
  const s = m.map.spawns.defuse[0];
  placeAt(me, s.x, s.z, 0);
  me.gear.pulse = 1;
  me.equip = { kind: 'pulse' };
  me.swapT = 0;
  drive(m, me, () => ({ fire: true, moveZ: 1, yaw: 0 }));
  step(m, 1.2);
  assert.equal(me.pulseOn, true);
  const slow = Math.hypot(me.vel.x, me.vel.z);
  drive(m, me, () => ({ fire: false, moveZ: 1, yaw: 0 }));
  step(m, 1.2);
  assert.equal(me.pulseOn, false);
  const normal = Math.hypot(me.vel.x, me.vel.z);
  assert.ok(slow < normal * 0.75, `쓰는 동안 느림 (${slow.toFixed(2)} < ${normal.toFixed(2)})`);
});

test('EMP: 드론 추락 · C4 기폭 불가 · 카메라·경보 정지 · 사람은 다치지 않고 장비만 먹통', () => {
  const m = live(9);
  still(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  clearOthers(m, [me, e]);
  const s = m.map.spawns.defuse[0];
  placeAt(me, s.x, s.z, 0);
  placeAt(e, s.x + 2, s.z, 0);
  // 내 드론 · 내 C4 · 적 카메라 · 적 경보
  me.gear.drone = 1;
  me.droneBat = GEAR.drone.battery;
  assert.ok(m.launchDrone(me));
  m.charges.push({ id: 501, kind: 'c4', ownerId: me.id, team: me.team, x: s.x + 1, y: 0.3, z: s.z, nx: 0, ny: 1, nz: 0, armAt: 0 });
  const cam = { id: 502, kind: 'cam', ownerId: e.id, team: e.team, x: s.x - 1, y: 1, z: s.z, nx: 1, ny: 0, nz: 0, offUntil: -99 };
  m.gadgets.cams.push(cam);
  const hp = e.hp;
  // 적이 EMP를 발밑에
  m.throwables.push({ id: 503, kind: 'emp', ownerId: e.id, team: e.team, pos: { x: s.x, y: 0.1, z: s.z }, prev: { x: s.x, y: 0.1, z: s.z }, vel: { x: 0, y: 0, z: 0 }, fuse: 0.05, age: 0, rest: true });
  let det = null;
  m.events.on('detonate', (x) => x.kind === 'emp' && (det = x));
  step(m, 0.1);
  assert.ok(det, 'EMP 터짐');
  assert.equal(m.drones.length, 0, '드론 추락');
  assert.equal(me.gear.drone, 0, '추락한 드론은 잃음');
  assert.ok(cam.offUntil > m.time + 3, '카메라 정지');
  assert.ok(me.empT > 3 && e.empT > 3, '사람은 장비만 먹통');
  assert.equal(e.hp, hp, '피해 없음');
  // C4는 신호를 못 받음
  me.equip = { kind: 'det' };
  let denied = null;
  m.events.on('gearDenied', (x) => (denied = x));
  click(m, me);
  assert.equal(m.charges.length, 1);
  assert.equal(denied?.reason, 'emp');
  // 먹통인 동안 드론·RC카를 못 띄움
  me.gear.rc = 1;
  me.rcBat = GEAR.rc.battery;
  assert.equal(m.launchDrone(me, null, 'rc'), false);
  // 시간이 지나면 풀림
  step(m, GEAR.emp.time + 0.5);
  assert.equal(me.empT, 0);
  assert.ok(m.launchDrone(me, null, 'rc'));
});
