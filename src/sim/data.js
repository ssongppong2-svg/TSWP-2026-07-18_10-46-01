// 총기와 포스 패치 정의. 과학 개념 설명은 중1 과학 「힘」 단원 내용을 기준으로 썼습니다.

export const WEAPONS = {
  rifle: {
    id: 'rifle',
    slot: 1,
    name: '벡터 R-24',
    kind: '소총',
    auto: true,
    rpm: 600,
    damage: 24,
    headMult: 2,
    magSize: 25,
    reserve: 75,
    reload: 2.2,
    speed: 160, // 투사체 속력(m/s)
    spreadBase: 0.004,
    spreadMove: 0.035,
    spreadAir: 0.08,
    bloomPerShot: 0.006,
    bloomMax: 0.04,
    bloomRecover: 0.15,
    recoilKick: 0.012,
    recoilMax: 0.09,
    recoilRecover: 0.25,
  },
  pistol: {
    id: 'pistol',
    slot: 2,
    name: '뉴턴 P-1',
    kind: '권총',
    auto: false,
    rpm: 400,
    damage: 20,
    headMult: 2,
    magSize: 12,
    reserve: 36,
    reload: 1.5,
    speed: 120,
    spreadBase: 0.005,
    spreadMove: 0.02,
    spreadAir: 0.06,
    bloomPerShot: 0.015,
    bloomMax: 0.035,
    bloomRecover: 0.12,
    recoilKick: 0.02,
    recoilMax: 0.06,
    recoilRecover: 0.3,
  },
};

export const WEAPON_ORDER = ['rifle', 'pistol'];

export const PATCH_TIERS = {
  normal: { name: '일반', color: '#8fb8ff' },
  special: { name: '특수', color: '#c48cff' },
  ultimate: { name: '필살', color: '#ffcf4a' },
};

export const PATCHES = {
  gravityVeil: {
    id: 'gravityVeil',
    name: '중력 강화장막',
    tier: 'normal',
    cooldown: 18,
    duration: 3,
    radius: 5,
    short: '3초 동안 주변 투사체 정지',
    desc: '3초 동안 내 주변(반경 5m)의 모든 투사체를 서서히 멈추게 해요. 장막이 사라지면 멈춘 투사체는 바닥으로 떨어져요. 장막 안에서는 내 총알도 멈춰요.',
    concept: '중력',
    conceptText:
      '중력은 지구가 물체를 당기는 힘이에요. 방향은 항상 지구 중심 쪽(아래)이고, 크기는 무게(N)로 나타내요. 장막이 끝나면 멈춰 있던 투사체가 아래로 떨어지는 것도 중력 때문이에요.',
  },
  elasticPad: {
    id: 'elasticPad',
    name: '탄성판',
    tier: 'normal',
    cooldown: 9,
    launchSpeed: 12,
    launchUp: 10.5,
    short: '탄성력으로 빠르게 도약',
    desc: '발밑에 탄성판을 펼쳐 바라보는 방향으로 빠르게 튀어 올라요. 높은 상자 위로도 올라갈 수 있어요.',
    concept: '탄성력',
    conceptText:
      '탄성력은 모양이 변한 물체가 원래 모양으로 되돌아가려는 힘이에요. 탄성체를 누른 방향과 반대 방향으로 작용하고, 많이 변형될수록 커져요. 눌렸던 탄성판이 펴지면서 몸을 위로 밀어 올려요.',
  },
  resultantAmp: {
    id: 'resultantAmp',
    name: '합력 강화장치',
    tier: 'normal',
    cooldown: 18,
    duration: 5,
    bonus: 3,
    short: '5초 동안 소총 공격력 +3',
    desc: '5초 동안 소총 공격력이 3 올라가요(24 → 27). 몸통 5발이 필요하던 적을 4발로 쓰러뜨릴 수 있어요.',
    concept: '합력',
    conceptText:
      '여러 힘이 함께 작용할 때 같은 효과를 내는 하나의 힘을 합력이라고 해요. 같은 방향으로 작용하는 두 힘의 합력은 두 힘의 크기를 더한 값이에요. 24 N과 3 N이 같은 방향이면 합력은 27 N!',
  },
  frictionZero: {
    id: 'frictionZero',
    name: '마찰 제로 필드',
    tier: 'special',
    cooldown: 28,
    duration: 6,
    radius: 5,
    range: 25,
    short: '6초 동안 적을 미끄러지게 함',
    desc: '조준한 바닥(최대 25m)에 6초 동안 마찰력이 0인 구역을 만들어요. 구역 안의 적은 미끄러져서 마음대로 멈추거나 방향을 바꾸지 못해요.',
    concept: '마찰력',
    conceptText:
      '마찰력은 맞닿은 두 면 사이에서 물체의 운동을 방해하는 힘이에요. 운동 방향과 반대로 작용하고, 면이 거칠수록·무게가 클수록 커요. 마찰력이 0이면 움직이던 물체는 멈추지 못하고 계속 미끄러져요.',
  },
  gravityCollapse: {
    id: 'gravityCollapse',
    name: '중력 붕괴',
    tier: 'ultimate',
    radius: 8,
    range: 35,
    pullTime: 0.8,
    holdTime: 3,
    short: '적을 끌어당겨 3초 묶기',
    desc: '조준한 지점(최대 35m)에 아주 강한 중력을 만들어 반경 8m 안의 적을 끌어당기고 3초 동안 묶어둬요. 처치·피해·해체로 게이지를 100% 채워야 쓸 수 있어요.',
    concept: '중력',
    conceptText:
      '질량이 있는 물체는 서로 끌어당겨요. 지구처럼 질량이 아주 큰 물체일수록 더 세게 당기죠. 중력 붕괴는 한 점에 엄청나게 큰 중력을 만들어 주변의 적을 끌어당겨요.',
  },
};

export const PATCH_ORDER = ['gravityVeil', 'elasticPad', 'resultantAmp', 'frictionZero', 'gravityCollapse'];

// 합력 락픽 설명 (결과 화면/락픽 화면에서 사용)
export const LOCKPICK_CONCEPT = {
  concept: '힘의 합성',
  conceptText:
    '같은 방향으로 작용하는 두 힘은 크기를 더하고, 반대 방향으로 작용하는 두 힘은 큰 힘에서 작은 힘을 빼요. 이때 합력의 방향은 큰 힘의 방향이에요.',
};
