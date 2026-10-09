// 탄과 방탄 (타르코프식). 화면·네트워크와 무관한 순수 계산 → Node 시험 가능.
//
// 방탄에는 등급(class)과 내구도(dur)가 있고, 탄에는 관통력(pen)이 있다.
//   관통력이 등급보다 높을수록, 방탄이 많이 닳았을수록 뚫릴 확률이 커진다.
//   뚫리면: 탄이 느려진 만큼 조금 약하게 몸에 들어가고 방탄은 조금 닳는다.
//   막히면: 충격(둔상)만 조금 들어가고 방탄은 크게 닳는다. 내구도가 0이 되면 방탄은 부서진다.
// 과학: 같은 힘이라도 좁은 면적에 모이면 누르는 효과(압력)가 커진다 → 뾰족한 관통탄은 잘 뚫고,
//       넓게 퍼지는 확장탄은 방탄을 못 뚫는 대신 맨몸에 큰 피해를 준다.

export const ARMOR_RULES = {
  wornMin: 0.55, // 내구도가 0에 가까워지면 등급이 이만큼(55%)까지 낮아진 것처럼 작동
  slope: 0.28, // 관통력과 등급 차이 1당 관통 확률 변화
  minChance: 0.03,
  maxChance: 0.97,
  through: 0.85, // 뚫렸을 때 몸에 들어가는 피해 비율
  throughWear: 0.5, // 뚫렸을 때 방탄이 닳는 비율 (피해 대비)
  blunt: 0.2, // 막혔을 때 몸에 들어가는 충격 비율
  blockWear: 1.0, // 막혔을 때 방탄이 닳는 비율
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 관통 확률 (0~1)
export function penChance(pen, cls, durFrac) {
  const R = ARMOR_RULES;
  const eff = cls * (R.wornMin + (1 - R.wornMin) * clamp(durFrac, 0, 1));
  return clamp(0.5 + (pen - eff) * R.slope, R.minChance, R.maxChance);
}

// 방탄에 맞은 한 발. roll: 0~1 난수 (시뮬레이션의 rng에서)
// → { hp: 몸에 들어갈 피해, wear: 방탄이 닳는 양, penetrated }
export function hitArmor({ damage, pen, wear = 1, cls, dur, max }, roll) {
  const R = ARMOR_RULES;
  const penetrated = roll < penChance(pen, cls, max > 0 ? dur / max : 0);
  if (penetrated) return { hp: damage * R.through, wear: damage * wear * R.throughWear, penetrated };
  return { hp: damage * R.blunt, wear: damage * wear * R.blockWear, penetrated };
}
