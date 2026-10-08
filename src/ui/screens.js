import { createRng } from '../core/rng.js';
import { DRAFT_TIME, ROUNDS, TEAM_INFO, TEAMS } from '../sim/constants.js';
import { LOADOUT_SLOTS, LOCKPICK_CONCEPT, PATCHES, PATCH_TIERS, SHOP_WEAPONS, WEAPONS, patchesOfTier } from '../sim/data.js';
import { COPIES_PER_TEAM, SLOTS_PER_PLAYER, TIER_SLOTS, TeamDraft } from '../sim/draft.js';
import { makeRoster } from '../sim/match.js';
import { MAP_ORDER, getMapDef } from '../sim/maps/index.js';
import { DIFFICULTY } from '../ai/bot.js';
import { QUALITY } from '../client/stage.js';
import { PATCH_ICONS, UI_ICONS, WEAPON_ICONS } from './icons.js';
import { CONCEPTS, CONCEPT_BY_ID, pickQuiz } from '../sim/concepts.js';
import { loadProgress, recordQuiz } from '../core/progress.js';

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tierColor = (id) => PATCH_TIERS[PATCHES[id].tier].color;
const slotKeys = (tier) => LOADOUT_SLOTS.filter((s) => s.tier === tier).map((s) => s.key).join('·');

// ───────────────────────── 타이틀 ─────────────────────────
export function titleScreen({ onStart, onControls, onSettings, onFullscreen, onCodex, onOnline }) {
  const prog = loadProgress();
  const el = h(`
    <section class="screen title-screen">
      <div class="title-center">
        <div class="logo-kicker"><i></i>중1 과학 「힘」 · 5 대 5 라운드 전술 슈팅</div>
        <h1 class="logo">FORCE</h1>
        <div class="logo-ko">포스</div>
        <p class="logo-desc">중력 · 탄성력 · 마찰력 · 합력 · 부력 · 작용 반작용.<br>상점에서 총을 사고, 포스 패치로 힘을 다뤄 7라운드를 먼저 이겨라.</p>
        <div class="menu">
          <div class="menu-main">
            <button class="btn primary big" data-act="start">작전 개시 <small>봇 9명</small></button>
            <button class="btn big online-btn" data-act="online">온라인 작전 <small>친구와 함께</small></button>
          </div>
          <div class="menu-row">
            <button class="btn ghost" data-act="codex">개념 도감 <small>${prog.concepts.length}/${CONCEPTS.length}</small></button>
            <button class="btn ghost" data-act="controls">조작 교범</button>
            <button class="btn ghost" data-act="settings">설정</button>
            <button class="btn ghost" data-act="fullscreen">전체 화면</button>
          </div>
        </div>
      </div>
      <footer class="title-foot">
        <span>작전 지역 ${MAP_ORDER.length}곳</span><span>7라운드 선승 · 6라운드 뒤 공수 교대</span><span>폭탄 2기 · 라운드 2:00</span>
      </footer>
    </section>`);
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'start') onStart();
    if (act === 'controls') onControls();
    if (act === 'settings') onSettings();
    if (act === 'fullscreen') onFullscreen();
    if (act === 'codex') onCodex?.();
    if (act === 'online') onOnline?.();
  });
  return el;
}

// ───────────────────────── 개념 도감 ─────────────────────────
// 경기 중 맵에서 주운 개념 카드 모음. 아직 못 주운 카드는 이름만 가림.
export function codexModal({ onClose }) {
  const prog = loadProgress();
  const q = prog.quiz;
  const el = h(`
    <section class="modal">
      <div class="modal-card codex">
        <header><h2>개념 도감 <small>${prog.concepts.length} / ${CONCEPTS.length}</small></h2><button class="btn ghost small" data-act="close">닫기</button></header>
        <p class="codex-note">경기 중 맵에 떠 있는 <b>개념 카드</b>에 다가가면 기록됩니다. 경기가 끝나면 주운 카드로 개념 점검을 합니다.${q.solved ? ` · 점검 정답 ${q.correct}/${q.solved}` : ''}</p>
        <div class="codex-grid">${CONCEPTS.map((c, i) => {
          const got = prog.concepts.includes(c.id);
          return `<div class="codex-card ${got ? 'got' : 'locked'}"><small>No.${String(i + 1).padStart(2, '0')}</small><b>${got ? esc(c.name) : '???'}</b><p>${got ? esc(c.text) : '아직 발견하지 못한 개념'}</p></div>`;
        }).join('')}</div>
      </div>
    </section>`);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-act="close"]')) onClose();
  });
  return el;
}

