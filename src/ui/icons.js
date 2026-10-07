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
};

export const UI_ICONS = {
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6z"/><path d="M13 7l-4 6h4l-2 5"/></svg>`,
  person: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0z"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/></svg>`,
};
