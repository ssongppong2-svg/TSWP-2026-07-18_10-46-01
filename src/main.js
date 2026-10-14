import './styles.css';
import { AudioEngine } from './client/audio.js';
import { GameClient } from './client/game.js';
import { Stage } from './client/stage.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { changedKeys, setKeymap } from './core/keys.js';
import { createRng } from './core/rng.js';
import { TEAMS } from './sim/constants.js';
import { TeamDraft } from './sim/draft.js';
import { makeRoster } from './sim/match.js';
import * as S from './ui/screens.js';
import { onlineScreen } from './ui/online.js';
import { getMapDef } from './sim/maps/index.js';
import { missionById } from './sim/operation.js';
import { loadPhotos } from './client/photos.js';

const app = document.getElementById('app');
const ui = document.getElementById('ui');
const settings = loadSettings();
setKeymap(settings.keys); // 키 바꾸기에서 바꾼 키
const audio = new AudioEngine();
audio.setVolume(settings.volume);

let stage = null;

let game = null;
let screenEl = null;
let modal = null;
let overlay = null;
let board = null;

const toastEl = document.createElement('div');
toastEl.className = 'toast';
ui.appendChild(toastEl);
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4200);
}

function setScreen(el) {
  screenEl?.cleanup?.();
  screenEl?.remove();
  screenEl = el;
  if (el) ui.appendChild(el);
}
function setOverlay(el) {
  overlay?.remove();
  overlay = el;
  if (el) ui.appendChild(el);
}
function openModal(el) {
  modal?.remove();
  modal = el;
  ui.appendChild(el);
}
function closeModal() {
  modal?.remove();
  modal = null;
}

const openControls = () => openModal(S.controlsModal({ onClose: closeModal }));
// 키 바꾸기 (설정 안에서 열고, 닫으면 설정으로 돌아감)
const openKeys = () =>
  openModal(
    S.keysModal({
      onChange: () => {
        settings.keys = changedKeys();
        saveSettings(settings);
        game?.refreshKeys?.();
      },
      onClose: () => openSettings(),
    }),
  );
const openSettings = () =>
  openModal(
    S.settingsModal({
      settings,
      qualityNow: () => stage.qualityKey,
      onKeys: openKeys,
      onClose: closeModal,
      onChange: (k) => {
        saveSettings(settings);
        if (k === 'volume') audio.setVolume(settings.volume);
        if (k === 'fov') stage.setFov(settings.fov);
        if (k === 'quality') {
          stage.applyQuality(settings.quality);
          audio.setLowPower(stage.qualityKey === 'low');
        }
        if (k === 'bodycam') stage.setLens({});
        if (k === 'forceArrows' && game?.forceArrows) {
          game.forceArrows.enabled = settings.forceArrows;
          if (!settings.forceArrows) game.forceArrows.clear();
        }
      },
    }),
  );

// 메뉴 화면 뒤에서 맵을 천천히 보여주는 루프
let menuT = 0;
let menuLast = performance.now();
function menuLoop(now) {
  requestAnimationFrame(menuLoop);
  const dt = Math.min(0.1, Math.max(0, (now - menuLast) / 1000));
  menuLast = now;
  if (game) return;
  menuT += dt;
  stage.orbit(menuT);
  stage.render();
}
window.addEventListener('pointerdown', () => audio.unlock());
window.addEventListener('keydown', () => audio.unlock());
ui.addEventListener('click', (e) => {
  if (e.target.closest('button')) audio.play('ui');
});

// 온라인: 연결 통로·방은 화면을 오가도 유지 (경기가 끝나면 같은 방 대기실로 돌아옴)
const net = { transport: undefined, session: null, lastStart: null };

// quick: 화면을 열자마자 빠른 매칭 대기열에 들어감 (메인의 '빠른 매칭')
function showOnline(quick = false) {
  endGame();
  setScreen(onlineScreen({ settings, net, toast, onBack: showTitle, onStart: startNetGame, quick }));
}