// ───────────────────────── 작전 브리핑 (팀 선택) ─────────────────────────
export function teamScreen({ settings, onNext, onBack, onMap }) {
  let team = settings.lastTeam ?? null;
  let difficulty = settings.difficulty ?? 'normal';
  let mapId = MAP_ORDER.includes(settings.mapId) ? settings.mapId : MAP_ORDER[0];
  const WEATHER_TEXT = { rain: '야간 · 강우', clear: '야간 · 맑음', wet: '주간 · 비 갠 뒤' };
  const mapCard = (id) => {
    const d = getMapDef(id);
    return `<button class="map-card" data-map="${id}"><small>${d.code}</small><b>${d.name}</b><span class="mc-en">${d.nameEn ?? ''}</span><span class="mc-desc">${d.desc ?? ''}</span><span class="mc-wx">${d.mood ?? WEATHER_TEXT[d.weather] ?? ''}</span></button>`;
  };
  const card = (t, icon, lines) => `
    <button class="team-card t-${t}" data-team="${t}">
      <div class="tc-head"><div class="tc-icon">${icon}</div><div><small>${TEAM_INFO[t].code}</small><div class="tc-name">${TEAM_INFO[t].name}</div></div></div>
      <div class="tc-goal">${TEAM_INFO[t].goal}</div>
      <ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    </button>`;
  const el = h(`
    <section class="screen team-screen">
      <header class="screen-head"><button class="btn ghost small" data-act="back">← 메인</button><h2>작전 브리핑</h2><span></span></header>
      <h3 class="brief-label">작전 지역</h3>
      <div class="map-cards">${MAP_ORDER.map(mapCard).join('')}<div class="map-card locked"><small>— —</small><b>신규 작전 지역</b><span class="mc-desc">추가 예정</span></div></div>
      <h3 class="brief-label">첫 진영 <small>6라운드가 끝나면 서로 바꿈</small></h3>
      <div class="team-cards">
        ${card(TEAMS.DEFUSE, UI_ICONS.lock, ['<b>공격</b> · 폭탄 A·B 2기는 라운드마다 구역 안 <b>무작위 위치</b>', '폭탄 앞 <kbd>F</kbd> → <b>합력 잠금 해제</b>로 해체', '포스팀을 <b>전원 제압</b>해도 라운드 승리', '구매 시간에 <kbd>B</kbd> 상점'])}
        ${card(TEAMS.FORCE, UI_ICONS.bolt, ['<b>수비</b> · 해체팀 <b>전원 제압</b> 시 라운드 승리', '<b>2분</b> 버티면 폭탄 폭발 → 라운드 승리', '해체 시도 감지 시 경보 수신', '구매 시간에 <kbd>B</kbd> 상점'])}
      </div>
      <div class="team-options">
        <label class="field"><span>콜사인</span><input class="name-input" maxlength="8" value="${esc(settings.name || '나')}"></label>
        <div class="field"><span>적·아군 숙련도</span>
          <div class="seg">${Object.entries(DIFFICULTY).map(([k, d]) => `<button data-diff="${k}" class="${k === difficulty ? 'on' : ''}">${d.name}</button>`).join('')}</div>
        </div>
      </div>
      <footer class="screen-foot"><button class="btn primary big" data-act="next" disabled>다음 · 포스 패치 장착 →</button></footer>
    </section>`);
  const next = el.querySelector('[data-act="next"]');
  const refresh = () => {
    el.querySelectorAll('.map-card[data-map]').forEach((c) => c.classList.toggle('on', c.dataset.map === mapId));
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
    const mp = e.target.closest('.map-card[data-map]');
    if (mp && mp.dataset.map !== mapId) {
      mapId = mp.dataset.map;
      onMap?.(mapId);
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') onBack();
    if (act === 'next' && team) {
      const name = el.querySelector('.name-input').value.trim() || '나';
      onNext({ team, difficulty, name, mapId });
    }
    refresh();
  });
  el.addEventListener('dblclick', (e) => {
    const t = e.target.closest('[data-team]');
    if (t) onNext({ team: t.dataset.team, difficulty, name: el.querySelector('.name-input').value.trim() || '나', mapId });
  });
  return el;
}

