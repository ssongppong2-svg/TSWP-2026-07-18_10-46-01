import { SLIDE } from './devices.js';
import { PLAYER, ULT } from './constants.js';
import { LOADOUT_SLOTS, WEAPONS } from './data.js';

const lerp = (a, b, t) => a + (b - a) * t;

// 새 총 한 자루의 탄 (탄창 가득 + 예비탄)
export const freshAmmo = (id) => ({ mag: WEAPONS[id].magSize ?? 0, reserve: WEAPONS[id].reserve ?? 0 });

// 총을 손에 넣음: 같은 칸(주무기·보조무기)에 있던 총은 버림
export function giveWeapon(a, id) {
  const w = WEAPONS[id];
  const old = a[w.slot];
  if (old && old !== id) delete a.weapons[old];
  a[w.slot] = id;
  a.weapons[id] = freshAmmo(id);
}

// 플레이어와 봇이 똑같이 쓰는 "요원" 데이터. 조종은 controller(사람 입력 / 봇 AI / 나중엔 네트워크)가 한다.
// kit: 'full' 소총+권총으로 시작 (한 판짜리 규칙) / 'pistol' 권총만 (라운드제: 상점에서 삼)
export function createAgent({ id, name, team, isPlayer = false, spawn, yaw = 0, loadout = [], kit = 'full' }) {
  const pos = { x: spawn.x, y: 0, z: spawn.z };
  const full = kit === 'full';
  return {
    id,
    name,
    team, // 지금 맡은 쪽 (해체/포스) — 전반이 끝나면 바뀜
    squad: team, // 소속 분대 (끝까지 그대로, 점수·색은 이것으로)
    isPlayer,
    alive: true,
    hp: PLAYER.maxHp,
    pos,
    prev: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    onGround: true,
    crouch: 0, // 0 서 있음 ~ 1 앉음
    lean: 0, // -1 왼쪽 ~ 1 오른쪽
    leanOffset: 0, // 벽에 막힌 것까지 반영한 실제 옆 이동(m)
    ads: false,
    adsT: 0,
    weapons: full ? { rifle: freshAmmo('rifle'), pistol: freshAmmo('pistol'), knife: { mag: 0, reserve: 0 } } : { pistol: freshAmmo('pistol'), knife: { mag: 0, reserve: 0 } },
    primary: full ? 'rifle' : null,
    secondary: 'pistol',
    weapon: full ? 'rifle' : 'pistol',
    armor: 0, // 방탄 (체력보다 먼저 깎임)
    armorMax: 0,
    credits: 0,
    fireCd: 0,
    reloadT: 0,
    swapT: 0,
    bloom: 0,
    recoil: 0,
    recoilYaw: 0,
    sprayIndex: 0,
    punch: 0, // 피격 시 조준이 튀는 양
    tagT: 0, // 피격 시 잠깐 느려지는 시간
    sinceShot: 99,
    triggerLatch: false,
    adsLatch: false,
    meleeCd: 0,
    patches: LOADOUT_SLOTS.map((_, i) => (loadout[i] ? { id: loadout[i], cd: 0, activeT: 0 } : null)),
    ult: ULT.start,
    ampT: 0,
    bounceT: 0,
    slippery: false,
    mired: false,
    held: null,
    lockpick: null,
    revealedUntil: -99,
    lastHurtT: -99,
    lastHurtBy: null,
    deadT: 0,
    spottedT: -99,
    stats: { kills: 0, deaths: 0, damage: 0, defuses: 0, patchUses: 0, headshots: 0, assists: 0 },
    round: { kills: 0, damage: 0, by: {} }, // 이번 라운드 기록 (by: 나에게 피해를 준 요원별 피해량)
  };
}

