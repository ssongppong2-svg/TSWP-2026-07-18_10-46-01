// 효과음은 전부 Web Audio로 즉석 합성합니다 (소리 파일 없음 → 한 파일로 실행 가능).

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.voices = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16;
      this.comp.ratio.value = 4;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.comp);
      this.comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(pos, fwd) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  // 소리가 나갈 곳: 위치가 있으면 3D 패너를 거침
  out(pos, vol = 1, dur = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 3;
      p.maxDistance = 90;
      p.rolloffFactor = 1.1;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    this.voices++;
    setTimeout(() => this.voices--, dur * 1000 + 100);
    return g;
  }

  noise(dest, t, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 1, attack = 0.002, sweepTo = null } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest, t, dur, { type = 'sine', freq = 440, to = null, gain = 0.5, attack = 0.005, vibrato = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = vibrato;
      lg.gain.value = freq * 0.08;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, { pos = null, vol = 1, listener = null } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (pos && listener) {
      const d = Math.hypot(pos.x - listener.x, pos.y - listener.y, pos.z - listener.z);
      if (d > 90) return;
    }
    if (this.voices > 48 && pos) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    const t = this.ctx.currentTime + 0.005;
    fn(this, t, pos, vol);
  }
}

const SOUNDS = {
  rifle(a, t, pos, vol) {
    const o = a.out(pos, 0.55 * vol, 0.3);
    a.noise(o, t, 0.12, { type: 'bandpass', freq: 2200, q: 0.7, gain: 0.9 });
    a.noise(o, t, 0.22, { type: 'lowpass', freq: 900, q: 0.5, gain: 0.7, sweepTo: 200 });
    a.tone(o, t, 0.12, { type: 'sine', freq: 140, to: 45, gain: 0.9 });
  },
  pistol(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 0.3);
    a.noise(o, t, 0.08, { type: 'bandpass', freq: 3000, q: 0.8, gain: 0.8 });
    a.noise(o, t, 0.16, { type: 'lowpass', freq: 1400, gain: 0.5, sweepTo: 300 });
    a.tone(o, t, 0.09, { type: 'triangle', freq: 220, to: 70, gain: 0.6 });
  },
  ampShot(a, t, pos, vol) {
    const o = a.out(pos, 0.25 * vol, 0.2);
    a.tone(o, t, 0.1, { type: 'sawtooth', freq: 880, to: 1320, gain: 0.25 });
  },
  dry(a, t) {
    const o = a.out(null, 0.4, 0.1);
    a.noise(o, t, 0.03, { type: 'highpass', freq: 3000, gain: 0.6 });
  },
  reload(a, t, pos, vol) {
    const o = a.out(pos, 0.45 * vol, 1);
    a.noise(o, t, 0.05, { type: 'bandpass', freq: 1800, q: 3, gain: 0.7 });
    a.noise(o, t + 0.45, 0.06, { type: 'bandpass', freq: 1200, q: 3, gain: 0.8 });
    a.noise(o, t + 0.9, 0.05, { type: 'bandpass', freq: 2600, q: 4, gain: 0.8 });
  },
  swap(a, t) {
    const o = a.out(null, 0.3, 0.3);
    a.noise(o, t, 0.15, { type: 'bandpass', freq: 600, sweepTo: 2000, q: 1, gain: 0.5 });
  },
  step(a, t, pos, vol) {
    const o = a.out(pos, 0.35 * vol, 0.15);
    a.noise(o, t, 0.07, { type: 'lowpass', freq: 500 + Math.random() * 200, gain: 0.7 });
    a.noise(o, t, 0.03, { type: 'bandpass', freq: 3500, q: 2, gain: 0.15 });
  },
  land(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 0.3);
    a.noise(o, t, 0.15, { type: 'lowpass', freq: 400, gain: 0.9 });
  },
  hit(a, t) {
    const o = a.out(null, 0.4, 0.1);
    a.tone(o, t, 0.05, { type: 'square', freq: 1900, gain: 0.35 });
  },
  headshot(a, t) {
    const o = a.out(null, 0.45, 0.3);
    a.tone(o, t, 0.12, { type: 'sine', freq: 1500, gain: 0.5 });
    a.tone(o, t + 0.05, 0.2, { type: 'sine', freq: 2250, gain: 0.45 });
  },
  kill(a, t) {
    const o = a.out(null, 0.45, 0.6);
    [660, 880, 1320].forEach((f, i) => a.tone(o, t + i * 0.06, 0.25, { type: 'triangle', freq: f, gain: 0.4 }));
  },
  hurt(a, t) {
    const o = a.out(null, 0.5, 0.3);
    a.noise(o, t, 0.2, { type: 'lowpass', freq: 700, gain: 0.8 });
    a.tone(o, t, 0.15, { type: 'sine', freq: 110, to: 60, gain: 0.6 });
  },
  death(a, t) {
    const o = a.out(null, 0.5, 1.2);
    a.tone(o, t, 1.0, { type: 'sawtooth', freq: 300, to: 60, gain: 0.25 });
    a.noise(o, t, 0.8, { type: 'lowpass', freq: 1200, sweepTo: 100, gain: 0.4 });
  },
  veil(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 3.2);
    a.tone(o, t, 3, { type: 'sine', freq: 110, gain: 0.5, attack: 0.2, vibrato: 6 });
    a.tone(o, t, 3, { type: 'sine', freq: 220, gain: 0.25, attack: 0.3 });
    a.noise(o, t, 0.6, { type: 'bandpass', freq: 3000, sweepTo: 600, q: 2, gain: 0.3 });
  },
  caught(a, t, pos, vol) {
    const o = a.out(pos, 0.25 * vol, 0.3);
    a.tone(o, t, 0.25, { type: 'sine', freq: 900, to: 300, gain: 0.3 });
  },
  pad(a, t, pos, vol) {
    const o = a.out(pos, 0.6 * vol, 0.8);
    a.noise(o, t, 0.08, { type: 'lowpass', freq: 500, gain: 0.8 });
    a.tone(o, t, 0.55, { type: 'sine', freq: 180, to: 720, gain: 0.55, vibrato: 18 });
  },
  amp(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 0.8);
    a.tone(o, t, 0.5, { type: 'sawtooth', freq: 160, to: 960, gain: 0.25 });
    a.tone(o, t + 0.1, 0.5, { type: 'square', freq: 480, to: 1440, gain: 0.12 });
  },
  friction(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 1.2);
    a.noise(o, t, 1.0, { type: 'highpass', freq: 5000, gain: 0.35, attack: 0.05 });
    a.tone(o, t, 0.9, { type: 'sine', freq: 2400, to: 1200, gain: 0.2 });
    a.tone(o, t + 0.05, 0.9, { type: 'sine', freq: 3200, to: 1600, gain: 0.12 });
  },
  collapse(a, t, pos, vol) {
    const o = a.out(pos, 0.9 * vol, 4);
    a.tone(o, t, 1.6, { type: 'sine', freq: 90, to: 28, gain: 0.9, attack: 0.05 });
    a.noise(o, t, 1.2, { type: 'lowpass', freq: 3000, sweepTo: 120, gain: 0.6, attack: 0.3 });
    a.tone(o, t + 0.8, 3, { type: 'sine', freq: 55, gain: 0.5, vibrato: 4, attack: 0.2 });
  },
  captured(a, t) {
    const o = a.out(null, 0.4, 0.8);
    a.tone(o, t, 0.6, { type: 'sine', freq: 400, to: 120, gain: 0.4, vibrato: 12 });
  },
  denied(a, t) {
    const o = a.out(null, 0.3, 0.2);
    a.tone(o, t, 0.12, { type: 'square', freq: 180, gain: 0.25 });
  },
  beep(a, t, pos, vol) {
    const o = a.out(pos, 0.35 * vol, 0.15);
    a.tone(o, t, 0.07, { type: 'square', freq: 1250, gain: 0.35 });
  },
  card(a, t) {
    const o = a.out(null, 0.4, 0.1);
    a.noise(o, t, 0.04, { type: 'bandpass', freq: 2400, q: 4, gain: 0.8 });
    a.tone(o, t, 0.05, { type: 'sine', freq: 700, gain: 0.2 });
  },
  match(a, t) {
    const o = a.out(null, 0.5, 1.2);
    a.noise(o, t, 0.1, { type: 'bandpass', freq: 900, q: 3, gain: 0.8 });
    a.tone(o, t, 1.0, { type: 'triangle', freq: 300, to: 600, gain: 0.3 });
  },
  defused(a, t) {
    const o = a.out(null, 0.5, 1.2);
    [523, 659, 784, 1047].forEach((f, i) => a.tone(o, t + i * 0.08, 0.5, { type: 'triangle', freq: f, gain: 0.35 }));
  },
  lockFail(a, t) {
    const o = a.out(null, 0.5, 0.5);
    a.tone(o, t, 0.25, { type: 'sawtooth', freq: 220, to: 110, gain: 0.3 });
  },
  alert(a, t) {
    const o = a.out(null, 0.45, 0.8);
    a.tone(o, t, 0.18, { type: 'square', freq: 880, gain: 0.25 });
    a.tone(o, t + 0.22, 0.18, { type: 'square', freq: 660, gain: 0.25 });
  },
  explosion(a, t, pos, vol) {
    const o = a.out(null, 1.0 * vol, 3);
    a.noise(o, t, 2.4, { type: 'lowpass', freq: 2500, sweepTo: 80, gain: 1, attack: 0.01 });
    a.tone(o, t, 1.5, { type: 'sine', freq: 70, to: 25, gain: 1 });
  },
  roundStart(a, t) {
    const o = a.out(null, 0.5, 1.2);
    [392, 523, 659].forEach((f) => a.tone(o, t, 0.9, { type: 'sawtooth', freq: f, gain: 0.12, attack: 0.03 }));
  },
  tick(a, t) {
    const o = a.out(null, 0.4, 0.2);
    a.tone(o, t, 0.08, { type: 'sine', freq: 880, gain: 0.35 });
  },
  win(a, t) {
    const o = a.out(null, 0.55, 2);
    [523, 659, 784, 1047, 1319].forEach((f, i) => a.tone(o, t + i * 0.1, 0.9, { type: 'triangle', freq: f, gain: 0.3 }));
  },
  lose(a, t) {
    const o = a.out(null, 0.55, 2);
    [440, 392, 349, 262].forEach((f, i) => a.tone(o, t + i * 0.16, 0.7, { type: 'triangle', freq: f, gain: 0.3 }));
  },
  ui(a, t) {
    const o = a.out(null, 0.3, 0.1);
    a.tone(o, t, 0.05, { type: 'sine', freq: 1200, gain: 0.25 });
  },
  pick(a, t) {
    const o = a.out(null, 0.45, 0.4);
    a.tone(o, t, 0.12, { type: 'triangle', freq: 660, gain: 0.35 });
    a.tone(o, t + 0.07, 0.2, { type: 'triangle', freq: 990, gain: 0.35 });
  },
  snatched(a, t) {
    const o = a.out(null, 0.3, 0.3);
    a.tone(o, t, 0.15, { type: 'sine', freq: 520, to: 380, gain: 0.25 });
  },
};
