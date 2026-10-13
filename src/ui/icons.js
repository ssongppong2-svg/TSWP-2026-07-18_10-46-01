// 포스 패치·총기 아이콘 (SVG). currentColor를 써서 CSS로 색을 바꿀 수 있다.

const S = 'viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square" stroke-linejoin="miter"';

export const PATCH_ICONS = {
  // ── 일반 ──
  gravityVeil: `<svg ${S}>
    <path d="M6 32a18 18 0 0 1 36 0"/><path d="M12 32a12 12 0 0 1 24 0" opacity=".5"/>
    <path d="M24 9v15"/><path d="M19 19l5 5 5-5"/><path d="M3 38h42"/></svg>`,
  elasticPad: `<svg ${S}>
    <path d="M8 41h32"/><path d="M14 35l20-4M14 30l20-4M14 25l20-4"/><path d="M8 18h32"/><path d="M24 13V3"/><path d="M19 8l5-5 5 5"/></svg>`,
  resultantAmp: `<svg ${S}>
    <path d="M5 13h15"/><path d="M16 9l4 4-4 4"/><path d="M24 13h11"/><path d="M31 9l4 4-4 4"/>
    <path d="M5 32h33" stroke-width="5"/><path d="M33 25l8 7-8 7" stroke-width="3.6"/></svg>`,
  reactionRounds: `<svg ${S}>
    <path d="M41 5v38" stroke-width="4"/><path d="M6 38l30-14"/><path d="M36 24L11 10"/><path d="M15 17l-4-7h8"/>
    <path d="M44 14h-3M44 34h-3" opacity=".5"/></svg>`,
  buoyShield: `<svg ${S}>
    <path d="M12 6h24v20l-12 6-12-6z"/><path d="M24 11v15" opacity=".45"/>
    <path d="M14 45v-7M24 45v-7M34 45v-7"/><path d="M11 41l3-3 3 3M21 41l3-3 3 3M31 41l3-3 3 3"/></svg>`,
  // ── 특수 ──
  frictionZero: `<svg ${S}>
    <rect x="15" y="13" width="17" height="15"/><path d="M3 33h42"/><path d="M3 39h9M17 39h9M31 39h14" opacity=".55"/>
    <path d="M36 20h9"/><path d="M41 16l4 4-4 4"/><path d="M4 20h6" opacity=".45"/></svg>`,
  elasticNet: `<svg ${S}>
    <path d="M5 9q19 8 38 0"/><path d="M5 24q19 8 38 0"/><path d="M5 39q19 8 38 0"/>
    <path d="M12 11.5v30M24 13v30M36 11.5v30"/></svg>`,
  weightScanner: `<svg ${S}>
    <path d="M3 41h42"/><path d="M19 30h10v11H19z"/><path d="M24 14v12"/><path d="M20 22l4 4 4-4"/>
    <path d="M10 13a20 20 0 0 1 28 0" opacity=".55"/><path d="M4 7a28 28 0 0 1 40 0" opacity=".3"/></svg>`,
  // ── 필살 ──
  gravityCollapse: `<svg ${S}>
    <circle cx="24" cy="24" r="5" fill="currentColor"/><path d="M24 5a19 19 0 0 1 19 19"/><path d="M43 24a19 19 0 0 1-19 19" opacity=".7"/>
    <path d="M24 43A19 19 0 0 1 5 24" opacity=".45"/><path d="M5 24A19 19 0 0 1 24 5" opacity=".25"/><path d="M24 13a11 11 0 0 1 11 11"/></svg>`,
  resultantSurge: `<svg ${S}>
    <path d="M4 9l15 11M4 24h15M4 39l15-11"/><path d="M19 24h17" stroke-width="5"/><path d="M31 15l11 9-11 9" stroke-width="3.6"/></svg>`,
  frictionStorm: `<svg ${S}>
    <path d="M3 41l4-5 4 5 4-5 4 5 4-5 4 5 4-5 4 5 4-5 4 5"/><path d="M38 24H10"/><path d="M16 18l-6 6 6 6"/>
    <path d="M30 6l-4 6h6l-4 6" opacity=".6"/><path d="M42 8l-3 5h5l-3 5" opacity=".35"/></svg>`,
};

