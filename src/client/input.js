import { emptyIntent } from '../sim/agent.js';

// 지휘 명령 휠: G를 누른 채 마우스로 방향을 고르고 떼면 명령 (또는 숫자 키)
// 각도는 화면 기준(오른쪽 0°, 아래 90°). key = 휠이 열려 있을 때의 숫자 키
export const COMMANDS = [
  { type: 'regroup', label: '집결', sub: '분대장 위치로', key: 1, angle: -90 },
  { type: 'B', label: 'B 목표', sub: '해체 진입 / 방어', key: 5, angle: -30 },
  { type: 'move', label: '지정 지점', sub: '조준한 곳으로 이동', key: 3, angle: 30 },
  { type: 'hold', label: '위치 사수', sub: '현 위치 경계', key: 2, angle: 90 },
  { type: 'free', label: '자율 교전', sub: '명령 해제', key: 6, angle: 150 },
  { type: 'A', label: 'A 목표', sub: '해체 진입 / 방어', key: 4, angle: 210 },
];

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
        // 앉기(Ctrl)를 누른 채 다른 키를 눌러도 브라우저 단축키(저장·북마크 등)가 실행되지 않게
        if (e.ctrlKey && (this.locked || this.fallback)) e.preventDefault();
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
        if (e.button === 1) e.preventDefault(); // 휠 클릭(적 보고)으로 자동 스크롤이 켜지지 않게
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
    this.queue = { patch: [false, false, false, false], interact: false, reload: false, switchTo: null, cards: [], command: null, report: false };
    this.lastDx = 0;
    this.lastDy = 0;
    this.wheelOpen = false;
    this.wheelVec = { x: 0, y: 0 };
    this.wheelSel = -1;
    this.wheelUsed = false;
  }

  // 휠 방향 → 명령 번호 (가운데 근처면 -1)
  pickSector(v) {
    if (Math.hypot(v.x, v.y) < 26) return -1;
    const ang = (Math.atan2(v.y, v.x) * 180) / Math.PI;
    let best = -1, bestD = Infinity;
    COMMANDS.forEach((c, i) => {
      let d = Math.abs(((ang - c.angle + 540) % 360) - 180);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  syncFrom(agent) {
    this.yaw = agent.yaw;
    this.pitch = agent.pitch;
  }

  // 렌더 프레임마다 호출
  frame(agent) {
    const { dx, dy } = this.input.takeMouse();
    // 지휘 휠: G를 누르고 있는 동안 시점은 고정, 마우스는 명령 선택에 사용
    const canCommand = agent?.alive && !agent.lockpick && this.input.active;
    const gDown = canCommand && this.input.isDown('KeyG');
    if (gDown && !this.wheelOpen) {
      this.wheelOpen = true;
      this.wheelVec = { x: 0, y: 0 };
      this.wheelUsed = false;
    }
    if (this.wheelOpen) {
      if (gDown) {
        this.wheelVec.x += dx;
        this.wheelVec.y += dy;
        const l = Math.hypot(this.wheelVec.x, this.wheelVec.y);
        if (l > 110) {
          this.wheelVec.x *= 110 / l;
          this.wheelVec.y *= 110 / l;
        }
        this.wheelSel = this.pickSector(this.wheelVec);
        this.lastDx = this.lastDy = 0;
      } else {
        if (!this.wheelUsed && this.wheelSel >= 0) this.queue.command = { type: COMMANDS[this.wheelSel].type };
        this.wheelOpen = false;
        this.wheelSel = -1;
      }
    }
    if (this.wheelOpen) {
      for (const code of this.input.takePressed()) {
        const digit = code.startsWith('Digit') ? Number(code.slice(5)) : code.startsWith('Numpad') ? Number(code.slice(6)) : NaN;
        const cmd = COMMANDS.find((c) => c.key === digit);
        if (cmd && !this.wheelUsed) {
          this.queue.command = { type: cmd.type };
          this.wheelUsed = true;
          this.wheelSel = COMMANDS.indexOf(cmd);
        }
      }
      this.input.takeWheel();
      return;
    }
    this.lastDx = dx;
    this.lastDy = dy;
    const zoom = 1 + ((agent?.adsT ?? 0) * ((this.zoomOf?.(agent) ?? 1) - 1));
    const sens = (0.0022 * (this.settings.sensitivity ?? 1)) / zoom;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens * (this.settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    for (const code of this.input.takePressed()) {
      const digit = code.startsWith('Digit') ? Number(code.slice(5)) : code.startsWith('Numpad') ? Number(code.slice(6)) : NaN;
      if (agent?.lockpick && digit >= 1 && digit <= 6) {
        this.queue.cards.push(digit - 1);
        continue;
      }
      const slot = { KeyC: 0, KeyQ: 1, KeyE: 2, KeyX: 3 }[code];
      if (slot !== undefined) this.queue.patch[slot] = true;
      else if (code === 'KeyF') this.queue.interact = true;
      else if (code === 'KeyR') this.queue.reload = true;
      else if (code === 'Mouse1' || code === 'KeyH') this.queue.report = true;
      else if (digit === 1) this.queue.switchTo = 'rifle';
      else if (digit === 2) this.queue.switchTo = 'pistol';
      else if (digit === 3) this.queue.switchTo = 'knife';
    }
    const w = this.input.takeWheel();
    if (w && agent && !agent.lockpick) {
      const order = ['rifle', 'pistol', 'knife'];
      this.queue.switchTo = order[(order.indexOf(agent.weapon) + (w > 0 ? 1 : 2)) % 3];
    }
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
      i.crouch = inp.isDown('ControlLeft') || inp.isDown('ControlRight');
      i.lean = (inp.isDown('KeyV') ? 1 : 0) - (inp.isDown('KeyZ') ? 1 : 0);
      i.fire = (inp.buttons & 1) !== 0 && !this.wheelOpen;
      i.ads = (inp.buttons & 4) !== 0;
    }
    const q = this.queue;
    i.patch = q.patch;
    i.interact = q.interact;
    i.reload = q.reload;
    i.switchTo = q.switchTo;
    i.card = q.cards.length ? q.cards.shift() : -1;
    i.command = q.command;
    i.report = q.report;
    this.queue = { patch: [false, false, false, false], interact: false, reload: false, switchTo: null, cards: q.cards, command: null, report: false };
    return i;
  }
}
