import * as THREE from 'three';
import { BotBrain, attachBots } from '../ai/bot.js';
import { eyePos } from '../sim/agent.js';
import { BOT_NAMES, DT, MASTERY, NOISE, ROUNDS, SUPPRESS, TEAM_INFO, TEAMS } from '../sim/constants.js';
import { K, isKey } from '../core/keys.js';

// 정조준 확대 배율 (조준 진행도 adsT를 부드럽게 · 손에 장비를 들면 확대 없음)
export const adsZoomAt = (a) => {
  const t = Math.max(0, Math.min(1, a?.adsT ?? 0));
  const e = t * t * (3 - 2 * t);
  return 1 + e * ((a?.equip ? 1 : WEAPONS[a?.weapon]?.adsZoom ?? 1) - 1);
};

// 경기 중 막는 브라우저 단축키: 도움말 · 찾기 · 새로고침 · 주소창 · 캐럿 탐색 · (키보드의) 뒤로·앞으로·새로고침 키
const BROWSER_KEYS = new Set(['F1', 'F3', 'F5', 'F6', 'F7', 'BrowserBack', 'BrowserForward', 'BrowserRefresh']);
// Ctrl(맥 Cmd)과 같이: 새로고침 · 찾기 · 인쇄 · 저장 · 북마크 · 주소창 · 기록 · 다운로드 (탭 닫기·새 탭·탭 이동은 브라우저가 먼저 가져가 막을 수 없음)
const CTRL_BROWSER_KEYS = new Set(['KeyR', 'KeyF', 'KeyG', 'KeyP', 'KeyS', 'KeyD', 'KeyL', 'KeyH', 'KeyJ', 'KeyU', 'KeyO', 'KeyE', 'KeyK']);
import { PATCHES, PATCH_ORDER, WEAPONS } from '../sim/data.js';
import { ClientSync, HostSync, InputRecorder, RemoteController, rosterFor, unpackPlan } from '../net/protocol.js';
import { Match } from '../sim/match.js';
import { Hud } from '../ui/hud.js';
import { Shop } from '../ui/shop.js';
import { LockpickUI } from '../ui/lockpick-ui.js';
import { AgentView } from './agent-view.js';
import { Effects } from './effects.js';
import { COMMANDS, DOOR_ACTIONS, Input, PlayerController } from './input.js';
import { ViewModel } from './viewmodel.js';
import { QUALITY, QUALITY_ORDER } from './stage.js';
import { ConceptCards } from './exhibits.js';
import { DevicesView } from './devices-view.js';
import { GearView } from './gear-view.js';
import { DoorsView } from './doors-view.js';
import { OpView } from './op-view.js';
import { missionById } from '../sim/operation.js';
import { ENTRY_COMMANDS, ENTRY_NAME, ENTRY_REACH } from '../sim/entry-orders.js';
import { GEAR } from '../sim/gear.js';
import { conceptCardTexture } from './textures.js';
import { CONCEPTS, CONCEPT_BY_ID, PATCH_CONCEPT } from '../sim/concepts.js';
import { addConcept, loadProgress, masteredIds, masteryOf, recordQuiz, recordUse } from '../core/progress.js';
import { PUZZLE_INFO } from '../sim/lockpick.js';
import { footSurface } from './sound-surfaces.js';

const PATCH_SOUNDS = {
  gravityVeil: 'veil', elasticPad: 'pad', resultantAmp: 'amp', reactionRounds: 'rounds', buoyShield: 'shield',
  frictionZero: 'friction', elasticNet: 'net', weightScanner: 'scanner',
  gravityCollapse: 'collapse', resultantSurge: 'surge', frictionStorm: 'storm',
};

