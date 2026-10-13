// 죽음 분석표: 한 요원의 이번 목숨 동안 받은 피해·준 피해·사격을 모아, 쓰러지면 무엇 때문에 졌는지 정리한다.
// 화면과 무관한 순수 계산 → Node 시험 가능. (방장·참가자 화면 모두 자기 화면에서 본 사건으로 만듦)
import { chestPos, eyePos } from './agent.js';
import { WEAPONS } from './data.js';
import { GEAR } from './gear.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
export const weaponName = (id) => WEAPONS[id]?.name ?? GEAR[id]?.name ?? { blast: '폭발' }[id] ?? id ?? '알 수 없음';

export class DeathLog {
  constructor(match, agentId) {
    this.match = match;
    this.agentId = agentId;
    this.reset();
    const ev = match.events;
    ev.on('hit', (e) => this.onHit(e));
    ev.on('shot', (e) => {
      if (e.agent?.id === this.agentId) this.shots++;
    });
    ev.on('roundStart', () => this.reset());
    ev.on('roundPrep', () => this.reset());
  }

  reset() {
    this.taken = []; // { by, weapon, amount, headshot, armor, blocked, t, d, moving, facing }
    this.dealt = new Map(); // 상대 id → { amount, hits, headshots }
    this.shots = 0;
    this.hitsLanded = 0;
  }

  onHit(e) {
    const me = this.match.agentById(this.agentId);
    if (!me) return;
    if (e.target?.id === this.agentId && e.attacker && e.attacker.team !== me.team) {
      const a = e.attacker;
      const to = { x: a.pos.x - me.pos.x, z: a.pos.z - me.pos.z };
      // 내가 바라보던 방향과 쏜 사람 쪽의 각도 (0 = 정면, π = 등 뒤)
      const facing = Math.abs(wrap(Math.atan2(-to.x, -to.z) - me.yaw));
      this.taken.push({
        by: a.id, weapon: e.weapon, amount: e.amount ?? 0, headshot: !!e.headshot, armor: !!e.armor, blocked: !!e.blocked,
        t: this.match.time, d: dist(eyePos(a), chestPos(me)), moving: Math.hypot(me.vel.x, me.vel.z), ads: (me.adsT ?? 0) > 0.6, facing,
      });
    } else if (e.attacker?.id === this.agentId && e.target && e.target.team !== me.team) {
      const r = this.dealt.get(e.target.id) ?? { amount: 0, hits: 0, headshots: 0 };
      r.amount += e.amount ?? 0;
      // 산탄총은 한 번 쏜 산탄 여러 알이 같은 틱에 맞음 → 명중 한 번으로 셈
      const key = `${e.target.id}@${this.match.time.toFixed(3)}`;
      if (!WEAPONS[e.weapon]?.pellets || this.lastPellet !== key) {
        r.hits++;
        this.hitsLanded++;
      }
      if (WEAPONS[e.weapon]?.pellets) this.lastPellet = key;
      if (e.headshot) r.headshots++;
      this.dealt.set(e.target.id, r);
    }
  }

