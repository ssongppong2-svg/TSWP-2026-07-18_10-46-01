// 효과음은 전부 Web Audio로 즉석 합성 (소리 파일 없음 → 한 파일로 실행 가능).
// 경로: 소리 → (3D 패너) → 마스터 → 먹먹함 필터 → 압축기 → 스피커
//        └→ 울림(컨볼루션 리버브) → 마스터

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.voices = 0;
    this.listener = { x: 0, y: 0, z: 0 };
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 5;
      this.muffle = ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.muffle);
      this.muffle.connect(this.comp);
      this.comp.connect(ctx.destination);
      // 울림: 콘크리트 건물 사이에서 울리는 잔향
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(this.lowPower ? 1.3 : 2.4);
      this.reverbOut = ctx.createGain();
      this.reverbOut.gain.value = 0.55;
      this.reverb.connect(this.reverbOut);
      this.reverbOut.connect(this.master);
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.pendingRain != null) {
      const r = this.pendingRain;
      this.pendingRain = null;
      this.setRain(r);
    }
  }

  // 저사양: 입체음향을 가벼운 방식(equalpower)으로, 잔향을 짧게 (오디오 처리도 CPU를 꽤 씀)
  setLowPower(on) {
    if (this.lowPower === on) return;
    this.lowPower = on;
    if (this.reverb) this.reverb.buffer = this.makeImpulse(on ? 1.3 : 2.4);
  }

  makeImpulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.6) * 0.6;
      }
      // 초기 반사음 (벽에 부딪혀 돌아오는 소리)
      for (const [t, g] of [[0.023, 0.6], [0.041, 0.45], [0.067, 0.5], [0.11, 0.35], [0.19, 0.25]]) {
        const i = Math.floor((t + ch * 0.004) * ctx.sampleRate);
        for (let k = 0; k < 60; k++) d[i + k] += (Math.random() * 2 - 1) * g * Math.exp(-k / 15);
      }
    }
    return buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // 빗소리 (계속 재생). intensity 0이면 멈춤.
  setRain(intensity) {
    this.wet = intensity > 0;
    if (!this.ctx) {
      this.pendingRain = intensity;
      return;
    }
    const ctx = this.ctx;
    if (!this.rain && intensity > 0) {
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(this.master);
      const layer = (type, freq, q, gain) => {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        src.playbackRate.value = 0.93 + Math.random() * 0.14;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(f);
        f.connect(g);
        g.connect(out);
        src.start();
        return { src, g };
      };
      // 쏴아 하는 빗소리 + 바닥에 튀는 소리 + 낮은 웅웅거림
      const layers = [layer('highpass', 4200, 0.4, 0.22), layer('bandpass', 1500, 0.6, 0.3), layer('lowpass', 260, 0.7, 0.35)];
      // 빗줄기의 세기가 천천히 변함
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.07;
      lfoGain.gain.value = 0.08;
      lfo.connect(lfoGain);
      lfoGain.connect(layers[1].g.gain);
      lfo.start();
      this.rain = { out, layers, lfo };
    }
    if (this.rain) this.rain.out.gain.setTargetAtTime(intensity * 0.55, ctx.currentTime, 0.8);
  }

  // 체력이 낮거나 섬광을 받으면 소리가 먹먹해짐 (0 = 정상, 1 = 아주 먹먹)
  setMuffle(amount) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(800 / 20000, Math.max(0, Math.min(1, amount)));
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
  }

  setListener(pos, fwd) {
    this.listener = { x: pos.x, y: pos.y, z: pos.z };
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

  // 소리가 나갈 곳. 위치가 있으면 3D 패너, 멀면 고음이 깎이고 울림이 커짐.
  out(pos, vol = 1, dur = 1, reverb = 0.2) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    let head = g;
    if (pos) {
      const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
      const p = ctx.createPanner();
      p.panningModel = this.lowPower ? 'equalpower' : 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 3;
      p.maxDistance = 120;
      p.rolloffFactor = 1.0;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      if (d > 18) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(900, 9000 - d * 120);
        g.connect(lp);
        head = lp;
      }
      head.connect(p);
      p.connect(this.master);
      reverb *= 1 + Math.min(2, d / 25);
    } else {
      g.connect(this.master);
    }
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      g.connect(send);
      send.connect(this.reverb);
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
      lg.gain.value = freq * 0.05;
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

  play(name, { pos = null, vol = 1 } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (pos && Math.hypot(pos.x - this.listener.x, pos.z - this.listener.z) > 110) return;
    if (this.voices > 56 && pos) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    fn(this, this.ctx.currentTime + 0.005, pos, vol);
  }
}