// 한 경기를 화면에 연결: 시뮬레이션 + 3D + 소리 + HUD
export class GameClient {
  // net: 온라인 경기 { role: 'host' | 'client', session, start(방장이 올린 시작 정보), myKey }
  // op: CQB 작전 { mission(작전 id), difficulty(용의자 수·무장) } — 없으면 5대5 라운드제
  constructor({ stage, audio, settings, uiRoot, team, difficulty, loadouts, mapId, seed = Date.now(), hooks = {}, net = null, op = null }) {
    this.stage = stage;
    this.audio = audio;
    this.settings = settings;
    this.uiRoot = uiRoot;
    this.hooks = hooks;
    this.net = net;

    // 개념 카드: 아직 도감에 없는 개념부터 (순서는 무작위)
    const have = loadProgress().concepts;
    const fresh = CONCEPTS.map((c) => c.id).filter((id) => !have.includes(id)).sort(() => Math.random() - 0.5);
    if (net) {
      // 온라인: 방장이 정한 명단·패치·시드로 모두 같은 경기를 만듦 (CQB 작전이면 사람은 모두 진압팀)
      const mission = net.start.mode === 'cqb' ? missionById(net.start.mission) : null;
      stage.setMap(mission ? mission.map : net.start.map);
      const plan = unpackPlan(net.start.p, PATCH_ORDER, BOT_NAMES);
      const roster = rosterFor(plan, net.myKey);
      this.keys = new Map(plan.roster.filter((r) => r.key).map((r) => [r.id, r.key]));
      // 개념 카드는 모두에게 같은 것이 놓이도록 시드로만 정함
      const rules = mission ? { rules: 'cqb', mission: mission.id, opDifficulty: net.start.opDiff ?? 'normal', conceptIds: [], conceptCount: 0 } : { rules: 'rounds' };
      this.match = new Match({ map: stage.map, roster, loadouts: new Map(plan.loadouts), seed: net.start.seed, client: net.role === 'client', ...rules });
      this.player = this.match.player;
      if (net.role === 'host') {
        attachBots(this.match, net.start.diff);
        this.hostSync = new HostSync(this.match, { maxBytes: 3300 });
        for (const a of this.match.agents) {
          if (!a.human) continue;
          const key = this.keys.get(a.id);
          this.match.setController(a.id, new RemoteController(() => net.session.inputOf(key), (s) => (this.hostSync.acks[a.id] = s)));
        }
      } else {
        this.match.localAgent = this.player;
        this.clientSync = new ClientSync(this.match, this.player.id);
      }
      this.netT = 0;
      this.netN = 0;
      this.netCheckT = 0;
    } else if (op) {
      // CQB 작전: 진압팀(나 + 봇 4) vs 용의자 봇, 준비 단계에 보급
      const mission = missionById(op.mission);
      stage.setMap(mission.map);
      this.match = new Match({ map: stage.map, playerTeam: TEAMS.DEFUSE, playerName: settings.name || '나', loadouts, seed, conceptIds: [], conceptCount: 0, rules: 'cqb', mission: mission.id, opDifficulty: op.difficulty ?? 'normal', playerMastery: masteredIds() });
      attachBots(this.match, difficulty);
      this.player = this.match.player;
    } else {
      stage.setMap(mapId ?? stage.map.id);
      this.match = new Match({ map: stage.map, playerTeam: team, playerName: settings.name || '나', loadouts, seed, conceptIds: fresh, rules: 'rounds', playerMastery: masteredIds() });
      attachBots(this.match, difficulty);
      this.player = this.match.player;
    }
    this.input = new Input(stage.container);
    this.input.enabled = true;
    this.controller = new PlayerController(this.input, settings);
    this.controller.zoomOf = adsZoomAt;
    // 문 앞에서 F: 길게 누르면 문 행동 휠 (교전 중에만 문을 다룸)
    this.controller.doorTarget = (a) => (a?.alive && this.match.phase === 'live' && !this.ended ? this.match.doors.doorAt(a) : null);
    // 문을 보고 G: 문 진입 지휘 (대기·열고/섬광/폭파/걷어차고 진입·문 밑 확인)
    this.controller.entryTarget = (a) => (a?.alive && this.match.phase === 'live' && !this.ended ? this.match.doors.doorAt(a, ENTRY_REACH) : null);
    this.controller.syncFrom(this.player);
    if (net?.role === 'client') {
      // 참가자: 입력을 기록해 방장에게 보내고, 이 화면에서는 이동·사격만 미리 보여 줌
      this.recorder = new InputRecorder(this.controller);
      this.recorder.onCard = (seq) => (this.clientSync.pendingCardSeq = seq);
      this.match.setController(this.player.id, this.recorder);
    } else this.match.setController(this.player.id, this.controller);
    this.input.onLockChange = (locked, info) => this.onLockChange(locked, info);

    this.views = new Map();
    for (const a of this.match.agents) {
      // CQB 작전의 용의자는 무장한 민간인 차림
      const v = new AgentView(a, { showTag: a.squad === this.player.squad && !a.isPlayer, civilian: !!this.match.op && a.team === TEAMS.FORCE });
      stage.scene.add(v.root);
      this.views.set(a.id, v);
    }
    this.viewmodel = new ViewModel(this.player.squad, { detail: stage.qualityKey === 'low' ? 1 : 2 });
    stage.overlay = this.viewmodel;
    stage.resize();
    this.effects = new Effects(stage.scene, this.match, stage.lightRig);
    this.gearView = new GearView(stage.scene, this.match, this.effects, stage.lightRig);
    this.conceptCards = new ConceptCards(stage.scene, this.match, (id) => conceptCardTexture(CONCEPT_BY_ID[id]));
    this.devicesView = new DevicesView(stage.scene, this.match, { museum: this.match.map.def.theme === 'museum' });
    this.doorsView = new DoorsView(stage.scene, this.match, { museum: this.match.map.def.theme === 'museum' });
    this.opView = this.match.op ? new OpView(stage.scene, this.match, { smooth: !!this.clientSync }) : null;
    this.pickedConcepts = []; // 이번 경기에서 주운 개념 (결과 화면 점검 문제에 씀)
    this.newConcepts = [];
    // 이번 경기 공부 기록 (결과 화면): 보급 점검·해체 문제·힘 장치 사용·새로 숙달한 개념
    this.study = { quiz: 0, quizRight: 0, puzzles: {}, devices: 0, mastered: [] };
    this.effects.onCasingBounce = (p) => this.audio.play('casing', { pos: p });
    this.hud = new Hud(uiRoot, this.match, this.player.id, settings);
    this.lockpickUI = new LockpickUI(uiRoot);
    this.lockpickUI.onCard = (i) => this.controller.queue.cards.push(i);
    // 상점 (구매 시간에 B)
    this.shop = new Shop(uiRoot, this.match, this.player.id, { onBuy: (item) => this.controller.buy(item), onQuiz: (i) => this.controller.answerQuiz(i) });
    this.controller.shop = this.shop;

    this.started = false;
    this.paused = false;
    this.ended = false;
    this.acc = 0;
    this.last = performance.now();
    this.camYaw = this.player.yaw;
    this.camPitch = 0;
    this.specIndex = 0;
    this.shake = 0;
    this.kickCam = new THREE.Vector2();
    this.kickVel = new THREE.Vector2();
    this.tmpVel = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();
    this.rollKick = 0;
    this.rollKickVel = 0;
    this.bobPhase = 0;
    this.roll = 0;
    this.landDip = 0;
    this.blur = 0;
    this.inspectT = 0;
    this.wasInspecting = false;
    this.beepT = 0;
    this.heartT = 0;
    this.alertT = { A: -99, B: -99 };
    this.caughtT = 0;
    this.perf = { t: 0, frames: 0, sum: 0, done: false, warm: 1, holdT: 0 };
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.bindEvents();
    // 맵의 소리 공간(실내 울림·실외 메아리)과 배경음, 비 오는 맵이면 빗소리와 번개 뒤 천둥
    this.audio.setEnvironment(this.match.map);
    this.audio.startAmbience(this.match.map.def?.theme === 'museum' ? 'museum' : 'outdoor');
    this.audio.setRain(this.match.map.weather === 'rain' ? 1 : 0);
    stage.onThunder = (delay, vol) => {
      setTimeout(() => {
        if (!this.disposed) this.audio.play('thunder', { vol });
      }, delay * 1000);
    };

    this.onKeyDown = (e) => {
      // 경기 중에는 새로고침(F5 · Ctrl+R) · 도움말 · 찾기 같은 브라우저 단축키가 경기를 끊지 않게 막음
      if (this.started && !this.ended && (BROWSER_KEYS.has(e.code) || ((e.ctrlKey || e.metaKey) && CTRL_BROWSER_KEYS.has(e.code)))) {
        e.preventDefault();
        const reload = e.code === 'F5' || e.code === 'KeyR' || e.code === 'BrowserRefresh';
        if (reload && performance.now() - (this.reloadNoteAt ?? -1e9) > 4000) {
          this.reloadNoteAt = performance.now();
          this.hud.banner('새로고침 막힘', '경기 중에는 F5 · Ctrl+R을 꺼 둠 · 나가려면 Esc → 메뉴', 'small');
        }
      }
      if (e.code === 'Escape' && this.input.fallback && this.started && !this.paused && !this.ended) this.pause();
      if (isKey(e.code, 'score')) {
        e.preventDefault();
        if (this.started) this.hooks.onScoreboard?.(true, this.match);
      }
    };
    this.onKeyUp = (e) => {
      if (isKey(e.code, 'score')) this.hooks.onScoreboard?.(false, this.match);
    };
    // 경기 중 실수로 탭을 닫지 않게 (예: Ctrl을 누른 채 W)
    this.onBeforeUnload = (e) => {
      if (this.started && !this.ended) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    // 마우스 옆 버튼(뒤로·앞으로)으로 페이지를 벗어나지 않게 (경기 중)
    this.onMouseNav = (e) => {
      if ((e.button === 3 || e.button === 4) && this.started && !this.ended) e.preventDefault();
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('mousedown', this.onMouseNav);
    window.addEventListener('mouseup', this.onMouseNav);

    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // 지금 맡은 쪽 (공수 교대하면 바뀜) — 아군 판별은 같은 쪽인지로 (분대 전체가 함께 바뀜)
  get team() {
    return this.player.team;
  }

  // ───────────── 시작·일시정지 ─────────────
  requestStart() {
    this.audio.unlock();
    this.input.requestLock();
    // 전체 화면이면 Ctrl+W 같은 브라우저 단축키를 게임이 받도록 잠금
    navigator.keyboard?.lock?.().catch?.(() => {});
  }

  onLockChange(locked, info) {
    if (this.ended) return;
    if (locked) {
      if (!this.started) {
        this.started = true;
        this.hooks.onStarted?.();
        if (this.input.fallback) this.hooks.onToast?.('마우스 고정 불가 환경. 제한 모드로 진행. 새 창 또는 전체 화면 권장.');
      }
      if (this.paused) {
        this.paused = false;
        this.input.enabled = true;
        this.hooks.onResume?.();
      }
      this.last = performance.now();
    } else if (info?.error && !info.fallback) {
      this.hooks.onToast?.('잠시 후 다시 클릭하십시오.');
    } else if (this.started && !this.paused) {
      this.pause();
    }
  }

  pause() {
    if (this.ended) return;
    this.shop.close();
    this.paused = true;
    this.input.enabled = false; // 메뉴에서 누른 키가 다시 시작할 때 패치로 나가지 않게
    this.input.exitLock();
    this.hooks.onPause?.();
  }

  resume() {
    this.audio.unlock();
    this.input.enabled = true;
    this.input.requestLock();
  }

  // ───────────── 시뮬레이션 이벤트 → 화면·소리 ─────────────
  bindEvents() {
    const ev = this.match.events;
    const A = this.audio;
    const isMe = (a) => a?.id === this.player.id;
    const viewing = (a) => a?.id === this.viewAgent?.id;
    // 작은 소리는 규칙상 들리는 거리(NOISE)까지만 — 봇이 듣는 범위와 사람이 듣는 범위를 같게
    const rain = this.match.map.weather === 'rain' ? NOISE.rainMult : 1;
    const audible = (pos, radius) => {
      const c = this.stage.camera.position;
      const r = radius * rain;
      const d = Math.hypot(pos.x - c.x, pos.z - c.z);
      return d >= r ? 0 : Math.min(1, (r - d) / (r * 0.4));
    };

    ev.on('shot', (e) => {
      const local = viewing(e.agent) && e.agent.alive;
      const cam = this.stage.camera;
      const muzzle = local ? this.viewmodel.muzzleWorld(cam, this.tmp.set(0, 0, 0)) : this.views.get(e.agent.id).muzzleWorld(this.tmp);
      const port = local ? this.viewmodel.portWorld(cam, this.tmp2.set(0, 0, 0)) : null;
      this.effects.onShot(e, muzzle.clone(), local, port?.clone(), cam);
      if (local) {
        this.viewmodel.shot(e.agent.adsT > 0.5);
        // 발사 충격: 화면은 조금만 흔들림 (무기마다 세기)
        const heavy = { pistol: 1, mpistol: 0.6, sheriff: 1.8, shotgun: 2.2, sniper: 2.6, dmr: 1.7, smg: 0.55, carbine: 0.75, burst: 0.85, lmg: 0.95 }[e.weapon] ?? 0.8;
        this.kickVel.x += (Math.random() - 0.5) * 0.025 * heavy;
        this.kickVel.y += (0.03 + Math.random() * 0.015) * heavy;
        this.rollKick += (Math.random() - 0.5) * 0.012 * heavy;
        this.shake = Math.min(1, this.shake + 0.025 * heavy);
      }
      A.play(e.weapon, { pos: local ? null : e.origin });
      if (e.amp && local) A.play('ampShot');
      // 남은 탄을 귀로: 탄창 1/5 이하에서 가벼운 쇳소리 · 마지막 탄은 노리쇠 걸리는 소리
      const ws = local ? e.agent.weapons?.[e.weapon] : null;
      const W = WEAPONS[e.weapon];
      if (ws && W && W.magSize >= 8) {
        if (ws.mag === 0) A.play('boltLock');
        else if (ws.mag <= Math.max(3, Math.round(W.magSize * 0.2))) A.play('lastRounds', { vol: 1 - ws.mag / (W.magSize * 0.25 + 1) });
      }
    });
    // ── 문: 여닫기·살짝 열기·잠김·발차기·자물쇠 파손·폭파 (철문·나무문 소리가 다름)
    const DOOR_SND = { open: 'doorOpen', close: 'doorClose', shut: 'doorShut', crack: 'doorCreak', crackClose: 'doorCreak', locked: 'doorLocked', kick: 'doorKick', kickFail: 'kickFail', lockBreak: 'lockBreak', breach: 'doorBreach' };
    ev.on('door', (e) => {
      const d = e.door;
      if (!d) return;
      this.doorsView.onDoor(e);
      if (e.act === 'locked') d.st.knownLocked = true; // 참가자 화면에서도 지도에 잠긴 문 표시
      const pos = { x: d.x, y: 1.1, z: d.z };
      const loud = e.act === 'kick' || e.act === 'kickFail' || e.act === 'breach' || e.act === 'lockBreak';
      const quiet = e.act === 'crack' || e.act === 'crackClose' || e.act === 'locked';
      const v = viewing(e.agent) ? 1 : audible(pos, loud ? NOISE.kick : quiet ? NOISE.doorQuiet * 2 : NOISE.door * 1.4);
      if (DOOR_SND[e.act] && v > 0) A.play(DOOR_SND[e.act], { pos, vol: v, surface: d.mat });
      if (!viewing(e.agent)) return;
      if (e.act === 'locked') this.hud.banner('잠긴 문', `${K('interact')} 길게: 발차기 · 폭약 / 산탄총으로 손잡이 쪽 사격`, 'small');
      else if (e.act === 'kickFail') this.hud.banner('문이 버팀', '다시 차면 더 잘 부서짐 · C4 · 산탄총', 'small');
      else if (e.act === 'lockBreak') this.hud.banner('자물쇠 파손', e.how === 'shotgun' ? '산탄으로 자물쇠를 부숨' : '걷어차 문을 부숨', 'good');
    });
    ev.on('kick', (e) => {
      this.views.get(e.agent.id)?.kickDoor();
      if (!viewing(e.agent)) return;
      A.play('throw', { vol: 0.8 });
      this.kickVel.y -= 0.035;
      this.landDip = Math.max(this.landDip, 0.45);
    });
    ev.on('doorHit', (e) => {
      this.views.get(e.agent.id)?.hit();
      A.play('doorHit', { pos: viewing(e.agent) ? null : e.agent.pos });
      if (viewing(e.agent)) {
        this.shake = Math.min(1, this.shake + 0.5);
        this.blur = Math.min(1, this.blur + 0.45);
        this.hud.banner('문에 맞음', '휘청 · 잠시 조준 흔들림', 'bad');
      }
    });
    ev.on('commandDenied', (e) => {
      if (!isMe(e.agent)) return;
      A.play('denied');
      this.hud.banner('진입 지휘 불가', '문을 바라보고 4.5 m 안에서 지휘', 'small');
    });
    ev.on('roomClear', (e) => {
      if (e.team !== this.team) return;
      A.play('radio');
      this.hud.banner('방 확보', `${ENTRY_NAME[e.order.type] ?? '진입'} 완료 · 분대가 위치를 지킴`, 'good');
    });
    ev.on('mirror', (e) => {
      if (viewing(e.agent)) A.play(e.on ? 'mirrorOn' : 'mirrorOff');
    });
    ev.on('mirrorMark', (e) => {
      if (!viewing(e.agent)) return;
      if (e.target) {
        A.play('droneMark');
        this.hud.banner('문 밑 카메라: 적 표시', '5초 동안 벽 너머로 보임', 'good');
      } else A.play('denied');
    });
    // ── 투척·폭발 장비
    ev.on('equip', (e) => {
      if (!viewing(e.agent)) return;
      A.play(e.equip?.kind === 'throw' ? 'pinPull' : 'swap');
    });
    ev.on('throw', (e) => {
      if (viewing(e.agent)) this.viewmodel.toss(e.mode === 'short');
      const v = viewing(e.agent) ? 1 : audible(e.agent.pos, NOISE.throw * 2);
      if (v > 0) A.play('throw', { pos: viewing(e.agent) ? null : e.agent.pos, vol: v });
    });
    ev.on('gearBounce', (e) => {
      const v = audible(e, 25);
      if (v > 0) A.play('gearBounce', { pos: e, vol: Math.min(1, e.speed / 8) * v });
    });
    ev.on('chargePlaced', (e) => A.play('c4Place', { pos: viewing(e.agent) ? null : e.charge }));
    ev.on('detonate', (e) => {
      this.gearView.onDetonate(e, this.stage.camera.position);
      const pos = { x: e.x, y: e.y, z: e.z };
      if (e.kind === 'c4' && e.ownerId === this.viewAgent?.id) A.play('detClick');
      const snd = { frag: 'fragBlast', c4: 'c4Blast', stun: 'stunBang', flash: 'flashBang', smoke: 'smokeHiss', gas: 'smokeHiss' }[e.kind];
      if (snd) A.play(snd, { pos });
      // 내가 이명·섬광에 맞으면 귀가 울림
      const hit = e.hit?.find((h) => h.id === this.viewAgent?.id);
      if (hit && (e.kind === 'stun' || hit.k > 0.5)) A.play('ring', { vol: e.kind === 'stun' ? 0.6 + hit.k * 0.6 : hit.k * 0.6 });
    });
    ev.on('droneLaunch', (e) => A.play('droneUp', { pos: viewing(e.agent) ? null : e.drone.pos }));
    ev.on('droneMark', (e) => {
      if (!viewing(e.agent)) return;
      if (e.target) {
        A.play('droneMark');
        this.hud.banner('드론: 적 표시', `${GEAR.drone.mark}초 동안 벽 너머로 보임`, 'good');
      } else A.play('denied');
    });
    ev.on('droneEnd', (e) => {
      if (e.reason === 'shot' || e.reason === 'dead') {
        A.play('droneDown', { pos: e });
        this.effects.sparks.burst(e, '#ffd27a', 24, { speed: 4, up: 1, life: 0.5, gravity: 9 });
      }
      if (viewing(e.agent) && e.reason === 'shot') this.hud.banner('드론 격추됨', '', 'bad');
      else if (viewing(e.agent) && e.reason === 'battery') this.hud.banner('드론 배터리 소진', '', '');
    });
    ev.on('gearDenied', (e) => {
      if (!isMe(e.agent)) return;
      A.play('denied');
      const msg = { none: e.which === 'throw' ? '투척물이 없음 · 보급 단말기에서 받기' : 'C4가 없음', far: '붙일 곳이 너무 멂 · 벽·바닥에 가까이', arming: 'C4 준비 중 · 잠시 뒤 기폭' }[e.reason];
      if (msg) this.hud.banner(msg, '', 'bad');
    });
    ev.on('melee', (e) => {
      if (viewing(e.agent)) this.viewmodel.swing(e.heavy);
      const kv = viewing(e.agent) ? 1 : audible(e.agent.pos, NOISE.knife * 2);
      if (kv > 0) A.play('knife', { pos: viewing(e.agent) ? null : e.agent.pos, vol: kv });
      if (e.target && (kv > 0 || viewing(e.target))) A.play('knifeHit', { pos: e.target.pos });
    });
    ev.on('impact', (e) => {
      this.effects.onImpact(e);
      if (e.kind === 'shield') A.play('shieldHit', { pos: e });
      if (e.kind === 'door') {
        const v = audible(e, 30);
        if (v > 0) A.play('doorImpact', { pos: e, vol: v, surface: e.mat });
      }
      // 몸에 맞는 소리는 가까이에서만 들림 (화면에 명중 표시는 없음)
      if (e.kind === 'flesh') A.play('impact', { pos: e });
    });
    ev.on('ricochet', (e) => {
      this.effects.onRicochet(e);
      A.play('ricochet', { pos: e });
    });
    ev.on('hit', (e) => {
      this.views.get(e.target.id)?.hit(e.headshot ? 1.6 : e.blocked ? 0.6 : 1);
      // 내가 맞힘: 조준점 명중 표시 + 명중음 (산탄은 한 번만)
      if (e.attacker && viewing(e.attacker) && e.attacker.team !== e.target.team && (this.hitSoundT <= 0 || e.killed)) {
        this.hitSoundT = 0.03;
        // 방탄이 막은 탄은 회색 표시 + 쇳소리, 뚫은 탄은 보통 명중
        this.hud.hitmark(e.killed ? 'kill' : e.blocked ? 'block' : e.headshot ? 'head' : 'hit');
        // 머리: 헬멧이면 '차랑'(뚫었으면 '딱'도), 맨머리면 '딱' · 몸통: 방탄에 막히면 쇳소리
        if (!e.killed) {
          if (e.headshot && e.armor) A.play('helmetPing');
          if (e.headshot && !e.blocked) A.play('headshot');
          else if (!e.headshot) A.play(e.blocked ? 'armorHit' : 'hit');
        }
        // 방탄이 이번 탄으로 부서짐
        if (e.armorBroke && !e.killed) A.play('armorBreak');
      }
      // 내가 맞음: 맞은 방향 표시 + 짧은 충격
      if (viewing(e.target)) {
        if (isMe(e.target)) A.play('hurt');
        // 헬멧이 머리를 지켜 줌: '차랑' + 잠깐 귀가 울리고 흐려짐
        if (e.headshot && e.armor && !e.killed) {
          A.play('helmetPing', { vol: 0.85 });
          A.play('ring', { vol: 0.45 });
          this.blur = Math.min(1, this.blur + 0.35);
        }
        this.shake = Math.min(1, this.shake + (e.headshot ? 0.3 : 0.15));
        this.blur = Math.min(1, this.blur + e.amount / 90);
        if (e.attacker) {
          const dx = e.attacker.pos.x - e.target.pos.x, dz = e.attacker.pos.z - e.target.pos.z;
          const ang = Math.atan2(-dx, -dz);
          let rel = this.camYaw - ang;
          while (rel > Math.PI) rel -= Math.PI * 2;
          while (rel < -Math.PI) rel += Math.PI * 2;
          this.hud.damageFrom(rel);
        }
      }
    });
    ev.on('kill', (e) => {
      this.hud.killFeed(e);
      if (isMe(e.killer) && e.victim.team !== e.killer.team) {
        this.hud.killStreak(e.streak, e.headshot);
        A.play(`kill${Math.max(1, Math.min(5, e.streak))}`);
        if (e.headshot) A.play('headshot');
      }
      if (isMe(e.victim)) {
        A.play('death');
        this.hud.banner('전투 불능', `${e.killer?.name ?? ''} · 아군 시점으로 전환`, 'bad');
      }
    });
    // 발밑 재질(콘크리트·철제 통로·타일·계단)에 따라 다른 발소리
    const surfaceOf = (a) => footSurface(this.match.map, a.pos.x, a.pos.y, a.pos.z);
    ev.on('footstep', (e) => {
      const name = e.loud ? 'step' : 'quietStep';
      if (viewing(e.agent)) A.play(name, { vol: e.loud ? 0.45 : 1, surface: surfaceOf(e.agent) });
      else {
        // 달리는 발소리는 NOISE.step 거리까지, 걷거나 앉아 움직이는 소리는 아주 가까이(4m)에서만
        const v = audible(e.agent.pos, e.loud ? NOISE.step : 4 / rain);
        if (v > 0) A.play(name, { pos: e.agent.pos, vol: e.loud ? v : 0.8 * v, surface: surfaceOf(e.agent) });
      }
    });
    ev.on('conceptPicked', (e) => {
      if (!isMe(e.agent)) return;
      const id = e.concept.id;
      this.pickedConcepts.push(id);
      const isNew = addConcept(id);
      if (isNew) this.newConcepts.push(id);
      A.play('concept');
      this.hud.conceptCard(CONCEPT_BY_ID[id], { isNew, total: loadProgress().concepts.length, of: CONCEPTS.length });
    });
    ev.on('radio', (e) => {
      if (e.team !== this.team) return;
      A.play('radio');
      this.hud.radio({ name: e.agent.name, text: e.text, kind: e.kind });
    });
    ev.on('command', (e) => {
      if (e.team !== this.team) return;
      if (isMe(e.agent)) A.play('radioOut');
      this.hud.order(e.order, e.agent);
    });
    ev.on('patch', (e) => {
      this.effects.onPatch(e);
      const pos = e.zone ? { x: e.zone.x, y: e.zone.y, z: e.zone.z } : { x: e.agent.pos.x, y: e.agent.pos.y + 1, z: e.agent.pos.z };
      A.play(PATCH_SOUNDS[e.patchId], { pos: isMe(e.agent) && !e.zone ? null : pos });
      if (isMe(e.agent)) this.hud.concept(e.patchId);
      if (e.patchId === 'weightScanner' && e.agent.team === this.team) this.hud.banner('무게 감지 작동', '4초간 달리기·사격·착지 진동 탐지', 'warn');
      if (e.patchId === 'resultantSurge' && e.agent.team === this.team) this.hud.banner('합력 폭주', '분대 전원 공격력 +15% · 8초', 'good');
    });
    ev.on('patchDenied', (e) => {
      if (isMe(e.agent)) {
        A.play('denied');
        const def = PATCHES[e.agent.patches[e.slot].id];
        this.hud.banner(def.name, e.reason === 'gauge' ? '필살 게이지 미충전' : '재사용 대기 중', 'small');
      }
    });
    ev.on('captured', (e) => {
      if (isMe(e.agent)) A.play('captured');
    });
    ev.on('netRelease', (e) => A.play('netRelease', { pos: e.zone }));
    ev.on('shieldEnd', (e) => e.broken && A.play('shieldBreak', { pos: { x: e.shield.x, y: 1, z: e.shield.z } }));
    ev.on('projectileCaught', (e) => {
      if (this.caughtT > 0) return;
      this.caughtT = 0.08;
      A.play('caught', { pos: e.projectile.pos });
    });
    ev.on('lockpickStart', (e) => {
      if (isMe(e.agent)) return;
      if (this.team === TEAMS.FORCE && this.match.time - this.alertT[e.bomb.id] > 5) {
        this.alertT[e.bomb.id] = this.match.time;
        this.hud.banner(`경보 · 폭탄 ${e.bomb.id} 해체 시도`, '해체팀 접근. 즉시 대응.', 'warn');
        A.play('alert');
      }
    });
    ev.on('lockpickCard', (e) => isMe(e.agent) && A.play('card'));
    ev.on('lockpickMatch', (e) => isMe(e.agent) && A.play('match'));
    ev.on('lockpickEnd', (e) => {
      if (!isMe(e.agent)) return;
      // 해체 문제를 풀면 그 개념을 쓴 것 → 숙달
      if (e.reason === 'done' && e.puzzleKind) {
        this.study.puzzles[e.puzzleKind] = (this.study.puzzles[e.puzzleKind] ?? 0) + 1;
        this.studied(PUZZLE_INFO[e.puzzleKind]?.concept, '해체 문제');
      }
      if (e.reason === 'hit' || e.reason === 'captured') {
        A.play('lockFail');
        this.hud.banner('해체 중단', e.reason === 'hit' ? '피격. 처음부터 재시도.' : '구속됨. 처음부터 재시도.', 'bad');
      }
    });
    ev.on('quizAnswer', (e) => {
      if (!isMe(e.agent)) return;
      A.play(e.correct ? 'match' : 'denied');
      this.study.quiz++;
      if (e.correct) this.study.quizRight++;
      const fresh = recordQuiz(e.correct, e.conceptId);
      if (e.correct) this.hud.banner('보급 점검 정답', `+${e.bonus} J · ${CONCEPT_BY_ID[e.conceptId]?.name ?? ''}`, 'good');
      if (fresh) this.masteredBanner(e.conceptId);
    });
    ev.on('bombDefused', (e) => {
      A.play('defused');
      if (this.match.op) {
        const left = this.match.bombs.filter((b) => b.state === 'armed').length;
        this.hud.banner(`장치 ${this.match.bombs.length > 1 ? e.bomb.id + ' ' : ''}해체`, `${e.agent.name}${left ? ` · 남은 장치 ${left}기` : ''}`, 'good');
        return;
      }
      const left = this.match.bombs.filter((b) => b.state === 'armed').length;
      // 포스팀은 누가 해체했는지 모름 (폭탄 신호만 끊김)
      const who = this.team === TEAMS.DEFUSE ? `${e.agent.name} · ` : '';
      this.hud.banner(this.team === TEAMS.DEFUSE ? `폭탄 ${e.bomb.id} 해체 완료` : `폭탄 ${e.bomb.id} 신호 두절`, `${who}${left ? `잔여 폭탄 ${left}기` : '전 폭탄 해체'}`, this.team === TEAMS.DEFUSE ? 'good' : 'bad');
    });
    ev.on('explode', () => {
      this.effects.onExplode(this.stage.camera.position);
      A.play('explosion');
      if (this.effects.flash > 0.3) A.play('ring');
    });
    ev.on('timeWarning', (e) => {
      A.play('tick');
      this.hud.banner(`잔여 ${e.left}초`, e.left <= 10 ? '폭발 임박' : '', 'warn');
    });
    ev.on('roundStart', () => {
      A.play('roundStart');
      this.shop.close();
      if (this.match.op) this.hud.roundBanner(this.match.op.mission.code, '작전 개시', '용의자 제압 · 장치 해체 · 연구원 구출 · 연구 자료 확보', 'info', 3);
      else this.hud.banner('교전 개시', this.team === TEAMS.DEFUSE ? '폭탄 2기 해체 또는 적 전원 제압' : '폭탄 방어 · 해체팀 제압', 'good');
    });
    // ── CQB 작전: 결박 풀기·자료 확보·구출·연구원 피해·장치
    ev.on('opTask', (e) => {
      if (!viewing(e.agent)) return;
      if (e.state === 'start') A.play(e.kind === 'free' ? 'snipStart' : 'inspect');
      else if (e.state === 'done') {
        A.play(e.kind === 'free' ? 'snip' : 'intel');
        this.hud.banner(e.kind === 'free' ? `${e.item.name} 결박 해제` : '연구 자료 확보', e.kind === 'free' ? '스스로 투입 지점으로 이동 · 엄호' : e.item.name, 'good');
      } else if (e.state === 'cancel') A.play('denied');
    });
    ev.on('opFound', (e) => {
      A.play('radio');
      this.hud.banner(e.kind === 'hostage' ? '연구원 발견' : '연구 자료 발견', `${e.item.name} · ${e.agent.name} 보고 · 지도에 표시`, 'info');
    });
    ev.on('hostageRescued', (e) => {
      A.play('rescue');
      this.hud.banner('연구원 구출', `${e.hostage.name} · 투입 지점 도착`, 'good');
    });
    ev.on('hostageHit', (e) => {
      if (e.attacker && isMe(e.attacker)) this.hud.banner('사격 중지 — 연구원 피격', e.hostage.name, 'bad');
    });
    ev.on('hostageDown', (e) => {
      A.play('lockFail');
      this.hud.banner('연구원 사망', `${e.hostage.name}${e.attacker?.team === TEAMS.DEFUSE ? ' · 아군 사격 (감점)' : ''}`, 'bad');
    });
    ev.on('opDevices', () => {
      A.play('defused');
      this.hud.banner('장치 해체 완료', '시간 제한 해제 · 남은 목표 수행', 'good');
    });
    // 새 라운드: 시작 구역에서 다시 (시점도 시작 방향으로)
    ev.on('roundPrep', (e) => {
      this.controller.syncFrom(this.player);
      this.doorsView.clearDebris();
      this.camYaw = this.player.yaw;
      this.camPitch = 0;
      this.specIndex = 0;
      this.blur = this.shake = this.landDip = 0;
      this.lockpickUI.update(null);
      A.play('roundPrep');
      const m = this.match;
      const mine = m.score[this.player.squad] ?? 0;
      const theirs = Object.entries(m.score).find(([k]) => k !== this.player.squad)?.[1] ?? 0;
      const point = Math.max(mine, theirs) === ROUNDS.winTo - 1 ? ' · 매치 포인트' : '';
      const side = this.team === TEAMS.DEFUSE ? '공격' : '수비';
      const swap = e.round === ROUNDS.half + 1;
      this.hud.roundBanner(swap ? '후반 시작 · 공수 교대' : `라운드 ${e.round}${point}`, `${side} · ${TEAM_INFO[this.team].name}`, TEAM_INFO[this.team].goal, swap ? 'swap' : 'info', 3);
    });
    ev.on('roundEnd', (e) => {
      const win = e.squad === this.player.squad;
      const mine = e.score[this.player.squad] ?? 0;
      const theirs = Object.entries(e.score).find(([k]) => k !== this.player.squad)?.[1] ?? 0;
      this.shop.close();
      this.lockpickUI.update(null);
      A.play(win ? 'roundWin' : 'roundLose');
      this.hud.roundBanner(`라운드 ${e.round} · ${mine} : ${theirs}`, win ? '라운드 승리' : '라운드 패배', e.halftime ? `${e.reason} · 전반 종료` : e.reason, win ? 'win' : 'lose', 3.6);
    });
    ev.on('buy', (e) => isMe(e.agent) && A.play(e.sold ? 'sell' : 'buy'));
    ev.on('buyDenied', (e) => {
      if (!isMe(e.agent)) return;
      A.play('denied');
      this.shop.deny(e.item);
    });
    ev.on('reload', (e) => {
      if (viewing(e.agent)) return A.play('reload');
      const v = audible(e.agent.pos, NOISE.reload);
      if (v > 0) A.play('reload', { pos: e.agent.pos, vol: v });
    });
    ev.on('swap', (e) => viewing(e.agent) && A.play('swap'));
    ev.on('dryFire', (e) => isMe(e.agent) && A.play('dry'));
    // 총알이 내 머리 옆을 스침: 휙·딱 소리 + 고개가 살짝 움찔 (화면 가장자리 어둠은 제압 수치로)
    ev.on('nearMiss', (e) => {
      // 내 탄이 적을 스침: 조준점에 아주 옅은 표시 (명중 표시가 떠 있으면 생략)
      if (e.owner === this.player.id && e.agent.team !== this.player.team && this.hud.hitT <= 0 && performance.now() - (this.suppMarkAt ?? 0) > 180) {
        this.suppMarkAt = performance.now();
        this.hud.hitmark('supp');
      }
      if (!viewing(e.agent) || !e.agent.alive) return;
      const near = 1 - e.d / SUPPRESS.radius;
      A.play('whiz', { pos: { x: e.x, y: e.y, z: e.z }, vol: 0.55 + near * 0.45 });
      this.kickVel.x += (Math.random() - 0.5) * 0.02 * near;
      this.kickVel.y += (Math.random() - 0.3) * 0.012 * near;
      this.shake = Math.min(1, this.shake + 0.08 * near);
    });
    ev.on('padLaunch', (e) => {
      A.play('pad', { pos: e.agent.pos, vol: viewing(e.agent) ? 1.2 : 1 });
      if (isMe(e.agent)) this.study.devices++;
    });
    ev.on('gate', (e) => {
      const [r, c] = e.device.cells[0];
      const pos = { x: this.match.map.cellX(c), y: 2, z: this.match.map.cellZ(r) };
      A.play(e.done ? 'shutterStop' : 'shutter', { pos });
      if (!e.done && e.by && isMe(e.by)) this.study.devices++;
      if (!e.done && e.by && isMe(e.by)) this.hud.radio({ name: e.device.name ?? '지레 셔터', text: `${e.closed ? '셔터 내림' : '셔터 올림'} · 지레: 받침점에서 먼 곳의 작은 힘으로 무거운 셔터를 움직임`, kind: 'order' });
    });
    ev.on('cratePush', (e) => A.play('cratePush', { pos: { x: this.match.map.cellX(e.device.st.c), y: 0.5, z: this.match.map.cellZ(e.device.st.r) } }));
    ev.on('lift', (e) => A.play('liftStop', { pos: { x: this.match.map.cellX(e.device.c), y: e.device.st.y, z: this.match.map.cellZ(e.device.r) } }));
    ev.on('land', (e) => {
      if (viewing(e.agent)) {
        this.viewmodel.landed(e.speed);
        this.landDip = Math.min(1, e.speed / 9);
      }
      const lv = viewing(e.agent) ? 1 : audible(e.agent.pos, NOISE.land);
      if (lv > 0) A.play('land', { pos: viewing(e.agent) ? null : e.agent.pos, vol: Math.min(1, e.speed / 10) * lv, surface: surfaceOf(e.agent) });
    });
    ev.on('matchEnd', (e) => {
      this.ended = true;
      // 방장: 끝난 상태(결과·통계)를 바로 올려 둠 — 참가자가 마지막 스냅숏을 놓쳐도 결과를 받도록 경기를 닫은 뒤에도 남김
      if (this.hostSync) this.net.session.set({ g: this.hostSync.snapshot({ withStats: true }) });
      this.shop.close();
      A.play(e.winner === this.player.squad ? 'win' : 'lose');
      this.lockpickUI.update(null);
      setTimeout(() => {
        if (this.disposed) return;
        this.input.exitLock();
        this.hooks.onEnd?.(this.result());
      }, 3200);
    });
  }

  // HUD 휠: 지휘(G) 또는 문 행동(문 앞 F 길게)
  wheelDef() {
    const c = this.controller;
    if (c.wheelOpen) return { title: c.cmdItems === ENTRY_COMMANDS ? '문 진입' : '지휘', items: c.cmdItems ?? COMMANDS, sel: c.wheelSel };
    if (c.doorWheel) return { title: '문', items: c.doorItems, sel: c.doorWheel.sel };
    return null;
  }

  // 문 행동 휠 항목: 바라보는 문 상태에 맞춘 이름·설명, 지금 못 하는 것은 off
  doorItems() {
    const p = this.player;
    const d = this.match.doors.doorAt(p);
    const o = d ? this.match.doors.options(p, d) : null;
    return DOOR_ACTIONS.map((x) => {
      const it = { ...x };
      if (!o) it.off = true;
      else if (x.act === 'crack') {
        if (o.open || o.cracked) Object.assign(it, { label: '살짝 닫기', sub: '틈만 남기고 천천히' });
        it.off = o.locked && o.closed;
        if (it.off) it.sub = '잠긴 문';
      } else if (x.act === 'kick') {
        it.off = !o.kick;
        if (o.locked) it.sub = '잠긴 문 · 찰수록 잘 부서짐';
        else if (!o.kick) it.sub = '이미 열린 문';
      } else if (x.act === 'mirror') {
        it.off = !o.mirror;
        if (it.off) it.sub = '닫힌 문에만';
      } else if (x.act === 'charge') {
        it.off = !o.charge;
        if (!((p.gear?.c4 ?? 0) > 0)) it.sub = 'C4 없음 · 보급에서 구매';
        else if (it.off) it.sub = '닫힌 문에만';
        else it.sub = `C4 ${p.gear.c4}개 · 5로 기폭기`;
      }
      return it;
    });
  }

  result() {
    const m = this.match;
    return { match: m, winner: m.winner, reason: m.reason, team: this.player.squad, player: this.player, concepts: { picked: this.pickedConcepts, fresh: this.newConcepts }, study: this.study, op: m.op?.result ?? null };
  }

  // ───────────── 매 프레임 ─────────────
  frame(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    // requestAnimationFrame 시각은 프레임 시작 시각이라, 직전에 performance.now()로 잰 값보다 앞설 수 있음
    // (셰이더를 준비하느라 첫 프레임이 오래 걸리면 수백 ms) → 음수가 되지 않게
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const m = this.match;

    const pressed = this.input.pressed.slice();
    // 상점: 구매 시간에 B로 열고 닫음 (구매 시간이 끝나거나 쓰러지면 닫힘)
    const canShop = m.canBuy && m.phase === 'buy' && this.player.alive && this.started && !this.paused && !this.ended;
    // CQB 작전 준비: Enter = 준비 완료 (3초 뒤 개시). 온라인은 방장만
    if (pressed.some((c) => isKey(c, 'start')) && m.op && m.phase === 'buy' && m.phaseT > 3 && this.started && !this.paused && !this.clientSync) {
      m.phaseT = 3;
      this.shop.close();
      this.audio.play('radioOut');
      this.hud.banner('작전 개시 3초 전', '진압팀 진입 준비', 'warn');
    }
    if (pressed.some((c) => isKey(c, 'shop')) && canShop && this.input.active) {
      this.shop.toggle();
      this.audio.play('ui');
    }
    if (!canShop && this.shop.isOpen) this.shop.close();
    // 문 행동 휠 항목은 지금 바라보는 문 상태에 맞춤 (못 하는 행동은 흐리게)
    if (this.controller.fHold || this.controller.doorWheel) this.controller.doorItems = this.doorItems();
    this.controller.frame(this.player);
    if (this.controller.denied) {
      this.controller.denied = false;
      this.audio.play('denied');
    }
    // 온라인 경기는 일시정지해도 멈추지 않음 (다른 사람이 계속 싸우는 중)
    const running = this.net ? !this.netOver : this.started && !this.paused;
    if (running) {
      if (this.clientSync) this.netReceive(now);
      if (!this.player.alive && pressed.includes('Mouse0')) this.specIndex++;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 6) {
        m.tick(DT);
        this.acc -= DT;
        steps++;
      }
      if (steps === 6) this.acc = 0;
      if (this.clientSync) this.clientSync.smooth(dt, now / 1000);
      if (this.net) this.netSend(dt);
      this.caughtT -= dt;
      this.hitSoundT = (this.hitSoundT ?? 0) - dt;
      this.sounds(dt);
      this.updateInspect(dt);
      this.watchPerformance(dt);
    }
    const alpha = running ? Math.min(1, this.acc / DT) : 1;
    this.updateCamera(dt, alpha);

    const time = now / 1000;
    AgentView.eye.copy(this.stage.camera.position);
    for (const v of this.views.values()) {
      v.update(dt, alpha, time);
      // 내 몸은 숨김 (드론·문 밑 카메라로 보는 동안에는 앉아 있는 내 몸이 보임)
      v.root.visible = !(v.agent.id === this.viewAgent?.id && v.agent.alive && !this.droneView && !this.mirrorView);
    }
    this.effects.update(dt, alpha, this.team);
    this.gearView.update(dt, alpha, this.droneView?.id ?? null);
    this.updateDroneSounds();
    {
      const va0 = this.viewAgent ?? this.player;
      this.gearView.updateArc(va0, va0 === this.player && this.started && !this.paused && !this.ended && !va0.mirror);
    }
    this.conceptCards.update(time, this.player.id);
    this.devicesView.update();
    this.doorsView.update(dt, alpha);
    this.opView?.update(dt, alpha);
    const va = this.viewAgent ?? this.player;
    const cam = this.stage.camera;
    const vel = this.tmpVel.set(va.vel.x, va.vel.y, va.vel.z).applyQuaternion(this.tmpQuat.copy(cam.quaternion).invert());
    const scoped = WEAPONS[va.weapon].scope && va.adsT > 0.85;
    // 손에 든 장비가 있으면 총 대신 그 장비
    const held = va.equip ? `gear:${va.equip.kind === 'throw' ? va.equip.id : va.equip.kind}` : null;
    this.viewmodel.update(dt, {
      visible: va.alive && !this.ended && !scoped && !this.droneView && !this.mirrorView,
      weapon: held ?? va.weapon,
      speed: Math.hypot(va.vel.x, va.vel.z),
      velLocal: vel,
      onGround: va.onGround,
      crouch: va.crouch,
      adsT: va.adsT,
      lookDx: va === this.player ? this.controller.lastDx : 0,
      lookDy: va === this.player ? this.controller.lastDy : 0,
      reloadT: va.reloadT,
      swapT: va.swapT,
      lockpick: !!va.lockpick,
      amp: !held && va.ampT > 0 && !WEAPONS[va.weapon].melee,
      inspect: va === this.player && !held ? this.inspectT : 0,
      light: this.stage.bolt,
      day: this.stage.dayLight,
    });
    this.shop.update();
    this.hud.update(dt, {
      viewAgent: va,
      spectating: va !== this.player,
      showMap: this.started && !this.paused && this.input.held('map'),
      wheel: this.wheelDef(),
      shopOpen: this.shop.isOpen,
    });
    const lp = this.player.lockpick;
    this.lockpickUI.update(this.player, lp ? m.bombById(lp.bombId) : null);

    // 체력이 낮을수록 화면 색이 빠지고 붉어지며 소리가 먹먹해지고 심장 소리가 들림
    const hpf = va.alive ? va.hp / 100 : 0;
    const damage = va.alive ? Math.max(0, Math.min(1, (0.6 - hpf) / 0.5)) : 0.7;
    const pulse = 0.5 + 0.5 * Math.sin(time * (5 + damage * 4));
    this.blur = Math.max(0, this.blur - dt * 1.6);
    // 섬광: 하얗게 눈부심(짧게) · 이명: 소리가 먹먹 · 최루: 살짝 흐리고 기침
    const flashed = va.alive ? Math.min(1, (va.flashT ?? 0) / 1.2) : 0;
    const stunned = va.alive ? Math.min(1, (va.stunT ?? 0) / 2.5) : 0;
    const gassed = va.alive && (va.gasT ?? 0) > 0 ? 1 : 0;
    // 제압: 화면 가장자리가 어두워지고 흐려짐 (빠르게 들어오고 천천히 빠짐)
    const suppT = va.alive ? va.suppress ?? 0 : 0;
    this.suppVis = (this.suppVis ?? 0) + (suppT - (this.suppVis ?? 0)) * Math.min(1, dt * (suppT > (this.suppVis ?? 0) ? 14 : 3));
    this.stage.setLens({ damage, pulse, flash: Math.max(this.effects.flash, flashed * 0.92), blur: this.blur + (va.held ? 0.4 : 0) + stunned * 0.35 + gassed * 0.25, supp: this.suppVis });
    this.audio.setMuffle(Math.max(damage * 0.55, this.effects.flash * 0.9, flashed * 0.6, stunned * 0.85));
    if (gassed && this.started && !this.paused) {
      this.coughT = (this.coughT ?? 0.5) - dt;
      if (this.coughT <= 0) {
        this.coughT = 1.6 + Math.random() * 1.2;
        this.audio.play('cough', { vol: va === this.player ? 0.8 : 0.5 });
      }
    }
    if (this.started && !this.paused && va === this.player && va.alive && damage > 0.15) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1.1 - damage * 0.45;
        this.audio.play('heartbeat', { vol: 0.4 + damage * 0.6 });
      }
    }
    // 지구력이 바닥나거나 크게 다치면 숨이 가쁨 (지칠수록·다칠수록 크게, 빠르게)
    const stam = va === this.player && va.alive ? va.stamina ?? 100 : 100;
    const gasp = va === this.player && va.alive && damage > 0.45 ? damage : 0;
    if (this.started && !this.paused && (stam < 30 || va.tired || gasp)) {
      this.breathT = (this.breathT ?? 0) - dt;
      if (this.breathT <= 0) {
        const k = Math.max(va.tired ? 1 : stam < 30 ? 1 - stam / 30 : 0, gasp);
        this.breathT = 1.25 - k * 0.35;
        this.audio.play('breath', { vol: 0.45 + k * 0.55 });
      }
    }
    this.updateTension(dt);
    this.stage.render(dt);
  }

