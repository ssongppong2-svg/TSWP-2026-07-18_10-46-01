import { AMMO, ARMOR, WEAPONS } from '../sim/data.js';
import { GEAR, THROW_ORDER } from '../sim/gear.js';
import { CONCEPT_BY_ID } from '../sim/concepts.js';
import { ECON, LOAD, STAMINA } from '../sim/constants.js';
import { carriedMass, loadFactors } from '../sim/agent.js';
import { GEAR_ICONS, WEAPON_ICONS } from './icons.js';

// 보급 단말기 (구매 시간에 B): 에너지(J)로 장비를 받고, 보급 점검 문제를 맞히면 에너지를 더 받음.
// 마우스 잠금을 풀지 않고 화면 안의 커서로 고름. 숫자 키 1~8로도 받음 (총·방탄).
// 위 줄: 총 (큰 칸) / 아래 줄: 방탄·탄종 (작은 칸)
const SECTIONS = [
  {
    kind: 'big',
    cols: [
      { title: '보조무기', items: ['pistol', 'sheriff'] },
      { title: '근접 화기', items: ['shotgun', 'smg'] },
      { title: '소총 · 저격총', items: ['rifle', 'sniper'] },
    ],
  },
  {
    kind: 'small',
    cols: [
      { title: '방탄', items: ['light', 'heavy'], w: 1.2 },
      { title: '탄종 · 이번 라운드', items: ['fmj', 'ap', 'hp'], w: 1 },
      { title: '투척 · 4번 키', items: THROW_ORDER, w: 2, grid: 2 },
      { title: '장비 · 5번 키', items: ['c4', 'drone'], w: 1 },
    ],
  },
];
const MARK = ['①', '②', '③', '④'];
export const SHOP_KEYS = { pistol: 1, sheriff: 2, shotgun: 3, smg: 4, rifle: 5, sniper: 6, light: 7, heavy: 8 };
const BY_KEY = Object.fromEntries(Object.entries(SHOP_KEYS).map(([k, v]) => [v, k]));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const money = (n) => Math.round(n).toLocaleString('en-US');
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

// 상점 물건 하나의 가격·이름·설명
export function itemInfo(id) {
  const w = WEAPONS[id];
  if (w) {
    const head = Math.round(w.damage * w.headMult);
    const dmg = w.pellets ? `${w.damage}×${w.pellets}` : `${w.damage}`;
    return {
      type: 'weapon',
      name: w.name,
      kind: w.kind,
      price: w.price,
      icon: WEAPON_ICONS[id],
      stats: [`몸통 ${dmg} · 머리 ${head}`, `관통 ${w.pen ?? 0} · ${w.mass} kg`, `${w.auto ? '자동' : '단발'} · ${w.magSize}발`],
    };
  }
  const a = ARMOR[id];
  if (a) {
    return {
      type: 'armor',
      name: a.name,
      card: a.cls >= 4 ? '중량 방탄·헬멧' : '경량 조끼', // 작은 칸에 들어가는 이름
      kind: `${a.cls}등급`,
      price: a.price,
      icon: GEAR_ICONS[id],
      short: `${a.cls}등급 · 내구 ${a.dur}`,
      stats: [`${a.cls}등급 · 내구 ${a.dur} · ${a.mass} kg`, a.helmet ? '몸통 + 머리(헬멧)를 막음' : '몸통만 막음', '막히면 충격만 조금 · 닳으면 잘 뚫림'],
    };
  }
  const g = GEAR[id];
  if (g) {
    const what = {
      frag: `파편 피해 최대 ${g.damage} · 반경 ${g.radius} m`,
      stun: `귀 울림·먹먹·조준 흔들림 ${g.time}초`,
      flash: `눈부심 최대 ${g.time}초 · 바라보면 강함`,
      smoke: `연기 벽 ${g.time}초 · 시야 차단`,
      gas: `기침·느려짐 ${g.time}초 · 피해 없음`,
      c4: `붙이고 기폭 · 피해 최대 ${g.damage} · 문 돌파`,
      drone: `정찰 ${g.battery}초 · 보이는 적을 팀에 표시 · 총에 맞으면 추락`,
    }[id];
    const short = { frag: `파편 ${g.damage}`, stun: `이명 ${g.time}초`, flash: `섬광 ${g.time}초`, smoke: `연기 ${g.time}초`, gas: `최루 ${g.time}초`, c4: '붙이고 기폭', drone: `정찰 ${g.battery}초` }[id];
    const how = {
      throw: '왼쪽 클릭 멀리 · 오른쪽 클릭 가까이 (중력 때문에 포물선)',
      place: '왼쪽 클릭으로 벽·바닥·문에 붙이고, 다시 왼쪽 클릭으로 기폭',
      drone: '왼쪽 클릭으로 띄움 → WASD·Space·Ctrl 조종, 왼쪽 클릭 적 표시, F 복귀 · 과학: 프로펠러가 공기를 아래로 밀면 공기가 드론을 위로 밂(작용·반작용)',
    }[g.kind];
    return { type: 'gear', name: g.name, kind: { throw: '투척', place: '설치', drone: '정찰' }[g.kind], price: g.price, icon: GEAR_ICONS[id], short, stats: [what, `최대 ${g.max}개 · ${g.mass} kg`, how] };
  }
  const m = AMMO[id];
  return {
    type: 'ammo',
    name: m.name,
    kind: '탄종',
    price: m.price,
    icon: GEAR_ICONS[id],
    short: id === 'fmj' ? '관통 그대로' : m.dmg !== 1 ? `맨몸 ×${m.dmg}` : `관통 ${signed(m.pen)}`,
    stats: id === 'fmj' ? ['관통력 그대로', '기본 지급'] : [`관통력 ${signed(m.pen)}${m.dmg !== 1 ? ` · 맨몸 피해 ×${m.dmg}` : ''}`, m.desc, '과학: 같은 힘도 좁은 면적에 모이면 누르는 효과(압력)가 커짐'],
  };
}

