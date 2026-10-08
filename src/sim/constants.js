// 게임 전체에서 쓰는 수치. 밸런스는 대부분 이 파일과 data.js에서 조정한다.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const CELL = 2; // 맵 한 칸 = 2m

export const TEAM_SIZE = 5;
export const ROUND_TIME = 120; // 폭탄 폭발까지 2분
export const PRE_ROUND_TIME = 4; // 작전 개시 전 대기 (한 판짜리 규칙)
export const DRAFT_TIME = 20; // 포스 패치 선택 시간

// 라운드제 (발로란트식): 7라운드 먼저 이기면 승리, 6라운드가 끝나면 공수 교대
export const ROUNDS = {
  winTo: 7,
  half: 6,
  buyTime: 15, // 구매 시간 (시작 구역 밖으로 못 나감)
  buyTimeFirst: 20, // 각 전반·후반 첫 라운드
  endTime: 5, // 라운드 결과를 보여 주는 시간
  halftimeTime: 7,
};

// 크레딧: 처치·해체·라운드 결과로 받고, 구매 시간에 상점에서 씀
export const ECON = {
  start: 800,
  max: 9000,
  win: 3000,
  loss: [1900, 2400, 2900], // 연패할수록 더 받음
  kill: 200,
  defuse: 300,
};

export const TEAMS = { DEFUSE: 'defuse', FORCE: 'force' };

export const TEAM_INFO = {
  defuse: {
    name: '해체팀',
    code: 'DEFUSAL',
    color: '#5ec4d6',
    goal: '2분 안에 폭탄 2기 해체 또는 포스팀 전원 제압.',
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
  heightStand: 1.85, // 머리 끝 (천장 충돌)
  heightCrouch: 1.3,
  chestStand: 1.15,
  chestCrouch: 0.78,
  headRadius: 0.2,
  bodyHalf: 0.3,
  maxHp: 100,
  // 이동: 빠르고 바로 서는 발로란트식 (멈추면 첫 발이 정확해짐)
  runSpeed: 5.2,
  walkSpeed: 2.6,
  crouchSpeed: 1.9,
  adsSpeedMult: 0.72,
  knifeSpeedMult: 1.1,
  leanSpeedMult: 0.75,
  accel: 13,
  decel: 18,
  airAccel: 4,
  slipAccel: 2.2, // 마찰력 0 구역: 바닥을 밀 수 없어 거의 가속이 안 됨
  slipMaxSpeed: 10,
  miredMult: 0.3, // 마찰 폭풍 구역: 이동 속도 70% 감소
  jumpSpeed: 5.4,
  gravity: 18,
  stepHeight: 0.4,
  crouchRate: 7,
  leanRate: 6,
  leanOffset: 0.42,
  tagSlow: 0.6, // 피격 시 잠깐 느려짐
  tagTime: 0.35,
  stride: 1.9, // 발걸음 한 번의 거리(m)
  quietSpeed: 3.0, // 이보다 느리면 발소리가 거의 나지 않음 (보행·앉아 걷기)
};

// 소리: 적이 들을 수 있는 거리(m). 정보는 소리로만 얻는다.
export const NOISE = {
  rifle: 75,
  pistol: 60,
  sheriff: 70,
  shotgun: 70,
  smg: 65,
  sniper: 90,
  step: 18,
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
