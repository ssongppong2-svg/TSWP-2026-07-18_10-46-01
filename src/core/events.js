// 아주 작은 이벤트 버스. 시뮬레이션(규칙)과 화면/소리/HUD를 느슨하게 연결합니다.
export class Emitter {
  constructor() {
    this.handlers = new Map();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const list = this.handlers.get(type);
    if (list) for (const fn of [...list]) fn(payload);
    const any = this.handlers.get('*');
    if (any) for (const fn of [...any]) fn(type, payload);
  }

  clear() {
    this.handlers.clear();
  }
}
