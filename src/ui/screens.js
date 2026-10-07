import { createRng } from '../core/rng.js';
import { DRAFT_TIME, TEAM_INFO, TEAMS } from '../sim/constants.js';
import { LOCKPICK_CONCEPT, PATCHES, PATCH_ORDER, PATCH_TIERS, WEAPONS } from '../sim/data.js';
import { COPIES_PER_TEAM, SLOTS_PER_PLAYER, TeamDraft } from '../sim/draft.js';
import { makeRoster } from '../sim/match.js';
import { DIFFICULTY } from '../ai/bot.js';
import { QUALITY } from '../client/stage.js';
import { PATCH_ICONS, UI_ICONS, WEAPON_ICONS } from './icons.js';

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ───────────────────────── 타이틀 ─────────────────────────
export function titleScreen({ onStart, onControls, onSettings, onFullscreen }) {
  const el = h(`
    <section class="screen title-screen">
      <div class="title-center">
        <div class="logo-kicker">중1 과학 「힘」 단원 · 5 대 5 전술 FPS</div>
        <h1 class="logo">FORCE<span>BOUND</span></h1>
        <div class="logo-ko">포스 바운드</div>
        <p class="logo-desc">중력 · 탄성력 · 마찰력 · 합력을 <b>포스 패치</b>로 장착하고,<br>합력으로 자물쇠를 풀어 폭탄을 해체하세요.</p>
        <div class="menu">
          <button class="btn primary big" data-act="start">게임 시작</button>
          <div class="menu-row">
            <button class="btn ghost" data-act="controls">조작법</button>
            <button class="btn ghost" data-act="settings">설정</button>
            <button class="btn ghost" data-act="fullscreen">전체 화면</button>
          </div>
        </div>
      </div>
      <footer class="title-foot">
        <span>맵 · 포스 바운드</span><span>해체팀 vs 포스팀</span><span>폭탄 2개 · 제한 시간 2분</span>
      </footer>
    </section>`);
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'start') onStart();
    if (act === 'controls') onControls();
    if (act === 'settings') onSettings();
    if (act === 'fullscreen') onFullscreen();
  });
  return el;
}

// ───────────────────────── 팀 선택 ─────────────────────────
export function teamScreen({ settings, onNext, onBack }) {
  let team = settings.lastTeam ?? null;
  let difficulty = settings.difficulty ?? 'normal';
  const card = (t, title, icon, lines) => `
    <button class="team-card t-${t}" data-team="${t}">
      <div class="tc-icon">${icon}</div>
      <div class="tc-name">${title}</div>
      <ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    </button>`;
  const el = h(`
    <section class="screen team-screen">
      <header class="screen-head"><button class="btn ghost small" data-act="back">← 처음으로</button><h2>팀을 고르세요</h2><span></span></header>
      <div class="team-cards">
        ${card(TEAMS.DEFUSE, '해체팀', UI_ICONS.lock, ['미리 설치된 <b>폭탄 2개</b>를 모두 해체하면 승리', '폭탄 앞에서 <kbd>F</kbd> → <b>합력 자물쇠</b> 풀기', '락픽 중에 총에 맞으면 처음부터!'])}
        ${card(TEAMS.FORCE, '포스팀', UI_ICONS.bolt, ['<b>해체팀을 모두 처치</b>하면 승리', '<b>2분</b>을 버티면 폭탄이 터져서 승리', '폭탄 락픽이 시작되면 경보가 울려요'])}
      </div>
      <div class="team-options">
        <label class="field"><span>내 이름</span><input class="name-input" maxlength="8" value="${esc(settings.name || '나')}"></label>
        <div class="field"><span>봇 난이도</span>
          <div class="seg">${Object.entries(DIFFICULTY).map(([k, d]) => `<button data-diff="${k}" class="${k === difficulty ? 'on' : ''}">${d.name}</button>`).join('')}</div>
        </div>
      </div>
      <footer class="screen-foot"><button class="btn primary big" data-act="next" disabled>다음 · 포스 패치 고르기 →</button></footer>
    </section>`);
  const next = el.querySelector('[data-act="next"]');
  const refresh = () => {
    el.querySelectorAll('.team-card').forEach((c) => c.classList.toggle('on', c.dataset.team === team));
    el.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('on', b.dataset.diff === difficulty));
    next.disabled = !team;
  };
  refresh();
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-team]');
    if (t) team = t.dataset.team;
    const d = e.target.closest('[data-diff]');
    if (d) difficulty = d.dataset.diff;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') onBack();
    if (act === 'next' && team) {
      const name = el.querySelector('.name-input').value.trim() || '나';
      onNext({ team, difficulty, name });
    }
    refresh();
  });
  el.addEventListener('dblclick', (e) => {
    const t = e.target.closest('[data-team]');
    if (t) onNext({ team: t.dataset.team, difficulty, name: el.querySelector('.name-input').value.trim() || '나' });
  });
  return el;
}