  // 위기 연출: 분대에서 혼자 남으면 '최후의 1인' 알림 + 낮은 긴장음이 몇 초마다 (라운드마다 한 번 알림)
  updateTension(dt) {
    const m = this.match;
    const me = this.player;
    if (!this.started || this.paused || m.phase !== 'live' || !me.alive) return;
    const mates = m.agents.filter((a) => a.team === me.team && a !== me && a.alive).length;
    const foes = m.agents.filter((a) => a.team !== me.team && a.alive).length;
    const alone = mates === 0 && foes > 0 && m.agents.some((a) => a.team === me.team && a !== me);
    const key = `${m.round ?? 0}:${m.liveAt ?? 0}`;
    if (alone && this.lastStandKey !== key) {
      this.lastStandKey = key;
      this.tensionT = 4;
      this.audio.play('lastStand');
      this.hud.banner('최후의 1인', `1 대 ${foes} · 소리를 듣고 움직일 것`, 'warn');
    }
    if (alone && this.lastStandKey === key) {
      this.tensionT -= dt;
      if (this.tensionT <= 0) {
        this.tensionT = 3.2 + Math.random() * 1.5;
        this.audio.play('tension', { vol: 0.7 + Math.min(0.3, foes * 0.08) });
      }
    }
  }

  updateCamera(dt, alpha) {
    const m = this.match;
    let a = this.player;
    if (!a.alive) {
      const mates = m.agents.filter((x) => x.alive && x.team === this.team);
      const pool = mates.length ? mates : m.agents.filter((x) => x.alive);
      a = pool.length ? pool[this.specIndex % pool.length] : a;
    }
    this.viewAgent = a;
    const cam = this.stage.camera;
    // 드론을 조종 중이면 드론 카메라로 (끝나면 시점을 몸으로 되돌림)
    const drone = a.drone ? m.drones.find((d) => d.id === a.drone) : null;
    if (this.wasDrone && !this.player.drone) this.controller.syncFrom(this.player);
    this.wasDrone = !!this.player.drone;
    this.droneView = drone;
    // 문 밑 카메라: 문 건너편 바닥 바로 위에서 광각으로 (끝나면 시점을 몸으로 되돌림)
    if (this.wasMirror && !this.player.mirror) this.controller.syncFrom(this.player);
    this.wasMirror = !!this.player.mirror;
    const mine = a === this.player;
    const mv = a.mirror && a.alive ? m.doors.mirrorView(a, mine ? this.controller.yaw : a.mirror.yaw ?? a.yaw, mine ? this.controller.pitch : a.mirror.pitch ?? 0) : null;
    this.mirrorView = mv;
    if (mv) {
      cam.position.set(mv.pos.x, mv.pos.y, mv.pos.z);
      this.camYaw = mv.yaw;
      this.camPitch = mv.pitch;
      cam.rotation.set(mv.pitch, mv.yaw, 0);
      this.stage.setZoom(0.72);
      this.audio.setListener(eyePos(a), { x: -Math.sin(a.yaw), y: 0, z: -Math.cos(a.yaw) });
      this.audio.setShelter(this.stage.underCover(eyePos(a)));
      return;
    }
    if (drone) {
      const pv = drone.prev ?? drone.pos;
      cam.position.set(pv.x + (drone.pos.x - pv.x) * alpha, pv.y + (drone.pos.y - pv.y) * alpha, pv.z + (drone.pos.z - pv.z) * alpha);
      if (a === this.player) {
        this.camYaw = this.controller.yaw;
        this.camPitch = this.controller.pitch;
      } else {
        this.camYaw = drone.yaw;
        this.camPitch = drone.pitch;
      }
      const lateral = (drone.vel?.x ?? 0) * Math.cos(this.camYaw) - (drone.vel?.z ?? 0) * Math.sin(this.camYaw);
      cam.rotation.set(this.camPitch, this.camYaw, -lateral * 0.03);
      this.stage.setZoom(1);
      this.audio.setListener(cam.position, { x: -Math.sin(this.camYaw), y: 0, z: -Math.cos(this.camYaw) });
      this.audio.setShelter(this.stage.underCover(cam.position));
      return;
    }
    const shakeScale = this.settings.shake ?? 1;
    const eye = eyePos(a);
    const ix = a.prev.x + (a.pos.x - a.prev.x) * alpha;
    const iy = a.prev.y + (a.pos.y - a.prev.y) * alpha;
    const iz = a.prev.z + (a.pos.z - a.prev.z) * alpha;

    // 걸음에 맞춘 머리 흔들림 (바디캠 느낌)
    const speed = Math.hypot(a.vel.x, a.vel.z);
    const moving = a.onGround && speed > 0.4;
    this.bobPhase += dt * (moving ? speed * 2.1 : 0);
    const bobAmp = moving ? Math.min(1, speed / 3.6) * (1 - a.adsT * 0.7) * shakeScale : 0;
    const bobY = -Math.abs(Math.sin(this.bobPhase)) * 0.045 * bobAmp;
    const bobX = Math.cos(this.bobPhase) * 0.025 * bobAmp;
    this.landDip = Math.max(0, this.landDip - dt * 3);
    const right = { x: Math.cos(this.camYaw), z: -Math.sin(this.camYaw) };
    cam.position.set(
      ix + (eye.x - a.pos.x) + right.x * bobX,
      iy + (eye.y - a.pos.y) + (a.lockpick ? -0.45 : 0) + bobY - this.landDip * 0.12 * shakeScale,
      iz + (eye.z - a.pos.z) + right.z * bobX,
    );

    // 반동은 화면에 그대로 (총알은 화면 중앙으로 감)
    if (a === this.player && a.alive) {
      this.camYaw = this.controller.yaw + a.recoilYaw;
      this.camPitch = this.controller.pitch + a.recoil + a.punch;
    } else {
      const k = 1 - Math.exp(-dt * 12);
      let d = a.yaw + a.recoilYaw - this.camYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.camYaw += d * k;
      this.camPitch += (a.pitch + a.recoil + a.punch - this.camPitch) * k;
    }
    // 발사 충격 (스프링으로 금방 돌아옴)
    this.kickVel.addScaledVector(this.kickCam, -260 * dt).multiplyScalar(Math.exp(-dt * 22));
    this.kickCam.addScaledVector(this.kickVel, dt * 10);
    this.rollKickVel += -this.rollKick * 220 * dt;
    this.rollKickVel *= Math.exp(-dt * 18);
    this.rollKick += this.rollKickVel * dt * 10;
    // 손떨림 (가만히 있어도 약간)
    const t = performance.now() / 1000;
    const hand = (0.0025 + bobAmp * 0.003) * shakeScale * (1 - a.adsT * 0.6);
    const swayY = (Math.sin(t * 0.9) + Math.sin(t * 2.3) * 0.5) * hand;
    const swayX = (Math.sin(t * 0.7 + 1) + Math.sin(t * 1.9) * 0.5) * hand;
    // 옆걸음 기울기 + 기울이기
    const lateral = a.vel.x * Math.cos(this.camYaw) - a.vel.z * Math.sin(this.camYaw);
    const rollTarget = (-lateral * 0.006 - (a.lean ?? 0) * 0.16) * shakeScale + Math.sin(this.bobPhase) * 0.004 * bobAmp;
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 8);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = (this.shake * this.shake * 0.03 + this.effects.shake * 0.04) * shakeScale;
    cam.rotation.y = this.camYaw + swayX + this.kickCam.x * shakeScale + (Math.random() - 0.5) * s;
    cam.rotation.x = this.camPitch + swayY + this.kickCam.y * shakeScale + (Math.random() - 0.5) * s;
    cam.rotation.z = this.roll + this.rollKick * shakeScale;
    // 정조준 확대 (부드럽게 당겨짐: 처음과 끝이 느림)
    const zoom = adsZoomAt(a);
    this.stage.setZoom(zoom);
    const fwd = { x: -Math.sin(this.camYaw), y: 0, z: -Math.cos(this.camYaw) };
    this.audio.setListener(cam.position, fwd);
    this.audio.setShelter(this.stage.underCover(cam.position));
  }

  // 드론 프로펠러 소리: 날고 있는 드론마다 계속 (사라지면 끔)
  updateDroneSounds() {
    const live = new Set();
    for (const d of this.match.drones ?? []) {
      const key = `drone${d.id}`;
      live.add(key);
      this.audio.setLoop(key, 'drone', d.pos);
    }
    for (const key of [...(this.audio.loops?.keys() ?? [])]) if (key.startsWith('drone') && !live.has(key)) this.audio.stopLoop(key);
  }

  // 탄창 확인 (T를 누르고 있는 동안): 총을 기울여 탄창을 보고, 화면에 대략적인 양만 표시
  updateInspect(dt) {
    const p = this.player;
    const want = this.input.held('inspect') && p.alive && !p.lockpick && p.reloadT <= 0 && p.swapT <= 0 && p.adsT < 0.3 && !this.controller.wheelOpen;
    if (want && !this.wasInspecting) this.audio.play('inspect');
    this.wasInspecting = want;
    this.inspectT = Math.max(0, Math.min(1, this.inspectT + (want ? 1 : -1) * dt * 3.2));
  }

  sounds(dt) {
    const m = this.match;
    // 발소리는 시뮬레이션의 footstep 이벤트로 재생 (달리면 크게, 걸으면 작게)
    // 폭탄 경고음 (시간이 적을수록 빠르게)
    if (m.phase === 'live') {
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = m.timeLeft < 10 ? 0.35 : m.timeLeft < 30 ? 0.8 : 1.6;
        for (const b of m.bombs) if (b.state === 'armed') this.audio.play('beep', { pos: { x: b.x, y: 0.8, z: b.z } });
      }
    }
  }

  // ───────────── 온라인 ─────────────
  // 참가자: 방장 상태 받기. 방장이 사라지거나 다른 판을 시작했으면 끝냄
  netReceive(now) {
    const host = this.net.session.host();
    if (!host || host.start?.id !== this.net.start.id) {
      this.netLostT = (this.netLostT ?? 0) + 1;
      if (this.netLostT > 180 && !this.ended) this.netAbort('방장과의 연결이 끊겼습니다.');
      return;
    }
    this.netLostT = 0;
    if (host.g) this.clientSync.apply(host.g, now / 1000);
  }

  // 방장: 초당 20번 상태 올리기 · 나간 사람은 봇이 대신 / 참가자: 초당 30번 입력 올리기
  netSend(dt) {
    const s = this.net.session;
    this.netT -= dt;
    if (this.netT > 0) return;
    if (this.hostSync) {
      this.netT = 0.05;
      this.netN++;
      s.set({ g: this.hostSync.snapshot({ withStats: this.netN % 10 === 0 }) });
      this.netCheckT -= 0.05;
      if (this.netCheckT <= 0) {
        this.netCheckT = 1;
        this.takeOverLeavers();
      }
    } else if (this.recorder?.latest) {
      this.netT = 1 / 30;
      s.set({ in: this.recorder.latest });
    }
  }

  takeOverLeavers() {
    const m = this.match;
    m.agents.forEach((a) => {
      if (!a.human) return;
      const key = this.keys.get(a.id);
      if (!this.net.session.gone(key)) return;
      a.human = false;
      const index = m.agents.filter((x) => x.team === a.team).indexOf(a);
      m.setController(a.id, new BotBrain(a, m, this.net.start.diff, index));
      m.radio(a, '연결 끊김 — 봇이 대신함', { kind: 'lost' });
    });
  }

  netAbort(text) {
    this.netOver = true;
    this.hooks.onToast?.(text);
    this.hooks.onAbort?.();
  }

  // 프레임 유지: 2초마다 평균 프레임을 보고 해상도를 먼저 조절하고,
  // 해상도를 끝까지 낮춰도 30fps가 안 되면 (그래픽 '자동'일 때) 품질을 한 단계 내림
  watchPerformance(dt) {
    const p = this.perf;
    if (p.done) return;
    p.t += dt;
    p.frames++;
    p.sum += dt;
    if (p.t < 2) return;
    const fps = p.frames / p.sum;
    p.t = p.frames = p.sum = 0;
    if (p.warm-- > 0) return; // 첫 구간은 셰이더 준비 때문에 느림
    const st = this.stage;
    p.holdT -= 2;
    if (fps < 52) {
      if (st.setRenderScale(st.renderScale * (fps < 35 ? 0.8 : 0.9))) {
        p.holdT = 20; // 방금 내렸으면 한동안 다시 올리지 않음
        return;
      }
      const i = QUALITY_ORDER.indexOf(st.qualityKey);
      if (fps < 30 && st.qualityMode === 'auto' && i > 0) {
        const next = QUALITY_ORDER[i - 1];
        st.autoLevel = next;
        st.setLevel(next);
        this.audio.setLowPower(next === 'low');
        p.warm = 1;
        this.hooks.onToast?.(`프레임 저하 감지. 그래픽을 '${QUALITY[next].name}'(으)로 자동 조정했습니다.`);
      }
    } else if (fps > 58 && st.renderScale < 1 && p.holdT <= 0) {
      st.setRenderScale(st.renderScale + 0.1);
      p.holdT = 4;
    }
  }

  // 개념을 써서 문제를 풂 → 숙달도 +1 (새로 숙달하면 알림)
  studied(conceptId, how) {
    if (!conceptId) return;
    if (recordUse(conceptId)) this.masteredBanner(conceptId);
    else this.hud.radio({ name: '교범', text: `${how} 해결 · ${CONCEPT_BY_ID[conceptId]?.name ?? ''} 숙달도 ${masteryOf(conceptId)}/${MASTERY.need}`, kind: 'order' });
  }

  masteredBanner(conceptId) {
    if (!this.study.mastered.includes(conceptId)) this.study.mastered.push(conceptId);
    const patches = Object.entries(PATCH_CONCEPT).filter(([, c]) => c === conceptId).map(([p]) => PATCHES[p]?.name).filter(Boolean);
    const lock = Object.values(PUZZLE_INFO).find((p) => p.concept === conceptId);
    const gain = patches.length
      ? `다음 경기부터 ${patches.join('·')} 재사용 대기 −${Math.round((1 - MASTERY.cooldownMult) * 100)}%`
      : lock ? `다음 경기부터 ${lock.title}은 계산 결과 표시 · 빠른 해체` : '도감에 숙달로 기록';
    this.hud.banner(`개념 숙달 · ${CONCEPT_BY_ID[conceptId]?.name ?? ''}`, gain, 'good');
  }

  // 키 바꾸기 뒤 화면 안내를 새 키로
  refreshKeys() {
    this.hud.refreshKeys();
    this.shop.refreshKeys?.();
  }

  dispose() {
    this.disposed = true;
    this.hostSync?.dispose();
    if (this.net) this.net.session.set({ in: null, ...(this.hostSync && this.match.phase !== 'ended' ? { g: null } : {}) });
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('mousedown', this.onMouseNav);
    window.removeEventListener('mouseup', this.onMouseNav);
    navigator.keyboard?.unlock?.();
    this.input.exitLock();
    this.input.dispose();
    this.match.events.clear();
    for (const v of this.views.values()) {
      this.stage.scene.remove(v.root);
      v.dispose();
    }
    this.effects.dispose();
    this.gearView.dispose();
    this.conceptCards.dispose();
    this.devicesView.dispose();
    this.doorsView.dispose();
    this.opView?.dispose();
    this.stage.overlay = null;
    this.stage.onThunder = null;
    this.stage.setZoom(1);
    this.stage.setLens({});
    this.audio.setMuffle(0);
    this.audio.stopAmbience();
    this.audio.stopAllLoops();
    this.hud.dispose();
    this.shop.dispose();
    this.lockpickUI.dispose();
  }
}