function startNetGame({ start, myKey, role }) {
  endGame();
  saveSettings(settings);
  setScreen(null);
  closeModal();
  const mission = start.mode === 'cqb' ? missionById(start.mission) : null;
  audio.setRain(getMapDef(mission ? mission.map : start.map).weather === 'rain' ? 1 : 0);
  game = new GameClient({
    stage,
    audio,
    settings,
    uiRoot: ui,
    net: { role, session: net.session, start, myKey },
    hooks: {
      onStarted: () => setOverlay(null),
      onPause: () => setOverlay(S.pauseMenu({ onResume: () => game?.resume(), onSettings: openSettings, onControls: openControls, onQuit: leaveNetGame, online: true })),
      onResume: () => {
        setOverlay(null);
        closeModal();
      },
      onToast: toast,
      onQualityChange: () => saveSettings(settings),
      onScoreboard: (show, match) => {
        board?.remove();
        board = null;
        if (show) {
          board = S.scoreboard(match, { me: game?.player });
          board.classList.add('floating');
          ui.appendChild(board);
        }
      },
      onAbort: () => showOnline(),
      onEnd: (result) => {
        endGame();
        const leave = async () => {
          await net.session?.leave();
          showTitle();
        };
        if (result.op) {
          setScreen(S.opResultScreen({ result, online: true, onAgain: backToLobby, onMenu: leave }));
          return;
        }
        setScreen(
          S.resultScreen({
            result,
            online: true,
            onAgain: backToLobby,
            onTeam: backToLobby,
            onMenu: async () => {
              await net.session?.leave();
              showTitle();
            },
          }),
        );
      },
    },
  });
  if (mission) setOverlay(S.opStartOverlay({ mission, difficulty: start.opDiff ?? 'normal', online: true, onClick: () => game.requestStart() }));
  else setOverlay(S.clickToStart({ team: game.team, loadout: game.player.patches.map((p) => p?.id ?? null), mapId: start.map, online: true, onClick: () => game.requestStart() }));
}

// 경기 중 나가기: 방장이면 경기가 끝나고, 참가자면 봇이 대신함
function leaveNetGame() {
  const host = game?.hostSync;
  endGame();
  if (host) net.session?.set({ start: null, g: null });
  showOnline();
}

function backToLobby() {
  if (net.session?.isHost) net.session.set({ start: null, g: null });
  net.session?.set({ ready: false });
  showOnline();
}

function showTitle() {
  endGame();
  setScreen(
    S.titleScreen({
      onStart: showTeam,
      onOp: showOp,
      onOnline: () => showOnline(false),
      onQuick: () => showOnline(true),
      onCodex: () => openModal(S.codexModal({ onClose: closeModal })),
      onControls: openControls,
      onSettings: openSettings,
      onFullscreen: () => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else document.documentElement.requestFullscreen?.().catch(() => toast('현재 환경에서 전체 화면 사용 불가.'));
      },
    }),
  );
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
    toast('키보드·마우스 환경 필요. PC에서 접속 바람.');
  }
}

function showTeam() {
  endGame();
  setScreen(
    S.teamScreen({
      settings,
      onBack: showTitle,
      onMap: (mapId) => {
        settings.mapId = mapId;
        stage.setMap(mapId);
        audio.setRain(stage.map.weather === 'rain' ? 1 : 0);
      },
      onNext: ({ team, difficulty, name, mapId }) => {
        Object.assign(settings, { difficulty, name, lastTeam: team, mapId });
        saveSettings(settings);
        showDraft(team);
      },
    }),
  );
}

function showDraft(team) {
  endGame();
  setScreen(
    S.draftScreen({
      team,
      playerName: settings.name,
      audio,
      onBack: showTeam,
      onDone: ({ loadouts, byClick }) => startGame(team, loadouts, byClick),
    }),
  );
}

function startGame(team, loadouts, byClick) {
  endGame();
  setScreen(null);
  closeModal();
  game = new GameClient({
    stage,
    audio,
    settings,
    uiRoot: ui,
    team,
    difficulty: settings.difficulty,
    loadouts,
    mapId: settings.mapId,
    hooks: {
      onStarted: () => setOverlay(null),
      onPause: () =>
        setOverlay(
          S.pauseMenu({
            onResume: () => game?.resume(),
            onSettings: openSettings,
            onControls: openControls,
            onQuit: showTitle,
          }),
        ),
      onResume: () => {
        setOverlay(null);
        closeModal();
      },
      onToast: toast,
      onQualityChange: () => saveSettings(settings),
      onScoreboard: (show, match) => {
        board?.remove();
        board = null;
        if (show) {
          board = S.scoreboard(match, { me: game?.player });
          board.classList.add('floating');
          ui.appendChild(board);
        }
      },
      onEnd: (result) => {
        endGame();
        setScreen(S.resultScreen({ result, onAgain: () => showDraft(team), onTeam: showTeam, onMenu: showTitle }));
      },
    },
  });
  setOverlay(S.clickToStart({ team, loadout: loadouts.get(game.player.id) ?? [], mapId: game.match.map.id, onClick: () => game.requestStart() }));
  if (byClick) game.requestStart();
}

// ───── CQB 작전 (혼자 + 봇 분대) ─────
const GRADES = ['S', 'A', 'B', 'C', 'D'];
function showOp() {
  endGame();
  setScreen(
    S.opScreen({
      settings,
      best: settings.opBest ?? {},
      onBack: showTitle,
      onStart: ({ mission, difficulty, name }) => {
        Object.assign(settings, { opMission: mission, opDifficulty: difficulty, name });
        saveSettings(settings);
        startOpGame();
      },
    }),
  );
}