// ───────────────────────── 포스 패치 선택 (선착순) ─────────────────────────
export function draftScreen({ team, playerName, seed = Date.now(), audio, onDone, onBack }) {
  const rng = createRng(seed);
  const roster = makeRoster(team, playerName);
  const me = roster.find((r) => r.isPlayer);
  const mates = roster.filter((r) => r.team === team);
  const foes = roster.filter((r) => r.team !== team);
  const draft = new TeamDraft(mates.map((m) => m.id));
  const foeDraft = new TeamDraft(foes.map((m) => m.id));
  const nameOf = Object.fromEntries(roster.map((r) => [r.id, r.name]));

  // 봇 팀원이 고르는 시각 (선착순이라 늦으면 뺏겨요)
  const schedule = [];
  for (const m of mates) {
    if (m.isPlayer) continue;
    const t1 = rng.range(2.2, 6.5);
    schedule.push({ id: m.id, t: t1 }, { id: m.id, t: t1 + rng.range(2, 5.5) });
  }
  schedule.sort((a, b) => a.t - b.t);

  const el = h(`
    <section class="screen draft-screen t-${team}">
      <header class="screen-head">
        <button class="btn ghost small" data-act="back">← 팀 다시 고르기</button>
        <div class="draft-title"><h2>포스 패치 선택</h2><p>패치마다 <b>팀당 ${COPIES_PER_TEAM}개</b>뿐! 먼저 고른 사람이 가져가요. 한 사람당 <b>${SLOTS_PER_PLAYER}개</b> 장착</p></div>
        <div class="draft-timer"><span class="dt-num">${DRAFT_TIME}</span><div class="dt-bar"><i></i></div></div>
      </header>
      <div class="draft-body">
        <div class="patch-grid">
          ${PATCH_ORDER.map((id) => {
            const p = PATCHES[id];
            const tier = PATCH_TIERS[p.tier];
            return `
            <button class="patch-card tier-${p.tier}" data-patch="${id}" style="--tier:${tier.color}">
              <div class="pc-top"><div class="pc-icon">${PATCH_ICONS[id]}</div><span class="pc-tier">${tier.name}</span></div>
              <div class="pc-name">${p.name}</div>
              <div class="pc-short">${p.short}</div>
              <p class="pc-desc">${p.desc}</p>
              <div class="pc-concept"><span>과학 개념</span>${p.concept}</div>
              <div class="pc-stock"></div>
              <div class="pc-flash"></div>
            </button>`;
          }).join('')}
        </div>
        <aside class="draft-side">
          <div class="side-block">
            <h3>내 장착 패치</h3>
            <div class="my-slots">
              <div class="my-slot" data-slot="0"><kbd>Q</kbd><span>비어 있음</span></div>
              <div class="my-slot" data-slot="1"><kbd>E</kbd><span>비어 있음</span></div>
            </div>
          </div>
          <div class="side-block">
            <h3>${TEAM_INFO[team].name} 팀원</h3>
            <ul class="mate-list"></ul>
          </div>
          <div class="side-block weapons">
            <h3>기본 총기</h3>
            <div class="wpn">${WEAPON_ICONS.rifle}<div><b>${WEAPONS.rifle.name}</b><small>소총 · 공격력 ${WEAPONS.rifle.damage} · 연사</small></div></div>
            <div class="wpn">${WEAPON_ICONS.pistol}<div><b>${WEAPONS.pistol.name}</b><small>권총 · 공격력 ${WEAPONS.pistol.damage} · 단발</small></div></div>
          </div>
          <button class="btn primary big" data-act="ready" disabled>준비 완료 · 전투 시작</button>
          <p class="side-note">시간이 끝나면 남은 칸은 자동으로 채워져요.</p>
        </aside>
      </div>
      <div class="draft-toast"></div>
    </section>`);

  const cards = Object.fromEntries([...el.querySelectorAll('.patch-card')].map((c) => [c.dataset.patch, c]));
  const readyBtn = el.querySelector('[data-act="ready"]');
  const toastEl = el.querySelector('.draft-toast');
  let toastT = null;
  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 1800);
  };

  const render = () => {
    const mine = draft.picks.get(me.id);
    for (const id of PATCH_ORDER) {
      const c = cards[id];
      const holders = draft.holders(id);
      const left = draft.stock[id];
      c.classList.toggle('mine', mine.includes(id));
      c.classList.toggle('soldout', left === 0 && !mine.includes(id));
      c.classList.toggle('full', mine.length >= SLOTS_PER_PLAYER && !mine.includes(id));
      c.querySelector('.pc-stock').innerHTML = Array.from({ length: COPIES_PER_TEAM }, (_, i) => {
        const hId = holders[i];
        if (!hId) return '<span class="stock free">남음</span>';
        return `<span class="stock taken ${hId === me.id ? 'me' : ''}">${esc(nameOf[hId])}</span>`;
      }).join('');
    }
    el.querySelectorAll('.my-slot').forEach((s, i) => {
      const id = mine[i];
      s.classList.toggle('filled', !!id);
      s.style.setProperty('--tier', id ? PATCH_TIERS[PATCHES[id].tier].color : 'transparent');
      s.querySelector('span').innerHTML = id ? `${PATCH_ICONS[id]}<b>${PATCHES[id].name}</b>` : '비어 있음';
    });
    el.querySelector('.mate-list').innerHTML = mates
      .map((m) => {
        const picks = draft.picks.get(m.id);
        return `<li class="${m.isPlayer ? 'me' : ''}"><span class="ml-name">${esc(m.name)}</span><span class="ml-picks">${[0, 1]
          .map((i) => (picks[i] ? `<i style="--tier:${PATCH_TIERS[PATCHES[picks[i]].tier].color}" title="${PATCHES[picks[i]].name}">${PATCH_ICONS[picks[i]]}</i>` : '<i class="empty"></i>'))
          .join('')}</span></li>`;
      })
      .join('');
    readyBtn.disabled = mine.length < SLOTS_PER_PLAYER;
  };
  render();

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') {
      stop();
      onBack();
      return;
    }
    if (act === 'ready') {
      finish(true);
      return;
    }
    const card = e.target.closest('[data-patch]');
    if (!card) return;
    const id = card.dataset.patch;
    const mine = draft.picks.get(me.id);
    if (mine.includes(id)) {
      draft.unpick(me.id, id);
      audio.play('ui');
    } else if (draft.stock[id] === 0) {
      toast(`${PATCHES[id].name}은(는) 이미 팀원 2명이 가져갔어요!`);
      audio.play('denied');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    } else if (mine.length >= SLOTS_PER_PLAYER) {
      toast('패치는 2개까지! 바꾸려면 장착한 패치를 눌러 먼저 빼세요.');
      audio.play('denied');
    } else {
      draft.pick(me.id, id);
      audio.play('pick');
    }
    render();
  });

  let elapsed = 0;
  let last = performance.now();
  let raf = 0;
  let done = false;
  const timerNum = el.querySelector('.dt-num');
  const timerBar = el.querySelector('.dt-bar i');
  const tick = (now) => {
    if (done) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    elapsed += dt;
    const left = Math.max(0, DRAFT_TIME - elapsed);
    timerNum.textContent = Math.ceil(left);
    timerBar.style.transform = `scaleX(${left / DRAFT_TIME})`;
    el.classList.toggle('hurry', left <= 5);
    while (schedule.length && schedule[0].t <= elapsed) {
      const { id } = schedule.shift();
      if (draft.picks.get(id).length >= SLOTS_PER_PLAYER) continue;
      const opts = draft.botOptions(id);
      if (!opts.length) continue;
      const pid = rng.pick(opts);
      draft.pick(id, pid);
      const c = cards[pid];
      c.querySelector('.pc-flash').textContent = `${nameOf[id]} 장착!`;
      c.classList.remove('flash');
      void c.offsetWidth;
      c.classList.add('flash');
      audio.play('snatched');
      render();
    }
    if (left <= 0) finish(false);
  };
  raf = requestAnimationFrame(tick);

  function stop() {
    done = true;
    cancelAnimationFrame(raf);
    clearTimeout(toastT);
  }

  function finish(byClick) {
    if (done) return;
    stop();
    draft.autoFill(rng, [me.id]);
    foeDraft.autoFill(rng);
    const loadouts = new Map([...draft.loadouts(), ...foeDraft.loadouts()]);
    onDone({ loadouts, byClick });
  }

  el.cleanup = stop;
  return el;
}