// ───────────────────────── 포스 패치 장착 (선착순) ─────────────────────────
export function draftScreen({ team, playerName, seed = Date.now(), audio, onDone, onBack }) {
  const rng = createRng(seed);
  const roster = makeRoster(team, playerName);
  const me = roster.find((r) => r.isPlayer);
  const mates = roster.filter((r) => r.team === team);
  const foes = roster.filter((r) => r.team !== team);
  const draft = new TeamDraft(mates.map((m) => m.id));
  const foeDraft = new TeamDraft(foes.map((m) => m.id));
  const nameOf = Object.fromEntries(roster.map((r) => [r.id, r.name]));

  // 봇 팀원이 고르는 시각 (선착순이라 늦으면 뺏김)
  const schedule = [];
  for (const m of mates) {
    if (m.isPlayer) continue;
    let t = rng.range(1.8, 5);
    for (let k = 0; k < SLOTS_PER_PLAYER; k++) {
      schedule.push({ id: m.id, t });
      t += rng.range(1.4, 3.6);
    }
  }
  schedule.sort((a, b) => a.t - b.t);

  const card = (id) => {
    const p = PATCHES[id];
    return `
      <button class="patch-card tier-${p.tier}" data-patch="${id}" style="--tier:${tierColor(id)}">
        <div class="pc-top"><div class="pc-icon">${PATCH_ICONS[id]}</div><span class="pc-concept">${p.concept}</span></div>
        <div class="pc-name">${p.name}</div>
        <div class="pc-short">${p.short}</div>
        <div class="pc-stock"></div>
        <div class="pc-flash"></div>
      </button>`;
  };
  const section = (tier) => `
    <div class="tier-section tier-${tier}" style="--tier:${PATCH_TIERS[tier].color}">
      <h4><b>${PATCH_TIERS[tier].name}</b><span>${slotKeys(tier)} 슬롯 · ${TIER_SLOTS[tier]}개 장착</span></h4>
      <div class="tier-cards">${patchesOfTier(tier).map(card).join('')}</div>
    </div>`;

  const el = h(`
    <section class="screen draft-screen t-${team}">
      <header class="screen-head">
        <button class="btn ghost small" data-act="back">← 브리핑</button>
        <div class="draft-title"><h2>포스 패치 장착</h2><p>패치당 <b>팀 내 ${COPIES_PER_TEAM}기</b> 한정 · 선착순 · 개인 장착 <b>일반 2 · 특수 1 · 필살 1</b></p></div>
        <div class="draft-timer"><span class="dt-num">${DRAFT_TIME}</span><div class="dt-bar"><i></i></div></div>
      </header>
      <div class="draft-body">
        <div class="draft-main">
          ${section('normal')}
          <div class="tier-row">${section('special')}${section('ultimate')}</div>
          <div class="patch-detail"></div>
          <div class="side-block weapons">
            <h3>상점 화기 <small>구매 시간에 <kbd>B</kbd></small></h3>
            ${SHOP_WEAPONS.map((id) => { const w = WEAPONS[id]; return `<div class="wpn">${WEAPON_ICONS[id]}<div><b>${w.name} <em>${w.price ? `◆ ${w.price.toLocaleString('en-US')}` : '기본'}</em></b><small>${w.kind} · 몸통 ${w.pellets ? `${w.damage}×${w.pellets}` : w.damage} · 머리 ${Math.round(w.damage * w.headMult)}</small></div></div>`; }).join('')}
          </div>
        </div>
        <aside class="draft-side">
          <div class="side-block">
            <h3>개인 장착</h3>
            <div class="my-slots">${LOADOUT_SLOTS.map((s, i) => `<button class="my-slot tier-${s.tier}" data-slot="${i}" style="--tier:${PATCH_TIERS[s.tier].color}"><kbd>${s.key}</kbd><span></span></button>`).join('')}</div>
          </div>
          <div class="side-block">
            <h3>${TEAM_INFO[team].name} 분대</h3>
            <ul class="mate-list"></ul>
          </div>
          <button class="btn primary big" data-act="ready" disabled>장착 완료 · 출격</button>
          <p class="side-note">제한 시간 종료 시 빈 슬롯 자동 배정.</p>
        </aside>
      </div>
      <div class="draft-toast"></div>
    </section>`);

  const cards = Object.fromEntries([...el.querySelectorAll('.patch-card')].map((c) => [c.dataset.patch, c]));
  const readyBtn = el.querySelector('[data-act="ready"]');
  const toastEl = el.querySelector('.draft-toast');
  const detail = el.querySelector('.patch-detail');
  let toastT = null;
  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 1800);
  };
  const showDetail = (id) => {
    if (!id) {
      detail.innerHTML = '<div class="pd-empty">패치에 마우스를 올리면 상세 제원 표시</div>';
      return;
    }
    const p = PATCHES[id];
    const cd = p.tier === 'ultimate' ? '필살 게이지 100%' : `재사용 ${p.cooldown}초`;
    detail.innerHTML = `
      <div class="pd-icon" style="--tier:${tierColor(id)}">${PATCH_ICONS[id]}</div>
      <div class="pd-body">
        <div class="pd-head"><b>${p.name}</b><span>${PATCH_TIERS[p.tier].name} · ${cd}</span></div>
        <p>${p.desc}</p>
        <p class="pd-concept"><b>교범 · ${p.concept}</b> ${p.conceptText}</p>
      </div>`;
  };
  showDetail(null);
  el.addEventListener('pointerover', (e) => {
    const c = e.target.closest('[data-patch]');
    if (c) showDetail(c.dataset.patch);
  });

  const render = () => {
    const mine = draft.picks.get(me.id);
    for (const [id, c] of Object.entries(cards)) {
      const holders = draft.holders(id);
      const tier = PATCHES[id].tier;
      c.classList.toggle('mine', mine.includes(id));
      c.classList.toggle('soldout', draft.stock[id] === 0 && !mine.includes(id));
      c.classList.toggle('full', draft.tierCount(me.id, tier) >= TIER_SLOTS[tier] && !mine.includes(id));
      c.querySelector('.pc-stock').innerHTML = Array.from({ length: COPIES_PER_TEAM }, (_, i) => {
        const hId = holders[i];
        if (!hId) return '<span class="stock free">가용</span>';
        return `<span class="stock taken ${hId === me.id ? 'me' : ''}">${esc(nameOf[hId])}</span>`;
      }).join('');
    }
    const lo = draft.loadoutOf(me.id);
    el.querySelectorAll('.my-slot').forEach((s, i) => {
      const id = lo[i];
      s.classList.toggle('filled', !!id);
      s.dataset.patch = id ?? '';
      s.querySelector('span').innerHTML = id ? `${PATCH_ICONS[id]}<b>${PATCHES[id].name}</b>` : `<em>${PATCH_TIERS[LOADOUT_SLOTS[i].tier].name} · 미장착</em>`;
    });
    el.querySelector('.mate-list').innerHTML = mates
      .map((m) => {
        const picks = draft.loadoutOf(m.id);
        return `<li class="${m.isPlayer ? 'me' : ''}"><span class="ml-name">${esc(m.name)}</span><span class="ml-picks">${picks
          .map((id) => (id ? `<i style="--tier:${tierColor(id)}" title="${PATCHES[id].name}">${PATCH_ICONS[id]}</i>` : '<i class="empty"></i>'))
          .join('')}</span></li>`;
      })
      .join('');
    readyBtn.disabled = mine.length < SLOTS_PER_PLAYER;
  };
  render();

  const tryPick = (id, card) => {
    const mine = draft.picks.get(me.id);
    const tier = PATCHES[id].tier;
    if (mine.includes(id)) {
      draft.unpick(me.id, id);
      audio.play('ui');
      return;
    }
    if (draft.stock[id] === 0) {
      toast(`${PATCHES[id].name} · 팀 내 ${COPIES_PER_TEAM}기 모두 배정됨.`);
      audio.play('denied');
      card?.classList.remove('shake');
      void card?.offsetWidth;
      card?.classList.add('shake');
      return;
    }
    if (draft.tierCount(me.id, tier) >= TIER_SLOTS[tier]) {
      // 슬롯이 하나뿐인 등급(특수·필살)은 바로 교체
      if (TIER_SLOTS[tier] === 1) {
        const old = mine.find((x) => PATCHES[x].tier === tier);
        draft.unpick(me.id, old);
      } else {
        toast(`${PATCH_TIERS[tier].name} 슬롯(${slotKeys(tier)}) 포화. 장착 패치를 해제 후 교체.`);
        audio.play('denied');
        return;
      }
    }
    draft.pick(me.id, id);
    audio.play('pick');
  };

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
    const slot = e.target.closest('.my-slot');
    if (slot) {
      if (slot.dataset.patch) {
        draft.unpick(me.id, slot.dataset.patch);
        audio.play('ui');
        render();
      }
      return;
    }
    const card = e.target.closest('[data-patch]');
    if (!card) return;
    tryPick(card.dataset.patch, card);
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
    // 선착순이 공정하도록 실제 흐른 시간으로 계산
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    elapsed += dt;
    const left = Math.max(0, DRAFT_TIME - elapsed);
    timerNum.textContent = Math.ceil(left);
    timerBar.style.transform = `scaleX(${left / DRAFT_TIME})`;
    el.classList.toggle('hurry', left <= 5);
    while (schedule.length && schedule[0].t <= elapsed) {
      const { id } = schedule.shift();
      if (draft.isComplete(id)) continue;
      const opts = draft.botOptions(id);
      if (!opts.length) continue;
      const pid = rng.pick(opts);
      draft.pick(id, pid);
      const c = cards[pid];
      c.querySelector('.pc-flash').textContent = `${nameOf[id]} 장착`;
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

// ───────────────────────── 출격 대기 / 일시 중지 ─────────────────────────
export function clickToStart({ team, loadout, mapId, onClick, online = false }) {
  const map = getMapDef(mapId);
  const el = h(`
    <section class="overlay start-overlay t-${team}">
      <div class="start-card">
        <div class="sc-team"><small>${TEAM_INFO[team].code}</small>${TEAM_INFO[team].name} · ${map.name}</div>
        <h2>${TEAM_INFO[team].goal}</h2>
        <ul class="sc-rules">
          <li><b>라운드제</b> — ${ROUNDS.winTo}라운드 먼저 이기면 승리 · ${ROUNDS.half}라운드 뒤 공수 교대 · 한쪽 전멸 시 라운드 종료</li>
          <li><b>상점</b> — 구매 시간(시작 구역)에 <kbd>B</kbd> · 처치·해체·라운드 결과로 크레딧 · 살아남으면 총·방탄 유지</li>
          <li><b>사격</b> — 멈춰 서서 쏘면 정확, 달리며 쏘면 빗나감 · 소총은 머리 1발</li>
          <li><kbd>1·2·3</kbd> 무기 · <kbd>G</kbd> 분대 지휘 · <kbd>휠 클릭</kbd> 적 보고 · <kbd>M</kbd> 지도 · <kbd>Tab</kbd> 점수 · <kbd>Shift</kbd> 보행(무음)</li>
        </ul>
        <div class="sc-patches">${LOADOUT_SLOTS.map((s, i) => {
          const id = loadout[i];
          return `<div class="${id ? '' : 'empty'}" style="--tier:${PATCH_TIERS[s.tier].color}"><kbd>${s.key}</kbd>${id ? `${PATCH_ICONS[id]}<b>${PATCHES[id].name}</b>` : '<b>미장착</b>'}</div>`;
        }).join('')}</div>
        <button class="btn primary big">${online ? '클릭 · 합류' : '클릭 · 작전 개시'}</button>
        ${online ? '<p class="sc-online">온라인 경기 · 구매 시간은 이미 진행 중입니다</p>' : ''}
        <p>마우스 고정 · <kbd>Esc</kbd> ${online ? '메뉴(경기는 계속)' : '일시 중지'} · <kbd>Ctrl</kbd> 앉기 사용 시 전체 화면 권장(브라우저 단축키 충돌 방지)</p>
      </div>
    </section>`);
  // 버튼뿐 아니라 화면 어디를 눌러도 시작
  el.addEventListener('click', onClick);
  return el;
}

export function pauseMenu({ onResume, onSettings, onControls, onQuit, online = false }) {
  const el = h(`
    <section class="overlay pause-overlay">
      <div class="pause-card">
        <h2>${online ? '메뉴 · 경기는 계속 진행 중' : '작전 일시 중지'}</h2>
        ${online ? '<p class="pause-note">온라인 경기는 멈추지 않습니다. 메뉴를 보는 동안 요원은 제자리에 있습니다.</p>' : ''}
        <button class="btn primary big" data-act="resume">${online ? '복귀' : '작전 재개'}</button>
        <button class="btn ghost" data-act="settings">설정</button>
        <button class="btn ghost" data-act="controls">조작 교범</button>
        <button class="btn danger" data-act="quit">${online ? '대기실로 나가기 (봇이 대신함)' : '작전 이탈'}</button>
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

// ───────────────────────── 조작 교범 / 설정 (모달) ─────────────────────────
export function controlsModal({ onClose }) {
  const groups = [
    ['기동', [
      ['W A S D', '이동 (달리면 발소리가 남)'],
      ['Shift', '보행 (발소리 거의 없음)'],
      ['Ctrl', '앉기 (정확도↑ · 피탄 면적↓)'],
      ['Z / V', '좌 / 우 기울이기'],
      ['Space', '도약'],
    ]],
    ['사격', [
      ['좌클릭', '사격 · 칼: 베기'],
      ['우클릭', '정조준 · 칼: 찌르기'],
      ['R', '재장전'],
      ['1 / 2 / 3 · 휠', '주무기 / 보조무기 / 칼'],
    ]],
    ['포스 패치', [
      ['C / Q', '일반 패치'],
      ['E', '특수 패치'],
      ['X', '필살 패치 (게이지 100%)'],
    ]],
    ['지휘 · 정보', [
      ['G (누른 채 마우스)', '분대 지휘: 집결 · 사수 · 지정 지점 · A · B · 자율'],
      ['휠 클릭 / H', '적 보고: 조준한 곳을 무전으로 알림 (아군이 경계·수색)'],
      ['T (누른 채)', '총 살펴보기'],
      ['M (누른 채)', '큰 지도 (지형 · 아군 · 아군이 본 적 · 무전 보고)'],
      ['Tab', '점수판'],
    ]],
    ['임무', [
      ['B', '상점 (구매 시간) · 숫자 1~8로 바로 구매'],
      ['F', '폭탄 해체 개시 · 중단'],
      ['1 ~ 6', '해체 중 힘 카드 선택'],
      ['Esc', '일시 중지'],
    ]],
  ];
  const el = h(`
    <section class="modal">
      <div class="modal-card wide">
        <header><h2>조작 교범</h2><button class="btn ghost small" data-act="close">닫기</button></header>
        <div class="key-groups">${groups.map(([title, rows]) => `<div class="key-group"><h4>${title}</h4>${rows.map(([k, v]) => `<div class="key-row"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>`).join('')}</div>
        <div class="tip"><b>합력 잠금 해제</b> 요구 합력과 일치하도록 힘 카드를 선택. 우(→) +, 좌(←) − 로 계산. 해체 중 피격 시 초기화.</div>
        <div class="tip"><b>라운드제</b> ${ROUNDS.winTo}라운드 선승 · ${ROUNDS.half}라운드 뒤 공수 교대 · 구매 시간 ${ROUNDS.buyTime}초(전·후반 첫 라운드 ${ROUNDS.buyTimeFirst}초) · 라운드 2분 · 한쪽이 전멸하면 바로 끝남.</div>
        <div class="tip"><b>크레딧</b> 처치 200 · 해체 300 · 라운드 승리 3000 · 패배 1900~2900(연패할수록 더). 살아남으면 산 총·방탄이 다음 라운드까지 남음. 미니맵에는 아군이 보고 있는 적이 붉게 표시됨.</div>
        <div class="tip"><b>참고</b> 브라우저 특성상 <kbd>Ctrl</kbd>+<kbd>W</kbd>는 탭 닫기로 처리될 수 있음. 전체 화면에서 플레이 권장.</div>
      </div>
    </section>`);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-act="close"]')) onClose();
  });
  return el;
}

