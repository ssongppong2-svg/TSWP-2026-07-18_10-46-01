// 빠른 매칭: 모두가 같은 대기열 방(force-mm)에 들어가 기다리면, 가장 먼저 온 사람(진행자)이
//   - 10명이 모이면 바로, 2명 이상이면 카운트다운이 끝날 때 경기 방을 열고 (방 코드 · 맵 · 팀을 대기열에 알림)
//   - 알림에 내 표(ticket)가 있는 사람은 그 방으로 옮겨 감 → 팀은 자동, 빈자리는 봇
//   - 맵: 대기열에서 고른 표 중 가장 많은 것 (같으면 그중 무작위, 아무도 안 고르면 무작위)
// 모든 사람이 같은 presence를 보고 같은 순서로 정렬하므로 진행자는 따로 정하지 않아도 하나로 정해진다.
import { PROTOCOL } from './protocol.js';
import { makeCode } from './session.js';
import { MAP_ORDER } from '../sim/maps/index.js';

export const MM_ROOM = 'force-mm';
export const MM_MAX = 10; // 한 경기 사람 수 (5 대 5)
export const MM_COUNTDOWN = 15; // 2명이 모이면 이 초 뒤 시작
export const MM_EXTEND = 6; // 새 사람이 오면 적어도 이만큼은 더 기다림
export const MM_CAP = 40; // 카운트다운이 아무리 늘어도 처음부터 이 초 안에 시작

const TEAM_ORDER = ['defuse', 'force'];

// 대기열: 아직 출발하지 않은 사람 (출발 알림을 올렸거나, 누군가의 출발 명단에 든 사람은 뺌) · 온 순서대로
export function mmQueue(peers) {
  const list = peers.filter((p) => p.k === 'mm' && p.v === PROTOCOL && p.tk);
  const taken = new Set();
  for (const p of list) for (const tk of Object.keys(p.go?.teams ?? {})) taken.add(tk);
  return list.filter((p) => !p.go && !taken.has(p.tk)).sort((a, b) => a.at - b.at || (a.tk < b.tk ? -1 : 1));
}

// 맵 투표 집계: 가장 많이 고른 맵 (같으면 그중 무작위) · 표가 없으면 전체에서 무작위
export function pickMap(votes, rng = Math.random, maps = MAP_ORDER) {
  const count = new Map();
  for (const v of votes) if (maps.includes(v)) count.set(v, (count.get(v) ?? 0) + 1);
  if (!count.size) return maps[Math.floor(rng() * maps.length) % maps.length];
  const best = Math.max(...count.values());
  const top = maps.filter((m) => count.get(m) === best);
  return top[Math.floor(rng() * top.length) % top.length];
}

// 팀 나누기: 온 순서대로 번갈아 (해체·포스·해체·포스 …) — 사람 수 차이는 많아야 1명
export function assignTeams(tickets) {
  return Object.fromEntries(tickets.map((tk, i) => [tk, TEAM_ORDER[i % 2]]));
}

const ticketId = () => Math.random().toString(36).slice(2, 10);

// 대기열 하나에 들어가 있는 동안의 상태 · 출발 처리
export class Matchmaker {
  constructor(transport, { name, onGo, onChange, now = () => Date.now(), linger = 5000, tick = 250 }) {
    this.transport = transport;
    this.name = String(name || '요원').slice(0, 8);
    this.onGo = onGo;
    this.onChange = onChange;
    this.now = now;
    this.linger = linger; // 출발 알림을 대기열에 남겨 두는 시간 (ms)
    this.tick = tick;
    this.ticket = ticketId();
    this.room = null;
    this.vote = null;
    this.launched = false;
    this.launchAt = null;
    this.firstAt = null;
    this.lastCount = 0;
    this.sentCd = null;
  }

  async start() {
    this.room = await this.transport.join(MM_ROOM);
    this.joinedAt = this.now();
    await this.room.presence({ v: PROTOCOL, k: 'mm', name: this.name, tk: this.ticket, at: this.joinedAt, vote: null });
    this.off = this.room.onPeers(() => this.update());
    if (this.tick > 0) this.timer = setInterval(() => this.update(), this.tick);
  }

  peers() {
    return (this.room?.peers() ?? []).map((p) => ({ key: p.peer, me: p.isMe, ...p.presence }));
  }

  queue() {
    return mmQueue(this.peers());
  }

  get leader() {
    return this.queue()[0] ?? null;
  }

  get isLeader() {
    return this.leader?.tk === this.ticket;
  }

  // 진행자가 알리는 남은 시간 (초) — 진행자가 아니면 진행자의 presence에서 읽음
  get countdown() {
    if (this.isLeader) return this.launchAt ? Math.max(0, Math.ceil((this.launchAt - this.now()) / 1000)) : null;
    return this.leader?.cd ?? null;
  }

  setVote(mapId) {
    this.vote = MAP_ORDER.includes(mapId) ? mapId : null;
    this.room?.presence({ vote: this.vote });
    this.onChange?.();
  }

  update() {
    if (!this.room || this.launched) return;
    // 1) 누군가 나를 넣어 출발했으면 그 방으로
    for (const p of this.peers()) {
      const team = p.go?.teams?.[this.ticket];
      if (team && !p.me) {
        this.launched = true;
        this.onGo?.({ code: p.go.code, map: p.go.map, teams: p.go.teams, team, ticket: this.ticket, host: false });
        setTimeout(() => this.leave(), 300);
        return;
      }
    }
    // 2) 진행자: 카운트다운 관리 · 출발
    const q = this.queue();
    const now = this.now();
    if (this.isLeader) {
      if (q.length >= 2) {
        if (this.launchAt == null) {
          this.firstAt = now;
          this.launchAt = now + MM_COUNTDOWN * 1000;
        } else if (q.length > this.lastCount) this.launchAt = Math.min(this.firstAt + MM_CAP * 1000, Math.max(this.launchAt, now + MM_EXTEND * 1000));
      } else this.launchAt = null;
      this.lastCount = q.length;
      if (q.length >= MM_MAX || (this.launchAt != null && now >= this.launchAt)) {
        this.launch(q);
        return;
      }
      const cd = this.countdown;
      if (cd !== this.sentCd) {
        this.sentCd = cd;
        this.room.presence({ cd });
      }
    }
    // 화면은 보이는 것이 바뀔 때만 다시 그림 (매 틱 다시 그리면 누르던 버튼이 사라짐)
    const sig = JSON.stringify([q.map((p) => [p.tk, p.name, p.vote]), this.countdown, this.isLeader, this.vote]);
    if (sig !== this.sig) {
      this.sig = sig;
      this.onChange?.();
    }
  }

  // 진행자가 '지금 시작' (혼자여도 됨 — 빈자리는 봇)
  launchNow() {
    if (this.isLeader && !this.launched) this.launch(this.queue());
  }

  launch(q) {
    const members = q.slice(0, MM_MAX);
    const teams = assignTeams(members.map((m) => m.tk));
    const map = pickMap(members.map((m) => m.vote));
    const code = makeCode();
    this.launched = true;
    // 출발 알림은 다른 사람이 볼 수 있게 몇 초 남겨 둔 뒤 대기열을 떠남
    this.room.presence({ go: { code, map, teams }, cd: null });
    this.onGo?.({ code, map, teams, team: teams[this.ticket], ticket: this.ticket, host: true });
    setTimeout(() => this.leave(), this.linger);
  }

  async leave() {
    clearInterval(this.timer);
    this.timer = null;
    this.off?.();
    this.off = null;
    const r = this.room;
    this.room = null;
    if (r) await r.leave();
  }
}
