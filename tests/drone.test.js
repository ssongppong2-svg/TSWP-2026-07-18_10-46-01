import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { emptyIntent } from '../src/sim/agent.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { DRONE, GEAR } from '../src/sim/gear.js';
import { WEAPONS } from '../src/sim/data.js';

const live = (seed = 3) => {
  const m = new Match({ seed, playerTeam: TEAMS.DEFUSE });
  m.phase = 'live';
  return m;
};
function place(m, a, dx, dz, yaw = 0) {
  const s = m.map.spawns.defuse[0];
  a.pos.x = a.prev.x = s.x + dx;
  a.pos.z = a.prev.z = s.z + dz;
  a.pos.y = a.prev.y = 0;
  a.vel.x = a.vel.y = a.vel.z = 0;
  a.yaw = yaw;
  a.pitch = 0;
}
// 사람 조종: 매 틱 같은 입력
const drive = (m, a, input) => m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: 0, ...input() }) });
const still = (m) => m.agents.forEach((a) => m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: ag.pitch }) }));
const step = (m, s) => { for (let i = 0; i < Math.round(s / DT); i++) m.tick(DT); };

test('드론: 5로 들고 띄우면 조종 입력이 드론으로 가고 몸은 앉은 채 그대로', () => {
  const m = live(4);
  still(m);
  const me = m.player;
  place(m, me, 0, 0, 0);
  me.gear.drone = 1;
  m.equipGear(me, 'gadget');
  assert.equal(me.equip.kind, 'drone');
  me.swapT = 0;
  me.triggerLatch = false;
  m.stepWeapon(me, { ...emptyIntent(me), fire: true }, DT, true);
  assert.equal(m.drones.length, 1);
  assert.ok(me.drone);
  assert.equal(me.gear.drone, 0);
  const body = { ...me.pos };
  const d = m.drones[0];
  const start = { ...d.pos };
  drive(m, me, () => ({ moveZ: 1, jump: true, yaw: 0 }));
  step(m, 1.5);
  assert.ok(Math.hypot(me.pos.x - body.x, me.pos.z - body.z) < 0.2, '몸은 그대로');
  assert.ok(me.crouch > 0.5, '몸은 앉음');
  assert.ok(Math.hypot(d.pos.x - start.x, d.pos.z - start.z) > 3, '드론이 앞으로 날아감');
  const ground = m.map.groundHeight(d.pos.x, d.pos.z, DRONE.radius, d.pos.y + 0.1);
  assert.ok(d.pos.y <= ground + DRONE.maxAlt + 0.01, '바닥 위 3 m까지만');
  // F로 복귀
  drive(m, me, () => ({ interact: true }));
  step(m, DT);
  assert.equal(me.drone, null);
  assert.equal(m.drones.length, 0);
});

test('드론: 보이는 적은 팀 미니맵에, 가운데에 두고 클릭하면 5초간 표시 · 총에 맞으면 떨어짐', () => {
  const m = live(5);
  still(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  place(m, me, 0, 0, 0);
  place(m, e, 0, -12, Math.PI);
  me.gear.drone = 1;
  assert.ok(m.launchDrone(me));
  const d = m.drones[0];
  d.pos.y = 1.3;
  drive(m, me, () => ({ yaw: 0, pitch: 0 }));
  step(m, 0.4);
  assert.ok(m.time - e.spottedT < 0.3, '드론에 보인 적은 아군 눈에 보이는 것과 같음');
  let radio = null;
  m.events.on('radio', (x) => (radio = x));
  const marked = m.droneMark(me, d);
  assert.equal(marked, e);
  assert.ok(e.revealedUntil > m.time + GEAR.drone.mark - 0.1);
  assert.ok(radio && radio.text.startsWith('드론: 적 표시'));
  // 적이 쏨 → 드론 격추
  let down = null;
  m.events.on('droneEnd', (x) => (down = x));
  e.weapon = 'rifle';
  const dx = d.pos.x - e.pos.x, dz = d.pos.z - e.pos.z, dy = d.pos.y - (e.pos.y + 1.62);
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  e.bloom = e.recoil = e.recoilYaw = 0;
  m.fire(e, WEAPONS.rifle, e.weapons.rifle);
  step(m, 0.3);
  assert.ok(down && down.reason === 'shot', `격추 ${down?.reason}`);
  assert.equal(me.drone, null);
});

test('드론: 배터리가 다 되거나 몸이 맞으면 화면이 몸으로 돌아옴', () => {
  const m = live(6);
  still(m);
  const me = m.player;
  place(m, me, 0, 0, 0);
  me.gear.drone = 1;
  assert.ok(m.launchDrone(me));
  step(m, GEAR.drone.battery + 0.2);
  assert.equal(me.drone, null, '배터리');
  me.gear.drone = 1;
  assert.ok(m.launchDrone(me));
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  m.applyDamage(me, 10, e);
  assert.equal(me.drone, null, '몸이 맞음');
});
