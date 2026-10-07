import { TEAM_INFO, TEAMS, BOMB, ULT } from '../sim/constants.js';
import { LOADOUT_SLOTS, PATCHES, PATCH_TIERS, WEAPONS } from '../sim/data.js';
import { PATCH_ICONS, WEAPON_ICONS } from './icons.js';
import { Minimap } from './minimap.js';

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const fmtTime = (s) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const pad = (n) => String(n).padStart(2, '0');

// 경기 중 화면 정보 (체력·탄약·패치·타이머·킬 로그·미니맵·바디캠 표시)
export class Hud {
  constructor(root, match, localId) {
    this.match = match;
    this.localId = localId;
    this.root = el('div', 'hud');
    root.appendChild(this.root);
    const me = match.agentById(localId);
    this.myTeam = me.team;
    const callsign = `${TEAM_INFO[me.team].code.slice(0, 1)}-${pad(match.agents.filter((a) => a.team === me.team).indexOf(me) + 1)}`;

    this.root.innerHTML = `
      <div class="bodycam">
        <div class="bc-rec"><i></i>REC</div>
        <div class="bc-line bc-time"></div>
        <div class="bc-line">AX-7 BODYCAM · ${callsign} · ${TEAM_INFO[me.team].name}</div>
      </div>
      <div class="hud-top">
        <div class="tb-team tb-defuse"><span class="tb-name">해체</span><b class="tb-count"></b><div class="pips"></div></div>
        <div class="clock">
          <div class="clock-time">2:00</div>
          <div class="bombs">
            <div class="bomb-pill" data-bomb="A"><b>A</b><i></i></div>
            <div class="bomb-pill" data-bomb="B"><b>B</b><i></i></div>
          </div>
        </div>
        <div class="tb-team tb-force"><div class="pips"></div><b class="tb-count"></b><span class="tb-name">포스</span></div>
      </div>
      <div class="objective"><small>임무</small><span></span></div>
      <div class="minimap-wrap"><canvas class="minimap"></canvas></div>
      <div class="killfeed"></div>
      <div class="crosshair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><b></b></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="dmg-layer"></div>
      <div class="center-prompt"></div>
      <div class="exposed">위치 노출 · 적 무게 감지기</div>
      <div class="countdown"><small>교전 개시까지</small><b></b></div>
      <div class="banner"><div class="banner-title"></div><div class="banner-sub"></div></div>
      <div class="hud-bottom">
        <div class="vitals">
          <div class="hp-num">100</div>
          <div class="hp-col"><div class="hp-label">HP</div><div class="hp-bar"><i></i></div></div>
        </div>
        <div class="patch-bar"></div>
      </div>
      <div class="weapon-box">
        <div class="amp-badge">합력 24 + 3 = <b>27</b></div>
        <div class="ammo"><b class="mag">25</b><span class="reserve">75</span></div>
        <div class="wname"></div>
        <div class="wslots">
          <div class="wslot" data-w="rifle"><span>1</span>${WEAPON_ICONS.rifle}</div>
          <div class="wslot" data-w="pistol"><span>2</span>${WEAPON_ICONS.pistol}</div>
          <div class="wslot" data-w="knife"><span>3</span>${WEAPON_ICONS.knife}</div>
        </div>
      </div>
      <div class="concept-toast"></div>
      <div class="spectate"></div>
      <div class="status-vignette"></div>
    `;
    const $ = (s) => this.root.querySelector(s);
    this.$ = $;
    this.els = {
      bcTime: $('.bc-time'),
      time: $('.clock-time'),
      clock: $('.clock'),
      pills: Object.fromEntries([...this.root.querySelectorAll('.bomb-pill')].map((p) => [p.dataset.bomb, p])),
      pipsD: $('.tb-defuse .pips'),
      pipsF: $('.tb-force .pips'),
      countD: $('.tb-defuse .tb-count'),
      countF: $('.tb-force .tb-count'),
      objective: $('.objective span'),
      killfeed: $('.killfeed'),
      crosshair: $('.crosshair'),
      hitmarker: $('.hitmarker'),
      dmg: $('.dmg-layer'),
      prompt: $('.center-prompt'),
      exposed: $('.exposed'),
      countdown: $('.countdown'),
      countNum: $('.countdown b'),
      banner: $('.banner'),
      bannerTitle: $('.banner-title'),
      bannerSub: $('.banner-sub'),
      hpNum: $('.hp-num'),
      hpBar: $('.hp-bar i'),
      vitals: $('.vitals'),
      patchBar: $('.patch-bar'),
      mag: $('.mag'),
      reserve: $('.reserve'),
      wname: $('.wname'),
      wslots: [...this.root.querySelectorAll('.wslot')],
      amp: $('.amp-badge'),
      toast: $('.concept-toast'),
      spectate: $('.spectate'),
      vignette: $('.status-vignette'),
    };
    this.els.objective.textContent = TEAM_INFO[this.myTeam].goal;
    this.root.classList.add(`team-${this.myTeam}`);

    for (const team of [TEAMS.DEFUSE, TEAMS.FORCE]) {
      const box = team === TEAMS.DEFUSE ? this.els.pipsD : this.els.pipsF;
      box.innerHTML = '';
      for (const a of match.agents.filter((x) => x.team === team)) {
        const p = el('i', 'pip');
        p.dataset.id = a.id;
        p.title = a.name;
        if (a.id === localId) p.classList.add('me');
        box.appendChild(p);
      }
    }

    // C·Q(일반) E(특수) X(필살) 개인 장착 슬롯
    this.patchEls = LOADOUT_SLOTS.map((slotDef, i) => {
      const p = me.patches[i];
      const slot = el('div', `patch-slot tier-${slotDef.tier}`);
      slot.style.setProperty('--tier', PATCH_TIERS[slotDef.tier].color);
      if (!p) {
        slot.classList.add('empty');
        slot.innerHTML = `<div class="ps-icon"><span class="ps-none">—</span></div><div class="ps-key">${slotDef.key}</div><div class="ps-name">미장착</div>`;
        this.els.patchBar.appendChild(slot);
        return null;
      }
      const def = PATCHES[p.id];
      slot.title = `${def.name} · ${def.short}`;
      slot.innerHTML = `
        <div class="ps-icon">${PATCH_ICONS[p.id]}<div class="ps-cd"></div><div class="ps-num"></div></div>
        <div class="ps-key">${slotDef.key}</div>
        <div class="ps-name">${def.name}</div>`;
      this.els.patchBar.appendChild(slot);
      return { slot, cd: slot.querySelector('.ps-cd'), num: slot.querySelector('.ps-num') };
    });

    this.minimap = new Minimap($('.minimap'), match, localId);
    this.cache = {};
    this.bannerT = 0;
    this.bannerQueue = [];
    this.toastT = 0;
    this.clockT = 0;
    this.shownConcepts = new Set();
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  banner(title, sub = '', kind = '') {
    this.bannerQueue.push({ title, sub, kind });
    if (this.bannerQueue.length > 3) this.bannerQueue.shift();
  }

  killfeed(killer, victim, weapon, headshot) {
    const row = el('div', 'kf-row');
    const kName = killer ? `<span class="kf-name t-${killer.team}">${killer.name}</span>` : '';
    row.innerHTML = `${kName}<span class="kf-weapon">${weapon ? WEAPON_ICONS[weapon] ?? '' : '✕'}</span>${headshot ? '<span class="kf-hs">HS</span>' : ''}<span class="kf-name t-${victim.team}">${victim.name}</span>`;
    if (killer?.id === this.localId || victim.id === this.localId) row.classList.add('mine');
    this.els.killfeed.prepend(row);
    setTimeout(() => row.classList.add('out'), 5000);
    setTimeout(() => row.remove(), 5600);
    while (this.els.killfeed.children.length > 5) this.els.killfeed.lastChild.remove();
  }

  hitMarker(headshot, killed) {
    const h = this.els.hitmarker;
    h.classList.remove('show', 'head', 'kill');
    void h.offsetWidth;
    h.classList.add('show');
    if (headshot) h.classList.add('head');
    if (killed) h.classList.add('kill');
  }

  damageFrom(angle) {
    const d = el('div', 'dmg-arc');
    d.style.transform = `rotate(${angle}rad)`;
    this.els.dmg.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  // 패치를 처음 쓸 때 해당 힘의 개념을 교범 형식으로 표시
  concept(patchId) {
    if (this.shownConcepts.has(patchId)) return;
    this.shownConcepts.add(patchId);
    const def = PATCHES[patchId];
    const t = this.els.toast;
    t.innerHTML = `<div class="ct-head" style="--c:${PATCH_TIERS[def.tier].color}">${PATCH_ICONS[patchId]}<div><small>교범 참조 · ${def.name}</small><b>${def.concept}</b></div></div><p>${def.conceptText}</p>`;
    t.classList.add('show');
    this.toastT = 7;
  }

  update(dt, { viewAgent, spectating }) {
    const m = this.match;
    const me = m.agentById(this.localId);
    const a = viewAgent ?? me;
    const E = this.els;

    // 바디캠 시각
    this.clockT -= dt;
    if (this.clockT <= 0) {
      this.clockT = 0.5;
      const d = new Date();
      const sec = Math.floor(m.time);
      E.bcTime.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} · T+${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    }

    // 시간과 폭탄
    this.set('time', fmtTime(m.timeLeft), (v) => (E.time.textContent = v));
    this.set('count', m.phase === 'prestart' ? Math.ceil(m.phaseT) : 0, (v) => {
      E.countNum.textContent = v;
      E.countdown.classList.toggle('show', v > 0);
    });
    this.set('urgent', m.phase === 'live' && m.timeLeft <= 30, (v) => E.clock.classList.toggle('urgent', v));
    for (const b of m.bombs) {
      const state = b.state === 'armed' && b.picker ? 'picking' : b.state;
      this.set(`bomb${b.id}`, state, (v) => (E.pills[b.id].dataset.state = v));
      this.set(`bombp${b.id}`, Math.round(b.progress * 20), (v) => E.pills[b.id].style.setProperty('--p', v / 20));
    }
    // 생존자
    for (const ag of m.agents) this.set(`pip${ag.id}`, ag.alive, (v) => this.root.querySelector(`.pip[data-id="${ag.id}"]`)?.classList.toggle('dead', !v));
    const aliveOf = (t) => m.agents.filter((x) => x.team === t && x.alive).length;
    this.set('countD', aliveOf(TEAMS.DEFUSE), (v) => (E.countD.textContent = v));
    this.set('countF', aliveOf(TEAMS.FORCE), (v) => (E.countF.textContent = v));

    // 체력
    this.set('hp', a.hp, (v) => {
      E.hpNum.textContent = Math.max(0, Math.ceil(v));
      E.hpBar.style.width = `${Math.max(0, v)}%`;
      E.vitals.classList.toggle('low', v <= 30);
    });

    // 무기
    const w = WEAPONS[a.weapon];
    const ws = a.weapons[a.weapon];
    this.set('mag', w.melee ? '—' : ws.mag, (v) => (E.mag.textContent = v));
    this.set('reserve', w.melee ? '' : ws.reserve, (v) => (E.reserve.textContent = v));
    let wname = `${w.name} · ${w.kind}`;
    if (a.reloadT > 0 && !w.melee) wname = `${w.name} · 재장전`;
    else if (w.melee) wname = `${w.name} · 좌 베기 / 우 찌르기`;
    this.set('wname', wname, (v) => (E.wname.textContent = v));
    this.set('wsel', a.weapon, (v) => E.wslots.forEach((s) => s.classList.toggle('on', s.dataset.w === v)));
    this.set('magLow', !w.melee && ws.mag <= Math.ceil(w.magSize * 0.25), (v) => E.mag.classList.toggle('low', v));
    this.set('amp', a.ampT > 0 && a.weapon === 'rifle', (v) => E.amp.classList.toggle('show', v));

    // 포스 패치 재사용 대기·필살 게이지
    if (!spectating) {
      me.patches.forEach((p, i) => {
        const pe = this.patchEls[i];
        if (!p || !pe) return;
        const def = PATCHES[p.id];
        let frac, label, ready;
        if (def.tier === 'ultimate') {
          frac = 1 - me.ult / ULT.max;
          ready = me.ult >= ULT.max;
          label = ready ? '' : `${Math.floor(me.ult)}%`;
        } else {
          frac = p.cd / def.cooldown;
          ready = p.cd <= 0;
          label = ready ? '' : Math.ceil(p.cd);
        }
        const active = p.activeT > 0;
        this.set(`pcd${i}`, Math.round(frac * 60), (v) => pe.cd.style.setProperty('--p', v / 60));
        this.set(`pnum${i}`, active ? `${p.activeT.toFixed(1)}` : label, (v) => (pe.num.textContent = v));
        this.set(`pready${i}`, ready, (v) => pe.slot.classList.toggle('ready', v));
        this.set(`pact${i}`, active, (v) => pe.slot.classList.toggle('active', v));
      });
    }

    // 조준점: 이동·점프·연사로 벌어지고, 앉기·정조준으로 좁아짐. 정조준 중에는 조준경 사용
    if (w.melee) {
      this.set('spread', -1, () => E.crosshair.style.setProperty('--gap', '3px'));
    } else {
      const moving = Math.hypot(a.vel.x, a.vel.z) > 1.2;
      let spread = w.spreadBase + a.bloom + (moving ? w.spreadMove : 0) + (!a.onGround ? w.spreadAir : 0);
      spread *= (1 + (w.adsSpread - 1) * a.adsT) * (1 + (w.crouchSpread - 1) * a.crouch);
      this.set('spread', Math.round(spread * 700), (v) => E.crosshair.style.setProperty('--gap', `${3 + v * 0.5}px`));
    }
    this.set('chMelee', !!w.melee, (v) => E.crosshair.classList.toggle('melee', v));
    this.set('chHide', !!a.lockpick || !a.alive || a.adsT > 0.6, (v) => E.crosshair.classList.toggle('hide', v));

    // 상호작용 안내
    let prompt = '';
    if (m.phase === 'live' && a.alive && !spectating && !a.lockpick) {
      const near = m.bombs.find((b) => b.state === 'armed' && Math.hypot(a.pos.x - b.x, a.pos.z - b.z) <= BOMB.interactRange);
      if (near) {
        if (a.team === TEAMS.DEFUSE) prompt = near.picker ? `폭탄 ${near.id} · 아군 해체 진행 중. 엄호.` : `<kbd>F</kbd> 폭탄 ${near.id} 해체 개시`;
        else prompt = `폭탄 ${near.id} 구역 · 방어 유지`;
      }
      const heldZone = a.held ? m.zones.find((z) => z.id === a.held.zoneId) : null;
      if (heldZone) prompt = heldZone.type === 'net' ? '탄성 그물에 구속됨' : '중력 붕괴에 구속됨';
      else if (a.slippery) prompt = '마찰력 0 구역 · 제동 불가';
      else if (a.mired) prompt = '마찰 폭풍 · 기동력 저하';
    }
    this.set('prompt', prompt, (v) => {
      E.prompt.innerHTML = v;
      E.prompt.classList.toggle('show', !!v);
    });
    this.set('exposed', a.alive && a.revealedUntil > m.time, (v) => E.exposed.classList.toggle('show', v));

    // 상태 테두리 효과
    let vig = '';
    if (a.held) vig = 'held';
    else if (a.slippery) vig = 'slip';
    else if (a.mired) vig = 'mired';
    this.set('vig', vig, (v) => (E.vignette.dataset.state = v));

    // 관전
    this.set('spec', spectating ? `관전 · <b>${a.name}</b> <span>클릭: 다음 아군</span>` : '', (v) => {
      E.spectate.innerHTML = v;
      E.spectate.classList.toggle('show', !!v);
      this.root.classList.toggle('spectating', !!v);
    });

    // 배너
    this.bannerT -= dt;
    if (this.bannerT <= 0 && this.bannerQueue.length) {
      const b = this.bannerQueue.shift();
      E.bannerTitle.textContent = b.title;
      E.bannerSub.textContent = b.sub;
      E.banner.dataset.kind = b.kind;
      E.banner.classList.remove('show');
      void E.banner.offsetWidth;
      E.banner.classList.add('show');
      this.bannerT = 2.2;
    } else if (this.bannerT <= 0) E.banner.classList.remove('show');

    this.toastT -= dt;
    if (this.toastT <= 0) E.toast.classList.remove('show');

    this.minimap.update(dt, a);
  }

  dispose() {
    this.root.remove();
  }
}