  // 쓰러진 순간의 분석표 (kill 사건 기준)
  report(kill) {
    const m = this.match;
    const me = m.agentById(this.agentId);
    const killer = kill.killer ?? null;
    const recent = this.taken.filter((h) => m.time - h.t < 12);
    const byAttacker = new Map();
    for (const h of recent) {
      const r = byAttacker.get(h.by) ?? { id: h.by, name: m.agentById(h.by)?.name ?? '?', amount: 0, hits: 0, headshots: 0, weapon: h.weapon };
      r.amount += h.amount;
      r.hits++;
      if (h.headshot) r.headshots++;
      r.weapon = h.weapon;
      byAttacker.set(h.by, r);
    }
    const attackers = [...byAttacker.values()].sort((p, q) => q.amount - p.amount);
    const last = recent.at(-1) ?? null;
    const first = recent[0] ?? null;
    const dealtKiller = killer ? this.dealt.get(killer.id) ?? null : null;
    const dealtTotal = [...this.dealt.values()].reduce((s, r) => s + r.amount, 0);
    const rep = {
      killer: killer ? { id: killer.id, name: killer.name, hp: Math.max(0, Math.round(killer.hp)), armor: Math.round(killer.armor ?? 0), alive: killer.alive } : null,
      weapon: kill.weapon ?? last?.weapon ?? null,
      weaponName: weaponName(kill.weapon ?? last?.weapon),
      headshot: !!kill.headshot,
      distance: last ? Math.round(last.d) : killer && me ? Math.round(dist(eyePos(killer), chestPos(me))) : null,
      ttk: first && last ? Math.max(0, last.t - first.t) : 0,
      taken: { total: Math.round(recent.reduce((s, h) => s + h.amount, 0)), hits: recent.length, headshots: recent.filter((h) => h.headshot).length, armored: recent.filter((h) => h.armor).length, blocked: recent.filter((h) => h.blocked).length },
      attackers,
      dealt: { killer: dealtKiller ? Math.round(dealtKiller.amount) : 0, killerHits: dealtKiller?.hits ?? 0, total: Math.round(dealtTotal), shots: this.shots, hits: this.hitsLanded },
      state: last ? { moving: last.moving > 2, ads: last.ads, behind: last.facing > 1.9, side: last.facing > 1.0 && last.facing <= 1.9 } : null,
      armorKind: me?.armorKind ?? null,
      myWeapon: me?.weapon ?? null,
    };
    rep.tips = deathTips(rep);
    return rep;
  }
}

// 다음 교전을 위한 조언 (가장 중요한 것 두세 개)
export function deathTips(r) {
  const tips = [];
  const w = WEAPONS[r.myWeapon];
  if (r.state?.behind) tips.push(['뒤에서 당함', '발소리가 들리면 돌아보고, 분대원과 서로의 등을 맡기기 · 경보 센서로 뒤쪽 길목을 막기']);
  else if (r.state?.side) tips.push(['옆에서 당함', '열린 모서리를 하나씩 확인하며 이동 · 기울이기(Z·V)로 몸을 적게 내밀기']);
  if (r.ttk < 0.5 && r.taken.hits >= 2) tips.push(['순식간에 제압됨', '모르는 곳에 들어가기 전에 드론·RC카·카메라·심박 센서로 먼저 확인']);
  if (r.taken.headshots >= 2 || (r.headshot && r.taken.headshots >= 1)) tips.push(['머리에 맞음', '서서 오래 버티지 말고 앉기·기울이기로 머리 높이를 바꾸기']);
  if (r.state?.moving && !r.state?.ads) tips.push(['움직이며 맞음', '멈춰 서서 정조준하면 첫 발이 정확 · 달리며 쏘면 크게 빗나감']);
  if (r.distance != null && r.distance > 25 && w && ['smg', 'shotgun', 'mpistol', 'pistol'].includes(r.myWeapon)) tips.push(['먼 거리에서 짐', `${w.name}은 가까운 거리용 · 멀리 보이는 길은 소총·지정사수 소총으로`]);
  if (r.distance != null && r.distance < 6 && ['sniper', 'dmr'].includes(r.myWeapon)) tips.push(['가까운 거리에서 짐', '좁은 곳에서는 보조무기·기관단총으로 바꾸기']);
  if (!r.armorKind && r.taken.hits >= 3) tips.push(['방탄 없음', '방탄을 사면 몸통 피해가 크게 줄어듦 · 과학: 같은 힘도 넓은 면적에 퍼지면 압력이 작아짐']);
  if (r.dealt.shots >= 8 && r.dealt.hits / r.dealt.shots < 0.15) tips.push(['명중률이 낮음', `쏜 ${r.dealt.shots}발 중 ${r.dealt.hits}발 명중 · 짧게 끊어 쏘고 반동이 가라앉으면 다시`]);
  if (r.killer && r.killer.hp <= 30 && r.killer.hp > 0) tips.push(['거의 이겼음', `상대 체력 ${r.killer.hp}만 남음 · 분대원에게 위치를 알리면(H) 마무리해 줌`]);
  if (!tips.length) tips.push(['정보 싸움', '먼저 본 쪽이 이김 · 소리·무전·장비로 적 위치를 먼저 알아내기']);
  return tips.slice(0, 3);
}
