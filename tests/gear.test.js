import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { emptyIntent, eyePos, chestPos } from '../src/sim/agent.js';
import { DT, TEAMS } from '../src/sim/constants.js';
import { GEAR, aimForTarget, previewArc, throwVelocity } from '../src/sim/gear.js';
import { dirFromAngles } from '../src/core/vec.js';

const live = (seed = 3, extra = {}) => {
  const m = new Match({ seed, playerTeam: TEAMS.DEFUSE, ...extra });
  m.phase = 'live';
  return m;
};
const step = (m, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) m.tick(DT);
};
// 열린 곳(해체팀 시작 홀)에 세우기
function place(m, a, dx, dz, yaw = 0) {
  const s = m.map.spawns.defuse[0];
  a.pos.x = a.prev.x = s.x + dx;
  a.pos.z = a.prev.z = s.z + dz;
  a.pos.y = a.prev.y = 0;
  a.vel.x = a.vel.y = a.vel.z = 0;
  a.yaw = yaw;
  a.pitch = 0;
}
// 모두 가만히 서 있게 (봇 없이)
const freeze = (m) => m.agents.forEach((a) => m.setController(a.id, { getIntent: (mm, ag) => ({ ...emptyIntent(ag), yaw: ag.yaw, pitch: ag.pitch }) }));

test('구매: 하나씩, 최대 개수까지, 최대에서 다시 누르면 하나 반납', () => {
  const m = new Match({ seed: 4, playerTeam: TEAMS.DEFUSE, rules: 'rounds' });
  const me = m.player;
  me.credits = 2000;
  assert.ok(m.buy(me, 'flash'));
  assert.ok(m.buy(me, 'flash'));
  assert.equal(me.gear.flash, 2);
  assert.equal(me.credits, 2000 - 2 * GEAR.flash.price);
  assert.ok(m.buy(me, 'flash'), '최대(2)에서 다시 누르면 반납');
  assert.equal(me.gear.flash, 1);
  assert.ok(m.buy(me, 'c4'));
  assert.equal(me.gear.c4, 1);
  me.credits = 0;
  assert.equal(m.buy(me, 'smoke'), false, '돈이 모자람');
});

test('포물선: 봇 조준 각도로 던지면 목표 근처에 떨어짐', () => {
  const m = live();
  const s = m.map.spawns.defuse[0];
  const from = { x: s.x, y: 1.5, z: s.z };
  const to = { x: s.x + 9, y: 0, z: s.z + 1 };
  const aim = aimForTarget(from, to, 15);
  assert.ok(aim, '닿을 수 있음');
  const dir = dirFromAngles(aim.yaw, aim.pitch - 0.12); // 던질 때 살짝 위로 가는 만큼 빼고
  const { land } = previewArc(m.map, from, throwVelocity(dir, 'long'));
  assert.ok(Math.hypot(land.x - to.x, land.z - to.z) < 2.5, `떨어진 곳 ${land.x.toFixed(1)},${land.z.toFixed(1)}`);
  // 짧게 던지면 덜 멀리
  const short = previewArc(m.map, from, throwVelocity(dirFromAngles(aim.yaw, 0), 'short')).land;
  assert.ok(Math.hypot(short.x - from.x, short.z - from.z) < Math.hypot(land.x - from.x, land.z - from.z));
});

test('들고 던지기: 4로 들고 왼쪽 클릭 → 날아가 굴러 멈추고 신관 시간 뒤 터짐', () => {
  const m = live(5);
  freeze(m);
  const me = m.player;
  place(m, me, 0, 0, 0);
  me.gear.stun = 1;
  me.gear.flash = 1;
  m.equipGear(me, 'throw');
  assert.equal(me.equip.kind, 'throw');
  assert.equal(me.equip.id, 'stun');
  m.equipGear(me, 'throw');
  assert.equal(me.equip.id, 'flash', '다시 누르면 다음 종류');
  me.swapT = 0;
  me.triggerLatch = false;
  m.stepWeapon(me, { ...emptyIntent(me), fire: true }, DT, true);
  assert.equal(m.throwables.length, 1);
  assert.equal(me.gear.flash, 0);
  assert.equal(me.equip.id, 'stun', '남은 투척물로');
  let det = null;
  m.events.on('detonate', (e) => (det = e));
  step(m, GEAR.flash.fuse + 0.1);
  assert.ok(det && det.kind === 'flash');
  assert.equal(m.throwables.length, 0);
  // 무기 키를 누르면 다시 총으로
  m.stepWeapon(me, { ...emptyIntent(me), switchTo: 'rifle' }, DT, true);
  assert.equal(me.equip, null);
});

