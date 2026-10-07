import { PLAYER, ULT } from './constants.js';
import { WEAPONS } from './data.js';

// 플레이어와 봇이 똑같이 쓰는 "요원" 데이터. 조종은 controller(사람 입력 / 봇 AI / 나중엔 네트워크)가 합니다.
export function createAgent({ id, name, team, isPlayer = false, spawn, yaw = 0, loadout = [] }) {
  const pos = { x: spawn.x, y: 0, z: spawn.z };
  return {
    id,
    name,
    team,
    isPlayer,
    alive: true,
    hp: PLAYER.maxHp,
    pos,
    prev: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    onGround: true,
    weapons: {
      rifle: { mag: WEAPONS.rifle.magSize, reserve: WEAPONS.rifle.reserve },
      pistol: { mag: WEAPONS.pistol.magSize, reserve: WEAPONS.pistol.reserve },
    },
    weapon: 'rifle',
    fireCd: 0,
    reloadT: 0,
    swapT: 0,
    bloom: 0,
    recoil: 0,
    sinceShot: 99,
    triggerLatch: false,
    patches: loadout.map((pid) => ({ id: pid, cd: 0, activeT: 0 })),
    ult: ULT.start,
    ampT: 0,
    slippery: false,
    held: null,
    lockpick: null,
    lastHurtT: -99,
    lastHurtBy: null,
    deadT: 0,
    spottedT: -99,
    stats: { kills: 0, deaths: 0, damage: 0, defuses: 0, patchUses: 0, headshots: 0 },
  };
}

export function emptyIntent(agent) {
  return {
    moveX: 0,
    moveZ: 0,
    walk: false,
    jump: false,
    yaw: agent.yaw,
    pitch: agent.pitch,
    fire: false,
    reload: false,
    switchTo: null,
    patch: [false, false],
    interact: false,
    card: -1,
  };
}

export const eyePos = (a) => ({ x: a.pos.x, y: a.pos.y + PLAYER.eye, z: a.pos.z });
export const chestPos = (a) => ({ x: a.pos.x, y: a.pos.y + 1.15, z: a.pos.z });

// 이동 물리: 바닥 마찰, 공중 제어, 중력, 벽 충돌
export function stepMovement(agent, intent, map, dt, canMove) {
  const P = PLAYER;
  const vel = agent.vel;
  agent.prev.x = agent.pos.x;
  agent.prev.y = agent.pos.y;
  agent.prev.z = agent.pos.z;

  if (agent.held) {
    // 중력 붕괴에 붙잡힘: 붙잡힌 지점으로 끌려가서 떠 있음
    const h = agent.held;
    const dx = h.x - agent.pos.x, dy = h.y - agent.pos.y, dz = h.z - agent.pos.z;
    const d = Math.hypot(dx, dy, dz);
    const speed = Math.min(14, d * 7);
    if (d > 0.02) {
      vel.x = (dx / d) * speed;
      vel.y = (dy / d) * speed;
      vel.z = (dz / d) * speed;
    } else {
      vel.x = vel.y = vel.z = 0;
    }
    agent.pos.x += vel.x * dt;
    agent.pos.z += vel.z * dt;
    map.collideCircle(agent.pos, P.radius, agent.pos.y, P.stepHeight, vel);
    agent.pos.y += vel.y * dt;
    const g = map.groundHeight(agent.pos.x, agent.pos.z, P.radius * 0.95, agent.prev.y + P.stepHeight);
    if (agent.pos.y < g) agent.pos.y = g;
    agent.onGround = false;
    return;
  }

  let mx = canMove ? intent.moveX : 0;
  let mz = canMove ? intent.moveZ : 0;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  }
  const sin = Math.sin(agent.yaw), cos = Math.cos(agent.yaw);
  const wx = -sin * mz + cos * mx;
  const wz = -cos * mz - sin * mx;
  const speed = intent.walk ? P.walkSpeed : P.runSpeed;

  if (agent.onGround) {
    if (agent.slippery) {
      vel.x += wx * P.slipAccel * dt;
      vel.z += wz * P.slipAccel * dt;
      const hs = Math.hypot(vel.x, vel.z);
      if (hs > P.slipMaxSpeed) {
        vel.x *= P.slipMaxSpeed / hs;
        vel.z *= P.slipMaxSpeed / hs;
      }
    } else {
      const k = 1 - Math.exp(-P.groundAccel * dt);
      vel.x += (wx * speed - vel.x) * k;
      vel.z += (wz * speed - vel.z) * k;
    }
    if (canMove && intent.jump) {
      vel.y = P.jumpSpeed;
      agent.onGround = false;
    }
  } else if (ml > 0.01) {
    // 공중: 원하는 방향으로 약간만 조종. 탄성판으로 얻은 빠른 속도는 유지됨.
    const before = Math.hypot(vel.x, vel.z);
    vel.x += wx * P.airAccel * dt;
    vel.z += wz * P.airAccel * dt;
    const after = Math.hypot(vel.x, vel.z);
    const cap = Math.max(before, speed);
    if (after > cap) {
      vel.x *= cap / after;
      vel.z *= cap / after;
    }
  }

  vel.y -= P.gravity * dt;

  agent.pos.x += vel.x * dt;
  agent.pos.z += vel.z * dt;
  map.collideCircle(agent.pos, P.radius, agent.pos.y, P.stepHeight, vel);

  agent.pos.y += vel.y * dt;
  const ground = map.groundHeight(agent.pos.x, agent.pos.z, P.radius * 0.95, agent.prev.y + P.stepHeight);
  if (agent.pos.y <= ground) {
    agent.pos.y = ground;
    if (vel.y < 0) vel.y = 0;
    agent.onGround = true;
  } else if (agent.onGround && vel.y <= 0 && agent.pos.y - ground < 0.15) {
    agent.pos.y = ground;
    vel.y = 0;
  } else {
    agent.onGround = false;
  }
}