export function settingsModal({ settings, onChange, onClose, qualityNow }) {
  const el = h(`
    <section class="modal">
      <div class="modal-card">
        <header><h2>설정</h2><button class="btn ghost small" data-act="close">닫기</button></header>
        <label class="slider"><span>마우스 감도</span><input type="range" min="0.2" max="3" step="0.05" data-key="sensitivity"><output></output></label>
        <label class="slider"><span>시야각 (FOV)</span><input type="range" min="80" max="120" step="1" data-key="fov"><output></output></label>
        <label class="slider"><span>음량</span><input type="range" min="0" max="1" step="0.05" data-key="volume"><output></output></label>
        <label class="slider"><span>화면 흔들림</span><input type="range" min="0" max="1.5" step="0.05" data-key="shake"><output></output></label>
        <div class="field"><span>그래픽 품질</span><div class="seg"><button data-quality="auto">자동</button>${Object.entries(QUALITY).map(([k, q]) => `<button data-quality="${k}">${q.name}</button>`).join('')}</div></div>
        <p class="field-note" data-quality-note></p>
        <div class="field"><span>조준점</span><div class="seg"><button data-cross="cross">점 + 선</button><button data-cross="dot">점만</button><button data-cross="off">없음</button></div></div>
        <label class="check"><input type="checkbox" data-key="bodycam"><span>바디캠 렌즈 효과 (왜곡 · 노이즈 · REC 표시)</span></label>
        <label class="check"><input type="checkbox" data-key="invertY"><span>마우스 상하 반전</span></label>
      </div>
    </section>`);
  const fmt = { sensitivity: (v) => Number(v).toFixed(2), fov: (v) => `${v}°`, volume: (v) => `${Math.round(v * 100)}%`, shake: (v) => `${Math.round(v * 100)}%` };
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
  el.querySelectorAll('input[type=checkbox]').forEach((inp) => {
    const k = inp.dataset.key;
    inp.checked = !!settings[k];
    inp.addEventListener('change', () => {
      settings[k] = inp.checked;
      onChange(k);
    });
  });
  const segs = () => {
    el.querySelectorAll('[data-quality]').forEach((b) => b.classList.toggle('on', b.dataset.quality === settings.quality));
    const note = el.querySelector('[data-quality-note]');
    const cur = qualityNow?.();
    note.textContent = settings.quality === 'auto'
      ? `자동: 이 기기에서는 '${QUALITY[cur]?.name ?? '보통'}'. 프레임이 모자라면 해상도부터 자동으로 낮춥니다.`
      : '프레임이 모자라면 해상도를 자동으로 낮춥니다.';
    el.querySelectorAll('[data-cross]').forEach((b) => b.classList.toggle('on', b.dataset.cross === (settings.crosshair ?? 'cross')));
  };
  segs();
  el.addEventListener('click', (e) => {
    const cr = e.target.closest('[data-cross]');
    if (cr) {
      settings.crosshair = cr.dataset.cross;
      segs();
      onChange('crosshair');
    }
    const q = e.target.closest('[data-quality]');
    if (q) {
      settings.quality = q.dataset.quality;
      onChange('quality');
      segs();
    }
    if (e.target === el || e.target.closest('[data-act="close"]')) onClose();
  });
  return el;
}