// ───────────────────────── 시작 대기 / 일시정지 ─────────────────────────
export function clickToStart({ team, loadout, onClick }) {
  const el = h(`
    <section class="overlay start-overlay t-${team}">
      <div class="start-card">
        <div class="sc-team">${TEAM_INFO[team].name}</div>
        <h2>${TEAM_INFO[team].goal}</h2>
        <div class="sc-patches">${loadout.map((id, i) => `<div style="--tier:${PATCH_TIERS[PATCHES[id].tier].color}"><kbd>${i ? 'E' : 'Q'}</kbd>${PATCH_ICONS[id]}<b>${PATCHES[id].name}</b></div>`).join('')}</div>
        <button class="btn primary big">클릭해서 전투 시작</button>
        <p>마우스가 화면에 고정돼요. <kbd>Esc</kbd>를 누르면 일시정지</p>
      </div>
    </section>`);
  el.querySelector('button').addEventListener('click', onClick);
  return el;
}

export function pauseMenu({ onResume, onSettings, onControls, onQuit }) {
  const el = h(`
    <section class="overlay pause-overlay">
      <div class="pause-card">
        <h2>일시정지</h2>
        <button class="btn primary big" data-act="resume">계속하기</button>
        <button class="btn ghost" data-act="settings">설정</button>
        <button class="btn ghost" data-act="controls">조작법</button>
        <button class="btn danger" data-act="quit">경기 나가기</button>
      </div>
    </section>`);
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'resume') onResume();
    if (act === 'settings') onSettings();
    if (act === 'controls') onControls();
    if (act === 'quit') onQuit();
  });
  return el;
}