// 큰 칸(총): 그림·이름·수치 / 작은 칸(방탄·탄종·장비): 그림 + 이름 + 한 줄 요약 + 가격 (자세한 설명은 아래 안내줄)
const card = (id, small) => {
  const it = itemInfo(id);
  const key = SHOP_KEYS[id];
  const price = it.price ? `${money(it.price)} J` : '기본';
  if (small) {
    return `<button class="shop-item small" data-item="${id}">
    <span class="si-badge"></span>
    <div class="si-icon">${it.icon}</div>
    <div class="si-name"><b>${esc(it.card ?? it.name)}</b></div>
    <div class="si-line"><span class="si-short">${esc(it.short ?? it.stats[0])}</span><span class="si-price">${price}</span></div>
  </button>`;
  }
  return `<button class="shop-item" data-item="${id}">
    ${key ? `<kbd>${key}</kbd>` : ''}
    <span class="si-badge"></span>
    <div class="si-icon">${it.icon}</div>
    <div class="si-name"><b>${esc(it.name)}</b><small>${esc(it.kind)}</small></div>
    <div class="si-stats">${it.stats.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
    <div class="si-price">${it.price ? `${money(it.price)} J` : '기본 지급'}</div>
  </button>`;
};

export class Shop {
  constructor(root, match, localId, { onBuy, onQuiz } = {}) {
    this.match = match;
    this.localId = localId;
    this.onBuy = onBuy;
    this.onQuiz = onQuiz;
    this.isOpen = false;
    this.cx = 0;
    this.cy = 0;
    this.el = document.createElement('div');
    this.el.className = 'shop';
    this.el.innerHTML = `
      <div class="shop-panel">
        <header class="shop-head">
          <div class="sh-title"><small>보급 단말기 · SUPPLY</small><b>장비 보급</b></div>
          <div class="sh-stat"><small>남은 시간</small><b class="shop-time">0:00</b></div>
          <div class="sh-stat energy"><small>에너지</small><b class="shop-credits">0</b><span>J</span></div>
        </header>
        <div class="shop-body">
          <div class="shop-main">${SECTIONS.map((sec) => `
            <div class="shop-cols ${sec.kind}" style="--n:${sec.cols.length};${sec.cols.some((c) => c.w) ? `grid-template-columns:${sec.cols.map((c) => `${c.w ?? 1}fr`).join(' ')}` : ''}">${sec.cols.map((col) => `
              <div class="shop-col" style="--g:${col.grid ?? 1}"><h4>${col.title}</h4><div class="sc-items">${col.items.map((id) => card(id, sec.kind !== 'big')).join('')}</div></div>`).join('')}
            </div>`).join('')}
          </div>
          <aside class="shop-side">
            <section class="shop-quiz"><h4>보급 점검 <span>정답 +${ECON.quiz} J</span></h4><div class="qz-body"></div></section>
            <section class="shop-team"><h4>분대 보급 현황</h4><div class="st-list"></div></section>
          </aside>
        </div>
        <div class="shop-info"><b class="sf-name">보급할 장비에 커서를 올리면 설명이 나옴</b><span class="sf-desc">클릭 또는 숫자 키(1~8)로 보급 · 이번 보급 시간에 받은 것을 다시 누르면 반납</span></div>
        <footer class="shop-foot"><span><kbd>B</kbd> 닫기</span><span class="sf-load"></span></footer>
      </div>
      <div class="shop-cursor"></div>`;
    root.appendChild(this.el);
    this.items = new Map([...this.el.querySelectorAll('.shop-item')].map((b) => [b.dataset.item, b]));
    this.cursor = this.el.querySelector('.shop-cursor');
    this.timeEl = this.el.querySelector('.shop-time');
    this.creditEl = this.el.querySelector('.shop-credits');
    this.teamEl = this.el.querySelector('.st-list');
    this.quizEl = this.el.querySelector('.qz-body');
    this.loadEl = this.el.querySelector('.sf-load');
    this.infoName = this.el.querySelector('.sf-name');
    this.infoDesc = this.el.querySelector('.sf-desc');
    // 진짜 마우스로 올려도 설명 (제한 모드)
    this.el.addEventListener('mouseover', (e) => {
      if (document.pointerLockElement) return;
      const b = e.target.closest('.shop-item');
      if (b) this.describe(b.dataset.item);
    });
    this.cache = {};
    // 마우스 잠금이 막힌 환경(제한 모드)에서는 진짜 마우스로 클릭
    this.el.addEventListener('click', (e) => {
      if (!e.isTrusted || document.pointerLockElement) return;
      const b = e.target.closest('.shop-item');
      if (b) this.onBuy?.(b.dataset.item);
      const q = e.target.closest('.quiz-choice');
      if (q) this.onQuiz?.(Number(q.dataset.choice));
    });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.cx = window.innerWidth / 2;
    this.cy = window.innerHeight / 2 + 40;
    this.el.classList.add('show');
    this.placeCursor();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('show');
    this.hover(null);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  // 마우스 이동량으로 화면 안 커서를 움직임
  move(dx, dy) {
    if (!this.isOpen || (!dx && !dy)) return;
    this.cx = Math.max(0, Math.min(window.innerWidth - 2, this.cx + dx));
    this.cy = Math.max(0, Math.min(window.innerHeight - 2, this.cy + dy));
    this.placeCursor();
  }

  placeCursor() {
    this.cursor.style.transform = `translate(${this.cx}px, ${this.cy}px)`;
    const hit = document.elementFromPoint(this.cx, this.cy)?.closest?.('.shop-item, .quiz-choice');
    this.hover(hit ?? null);
  }

  hover(btn) {
    if (this.hovered === btn) return;
    this.hovered?.classList.remove('hover');
    this.hovered = btn;
    btn?.classList.add('hover');
    if (btn?.dataset.item) this.describe(btn.dataset.item);
  }

  // 아래 안내줄: 커서를 올린 장비의 자세한 설명
  describe(id) {
    const it = itemInfo(id);
    this.infoName.textContent = `${it.name} · ${it.price ? `${money(it.price)} J` : '기본 지급'}`;
    this.infoDesc.textContent = it.stats.join(' · ');
  }

  click() {
    if (!this.isOpen || !this.hovered) return;
    if (this.hovered.dataset.item) this.onBuy?.(this.hovered.dataset.item);
    else if (this.hovered.dataset.choice != null) this.onQuiz?.(Number(this.hovered.dataset.choice));
  }

  key(code) {
    const digit = code.startsWith('Digit') ? Number(code.slice(5)) : code.startsWith('Numpad') ? Number(code.slice(6)) : NaN;
    const item = BY_KEY[digit];
    if (this.isOpen && item) {
      this.onBuy?.(item);
      return true;
    }
    return false;
  }

  // 사려다 거절됐을 때 그 칸을 흔듦
  deny(item) {
    const b = this.items.get(item);
    if (!b) return;
    b.classList.remove('deny');
    void b.offsetWidth;
    b.classList.add('deny');
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  update() {
    if (!this.isOpen) return;
    const m = this.match;
    const me = m.agentById(this.localId);
    const t = Math.max(0, Math.ceil(m.phaseT));
    this.set('time', t, (v) => (this.timeEl.textContent = `0:${String(v).padStart(2, '0')}`));
    this.set('credits', me.credits, (v) => (this.creditEl.textContent = money(v)));
    const bought = new Set((me.bought ?? []).map((b) => b.item));
    // 같은 종류(같은 칸의 총 / 방탄 / 탄종)에서 이번에 산 것을 환불하고 살 수 있으면 살 수 있음
    const priceOf = (item) => itemInfo(item).price;
    const backFor = (match) => (me.bought ?? []).filter((b) => match(b.item)).reduce((s, b) => s + (b.price ?? priceOf(b.item)), 0);
    for (const [id, btn] of this.items) {
      const info = itemInfo(id);
      let owned = false, back = 0, note = '';
      if (info.type === 'weapon') {
        const w = WEAPONS[id];
        owned = me.primary === id || me.secondary === id;
        back = backFor((x) => WEAPONS[x]?.slot === w.slot);
      } else if (info.type === 'armor') {
        const worn = me.armorKind === id && me.armor > 0;
        owned = worn && me.armor >= ARMOR[id].dur;
        if (worn && !owned) note = `닳음 ${Math.round(me.armor)}/${ARMOR[id].dur}`;
        back = backFor((x) => !!ARMOR[x]);
      } else if (info.type === 'gear') {
        const have = me.gear?.[id] ?? 0;
        owned = have >= GEAR[id].max;
        note = have > 0 ? `${have}/${GEAR[id].max}` : '';
        back = 0;
      } else {
        owned = (me.ammo ?? 'fmj') === id;
        back = backFor((x) => !!AMMO[x]);
      }
      const mine = bought.has(id);
      const afford = me.credits + back >= info.price;
      let state = mine ? 'mine' : owned ? 'owned' : afford ? (note ? 'worn' : 'ok') : 'poor';
      if (info.type === 'gear') state = owned ? (mine ? 'mine' : 'owned') : afford ? (note ? 'some' : 'ok') : note ? 'some' : 'poor';
      // 작은 칸은 짧게 (이름을 가리지 않게)
      const small = info.type !== 'weapon';
      const badge = info.type === 'gear'
        ? note
        : state === 'mine' ? (small ? '반납' : '환불 가능') : state === 'owned' ? (info.type === 'ammo' ? '장전' : '보유') : info.type === 'armor' && note ? note.replace('닳음 ', '') : note;
      this.set(`it${id}`, `${state}|${badge}`, () => {
        btn.dataset.state = state;
        btn.querySelector('.si-badge').textContent = badge;
      });
    }
    // 장비 무게: 질량(kg) × 9.8 = 무게(N). 무거우면 느리고 출발·멈춤이 둔함(관성), 지구력도 빨리 닳음
    const mass = carriedMass(me);
    this.set('load', Math.round(mass * 10), () => {
      const f = loadFactors(mass);
      this.loadEl.innerHTML = `장비 <b>${mass.toFixed(1)} kg</b> × 9.8 = <b>${Math.round(mass * LOAD.g)} N</b>${f.over > 0 ? ` · <em>이동 −${Math.round((1 - f.speed) * 100)}% · 지구력 소모 +${Math.round(f.over * STAMINA.perKg * 100)}%</em>` : ' · 가벼움'}`;
    });
    // 보급 점검 문제 (사람만, 라운드마다 한 문제)
    const q = me.quiz;
    this.set('quiz', q ? `${q.id}|${q.done}|${q.ok}|${q.choice}` : '', () => this.renderQuiz(q));
    // 분대원 에너지·주무기 (보급 계획 맞추기)
    const mates = m.agents.filter((a) => a.team === me.team);
    const gearSig = (a) => THROW_ORDER.concat('c4', 'drone').map((id) => a.gear?.[id] ?? 0).join('');
    const sig = mates.map((a) => `${a.id}:${a.credits}:${a.primary}:${a.armorKind}:${a.ammo}:${gearSig(a)}`).join('|');
    this.set('team', sig, () => {
      this.teamEl.innerHTML = mates.map((a) => `
        <div class="st-row ${a.id === me.id ? 'me' : ''}">
          <b>${esc(a.name)}</b>
          <span class="st-w">${a.primary ? WEAPON_ICONS[a.primary] : WEAPON_ICONS[a.secondary] ?? ''}</span>
          <span class="st-a">${a.armor > 0 && GEAR_ICONS[a.armorKind] ? GEAR_ICONS[a.armorKind] : ''}${a.ammo && a.ammo !== 'fmj' ? GEAR_ICONS[a.ammo] : ''}${THROW_ORDER.concat('c4', 'drone').filter((id) => (a.gear?.[id] ?? 0) > 0).map((id) => GEAR_ICONS[id]).join('')}</span>
          <span class="st-c">${money(a.credits ?? 0)} J</span>
        </div>`).join('');
    });
  }

  renderQuiz(q) {
    const c = q && CONCEPT_BY_ID[q.id];
    this.el.querySelector('.shop-quiz').classList.toggle('none', !c);
    if (!c) {
      this.quizEl.innerHTML = '';
      return;
    }
    const done = q.done;
    this.quizEl.innerHTML = `
      <small class="qz-tag">개념 · ${esc(c.name)}</small>
      <p class="qz-q">${esc(c.q)}</p>
      <div class="qz-choices">${c.choices.map((ch, i) => {
        const cls = done ? (i === c.answer ? 'answer' : i === q.choice ? 'picked' : '') : '';
        return `<button class="quiz-choice ${cls}" data-choice="${i}" ${done ? 'disabled' : ''}><b>${MARK[i] ?? i + 1}</b>${esc(ch)}</button>`;
      }).join('')}</div>
      ${done ? `<p class="qz-why ${q.ok ? 'ok' : 'no'}">${q.ok ? `정답 · +${ECON.quiz} J` : '오답'} — ${esc(c.why)}</p>` : '<p class="qz-hint">보기를 눌러 답하기 · 한 번만</p>'}`;
  }

  dispose() {
    this.el.remove();
  }
}