// ───────────────────────── 전황판 (Tab) ─────────────────────────
// 점수판: 내 분대(위)와 상대 분대(아래). 크레딧은 내 분대만 보임
export function scoreboard(match, { me = match.player } = {}) {
  const squad = me?.squad ?? TEAMS.DEFUSE;
  const enemy = match.agents.find((a) => a.squad !== squad)?.squad ?? TEAMS.FORCE;
  const mine = match.score?.[squad] ?? 0, theirs = match.score?.[enemy] ?? 0;
  const table = (sq, ally) => `
    <div class="sb-team ${ally ? 'ally' : 'enemy'}">
      <h3><b>${ally ? mine : theirs}</b>${ally ? '아군 분대' : '상대 분대'}<small>${TEAM_INFO[match.agents.find((a) => a.squad === sq)?.team ?? sq].name}</small></h3>
      <table>
        <tr><th>요원</th><th>무기</th><th>처치</th><th>죽음</th><th>도움</th><th>피해</th>${ally ? '<th>크레딧</th>' : ''}<th>포스 패치</th></tr>
        ${match.agents
          .filter((a) => a.squad === sq)
          .sort((p, q) => q.stats.kills - p.stats.kills || q.stats.damage - p.stats.damage)
          .map((a) => `<tr class="${a.alive ? '' : 'dead'} ${a.id === me?.id ? 'me' : ''}"><td>${esc(a.name)}</td><td class="sb-w">${WEAPON_ICONS[a.primary ?? a.secondary ?? 'pistol'] ?? ''}</td><td>${a.stats.kills}</td><td>${a.stats.deaths}</td><td>${a.stats.assists ?? 0}</td><td>${a.stats.damage}</td>${ally ? `<td class="sb-c">${(a.credits ?? 0).toLocaleString('en-US')}</td>` : ''}<td class="sb-patches">${a.patches
            .map((p) => (p ? `<i style="--tier:${tierColor(p.id)}" title="${PATCHES[p.id].name}">${PATCH_ICONS[p.id]}</i>` : '<i class="empty"></i>'))
            .join('')}</td></tr>`)
          .join('')}
      </table>
    </div>`;
  const head = match.rules === 'rounds' ? `<div class="sb-head"><span>라운드 ${match.round}</span><b><i class="ally">${mine}</i> : <i class="enemy">${theirs}</i></b><span>${ROUNDS.winTo}라운드 선승</span></div>` : '';
  return h(`<section class="scoreboard">${head}${table(squad, true)}${table(enemy, false)}</section>`);
}

