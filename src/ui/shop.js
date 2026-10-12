import { AMMO, ARMOR, WEAPONS } from '../sim/data.js';
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
      { title: '방탄 · 등급과 내구도', items: ['light', 'heavy'] },
      { title: '탄종 · 이번 라운드', items: ['fmj', 'ap', 'hp'] },
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
      stats: [`몸통 ${dmg} · 머리 ${head}`, `관통력 ${w.pen ?? 0}`, `${w.auto ? '자동' : '단발'} · ${w.magSize}발`],
    };
  }
  const a = ARMOR[id];
  if (a) {
    return {
      type: 'armor',
      name: a.name,
      kind: `${a.cls}등급`,
      price: a.price,
      icon: GEAR_ICONS[id],
      stats: [`${a.cls}등급 · 내구 ${a.dur}`, a.helmet ? '몸통 + 머리(헬멧)' : '몸통만 막음'],
    };
  }
  const m = AMMO[id];
  return {
    type: 'ammo',
    name: m.name,
    kind: '탄종',
    price: m.price,
    icon: GEAR_ICONS[id],
    stats: id === 'fmj' ? ['관통력 그대로', '기본 지급'] : [`관통력 ${signed(m.pen)}${m.dmg !== 1 ? ` · 맨몸 피해 ×${m.dmg}` : ''}`, m.desc],
  };
}

const card = (id, small) => {
  const it = itemInfo(id);
  const key = SHOP_KEYS[id];
  return `<button class="shop-item ${small ? 'small' : ''}" data-item="${id}" title="${esc(it.stats.join(' · '))}">
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
            <div class="shop-cols ${sec.kind}" style="--n:${sec.cols.length}">${sec.cols.map((col) => `
              <div class="shop-col"><h4>${col.title}</h4><div class="sc-items">${col.items.map((id) => card(id, sec.kind === 'small')).join('')}</div></div>`).join('')}
            </div>`).join('')}
          </div>
          <aside class="shop-side">
            <section class="shop-quiz"><h4>보급 점검 <span>정답 +${ECON.quiz} J</span></h4><div class="qz-body"></div></section>
            <section class="shop-team"><h4>분대 보급 현황</h4><div class="st-list"></div></section>
          </aside>
        </div>
        <footer class="shop-foot"><span><kbd>B</kbd> 닫기</span><span>클릭 또는 숫자 키로 보급</span><span>이번 보급 시간에 받은 것을 다시 누르면 반납</span><span class="sf-load"></span></footer>
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
      } else {
        owned = (me.ammo ?? 'fmj') === id;
        back = backFor((x) => !!AMMO[x]);
      }
      const mine = bought.has(id);
      const afford = me.credits + back >= info.price;
      const state = mine ? 'mine' : owned ? 'owned' : afford ? (note ? 'worn' : 'ok') : 'poor';
      this.set(`it${id}`, `${state}|${note}`, () => {
        btn.dataset.state = state;
        btn.querySelector('.si-badge').textContent = state === 'mine' ? '환불 가능' : state === 'owned' ? (info.type === 'ammo' ? '장전됨' : '보유') : note;
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
    const sig = mates.map((a) => `${a.id}:${a.credits}:${a.primary}:${a.armorKind}:${a.ammo}`).join('|');
    this.set('team', sig, () => {
      this.teamEl.innerHTML = mates.map((a) => `
        <div class="st-row ${a.id === me.id ? 'me' : ''}">
          <b>${esc(a.name)}</b>
          <span class="st-w">${a.primary ? WEAPON_ICONS[a.primary] : WEAPON_ICONS[a.secondary] ?? ''}</span>
          <span class="st-a">${a.armor > 0 && GEAR_ICONS[a.armorKind] ? GEAR_ICONS[a.armorKind] : ''}${a.ammo && a.ammo !== 'fmj' ? GEAR_ICONS[a.ammo] : ''}</span>
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