export const WEAPON_ICONS = {
  rifle: `<svg viewBox="0 0 120 36" fill="currentColor"><path d="M4 14h20l4-4h46v-2h8v2h22v4h12v4h-12v3H76l-4 3h-8v9h-9l-3-9H40l-6 9H22l4-9H4z"/></svg>`,
  pistol: `<svg viewBox="0 0 60 40" fill="currentColor"><path d="M4 6h50v10H30l-3 4h-5l-6 16H6l5-17-7-3z"/></svg>`,
  knife: `<svg viewBox="0 0 80 28" fill="currentColor"><path d="M2 15 34 7h10v12H34z"/><path d="M44 5h4v18h-4z"/><path d="M48 10h28v8H48z"/></svg>`,
  sheriff: `<svg viewBox="0 0 64 40" fill="currentColor"><path d="M2 8h38V5h6v3h14v7H46l-3 5h-7l-4 3-6 14H14l6-14-4-4H2z"/><path d="M29 11h12v8H29z" fill-opacity=".45"/></svg>`,
  shotgun: `<svg viewBox="0 0 120 30" fill="currentColor"><path d="M2 10h70V8h44v6H76v3h-8l-2 4H50v-3H36l-8 9H16l5-9H2z"/><path d="M78 16h24v5H78z"/></svg>`,
  smg: `<svg viewBox="0 0 90 40" fill="currentColor"><path d="M4 10h22l4-4h40v4h16v6H70l-2 3H54v16h-8l-2-16H34l-6 8H18l3-8H4z"/><path d="M70 19h6v9h-6z"/></svg>`,
  sniper: `<svg viewBox="0 0 140 36" fill="currentColor"><path d="M2 16h30l4-4h50v4h38v3h22v4h-22v2H82l-4 3h-8v7h-8l-2-7H44l-8 7H26l3-7H2z"/><path d="M44 5h34v6H44z"/><path d="M39 4h5v8h-5zM78 4h5v8h-5z"/></svg>`,
  // 기관권총: 권총 몸체 + 긴 탄창 + 앞손잡이
  mpistol: `<svg viewBox="0 0 70 42" fill="currentColor"><path d="M2 6h60v10H38l-2 4h-4l-2 20h-9l2-20h-3l-3-4H2z"/><path d="M46 16h6v11h-6z"/><path d="M62 9h5v4h-5z"/></svg>`,
  // 단축 카빈: 짧은 총열 · 접이식 개머리 · 조준기
  carbine: `<svg viewBox="0 0 104 38" fill="currentColor"><path d="M2 14h6l2-4h10l3-2h44v-1h7v1h14v4h8v4h-8v4H64l-3 3h-7v11h-8l-2-11H34l-6 8H18l4-8h-6l-2-3H2z"/><path d="M38 2h12v6H38z"/></svg>`,
  // 3점사 소총: 운반 손잡이 · 곧은 탄창
  burst: `<svg viewBox="0 0 120 38" fill="currentColor"><path d="M4 16h22l4-4h44v-2h8v2h22v4h12v4h-12v3H74l-3 3h-8l-2 10h-9l1-10H40l-7 9H22l4-9H4z"/><path d="M44 4h26v3h-3v3h-2V7H51v3h-2V7h-5z"/></svg>`,
  // 지정사수 소총: 긴 총열 · 저배율 조준경 · 짧은 탄창
  dmr: `<svg viewBox="0 0 140 38" fill="currentColor"><path d="M2 17h28l6-5h50v3h32v3h20v4h-20v2H84l-4 3h-6v8h-8l-2-8H46l-9 7H26l3-7H2z"/><path d="M46 4h28v6H46z"/><path d="M50 10h3v2h-3zM67 10h3v2h-3z"/></svg>`,
  // 경기관총: 상자 탄창 · 양각대 · 손잡이
  lmg: `<svg viewBox="0 0 140 46" fill="currentColor"><path d="M2 14h24l4-4h56v-2h10v2h30v4h12v4h-12v4H90l-3 3H74v2h-6l-2-2H48l-6 8H30l4-8H2z"/><path d="M50 22h17v14H50z"/><path d="M111 22l-7 20h3l5-14 5 14h3l-7-20z"/><path d="M64 3h16v3h-3v3h-2V6h-6v3h-2V6h-3z"/></svg>`,
};