function startOpGame(byClick = false) {
  endGame();
  const mission = missionById(settings.opMission);
  const difficulty = settings.opDifficulty ?? 'normal';
  setScreen(null);
  closeModal();
  audio.setRain(getMapDef(mission.map).weather === 'rain' ? 1 : 0);
  game = new GameClient({
    stage,
    audio,
    settings,
    uiRoot: ui,
    team: TEAMS.DEFUSE,
    difficulty,
    op: { mission: mission.id, difficulty },
    hooks: {
      onStarted: () => setOverlay(null),
      onPause: () => setOverlay(S.pauseMenu({ onResume: () => game?.resume(), onSettings: openSettings, onControls: openControls, onQuit: showOp })),
      onResume: () => {
        setOverlay(null);
        closeModal();
      },
      onToast: toast,
      onQualityChange: () => saveSettings(settings),
      onScoreboard: (show, match) => {
        board?.remove();
        board = null;
        if (show) {
          board = S.scoreboard(match, { me: game?.player });
          board.classList.add('floating');
          ui.appendChild(board);
        }
      },
      onEnd: (result) => {
        endGame();
        // 작전별 최고 등급 (성공한 작전만)
        const r = result.op;
        if (r?.success) {
          const best = (settings.opBest ??= {});
          if (!best[r.mission] || GRADES.indexOf(r.grade) < GRADES.indexOf(best[r.mission])) best[r.mission] = r.grade;
          saveSettings(settings);
        }
        setScreen(S.opResultScreen({ result, onAgain: () => startOpGame(true), onMissions: showOp, onMenu: showTitle }));
      },
    },
  });
  setOverlay(S.opStartOverlay({ mission, difficulty, onClick: () => game.requestStart() }));
  if (byClick) game.requestStart();
}

function endGame() {
  if (!game) return;
  game.dispose();
  game = null;
  setOverlay(null);
  board?.remove();
  board = null;
  menuLast = performance.now();
}

// 맵 표지판·포스터 글자를 그리기 전에 글꼴을 기다림 (최대 2.5초, 실패하면 기본 글꼴)
function waitFonts() {
  if (!document.fonts?.load) return Promise.resolve();
  const loads = ['700 40px Rajdhani', '600 40px Rajdhani', '600 30px "IBM Plex Sans KR"', '700 30px "IBM Plex Sans KR"', '500 20px "IBM Plex Mono"'].map((f) =>
    document.fonts.load(f, '가A1').catch(() => {}),
  );
  return Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2500))]);
}

function boot() {
  try {
    stage = new Stage(app, settings);
  } catch (err) {
    console.error(err);
    ui.innerHTML = `<section class="screen fatal"><div><h1>3D 렌더링 불가</h1><p>현재 브라우저 또는 장치에서 WebGL을 사용할 수 없음.<br>최신 Chrome 또는 Edge에서 재접속 바람.</p></div></section>`;
    return;
  }
  if (settings.mapId && settings.mapId !== stage.map.id) stage.setMap(settings.mapId);
  stage.setLens({});
  audio.setLowPower(stage.qualityKey === 'low');
  audio.setRain(stage.map.weather === 'rain' ? 1 : 0);
  requestAnimationFrame(menuLoop);
  showTitle();
  if (new URLSearchParams(location.search).has('debug')) exposeDebug();
}
// 글꼴과 사진 텍스처를 기다린 뒤 시작 (사진은 없으면 절차 텍스처)
Promise.all([waitFonts(), loadPhotos()]).then(boot);

// 자동 테스트용 (주소 끝에 ?debug)
function exposeDebug() {
  window.forceBound = {
    get net() {
      return net;
    },
    get game() {
      return game;
    },
    showTeam,
    showDraft,
    showOp,
    quickOp(mission = 'annex', difficulty = 'normal') {
      Object.assign(settings, { opMission: mission, opDifficulty: difficulty });
      startOpGame();
      game.input.fallback = true;
      game.onLockChange(true);
      return game;
    },
    quickStart(team = TEAMS.DEFUSE, seed = 1, mapId = null) {
      if (mapId) settings.mapId = mapId;
      const rng = createRng(seed);
      const roster = makeRoster(team, settings.name);
      const loadouts = new Map();
      for (const t of [TEAMS.DEFUSE, TEAMS.FORCE]) {
        const d = new TeamDraft(roster.filter((m) => m.team === t).map((m) => m.id));
        d.autoFill(rng);
        for (const [k, v] of d.loadouts()) loadouts.set(k, v);
      }
      startGame(team, loadouts, false);
      game.input.fallback = true;
      game.onLockChange(true);
      return game;
    },
  };
}
