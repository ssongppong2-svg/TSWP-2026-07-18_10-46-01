import { ARMOR, WEAPONS } from '../sim/data.js';
import { GEAR_ICONS, WEAPON_ICONS } from './icons.js';

// 상점 (구매 시간에 B): 마우스 잠금을 풀지 않고 화면 안의 커서로 고름. 숫자 키 1~8로도 삼.
const COLS = [
  { title: '보조무기', items: ['pistol', 'sheriff'] },
  { title: '근접 화기', items: ['shotgun', 'smg'] },
  { title: '소총', items: ['rifle'] },
  { title: '저격총', items: ['sniper'] },
  { title: '방탄', items: ['light', 'heavy'] },
];
export const SHOP_KEYS = { pistol: 1, sheriff: 2, shotgun: 3, smg: 4, rifle: 5, sniper: 6, light: 7, heavy: 8 };
const BY_KEY = Object.fromEntries(Object.entries(SHOP_KEYS).map(([k, v]) => [v, k]));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const money = (n) => Math.round(n).toLocaleString('en-US');

function itemInfo(id) {
  const w = WEAPONS[id];
  if (w) {
    const head = Math.round(w.damage * w.headMult);
    const dmg = w.pellets ? `${w.damage}×${w.pellets}` : `${w.damage}`;
    return {
      name: w.name,
      kind: w.kind,
      price: w.price,
      icon: WEAPON_ICONS[id],
      stats: [`몸통 ${dmg}`, `머리 ${head}`, `${w.auto ? '자동' : '단발'} · ${w.magSize}발`],
    };
  }
  const a = ARMOR[id];
  return { name: a.name, kind: '방탄', price: a.price, icon: GEAR_ICONS[id], stats: [`보호막 +${a.value}`, '체력보다 먼저 깎임', '살아남으면 유지'] };
}

export class Shop {
  constructor(root, match, localId, { onBuy } = {}) {
    this.match = match;
    this.localId = localId;
    this.onBuy = onBuy;
    this.isOpen = false;
    this.cx = 0;
    this.cy = 0;
    this.el = document.createElement('div');
    this.el.className = 'shop';
    this.el.innerHTML = `
      <div class="shop-panel">
        <header class="shop-head">
          <div><small>구매 단계</small><b class="shop-time">0:00</b></div>
          <div class="shop-money">${GEAR_ICONS.credit}<b class="shop-credits">0</b></div>
        </header>
        <div class="shop-body">
          <div class="shop-cols">${COLS.map((col) => `
            <div class="shop-col"><h4>${col.title}</h4>${col.items.map((id) => {
              const it = itemInfo(id);
              return `<button class="shop-item" data-item="${id}">
                <kbd>${SHOP_KEYS[id]}</kbd>
                <span class="si-badge"></span>
                <div class="si-icon">${it.icon}</div>
                <div class="si-name"><b>${esc(it.name)}</b><small>${it.kind}</small></div>
                <div class="si-stats">${it.stats.map((x) => `<span>${x}</span>`).join('')}</div>
                <div class="si-price">${GEAR_ICONS.credit}${it.price ? money(it.price) : '무료'}</div>
              </button>`;
            }).join('')}</div>`).join('')}
          </div>
          <aside class="shop-team"><h4>분대 현황</h4><div class="st-list"></div></aside>
        </div>
        <footer class="shop-foot"><span><kbd>B</kbd> 닫기</span><span>클릭 또는 숫자 키로 구매</span><span>이번 구매 시간에 산 것을 다시 누르면 환불</span></footer>
      </div>
      <div class="shop-cursor"></div>`;
    root.appendChild(this.el);
    this.items = new Map([...this.el.querySelectorAll('.shop-item')].map((b) => [b.dataset.item, b]));
    this.cursor = this.el.querySelector('.shop-cursor');
    this.timeEl = this.el.querySelector('.shop-time');
    this.creditEl = this.el.querySelector('.shop-credits');
    this.teamEl = this.el.querySelector('.st-list');
    this.cache = {};
    // 마우스 잠금이 막힌 환경(제한 모드)에서는 진짜 마우스로 클릭
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('.shop-item');
      if (b && e.isTrusted && !document.pointerLockElement) this.onBuy?.(b.dataset.item);
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
    const hit = document.elementFromPoint(this.cx, this.cy)?.closest?.('.shop-item');
    this.hover(hit ?? null);
  }

  hover(btn) {
    if (this.hovered === btn) return;
    this.hovered?.classList.remove('hover');
    this.hovered = btn;
    btn?.classList.add('hover');
  }

  click() {
    if (this.isOpen && this.hovered) this.onBuy?.(this.hovered.dataset.item);
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
    for (const [id, btn] of this.items) {
      const w = WEAPONS[id];
      const price = w ? w.price : ARMOR[id].price;
      const owned = w ? me.primary === id || me.secondary === id : me.armor >= ARMOR[id].value && me.armorMax === ARMOR[id].value;
      const mine = bought.has(id);
      // 같은 칸에서 이번에 산 것을 환불하고 살 수 있으면 살 수 있음
      const slotBack = w
        ? (me.bought ?? []).filter((b) => WEAPONS[b.item]?.slot === w.slot).reduce((s, b) => s + (b.price ?? WEAPONS[b.item]?.price ?? 0), 0)
        : (me.bought ?? []).filter((b) => ARMOR[b.item]).reduce((s, b) => s + (b.price ?? ARMOR[b.item]?.price ?? 0), 0);
      const afford = me.credits + slotBack >= price;
      const state = mine ? 'mine' : owned ? 'owned' : afford ? 'ok' : 'poor';
      this.set(`it${id}`, state, (v) => {
        btn.dataset.state = v;
        btn.querySelector('.si-badge').textContent = v === 'mine' ? '환불 가능' : v === 'owned' ? '보유' : '';
      });
    }
    // 분대원 크레딧·주무기 (구매 계획 맞추기)
    const mates = m.agents.filter((a) => a.team === me.team);
    const sig = mates.map((a) => `${a.id}:${a.credits}:${a.primary}:${a.armor}`).join('|');
    this.set('team', sig, () => {
      this.teamEl.innerHTML = mates.map((a) => `
        <div class="st-row ${a.id === me.id ? 'me' : ''}">
          <b>${esc(a.name)}</b>
          <span class="st-w">${a.primary ? WEAPON_ICONS[a.primary] : WEAPON_ICONS[a.secondary] ?? ''}</span>
          <span class="st-a">${a.armor > 25 ? GEAR_ICONS.heavy : a.armor > 0 ? GEAR_ICONS.light : ''}</span>
          <span class="st-c">${money(a.credits ?? 0)}</span>
        </div>`).join('');
    });
  }

  dispose() {
    this.el.remove();
  }
}
