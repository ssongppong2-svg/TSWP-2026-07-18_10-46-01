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
      }
      return;
    }
    const solved = isSolved(lp.puzzle, lp.selected);
    const key = `${bomb.id}|${lp.puzzle.target}|${lp.selected.join()}|${solved}|${lp.puzzle.cards.map((c) => c.dir * c.mag).join()}`;
    const progress = Math.round(bomb.progress * 100);
    if (key === this.key) {
      this.root.style.setProperty('--turn', progress / 100);
      return;
    }
    this.key = key;
    this.root.classList.add('show');
    this.root.style.setProperty('--turn', progress / 100);
    this.render(lp, bomb, solved);
  }

  render(lp, bomb, solved) {
    const { puzzle, selected } = lp;
    const net = netForce(puzzle, selected);
    const target = puzzle.target;

    // 수직선 눈금
    let ticks = '';
    for (let n = -20; n <= 20; n += 1) {
      const major = n % 5 === 0;
      ticks += `<line x1="${xOf(n)}" y1="${major ? 150 : 154}" x2="${xOf(n)}" y2="${major ? 166 : 162}" stroke="rgba(255,255,255,${major ? 0.5 : 0.22})" stroke-width="${major ? 2 : 1}"/>`;
      if (major) ticks += `<text x="${xOf(n)}" y="184" text-anchor="middle" class="tick">${n === 0 ? '0' : signed(n)}</text>`;
    }
    // 고른 힘을 꼬리-머리로 이어 그리기 (힘의 합성)
    let chain = '';
    let at = 0;
    let lane = 0;
    puzzle.cards.forEach((c, i) => {
      if (!selected[i]) return;
      const v = c.dir * c.mag;
      const y = 62 + lane * 24;
      chain += arrow(xOf(at), xOf(at + v), y, c.dir > 0 ? '#6fd3ff' : '#ff8fb1', 4, `${i + 1}번 ${signed(v)}`);
      at += v;
      lane = (lane + 1) % 3;
    });
    const resultColor = solved ? '#4dff9a' : '#ffd23a';
    const svg = `
      <svg viewBox="0 0 ${W} 200" class="numberline">
        <text x="${xOf(-20)}" y="22" class="dir">← 왼쪽 (−)</text>
        <text x="${xOf(20)}" y="22" class="dir" text-anchor="end">오른쪽 (+) →</text>
        <line x1="${xOf(target)}" y1="34" x2="${xOf(target)}" y2="170" stroke="#ffffff" stroke-opacity=".55" stroke-width="2" stroke-dasharray="4 5"/>
        <text x="${xOf(target)}" y="44" text-anchor="middle" class="goal">목표 ${signed(target)} N</text>
        ${chain}
        <line x1="${xOf(-20)}" y1="158" x2="${xOf(20)}" y2="158" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
        ${ticks}
        ${arrow(xOf(0), xOf(net), 140, resultColor, 7, net ? `합력 ${signed(net)} N` : '')}
        <circle cx="${xOf(0)}" cy="158" r="4" fill="#fff"/>
      </svg>`;

    const cards = puzzle.cards
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

    const diff = target - net;
    let hint;
    if (solved) hint = '합력이 목표와 같아요! 자물쇠가 돌아가는 중…';
    else if (!selected.some(Boolean)) hint = '숫자 키(1~6)로 힘 카드를 골라 보세요.';
    else hint = `목표까지 ${describeForce(diff)} 만큼 더 필요해요.`;

    this.root.innerHTML = `
      <div class="lp-panel ${solved ? 'solved' : ''}">
        <header>
          <div class="lp-title"><span class="lp-bomb">폭탄 ${bomb.id}</span> 합력 자물쇠</div>
          <div class="lp-keys"><kbd>1</kbd>~<kbd>6</kbd> 카드 선택 · <kbd>F</kbd> 그만두기 · 맞으면 처음부터!</div>
        </header>
        <div class="lp-target">목표 합력 <b>${describeForce(target)}</b></div>
        ${svg}
        <div class="lp-formula">${formula(puzzle, selected)}</div>
        <div class="lp-cards">${cards}</div>
        <div class="lp-hint">${hint}</div>
        <div class="lp-turn"><i></i></div>
        <footer><b>${LOCKPICK_CONCEPT.concept}</b> ${LOCKPICK_CONCEPT.conceptText}</footer>
      </div>`;
  }

  dispose() {
    this.root.remove();
  }
}