// 방탄·처치 표시 아이콘
export const GEAR_ICONS = {
  light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 5.5v6c0 5 3.4 8.6 8 10.5 4.6-1.9 8-5.5 8-10.5v-6z"/><path d="M12 2v20" opacity=".5"/></svg>`,
  heavy: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 4 5.5v6c0 5 3.4 8.6 8 10.5 4.6-1.9 8-5.5 8-10.5v-6z"/></svg>`,
  head: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/></svg>`,
  // 에너지(J): 번개 모양 계기 표시
  credit: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 1 4 13.5h6.5L9 23l11-13.5h-6.8z"/></svg>`,
  spike: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1 16 9h-3v6h3l-4 8-4-8h3V9H8z"/></svg>`,
  // 탄종: 둥근 탄두(일반) · 뾰족한 강철 탄심(관통) · 끝이 패인 탄두(확장)
  fmj: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 10.5C9 6 10.5 2.5 12 2.5S15 6 15 10.5z"/><path d="M8.5 11.5h7V21h-7z" fill-opacity=".55"/><path d="M8 21.5h8v1H8z"/></svg>`,
  ap: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 10.5 12 1.5l3 9z"/><path d="M10.4 6.5h3.2l.5 1.6h-4.2z" fill="#08151a"/><path d="M8.5 11.5h7V21h-7z" fill-opacity=".55"/><path d="M8 21.5h8v1H8z"/></svg>`,
  hp: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 10.5c0-3 .6-5.6 1.6-7.2L12 6l1.4-2.7c1 1.6 1.6 4.2 1.6 7.2z"/><path d="M8.5 11.5h7V21h-7z" fill-opacity=".55"/><path d="M8 21.5h8v1H8z"/></svg>`,
  // 투척·폭발 장비
  frag: `<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="11" cy="14.5" rx="6" ry="7"/><path d="M8.5 8.2h5V6h-5z"/><path d="M13.5 6.5 18 9.5l-1 1.2-4-2.3z"/><circle cx="16.5" cy="5" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 13h10M6 16.5h10M11 8.5v12.5" stroke="#08151a" stroke-width=".9" opacity=".5"/></svg>`,
  stun: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="7" height="14" rx="1.2"/><path d="M8.5 5h4v2h-4z"/><path d="M14 6l3 2-1 1-2.6-1.5z"/><path d="M17 13.5a4 4 0 0 1 0 4M19.5 12a7 7 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10.5" cy="11" r=".9" fill="#08151a"/><circle cx="10.5" cy="14" r=".9" fill="#08151a"/><circle cx="10.5" cy="17" r=".9" fill="#08151a"/></svg>`,
  flash: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="8" y="9" width="7" height="12" rx="1.2"/><path d="M9.5 7h4v2h-4z"/><path d="M11.5 1.5v3.5M5 4.5l2.2 2.4M18 4.5l-2.2 2.4M3 10h3M17 10h3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  smoke: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="11" width="7" height="11" rx="1.2"/><path d="M5.5 9h4v2h-4z"/><path d="M12 9.5a3 3 0 0 1 5-2.2 3.2 3.2 0 0 1 4.4 3A2.6 2.6 0 0 1 20 15.5h-6.5A3 3 0 0 1 12 9.5z" fill-opacity=".55"/></svg>`,
  gas: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="11" width="7" height="11" rx="1.2"/><path d="M5.5 9h4v2h-4z"/><path d="M12.5 8.5a3 3 0 0 1 5-2 3 3 0 0 1 4 2.6 2.5 2.5 0 0 1-1.6 4.4H14a3 3 0 0 1-1.5-5z" fill-opacity=".55"/><path d="M15.5 16.5v2.5M18.5 16v3.5" stroke="currentColor" stroke-width="1.4"/></svg>`,
  c4: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="2.5" y="8" width="13" height="10" rx="1"/><path d="M5 8v10M8 8v10M11 8v10" stroke="#08151a" stroke-width=".8" opacity=".55"/><rect x="11.5" y="5" width="6" height="5" rx=".6" fill-opacity=".6"/><path d="M17.5 7.5h2.5l1.5-3" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="14.5" cy="7.5" r=".9" fill="#ff5a4f"/></svg>`,
  det: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="8" width="10" height="14" rx="2"/><path d="M14 8V2.5" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="13" r="2.4" fill="#ff5a4f"/><path d="M9.5 18h5" stroke="#08151a" stroke-width="1.2"/></svg>`,
  drone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9" y="10" width="6" height="5" rx="1" fill="currentColor"/><path d="M9 11 5.5 7.5M15 11l3.5-3.5M9 14l-3.5 3.5M15 14l3.5 3.5"/><ellipse cx="5" cy="7" rx="3" ry="1"/><ellipse cx="19" cy="7" rx="3" ry="1"/><ellipse cx="5" cy="18" rx="3" ry="1"/><ellipse cx="19" cy="18" rx="3" ry="1"/></svg>`,
};

export const UI_ICONS = {
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6z"/><path d="M13 7l-4 6h4l-2 5"/></svg>`,
  person: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0z"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/></svg>`,
};