export function emptyIntent(agent) {
  return {
    moveX: 0,
    moveZ: 0,
    walk: false,
    jump: false,
    crouch: false,
    lean: 0,
    ads: false,
    yaw: agent.yaw,
    pitch: agent.pitch,
    fire: false,
    reload: false,
    switchTo: null,
    buy: null, // 상점: 무기 id 또는 'light'·'heavy' (같은 것을 다시 사면 이번 구매 시간 안에서 환불)
    patch: [false, false, false, false],
    interact: false,
    card: -1,
    command: null, // 지휘 명령 { type } (분대장만)
    report: false, // 적 보고: 조준한 곳을 무전으로 알림
  };
}

// 눈(=머리 중심) 위치: 앉기·기울이기 반영
export function eyePos(a) {
  const off = a.leanOffset ?? 0;
  return {
    x: a.pos.x + Math.cos(a.yaw) * off,
    y: a.pos.y + lerp(PLAYER.eyeStand, PLAYER.eyeCrouch, a.crouch ?? 0) - Math.abs(off) * 0.12,
    z: a.pos.z - Math.sin(a.yaw) * off,
  };
}

export const chestPos = (a) => ({ x: a.pos.x, y: a.pos.y + lerp(PLAYER.chestStand, PLAYER.chestCrouch, a.crouch ?? 0), z: a.pos.z });
// 머리 끝까지의 키 (천장·벽 충돌용)
export const bodyHeight = (a) => lerp(PLAYER.heightStand, PLAYER.heightCrouch, a.crouch ?? 0);
export const bodyTop = (a) => lerp(PLAYER.bodyTopStand, PLAYER.bodyTopCrouch, a.crouch ?? 0);

export function moveSpeed(a, intent) {
  const P = PLAYER;
  const w = WEAPONS[a.weapon];
  let s = intent.walk ? P.walkSpeed : P.runSpeed;
  if (a.crouch > 0.5) s = Math.min(s, P.crouchSpeed);
  if (a.adsT > 0.5) s *= w?.adsMoveMult ?? P.adsSpeedMult;
  if (a.weapon === 'knife') s *= P.knifeSpeedMult;
  else s *= w?.moveMult ?? 1;
  if (Math.abs(a.lean) > 0.3) s *= P.leanSpeedMult;
  if (a.tagT > 0) s *= P.tagSlow;
  if (a.mired) s *= P.miredMult;
  return s;
}

