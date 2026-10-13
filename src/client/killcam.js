// 킬캠: 모든 요원의 최근 몇 초를 기록해 두었다가, 내가 쓰러지면 나를 쓰러뜨린 상대의 눈으로 다시 보여 줌.
//   기록: 20 Hz · 7초 (위치·방향·자세·무기·생존 등 3인칭 모습에 필요한 것만)
//   재생: 쓰러지기 약 4초 전부터 쓰러진 뒤 0.8초까지 · 마지막 순간은 느리게
// 화면(AgentView)은 '유령 요원'(실제 요원을 물려받고 기록된 값만 덮어쓴 객체)을 그림 → 재생이 끝나면 실제 요원으로 되돌림
import { eyePos } from '../sim/agent.js';

const FIELDS = ['yaw', 'pitch', 'crouch', 'lean', 'leanOffset', 'weapon', 'alive', 'adsT', 'reloadT', 'swapT', 'sinceShot', 'meleeCd', 'onGround', 'deadT', 'hp', 'equip', 'kickT'];
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export const KILLCAM = { rate: 1 / 20, keep: 7, before: 4, after: 0.8, slowFrom: 0.3, slowTo: 0.35, slow: 0.35, delay: 1.1 };

export class KillcamRecorder {
  constructor(match) {
    this.match = match;
    this.frames = [];
    this.t = 0;
  }

  reset() {
    this.frames = [];
  }

  // 매 화면 프레임 (sim 시간 기준으로 rate마다 한 장)
  sample() {
    const m = this.match;
    if (this.frames.length && m.time - this.frames.at(-1).t < KILLCAM.rate - 1e-4) return;
    if (this.frames.length && m.time < this.frames.at(-1).t) this.frames = []; // 시간이 되감김(새 라운드·온라인 시계 맞춤)
    const agents = m.agents.map((a) => {
      const s = { pos: { x: a.pos.x, y: a.pos.y, z: a.pos.z }, vel: { x: a.vel.x, y: a.vel.y, z: a.vel.z } };
      for (const k of FIELDS) s[k] = a[k];
      return s;
    });
    this.frames.push({ t: m.time, agents });
    while (this.frames.length && m.time - this.frames[0].t > KILLCAM.keep) this.frames.shift();
  }

  // t 시점의 요원 i 모습 (앞뒤 기록 사이를 이어 줌)
  stateAt(i, t) {
    const F = this.frames;
    if (!F.length) return null;
    let j = F.findIndex((f) => f.t >= t);
    if (j < 0) j = F.length - 1;
    const b = F[j], a = F[Math.max(0, j - 1)];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    const sa = a.agents[i], sb = b.agents[i];
    if (!sa || !sb) return sb ?? sa ?? null;
    const s = { ...(k < 0.5 ? sa : sb) };
    s.pos = { x: sa.pos.x + (sb.pos.x - sa.pos.x) * k, y: sa.pos.y + (sb.pos.y - sa.pos.y) * k, z: sa.pos.z + (sb.pos.z - sa.pos.z) * k };
    s.yaw = lerpAngle(sa.yaw, sb.yaw, k);
    s.pitch = sa.pitch + (sb.pitch - sa.pitch) * k;
    s.crouch = sa.crouch + (sb.crouch - sa.crouch) * k;
    s.leanOffset = (sa.leanOffset ?? 0) + ((sb.leanOffset ?? 0) - (sa.leanOffset ?? 0)) * k;
    return s;
  }
}

// 재생 하나: 누구 눈으로 · 언제부터 언제까지 · 지금 어디까지 봤는지
export class KillcamPlayback {
  constructor(recorder, match, { killerId, victimId, deathT }) {
    this.rec = recorder;
    this.match = match;
    this.killerIdx = match.agents.findIndex((a) => a.id === killerId);
    this.victimId = victimId;
    this.deathT = deathT;
    const first = recorder.frames[0]?.t ?? deathT;
    this.start = Math.max(first, deathT - KILLCAM.before);
    this.end = Math.min(recorder.frames.at(-1)?.t ?? deathT, deathT + KILLCAM.after);
    this.t = this.start;
    this.ghosts = new Map(); // 요원 id → 유령
    this.done = this.killerIdx < 0 || this.end - this.start < 0.8;
  }

  get progress() {
    return Math.min(1, (this.t - this.start) / Math.max(0.01, this.end - this.start));
  }

  // 화면 시간 dt만큼 진행 (쓰러지는 순간 앞뒤는 느리게)
  step(dt) {
    if (this.done) return;
    const near = this.t > this.deathT - KILLCAM.slowFrom && this.t < this.deathT + KILLCAM.slowTo;
    this.t += dt * (near ? KILLCAM.slow : 1);
    if (this.t >= this.end) {
      this.t = this.end;
      this.done = true;
    }
  }

  // 요원마다 이 시점의 유령 (실제 요원을 물려받아 팀·이름·총 구성은 그대로)
  ghostOf(agent, i) {
    const s = this.rec.stateAt(i, this.t);
    if (!s) return agent;
    let g = this.ghosts.get(agent.id);
    if (!g) {
      g = Object.create(agent);
      g.prev = { x: 0, y: 0, z: 0 };
      this.ghosts.set(agent.id, g);
    }
    Object.assign(g, s);
    g.prev = { ...s.pos };
    g.held = null;
    g.lockpick = null;
    return g;
  }

  // 상대의 눈 (카메라 위치·방향)
  eye() {
    const killer = this.match.agents[this.killerIdx];
    const g = this.ghostOf(killer, this.killerIdx);
    const e = eyePos(g);
    return { pos: e, yaw: g.yaw, pitch: g.pitch, ghost: g };
  }
}
