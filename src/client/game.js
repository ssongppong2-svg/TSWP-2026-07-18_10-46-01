import * as THREE from 'three';
import { attachBots } from '../ai/bot.js';
import { DT, PLAYER, TEAM_INFO, TEAMS } from '../sim/constants.js';
import { PATCHES } from '../sim/data.js';
import { Match } from '../sim/match.js';
import { Hud } from '../ui/hud.js';
import { LockpickUI } from '../ui/lockpick-ui.js';
import { AgentView } from './agent-view.js';
import { Effects } from './effects.js';
import { Input, PlayerController } from './input.js';
import { ViewModel } from './viewmodel.js';
import { QUALITY } from './stage.js';

const PATCH_SOUNDS = { gravityVeil: 'veil', elasticPad: 'pad', resultantAmp: 'amp', frictionZero: 'friction', gravityCollapse: 'collapse' };

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
    this.controller.syncFrom(this.player);
    this.match.setController(this.player.id, this.controller);
    this.input.onLockChange = (locked, info) => this.onLockChange(locked, info);

    this.views = new Map();
    for (const a of this.match.agents) {
      const v = new AgentView(a, { showTag: a.team === team && !a.isPlayer });
      stage.scene.add(v.root);
      this.views.set(a.id, v);
    }
    this.viewmodel = new ViewModel(TEAM_INFO[team].color);
    stage.overlay = this.viewmodel;
    stage.resize();
    this.effects = new Effects(stage.scene, this.match);
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
    this.stepDist = new Map();
    this.beepT = 0;
    this.alertT = { A: -99, B: -99 };
    this.caughtT = 0;
    this.perf = { t: 0, frames: 0, sum: 0, done: false };
    this.tmp = new THREE.Vector3();
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
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ───────────── 시작·일시정지 ─────────────
  requestStart() {
    this.audio.unlock();
    this.input.requestLock();
  }

  onLockChange(locked, info) {
    if (this.ended) return;
    if (locked) {
      if (!this.started) {
        this.started = true;
        this.hooks.onStarted?.();
        if (this.input.fallback) this.hooks.onToast?.('이 화면에서는 마우스 잠금이 안 돼서 제한 모드로 실행해요. 새 창이나 전체 화면에서 더 편하게 할 수 있어요.');
      }
      if (this.paused) {
        this.paused = false;
        this.input.enabled = true;
        this.hooks.onResume?.();
      }
      this.last = performance.now();
    } else if (info?.error && !info.fallback) {
      this.hooks.onToast?.('잠시 후 다시 클릭해 주세요.');
    } else if (this.started && !this.paused) {
      this.pause();
    }
  }

  pause() {
    if (this.ended) return;
    this.paused = true;
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
    const listener = () => this.stage.camera.position;
    const isMe = (a) => a?.id === this.player.id;
    const viewing = (a) => a?.id === this.viewAgent?.id;

    ev.on('shot', (e) => {
      const local = viewing(e.agent) && e.agent.alive;
      const muzzle = local ? this.viewmodel.muzzleWorld(this.stage.camera, this.tmp.set(0, 0, 0)) : this.views.get(e.agent.id).muzzleWorld(this.tmp);
      this.effects.onShot(e, muzzle.clone(), local);
      if (local) this.viewmodel.shot();
      A.play(e.weapon, { pos: local ? null : e.origin, listener: listener() });
      if (e.amp && local) A.play('ampShot');
    });
    ev.on('impact', (e) => this.effects.onImpact(e));
    ev.on('hit', (e) => {
      this.views.get(e.target.id)?.hit();
      if (isMe(e.attacker)) {
        this.hud.hitMarker(e.headshot, e.killed);
        A.play(e.headshot ? 'headshot' : 'hit');
      }
      if (viewing(e.target)) {
        if (isMe(e.target)) A.play('hurt');
        this.shake = Math.min(1, this.shake + 0.35);
        if (e.attacker) {
          const dx = e.attacker.pos.x - e.target.pos.x, dz = e.attacker.pos.z - e.target.pos.z;
          const ang = Math.atan2(-dx, -dz) - this.camYaw;
          this.hud.damageFrom(-ang);
        }
      }
    });
    ev.on('kill', (e) => {
      this.hud.killfeed(e.killer, e.victim, e.weapon, e.headshot);
      if (isMe(e.killer) && !isMe(e.victim)) A.play('kill');
      if (isMe(e.victim)) {
        A.play('death');
        const by = e.killer ? `${e.killer.name}에게 당했어요` : '';
        this.hud.banner('쓰러졌어요', `${by} · 동료를 관전합니다`, 'bad');
      }
    });
    ev.on('patch', (e) => {
      this.effects.onPatch(e);
      const pos = e.zone ? { x: e.zone.x, y: e.zone.y, z: e.zone.z } : { x: e.agent.pos.x, y: e.agent.pos.y + 1, z: e.agent.pos.z };
      A.play(PATCH_SOUNDS[e.patchId], { pos: isMe(e.agent) && !e.zone ? null : pos, listener: listener() });
      if (isMe(e.agent)) this.hud.concept(e.patchId);
    });
    ev.on('patchDenied', (e) => {
      if (isMe(e.agent)) {
        A.play('denied');
        const def = PATCHES[e.agent.patches[e.slot].id];
        this.hud.banner(def.name, e.reason === 'gauge' ? '필살 게이지가 아직 다 차지 않았어요' : '아직 다시 쓸 수 없어요', 'small');
      }
    });
    ev.on('captured', (e) => {
      if (isMe(e.agent)) A.play('captured');
    });
    ev.on('projectileCaught', (e) => {
      if (this.caughtT > 0) return;
      this.caughtT = 0.08;
      A.play('caught', { pos: e.projectile.pos, listener: listener() });
    });
    ev.on('lockpickStart', (e) => {
      if (isMe(e.agent)) return;
      if (this.team === TEAMS.FORCE && this.match.time - this.alertT[e.bomb.id] > 5) {
        this.alertT[e.bomb.id] = this.match.time;
        this.hud.banner(`⚠ 폭탄 ${e.bomb.id} 락픽 감지!`, '해체팀이 자물쇠를 풀고 있어요. 막으세요!', 'warn');
        A.play('alert');
      }
    });
    ev.on('lockpickCard', (e) => isMe(e.agent) && A.play('card'));
    ev.on('lockpickMatch', (e) => isMe(e.agent) && A.play('match'));
    ev.on('lockpickEnd', (e) => {
      if (!isMe(e.agent)) return;
      if (e.reason === 'hit' || e.reason === 'captured') {
        A.play('lockFail');
        this.hud.banner('락픽 실패!', e.reason === 'hit' ? '총에 맞아서 처음부터 다시 해야 해요' : '중력 붕괴에 붙잡혔어요', 'bad');
      }
    });
    ev.on('bombDefused', (e) => {
      A.play('defused');
      const left = this.match.bombs.filter((b) => b.state === 'armed').length;
      this.hud.banner(`폭탄 ${e.bomb.id} 해체 완료!`, `${e.agent.name} · ${left ? `남은 폭탄 ${left}개` : '모든 폭탄 해체!'}`, this.team === TEAMS.DEFUSE ? 'good' : 'bad');
    });
    ev.on('explode', () => {
      this.effects.onExplode();
      A.play('explosion');
      this.shake = 1.4;
    });
    ev.on('timeWarning', (e) => {
      A.play('tick');
      this.hud.banner(`${e.left}초 남음`, e.left <= 10 ? '폭탄이 곧 터져요!' : '', 'warn');
    });
    ev.on('roundStart', () => {
      A.play('roundStart');
      this.hud.banner('라운드 시작!', TEAM_INFO[this.team].goal, 'good');
    });
    ev.on('forceWiped', () => this.hud.banner('포스팀 전멸!', '남은 폭탄을 모두 해체해야 이겨요', this.team === TEAMS.DEFUSE ? 'good' : 'bad'));
    ev.on('reload', (e) => viewing(e.agent) && A.play('reload'));
    ev.on('swap', (e) => viewing(e.agent) && A.play('swap'));
    ev.on('dryFire', (e) => isMe(e.agent) && A.play('dry'));
    ev.on('land', (e) => {
      if (viewing(e.agent)) this.viewmodel.landed(e.speed);
      A.play('land', { pos: viewing(e.agent) ? null : e.agent.pos, listener: listener(), vol: Math.min(1, e.speed / 10) });
    });
    ev.on('matchEnd', (e) => {
      this.ended = true;
      A.play(e.winner === this.team ? 'win' : 'lose');
      this.lockpickUI.update(null);
      setTimeout(() => {
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
    this.effects.update(dt, alpha);
    const va = this.viewAgent ?? this.player;
    this.viewmodel.update(dt, {
      visible: va.alive && !this.ended,
      weapon: va.weapon,
      speed: Math.hypot(va.vel.x, va.vel.z),
      onGround: va.onGround,
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
    this.stage.render();
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
    const eyeY = a.lockpick ? PLAYER.eye - 0.5 : PLAYER.eye;
    cam.position.set(
      a.prev.x + (a.pos.x - a.prev.x) * alpha,
      a.prev.y + (a.pos.y - a.prev.y) * alpha + eyeY,
      a.prev.z + (a.pos.z - a.prev.z) * alpha,
    );
    if (a === this.player && a.alive) {
      this.camYaw = this.controller.yaw;
      this.camPitch = this.controller.pitch + a.recoil * 0.6;
    } else {
      const k = 1 - Math.exp(-dt * 12);
      let d = a.yaw - this.camYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.camYaw += d * k;
      this.camPitch += (a.pitch + a.recoil * 0.6 - this.camPitch) * k;
    }
    this.shake = Math.max(0, this.shake - dt * 2.5) ;
    const s = this.shake * this.shake * 0.04 + this.effects.shake * 0.05;
    cam.rotation.y = this.camYaw + (Math.random() - 0.5) * s;
    cam.rotation.x = this.camPitch + (Math.random() - 0.5) * s;
    cam.rotation.z = 0;
    const fwd = { x: -Math.sin(this.camYaw), y: 0, z: -Math.cos(this.camYaw) };
    this.audio.setListener(cam.position, fwd);
  }

  sounds(dt) {
    const m = this.match;
    const cam = this.stage.camera.position;
    // 발소리 (Shift로 걸으면 조용함)
    for (const a of m.agents) {
      if (!a.alive || !a.onGround) continue;
      const sp = Math.hypot(a.vel.x, a.vel.z);
      if (sp < 4) {
        this.stepDist.set(a.id, 0);
        continue;
      }
      const d = (this.stepDist.get(a.id) ?? 0) + sp * dt;
      if (d > 2.3) {
        const me = a.id === this.viewAgent?.id;
        this.audio.play('step', { pos: me ? null : a.pos, vol: me ? 0.45 : 1, listener: cam });
        this.stepDist.set(a.id, 0);
      } else this.stepDist.set(a.id, d);
    }
    // 폭탄 삑삑 소리 (시간이 적을수록 빠르게)
    if (m.phase === 'live') {
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = m.timeLeft < 10 ? 0.35 : m.timeLeft < 30 ? 0.8 : 1.6;
        for (const b of m.bombs) if (b.state === 'armed') this.audio.play('beep', { pos: { x: b.x, y: 0.8, z: b.z }, listener: cam });
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
        this.hooks.onToast?.(`화면이 조금 느려서 그래픽 품질을 '${QUALITY[next].name}'으로 낮췄어요. 설정에서 바꿀 수 있어요.`);
      }
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.input.exitLock();
    this.input.dispose();
    this.match.events.clear();
    for (const v of this.views.values()) {
      this.stage.scene.remove(v.root);
      v.dispose();
    }
    this.effects.dispose();
    this.stage.overlay = null;
    this.hud.dispose();
    this.lockpickUI.dispose();
  }
}