// 이동 물리: 관성 있는 가속·감속, 앉기·기울이기, 중력, 벽 충돌
export function stepMovement(agent, intent, map, dt, canMove) {
  const P = PLAYER;
  const vel = agent.vel;
  agent.prev.x = agent.pos.x;
  agent.prev.y = agent.pos.y;
  agent.prev.z = agent.pos.z;

  // 앉기
  const crouchTarget = intent.crouch && !agent.held && agent.alive ? 1 : 0;
  const cr = P.crouchRate * dt;
  agent.crouch += Math.max(-cr, Math.min(cr, crouchTarget - agent.crouch));

  // 기울이기 (공중·구속 중에는 불가). 벽에 막히면 그만큼만 기울어짐.
  const leanTarget = canMove && agent.onGround && !agent.held ? Math.max(-1, Math.min(1, intent.lean || 0)) : 0;
  const lr = P.leanRate * dt;
  agent.lean += Math.max(-lr, Math.min(lr, leanTarget - agent.lean));
  agent.leanOffset = 0;
  if (Math.abs(agent.lean) > 0.01) {
    const want = agent.lean * P.leanOffset;
    const y = agent.pos.y + P.eyeStand - (P.eyeStand - P.eyeCrouch) * agent.crouch;
    const from = { x: agent.pos.x, y, z: agent.pos.z };
    const to = { x: from.x + Math.cos(agent.yaw) * (want + Math.sign(want) * 0.15), y, z: from.z - Math.sin(agent.yaw) * (want + Math.sign(want) * 0.15) };
    const hit = map.raycast(from, to);
    const reach = hit ? Math.max(0, hit.t * (Math.abs(want) + 0.15) - 0.15) : Math.abs(want);
    agent.leanOffset = Math.sign(want) * Math.min(Math.abs(want), reach);
  }

  if (agent.held) {
    // 중력 붕괴·탄성 그물에 붙잡힘: 붙잡힌 지점으로 끌려가 떠 있음
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
    map.collideCircle(agent.pos, P.radius, agent.pos.y, P.stepHeight, vel, bodyHeight(agent));
    agent.pos.y += vel.y * dt;
    const g = map.groundHeight(agent.pos.x, agent.pos.z, P.radius * 0.95, agent.prev.y + P.stepHeight);
    if (agent.pos.y < g) agent.pos.y = g;
    const ceil = map.ceilingHeight(agent.pos.x, agent.pos.z, P.radius * 0.9, agent.prev.y + 0.5);
    if (agent.pos.y + bodyHeight(agent) > ceil) agent.pos.y = Math.max(g, ceil - bodyHeight(agent));
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
  // 밀려는 방향 (상자 밀기에 씀)
  agent.wish = { x: wx, z: wz };
  const speed = moveSpeed(agent, intent);

  const slide = agent.onGround ? map.slideAt?.(agent.pos.x, agent.pos.z) : null;
  if (slide) {
    // 마찰 미끄럼틀: 마찰력이 거의 없어 내려가는 쪽으로 계속 빨라지고, 거슬러 오를 수 없음 (옆으로만 조금 조종)
    const along = vel.x * slide.x + vel.z * slide.z;
    const side = { x: -slide.z, z: slide.x };
    const sideIn = wx * side.x + wz * side.z;
    const sideV = vel.x * side.x + vel.z * side.z;
    const down = Math.min(SLIDE.maxSpeed, Math.max(0, along) + SLIDE.accel * dt);
    const lateral = sideV + (sideIn * SLIDE.control - sideV) * Math.min(1, dt * 6);
    vel.x = slide.x * down + side.x * lateral;
    vel.z = slide.z * down + side.z * lateral;
  } else if (agent.onGround) {
    if (agent.slippery) {
      vel.x += wx * P.slipAccel * dt;
      vel.z += wz * P.slipAccel * dt;
      const hs = Math.hypot(vel.x, vel.z);
      if (hs > P.slipMaxSpeed) {
        vel.x *= P.slipMaxSpeed / hs;
        vel.z *= P.slipMaxSpeed / hs;
      }
    } else {
      // 원하는 속도로 다가가되, 빨라질 때는 accel, 느려질 때는 decel 비율 (관성)
      const tx = wx * speed, tz = wz * speed;
      const speeding = tx * vel.x + tz * vel.z > 0 && Math.hypot(tx, tz) >= Math.hypot(vel.x, vel.z);
      const k = 1 - Math.exp(-(speeding ? P.accel : P.decel) * dt);
      vel.x += (tx - vel.x) * k;
      vel.z += (tz - vel.z) * k;
    }
    if (canMove && intent.jump && agent.crouch < 0.5 && !agent.mired) {
      vel.y = P.jumpSpeed;
      agent.onGround = false;
    }
  } else if (ml > 0.01) {
    // 공중: 원하는 방향으로 약간만 조종. 탄성판으로 얻은 빠른 속도는 유지.
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
  const bodyH = bodyHeight(agent);
  map.collideCircle(agent.pos, P.radius, agent.pos.y, P.stepHeight, vel, bodyH);

  agent.pos.y += vel.y * dt;
  // 천장(2층 바닥판 아래·문틀)에 머리가 닿으면 더 오르지 못함
  if (vel.y > 0) {
    const ceil = map.ceilingHeight(agent.pos.x, agent.pos.z, P.radius * 0.9, agent.prev.y + 0.5);
    if (agent.pos.y + bodyH > ceil) {
      agent.pos.y = Math.max(agent.prev.y, ceil - bodyH);
      vel.y = 0;
    }
  }
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
