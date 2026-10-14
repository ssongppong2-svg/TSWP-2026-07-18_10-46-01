// 문 진입 명령 목록 (분대장이 문을 보고 G): 경기 규칙(match)·봇(ai/entry.js)·화면(휠·HUD)이 같이 씀
export const ENTRY_COMMANDS = [
  { type: 'eStack', mode: 'stack', label: '문 앞 대기', sub: '문 양옆 벽에 붙음', key: 1, angle: -90 },
  { type: 'eOpen', mode: 'open', label: '열고 진입', sub: '문 열고 방 확보', key: 2, angle: -30 },
  { type: 'eFlash', mode: 'flash', label: '섬광 후 진입', sub: '섬광·이명 먼저', key: 3, angle: 30 },
  { type: 'eBreach', mode: 'breach', label: '폭파 후 진입', sub: 'C4로 문 폭파', key: 4, angle: 90 },
  { type: 'eKick', mode: 'kick', label: '걷어차고 진입', sub: '발로 차서 열고', key: 5, angle: 150 },
  { type: 'eMirror', mode: 'mirror', label: '문 밑 확인', sub: '카메라로 건너편', key: 6, angle: 210 },
];
export const ENTRY_MODE = Object.fromEntries(ENTRY_COMMANDS.map((c) => [c.type, c.mode]));
export const ENTRY_NAME = Object.fromEntries(ENTRY_COMMANDS.map((c) => [c.type, c.label]));
export const ENTRY_ACK = {
  eStack: '수신. 문 앞에 붙는다.',
  eOpen: '수신. 열고 진입.',
  eFlash: '수신. 섬광 던지고 진입.',
  eBreach: '수신. 폭약 설치, 폭파 후 진입.',
  eKick: '수신. 걷어차고 진입.',
  eMirror: '수신. 문 밑 확인.',
};
// 진행 단계 이름 (HUD 지시 칸)
export const ENTRY_PHASE = { stack: '대기', breach: '돌파', enter: '진입', clear: '수색', done: '확보' };
// 명령할 수 있는 문까지 거리 (바라보고 있어야 함)
export const ENTRY_REACH = 4.5;