// 라운드 기록 띠 (이긴 분대 색 · 끝난 방식 아이콘)
function roundStrip(match, squad) {
  const icon = (r) => (r.reason.includes('해체 완료') ? '✓' : r.reason.includes('폭발') ? '✸' : '✕');
  return `<div class="round-strip">${(match.history ?? []).map((r) => `<i class="${r.squad === squad ? 'ally' : 'enemy'} ${r.round === ROUNDS.half ? 'half' : ''}" title="라운드 ${r.round} · ${esc(r.reason)}"><small>${r.round}</small>${icon(r)}</i>`).join('')}</div>`;
}

// ───────────────────────── 작전 결과 ─────────────────────────
export function resultScreen({ result, onAgain, onTeam, onMenu, online = false }) {
  const { match, winner, reason, team, player } = result;
  const won = winner === team;
  const enemy = match.agents.find((a) => a.squad !== team)?.squad;
  const mine = match.score?.[team] ?? 0, theirs = match.score?.[enemy] ?? 0;
  const rounds = match.rules === 'rounds';
  const used = [...new Set(player.patches.filter(Boolean).map((p) => p.id))];
  const concepts = [
    ...used.map((id) => ({ title: `${PATCHES[id].concept} · ${PATCHES[id].name}`, text: PATCHES[id].conceptText, color: tierColor(id), icon: PATCH_ICONS[id] })),
    { title: LOCKPICK_CONCEPT.concept, text: LOCKPICK_CONCEPT.conceptText, color: '#c9ced4', icon: UI_ICONS.lock },
  ];
  const s = player.stats;
  const picked = result.concepts?.picked ?? [];
  const fresh = result.concepts?.fresh ?? [];
  const quiz = pickQuiz(picked, used, 3);
  const prog = loadProgress();
  const el = h(`
    <section class="screen result-screen ${won ? 'win' : 'lose'}">
      <div class="result-head">
        <div class="rh-kicker">${rounds ? `최종 점수 · ${match.history.length}라운드` : '작전 결과'}</div>
        <h1>${won ? '승리' : '패배'}${rounds ? ` <span class="rh-score"><i class="ally">${mine}</i> : <i class="enemy">${theirs}</i></span>` : ''}</h1>
        <p>마지막 라운드 · ${esc(reason)}</p>
        ${rounds ? roundStrip(match, team) : ''}
        <div class="my-stats">
          <div><b>${s.kills}</b><span>처치</span></div>
          <div><b>${s.deaths}</b><span>죽음</span></div>
          <div><b>${s.assists ?? 0}</b><span>도움</span></div>
          <div><b>${s.damage}</b><span>피해량</span></div>
          <div><b>${s.headshots}</b><span>헤드샷</span></div>
          <div><b>${s.defuses}</b><span>해체</span></div>
        </div>
      </div>
      <div class="result-body"></div>
      <div class="quiz">
        <h3>개념 점검 <small>주운 개념 카드 ${picked.length}장${fresh.length ? ` · 새 카드 ${fresh.length}장` : ''} · 도감 ${prog.concepts.length}/${CONCEPTS.length}</small></h3>
        <div class="quiz-list">${quiz.map((c, qi) => `
          <div class="quiz-item" data-q="${qi}">
            <div class="qi-head"><span>Q${qi + 1}</span><small>${esc(c.name)}</small></div>
            <p class="qi-q">${esc(c.q)}</p>
            <div class="qi-choices">${c.choices.map((ch, i) => `<button class="qi-choice" data-q="${qi}" data-i="${i}">${i + 1}. ${esc(ch)}</button>`).join('')}</div>
            <p class="qi-why"></p>
          </div>`).join('')}</div>
        <div class="quiz-score"></div>
      </div>
      <div class="concepts">
        <h3>작전 보고 · 운용한 힘의 원리</h3>
        <div class="concept-cards">${concepts.map((c) => `<div class="concept-card" style="--c:${c.color}"><div class="cc-icon">${c.icon}</div><b>${c.title}</b><p>${c.text}</p></div>`).join('')}</div>
      </div>
      <footer class="screen-foot">
        <button class="btn ghost" data-act="menu">${online ? '방 나가기' : '메인'}</button>
        ${online ? '' : '<button class="btn ghost" data-act="team">소속 변경</button>'}
        <button class="btn primary big" data-act="again">${online ? '대기실로' : '재출격 · 같은 소속'}</button>
      </footer>
    </section>`);
  el.querySelector('.result-body').appendChild(scoreboard(match, { me: player }));
  // 점검 문제: 한 번만 고를 수 있음, 고르면 정답·해설 표시
  let answered = 0, right = 0;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.qi-choice');
    if (!btn) return;
    const item = btn.closest('.quiz-item');
    if (item.classList.contains('done')) return;
    const c = quiz[Number(btn.dataset.q)];
    const ok = Number(btn.dataset.i) === c.answer;
    item.classList.add('done', ok ? 'right' : 'wrong');
    btn.classList.add('picked');
    item.querySelectorAll('.qi-choice')[c.answer].classList.add('answer');
    item.querySelector('.qi-why').textContent = `${ok ? '정답' : '오답'} — ${c.why}`;
    recordQuiz(ok, c.id);
    answered++;
    if (ok) right++;
    if (answered === quiz.length) el.querySelector('.quiz-score').textContent = `점검 결과 ${right} / ${quiz.length}${right === quiz.length ? ' · 완벽합니다' : ''}`;
  });
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'again') onAgain();
    if (act === 'team') onTeam();
    if (act === 'menu') onMenu();
  });
  return el;
}
