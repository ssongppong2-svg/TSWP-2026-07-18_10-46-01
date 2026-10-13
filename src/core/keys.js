// 조작 키 (설정 → 키 바꾸기에서 바꿀 수 있음). 값은 KeyboardEvent.code (자판 배열과 상관없는 물리 키 위치).
// Shift·Ctrl·Alt는 왼쪽·오른쪽을 같은 키로 봄. 마우스(사격·정조준·휠)와 메뉴 안 숫자 고르기(지휘 휠·힘 카드·보급 키)는 고정.
export const KEY_ACTIONS = [
  { id: 'forward', group: '이동', name: '앞으로', def: 'KeyW' },
  { id: 'back', group: '이동', name: '뒤로', def: 'KeyS' },
  { id: 'left', group: '이동', name: '왼쪽', def: 'KeyA' },
  { id: 'right', group: '이동', name: '오른쪽', def: 'KeyD' },
  { id: 'walk', group: '이동', name: '보행 (발소리 거의 없음)', def: 'ShiftLeft' },
  { id: 'crouch', group: '이동', name: '앉기', def: 'ControlLeft' },
  { id: 'jump', group: '이동', name: '도약', def: 'Space' },
  { id: 'leanL', group: '이동', name: '왼쪽 기울이기', def: 'KeyZ' },
  { id: 'leanR', group: '이동', name: '오른쪽 기울이기', def: 'KeyV' },
  { id: 'primary', group: '무기 · 장비', name: '주무기', def: 'Digit1' },
  { id: 'secondary', group: '무기 · 장비', name: '보조무기', def: 'Digit2' },
  { id: 'knife', group: '무기 · 장비', name: '칼', def: 'Digit3' },
  { id: 'throw', group: '무기 · 장비', name: '투척물 (다시 누르면 다음)', def: 'Digit4' },
  { id: 'gadget', group: '무기 · 장비', name: 'C4 · 기폭기 · 드론', def: 'Digit5' },
  { id: 'reload', group: '무기 · 장비', name: '재장전', def: 'KeyR' },
  { id: 'inspect', group: '무기 · 장비', name: '총 살펴보기 (누른 채)', def: 'KeyT' },
  { id: 'patch0', group: '포스 패치', name: '일반 패치 1', def: 'KeyC' },
  { id: 'patch1', group: '포스 패치', name: '일반 패치 2', def: 'KeyQ' },
  { id: 'patch2', group: '포스 패치', name: '특수 패치', def: 'KeyE' },
  { id: 'patch3', group: '포스 패치', name: '필살 패치', def: 'KeyX' },
  { id: 'interact', group: '임무 · 지휘', name: '해체 · 장치 · 문 · 결박 풀기', def: 'KeyF' },
  { id: 'shop', group: '임무 · 지휘', name: '보급 단말기', def: 'KeyB' },
  { id: 'command', group: '임무 · 지휘', name: '분대 지휘 (누른 채)', def: 'KeyG' },
  { id: 'report', group: '임무 · 지휘', name: '적 보고 (휠 클릭도)', def: 'KeyH' },
  { id: 'map', group: '임무 · 지휘', name: '큰 지도 (누른 채)', def: 'KeyM' },
  { id: 'score', group: '임무 · 지휘', name: '전황판 (누른 채)', def: 'Tab' },
  { id: 'start', group: '임무 · 지휘', name: 'CQB 작전 바로 개시', def: 'Enter' },
];
export const KEY_DEFAULTS = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.def]));

// 바꿀 수 없는 키: Esc(일시 중지·마우스 풀기), 브라우저가 먼저 가져가거나 꼭 필요한 키
export const KEY_RESERVED = new Set(['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu']);

const map = { ...KEY_DEFAULTS };

// 설정에 저장된 바뀐 키만 덮어씀 (모르는 동작·막힌 키는 무시)
export function setKeymap(saved = {}) {
  for (const a of KEY_ACTIONS) map[a.id] = a.def;
  for (const [id, code] of Object.entries(saved ?? {})) if (id in KEY_DEFAULTS && typeof code === 'string' && !KEY_RESERVED.has(code)) map[id] = code;
}
export const keyOf = (id) => map[id];
// 저장할 것: 기본과 다른 것만
export const changedKeys = () => Object.fromEntries(Object.entries(map).filter(([id, code]) => KEY_DEFAULTS[id] !== code));

// 왼쪽·오른쪽 수정 키는 같은 키로
const SIDE = /^(Shift|Control|Alt)(Left|Right)$/;
const base = (code) => code?.replace(SIDE, '$1') ?? code;
export const sameKey = (a, b) => !!a && !!b && base(a) === base(b);
export const codesOf = (id) => {
  const c = map[id];
  const m = c?.match(SIDE);
  return m ? [`${m[1]}Left`, `${m[1]}Right`] : [c];
};
// 이 물리 키가 어떤 동작인지 (없으면 null)
export const actionOfCode = (code) => KEY_ACTIONS.find((a) => sameKey(map[a.id], code))?.id ?? null;
export const isKey = (code, id) => sameKey(map[id], code);

// 키를 바꿈: 다른 동작이 쓰던 키면 서로 맞바꿈 → 바뀐 동작 id (없으면 null)
export function assignKey(id, code) {
  if (!(id in map) || KEY_RESERVED.has(code)) return { ok: false };
  const other = KEY_ACTIONS.find((a) => a.id !== id && sameKey(map[a.id], code))?.id ?? null;
  if (other) map[other] = map[id];
  map[id] = code;
  return { ok: true, swapped: other };
}
export function resetKeys() {
  setKeymap({});
}

// 화면에 보이는 키 이름
const NAMES = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: '←Back', CapsLock: 'Caps',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  Backquote: '`', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  NumpadAdd: '숫자판 +', NumpadSubtract: '숫자판 −', NumpadMultiply: '숫자판 *', NumpadDivide: '숫자판 /', NumpadEnter: '숫자판 Enter', NumpadDecimal: '숫자판 .',
};
export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `숫자판 ${code.slice(6)}`;
  return code;
}
// 동작의 지금 키 이름 · <kbd> 표시
export const K = (id) => keyName(map[id]);
export const kbd = (id) => `<kbd>${K(id)}</kbd>`;
// 여러 동작을 한 칸에 (예: 1·2·3)
export const kbds = (...ids) => `<kbd>${ids.map(K).join('·')}</kbd>`;