test('세열 수류탄: 가까운 적은 큰 피해, 벽 뒤·아군은 피해 없음, 바깥쪽으로 밀림', () => {
  const m = live(6);
  freeze(m);
  const me = m.player;
  const mate = m.agents.find((a) => a.team === TEAMS.DEFUSE && a !== me);
  const [e1, e2] = m.agents.filter((a) => a.team === TEAMS.FORCE);
  place(m, me, -6, 0);
  place(m, mate, 1.5, 0);
  place(m, e1, 0, 1.5);
  place(m, e2, 0, 40); // 멀리
  const at = { x: me.pos.x + 6, y: 0.2, z: me.pos.z, kind: 'frag', team: me.team };
  m.blast(at, GEAR.frag, me);
  assert.ok(e1.hp < 70, `가까운 적 ${e1.hp}`);
  assert.equal(e2.hp, 100, '멀면 안전');
  assert.equal(mate.hp, 100, '아군 피해 없음');
  assert.ok(Math.hypot(e1.vel.x, e1.vel.z) > 1, '밀려남');
});

test('섬광: 바라보면 오래, 등지면 짧게 눈부심 · 눈부시면 적을 못 봄', () => {
  const m = live(7);
  freeze(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  place(m, me, 0, 0, 0); // 북쪽(-z)을 봄
  place(m, e, 0, -8, Math.PI); // 나를 봄
  const other = m.agents.find((a) => a.team === TEAMS.FORCE && a !== e);
  place(m, other, 2, 0, Math.PI); // 남쪽을 봄 (섬광은 뒤쪽)
  m.throwables.push({ id: 999, kind: 'flash', ownerId: me.id, team: me.team, pos: { x: me.pos.x, y: 1.2, z: me.pos.z - 4 }, prev: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, fuse: 0, age: 0, rest: true });
  m.updateThrowables(DT);
  assert.ok(me.flashT > 1.2, `바라봄 ${me.flashT}`);
  assert.ok(other.flashT < me.flashT * 0.7, `등짐 ${other.flashT}`);
  m.visT = 0;
  m.updateVisibility(DT);
  assert.equal(me.visibleEnemies.length, 0, '눈부셔서 못 봄');
});

test('연막: 피어오르면 연기 너머가 안 보임, 최루: 안에 있으면 느려지고 흔들림', () => {
  const m = live(8);
  freeze(m);
  const me = m.player;
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  place(m, me, 0, 0, 0);
  place(m, e, 0, -14, Math.PI);
  const mid = { x: me.pos.x, y: 0.05, z: me.pos.z - 7 };
  assert.ok(m.clearLine(eyePos(me), chestPos(e)), '연막 전에는 보임');
  m.zones.push({ id: 900, type: 'smoke', x: mid.x, y: mid.y, z: mid.z, radius: GEAR.smoke.radius, t: GEAR.smoke.time, duration: GEAR.smoke.time, age: 0 });
  step(m, 3);
  assert.equal(m.clearLine(eyePos(me), chestPos(e)), false, '연기 너머는 안 보임');
  // 최루 가스
  m.zones.push({ id: 901, type: 'gas', x: me.pos.x, y: 0, z: me.pos.z, radius: GEAR.gas.radius, t: GEAR.gas.time, duration: GEAR.gas.time, age: 0 });
  step(m, 1.5);
  assert.ok(me.gasT > 0, '가스 안');
});

test('C4: 벽에 붙이고 잠깐 뒤 기폭기로 터뜨림', () => {
  const m = live(9);
  freeze(m);
  const me = m.player;
  me.gear.c4 = 1;
  place(m, me, 0, 0, 0);
  me.pitch = -1.3; // 발밑 바닥을 봄
  m.equipGear(me, 'gadget');
  assert.equal(me.equip.kind, 'c4');
  assert.ok(m.placeCharge(me));
  assert.equal(m.charges.length, 1);
  assert.equal(me.equip.kind, 'det', '붙이면 기폭기');
  assert.equal(m.detonate(me), false, '붙인 직후는 안 됨');
  const e = m.agents.find((a) => a.team === TEAMS.FORCE);
  place(m, e, 2, 0);
  step(m, GEAR.c4.arm + 0.1);
  let det = null;
  m.events.on('detonate', (x) => (det = x));
  assert.ok(m.detonate(me));
  assert.equal(det.kind, 'c4');
  assert.ok(e.hp < 100, `근처 적 ${e.hp}`);
  assert.equal(m.charges.length, 0);
});
