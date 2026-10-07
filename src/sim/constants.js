// 게임 전체에서 쓰는 수치. 밸런스를 바꾸고 싶으면 대부분 이 파일과 data.js만 고치면 됩니다.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const CELL = 2; // 맵 한 칸 = 2m

export const TEAM_SIZE = 5;
export const ROUND_TIME = 120; // 폭탄이 터지기까지 2분
export const PRE_ROUND_TIME = 3; // 시작 전 카운트다운
export const DRAFT_TIME = 15; // 포스 패치 선택 시간

export const TEAMS = { DEFUSE: 'defuse', FORCE: 'force' };

export const TEAM_INFO = {
  defuse: {
    name: '해체팀',
    color: '#3fd8ff',
    goal: '2분 안에 폭탄 2개의 자물쇠를 합력으로 풀어 해체하세요.',
  },
  force: {
    name: '포스팀',
    color: '#ff7a2f',
    goal: '해체팀을 모두 막으세요. 2분을 버티면 폭탄이 터집니다.',
  },
};

export const otherTeam = (team) => (team === TEAMS.DEFUSE ? TEAMS.FORCE : TEAMS.DEFUSE);

export const PLAYER = {
  radius: 0.35,
  height: 1.8,
  eye: 1.6,
  headY: 1.62,
  headRadius: 0.22,
  bodyTop: 1.42,
  bodyHalf: 0.32,
  maxHp: 100,
  runSpeed: 6.0,
  walkSpeed: 3.2,
  groundAccel: 14,
  airAccel: 9,
  slipAccel: 2.2, // 마찰력 0 구역: 발로 바닥을 밀 수 없어서 거의 가속이 안 됨
  slipMaxSpeed: 12,
  jumpSpeed: 6.6,
  gravity: 18,
  stepHeight: 0.4,
};

export const SWAP_TIME = 0.35;

export const BOMB = {
  interactRange: 2.2,
  turnTime: 1.0, // 합력을 맞춘 뒤 자물쇠가 돌아가는 시간
  botTimeMin: 5,
  botTimeMax: 8,
};

export const ULT = {
  max: 100,
  start: 25,
  perSecond: 0.6,
  perDamage: 0.15,
  perKill: 40,
  perDefuse: 40,
};

export const PROJECTILE = {
  life: 1.2,
  harmlessSpeed: 30, // 이보다 느려진 투사체는 피해를 주지 않음
  veilDrag: 55, // 중력 강화장막 안에서의 감속 정도
  debrisLife: 4,
};

export const BOT_NAMES = {
  defuse: ['뉴턴', '갈릴레이', '훅', '케플러', '아르키메데스'],
  force: ['패러데이', '파스칼', '줄', '와트', '쿨롱'],
};
