import { TEAM_INFO, TEAMS, BOMB, ULT } from '../sim/constants.js';
import { PATCH_CONCEPT } from '../sim/concepts.js';
import { LOADOUT_SLOTS, PATCHES, PATCH_TIERS, WEAPONS } from '../sim/data.js';
import { COMMANDS } from '../client/input.js';
import { GEAR_ICONS, PATCH_ICONS, WEAPON_ICONS } from './icons.js';
import { TacticalMap } from './minimap.js';
import { money } from './shop.js';

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

const ORDER_NAME = { regroup: '집결', hold: '위치 사수', move: '지정 지점 이동', A: 'A 목표', B: 'B 목표' };
const BOMB_STATE = { armed: '무장', picking: '해체 중', defused: '해체됨', exploded: '폭발' };

// 경기 중 화면 = 연구소 요원 바디캠의 계기판.
// 왼쪽 위: 녹화 표시·요원 식별 + 미니맵 · 위 가운데: 분대 생존(점)·점수·시간·폭탄 상태 · 오른쪽 위: 제압 기록
// 아래 왼쪽: 생체 신호·보호막 · 아래 가운데: 포스 패치 계기(충전 고리) · 아래 오른쪽: 에너지(J)·탄약·무기
export class Hud {
  constructor(root, match, localId, settings = {}) {
    this.match = match;
    this.localId = localId;
    this.settings = settings;
    this.root = el('div', 'hud');
    root.appendChild(this.root);
    const me = match.agentById(localId);
    this.squad = me.squad;
    const mapName = match.map.def.nameEn ?? match.map.name;

    const sideName = TEAM_INFO[me.team]?.name ?? '';
    this.root.innerHTML = `
      <div class="cam">
        <div class="cam-rec"><i></i>REC <b class="cam-t">00:00</b></div>
        <div class="cam-id">${esc(match.map.def.code ?? 'LAB')} · ${esc(sideName)} · ${esc(me.name)}</div>
      </div>
      <div class="cam-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
      <div class="vh-top">
        <div class="st-side ally"><span class="st-label">아군</span><div class="st-pips"></div><b class="st-score">0</b></div>
        <div class="st-mid"><div class="st-clock">2:00</div><div class="st-sub"></div></div>
        <div class="st-side enemy"><b class="st-score">0</b><div class="st-pips"></div><span class="st-label">상대</span></div>
        <div class="st-bombs">
          <div class="bomb-chip" data-bomb="A"><b>A</b><span>무장</span><i></i></div>
          <div class="bomb-chip" data-bomb="B"><b>B</b><span>무장</span><i></i></div>
        </div>
      </div>
      <div class="scope"><i class="sc-h"></i><i class="sc-v"></i><i class="sc-dot"></i></div>
      <div class="vh-minimap"><canvas></canvas></div>
      <div class="vh-feed"></div>
      <div class="crosshair"><i class="ch-dot"></i><i class="ch-l"></i><i class="ch-r"></i><i class="ch-t"></i><i class="ch-b"></i></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="vh-dmg"></div>
      <div class="center-prompt"></div>
      <div class="exposed">위치 노출 · 적 무게 감지기</div>
      <div class="vh-round"><small class="vr-kicker"></small><div class="vr-title"></div><div class="vr-sub"></div></div>
      <div class="banner"><div class="banner-title"></div><div class="banner-sub"></div></div>
      <div class="comms">
        <div class="order"><small>현재 지시</small><b>자율 교전</b></div>
        <div class="radio-log"></div>
      </div>
      <div class="vh-killbanner"><b class="kb-text"></b><div class="kb-icons"></div></div>
      <div class="vh-buyhint"><kbd>B</kbd> 보급 단말기 <span class="bh-e">에너지 <b class="bh-money"></b> J</span><span class="bh-quiz">점검 문제 +200 J</span></div>
      <div class="vh-vitals">
        <div class="vt-row hp"><small>생체</small><b class="vt-num">100</b><div class="vt-bar"><i></i></div></div>
        <div class="vt-row ar"><small>보호막</small><b class="vt-num">0</b><div class="vt-bar"><i></i></div><span class="va-icon"></span></div>
      </div>
      <div class="hud-bottom"><div class="patch-bar"></div></div>
      <div class="vh-weapon">
        <div class="amp-badge">합력 강화</div>
        <div class="vw-energy">${GEAR_ICONS.credit}<b></b><span>J</span></div>
        <div class="vw-ammo"><b class="am-mag">0</b><span class="am-res">/ 0</span></div>
        <div class="vw-name"></div>
      </div>
      <div class="hint-keys"><kbd>B</kbd> 보급 <kbd>1·2·3</kbd> 무기 <kbd>C·Q·E·X</kbd> 포스 패치 <kbd>F</kbd> 해체·장치 <kbd>G</kbd> 지휘 <kbd>M</kbd> 지도 <kbd>Tab</kbd> 전황</div>
      <div class="concept-toast"></div>
      <div class="spectate"></div>
      <div class="status-vignette"></div>
      <div class="cmd-wheel"></div>
      <div class="tac-map"><div class="tm-head"><b>작전 지도</b><span>${esc(match.map.name)} · 붉은 점: 아군이 보고 있는 적 · ? 소리 보고 · ! 목격 보고</span></div><canvas></canvas></div>
    `;
    const $ = (s) => this.root.querySelector(s);
    this.$ = $;
    this.els = {
      cam: $('.cam'),
      camT: $('.cam-t'),
      top: $('.vh-top'),
      allyPips: $('.st-side.ally .st-pips'),
      enemyPips: $('.st-side.enemy .st-pips'),
      allyScore: $('.st-side.ally .st-score'),
      enemyScore: $('.st-side.enemy .st-score'),
      clock: $('.st-clock'),
      sub: $('.st-sub'),
      spikes: Object.fromEntries([...this.root.querySelectorAll('.bomb-chip')].map((p) => [p.dataset.bomb, p])),
      feed: $('.vh-feed'),
      crosshair: $('.crosshair'),
      hitmarker: $('.hitmarker'),
      dmg: $('.vh-dmg'),
      prompt: $('.center-prompt'),
      exposed: $('.exposed'),
      round: $('.vh-round'),
      roundKicker: $('.vr-kicker'),
      roundTitle: $('.vr-title'),
      roundSub: $('.vr-sub'),
      banner: $('.banner'),
      bannerTitle: $('.banner-title'),
      bannerSub: $('.banner-sub'),
      killbanner: $('.vh-killbanner'),
      kbIcons: $('.kb-icons'),
      kbText: $('.kb-text'),
      buyhint: $('.vh-buyhint'),
      buyMoney: $('.bh-money'),
      buyQuiz: $('.bh-quiz'),
      armor: $('.vt-row.ar'),
      armorIcon: $('.va-icon'),
      armorNum: $('.vt-row.ar .vt-num'),
      armorBar: $('.vt-row.ar .vt-bar i'),
      hp: $('.vt-row.hp'),
      hpNum: $('.vt-row.hp .vt-num'),
      hpBar: $('.vt-row.hp .vt-bar i'),
      patchBar: $('.patch-bar'),
      order: $('.order'),
      orderText: $('.order b'),
      radioLog: $('.radio-log'),
      amp: $('.amp-badge'),
      money: $('.vw-energy'),
      moneyNum: $('.vw-energy b'),
      mag: $('.am-mag'),
      res: $('.am-res'),
      wname: $('.vw-name'),
      ammo: $('.vh-weapon'),
      toast: $('.concept-toast'),
      spectate: $('.spectate'),
      vignette: $('.status-vignette'),
      wheel: $('.cmd-wheel'),
      tacMap: $('.tac-map'),
      hint: $('.hint-keys'),
      scope: $('.scope'),
    };

    // 분대 생존 표시: 요원마다 점 하나 (내 분대 왼쪽, 상대 분대 오른쪽)
    this.rosterEls = new Map();
    for (const a of match.agents) {
      const ally = a.squad === this.squad;
      const p = el('i', `pip ${a.id === localId ? 'me' : ''}`);
      p.title = a.name;
      (ally ? this.els.allyPips : this.els.enemyPips).appendChild(p);
      this.rosterEls.set(a.id, p);
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
      const mastered = match.isMastered?.(me, p.id);
      slot.title = `${def.name} · ${def.short}${mastered ? ' · 개념 숙달: 재사용 대기 −15%' : ''}`;
      if (mastered) slot.classList.add('mastered');
      slot.innerHTML = `
        <div class="ps-icon">${PATCH_ICONS[p.id]}<div class="ps-cd"></div><div class="ps-num"></div>${mastered ? '<span class="ps-star" title="개념 숙달">★</span>' : ''}</div>
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

    this.miniMap = new TacticalMap(this.$('.vh-minimap canvas'), match, localId, { scale: 5, mini: true });
    this.tacMap = new TacticalMap(this.els.tacMap.querySelector('canvas'), match, localId, { scale: Math.max(7, Math.min(12, Math.floor((window.innerHeight - 180) / match.map.rows))) });
    this.cache = {};
    this.bannerT = 0;
    this.bannerQueue = [];
    this.roundT = 0;
    this.toastT = 0;
    this.clockT = 0;
    this.miniT = 0;
    this.hitT = 0;
    this.killT = 0;
    this.hintT = 16;
    this.shownConcepts = new Set();
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  // 작은 알림 (패치·경보 등)
  banner(title, sub = '', kind = '') {
    this.bannerQueue.push({ title, sub, kind });
    if (this.bannerQueue.length > 3) this.bannerQueue.shift();
  }

  // 화면 가운데 큰 알림 (라운드 시작·승리·패배·공수 교대)
  roundBanner(kicker, title, sub = '', kind = 'info', time = 2.6) {
    const E = this.els;
    // 큰 알림이 뜨면 밀려 있던 작은 알림은 버림 (겹쳐 보이지 않게)
    this.bannerQueue.length = 0;
    this.bannerT = 0;
    E.banner.classList.remove('show');
    E.roundKicker.textContent = kicker;
    E.roundTitle.textContent = title;
    E.roundSub.textContent = sub;
    E.round.dataset.kind = kind;
    E.round.classList.remove('show');
    void E.round.offsetWidth;
    E.round.classList.add('show');
    this.roundT = time;
  }

  // 처치 기록 (오른쪽 위)
  killFeed({ killer, victim, weapon, headshot }) {
    const me = this.match.agentById(this.localId);
    const side = (a) => (a?.squad === this.squad ? 'ally' : 'enemy');
    const row = el('div', `kf-row ${killer?.id === me.id || victim.id === me.id ? 'mine' : ''}`);
    const wIcon = WEAPON_ICONS[weapon] ?? '';
    row.innerHTML = `${killer ? `<b class="${side(killer)}">${esc(killer.name)}</b>` : ''}<span class="kf-w">${wIcon}</span>${headshot ? `<span class="kf-h">${GEAR_ICONS.head}</span>` : ''}<b class="${side(victim)}">${esc(victim.name)}</b>`;
    this.els.feed.appendChild(row);
    setTimeout(() => row.classList.add('out'), 6000);
    setTimeout(() => row.remove(), 6500);
    while (this.els.feed.children.length > 6) this.els.feed.firstChild.remove();
  }

  // 명중 표시: kind = hit / head / kill
  hitmark(kind) {
    const h = this.els.hitmarker;
    h.dataset.kind = kind;
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
    this.hitT = kind === 'kill' ? 0.45 : 0.22;
  }

  // 내가 제압했을 때 아래 가운데 표시 (이번 라운드 제압 수만큼 눈금)
  killStreak(n, headshot) {
    const E = this.els;
    const k = Math.max(1, Math.min(5, n));
    E.kbIcons.innerHTML = Array.from({ length: k }, (_, i) => `<i class="${i === k - 1 ? 'new' : ''}"></i>`).join('');
    E.kbText.textContent = `${headshot ? '머리 명중 · ' : ''}제압 ${k > 1 ? `×${k}` : '확인'}`;
    E.killbanner.dataset.n = k;
    E.killbanner.classList.remove('show');
    void E.killbanner.offsetWidth;
    E.killbanner.classList.add('show');
    this.killT = 1.8;
  }

  // 맞은 방향 표시 (angle: 화면 기준, 0 = 정면, 시계 방향 +)
  damageFrom(angle) {
    const d = el('i', 'dmg-arc');
    d.style.transform = `rotate(${angle}rad)`;
    this.els.dmg.appendChild(d);
    setTimeout(() => d.remove(), 1100);
    while (this.els.dmg.children.length > 4) this.els.dmg.firstChild.remove();
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

  // 맵에서 개념 카드를 주웠을 때
  conceptCard(c, { isNew, total, of }) {
    const t = this.els.toast;
    t.innerHTML = `<div class="ct-head" style="--c:#6fd3e8"><div class="ct-card">F</div><div><small>개념 카드 ${isNew ? '새로 획득' : '획득'} · 도감 ${total}/${of}</small><b>${esc(c.name)}</b></div></div><p>${esc(c.text)}</p>`;
    t.classList.add('show');
    this.toastT = 6;
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

  update(dt, { viewAgent, spectating, showMap = false, wheel = null, shopOpen = false }) {
    const m = this.match;
    const me = m.agentById(this.localId);
    const a = viewAgent ?? me;
    const E = this.els;
    const enemySquad = m.agents.find((x) => x.squad !== this.squad)?.squad;

    // 바디캠 계기: 녹화 시각(라운드 경과)은 늘 작게, 렌즈 테두리는 바디캠 설정일 때만
    this.set('bodycam', !!this.settings.bodycam, (v) => this.root.classList.toggle('lens', v));
    this.set('chStyle', this.settings.crosshair ?? 'cross', (v) => (E.crosshair.dataset.style = v));
    this.clockT -= dt;
    if (this.clockT <= 0) {
      this.clockT = 0.5;
      const sec = Math.floor(Math.max(0, m.time - (m.liveAt ?? 0)));
      E.camT.textContent = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    }

    // 점수·시간
    this.set('sA', m.score?.[this.squad] ?? 0, (v) => (E.allyScore.textContent = v));
    this.set('sE', m.score?.[enemySquad] ?? 0, (v) => (E.enemyScore.textContent = v));
    const buying = m.phase === 'buy';
    const clock = fmtTime(buying ? m.phaseT : m.timeLeft);
    this.set('clock', clock, (v) => (E.clock.textContent = v));
    let sub;
    if (buying) sub = m.rounds ? `보급 · 라운드 ${m.round}` : '작전 개시 대기';
    else if (m.phase === 'roundEnd') sub = `라운드 ${m.round} 종료`;
    else if (m.phase === 'ended') sub = '경기 종료';
    else sub = m.rounds ? `라운드 ${m.round} · ${a.team === TEAMS.DEFUSE ? '공격' : '수비'}` : TEAM_INFO[me.team].name;
    this.set('sub', sub, (v) => (E.sub.textContent = v));
    this.set('urgent', m.phase === 'live' && m.timeLeft <= 30, (v) => E.clock.classList.toggle('urgent', v));
    this.set('buying', buying, (v) => E.top.classList.toggle('buying', v));
    for (const b of m.bombs) {
      const state = b.state === 'armed' && b.picker ? 'picking' : b.state;
      this.set(`bomb${b.id}`, state, (v) => {
        E.spikes[b.id].dataset.state = v;
        E.spikes[b.id].querySelector('span').textContent = BOMB_STATE[v] ?? v;
      });
      this.set(`bombp${b.id}`, Math.round(b.progress * 20), (v) => E.spikes[b.id].style.setProperty('--p', v / 20));
      this.set(`bombf${b.id}`, (b.y ?? 0) > 1, (v) => E.spikes[b.id].classList.toggle('upper', v));
    }
    for (const ag of m.agents) {
      this.set(`rp${ag.id}`, ag.alive, (v) => this.rosterEls.get(ag.id)?.classList.toggle('dead', !v));
    }

    // 체력·방탄 (관전 중이면 보고 있는 요원)
    const hp = a.alive ? Math.max(0, Math.round(a.hp)) : 0;
    this.set('hp', hp, (v) => {
      E.hpNum.textContent = v;
      E.hpBar.style.transform = `scaleX(${v / 100})`;
      E.hp.dataset.level = v > 50 ? 'ok' : v > 25 ? 'mid' : 'bad';
    });
    const armor = a.alive ? Math.round(a.armor ?? 0) : 0;
    this.set('armor', armor, (v) => {
      E.armorNum.textContent = v;
      E.armor.classList.toggle('none', v <= 0);
      E.armorBar.style.transform = `scaleX(${Math.min(1, v / 50)})`;
    });
    this.set('armorKind', (a.armorMax ?? 0) > 25 ? 'heavy' : (a.armorMax ?? 0) > 0 ? 'light' : 'none', (v) => (E.armorIcon.innerHTML = GEAR_ICONS[v] ?? GEAR_ICONS.light));

    // 탄약·무기
    const w = WEAPONS[a.weapon];
    const ws = a.weapons[a.weapon];
    this.set('wsel', a.weapon, () => (E.wname.innerHTML = `${WEAPON_ICONS[a.weapon] ?? ''}<span>${w.name}</span>`));
    // 온라인에서 다른 사람을 관전하면 탄약은 모름 → —
    this.set('mag', w.melee || !ws ? '—' : ws.mag, (v) => {
      E.mag.textContent = v;
      E.mag.classList.toggle('low', !w.melee && typeof v === 'number' && v <= Math.ceil(w.magSize * 0.25));
    });
    this.set('res', w.melee || !ws ? '' : `/ ${ws.reserve}`, (v) => (E.res.textContent = v));
    this.set('reloading', a.reloadT > 0 && !w.melee, (v) => E.ammo.classList.toggle('reloading', v));
    this.set('amp', a.ampT > 0 && !w.melee, (v) => E.amp.classList.toggle('show', v));
    const credits = me.credits ?? 0;
    this.set('money', m.rounds ? money(credits) : '', (v) => {
      E.moneyNum.textContent = v;
      E.buyMoney.textContent = v;
      E.money.classList.toggle('show', !!v);
    });
    this.set('buyhint', buying && m.rounds && me.alive && !shopOpen && !spectating, (v) => E.buyhint.classList.toggle('show', v));
    this.set('buyquiz', !!(me.quiz && !me.quiz.done), (v) => E.buyQuiz.classList.toggle('show', v));

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
        this.set(`pcd${i}`, Math.round(frac * 60), (v) => pe.slot.style.setProperty('--p', v / 60));
        this.set(`pnum${i}`, active ? `${p.activeT.toFixed(1)}` : label, (v) => (pe.num.textContent = v));
        this.set(`pready${i}`, ready, (v) => pe.slot.classList.toggle('ready', v));
        this.set(`pact${i}`, active, (v) => pe.slot.classList.toggle('active', v));
      });
    }

    // 조준점: 정조준(저격 조준경)·해체·상점 중에는 숨김
    const chOff = this.settings.crosshair === 'off';
    const scoped = !!w.scope && a.adsT > 0.5;
    this.set('scope', a.alive && !!w.scope && a.adsT > 0.85, (v) => E.scope.classList.toggle('show', v));
    this.set('chHide', !!(chOff || a.lockpick || !a.alive || scoped || wheel !== null || shopOpen), (v) => E.crosshair.classList.toggle('hide', v));
    this.hitT -= dt;
    if (this.hitT <= 0) E.hitmarker.classList.remove('show');

    // 상호작용 안내
    let prompt = '';
    if (m.phase === 'live' && a.alive && !spectating && !a.lockpick) {
      const near = m.bombs.find((b) => b.state === 'armed' && Math.hypot(a.pos.x - b.x, a.pos.z - b.z) <= BOMB.interactRange);
      if (near) {
        if (a.team === TEAMS.DEFUSE) prompt = near.picker ? `폭탄 ${near.id} · 아군 해체 진행 중. 엄호.` : `<kbd>F</kbd> 폭탄 ${near.id} 해체 개시`;
        else prompt = `폭탄 ${near.id} · 방어 유지`;
      }
      // 지렛대 (지레 셔터)
      const lever = !near && m.devices?.leverAt(a);
      if (lever) prompt = `<kbd>F</kbd> ${lever.d.name ?? '지레 셔터'} ${lever.d.st.closed ? '올리기' : '내리기'}`;
      // 미는 상자: 붙어서 밀고 있으면 합력 표시
      if (!near && !lever) {
        const crate = m.devices?.list.find((d) => d.type === 'crate' && d.st.pushers > 0 && Math.hypot(a.pos.x - m.map.cellX(d.st.c), a.pos.z - m.map.cellZ(d.st.r)) < 1.7);
        if (crate) prompt = `상자 미는 중 · 합력 ${crate.st.pushers}명 <small>(같은 방향으로 함께 밀면 더 빨리)</small>`;
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

    // 미니맵 (초당 약 12번) · 작전 지도 (M)
    this.miniT -= dt;
    if (this.miniT <= 0) {
      this.miniT = 0.08;
      this.miniMap.update(dt, a);
    }
    this.set('map', showMap, (v) => E.tacMap.classList.toggle('show', v));
    if (showMap) this.tacMap.update(dt, a);

    // 처음 몇 초만 조작 안내
    this.hintT -= dt;
    this.set('hint', this.hintT > 0 && m.phase !== 'ended', (v) => E.hint.classList.toggle('show', v));

    // 알림
    this.bannerT -= dt;
    if (this.bannerT <= 0 && this.bannerQueue.length && this.roundT <= 0.4) {
      const b = this.bannerQueue.shift();
      E.bannerTitle.textContent = b.title;
      E.bannerSub.textContent = b.sub;
      E.banner.dataset.kind = b.kind;
      E.banner.classList.remove('show');
      void E.banner.offsetWidth;
      E.banner.classList.add('show');
      this.bannerT = 2.2;
    } else if (this.bannerT <= 0) E.banner.classList.remove('show');
    this.roundT -= dt;
    if (this.roundT <= 0) E.round.classList.remove('show');
    this.killT -= dt;
    if (this.killT <= 0) E.killbanner.classList.remove('show');

    this.toastT -= dt;
    if (this.toastT <= 0) E.toast.classList.remove('show');
  }

  dispose() {
    this.root.remove();
  }
}

