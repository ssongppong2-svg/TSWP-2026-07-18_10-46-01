import { BOT_NAMES, TEAM_INFO, TEAMS } from '../sim/constants.js';
import { LOADOUT_SLOTS, PATCHES, PATCH_ORDER, PATCH_TIERS, patchesOfTier } from '../sim/data.js';
import { COPIES_PER_TEAM, TeamDraft } from '../sim/draft.js';
import { MAP_ORDER, getMapDef } from '../sim/maps/index.js';
import { DIFFICULTY } from '../ai/bot.js';
import { createRng } from '../core/rng.js';
import { openTransport } from '../net/transport.js';
import { NetSession, normCode } from '../net/session.js';
import { packPlan, planMatch } from '../net/protocol.js';
import { PATCH_ICONS, UI_ICONS } from './icons.js';

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TEAM_MAX = 5;
const TIERS = ['normal', 'special', 'ultimate'];
const TIER_KEYS = { normal: 'C · Q', special: 'E', ultimate: 'X' };
const TIER_COUNT = { normal: 2, special: 1, ultimate: 1 };

// 온라인 대기실. net = { transport, session } 은 화면을 오가도 유지 (경기 후 같은 방으로 돌아옴)
export function onlineScreen({ settings, net, onBack, onStart, toast }) {
  const el = h(`<section class="screen online-screen"><header class="screen-head"><button class="btn ghost small" data-act="back">← 메인</button><h2>온라인 작전</h2><span class="net-kind"></span></header><div class="online-body"></div></section>`);
  const body = el.querySelector('.online-body');
  let disposed = false;
  let off = null;
  let lastStart = net.lastStart ?? null;
  let raf = 0;

  // 한 프레임에 한 번만 다시 그림 (창이 가려져 있으면 프레임 콜백이 멈추므로 타이머로)
  const render = () => {
    if (disposed) return;
    cancelAnimationFrame(raf);
    clearTimeout(raf);
    raf = document.hidden ? setTimeout(draw, 50) : requestAnimationFrame(draw);
  };

  const draw = () => {
    if (disposed) return;
    const s = net.session;
    el.querySelector('.net-kind').textContent = net.transport ? (net.transport.kind === 'claude' ? '아티팩트 실시간 연결' : '같은 브라우저 시험 연결') : '';
    if (net.transport === undefined) {
      body.innerHTML = `<div class="online-card"><p class="online-wait">연결 확인 중…</p></div>`;
      return;
    }
    if (!net.transport) {
      body.innerHTML = `
        <div class="online-card">
          <h3>온라인 작전을 쓸 수 없는 환경</h3>
          <p>온라인 작전은 <b>Claude 아티팩트 링크</b>로 열었을 때 같은 링크를 연 사람끼리 연결됩니다.</p>
          <ol class="online-steps">
            <li>아티팩트 오른쪽 위 <b>공유</b>에서 친구를 초대 (claude.ai 로그인 필요)</li>
            <li>한 사람이 <b>방 만들기</b> → 화면의 방 코드 4자리를 친구에게 알려 줌</li>
            <li>친구는 같은 링크에서 <b>코드로 참가</b></li>
          </ol>
          <p class="online-note">혼자 할 때는 메인의 <b>작전 개시</b>(봇 9명)를 이용하세요.</p>
        </div>`;
      return;
    }
    if (!s?.room) return drawMenu();
    drawRoom(s);
  };

  // ── 방 만들기 / 참가
  const drawMenu = () => {
    body.innerHTML = `
      <div class="online-card">
        <label class="field"><span>콜사인</span><input class="name-input" maxlength="8" value="${esc(settings.name || '요원')}"></label>
        <div class="online-actions">
          <div class="oa-col">
            <h3>방 만들기</h3>
            <p>방장이 됩니다. 방장 컴퓨터가 경기를 계산하므로 가장 성능 좋은 컴퓨터가 만들기를 권장합니다.</p>
            <button class="btn primary big" data-act="create">방 만들기</button>
          </div>
          <div class="oa-col">
            <h3>코드로 참가</h3>
            <p>방장에게 받은 4자리 코드를 입력하세요.</p>
            <div class="join-row"><input class="code-input" maxlength="4" placeholder="ABCD" autocomplete="off"><button class="btn primary" data-act="join">참가</button></div>
          </div>
        </div>
        <p class="online-note">빈자리는 봇이 채웁니다 (팀당 5명). 같은 아티팩트를 공유받은 사람만 들어올 수 있습니다.</p>
      </div>`;
    const code = body.querySelector('.code-input');
    code.addEventListener('input', () => (code.value = normCode(code.value)));
    code.addEventListener('keydown', (e) => e.key === 'Enter' && body.querySelector('[data-act="join"]').click());
  };

  // ── 대기실
  const drawRoom = (s) => {
    const peers = s.peers();
    const me = peers.find((p) => p.me);
    const host = s.host();
    const isHost = !!me && host?.key === me.key;
    const lobby = host?.lobby ?? { map: settings.mapId, diff: settings.difficulty ?? 'normal' };
    const team = me?.team ?? null;
    const counts = { defuse: peers.filter((p) => p.team === 'defuse').length, force: peers.filter((p) => p.team === 'force').length };
    const myLoad = me?.load ?? [];
    // 팀원이 이미 고른 패치 수 (나 제외)
    const taken = (id) => peers.filter((p) => !p.me && p.team && p.team === team && (p.load ?? []).includes(id)).length;
    const everyoneReady = peers.length > 0 && peers.every((p) => p.team && (p.ready || p.key === host?.key));
    const roster = (t) => {
      const list = peers.filter((p) => p.team === t);
      return `<div class="lobby-team t-${t}"><div class="lt-head"><b>${TEAM_INFO[t].name}</b><span>${list.length} / ${TEAM_MAX} · 빈자리 봇</span></div>
        <ul>${list.map((p) => `<li class="${p.me ? 'me' : ''}"><span class="lt-name">${esc(p.name)}${p.key === host?.key ? ' <i>방장</i>' : ''}</span><span class="lt-load">${(p.load ?? []).map((id) => PATCH_ICONS[id] ?? '').join('')}</span><span class="lt-ready ${p.ready || p.key === host?.key ? 'on' : ''}">${p.key === host?.key ? '방장' : p.ready ? '준비' : '대기'}</span></li>`).join('')}
        ${Array.from({ length: Math.max(0, TEAM_MAX - list.length) }, () => `<li class="bot"><span class="lt-name">봇</span></li>`).join('')}</ul>
        <button class="btn ${team === t ? 'primary' : 'ghost'} small" data-team="${t}" ${team !== t && counts[t] >= TEAM_MAX ? 'disabled' : ''}>${team === t ? '소속됨' : '이 팀으로'}</button></div>`;
    };
    const unassigned = peers.filter((p) => !p.team);
    const tierRow = (tier) => `
      <div class="lo-tier"><div class="lo-head" style="--c:${PATCH_TIERS[tier].color}"><b>${TIER_KEYS[tier]}</b><span>${PATCH_TIERS[tier].name} ${TIER_COUNT[tier]}개</span></div>
      <div class="lo-list">${patchesOfTier(tier).map((id) => {
        const mine = myLoad.includes(id);
        const full = !mine && taken(id) >= COPIES_PER_TEAM;
        return `<button class="lo-patch ${mine ? 'on' : ''}" data-patch="${id}" ${full || !team ? 'disabled' : ''} title="${esc(PATCHES[id].short ?? '')}" style="--c:${PATCH_TIERS[tier].color}">${PATCH_ICONS[id]}<span>${esc(PATCHES[id].name)}</span><small>팀 ${taken(id) + (mine ? 1 : 0)}/${COPIES_PER_TEAM}</small></button>`;
      }).join('')}</div></div>`;
    const noHost = !host ? '<p class="lobby-warn">방장이 방을 나갔습니다. 방을 나가 새로 만들거나 다른 코드로 참가하세요.</p>' : '';
    body.innerHTML = `
      <div class="lobby">
        ${noHost}
        <div class="lobby-code"><small>방 코드</small><b>${esc(s.code)}</b><span>친구에게 이 코드를 알려 주세요 · 같은 아티팩트 링크에서 <b>코드로 참가</b></span><button class="btn ghost small" data-act="copy">복사</button></div>
        <div class="lobby-grid">
          <div class="lobby-teams">${roster(TEAMS.DEFUSE)}${roster(TEAMS.FORCE)}
            ${unassigned.length ? `<p class="lobby-unassigned">소속 미정: ${unassigned.map((p) => esc(p.name)).join(', ')}</p>` : ''}
          </div>
          <div class="lobby-side">
            <h3 class="brief-label">작전 지역 ${isHost ? '' : '<small>방장이 정함</small>'}</h3>
            <div class="lobby-maps">${MAP_ORDER.map((id) => { const d = getMapDef(id); return `<button class="lobby-map ${lobby.map === id ? 'on' : ''}" data-map="${id}" ${isHost ? '' : 'disabled'}><b>${esc(d.name)}</b><small>${esc(d.mood ?? (d.weather === 'rain' ? '야간 · 강우' : '야간'))}</small></button>`; }).join('')}</div>
            <h3 class="brief-label">봇 숙련도 ${isHost ? '' : '<small>방장이 정함</small>'}</h3>
            <div class="seg">${Object.entries(DIFFICULTY).map(([k, d]) => `<button data-diff="${k}" class="${lobby.diff === k ? 'on' : ''}" ${isHost ? '' : 'disabled'}>${d.name}</button>`).join('')}</div>
          </div>
        </div>
        <h3 class="brief-label">포스 패치 <small>${team ? '팀마다 같은 패치는 2기까지 (먼저 고른 사람 우선)' : '먼저 소속을 고르세요'}</small></h3>
        <div class="loadout-pick">${TIERS.map(tierRow).join('')}</div>
        <footer class="screen-foot">
          <button class="btn ghost" data-act="leave">방 나가기</button>
          ${isHost
            ? `<button class="btn primary big" data-act="start" ${everyoneReady ? '' : 'disabled'}>작전 개시</button>`
            : `<button class="btn ${me?.ready ? 'ghost' : 'primary'} big" data-act="ready" ${team ? '' : 'disabled'}>${me?.ready ? '준비 취소' : '준비 완료'}</button>`}
        </footer>
        ${isHost && !everyoneReady ? '<p class="online-note right">모두 소속을 고르고 준비하면 시작할 수 있습니다. 빈자리는 봇.</p>' : ''}
      </div>`;
  };

  // 패치 고르기: 같은 등급이 가득 차면 가장 먼저 고른 것을 바꿈
  const togglePatch = (id) => {
    const s = net.session;
    const load = [...(s.me.load ?? [])];
    const i = load.indexOf(id);
    if (i >= 0) load.splice(i, 1);
    else {
      const tier = PATCHES[id].tier;
      const same = load.filter((x) => PATCHES[x].tier === tier);
      if (same.length >= TIER_COUNT[tier]) load.splice(load.indexOf(same[0]), 1);
      load.push(id);
    }
    s.set({ load, ready: false });
  };

  // 방장: 시작 정보 올리기
  const start = () => {
    const s = net.session;
    const host = s.host();
    const lobby = host?.lobby ?? { map: settings.mapId, diff: settings.difficulty ?? 'normal' };
    const players = s.peers().filter((p) => p.team).map((p) => ({ key: p.key, name: p.name, team: p.team, load: p.load ?? [], mastery: Array.isArray(p.mas) ? p.mas : [] }));
    const seed = Math.floor(Math.random() * 1e9);
    const plan = planMatch(players, { botNames: BOT_NAMES, draft: TeamDraft, rng: createRng(seed) });
    const st = { id: `${seed}`, seed, map: MAP_ORDER.includes(lobby.map) ? lobby.map : MAP_ORDER[0], diff: lobby.diff ?? 'normal', p: packPlan(plan, PATCH_ORDER) };
    s.set({ start: st, g: null });
  };

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const s = net.session;
    if (act === 'back') {
      await s?.leave();
      onBack();
      return;
    }
    if (act === 'create' || act === 'join') {
      const name = body.querySelector('.name-input')?.value.trim() || settings.name || '요원';
      settings.name = name;
      const code = normCode(body.querySelector('.code-input')?.value);
      if (act === 'join' && code.length !== 4) {
        toast?.('방 코드 4자리를 입력하세요.');
        return;
      }
      try {
        if (act === 'create') await s.create(name);
        else await s.join(code, name);
        if (act === 'create') s.set({ lobby: { map: settings.mapId, diff: settings.difficulty ?? 'normal' } });
      } catch (err) {
        console.error(err);
        toast?.('방에 들어가지 못했습니다. 잠시 후 다시 시도하세요.');
      }
      render();
      return;
    }
    if (!s?.room) return;
    const t = e.target.closest('[data-team]');
    if (t && !t.disabled) s.set({ team: t.dataset.team, load: s.me.team === t.dataset.team ? s.me.load : [], ready: false });
    const p = e.target.closest('[data-patch]');
    if (p && !p.disabled) togglePatch(p.dataset.patch);
    const mp = e.target.closest('[data-map]');
    if (mp && !mp.disabled && s.isHost) s.set({ lobby: { ...(s.me.lobby ?? {}), map: mp.dataset.map, diff: s.me.lobby?.diff ?? 'normal' } });
    const d = e.target.closest('[data-diff]');
    if (d && !d.disabled && s.isHost) s.set({ lobby: { ...(s.me.lobby ?? {}), diff: d.dataset.diff, map: s.me.lobby?.map ?? settings.mapId } });
    if (act === 'ready') s.set({ ready: !s.me.ready });
    if (act === 'start' && s.isHost) start();
    if (act === 'copy') navigator.clipboard?.writeText(s.code).then(() => toast?.('방 코드를 복사했습니다.'), () => {});
    if (act === 'leave') {
      await s.leave();
      render();
    }
  });

  // 방장의 시작 정보를 보면 경기로 (참가자), 방장은 올린 직후 바로
  const watch = () => {
    const s = net.session;
    if (!s?.room) return;
    const host = s.host();
    const st = host?.start;
    if (st && st.id !== lastStart) {
      lastStart = st.id;
      net.lastStart = st.id;
      const myKey = s.myKey;
      const inPlan = st.p.h.some(([, key]) => key === myKey);
      if (!inPlan) {
        toast?.('이번 판에는 자리가 없습니다. 다음 판에 참가하세요.');
        return;
      }
      onStart({ start: st, myKey, role: host.key === myKey ? 'host' : 'client' });
      return;
    }
    render();
  };

  (async () => {
    if (net.transport === undefined) {
      render();
      net.transport = await openTransport();
      if (net.transport && !net.session) net.session = new NetSession(net.transport);
    }
    if (disposed) return;
    off = net.session?.onChange(watch);
    render();
  })();

  el.cleanup = () => {
    disposed = true;
    cancelAnimationFrame(raf);
    off?.();
  };
  return el;
}
