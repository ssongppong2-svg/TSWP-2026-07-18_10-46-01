import { TEAM_INFO, TEAMS, BOMB, ULT } from '../sim/constants.js';
import { LOADOUT_SLOTS, PATCHES, PATCH_TIERS, WEAPONS } from '../sim/data.js';
import { COMMANDS } from '../client/input.js';
import { PATCH_ICONS, WEAPON_ICONS } from './icons.js';
import { TacticalMap } from './minimap.js';

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
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 탄창 무게로 느끼는 대략적인 양 / 몸 상태 (정확한 숫자는 보여 주지 않음)
const magText = (f) => (f <= 0 ? '비었음' : f < 0.25 ? '거의 없음' : f < 0.55 ? '절반 이하' : f < 0.9 ? '절반 이상' : '가득');
const hpText = (hp) => (hp >= 80 ? '이상 없음' : hp >= 50 ? '경상' : hp >= 25 ? '중상' : '위독');

const ORDER_NAME = { regroup: '집결', hold: '위치 사수', move: '지정 지점 이동', A: 'A 목표', B: 'B 목표' };

// 경기 중 화면: 바디캠처럼 최소한만 표시 (적 정보 없음, 체력·탄약 숫자 없음)
export class Hud {
  constructor(root, match, localId, settings = {}) {
    this.match = match;
    this.localId = localId;
    this.settings = settings;
    this.root = el('div', 'hud');
    root.appendChild(this.root);
    const me = match.agentById(localId);
    this.myTeam = me.team;
    const mates = match.agents.filter((a) => a.team === me.team);
    const callsign = `${TEAM_INFO[me.team].code.slice(0, 1)}-${pad(mates.indexOf(me) + 1)}`;
    const mapName = match.map.def.nameEn ?? match.map.name;

    this.root.innerHTML = `
      <div class="bodycam">
        <div class="bc-rec"><i></i>REC</div>
        <div class="bc-line bc-time"></div>
        <div class="bc-line">AX-7 BODYCAM · ${callsign} · ${TEAM_INFO[me.team].name} · ${esc(mapName)}</div>
      </div>
      <div class="hud-top">
        <div class="tb-team tb-${me.team}"><span class="tb-name">${TEAM_INFO[me.team].name}</span><div class="pips"></div></div>
        <div class="clock">
          <div class="clock-time">2:00</div>
          <div class="bombs">
            <div class="bomb-pill" data-bomb="A"><b>A</b><i></i></div>
            <div class="bomb-pill" data-bomb="B"><b>B</b><i></i></div>
          </div>
        </div>
      </div>
      <div class="objective"><small>임무</small><span></span></div>
      <div class="crosshair"><b></b></div>
      <div class="center-prompt"></div>
      <div class="exposed">위치 노출 · 적 무게 감지기</div>
      <div class="countdown"><small>교전 개시까지</small><b></b></div>
      <div class="banner"><div class="banner-title"></div><div class="banner-sub"></div></div>
      <div class="comms">
        <div class="order"><small>현재 지시</small><b>자율 교전</b></div>
        <div class="radio-log"></div>
      </div>
      <div class="hud-bottom">
        <div class="patch-bar"></div>
      </div>
      <div class="weapon-box">
        <div class="amp-badge">합력 강화 중</div>
        <div class="wpn-flash"><span class="wname"></span></div>
        <div class="inspect">
          <div><small>탄창</small><b class="ins-mag"></b></div>
          <div><small>예비</small><b class="ins-res"></b></div>
          <div><small>상태</small><b class="ins-hp"></b></div>
        </div>
      </div>
      <div class="hint-keys"><kbd>G</kbd> 지휘 <kbd>T</kbd> 탄창 확인 <kbd>M</kbd> 작전 지도</div>
      <div class="concept-toast"></div>
      <div class="spectate"></div>
      <div class="status-vignette"></div>
      <div class="cmd-wheel"></div>
      <div class="tac-map"><div class="tm-head"><b>작전 지도</b><span>${esc(match.map.name)} · 적 위치 정보 없음 · ? = 무전 보고된 소리</span></div><canvas></canvas></div>
    `;
    const $ = (s) => this.root.querySelector(s);
    this.$ = $;
    this.els = {
      bcTime: $('.bc-time'),
      time: $('.clock-time'),
      clock: $('.clock'),
      pills: Object.fromEntries([...this.root.querySelectorAll('.bomb-pill')].map((p) => [p.dataset.bomb, p])),
      pips: $('.tb-team .pips'),
      objective: $('.objective span'),
      crosshair: $('.crosshair'),
      prompt: $('.center-prompt'),
      exposed: $('.exposed'),
      countdown: $('.countdown'),
      countNum: $('.countdown b'),
      banner: $('.banner'),
      bannerTitle: $('.banner-title'),
      bannerSub: $('.banner-sub'),
      patchBar: $('.patch-bar'),
      order: $('.order'),
      orderText: $('.order b'),
      radioLog: $('.radio-log'),
      wpnFlash: $('.wpn-flash'),
      wname: $('.wname'),
      inspect: $('.inspect'),
      insMag: $('.ins-mag'),
      insRes: $('.ins-res'),
      insHp: $('.ins-hp'),
      amp: $('.amp-badge'),
      toast: $('.concept-toast'),
      spectate: $('.spectate'),
      vignette: $('.status-vignette'),
      wheel: $('.cmd-wheel'),
      tacMap: $('.tac-map'),
      hint: $('.hint-keys'),
    };
    this.els.objective.textContent = TEAM_INFO[this.myTeam].goal;
    this.root.classList.add(`team-${this.myTeam}`);

    // 아군 생존 표시 (적은 표시하지 않음)
    for (const a of mates) {
      const p = el('i', 'pip');
      p.dataset.id = a.id;
      p.title = a.name;
      if (a.id === localId) p.classList.add('me');
      this.els.pips.appendChild(p);
    }

    // C·Q(일반) E(특수) X(필살) 개인 장착 슬롯
    this.patchEls = LOADOUT_SLOTS.map((slotDef, i) => {
      const p = me.patches[i];
      const slot = el('div', `patch-slot tier-${slotDef.tier}`);
      slot.style.setProperty('--tier', PATCH_TIERS[slotDef.tier].color);
      if (!p) {
        slot.classList.add('empty');
        slot.innerHTML = `<div class="ps-icon"><span class="ps-none">—</span></div><div class="ps-key">${slotDef.key}</div>`;
        this.els.patchBar.appendChild(slot);
        return null;
      }
      const def = PATCHES[p.id];
      slot.title = `${def.name} · ${def.short}`;
      slot.innerHTML = `
        <div class="ps-icon">${PATCH_ICONS[p.id]}<div class="ps-cd"></div><div class="ps-num"></div></div>
        <div class="ps-key">${slotDef.key}</div>`;
      this.els.patchBar.appendChild(slot);
      return { slot, cd: slot.querySelector('.ps-cd'), num: slot.querySelector('.ps-num') };
    });

    // 지휘 휠
    this.els.wheel.innerHTML = `<div class="cw-center">지휘</div>${COMMANDS.map((c, i) => {
      const r = 120;
      const x = Math.cos((c.angle * Math.PI) / 180) * r, y = Math.sin((c.angle * Math.PI) / 180) * r;
      return `<div class="cw-item" data-i="${i}" style="transform: translate(calc(-50% + ${x.toFixed(0)}px), calc(-50% + ${y.toFixed(0)}px))"><kbd>${c.key}</kbd><b>${c.label}</b><small>${c.sub}</small></div>`;
    }).join('')}`;
    this.wheelItems = [...this.els.wheel.querySelectorAll('.cw-item')];

    this.tacMap = new TacticalMap(this.els.tacMap.querySelector('canvas'), match, localId, { scale: Math.max(7, Math.min(12, Math.floor((window.innerHeight - 180) / match.map.rows))) });
    this.cache = {};
    this.bannerT = 0;
    this.bannerQueue = [];
    this.toastT = 0;
    this.clockT = 0;
    this.wpnT = 0;
    this.hintT = 14;
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

  // 무전 기록 (같은 팀만)
  radio({ name, text, kind = '' }) {
    const row = el('div', `radio-row k-${kind}`);
    row.innerHTML = `<b>${esc(name)}</b><span>${esc(text)}</span>`;
    this.els.radioLog.appendChild(row);
    setTimeout(() => row.classList.add('out'), 7000);
    setTimeout(() => row.remove(), 7600);
    while (this.els.radioLog.children.length > 5) this.els.radioLog.firstChild.remove();
  }

  order(order, issuer) {
    const text = order ? ORDER_NAME[order.type] ?? order.type : '자율 교전';
    this.els.orderText.textContent = text;
    this.els.order.classList.toggle('active', !!order);
    this.radio({ name: issuer?.name ?? '분대장', text: order ? `지시: ${text}` : '지시 해제. 자율 교전.', kind: 'order' });
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

  update(dt, { viewAgent, spectating, inspect = 0, showMap = false, wheel = null }) {
    const m = this.match;
    const me = m.agentById(this.localId);
    const a = viewAgent ?? me;
    const E = this.els;

    // 바디캠 시각
    this.clockT -= dt;
    if (this.clockT <= 0) {
      this.clockT = 0.5;
      const d = new Date();
      const sec = Math.floor(Math.max(0, m.time - (m.liveAt ?? 0)));
      E.bcTime.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} · T+${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    }

    // 시간과 폭탄 (폭탄 상태는 경보음·무전으로 알 수 있는 정보)
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
    for (const ag of m.agents) {
      if (ag.team !== this.myTeam) continue;
      this.set(`pip${ag.id}`, ag.alive, (v) => this.root.querySelector(`.pip[data-id="${ag.id}"]`)?.classList.toggle('dead', !v));
    }

    // 무기: 바꿀 때만 잠깐 이름 표시
    const w = WEAPONS[a.weapon];
    this.set('wsel', a.weapon, () => {
      E.wname.innerHTML = `${WEAPON_ICONS[a.weapon] ?? ''}<span>${w.name}</span>`;
      this.wpnT = 1.6;
    });
    this.wpnT -= dt;
    this.set('wflash', this.wpnT > 0 || (a.reloadT > 0 && !w.melee), (v) => E.wpnFlash.classList.toggle('show', v));
    this.set('wreload', a.reloadT > 0 && !w.melee, (v) => E.wpnFlash.classList.toggle('reloading', v));
    this.set('amp', a.ampT > 0 && a.weapon === 'rifle', (v) => E.amp.classList.toggle('show', v));

    // 탄창 확인 (T): 대략적인 양과 몸 상태만
    const ws = a.weapons[a.weapon];
    const insOn = inspect > 0.55 && a.alive;
    this.set('insOn', insOn, (v) => E.inspect.classList.toggle('show', v));
    if (insOn) {
      this.set('insMag', w.melee ? '—' : magText(ws.mag / w.magSize), (v) => (E.insMag.textContent = v));
      this.set('insRes', w.melee ? '—' : `${Math.ceil(ws.reserve / w.magSize)}개`, (v) => (E.insRes.textContent = v));
      this.set('insHp', hpText(a.hp), (v) => {
        E.insHp.textContent = v;
        E.insHp.dataset.level = a.hp >= 80 ? 'ok' : a.hp >= 50 ? 'mid' : 'bad';
      });
    }

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

    // 조준점: 작은 점 하나 (설정에서 끌 수 있음), 정조준·해체 중에는 숨김
    const chOff = this.settings.crosshair === 'off';
    this.set('chHide', chOff || !!a.lockpick || !a.alive || a.adsT > 0.5 || wheel !== null, (v) => E.crosshair.classList.toggle('hide', v));

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
    this.set('spec', spectating ? `관전 · <b>${esc(a.name)}</b> <span>클릭: 다음 아군</span>` : '', (v) => {
      E.spectate.innerHTML = v;
      E.spectate.classList.toggle('show', !!v);
      this.root.classList.toggle('spectating', !!v);
    });

    // 지휘 휠
    this.set('wheelOpen', wheel !== null, (v) => E.wheel.classList.toggle('show', v));
    this.set('wheelSel', wheel, (v) => this.wheelItems.forEach((it, i) => it.classList.toggle('on', i === v)));

    // 작전 지도 (M)
    this.set('map', showMap, (v) => E.tacMap.classList.toggle('show', v));
    if (showMap) this.tacMap.update(dt, a);

    // 처음 몇 초만 조작 안내
    this.hintT -= dt;
    this.set('hint', this.hintT > 0 && m.phase !== 'ended', (v) => E.hint.classList.toggle('show', v));

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
  }

  dispose() {
    this.root.remove();
  }
}
