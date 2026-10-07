import * as THREE from 'three';
import { attachBots } from '../ai/bot.js';
import { eyePos } from '../sim/agent.js';
import { DT, TEAMS } from '../sim/constants.js';
import { PATCHES, WEAPONS } from '../sim/data.js';
import { Match } from '../sim/match.js';
import { Hud } from '../ui/hud.js';
import { LockpickUI } from '../ui/lockpick-ui.js';
import { AgentView } from './agent-view.js';
import { Effects } from './effects.js';
import { Input, PlayerController } from './input.js';
import { ViewModel } from './viewmodel.js';
import { QUALITY } from './stage.js';

const PATCH_SOUNDS = {
  gravityVeil: 'veil', elasticPad: 'pad', resultantAmp: 'amp', reactionRounds: 'rounds', buoyShield: 'shield',
  frictionZero: 'friction', elasticNet: 'net', weightScanner: 'scanner',
  gravityCollapse: 'collapse', resultantSurge: 'surge', frictionStorm: 'storm',
};

// 한 경기를 화면에 연결: 시뮬레이션 + 3D + 소리 + HUD
export class GameClient {
  constructor({ stage, audio, settings, uiRoot, team, difficulty, loadouts, seed = Date.now(), hooks = {} }) {
    this.stage = stage;
    this.audio = audio;
    this.settings = settings;
    this.uiRoot = uiRoot;
    this.hooks = hooks;
    this.team = team;

    this.match = new Match({ playerTeam: team, playerName: settings.name || '나', loadouts, seed });
    attachBots(this.match, difficulty);
    this.player = this.match.player;

    this.input = new Input(stage.container);
    this.input.enabled = true;
    this.controller = new PlayerController(this.input, settings);
    this.controller.zoomOf = (a) => WEAPONS[a.weapon].adsZoom ?? 1;
    this.controller.syncFrom(this.player);
    this.match.setController(this.player.id, this.controller);
    this.input.onLockChange = (locked, info) => this.onLockChange(locked, info);

    this.views = new Map();
    for (const a of this.match.agents) {
      const v = new AgentView(a, { showTag: a.team === team && !a.isPlayer });
      stage.scene.add(v.root);
      this.views.set(a.id, v);
    }
    this.viewmodel = new ViewModel(team);
    stage.overlay = this.viewmodel;
    stage.resize();
    this.effects = new Effects(stage.scene, this.match);
    this.effects.onCasingBounce = (p) => this.audio.play('casing', { pos: p });
    this.hud = new Hud(uiRoot, this.match, this.player.id);
    this.lockpickUI = new LockpickUI(uiRoot);
    this.lockpickUI.onCard = (i) => this.controller.queue.cards.push(i);

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
    this.bobPhase = 0;
    this.roll = 0;
    this.landDip = 0;
    this.blur = 0;
    this.stepDist = new Map();
    this.beepT = 0;
    this.heartT = 0;
    this.alertT = { A: -99, B: -99 };
    this.caughtT = 0;
    this.perf = { t: 0, frames: 0, sum: 0, done: false };
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.bindEvents();

    this.onKeyDown = (e) => {
      if (e.code === 'Escape' && this.input.fallback && this.started && !this.paused && !this.ended) this.pause();
      if (e.code === 'Tab') {
        e.preventDefault();
        if (this.started) this.hooks.onScoreboard?.(true, this.match);
      }
    };
    this.onKeyUp = (e) => {
      if (e.code === 'Tab') this.hooks.onScoreboard?.(false, this.match);
    };
    // 경기 중 실수로 탭을 닫지 않게 (예: Ctrl을 누른 채 W)
    this.onBeforeUnload = (e) => {
      if (this.started && !this.ended) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('beforeunload', this.onBeforeUnload);

    this.raf = requestAnimationFrame((t) => this.frame(t));
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

    ev.on('shot', (e) => {
      const local = viewing(e.agent) && e.agent.alive;
      const cam = this.stage.camera;
      const muzzle = local ? this.viewmodel.muzzleWorld(cam, this.tmp.set(0, 0, 0)) : this.views.get(e.agent.id).muzzleWorld(this.tmp);
      const port = local ? this.viewmodel.portWorld(cam, this.tmp2.set(0, 0, 0)) : null;
      this.effects.onShot(e, muzzle.clone(), local, port?.clone(), cam);
      if (local) {
        this.viewmodel.shot(e.agent.adsT > 0.5);
        // 발사마다 카메라에 짧은 충격
        this.kickVel.x += (Math.random() - 0.5) * 0.02;
        this.kickVel.y += 0.03 + Math.random() * 0.01;
      }
      A.play(e.weapon, { pos: local ? null : e.origin });
      if (e.amp && local) A.play('ampShot');
    });
    ev.on('melee', (e) => {
      if (viewing(e.agent)) this.viewmodel.swing(e.heavy);
      A.play('knife', { pos: viewing(e.agent) ? null : e.agent.pos });
      if (e.target) A.play('knifeHit', { pos: e.target.pos });
    });
    ev.on('impact', (e) => {
      this.effects.onImpact(e);
      if (e.kind === 'shield') A.play('shieldHit', { pos: e });
    });
    ev.on('ricochet', (e) => {
      this.effects.onRicochet(e);
      A.play('ricochet', { pos: e });
    });
    ev.on('hit', (e) => {
      this.views.get(e.target.id)?.hit();
      if (isMe(e.attacker)) {
        this.hud.hitMarker(e.headshot, e.killed);
        A.play(e.headshot ? 'headshot' : 'hit');
      }
      if (viewing(e.target)) {
        if (isMe(e.target)) A.play('hurt');
        this.shake = Math.min(1, this.shake + (e.headshot ? 0.6 : 0.3));
        this.blur = Math.min(1, this.blur + e.amount / 60);
        if (e.headshot && isMe(e.target)) A.play('ring');
        if (e.attacker) {
          const dx = e.attacker.pos.x - e.target.pos.x, dz = e.attacker.pos.z - e.target.pos.z;
          this.hud.damageFrom(-(Math.atan2(-dx, -dz) - this.camYaw));
        }
      }
    });
    ev.on('kill', (e) => {
      this.hud.killfeed(e.killer, e.victim, e.weapon, e.headshot);
      if (isMe(e.killer) && !isMe(e.victim)) A.play('kill');
      if (isMe(e.victim)) {
        A.play('death');
        this.hud.banner('전투 불능', `${e.killer ? `${e.killer.name}에게 제압됨` : ''} · 아군 시점으로 전환`, 'bad');
      }
    });
    ev.on('patch', (e) => {
      this.effects.onPatch(e);
      const pos = e.zone ? { x: e.zone.x, y: e.zone.y, z: e.zone.z } : { x: e.agent.pos.x, y: e.agent.pos.y + 1, z: e.agent.pos.z };
      A.play(PATCH_SOUNDS[e.patchId], { pos: isMe(e.agent) && !e.zone ? null : pos });
      if (isMe(e.agent)) this.hud.concept(e.patchId);
      if (e.patchId === 'weightScanner' && e.agent.team === this.team) this.hud.banner('무게 감지', `적 ${e.revealed.length}명 탐지 · 4초간 위치 표시`, 'warn');
      if (e.patchId === 'resultantSurge' && e.agent.team === this.team) this.hud.banner('합력 폭주', '분대 전원 소총 공격력 +3 · 8초', 'good');
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
      if (e.reason === 'hit' || e.reason === 'captured') {
        A.play('lockFail');
        this.hud.banner('해체 중단', e.reason === 'hit' ? '피격. 처음부터 재시도.' : '구속됨. 처음부터 재시도.', 'bad');
      }
    });
    ev.on('bombDefused', (e) => {
      A.play('defused');
      const left = this.match.bombs.filter((b) => b.state === 'armed').length;
      this.hud.banner(`폭탄 ${e.bomb.id} 해체 완료`, `${e.agent.name} · ${left ? `잔여 폭탄 ${left}기` : '전 폭탄 해체'}`, this.team === TEAMS.DEFUSE ? 'good' : 'bad');
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
      this.hud.banner('작전 개시', this.team === TEAMS.DEFUSE ? '목표: 폭탄 2기 해체' : '목표: 폭탄 방어 · 해체팀 제압', 'good');
    });
    ev.on('forceWiped', () => this.hud.banner('포스팀 전원 제압', '잔여 폭탄 해체 시 작전 완료', this.team === TEAMS.DEFUSE ? 'good' : 'bad'));
    ev.on('reload', (e) => viewing(e.agent) && A.play('reload'));
    ev.on('swap', (e) => viewing(e.agent) && A.play('swap'));
    ev.on('dryFire', (e) => isMe(e.agent) && A.play('dry'));
    ev.on('land', (e) => {
      if (viewing(e.agent)) {
        this.viewmodel.landed(e.speed);
        this.landDip = Math.min(1, e.speed / 9);
      }
      A.play('land', { pos: viewing(e.agent) ? null : e.agent.pos, vol: Math.min(1, e.speed / 10) });
    });
    ev.on('matchEnd', (e) => {
      this.ended = true;
      A.play(e.winner === this.team ? 'win' : 'lose');
      this.lockpickUI.update(null);
      setTimeout(() => {
        if (this.disposed) return;
        this.input.exitLock();
        this.hooks.onEnd?.(this.result());
      }, 3200);
    });
  }

  result() {
    const m = this.match;
    return { match: m, winner: m.winner, reason: m.reason, team: this.team, player: this.player };
  }

  // ───────────── 매 프레임 ─────────────
  frame(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const m = this.match;

    const pressed = this.input.pressed.slice();
    this.controller.frame(this.player);
    if (this.started && !this.paused) {
      if (!this.player.alive && pressed.includes('Mouse0')) this.specIndex++;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 6) {
        m.tick(DT);
        this.acc -= DT;
        steps++;
      }
      if (steps === 6) this.acc = 0;
      this.caughtT -= dt;
      this.sounds(dt);
      this.watchPerformance(dt);
    }
    const alpha = this.started && !this.paused ? Math.min(1, this.acc / DT) : 1;
    this.updateCamera(dt, alpha);

    const time = now / 1000;
    for (const v of this.views.values()) {
      v.update(dt, alpha, time);
      v.root.visible = !(v.agent.id === this.viewAgent?.id && v.agent.alive);
    }
    this.effects.update(dt, alpha, this.team);
    const va = this.viewAgent ?? this.player;
    const cam = this.stage.camera;
    const vel = new THREE.Vector3(va.vel.x, va.vel.y, va.vel.z).applyQuaternion(cam.quaternion.clone().invert());
    this.viewmodel.update(dt, {
      visible: va.alive && !this.ended,
      weapon: va.weapon,
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
      amp: va.ampT > 0 && va.weapon === 'rifle',
    });
    this.hud.update(dt, { viewAgent: va, spectating: va !== this.player });
    const lp = this.player.lockpick;
    this.lockpickUI.update(this.player, lp ? m.bombById(lp.bombId) : null);

    // 체력이 낮을수록 화면 색이 빠지고 붉어지며 소리가 먹먹해지고 심장 소리가 들림
    const hpf = va.alive ? va.hp / 100 : 0;
    const damage = va.alive ? Math.max(0, Math.min(1, (0.6 - hpf) / 0.5)) : 0.7;
    const pulse = 0.5 + 0.5 * Math.sin(time * (5 + damage * 4));
    this.blur = Math.max(0, this.blur - dt * 1.6);
    this.stage.setLens({ damage, pulse, flash: this.effects.flash, blur: this.blur + (va.held ? 0.4 : 0) });
    this.audio.setMuffle(Math.max(damage * 0.55, this.effects.flash * 0.9));
    if (this.started && !this.paused && va === this.player && va.alive && damage > 0.15) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1.1 - damage * 0.45;
        this.audio.play('heartbeat', { vol: 0.4 + damage * 0.6 });
      }
    }
    this.stage.render(dt);
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
    const shakeScale = this.settings.shake ?? 1;
    const eye = eyePos(a);
    const ix = a.prev.x + (a.pos.x - a.prev.x) * alpha;
    const iy = a.prev.y + (a.pos.y - a.prev.y) * alpha;
    const iz = a.prev.z + (a.pos.z - a.prev.z) * alpha;

    // 걸음에 맞춘 머리 흔들림 (바디캠 느낌)
    const speed = Math.hypot(a.vel.x, a.vel.z);
    const moving = a.onGround && speed > 0.4;
    this.bobPhase += dt * (moving ? speed * 2.1 : 0);
    const bobAmp = moving ? Math.min(1, speed / 5) * (1 - a.adsT * 0.7) * shakeScale : 0;
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
    cam.rotation.z = this.roll;
    // 정조준 확대
    const zoom = 1 + (a.adsT ?? 0) * ((WEAPONS[a.weapon].adsZoom ?? 1) - 1);
    this.stage.setZoom(zoom);
    const fwd = { x: -Math.sin(this.camYaw), y: 0, z: -Math.cos(this.camYaw) };
    this.audio.setListener(cam.position, fwd);
  }

  sounds(dt) {
    const m = this.match;
    // 발소리 (Shift로 걷거나 앉으면 조용함)
    for (const a of m.agents) {
      if (!a.alive || !a.onGround) continue;
      const sp = Math.hypot(a.vel.x, a.vel.z);
      if (sp < 3.2) {
        this.stepDist.set(a.id, 0);
        continue;
      }
      const d = (this.stepDist.get(a.id) ?? 0) + sp * dt;
      if (d > 1.9) {
        const me = a.id === this.viewAgent?.id;
        this.audio.play('step', { pos: me ? null : a.pos, vol: me ? 0.45 : 1 });
        this.stepDist.set(a.id, 0);
      } else this.stepDist.set(a.id, d);
    }
    // 폭탄 경고음 (시간이 적을수록 빠르게)
    if (m.phase === 'live') {
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = m.timeLeft < 10 ? 0.35 : m.timeLeft < 30 ? 0.8 : 1.6;
        for (const b of m.bombs) if (b.state === 'armed') this.audio.play('beep', { pos: { x: b.x, y: 0.8, z: b.z } });
      }
    }
  }

  watchPerformance(dt) {
    const p = this.perf;
    if (p.done) return;
    p.t += dt;
    if (p.t < 1.5) return;
    p.frames++;
    p.sum += dt;
    if (p.t > 6) {
      p.done = true;
      const fps = p.frames / p.sum;
      const order = ['high', 'medium', 'low'];
      const i = order.indexOf(this.stage.qualityKey);
      if (fps < 38 && i >= 0 && i < order.length - 1) {
        const next = order[i + 1];
        this.settings.quality = next;
        this.stage.applyQuality(next);
        this.hooks.onQualityChange?.(next);
        this.hooks.onToast?.(`프레임 저하 감지. 그래픽 품질 '${QUALITY[next].name}'(으)로 조정. 설정에서 변경 가능.`);
      }
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    navigator.keyboard?.unlock?.();
    this.input.exitLock();
    this.input.dispose();
    this.match.events.clear();
    for (const v of this.views.values()) {
      this.stage.scene.remove(v.root);
      v.dispose();
    }
    this.effects.dispose();
    this.stage.overlay = null;
    this.stage.setZoom(1);
    this.stage.setLens({});
    this.audio.setMuffle(0);
    this.hud.dispose();
    this.lockpickUI.dispose();
  }
}
