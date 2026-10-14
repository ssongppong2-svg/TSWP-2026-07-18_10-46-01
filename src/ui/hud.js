import { TEAM_INFO, TEAMS, BOMB, LOAD, ULT } from '../sim/constants.js';
import { carriedMass, loadFactors } from '../sim/agent.js';
import { PATCH_CONCEPT } from '../sim/concepts.js';
import { AMMO, ARMOR, LOADOUT_SLOTS, PATCHES, PATCH_TIERS, WEAPONS } from '../sim/data.js';
import { DRONE, GADGET_ORDER, GEAR, RC, THROW_ORDER } from '../sim/gear.js';
import { COMMANDS } from '../client/input.js';
import { ENTRY_NAME, ENTRY_PHASE } from '../sim/entry-orders.js';
import { GEAR_ICONS, PATCH_ICONS, WEAPON_ICONS } from './icons.js';
import { TacticalMap } from './minimap.js';
import { money } from './shop.js';
import { K, kbd, kbds } from '../core/keys.js';

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

// 조준경 조준선 (SVG · 가운데가 0,0 · 반지름 100 = 조준경 둥근 창 가장자리)
//   선마다 밑에 옅은 밝은 테를 깔아 어두운 곳에서도 또렷하게 · 가운데 점·꺾쇠는 빛나는 붉은색
const scopeLine = (x1, y1, x2, y2, w) =>
  `<line class="sc-halo" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w + 0.7}"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w}"/>`;
// 굵은 기둥: 가장자리에서 r0까지, 안쪽 끝은 살짝 가늘어짐 (dir: 0 오른쪽 · 1 아래 · 2 왼쪽 · 3 위)
const scopePost = (dir, r0, w) => {
  const pts = [[100, -w], [r0 + 4, -w], [r0, -w * 0.55], [r0, w * 0.55], [r0 + 4, w], [100, w]];
  const rot = ([x, y]) => [[x, y], [-y, x], [-x, -y], [y, -x]][dir];
  return `<polygon class="sc-post" points="${pts.map((p) => rot(p).map((v) => +v.toFixed(2)).join(',')).join(' ')}"/>`;
};
// 눈금: 가는 선 위 일정 간격 (10마다 긴 눈금)
const scopeTicks = (from, to, step, axis) => {
  let s = '';
  for (let v = from; v <= to; v += step) {
    if (!v) continue;
    const L = Math.abs(v) % 10 === 0 ? 1.7 : 0.9;
    s += axis === 'x' ? scopeLine(v, -L, v, L, 0.32) : scopeLine(-L, v, L, v, 0.32);
  }
  return s;
};
const SCOPE_LENS = `<circle class="sc-rim" r="99.4"/><path class="sc-glint" d="M-79,-58 A98,98 0 0 1 -30,-93"/>`;
const SCOPE_SVG = `
  <svg class="sc-ret sc-sniper" viewBox="-100 -100 200 200" aria-hidden="true">
    ${SCOPE_LENS}
    <g class="sc-lines">
      ${scopePost(0, 30, 1.4)}${scopePost(1, 30, 1.4)}${scopePost(2, 30, 1.4)}${scopePost(3, 30, 1.4)}
      ${scopeLine(-30, 0, 30, 0, 0.34)}${scopeLine(0, -30, 0, 30, 0.34)}
      ${scopeTicks(-25, 25, 5, 'x')}${scopeTicks(-25, 25, 5, 'y')}
    </g>
    <circle class="sc-glow" r="3"/><circle class="sc-mark" r="1.05"/>
  </svg>
  <svg class="sc-ret sc-lpvo" viewBox="-100 -100 200 200" aria-hidden="true">
    ${SCOPE_LENS}
    <g class="sc-lines">
      ${scopePost(0, 38, 1.3)}${scopePost(1, 38, 1.3)}${scopePost(2, 38, 1.3)}
      ${scopeLine(-38, 0, -5, 0, 0.3)}${scopeLine(5, 0, 38, 0, 0.3)}${scopeLine(0, 5, 0, 38, 0.3)}
      ${[[8, 5], [13, 4], [18, 3], [23, 2.2]].map(([y, w]) => scopeLine(-w, y, w, y, 0.3)).join('')}
    </g>
    <path class="sc-glow sc-chev" d="M-3.2,3.6 L0,0 L3.2,3.6"/><path class="sc-mark sc-chev" d="M-3.2,3.6 L0,0 L3.2,3.6"/>
  </svg>`;

const ORDER_NAME = { regroup: '집결', hold: '위치 사수', move: '지정 지점 이동', A: 'A 목표', B: 'B 목표' };
const BOMB_STATE = { armed: '무장', picking: '해체 중', defused: '해체됨', exploded: '폭발' };

