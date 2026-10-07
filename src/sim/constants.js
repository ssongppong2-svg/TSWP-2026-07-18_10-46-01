// 게임 전체에서 쓰는 수치. 밸런스는 대부분 이 파일과 data.js에서 조정한다.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const CELL = 2; // 맵 한 칸 = 2m

export const TEAM_SIZE = 5;
export const ROUND_TIME = 120; // 폭탄 폭발까지 2분
export const PRE_ROUND_TIME = 4; // 작전 개시 전 대기
export const DRAFT_TIME = 20; // 포스 패치 선택 시간

export const TEAMS = { DEFUSE: 'defuse', FORCE: 'force' };

export const TEAM_INFO = {
  defuse: {
    name: '해체팀',
    code: 'DEFUSAL',
    color: '#5ec4d6',
    goal: '제한 시간 2분 내 폭탄 2기 해체.',
  },
  force: {
    name: '포스팀',
    code: 'FORCE',
    color: '#e08a3c',
    goal: '해체팀 전원 제압 또는 2분간 폭탄 방어.',
  },
};

export const otherTeam = (team) => (team === TEAMS.DEFUSE ? TEAMS.FORCE : TEAMS.DEFUSE);

export const PLAYER = {
  radius: 0.35,
  eyeStand: 1.62,
  eyeCrouch: 1.12,
  bodyTopStand: 1.42,
  bodyTopCrouch: 0.95,
  chestStand: 1.15,
  chestCrouch: 0.78,
  headRadius: 0.2,
  bodyHalf: 0.3,
  maxHp: 100,
  // 이동: 장비를 멘 사람의 속도 (가속·감속에 관성이 있음)
  runSpeed: 3.6,
  walkSpeed: 1.75,
  crouchSpeed: 1.25,
  adsSpeedMult: 0.55,
  knifeSpeedMult: 1.08,
  leanSpeedMult: 0.7,
  accel: 5,
  decel: 7.5,
  airAccel: 3,
  slipAccel: 2.2, // 마찰력 0 구역: 바닥을 밀 수 없어 거의 가속이 안 됨
  slipMaxSpeed: 10,
  miredMult: 0.3, // 마찰 폭풍 구역: 이동 속도 70% 감소
  jumpSpeed: 5.0,
  gravity: 18,
  stepHeight: 0.4,
  crouchRate: 7,
  leanRate: 6,
  leanOffset: 0.42,
  tagSlow: 0.45, // 피격 시 잠깐 느려짐
  tagTime: 0.45,
  stride: 1.55, // 발걸음 한 번의 거리(m)
  quietSpeed: 2.2, // 이보다 느리면 발소리가 거의 나지 않음 (보행·앉아 걷기)
};

// 소리: 적이 들을 수 있는 거리(m). 정보는 소리로만 얻는다.
export const NOISE = {
  rifle: 75,
  pistol: 60,
  step: 15,
  land: 20,
  reload: 7,
  swap: 4,
  knife: 6,
  patch: 18,
  lockpick: 10,
  rainMult: 0.8, // 비가 오면 작은 소리는 덜 들림 (총성 제외)
  memory: 1.5, // 소리 기록 보관 시간(초)
};

export const BOMB = {
  interactRange: 2.2,
  turnTime: 1.0, // 합력을 맞춘 뒤 자물쇠가 돌아가는 시간
  botTimeMin: 7, // 봇의 해체 시간 (사람이 합력 퍼즐을 푸는 시간과 비슷하게)
  botTimeMax: 11,
};

export const ULT = {
  max: 100,
  start: 20,
  perSecond: 0.5,
  perDamage: 0.15,
  perKill: 35,
  perDefuse: 35,
};

export const PROJECTILE = {
  life: 1.2,
  harmlessSpeed: 30, // 이보다 느려진 투사체는 피해 없음
  veilDrag: 55, // 중력 강화장막 안에서의 감속 정도
  debrisLife: 4,
  bounceKeep: 0.85, // 도탄 후 남는 속도·피해 비율
};

// 봇 콜사인 (과학자 이름)
export const BOT_NAMES = {
  defuse: ['뉴턴', '갈릴레이', '훅', '케플러', '아르키메데스'],
  force: ['패러데이', '파스칼', '줄', '와트', '쿨롱'],
};
