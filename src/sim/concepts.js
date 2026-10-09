// 중1 과학 「힘」 단원 개념 카드와 점검 문항.
// 경기 중 맵에 놓인 개념 카드를 주우면 도감에 기록되고, 경기가 끝나면 주운 카드로 점검 문제를 푼다.
// q: 문제, choices: 보기, answer: 정답 번호(0부터), why: 해설
export const CONCEPTS = [
  {
    id: 'force',
    name: '힘',
    icon: 'force',
    text: '물체의 모양이나 운동 상태(빠르기·방향)를 변하게 하는 원인. 단위는 N(뉴턴).',
    q: '힘의 단위로 알맞은 것은?',
    choices: ['kg', 'N', 'm/s', 'J'],
    answer: 1,
    why: '힘의 크기는 N(뉴턴)으로 나타낸다. kg은 질량의 단위이다.',
  },
  {
    id: 'forceArrow',
    name: '힘의 표현',
    icon: 'arrow',
    text: '힘은 화살표로 나타낸다. 화살표의 길이 = 힘의 크기, 방향 = 힘의 방향, 시작점 = 작용점.',
    q: '힘을 화살표로 나타낼 때 화살표의 길이가 뜻하는 것은?',
    choices: ['힘의 방향', '힘의 작용점', '힘의 크기', '물체의 질량'],
    answer: 2,
    why: '화살표의 길이는 힘의 크기, 화살표의 방향은 힘의 방향, 시작점은 작용점이다.',
  },
  {
    id: 'forceEffects',
    name: '힘의 효과',
    icon: 'effects',
    text: '물체에 힘이 작용하면 모양이 변하거나, 빠르기나 운동 방향이 변한다.',
    q: '다음 중 힘이 작용하여 물체의 운동 방향이 바뀐 예는?',
    choices: ['찰흙을 손으로 누른다', '날아오는 공을 배트로 친다', '고무줄을 잡아 늘인다', '풍선을 손으로 누른다'],
    answer: 1,
    why: '배트에 맞은 공은 운동 방향이 바뀐다. 나머지는 모양이 변하는 예이다.',
  },
  {
    id: 'gravity',
    name: '중력',
    icon: 'gravity',
    text: '지구가 물체를 끌어당기는 힘. 방향은 항상 지구 중심 쪽(연직 아래).',
    q: '중력의 방향으로 알맞은 것은?',
    choices: ['물체가 움직이는 방향', '지구 중심 방향', '물체가 움직이는 반대 방향', '항상 수평 방향'],
    answer: 1,
    why: '중력은 지구가 물체를 끌어당기는 힘으로, 언제나 지구 중심 방향으로 작용한다.',
  },
  {
    id: 'weightMass',
    name: '무게와 질량',
    icon: 'scale',
    text: '무게는 물체에 작용하는 중력의 크기(N), 질량은 물체의 고유한 양(kg). 질량 1 kg인 물체의 무게는 약 9.8 N.',
    q: '질량이 2 kg인 물체의 지구에서의 무게는 약 몇 N인가?',
    choices: ['2 N', '9.8 N', '19.6 N', '98 N'],
    answer: 2,
    why: '질량 1 kg의 무게가 약 9.8 N이므로 2 kg은 약 19.6 N이다.',
  },
  {
    id: 'moonWeight',
    name: '달에서의 무게',
    icon: 'moon',
    text: '달의 중력은 지구의 약 1/6. 달에서 무게는 1/6로 줄지만 질량은 그대로이다.',
    q: '지구에서 무게가 60 N인 물체를 달에 가져가면?',
    choices: ['무게 60 N, 질량 줄어듦', '무게 10 N, 질량 그대로', '무게 10 N, 질량 1/6', '무게 360 N, 질량 그대로'],
    answer: 1,
    why: '달의 중력은 지구의 약 1/6이므로 무게는 10 N이 되고, 질량은 장소에 따라 변하지 않는다.',
  },
  {
    id: 'elastic',
    name: '탄성력',
    icon: 'spring',
    text: '변형된 물체가 원래 모양으로 되돌아가려는 힘. 방향은 물체를 변형시킨 힘과 반대.',
    q: '용수철을 오른쪽으로 잡아당겨 늘였을 때 탄성력의 방향은?',
    choices: ['오른쪽', '왼쪽', '위쪽', '탄성력은 생기지 않는다'],
    answer: 1,
    why: '탄성력은 변형시킨 힘(오른쪽)과 반대 방향(왼쪽)으로 작용한다.',
  },
  {
    id: 'springScale',
    name: '용수철저울',
    icon: 'springScale',
    text: '용수철이 늘어난 길이는 매단 물체의 무게에 비례한다. 이 성질로 무게를 잰다.',
    q: '10 N짜리 추를 매달면 2 cm 늘어나는 용수철에 30 N짜리 추를 매달면?',
    choices: ['2 cm', '3 cm', '6 cm', '30 cm'],
    answer: 2,
    why: '늘어난 길이는 무게에 비례하므로 무게가 3배이면 3배인 6 cm 늘어난다.',
  },
  {
    id: 'friction',
    name: '마찰력',
    icon: 'friction',
    text: '두 물체의 접촉면에서 물체의 운동을 방해하는 힘. 방향은 물체가 움직이려는 방향과 반대.',
    q: '책상 위에서 상자를 오른쪽으로 밀 때, 마찰력의 방향은?',
    choices: ['오른쪽', '왼쪽', '위쪽', '아래쪽'],
    answer: 1,
    why: '마찰력은 물체가 움직이려는 방향(오른쪽)과 반대 방향(왼쪽)으로 작용한다.',
  },
  {
    id: 'frictionFactors',
    name: '마찰력의 크기',
    icon: 'friction2',
    text: '접촉면이 거칠수록, 물체의 무게가 무거울수록 마찰력이 크다. 접촉면의 넓이와는 관계없다.',
    q: '마찰력을 크게 하는 방법으로 알맞은 것은?',
    choices: ['접촉면을 매끄럽게 한다', '물체를 가볍게 한다', '접촉면을 거칠게 한다', '바퀴를 단다'],
    answer: 2,
    why: '접촉면이 거칠수록 마찰력이 크다. 등산화 바닥의 홈이 그 예이다.',
  },
  {
    id: 'buoyancy',
    name: '부력',
    icon: 'buoy',
    text: '액체나 기체가 그 속에 있는 물체를 위로 밀어 올리는 힘. 방향은 중력과 반대(위쪽).',
    q: '부력의 방향으로 알맞은 것은?',
    choices: ['아래쪽', '위쪽', '물이 흐르는 방향', '물체가 움직이는 방향'],
    answer: 1,
    why: '부력은 중력과 반대 방향인 위쪽으로 작용한다.',
  },
  {
    id: 'buoyancySize',
    name: '부력의 크기',
    icon: 'buoy2',
    text: '부력의 크기 = 공기 중에서 잰 무게 − 물속에서 잰 무게.',
    q: '공기 중에서 5 N, 물속에서 3 N인 물체가 받는 부력은?',
    choices: ['2 N', '3 N', '5 N', '8 N'],
    answer: 0,
    why: '부력 = 공기 중 무게 − 물속 무게 = 5 N − 3 N = 2 N.',
  },
  {
    id: 'resultantSame',
    name: '합력 (같은 방향)',
    icon: 'resultant',
    text: '같은 방향으로 작용하는 두 힘의 합력: 크기는 두 힘의 합, 방향은 두 힘의 방향.',
    q: '오른쪽으로 3 N, 오른쪽으로 4 N의 힘이 작용할 때 합력은?',
    choices: ['오른쪽 1 N', '오른쪽 7 N', '왼쪽 7 N', '0 N'],
    answer: 1,
    why: '같은 방향이므로 3 N + 4 N = 7 N, 방향은 오른쪽이다.',
  },
  {
    id: 'resultantOpposite',
    name: '합력 (반대 방향)',
    icon: 'resultant2',
    text: '반대 방향으로 작용하는 두 힘의 합력: 크기는 큰 힘 − 작은 힘, 방향은 큰 힘의 방향.',
    q: '오른쪽으로 10 N, 왼쪽으로 4 N의 힘이 작용할 때 합력은?',
    choices: ['오른쪽 6 N', '왼쪽 6 N', '오른쪽 14 N', '왼쪽 14 N'],
    answer: 0,
    why: '반대 방향이므로 10 N − 4 N = 6 N, 방향은 큰 힘인 오른쪽이다.',
  },
  {
    id: 'equilibrium',
    name: '힘의 평형',
    icon: 'balance',
    text: '한 물체에 작용하는 힘들의 합력이 0인 상태. 두 힘이 평형이면 크기가 같고 방향이 반대이며 같은 직선 위에 있다.',
    q: '두 힘이 평형을 이룰 때의 설명으로 옳은 것은?',
    choices: ['두 힘의 방향이 같다', '두 힘의 크기가 다르다', '합력이 0이다', '물체가 점점 빨라진다'],
    answer: 2,
    why: '평형을 이루는 두 힘은 크기가 같고 방향이 반대라서 합력이 0이다.',
  },
  {
    id: 'actionReaction',
    name: '작용과 반작용',
    icon: 'action',
    text: '두 물체가 서로 힘을 주고받을 때, 두 힘은 크기가 같고 방향이 반대이며 서로 다른 물체에 작용한다.',
    q: '벽을 손으로 밀면 손도 벽에 밀린다. 두 힘의 관계로 옳은 것은?',
    choices: ['크기가 같고 방향이 반대이다', '벽이 미는 힘이 더 크다', '손이 미는 힘이 더 크다', '방향이 같다'],
    answer: 0,
    why: '작용과 반작용은 크기가 같고 방향이 반대이며, 서로 다른 물체(손·벽)에 작용한다.',
  },
];