// 경기 중 화면 = 연구소 요원 바디캠의 계기판.
// 왼쪽 위: 녹화 표시·요원 식별 + 미니맵 · 위 가운데: 분대 생존(점)·점수·시간·폭탄 상태 · 오른쪽 위: 제압 기록
// 아래 왼쪽: 생체 신호·방탄(등급·내구도) · 아래 가운데: 포스 패치 계기(충전 고리) · 아래 오른쪽: 에너지(J)·탄약·무기
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

    const sideName = match.op ? '진압팀' : TEAM_INFO[me.team]?.name ?? '';
    this.root.innerHTML = `
      <div class="scope">${SCOPE_SVG}</div>
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
      <div class="vh-buyhint"><kbd class="bh-key"></kbd> 보급 단말기 <span class="bh-e">에너지 <b class="bh-money"></b> J</span><span class="bh-quiz">점검 문제 +200 J</span></div>
      <div class="vh-vitals">
        <div class="vt-row hp"><small>생체</small><b class="vt-num">100</b><div class="vt-bar"><i></i></div></div>
        <div class="vt-row ar"><small class="va-lbl">방탄</small><b class="vt-num">0</b><div class="vt-bar"><i></i></div><span class="va-icon"></span></div>
        <div class="vt-row st"><small>지구력</small><div class="vt-bar"><i></i></div><span class="vt-load"></span></div>
      </div>
      <div class="hud-bottom"><div class="patch-bar"></div></div>
      <div class="op-panel"><div class="op-head"><small>작전 목표</small><b class="op-name"></b></div><ul class="op-obj"></ul></div>
      <div class="op-task"><b class="ot-label"></b><div class="ot-bar"><i></i></div><small>움직이거나 쏘면 취소</small></div>
      <div class="vh-weapon">
        <div class="amp-badge">합력 강화</div>
        <div class="vw-energy">${GEAR_ICONS.credit}<b></b><span>J</span></div>
        <div class="vw-gear"></div>
        <div class="vw-ammo"><span class="am-type"></span><b class="am-mag">0</b><span class="am-res">/ 0</span></div>
        <div class="vw-name"></div>
      </div>
      <div class="drone-hud"><div class="dh-frame"><i></i><i></i><i></i><i></i></div><div class="dh-box"></div>
        <div class="dh-top"><b class="dh-name">정찰 드론 · 라이브</b><span class="dh-bat"><i></i></span><em class="dh-sec"></em></div>
        <div class="dh-keys"></div></div>
      <div class="mirror-hud"><div class="mh-lens"></div><div class="mh-box"></div>
        <div class="mh-top"><b>문 밑 카메라</b><span>광각 · 건너편</span></div>
        <div class="mh-keys"></div></div>
      <div class="cam-hud"><div class="ch-lens"></div><div class="ch-static"></div><div class="ch-box"></div>
        <div class="ch-top"><b>카메라 · 라이브</b><span class="ch-idx"></span></div>
        <div class="ch-off"><b>신호 없음</b><span>EMP · 잠시 뒤 돌아옴</span></div>
        <div class="ch-keys"></div></div>
      <div class="pulse-hud"><div class="ph-screen"><div class="ph-fan"></div><i class="ph-me"></i><div class="ph-dots"></div></div>
        <div class="ph-text"><b>심장 박동</b><span class="ph-n">탐지 중</span></div></div>
      <div class="emp-hud"><b>EMP</b><span>전자 장비 먹통 · 지도·장비 정지 <em class="emp-sec"></em></span></div>
      <div class="death-card"></div>
      <div class="hint-keys"></div>
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
      armorLbl: $('.va-lbl'),
      stamina: $('.vt-row.st'),
      staminaBar: $('.vt-row.st .vt-bar i'),
      load: $('.vt-load'),
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
      ammoType: $('.am-type'),
      gear: $('.vw-gear'),
      drone: $('.drone-hud'),
      opPanel: $('.op-panel'),
      opName: $('.op-name'),
      opObj: $('.op-obj'),
      opTask: $('.op-task'),
      opTaskLabel: $('.ot-label'),
      opTaskBar: $('.ot-bar i'),
      mirror: $('.mirror-hud'),
      droneBat: $('.dh-bat i'),
      droneSec: $('.dh-sec'),
      droneName: $('.dh-name'),
      camHud: $('.cam-hud'),
      camIdx: $('.ch-idx'),
      pulse: $('.pulse-hud'),
      pulseDots: $('.ph-dots'),
      pulseN: $('.ph-n'),
      emp: $('.emp-hud'),
      empSec: $('.emp-sec'),
      deathCard: $('.death-card'),
      toast: $('.concept-toast'),
      spectate: $('.spectate'),
      vignette: $('.status-vignette'),
      wheel: $('.cmd-wheel'),
      tacMap: $('.tac-map'),
      hint: $('.hint-keys'),
      scope: $('.scope'),
    };

    // CQB 작전: 점수 대신 작전 목표, 상대는 용의자 (점 = 제압 현황), 없는 장치 칸은 숨김
    if (match.op) {
      this.root.classList.add('op');
      this.$('.st-side.ally .st-label').textContent = '진압팀';
      this.$('.st-side.enemy .st-label').textContent = '용의자';
      this.els.opName.textContent = match.op.mission.name;
      this.els.orderText.textContent = '대장 따라감';
      for (const chip of this.root.querySelectorAll('.bomb-chip')) if (!match.bombs.some((b) => b.id === chip.dataset.bomb)) chip.remove();
    }
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
        slot.innerHTML = `<div class="ps-icon"><span class="ps-none">—</span></div><div class="ps-key">${K(`patch${i}`)}</div>`;
        this.els.patchBar.appendChild(slot);
        return null;
      }
      const def = PATCHES[p.id];
      const mastered = match.isMastered?.(me, p.id);
      slot.title = `${def.name} · ${def.short}${mastered ? ' · 개념 숙달: 재사용 대기 −15%' : ''}`;
      if (mastered) slot.classList.add('mastered');
      slot.innerHTML = `
        <div class="ps-icon">${PATCH_ICONS[p.id]}<div class="ps-cd"></div><div class="ps-num"></div>${mastered ? '<span class="ps-star" title="개념 숙달">★</span>' : ''}</div>
        <div class="ps-key">${K(`patch${i}`)}</div>`;
      this.els.patchBar.appendChild(slot);
      return { slot, cd: slot.querySelector('.ps-cd'), num: slot.querySelector('.ps-num') };
    });

    // 지휘 휠 (G) · 문 행동 휠 (문 앞에서 F 길게)
    this.renderWheel({ title: '지휘', items: COMMANDS });
    this.refreshKeys();

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

  // CQB 작전: 목표 목록(0.25초마다) · 결박 풀기·자료 확보 진행 막대
  updateOp(dt, me) {
    const m = this.match;
    const E = this.els;
    this.opT = (this.opT ?? 0) - dt;
    if (this.opT <= 0) {
      this.opT = 0.25;
      const objs = m.op.objectives();
      const sig = objs.map((o) => `${o.done ? 1 : 0}${o.failed ? 1 : 0}${o.detail}`).join('|');
      this.set('opObj', sig, () => {
        E.opObj.innerHTML = objs.map((o) => `<li class="${o.done ? 'done' : ''} ${o.failed ? 'failed' : ''}"><i></i><span>${esc(o.label)}</span><b>${esc(o.detail)}</b></li>`).join('');
      });
    }
    const t = me.opTask;
    this.set('opTaskOn', !!t, (v) => E.opTask.classList.toggle('show', v));
    if (t) {
      const item = t.kind === 'free' ? m.op.hostages[t.id] : m.op.intel[t.id];
      this.set('opTaskLabel', `${t.kind}${t.id}`, () => (E.opTaskLabel.textContent = t.kind === 'free' ? `결박 푸는 중 · ${item?.name ?? ''}` : `자료 확보 중 · ${item?.name ?? ''}`));
      this.set('opTaskP', Math.round((t.t / t.need) * 40), (v) => (E.opTaskBar.style.transform = `scaleX(${v / 40})`));
    }
  }

  // 휠 항목 그리기 (항목·켜짐이 바뀔 때만 다시)
  renderWheel(def) {
    const key = `${def.title}|${def.items.map((c) => `${c.label}${c.sub}${c.off ? 0 : 1}`).join('|')}`;
    if (this.wheelKey === key) return;
    this.wheelKey = key;
    this.els.wheel.dataset.kind = def.title === '지휘' ? 'cmd' : 'door';
    this.els.wheel.innerHTML = `<div class="cw-center">${esc(def.title)}</div>${def.items.map((c, i) => {
      const r = 120;
      const x = Math.cos((c.angle * Math.PI) / 180) * r, y = Math.sin((c.angle * Math.PI) / 180) * r;
      return `<div class="cw-item${c.off ? ' off' : ''}" data-i="${i}" style="transform: translate(calc(-50% + ${x.toFixed(0)}px), calc(-50% + ${y.toFixed(0)}px))"><kbd>${c.key}</kbd><b>${esc(c.label)}</b><small>${esc(c.sub)}</small></div>`;
    }).join('')}`;
    this.wheelItems = [...this.els.wheel.querySelectorAll('.cw-item')];
    if (this.cache) this.cache.wheelSel = undefined; // 새 항목에 선택 표시를 다시 칠함
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

  // 명중 표시: kind = hit / head / kill / block (방탄이 막음)
  // 키 안내 (키 바꾸기에서 바꾸면 다시 그림)
  refreshKeys() {
    const op = this.root.classList.contains('op');
    const $ = (s) => this.root.querySelector(s);
    this.els.hint.innerHTML = `${kbd('shop')} 보급 ${kbds('primary', 'secondary', 'knife')} 무기 ${kbds('throw', 'gadget')} 장비 ${op ? '' : `${kbds('patch0', 'patch1', 'patch2', 'patch3')} 포스 패치 `}${kbd('interact')} ${op ? '결박·자료·해체·문' : '해체·장치·문'} ${kbd('interact')} 길게 문 행동 ${kbd('command')} 지휘 ${kbd('map')} 지도 ${kbd('score')} 전황`;
    const bh = $('.bh-key');
    if (bh) bh.textContent = K('shop');
    const dk = $('.dh-keys');
    if (dk) dk.innerHTML = `${kbds('forward', 'left', 'back', 'right')} 이동 ${kbd('jump')} 위 ${kbd('crouch')} 아래 <kbd>왼쪽 클릭</kbd> 적 표시 ${kbd('interact')} 복귀`;
    const mk = $('.mh-keys');
    if (mk) mk.innerHTML = `<kbd>마우스</kbd> 둘러보기 <kbd>왼쪽 클릭</kbd> 적 표시 ${kbd('interact')}·이동 거두기`;
    const ck = $('.ch-keys');
    if (ck) ck.innerHTML = `<kbd>마우스</kbd> 둘러보기 <kbd>왼쪽 클릭</kbd> 적 표시 <kbd>오른쪽 클릭</kbd> 다음 카메라 ${kbd('interact')}·이동 거두기`;
    this.droneKeys = {
      drone: `${kbds('forward', 'left', 'back', 'right')} 이동 ${kbd('jump')} 위 ${kbd('crouch')} 아래 <kbd>왼쪽 클릭</kbd> 적 표시 ${kbd('interact')} 복귀`,
      rc: `${kbds('forward', 'left', 'back', 'right')} 운전 <kbd>마우스</kbd> 방향 ${kbd('jump')} 깡충 <kbd>왼쪽 클릭</kbd> 적 표시 ${kbd('interact')} 복귀`,
    };
    if (this.cache) delete this.cache.droneKind; // 드론·RC카 안내도 다시
    (this.patchEls ?? []).forEach((p, i) => {
      const key = (p?.slot ?? this.els.patchBar.children[i])?.querySelector('.ps-key');
      if (key) key.textContent = K(`patch${i}`);
    });
    if (this.cache) delete this.cache.gear; // 장비 칸의 키 표시도 다시
  }

  // 죽음 분석표: 무엇에 당했는지 · 받은 피해 · 내가 준 피해 · 다음엔
  deathCard(r) {
    const E = this.els;
    if (!r) {
      E.deathCard.classList.remove('show');
      return;
    }
    const k = r.killer;
    const hpBar = (v) => `<i class="dc-hp"><i style="transform:scaleX(${Math.max(0, Math.min(1, v / 100)).toFixed(2)})"></i></i>`;
    const icon = WEAPON_ICONS[r.weapon] ?? GEAR_ICONS[r.weapon] ?? '';
    const rows = r.attackers.slice(0, 3).map((x) => `<li><b>${esc(x.name)}</b><span>${x.hits}발${x.headshots ? ` · 머리 ${x.headshots}` : ''}</span><em>${Math.round(x.amount)}</em></li>`).join('');
    const acc = r.dealt.shots ? ` · 명중 ${r.dealt.hits}/${r.dealt.shots}` : '';
    E.deathCard.innerHTML = `
      <header><small>죽음 분석</small><b>${k ? esc(k.name) : '알 수 없음'}</b><span class="dc-w">${icon}${esc(r.weaponName)}${r.headshot ? ' <em>머리</em>' : ''}</span></header>
      <div class="dc-facts">
        <div><small>거리</small><b>${r.distance != null ? `${r.distance} m` : '—'}</b></div>
        <div><small>교전</small><b>${r.ttk < 0.05 ? '한 번에' : `${r.ttk.toFixed(1)}초`}</b></div>
        <div><small>상대 남은 체력</small><b>${k ? (k.alive ? k.hp : '제압됨') : '—'}</b>${k && k.alive ? hpBar(k.hp) : ''}</div>
      </div>
      <section><h5>받은 피해 <em>${r.taken.total}</em><span>${r.taken.hits}발${r.taken.headshots ? ` · 머리 ${r.taken.headshots}` : ''}${r.taken.blocked ? ` · 방탄이 막음 ${r.taken.blocked}` : ''}</span></h5><ul>${rows}</ul></section>
      <section><h5>내가 준 피해 <em>${r.dealt.total}</em><span>${k ? `${esc(k.name)}에게 ${r.dealt.killer}` : ''}${acc}</span></h5></section>
      <section class="dc-tips"><h5>다음엔</h5>${r.tips.map(([t, d]) => `<p><b>${esc(t)}</b>${esc(d)}</p>`).join('')}</section>
      <footer>${kbd('jump')} 닫기 · 클릭 다른 아군 보기</footer>`;
    E.deathCard.classList.add('show');
  }

  hitmark(kind) {
    const h = this.els.hitmarker;
    h.dataset.kind = kind;
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
    this.hitT = kind === 'kill' ? 0.45 : kind === 'supp' ? 0.12 : 0.22;
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
    // CQB 작전에서 명령이 없으면 봇은 대장을 따라감
    const none = this.match.op ? '대장 따라감' : '자율 교전';
    const text = order ? ORDER_NAME[order.type] ?? ENTRY_NAME[order.type] ?? order.type : none;
    this.els.orderText.textContent = text;
    this.cache.orderPhase = undefined; // 진입 명령이면 단계가 이어서 붙음
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
    // 작전: 장치를 모두 해체하면 제한 시간 대신 '해체 완료'
    const clock = m.op?.devicesDone && !buying ? '해체 완료' : fmtTime(buying ? m.phaseT : m.timeLeft);
    this.set('clock', clock, (v) => (E.clock.textContent = v));
    let sub;
    if (buying && m.op) sub = m.client ? `준비 · ${K('shop')} 보급 · 방장이 개시` : `준비 · ${K('shop')} 보급 · ${K('start')} 작전 개시`;
    else if (m.op && m.phase === 'live') sub = m.op.devicesDone ? `${m.op.mission.code} · 시간 제한 없음` : `${m.op.mission.code} · 장치 폭발까지`;
    else if (buying) sub = m.rounds ? `보급 · 라운드 ${m.round}` : '작전 개시 대기';
    else if (m.phase === 'roundEnd') sub = `라운드 ${m.round} 종료`;
    else if (m.phase === 'ended') sub = '경기 종료';
    else sub = m.rounds ? `라운드 ${m.round} · ${a.team === TEAMS.DEFUSE ? '공격' : '수비'}` : TEAM_INFO[me.team].name;
    this.set('sub', sub, (v) => (E.sub.textContent = v));
    this.set('urgent', m.phase === 'live' && m.timeLeft <= 30 && !m.op?.devicesDone, (v) => E.clock.classList.toggle('urgent', v));
    if (m.op) this.updateOp(dt, me);
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
    // 방탄: 내구도(숫자·막대) + 등급 (닳을수록 막대가 줄고, 0이면 부서져 사라짐)
    const armor = a.alive ? Math.round(a.armor ?? 0) : 0;
    const kind = armor > 0 ? ARMOR[a.armorKind] : null;
    const amax = a.armorMax || kind?.dur || 1;
    this.set('armor', `${armor}/${amax}`, () => {
      E.armorNum.textContent = armor;
      E.armor.classList.toggle('none', armor <= 0);
      E.armorBar.style.transform = `scaleX(${Math.min(1, armor / amax)})`;
      E.armor.dataset.level = armor / amax > 0.5 ? 'ok' : 'worn';
    });
    this.set('armorKind', kind?.id ?? 'none', (v) => {
      E.armorIcon.innerHTML = GEAR_ICONS[v] ?? '';
      E.armorLbl.innerHTML = kind ? `방탄<em>${kind.cls}등급${kind.helmet ? '·헬멧' : ''}</em>` : '방탄';
    });

    // 지구력 · 장비 무게 (질량 kg과 무게 N = 질량 × 9.8)
    const st = a.alive ? Math.round(a.stamina ?? 100) : 0;
    this.set('stamina', `${st}|${a.tired ? 1 : 0}`, () => {
      E.staminaBar.style.transform = `scaleX(${st / 100})`;
      E.stamina.dataset.level = a.tired ? 'tired' : st < 30 ? 'low' : 'ok';
    });
    const mass = carriedMass(a);
    this.set('load', Math.round(mass * 10), () => {
      const f = loadFactors(mass);
      E.load.textContent = `${mass.toFixed(1)} kg · ${Math.round(mass * LOAD.g)} N`;
      E.load.title = f.over > 0 ? `무거움: 이동 ${Math.round((1 - f.speed) * 100)}% 느림 · 출발·멈춤이 둔함(관성)` : '가벼움';
      E.load.classList.toggle('heavy', f.over > 0);
    });

    // 탄약·무기
    const w = WEAPONS[a.weapon];
    const ws = a.weapons[a.weapon];
    // 총 이름 + 발사 방식 (점사·단발 총만 작게 표시 — 자동은 기본)
    if (!a.equip) this.set('wsel', a.weapon, () => (E.wname.innerHTML = `${WEAPON_ICONS[a.weapon] ?? ''}<span>${w.name}</span>${w.burst ? `<em class="vw-mode">${w.burst}점사</em>` : !w.auto && !w.melee ? '<em class="vw-mode">단발</em>' : ''}`));
    // 온라인에서 다른 사람을 관전하면 탄약은 모름 → —
    this.set('mag', w.melee || !ws ? '—' : ws.mag, (v) => {
      E.mag.textContent = v;
      E.mag.classList.toggle('low', !w.melee && typeof v === 'number' && v <= Math.ceil(w.magSize * 0.25));
    });
    this.set('res', w.melee || !ws ? '' : `/ ${ws.reserve}`, (v) => (E.res.textContent = v));
    // 투척·장비: 가진 것과 개수, 손에 든 것은 밝게 (4 투척물 · 5 C4/기폭기)
    const eq = a.equip;
    const charges = (m.charges ?? []).filter((c) => c.ownerId === a.id).length;
    const gearItems = [...THROW_ORDER, ...GADGET_ORDER].filter((id) => (a.gear?.[id] ?? 0) > 0);
    // 손에 있는 드론·RC카: 남은 배터리(초) — 충전 중(띄울 수 없음)이면 흐리게
    const bat = (id) => ((a.gear?.[id] ?? 0) > 0 ? Math.floor(a[id === 'rc' ? 'rcBat' : 'droneBat'] ?? GEAR[id].battery) : -1);
    const dBat = bat('drone'), rBat = bat('rc');
    const teamCams = m.gadgets?.teamCams(a.team).length ?? 0;
    const gearSig = `${gearItems.map((id) => `${id}${a.gear[id]}`).join(',')}|${eq?.kind ?? ''}${eq?.id ?? ''}|${charges}|${dBat}|${rBat}|${teamCams}`;
    this.set('gear', gearSig, () => {
      const on = (id) => (eq?.kind === 'throw' && eq.id === id) || (id === eq?.kind && GADGET_ORDER.includes(id));
      const cells = gearItems.map((id) => (id === 'drone' || id === 'rc')
        ? `<span class="vg ${on(id) ? 'on' : ''} ${(id === 'rc' ? rBat : dBat) < (id === 'rc' ? RC : DRONE).minLaunch ? 'low' : ''}" title="${GEAR[id].name} · 배터리 ${id === 'rc' ? rBat : dBat}초">${GEAR_ICONS[id]}<i>${id === 'rc' ? rBat : dBat}s</i></span>`
        : `<span class="vg ${on(id) ? 'on' : ''}" title="${GEAR[id].name}">${GEAR_ICONS[id]}${a.gear[id] > 1 ? `<i>${a.gear[id]}</i>` : ''}</span>`);
      if (charges) cells.push(`<span class="vg ${eq?.kind === 'det' ? 'on' : ''}" title="기폭기 · 붙인 C4 ${charges}개">${GEAR_ICONS.det}<i>${charges}</i></span>`);
      if (teamCams) cells.push(`<span class="vg ${eq?.kind === 'camview' ? 'on' : ''}" title="카메라 보기 · 팀 카메라 ${teamCams}개">${GEAR_ICONS.camview}<i>${teamCams}</i></span>`);
      E.gear.innerHTML = cells.length ? `${kbds('throw', 'gadget')}${cells.join('')}` : '';
      E.gear.classList.toggle('show', cells.length > 0);
    });
    if (eq) {
      const name = eq.kind === 'throw' ? GEAR[eq.id].name : { c4: 'C4 폭약', det: '기폭기', camview: '카메라 보기' }[eq.kind] ?? GEAR[eq.kind]?.name ?? '';
      this.set('wsel', `gear:${name}`, () => (E.wname.innerHTML = `${GEAR_ICONS[eq.kind === 'throw' ? eq.id : eq.kind] ?? ''}<span>${name}</span>`));
    }
    // 탄종 (일반탄이 아니면 탄약 앞에 표시)
    const ammoId = w.melee ? 'fmj' : a.ammo ?? 'fmj';
    this.set('ammoType', ammoId, (v) => {
      E.ammoType.textContent = v === 'fmj' ? '' : AMMO[v]?.short ?? '';
      E.ammoType.dataset.ammo = v;
    });
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
    // 정조준하면 총의 조준기(도트·꺾쇠·가늠쇠)로 겨눔 → 화면 조준점은 숨김
    const sighted = !w.melee && !a.equip && a.adsT > 0.7;
    this.set('scope', a.alive && !!w.scope && a.adsT > 0.85, (v) => E.scope.classList.toggle('show', v));
    this.set('scopeKind', w.scope === 'lpvo', (v) => E.scope.classList.toggle('lpvo', v)); // 지정사수 저배율 조준경
    // 드론 조종 화면: 배터리·조작법, 보통 조준점은 숨김
    const drone = a.drone ? (m.drones ?? []).find((d) => d.id === a.drone) : null;
    this.set('drone', !!drone, (v) => {
      E.drone.classList.toggle('show', v);
      this.root.classList.toggle('droning', v);
    });
    if (drone) {
      const kind = drone.kind ?? 'drone';
      const bat = Math.max(0, drone.battery ?? 0);
      this.set('droneKind', kind, (v) => {
        E.droneName.textContent = v === 'rc' ? 'RC카 · 라이브' : '정찰 드론 · 라이브';
        E.drone.querySelector('.dh-keys').innerHTML = this.droneKeys?.[v] ?? '';
        E.drone.classList.toggle('rc', v === 'rc');
      });
      this.set('droneBat', Math.ceil(bat), (v) => {
        E.droneSec.textContent = `${v}초`;
        E.droneBat.style.transform = `scaleX(${bat / GEAR[kind].battery})`;
        E.drone.classList.toggle('low', v <= 5);
      });
    }
    // 던진 카메라 화면: 몇 번째 카메라 · EMP면 신호 없음
    const cv = a.alive && a.camView ? m.gadgets?.view(a) : null;
    this.set('camHud', !!cv, (v) => {
      E.camHud.classList.toggle('show', v);
      this.root.classList.toggle('camming', v);
    });
    if (cv) {
      const list = m.gadgets.teamCams(a.team);
      const i = list.findIndex((c) => c.id === cv.cam.id);
      const owner = m.agentById(cv.cam.ownerId);
      this.set('camIdx', `${i + 1}/${list.length}|${owner?.name ?? ''}`, () => (E.camIdx.textContent = `${i + 1} / ${list.length}${owner && owner !== a ? ` · ${owner.name}` : ''}`));
      this.set('camOff', cv.off, (v) => E.camHud.classList.toggle('off', v));
    }
    // 심장 박동 센서: 앞쪽 부채꼴 화면에 점 (가까울수록 아래 가운데에 가까움)
    const pulsing = a.alive && a.equip?.kind === 'pulse';
    this.set('pulseHud', pulsing, (v) => E.pulse.classList.toggle('show', v));
    this.set('pulseOn', pulsing && !!a.pulseOn, (v) => E.pulse.classList.toggle('on', v));
    if (pulsing) {
      const hits = a.pulseOn ? a.pulseHits ?? [] : [];
      const sig = hits.map((h) => `${h.id}:${Math.round(h.x * 2)},${Math.round(h.z * 2)}`).join('|') + (a.pulseOn ? '' : 'x') + Math.round(a.yaw * 20);
      this.set('pulseDots', sig, () => {
        const R = GEAR.pulse.range;
        const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
        E.pulseDots.innerHTML = hits.map((h) => {
          const dx = h.x - a.pos.x, dz = h.z - a.pos.z;
          const f = (dx * fx + dz * fz) / R, r = (dx * rx + dz * rz) / R;
          const up = h.y - a.pos.y > 1.5 ? 'up' : h.y - a.pos.y < -1.5 ? 'down' : '';
          return `<i class="${up}" style="left:${(50 + r * 50).toFixed(1)}%;bottom:${Math.max(0, f * 100).toFixed(1)}%"><em>${Math.round(h.d)}</em></i>`;
        }).join('');
        E.pulseN.innerHTML = !a.pulseOn ? `<kbd>왼쪽 클릭</kbd> 누르고 있으면 탐지 · 앞쪽 ${GEAR.pulse.range} m · 벽 너머 ${kbd('primary')} 총` : hits.length ? `${hits.length}명 · 가장 가까움 ${Math.round(hits[0].d)} m` : '앞쪽 15 m 안 없음';
      });
    }
    // EMP: 바디캠·장비 먹통 남은 시간
    const empT = a.alive ? a.empT ?? 0 : 0;
    this.set('emp', empT > 0, (v) => {
      E.emp.classList.toggle('show', v);
      this.root.classList.toggle('emped', v);
    });
    if (empT > 0) this.set('empSec', Math.ceil(empT), (v) => (E.empSec.textContent = `${v}초`));
    // 문 밑 카메라 화면
    const mirror = !!a.mirror && a.alive;
    this.set('mirror', mirror, (v) => {
      E.mirror.classList.toggle('show', v);
      this.root.classList.toggle('mirroring', v);
    });
    this.set('chHide', !!(chOff || a.lockpick || !a.alive || scoped || sighted || wheel !== null || shopOpen || drone || mirror || cv), (v) => E.crosshair.classList.toggle('hide', v));
    this.hitT -= dt;
    if (this.hitT <= 0) E.hitmarker.classList.remove('show');

    // 상호작용 안내
    let prompt = '';
    if (m.phase === 'live' && a.alive && !spectating && !a.lockpick) {
      const near = m.bombs.find((b) => b.state === 'armed' && Math.hypot(a.pos.x - b.x, a.pos.z - b.z) <= BOMB.interactRange);
      if (near) {
        if (a.team === TEAMS.DEFUSE) prompt = near.picker ? `폭탄 ${near.id} · 아군 해체 진행 중. 엄호.` : `${kbd('interact')} 폭탄 ${near.id} 해체 개시`;
        else prompt = `폭탄 ${near.id} · 방어 유지`;
      }
      // 지렛대 (지레 셔터)
      const lever = !near && m.devices?.leverAt(a);
      if (lever) prompt = `${kbd('interact')} ${lever.d.name ?? '지레 셔터'} ${lever.d.st.closed ? '올리기' : '내리기'}`;
      // CQB 작전: 연구원 결박 풀기 · 연구 자료 확보
      // (결박을 푸는 중이면 진행 막대만 — 안내는 숨김)
      const opT = !near && !lever && !a.opTask && m.op?.targetFor(a);
      if (opT) prompt = opT.kind === 'free' ? `${kbd('interact')} 결박 풀기 · ${esc(opT.item.name)} <small>(풀면 스스로 투입 지점으로 이동)</small>` : `${kbd('interact')} 연구 자료 확보 · ${esc(opT.item.name)}`;
      // 문: 열기·닫기 · 길게 누르면 문 행동 (잠긴 문은 발차기·폭약·산탄총)
      const door = !near && !lever && !opT && !a.opTask && !a.mirror && m.doors?.doorAt(a);
      if (door) {
        const o = m.doors.options(a, door);
        const what = door.mat === 'steel' ? '철문' : '문';
        if (o.locked && o.closed) prompt = `잠긴 ${what} · ${kbd('interact')} 길게: 발차기 · 폭약 · 문 밑 카메라 <small>(산탄총으로 손잡이 쪽을 쏘면 자물쇠가 부서짐)</small>`;
        else if (o.open) prompt = `${kbd('interact')} ${what} 닫기 · ${kbd('interact')} 길게: 살짝 닫기`;
        else if (o.cracked) prompt = `${kbd('interact')} 활짝 열기 · ${kbd('interact')} 길게: 살짝 닫기 · 발차기`;
        else prompt = `${kbd('interact')} ${what} 열기 · ${kbd('interact')} 길게: 살짝 열기 · 발차기 · 문 밑 카메라 · 폭약`;
      }
      // 미는 상자: 붙어서 밀고 있으면 합력 표시
      if (!near && !lever && !door) {
        const crate = m.devices?.list.find((d) => d.type === 'crate' && d.st.pushers > 0 && Math.hypot(a.pos.x - m.map.cellX(d.st.c), a.pos.z - m.map.cellZ(d.st.r)) < 1.7);
        if (crate) prompt = `상자 미는 중 · 합력 ${crate.st.pushers}명 <small>(같은 방향으로 함께 밀면 더 빨리)</small>`;
      }
      // 손에 든 장비 사용법
      const eq2 = a.equip;
      if (eq2?.kind === 'throw') prompt = `${GEAR[eq2.id].name} · <kbd>왼쪽 클릭</kbd> 멀리 <kbd>오른쪽 클릭</kbd> 가까이 ${kbd('throw')} 다음 ${kbd('primary')} 총 <small>(선 = 중력 때문에 휘는 길)</small>`;
      else if (eq2?.kind === 'c4') prompt = '<kbd>왼쪽 클릭</kbd> 가까운 벽·바닥·문에 C4 붙이기 <small>(2.6 m 안)</small>';
      else if (eq2?.kind === 'det') prompt = `<kbd>왼쪽 클릭</kbd> 기폭 · 폭발 반경 5 m 밖으로 ${kbd('gadget')} 다음 장비 ${kbd('primary')} 총`;
      else if (eq2?.kind === 'drone') prompt = '<kbd>왼쪽 클릭</kbd> 정찰 드론 띄우기 <small>(조종하는 동안 몸은 앉아서 무방비)</small>';
      else if (eq2?.kind === 'rc') prompt = '<kbd>왼쪽 클릭</kbd> RC카 내려놓기 <small>(바닥으로 조용히 · 조종하는 동안 몸은 앉아서 무방비)</small>';
      else if (eq2?.kind === 'alarm') prompt = `<kbd>왼쪽 클릭</kbd> 가까운 벽에 경보 센서 <small>(맞은편 벽까지 레이저 줄 · 붙인 높이가 줄 높이)</small> ${kbd('gadget')} 다음`;
      else if (eq2?.kind === 'cam') prompt = `${GEAR.cam.name} · <kbd>왼쪽 클릭</kbd> 멀리 <kbd>오른쪽 클릭</kbd> 가까이 <small>(처음 닿은 벽·바닥에 붙음)</small> ${kbd('gadget')} 다음`;
      else if (eq2?.kind === 'camview') prompt = `<kbd>왼쪽 클릭</kbd> 팀 카메라 보기 <small>(보는 동안 몸은 앉아서 무방비)</small> ${kbd('gadget')} 다음 ${kbd('primary')} 총`;
      else if (eq2?.kind === 'pulse') prompt = ''; // 심박 센서 화면에 사용법이 나옴
      const heldZone = a.held ? m.zones.find((z) => z.id === a.held.zoneId) : null;
      if (heldZone) prompt = heldZone.type === 'net' ? '탄성 그물에 구속됨' : '중력 붕괴에 구속됨';
      else if (a.slippery) prompt = '마찰력 0 구역 · 제동 불가';
      else if (a.mired) prompt = '마찰 폭풍 · 기동력 저하';
      else if ((a.stunT ?? 0) > 0.3) prompt = '이명 · 귀가 울리고 조준이 흔들림';
      else if ((a.gasT ?? 0) > 0) prompt = '최루 가스 · 빠져나가야 함';
      if (a.pulseOn || a.camView) prompt = ''; // 화면을 가리지 않게
    }
    if (wheel) prompt = ''; // 휠이 열려 있으면 안내는 숨김 (겹치지 않게)
    this.set('prompt', prompt, (v) => {
      // 사라질 때는 글자를 그대로 둔 채 흐려짐 (빈 상자가 남지 않게)
      if (v) E.prompt.innerHTML = v;
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

    // 문 진입 명령: 지시 칸에 진행 단계 (대기 → 돌파 → 진입 → 수색 → 확보)
    const myOrder = m.orders[me.team];
    if (myOrder && ENTRY_NAME[myOrder.type]) this.set('orderPhase', `${ENTRY_NAME[myOrder.type]} · ${ENTRY_PHASE[myOrder.phase] ?? ''}`, (v) => (E.orderText.textContent = v));

    // 지휘 휠 · 문 행동 휠: wheel = { title, items, sel }
    if (wheel) this.renderWheel(wheel);
    this.set('wheelOpen', wheel !== null, (v) => E.wheel.classList.toggle('show', v));
    this.set('wheelSel', wheel ? wheel.sel : null, (v) => this.wheelItems.forEach((it, i) => it.classList.toggle('on', i === v)));

    // 미니맵 (초당 약 12번) · 작전 지도 (M)
    // EMP를 맞으면 바디캠 지도가 먹통 (마지막 화면이 멈춘 채 지지직)
    this.set('mapDead', (a.empT ?? 0) > 0 && a.alive, (v) => this.$('.vh-minimap').classList.toggle('dead', v));
    this.miniT -= dt;
    if (this.miniT <= 0 && !((a.empT ?? 0) > 0 && a.alive)) {
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

