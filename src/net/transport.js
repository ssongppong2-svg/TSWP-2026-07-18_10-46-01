// 온라인 연결 통로.
// - claude: Claude 아티팩트의 room 기능 (같은 아티팩트 링크를 연 사람끼리 실시간 연결, 서버 불필요)
// - local : 같은 브라우저의 탭끼리 (주소 끝에 ?mp=local, 개발·자동 시험용)
// 둘 다 같은 모양: join(이름) → 방 { presence(patch), peers(), onPeers(fn), connected(), leave() }
// presence = 각자 하나씩 가진 상태 객체 (4KB 이하, 초당 약 30번까지 갱신). 경기 정보는 모두 이것으로 주고받는다.

export async function openTransport() {
  const params = new URLSearchParams(location.search);
  if (params.get('mp') === 'local') return localTransport();
  // 아티팩트 화면이 window.claude를 조금 늦게 붙일 수 있어 잠깐 기다림
  for (let i = 0; i < 20 && typeof globalThis.claude?.use !== 'function'; i++) await new Promise((r) => setTimeout(r, 100));
  const use = globalThis.claude?.use;
  if (typeof use !== 'function') return null;
  try {
    const room = await Promise.race([use.call(globalThis.claude, 'room'), new Promise((r) => setTimeout(() => r(null), 12000))]);
    if (!room) return null;
    return {
      kind: 'claude',
      async join(name) {
        try {
          return wrapClaudeRoom(await room.join(name));
        } catch {
          // 이름 붙은 방을 쓸 수 없으면: 공용 방에서 방 이름표(rm)로 걸러서 씀
          return wrapClaudeRoom(room, name);
        }
      },
    };
  } catch {
    return null;
  }
}

function wrapClaudeRoom(r, tag = null) {
  const mine = (p) => !tag || p.presence?.rm === tag;
  return {
    presence: (patch) => r.presence(tag ? { ...patch, rm: tag } : patch).catch(() => {}),
    peers: () =>
      r
        .peers()
        .filter((p) => p.kind !== 'agent' && mine(p))
        .map((p) => ({ peer: p.peer, isMe: p.isMe && p.sameTab, presence: p.presence ?? {}, updatedAt: p.updatedAt })),
    onPeers: (fn) => r.onPeers(() => fn()),
    connected: () => r.connected(),
    // 공용 방을 빌려 쓴 경우에는 나가지 않고 내 상태만 지움
    leave: () => (tag ? r.presence({ k: null, rm: null, g: null, in: null, start: null }).catch(() => {}) : r.leave().catch(() => {})),
  };
}

// ── 같은 브라우저 탭끼리: BroadcastChannel로 presence를 흉내 냄 (상태 전체를 보내고, 3초 동안 소식이 없으면 나간 것으로)
function localTransport() {
  return {
    kind: 'local',
    async join(name) {
      return new LocalRoom(name);
    },
  };
}

class LocalRoom {
  constructor(name) {
    this.self = Math.random().toString(36).slice(2, 10);
    this.ch = new BroadcastChannel(`force-room:${name}`);
    this.mine = {};
    this.others = new Map();
    this.listeners = new Set();
    this.pending = false;
    this.ch.onmessage = (e) => this.receive(e.data);
    this.beat = setInterval(() => {
      this.send();
      const now = performance.now();
      let changed = false;
      for (const [k, v] of this.others) {
        if (now - v.seen > 3000) {
          this.others.delete(k);
          changed = true;
        }
      }
      if (changed) this.notify();
    }, 1000);
    this.ch.postMessage({ t: 'hello', from: this.self });
    this.send();
  }

  receive(m) {
    if (!m || m.from === this.self) return;
    if (m.t === 'hello') {
      this.send();
      return;
    }
    if (m.t === 'leave') {
      this.others.delete(m.from);
      this.notify();
      return;
    }
    if (m.t === 'p') {
      this.others.set(m.from, { presence: m.p, seen: performance.now(), updatedAt: Date.now() });
      this.notify();
    }
  }

  send() {
    this.ch.postMessage({ t: 'p', from: this.self, p: this.mine });
  }

  presence(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete this.mine[k];
      else this.mine[k] = v;
    }
    // 실제 room처럼 한 프레임에 한 번으로 묶어서 보냄
    if (!this.pending) {
      this.pending = true;
      setTimeout(() => {
        this.pending = false;
        this.send();
        this.notify();
      }, 30);
    }
    return Promise.resolve();
  }

  peers() {
    const list = [{ peer: this.self, isMe: true, presence: this.mine, updatedAt: Date.now() }];
    for (const [k, v] of this.others) list.push({ peer: k, isMe: false, presence: v.presence, updatedAt: v.updatedAt });
    return list;
  }

  onPeers(fn) {
    this.listeners.add(fn);
    queueMicrotask(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of [...this.listeners]) fn();
  }

  connected() {
    return true;
  }

  leave() {
    clearInterval(this.beat);
    this.ch.postMessage({ t: 'leave', from: this.self });
    this.ch.close();
    this.listeners.clear();
    return Promise.resolve();
  }
}
