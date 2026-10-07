// 포스 패치·총기 아이콘 (SVG). currentColor를 써서 CSS로 색을 바꿀 수 있어요.

export const PATCH_ICONS = {
  gravityVeil: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 30a18 18 0 0 1 36 0" opacity=".9"/><path d="M11 30a13 13 0 0 1 26 0" opacity=".5"/>
    <path d="M24 10v14"/><path d="M19 19l5 5 5-5"/><path d="M4 36h40"/><circle cx="14" cy="27" r="1.6" fill="currentColor"/><circle cx="34" cy="27" r="1.6" fill="currentColor"/></svg>`,
  elasticPad: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 40h28"/><path d="M14 34l20-4M14 30l20-4M14 26l20-4M14 22l20-4"/><path d="M10 16h28"/><path d="M24 12V3"/><path d="M19 7l5-5 5 5"/></svg>`,
  resultantAmp: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 14h16"/><path d="M17 10l4 4-4 4"/><path d="M25 14h10"/><path d="M31 10l4 4-4 4"/>
    <path d="M5 32h34" stroke-width="5"/><path d="M33 25l8 7-8 7" stroke-width="4"/></svg>`,
  frictionZero: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <rect x="16" y="14" width="16" height="14" rx="2"/><path d="M4 32h40"/><path d="M4 38h10M18 38h10M32 38h12" opacity=".6"/>
    <path d="M36 21h8"/><path d="M40 17l4 4-4 4"/><path d="M6 21h6" opacity=".5"/></svg>`,
  gravityCollapse: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
    <circle cx="24" cy="24" r="5" fill="currentColor"/><path d="M24 6a18 18 0 0 1 18 18"/><path d="M42 24a18 18 0 0 1-18 18" opacity=".75"/>
    <path d="M24 42A18 18 0 0 1 6 24" opacity=".5"/><path d="M6 24A18 18 0 0 1 24 6" opacity=".3"/><path d="M24 13a11 11 0 0 1 11 11" /></svg>`,
};

export const WEAPON_ICONS = {
  rifle: `<svg viewBox="0 0 120 36" fill="currentColor"><path d="M4 14h20l4-4h46v-2h8v2h22v4h12v4h-12v3H76l-4 3h-8v9h-9l-3-9H40l-6 9H22l4-9H4z"/></svg>`,
  pistol: `<svg viewBox="0 0 60 40" fill="currentColor"><path d="M4 6h50v10H30l-3 4h-5l-6 16H6l5-17-7-3z"/></svg>`,
};

export const UI_ICONS = {
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>`,
  person: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0z"/></svg>`,
};