const SOUNDS = {
  rifle(a, t, pos, vol) {
    const o = a.out(pos, 0.7 * vol, 0.4, 0.4);
    a.noise(o, t, 0.012, { type: 'highpass', freq: 2500, gain: 1.2, attack: 0.0008 });
    a.noise(o, t, 0.07, { type: 'bandpass', freq: 1700, q: 0.7, gain: 1.0, attack: 0.001 });
    a.noise(o, t, 0.2, { type: 'lowpass', freq: 750, q: 0.6, gain: 0.9, sweepTo: 180 });
    a.tone(o, t, 0.2, { type: 'sine', freq: 72, to: 36, gain: 1.0, attack: 0.002 });
  },
  pistol(a, t, pos, vol) {
    const o = a.out(pos, 0.6 * vol, 0.4, 0.35);
    a.noise(o, t, 0.01, { type: 'highpass', freq: 3000, gain: 1.1, attack: 0.0008 });
    a.noise(o, t, 0.06, { type: 'bandpass', freq: 2300, q: 0.8, gain: 0.9 });
    a.noise(o, t, 0.15, { type: 'lowpass', freq: 1100, gain: 0.6, sweepTo: 250 });
    a.tone(o, t, 0.13, { type: 'sine', freq: 95, to: 48, gain: 0.7 });
  },
  ampShot(a, t) {
    const o = a.out(null, 0.15, 0.2, 0);
    a.tone(o, t, 0.08, { type: 'sawtooth', freq: 520, to: 780, gain: 0.12 });
  },
  dry(a, t) {
    const o = a.out(null, 0.5, 0.1, 0.05);
    a.noise(o, t, 0.02, { type: 'bandpass', freq: 3200, q: 4, gain: 0.8 });
  },
  casing(a, t, pos) {
    const o = a.out(pos, 0.12, 0.2, 0.1);
    a.tone(o, t, 0.05, { type: 'sine', freq: 3600 + Math.random() * 800, gain: 0.25 });
    a.tone(o, t + 0.07, 0.04, { type: 'sine', freq: 5100, gain: 0.12 });
  },
  reload(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 2.4, 0.08);
    a.noise(o, t + 0.25, 0.03, { type: 'bandpass', freq: 3000, q: 5, gain: 0.8 });
    a.noise(o, t + 0.32, 0.12, { type: 'bandpass', freq: 1400, q: 1.5, gain: 0.4, sweepTo: 600 });
    a.noise(o, t + 1.05, 0.05, { type: 'lowpass', freq: 600, gain: 0.9 });
    a.noise(o, t + 1.08, 0.025, { type: 'bandpass', freq: 2600, q: 6, gain: 0.9 });
    a.noise(o, t + 1.75, 0.03, { type: 'bandpass', freq: 2000, q: 5, gain: 0.8 });
    a.noise(o, t + 1.9, 0.04, { type: 'bandpass', freq: 1500, q: 4, gain: 0.9 });
  },
  swap(a, t) {
    const o = a.out(null, 0.35, 0.4, 0.05);
    a.noise(o, t, 0.16, { type: 'bandpass', freq: 500, q: 0.8, gain: 0.5, sweepTo: 1200 });
    a.noise(o, t + 0.18, 0.03, { type: 'bandpass', freq: 2400, q: 5, gain: 0.6 });
  },
  knife(a, t, pos) {
    const o = a.out(pos, 0.45, 0.3, 0.05);
    a.noise(o, t, 0.13, { type: 'bandpass', freq: 900, q: 1.2, gain: 0.6, sweepTo: 3200 });
  },
  knifeHit(a, t, pos) {
    const o = a.out(pos, 0.6, 0.3, 0.1);
    a.noise(o, t, 0.08, { type: 'lowpass', freq: 500, gain: 1 });
    a.tone(o, t, 0.08, { type: 'sine', freq: 140, to: 70, gain: 0.6 });
  },
  step(a, t, pos, vol) {
    const o = a.out(pos, 0.42 * vol, 0.15, 0.08);
    a.noise(o, t, 0.06, { type: 'lowpass', freq: 260 + Math.random() * 120, gain: 0.9 });
    a.noise(o, t + 0.01, 0.04, { type: 'bandpass', freq: 2200, q: 1.5, gain: 0.18 });
    // 젖은 바닥: 물 튀는 소리
    if (a.wet) a.noise(o, t + 0.015, 0.09, { type: 'bandpass', freq: 3200 + Math.random() * 900, q: 2.2, gain: 0.35, sweepTo: 1800 });
  },
  quietStep(a, t, pos, vol) {
    const o = a.out(pos, 0.12 * vol, 0.12, 0.02);
    a.noise(o, t, 0.05, { type: 'lowpass', freq: 220, gain: 0.6 });
    if (a.wet) a.noise(o, t + 0.01, 0.05, { type: 'bandpass', freq: 2600, q: 2, gain: 0.15 });
  },
  impact(a, t, pos) {
    // 탄이 몸에 맞는 둔탁한 소리 (가까울 때만 들림)
    const o = a.out(pos, 0.35, 0.15, 0.05);
    a.noise(o, t, 0.05, { type: 'lowpass', freq: 420, gain: 0.9 });
    a.tone(o, t, 0.05, { type: 'sine', freq: 110, to: 70, gain: 0.4 });
  },
  radio(a, t) {
    // 무전 수신: 짧은 잡음 + 끊김
    const o = a.out(null, 0.22, 0.4, 0);
    a.noise(o, t, 0.05, { type: 'bandpass', freq: 2600, q: 1.2, gain: 0.7 });
    a.tone(o, t + 0.05, 0.05, { type: 'square', freq: 1450, gain: 0.08 });
    a.noise(o, t + 0.28, 0.06, { type: 'bandpass', freq: 1900, q: 1.5, gain: 0.5 });
  },
  radioOut(a, t) {
    // 무전 송신 (명령)
    const o = a.out(null, 0.25, 0.3, 0);
    a.tone(o, t, 0.04, { type: 'square', freq: 980, gain: 0.08 });
    a.noise(o, t + 0.03, 0.12, { type: 'bandpass', freq: 2200, q: 1.3, gain: 0.45 });
  },
  wheel(a, t) {
    const o = a.out(null, 0.15, 0.1, 0);
    a.noise(o, t, 0.02, { type: 'bandpass', freq: 3800, q: 6, gain: 0.5 });
  },
  inspect(a, t) {
    // 탄창을 살짝 빼서 확인하는 소리
    const o = a.out(null, 0.3, 0.6, 0.03);
    a.noise(o, t + 0.05, 0.03, { type: 'bandpass', freq: 2800, q: 6, gain: 0.7 });
    a.noise(o, t + 0.3, 0.04, { type: 'bandpass', freq: 1900, q: 5, gain: 0.8 });
  },
  thunder(a, t, pos, vol) {
    const o = a.out(null, 0.9 * vol, 6, 0.6);
    a.noise(o, t, 0.25, { type: 'lowpass', freq: 900, gain: 0.5, attack: 0.02 });
    a.noise(o, t + 0.1, 4.5, { type: 'lowpass', freq: 220, q: 0.8, gain: 1.0, attack: 0.3, sweepTo: 60 });
    a.noise(o, t + 0.6, 2.5, { type: 'lowpass', freq: 140, gain: 0.7, attack: 0.4 });
  },
  land(a, t, pos, vol) {
    const o = a.out(pos, 0.55 * vol, 0.3, 0.1);
    a.noise(o, t, 0.14, { type: 'lowpass', freq: 300, gain: 1 });
    a.noise(o, t + 0.03, 0.08, { type: 'bandpass', freq: 1800, q: 2, gain: 0.25 });
    if (a.wet) a.noise(o, t + 0.02, 0.18, { type: 'bandpass', freq: 2600, q: 1.4, gain: 0.45, sweepTo: 1200 });
  },
  hit(a, t) {
    const o = a.out(null, 0.4, 0.1, 0);
    a.noise(o, t, 0.04, { type: 'bandpass', freq: 1300, q: 1.5, gain: 0.9 });
  },
  headshot(a, t) {
    const o = a.out(null, 0.42, 0.3, 0.05);
    a.tone(o, t, 0.16, { type: 'sine', freq: 3100, gain: 0.35 });
    a.tone(o, t, 0.12, { type: 'sine', freq: 4700, gain: 0.18 });
    a.noise(o, t, 0.03, { type: 'highpass', freq: 4000, gain: 0.6 });
  },
  kill(a, t) {
    const o = a.out(null, 0.4, 0.3, 0);
    a.tone(o, t, 0.12, { type: 'sine', freq: 180, to: 120, gain: 0.5 });
    a.noise(o, t, 0.05, { type: 'bandpass', freq: 900, q: 2, gain: 0.4 });
  },
  hurt(a, t) {
    const o = a.out(null, 0.55, 0.3, 0);
    a.noise(o, t, 0.18, { type: 'lowpass', freq: 380, gain: 1 });
    a.tone(o, t, 0.15, { type: 'sine', freq: 85, to: 55, gain: 0.7 });
  },
  ring(a, t) {
    const o = a.out(null, 0.12, 2.6, 0);
    a.tone(o, t, 2.5, { type: 'sine', freq: 4200, gain: 0.18, attack: 0.02 });
  },
  heartbeat(a, t, pos, vol) {
    const o = a.out(null, 0.7 * vol, 0.5, 0);
    a.tone(o, t, 0.12, { type: 'sine', freq: 58, to: 40, gain: 1 });
    a.tone(o, t + 0.18, 0.1, { type: 'sine', freq: 52, to: 38, gain: 0.7 });
  },
  death(a, t) {
    const o = a.out(null, 0.5, 2.2, 0.2);
    a.tone(o, t, 1.8, { type: 'sine', freq: 90, to: 40, gain: 0.5 });
    a.noise(o, t, 1.2, { type: 'lowpass', freq: 600, sweepTo: 80, gain: 0.4 });
  },
  veil(a, t, pos, vol) {
    const o = a.out(pos, 0.55 * vol, 3.2, 0.15);
    a.tone(o, t, 3, { type: 'sine', freq: 68, gain: 0.6, attack: 0.15, vibrato: 5 });
    a.tone(o, t, 3, { type: 'triangle', freq: 136, gain: 0.15, attack: 0.3 });
    for (let i = 0; i < 6; i++) a.noise(o, t + i * 0.4 + Math.random() * 0.2, 0.05, { type: 'bandpass', freq: 3500, q: 3, gain: 0.25 });
  },
  caught(a, t, pos, vol) {
    const o = a.out(pos, 0.2 * vol, 0.3, 0.05);
    a.tone(o, t, 0.2, { type: 'sine', freq: 700, to: 220, gain: 0.25 });
  },
  pad(a, t, pos, vol) {
    const o = a.out(pos, 0.6 * vol, 0.7, 0.15);
    a.noise(o, t, 0.12, { type: 'lowpass', freq: 220, gain: 1 });
    a.tone(o, t, 0.12, { type: 'sine', freq: 95, to: 55, gain: 0.8 });
    a.tone(o, t + 0.04, 0.35, { type: 'triangle', freq: 410, to: 360, gain: 0.18, vibrato: 30 });
  },
  amp(a, t, pos, vol) {
    const o = a.out(pos, 0.4 * vol, 0.6, 0.05);
    a.tone(o, t, 0.4, { type: 'sine', freq: 500, to: 2300, gain: 0.18 });
    a.noise(o, t + 0.38, 0.03, { type: 'bandpass', freq: 2500, q: 5, gain: 0.6 });
  },
  rounds(a, t, pos, vol) {
    const o = a.out(pos, 0.4 * vol, 0.5, 0.05);
    a.noise(o, t, 0.03, { type: 'bandpass', freq: 2200, q: 5, gain: 0.7 });
    a.noise(o, t + 0.12, 0.03, { type: 'bandpass', freq: 1800, q: 5, gain: 0.7 });
    a.tone(o, t, 0.25, { type: 'sine', freq: 900, to: 1400, gain: 0.08 });
  },
  ricochet(a, t, pos) {
    const o = a.out(pos, 0.35, 0.4, 0.2);
    a.tone(o, t, 0.22, { type: 'sine', freq: 2600 + Math.random() * 600, to: 1100, gain: 0.35 });
    a.noise(o, t, 0.02, { type: 'highpass', freq: 3000, gain: 0.6 });
  },
  shield(a, t, pos, vol) {
    const o = a.out(pos, 0.6 * vol, 0.9, 0.2);
    a.noise(o, t, 0.1, { type: 'bandpass', freq: 850, q: 5, gain: 0.9 });
    a.tone(o, t, 0.25, { type: 'triangle', freq: 190, to: 150, gain: 0.4 });
    a.noise(o, t + 0.05, 0.6, { type: 'highpass', freq: 3500, gain: 0.25, attack: 0.05 });
  },
  shieldHit(a, t, pos) {
    const o = a.out(pos, 0.3, 0.3, 0.15);
    a.tone(o, t, 0.12, { type: 'sine', freq: 1700, gain: 0.3 });
    a.tone(o, t, 0.1, { type: 'sine', freq: 2650, gain: 0.15 });
  },
  shieldBreak(a, t, pos) {
    const o = a.out(pos, 0.7, 1.2, 0.3);
    a.noise(o, t, 0.6, { type: 'lowpass', freq: 3000, sweepTo: 200, gain: 1 });
    a.tone(o, t, 0.4, { type: 'triangle', freq: 300, to: 90, gain: 0.4 });
  },
  net(a, t, pos, vol) {
    const o = a.out(pos, 0.55 * vol, 0.9, 0.15);
    a.noise(o, t, 0.08, { type: 'lowpass', freq: 300, gain: 1 });
    a.noise(o, t + 0.05, 0.5, { type: 'bandpass', freq: 600, q: 2, gain: 0.35, sweepTo: 1800 });
  },
  netRelease(a, t, pos) {
    const o = a.out(pos, 0.5, 0.6, 0.15);
    a.tone(o, t, 0.3, { type: 'triangle', freq: 220, to: 330, gain: 0.3, vibrato: 25 });
    a.noise(o, t, 0.1, { type: 'lowpass', freq: 400, gain: 0.8 });
  },
  scanner(a, t, pos, vol) {
    const o = a.out(pos, 0.45 * vol, 2, 0.6);
    a.tone(o, t, 0.5, { type: 'sine', freq: 1150, gain: 0.35 });
    a.tone(o, t + 0.55, 0.5, { type: 'sine', freq: 1150, gain: 0.2 });
  },
  surge(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 1, 0.2);
    a.noise(o, t, 0.15, { type: 'bandpass', freq: 1500, q: 1, gain: 0.5 });
    a.tone(o, t + 0.1, 0.6, { type: 'sawtooth', freq: 110, to: 220, gain: 0.12 });
    a.tone(o, t + 0.1, 0.6, { type: 'sine', freq: 440, to: 880, gain: 0.12 });
  },
  friction(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 1.2, 0.2);
    a.noise(o, t, 0.9, { type: 'highpass', freq: 3500, gain: 0.3, attack: 0.05 });
    a.noise(o, t, 0.08, { type: 'lowpass', freq: 300, gain: 0.7 });
  },
  storm(a, t, pos, vol) {
    const o = a.out(pos, 0.7 * vol, 3, 0.3);
    a.noise(o, t, 2.6, { type: 'lowpass', freq: 500, gain: 0.8, attack: 0.4 });
    a.noise(o, t, 2.4, { type: 'bandpass', freq: 1200, q: 0.6, gain: 0.25, attack: 0.5 });
  },
  collapse(a, t, pos, vol) {
    const o = a.out(pos, 0.9 * vol, 4, 0.4);
    a.tone(o, t, 1.6, { type: 'sine', freq: 60, to: 24, gain: 1, attack: 0.05 });
    a.noise(o, t, 1.2, { type: 'lowpass', freq: 2500, sweepTo: 100, gain: 0.6, attack: 0.3 });
    a.tone(o, t + 0.8, 3, { type: 'sine', freq: 42, gain: 0.5, vibrato: 3, attack: 0.2 });
  },
  captured(a, t) {
    const o = a.out(null, 0.4, 0.8, 0.1);
    a.tone(o, t, 0.6, { type: 'sine', freq: 160, to: 70, gain: 0.5 });
  },
  denied(a, t) {
    const o = a.out(null, 0.3, 0.2, 0);
    a.noise(o, t, 0.05, { type: 'bandpass', freq: 400, q: 3, gain: 0.7 });
  },
  beep(a, t, pos, vol) {
    const o = a.out(pos, 0.25 * vol, 0.15, 0.1);
    a.tone(o, t, 0.05, { type: 'square', freq: 1350, gain: 0.3 });
  },
  card(a, t) {
    const o = a.out(null, 0.4, 0.1, 0);
    a.noise(o, t, 0.025, { type: 'bandpass', freq: 2600, q: 5, gain: 0.9 });
  },
  match(a, t) {
    const o = a.out(null, 0.5, 1.2, 0.05);
    a.noise(o, t, 0.08, { type: 'lowpass', freq: 700, gain: 0.9 });
    for (let i = 0; i < 5; i++) a.noise(o, t + 0.12 + i * 0.13, 0.025, { type: 'bandpass', freq: 2200, q: 6, gain: 0.6 });
  },
  defused(a, t) {
    const o = a.out(null, 0.45, 0.8, 0.1);
    a.noise(o, t, 0.06, { type: 'bandpass', freq: 1800, q: 1, gain: 0.4 });
    a.tone(o, t + 0.08, 0.14, { type: 'sine', freq: 880, gain: 0.3 });
    a.tone(o, t + 0.26, 0.2, { type: 'sine', freq: 1320, gain: 0.3 });
  },
  lockFail(a, t) {
    const o = a.out(null, 0.45, 0.4, 0);
    a.tone(o, t, 0.28, { type: 'square', freq: 140, gain: 0.25 });
  },
  alert(a, t) {
    const o = a.out(null, 0.35, 1, 0.1);
    a.noise(o, t, 0.06, { type: 'bandpass', freq: 1600, q: 1, gain: 0.4 });
    for (let i = 0; i < 4; i++) a.tone(o, t + 0.08 + i * 0.16, 0.12, { type: 'square', freq: i % 2 ? 700 : 920, gain: 0.15 });
  },
  explosion(a, t, pos, vol) {
    const o = a.out(null, 1.0 * vol, 4, 0.6);
    a.noise(o, t, 3.0, { type: 'lowpass', freq: 3000, sweepTo: 60, gain: 1, attack: 0.005 });
    a.tone(o, t, 1.8, { type: 'sine', freq: 55, to: 20, gain: 1 });
  },
  roundStart(a, t) {
    const o = a.out(null, 0.4, 1, 0.1);
    a.noise(o, t, 0.12, { type: 'bandpass', freq: 1500, q: 0.8, gain: 0.5 });
    a.tone(o, t + 0.14, 0.18, { type: 'sine', freq: 1000, gain: 0.25 });
    a.noise(o, t + 0.36, 0.08, { type: 'bandpass', freq: 1500, q: 0.8, gain: 0.4 });
  },
  tick(a, t) {
    const o = a.out(null, 0.3, 0.2, 0);
    a.tone(o, t, 0.06, { type: 'sine', freq: 1000, gain: 0.25 });
  },
  win(a, t) {
    const o = a.out(null, 0.5, 2.5, 0.3);
    [110, 165, 220, 277].forEach((f, i) => a.tone(o, t + i * 0.12, 1.6, { type: 'sawtooth', freq: f, gain: 0.07, attack: 0.08 }));
  },
  lose(a, t) {
    const o = a.out(null, 0.5, 2.5, 0.3);
    [196, 165, 131, 98].forEach((f, i) => a.tone(o, t + i * 0.2, 1.4, { type: 'sawtooth', freq: f, gain: 0.07, attack: 0.05 }));
  },
  ui(a, t) {
    const o = a.out(null, 0.25, 0.1, 0);
    a.noise(o, t, 0.015, { type: 'bandpass', freq: 2200, q: 4, gain: 0.7 });
  },
  pick(a, t) {
    const o = a.out(null, 0.4, 0.3, 0.02);
    a.noise(o, t, 0.03, { type: 'lowpass', freq: 900, gain: 0.8 });
    a.noise(o, t + 0.04, 0.02, { type: 'bandpass', freq: 2600, q: 5, gain: 0.7 });
  },
  snatched(a, t) {
    const o = a.out(null, 0.25, 0.3, 0);
    a.tone(o, t, 0.12, { type: 'sine', freq: 420, to: 330, gain: 0.2 });
  },
};