export const CONCEPT_BY_ID = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]));

// 패치 → 관련 개념 (카드를 하나도 못 주웠을 때 점검 문제를 고르는 데 씀)
export const PATCH_CONCEPT = {
  gravityVeil: 'gravity',
  gravityCollapse: 'gravity',
  elasticPad: 'elastic',
  elasticNet: 'elastic',
  resultantAmp: 'resultantSame',
  resultantSurge: 'resultantSame',
  reactionRounds: 'actionReaction',
  buoyShield: 'buoyancy',
  frictionZero: 'friction',
  frictionStorm: 'frictionFactors',
  weightScanner: 'weightMass',
};

// 경기가 끝난 뒤 낼 점검 문제 (주운 카드 우선, 모자라면 이번 경기에 쓴 패치 관련 개념, 그래도 모자라면 남은 개념)
export function pickQuiz(picked, patchIds = [], count = 3, rand = Math.random) {
  const ids = [...new Set(picked)];
  for (const p of patchIds) {
    const id = PATCH_CONCEPT[p];
    if (id && !ids.includes(id)) ids.push(id);
  }
  const rest = CONCEPTS.map((c) => c.id).filter((id) => !ids.includes(id));
  while (rest.length) ids.push(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
  return ids.slice(0, count).map((id) => CONCEPT_BY_ID[id]);
}
