import { LOCKPICK_CONCEPT } from '../sim/data.js';
import { describeForce, formula, isSolved, netForce, signed } from '../sim/lockpick.js';

const W = 640, X0 = 320, UNIT = 14; // 수직선: -20 N ~ +20 N
const xOf = (n) => X0 + n * UNIT;

function arrow(x1, x2, y, color, width, label, dashed = false) {
  if (x1 === x2) return '';
  const dir = Math.sign(x2 - x1);
  const head = 10;
  const shaft = x2 - dir * head;
  return `
    <line x1="${x1}" y1="${y}" x2="${shaft}" y2="${y}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ${dashed ? 'stroke-dasharray="6 6"' : ''}/>
    <path d="M${x2} ${y} L${shaft} ${y - width - 4} L${shaft} ${y + width + 4} Z" fill="${color}"/>
    ${label ? `<text x="${(x1 + x2) / 2}" y="${y - width - 8}" fill="${color}" text-anchor="middle">${label}</text>` : ''}`;
}

// 합력 락픽 창: 힘 카드를 골라 합력을 목표와 똑같이 맞추면 해체!
export class LockpickUI {
  constructor(root) {
    this.root = document.createElement('div');
    this.root.className = 'lockpick';
    root.appendChild(this.root);
    this.key = '';
    this.puzzle = null;
    this.onCard = null;
    this.root.addEventListener('click', (e) => {
      const card = e.target.closest('[data-card]');
      if (card) this.onCard?.(Number(card.dataset.card));
    });
  }

  update(agent, bomb) {
    const lp = agent?.lockpick;
    if (!lp || lp.kind !== 'puzzle') {
      if (this.key) {
        this.root.classList.remove('show');
        this.key = '';
        this.puzzle = null;
      }
      return;
    }
    const solved = isSolved(lp.puzzle, lp.selected);
    const key = `${bomb.id}|${lp.selected.join()}|${solved}`;
    this.root.style.setProperty('--turn', bomb.progress);
    if (key === this.key && lp.puzzle === this.puzzle) return;
    if (lp.puzzle !== this.puzzle) this.build(lp, bomb);
    this.key = key;
    this.root.classList.add('show');
    this.fill(lp, solved);
  }

  // 새 문제가 열릴 때 한 번만 틀을 만듦 (카드를 누를 때마다 창이 깜빡이지 않게)
  build(lp, bomb) {
    this.puzzle = lp.puzzle;
    this.root.innerHTML = `
      <div class="lp-panel">
        <header>
          <div class="lp-title"><span class="lp-bomb">폭탄 ${bomb.id}</span> 합력 자물쇠</div>
          <div class="lp-keys"><kbd>1</kbd>~<kbd>6</kbd> 카드 선택 · <kbd>F</kbd> 그만두기 · 맞으면 처음부터!</div>
        </header>
        <div class="lp-target">목표 합력 <b>${describeForce(lp.puzzle.target)}</b></div>
        <div class="lp-svg"></div>
        <div class="lp-formula"></div>
        <div class="lp-cards"></div>
        <div class="lp-hint"></div>
        <div class="lp-turn"><i></i></div>
        <footer><b>${LOCKPICK_CONCEPT.concept}</b> ${LOCKPICK_CONCEPT.conceptText}</footer>
      </div>`;
    const $ = (sel) => this.root.querySelector(sel);
    this.els = { panel: $('.lp-panel'), svg: $('.lp-svg'), formula: $('.lp-formula'), cards: $('.lp-cards'), hint: $('.lp-hint') };
  }

  fill(lp, solved) {
    const { puzzle, selected } = lp;
    const net = netForce(puzzle, selected);
    const target = puzzle.target;
    const AXIS = 196;

    let ticks = '';
    for (let n = -20; n <= 20; n += 1) {
      const major = n % 5 === 0;
      ticks += `<line x1="${xOf(n)}" y1="${AXIS - (major ? 8 : 4)}" x2="${xOf(n)}" y2="${AXIS + (major ? 8 : 4)}" stroke="rgba(255,255,255,${major ? 0.5 : 0.22})" stroke-width="${major ? 2 : 1}"/>`;
      if (major) ticks += `<text x="${xOf(n)}" y="${AXIS + 26}" text-anchor="middle" class="tick">${n === 0 ? '0' : signed(n)}</text>`;
    }
    // 고른 힘을 꼬리-머리로 이어 그리기 (힘의 합성)
    let chain = '';
    let at = 0;
    let lane = 0;
    puzzle.cards.forEach((c, i) => {
      if (!selected[i]) return;
      const v = c.dir * c.mag;
      chain += arrow(xOf(at), xOf(at + v), 78 + lane * 28, c.dir > 0 ? '#6fd3ff' : '#ff8fb1', 4, `${i + 1}번 ${signed(v)}`);
      at += v;
      lane = (lane + 1) % 3;
    });
    const resultColor = solved ? '#4dff9a' : '#ffd23a';
    this.els.svg.innerHTML = `
      <svg viewBox="0 0 ${W} 232" class="numberline">
        <text x="${xOf(-20)}" y="22" class="dir">← 왼쪽 (−)</text>
        <text x="${xOf(20)}" y="22" class="dir" text-anchor="end">오른쪽 (+) →</text>
        <text x="${xOf(target)}" y="34" text-anchor="middle" class="goal">목표 ${signed(target)} N</text>
        <line x1="${xOf(target)}" y1="42" x2="${xOf(target)}" y2="${AXIS}" stroke="#ffffff" stroke-opacity=".55" stroke-width="2" stroke-dasharray="4 5"/>
        ${chain}
        <line x1="${xOf(-20)}" y1="${AXIS}" x2="${xOf(20)}" y2="${AXIS}" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
        ${ticks}
        ${arrow(xOf(0), xOf(net), AXIS - 22, resultColor, 7, net ? `합력 ${signed(net)} N` : '')}
        <circle cx="${xOf(0)}" cy="${AXIS}" r="4" fill="#fff"/>
      </svg>`;

    this.els.cards.innerHTML = puzzle.cards
      .map((c, i) => {
        const v = c.dir * c.mag;
        return `<button class="force-card ${selected[i] ? 'on' : ''} ${c.dir > 0 ? 'right' : 'left'}" data-card="${i}">
          <kbd>${i + 1}</kbd>
          <span class="fc-arrow">${c.dir > 0 ? '→' : '←'}</span>
          <span class="fc-mag">${c.mag} N</span>
          <span class="fc-sign">${signed(v)}</span>
        </button>`;
      })
      .join('');

    let hint;
    if (solved) hint = '합력이 목표와 같아요! 자물쇠가 돌아가는 중…';
    else if (!selected.some(Boolean)) hint = '숫자 키(1~6)로 힘 카드를 골라 보세요.';
    else hint = `목표까지 ${describeForce(target - net)} 만큼 더 필요해요.`;
    this.els.formula.textContent = formula(puzzle, selected);
    this.els.hint.textContent = hint;
    this.els.panel.classList.toggle('solved', solved);
  }

  dispose() {
    this.root.remove();
  }
}
