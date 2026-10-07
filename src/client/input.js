import { emptyIntent } from '../sim/agent.js';

// 키보드·마우스 입력. event.code를 써서 한글 자판 상태에서도 WASD가 그대로 동작합니다.
export class Input {
  constructor(target) {
    this.target = target;
    this.down = new Set();
    this.pressed = [];
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.buttons = 0;
    this.wheel = 0;
    this.locked = false;
    this.everLocked = false;
    this.lockedAt = 0;
    this.fallback = false; // 마우스 잠금이 막힌 환경에서 쓰는 모드
    this.enabled = false;
    this.onLockChange = null;

    this.handlers = {
      keydown: (e) => {
        if (!this.enabled) return;
        if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
        if (!this.down.has(e.code)) this.pressed.push(e.code);
        this.down.add(e.code);
      },
      keyup: (e) => this.down.delete(e.code),
      mousemove: (e) => {
        if (!this.enabled || (!this.locked && !this.fallback)) return;
        // 잠금 직후나 브라우저 버그로 생기는 비정상적으로 큰 이동값은 버림 (시점이 갑자기 튀는 것 방지)
        if (performance.now() - this.lockedAt < 120) return;
        const dx = e.movementX || 0, dy = e.movementY || 0;
        if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
        this.mouseDx += dx;
        this.mouseDy += dy;
      },
      mousedown: (e) => {
        if (!this.enabled) return;
        if (this.locked || this.fallback) {
          this.buttons |= 1 << e.button;
          this.pressed.push(`Mouse${e.button}`);
        }
      },
      mouseup: (e) => (this.buttons &= ~(1 << e.button)),
      wheel: (e) => {
        if (this.enabled && (this.locked || this.fallback)) this.wheel += Math.sign(e.deltaY);
      },
      blur: () => {
        this.down.clear();
        this.buttons = 0;
      },
      lockchange: () => {
        this.locked = document.pointerLockElement === this.target;
        if (this.locked) {
          this.everLocked = true;
          this.lockedAt = performance.now();
          this.mouseDx = this.mouseDy = 0;
        }
        if (!this.locked) {
          this.down.clear();
          this.buttons = 0;
        }
        this.onLockChange?.(this.locked);
      },
      lockerror: () => {
        // 한 번도 잠긴 적이 없으면 이 환경에선 잠금이 막힌 것 → 제한 모드로 진행
        // (Esc 직후 다시 잠그려다 실패한 경우는 잠시 뒤 다시 클릭하면 됨)
        if (!this.everLocked) this.fallback = true;
        this.onLockChange?.(this.fallback, { error: true, fallback: this.fallback });
      },
      contextmenu: (e) => e.preventDefault(),
    };
    window.addEventListener('keydown', this.handlers.keydown);
    window.addEventListener('keyup', this.handlers.keyup);
    window.addEventListener('mousemove', this.handlers.mousemove);
    window.addEventListener('mousedown', this.handlers.mousedown);
    window.addEventListener('mouseup', this.handlers.mouseup);
    window.addEventListener('wheel', this.handlers.wheel, { passive: true });
    window.addEventListener('blur', this.handlers.blur);
    document.addEventListener('pointerlockchange', this.handlers.lockchange);
    document.addEventListener('pointerlockerror', this.handlers.lockerror);
    target.addEventListener('contextmenu', this.handlers.contextmenu);
  }

  requestLock() {
    if (this.fallback) {
      this.onLockChange?.(true);
      return;
    }
    if (!this.target.requestPointerLock) {
      this.handlers.lockerror();
      return;
    }
    try {
      this.target.requestPointerLock()?.catch?.(() => {});
    } catch {
      this.handlers.lockerror();
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get active() {
    return this.enabled && (this.locked || this.fallback);
  }

  isDown(code) {
    return this.down.has(code);
  }

  takeMouse() {
    const d = { dx: this.mouseDx, dy: this.mouseDy };
    this.mouseDx = this.mouseDy = 0;
    return d;
  }

  takePressed() {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  dispose() {
    window.removeEventListener('keydown', this.handlers.keydown);
    window.removeEventListener('keyup', this.handlers.keyup);
    window.removeEventListener('mousemove', this.handlers.mousemove);
    window.removeEventListener('mousedown', this.handlers.mousedown);
    window.removeEventListener('mouseup', this.handlers.mouseup);
    window.removeEventListener('wheel', this.handlers.wheel);
    window.removeEventListener('blur', this.handlers.blur);
    document.removeEventListener('pointerlockchange', this.handlers.lockchange);
    document.removeEventListener('pointerlockerror', this.handlers.lockerror);
    this.target.removeEventListener('contextmenu', this.handlers.contextmenu);
  }
}

// 사람이 조종하는 요원. 매 프레임 마우스로 시점을 돌리고, 시뮬레이션 틱마다 intent를 넘깁니다.
export class PlayerController {
  constructor(input, settings) {
    this.input = input;
    this.settings = settings;
    this.yaw = 0;
    this.pitch = 0;
    this.queue = { patch: [false, false], interact: false, reload: false, switchTo: null, cards: [] };
    this.lastDx = 0;
    this.lastDy = 0;
  }

  syncFrom(agent) {
    this.yaw = agent.yaw;
    this.pitch = agent.pitch;
  }

  // 렌더 프레임마다 호출
  frame(agent) {
    const { dx, dy } = this.input.takeMouse();
    this.lastDx = dx;
    this.lastDy = dy;
    const sens = 0.0022 * (this.settings.sensitivity ?? 1);
    this.yaw -= dx * sens;
    this.pitch -= dy * sens * (this.settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    for (const code of this.input.takePressed()) {
      const digit = code.startsWith('Digit') ? Number(code.slice(5)) : code.startsWith('Numpad') ? Number(code.slice(6)) : NaN;
      if (agent?.lockpick && digit >= 1 && digit <= 6) {
        this.queue.cards.push(digit - 1);
        continue;
      }
      if (code === 'KeyQ') this.queue.patch[0] = true;
      else if (code === 'KeyE') this.queue.patch[1] = true;
      else if (code === 'KeyF') this.queue.interact = true;
      else if (code === 'KeyR') this.queue.reload = true;
      else if (digit === 1) this.queue.switchTo = 'rifle';
      else if (digit === 2) this.queue.switchTo = 'pistol';
    }
    const w = this.input.takeWheel();
    if (w && agent && !agent.lockpick) this.queue.switchTo = agent.weapon === 'rifle' ? 'pistol' : 'rifle';
  }

  getIntent(match, agent) {
    const i = emptyIntent(agent);
    const inp = this.input;
    const on = inp.active;
    i.yaw = this.yaw;
    i.pitch = this.pitch;
    if (on) {
      i.moveZ = (inp.isDown('KeyW') ? 1 : 0) - (inp.isDown('KeyS') ? 1 : 0);
      i.moveX = (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0);
      i.walk = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
      i.jump = inp.isDown('Space');
      i.fire = (inp.buttons & 1) !== 0;
    }
    const q = this.queue;
    i.patch = q.patch;
    i.interact = q.interact;
    i.reload = q.reload;
    i.switchTo = q.switchTo;
    i.card = q.cards.length ? q.cards.shift() : -1;
    this.queue = { patch: [false, false], interact: false, reload: false, switchTo: null, cards: q.cards };
    return i;
  }
}
