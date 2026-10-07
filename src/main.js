import './styles.css';
import { AudioEngine } from './client/audio.js';
import { GameClient } from './client/game.js';
import { Stage } from './client/stage.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { createRng } from './core/rng.js';
import { TEAMS } from './sim/constants.js';
import { TeamDraft } from './sim/draft.js';
import { makeRoster } from './sim/match.js';
import * as S from './ui/screens.js';

const app = document.getElementById('app');
const ui = document.getElementById('ui');
const settings = loadSettings();
const audio = new AudioEngine();
audio.setVolume(settings.volume);

let stage;
try {
  stage = new Stage(app, settings);
} catch (err) {
  console.error(err);
  ui.innerHTML = `<section class="screen fatal"><div><h1>3D 화면을 열 수 없어요</h1><p>이 브라우저나 컴퓨터에서 WebGL을 쓸 수 없는 것 같아요.<br>최신 크롬이나 엣지에서 다시 열어 주세요.</p></div></section>`;
  throw err;
}

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
const openSettings = () =>
  openModal(
    S.settingsModal({
      settings,
      onClose: closeModal,
      onChange: (k) => {
        saveSettings(settings);
        if (k === 'volume') audio.setVolume(settings.volume);
        if (k === 'fov') stage.setFov(settings.fov);
        if (k === 'quality') stage.applyQuality(settings.quality);
      },
    }),
  );

// 메뉴 화면 뒤에서 맵을 천천히 보여주는 루프
let menuT = 0;
let menuLast = performance.now();
function menuLoop(now) {
  requestAnimationFrame(menuLoop);
  const dt = Math.min(0.1, (now - menuLast) / 1000);
  menuLast = now;
  if (game) return;
  menuT += dt;
  stage.orbit(menuT);
  stage.render();
}
requestAnimationFrame(menuLoop);
window.addEventListener('pointerdown', () => audio.unlock());
window.addEventListener('keydown', () => audio.unlock());
ui.addEventListener('click', (e) => {
  if (e.target.closest('button')) audio.play('ui');
});

function showTitle() {
  endGame();
  setScreen(
    S.titleScreen({
      onStart: showTeam,
      onControls: openControls,
      onSettings: openSettings,
      onFullscreen: () => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else document.documentElement.requestFullscreen?.().catch(() => toast('이 화면에서는 전체 화면을 쓸 수 없어요.'));
      },
    }),
  );
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
    toast('이 게임은 키보드와 마우스가 있는 컴퓨터에서 할 수 있어요.');
  }
}

function showTeam() {
  endGame();
  setScreen(
    S.teamScreen({
      settings,
      onBack: showTitle,
      onNext: ({ team, difficulty, name }) => {
        Object.assign(settings, { difficulty, name, lastTeam: team });
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
          board = S.scoreboard(match);
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
  setOverlay(S.clickToStart({ team, loadout: loadouts.get(game.player.id) ?? [], onClick: () => game.requestStart() }));
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

showTitle();

// 자동 테스트용 (주소 끝에 ?debug)
if (new URLSearchParams(location.search).has('debug')) {
  window.forceBound = {
    get game() {
      return game;
    },
    showTeam,
    showDraft,
    quickStart(team = TEAMS.DEFUSE, seed = 1) {
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