// ───────────────────────── 조작법 / 설정 (모달) ─────────────────────────
export function controlsModal({ onClose }) {
  const rows = [
    ['W A S D', '이동'],
    ['Shift', '걷기 (발소리가 나지 않아요)'],
    ['Space', '점프'],
    ['마우스', '조준'],
    ['왼쪽 클릭', '사격'],
    ['R', '재장전'],
    ['1 / 2 · 휠', '소총 / 권총 바꾸기'],
    ['Q / E', '포스 패치 사용'],
    ['F', '폭탄 앞에서 락픽 시작 · 그만두기'],
    ['1 ~ 6', '락픽 중 힘 카드 고르기'],
    ['Tab', '점수판'],
    ['Esc', '일시정지'],
  ];
  const el = h(`
    <section class="modal">
      <div class="modal-card">
        <header><h2>조작법</h2><button class="btn ghost small" data-act="close">닫기</button></header>
        <div class="keys">${rows.map(([k, v]) => `<div class="key-row"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>
        <div class="tip"><b>합력 자물쇠</b> 목표 힘과 똑같아지도록 힘 카드를 골라요. 오른쪽(→)은 +, 왼쪽(←)은 −로 계산해요.</div>
      </div>
    </section>`);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-act="close"]')) onClose();
  });
  return el;
}

export function settingsModal({ settings, onChange, onClose }) {
  const el = h(`
    <section class="modal">
      <div class="modal-card">
        <header><h2>설정</h2><button class="btn ghost small" data-act="close">닫기</button></header>
        <label class="slider"><span>마우스 감도</span><input type="range" min="0.2" max="3" step="0.05" data-key="sensitivity"><output></output></label>
        <label class="slider"><span>시야각 (FOV)</span><input type="range" min="80" max="120" step="1" data-key="fov"><output></output></label>
        <label class="slider"><span>소리 크기</span><input type="range" min="0" max="1" step="0.05" data-key="volume"><output></output></label>
        <div class="field"><span>그래픽 품질</span><div class="seg">${Object.entries(QUALITY).map(([k, q]) => `<button data-quality="${k}">${q.name}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" data-key="invertY"><span>마우스 위아래 반전</span></label>
      </div>
    </section>`);
  const fmt = { sensitivity: (v) => Number(v).toFixed(2), fov: (v) => `${v}°`, volume: (v) => `${Math.round(v * 100)}%` };
  el.querySelectorAll('input[type=range]').forEach((inp) => {
    const k = inp.dataset.key;
    inp.value = settings[k];
    inp.nextElementSibling.textContent = fmt[k](settings[k]);
    inp.addEventListener('input', () => {
      settings[k] = Number(inp.value);
      inp.nextElementSibling.textContent = fmt[k](settings[k]);
      onChange(k);
    });
  });
  const inv = el.querySelector('[data-key="invertY"]');
  inv.checked = !!settings.invertY;
  inv.addEventListener('change', () => {
    settings.invertY = inv.checked;
    onChange('invertY');
  });
  const segs = () => el.querySelectorAll('[data-quality]').forEach((b) => b.classList.toggle('on', b.dataset.quality === settings.quality));
  segs();
  el.addEventListener('click', (e) => {
    const q = e.target.closest('[data-quality]');
    if (q) {
      settings.quality = q.dataset.quality;
      segs();
      onChange('quality');
    }
    if (e.target === el || e.target.closest('[data-act="close"]')) onClose();
  });
  return el;
}

// ───────────────────────── 점수판 (Tab) ─────────────────────────
export function scoreboard(match) {
  const table = (team) => `
    <div class="sb-team t-${team}">
      <h3>${TEAM_INFO[team].name}</h3>
      <table>
        <tr><th>이름</th><th>처치</th><th>사망</th><th>피해</th><th>해체</th><th>패치</th></tr>
        ${match.agents
          .filter((a) => a.team === team)
          .map((a) => `<tr class="${a.alive ? '' : 'dead'} ${a.isPlayer ? 'me' : ''}"><td>${esc(a.name)}</td><td>${a.stats.kills}</td><td>${a.stats.deaths}</td><td>${a.stats.damage}</td><td>${a.stats.defuses}</td><td class="sb-patches">${a.patches.map((p) => `<i style="--tier:${PATCH_TIERS[PATCHES[p.id].tier].color}" title="${PATCHES[p.id].name}">${PATCH_ICONS[p.id]}</i>`).join('')}</td></tr>`)
          .join('')}
      </table>
    </div>`;
  return h(`<section class="scoreboard">${table(TEAMS.DEFUSE)}${table(TEAMS.FORCE)}</section>`);
}

// ───────────────────────── 결과 ─────────────────────────
export function resultScreen({ result, onAgain, onTeam, onMenu }) {
  const { match, winner, reason, team, player } = result;
  const won = winner === team;
  const concepts = [
    ...player.patches.map((p) => ({ id: p.id, title: PATCHES[p.id].concept, text: PATCHES[p.id].conceptText, color: PATCH_TIERS[PATCHES[p.id].tier].color, icon: PATCH_ICONS[p.id] })),
    { id: 'lock', title: LOCKPICK_CONCEPT.concept, text: LOCKPICK_CONCEPT.conceptText, color: '#ffd23a', icon: UI_ICONS.lock },
  ];
  const s = player.stats;
  const el = h(`
    <section class="screen result-screen ${won ? 'win' : 'lose'} t-${winner}">
      <div class="result-head">
        <div class="rh-kicker">${TEAM_INFO[winner].name} 승리</div>
        <h1>${won ? '승리!' : '패배'}</h1>
        <p>${reason}</p>
        <div class="my-stats">
          <div><b>${s.kills}</b><span>처치</span></div>
          <div><b>${s.damage}</b><span>피해량</span></div>
          <div><b>${s.headshots}</b><span>헤드샷</span></div>
          <div><b>${s.defuses}</b><span>해체</span></div>
          <div><b>${s.patchUses}</b><span>패치 사용</span></div>
        </div>
      </div>
      <div class="result-body"></div>
      <div class="concepts">
        <h3>이번 판에서 쓴 힘의 과학</h3>
        <div class="concept-cards">${concepts.map((c) => `<div class="concept-card" style="--c:${c.color}"><div class="cc-icon">${c.icon}</div><b>${c.title}</b><p>${c.text}</p></div>`).join('')}</div>
      </div>
      <footer class="screen-foot">
        <button class="btn ghost" data-act="menu">처음으로</button>
        <button class="btn ghost" data-act="team">팀 바꾸기</button>
        <button class="btn primary big" data-act="again">같은 팀으로 다시 하기</button>
      </footer>
    </section>`);
  el.querySelector('.result-body').appendChild(scoreboard(match));
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'again') onAgain();
    if (act === 'team') onTeam();
    if (act === 'menu') onMenu();
  });
  return el;
}
