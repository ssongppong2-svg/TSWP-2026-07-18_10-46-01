import { PROTOCOL } from './protocol.js';
import { masteredIds } from '../core/progress.js';

// 방 하나 (방 코드 = room 이름). 각자의 presence에 이름·소속·준비·패치를 올리고,
// 방장은 여기에 대기실 설정(lobby), 시작 정보(start), 경기 상태(g)를, 참가자는 입력(in)을 올린다.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export const normCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

export class NetSession {
  constructor(transport) {
    this.transport = transport;
    this.room = null;
    this.code = null;
    this.me = null;
    this.listeners = new Set();
    this.lastSeen = new Map(); // 사람별 마지막으로 보인 시각 (나감 판정)
  }

  get kind() {
    return this.transport.kind;
  }

  async create(name) {
    await this.enter(makeCode(), name, true);
  }

  async join(code, name) {
    await this.enter(normCode(code), name, false);
  }

  async enter(code, name, host) {
    await this.leave();
    this.room = await this.transport.join(`force-${code.toLowerCase()}`);
    this.code = code;
    // mas: 숙달한 개념 (관련 패치 재사용 대기 −15%)
    this.me = { v: PROTOCOL, k: 'p', name: String(name || '요원').slice(0, 8), team: null, ready: false, load: [], mas: masteredIds().slice(0, 20), host, at: Date.now() };
    await this.room.presence(this.me);
    this.off = this.room.onPeers(() => this.changed());
  }

  changed() {
    const now = performance.now();
    for (const p of this.peers()) this.lastSeen.set(p.key, now);
    for (const fn of [...this.listeners]) fn();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // 내 상태 바꾸기 (값이 null이면 그 항목을 지움)
  set(patch) {
    if (!this.room) return;
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete this.me[k];
      else this.me[k] = v;
    }
    this.room.presence(patch);
  }

  // 같은 판(같은 프로토콜)의 참가자들, 들어온 순서대로
  peers() {
    if (!this.room) return [];
    return this.room
      .peers()
      .filter((p) => p.presence?.k === 'p' && p.presence.v === PROTOCOL)
      .map((p) => ({ key: p.peer, me: p.isMe, ...p.presence }))
      .sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  }

  get myKey() {
    return this.peers().find((p) => p.me)?.key ?? null;
  }

  // 방장: host라고 밝힌 사람 중 먼저 들어온 사람
  host() {
    return this.peers().find((p) => p.host) ?? null;
  }

  get isHost() {
    const h = this.host();
    return !!h && h.me;
  }

  // 방장 입장에서 참가자의 최신 입력
  inputOf(key) {
    return this.room?.peers().find((p) => p.peer === key)?.presence?.in ?? null;
  }

  // 사람이 몇 초 동안 보이지 않으면 나간 것으로
  gone(key, ms = 4000) {
    const seen = this.lastSeen.get(key);
    if (this.peers().some((p) => p.key === key)) return false;
    return seen == null || performance.now() - seen > ms;
  }

  async leave() {
    this.off?.();
    this.off = null;
    const r = this.room;
    this.room = null;
    this.code = null;
    if (r) await r.leave();
  }
}
