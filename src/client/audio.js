import { isCovered } from './sound-surfaces.js';

// 효과음은 전부 Web Audio로 즉석 합성 (소리 파일 없음 → 한 파일로 실행 가능).
// 경로: 소리 → (거리 필터) → (3D 패너) → 마스터 → 먹먹함 필터 → 압축기 → 스피커
//        ├→ 울림(컨볼루션 잔향: 실내는 짧고 촘촘, 실외는 성기게) → 마스터
//        └→ 메아리(지연 + 되먹임: 실외에서 건물 벽에 튕겨 오는 총성) → 마스터
// 공간감: 맵(과학관 = 실내)과 듣는 사람 머리 위(지붕·2층 바닥)로 실내/실외를 정하고 울림·메아리 비율을 바꿈.

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.voices = 0;
    this.listener = { x: 0, y: 0, z: 0 };
    this.map = null;
    this.indoorMap = false;
    this.cover = 0; // 0 = 트인 곳, 1 = 지붕 아래 (부드럽게 바뀜)
    this.amb = null;
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
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.18;
      this.muffle = ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.muffle);
      this.muffle.connect(this.comp);
      this.comp.connect(ctx.destination);
      // 잔향
      this.reverb = ctx.createConvolver();
      this.reverbOut = ctx.createGain();
      this.reverbOut.gain.value = 0.5;
      this.reverb.connect(this.reverbOut);
      this.reverbOut.connect(this.master);
      // 메아리: 건물 사이 메아리 (두 번 정도 되돌아오고 고음이 깎임)
      this.echo = ctx.createDelay(1);
      this.echo.delayTime.value = 0.23;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const echoLp = ctx.createBiquadFilter();
      echoLp.type = 'lowpass';
      echoLp.frequency.value = 1900;
      this.echo.connect(echoLp);
      echoLp.connect(fb);
      fb.connect(this.echo);
      this.echoOut = ctx.createGain();
      this.echoOut.gain.value = 0;
      echoLp.connect(this.echoOut);
      this.echoOut.connect(this.master);
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // 갈색 잡음 (낮은 웅웅거림·바람용)
      this.brownBuf = ctx.createBuffer(1, len * 2, ctx.sampleRate);
      const b = this.brownBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < b.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        b[i] = last * 3.5;
      }
      // 반복 재생할 때 끝과 처음이 이어지도록 (안 그러면 2초마다 '툭' 소리)
      const jump = b[b.length - 1] - b[0];
      for (let i = 0; i < b.length; i++) b[i] -= (jump * i) / (b.length - 1);
      this.applyAcoustics();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.pendingRain != null) {
      const r = this.pendingRain;
      this.pendingRain = null;
      this.setRain(r);
    }
    if (this.pendingAmb) {
      const k = this.pendingAmb;
      this.pendingAmb = null;
      this.startAmbience(k);
    }
  }

  // 저사양: 입체음향을 가벼운 방식(equalpower)으로, 잔향을 짧게 (오디오 처리도 CPU를 꽤 씀)
  setLowPower(on) {
    if (this.lowPower === on) return;
    this.lowPower = on;
    this.applyAcoustics();
  }

  // 맵이 바뀔 때: 실내 맵(과학관)이면 잔향이 촘촘하고 메아리가 없음
  setEnvironment(map) {
    this.map = map;
    this.indoorMap = !!map?.def?.indoor;
    this.cover = this.indoorMap ? 1 : 0;
    this.applyAcoustics();
  }

  applyAcoustics() {
    if (!this.ctx) return;
    const indoor = this.indoorMap;
    this.reverb.buffer = this.makeImpulse(this.lowPower ? 1.1 : indoor ? 1.7 : 2.2, indoor);
    this.updateSpace(true);
  }

  // 듣는 사람 위치에 따라 잔향·메아리 비율 (지붕 아래로 들어가면 메아리가 줄고 울림이 늘어남)
  updateSpace(now = false) {
    if (!this.ctx) return;
    const k = this.indoorMap ? 1 : this.cover;
    const t = this.ctx.currentTime;
    const tc = now ? 0.01 : 0.35;
    this.reverbOut.gain.setTargetAtTime(0.42 + k * 0.25, t, tc);
    this.echoOut.gain.setTargetAtTime(this.indoorMap ? 0 : 0.3 * (1 - k * 0.8), t, tc);
  }

  makeImpulse(seconds, indoor = false) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const decay = indoor ? 3.4 : 2.6;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * decay) * (indoor ? 0.7 : 0.5);
      }
      // 초기 반사음: 실내는 가까운 벽에서 촘촘하게, 실외는 먼 건물에서 드문드문
      const taps = indoor
        ? [[0.011, 0.7], [0.019, 0.6], [0.027, 0.55], [0.038, 0.5], [0.052, 0.45], [0.071, 0.4], [0.095, 0.3]]
        : [[0.023, 0.5], [0.041, 0.4], [0.067, 0.45], [0.11, 0.35], [0.19, 0.25]];
      for (const [tt, g] of taps) {
        const i = Math.floor((tt + ch * 0.0037) * ctx.sampleRate);
        for (let k = 0; k < 60 && i + k < len; k++) d[i + k] += (Math.random() * 2 - 1) * g * Math.exp(-k / 15);
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
      const layers = [layer('highpass', 4200, 0.4, 0.22), layer('bandpass', 1500, 0.6, 0.3), layer('lowpass', 260, 0.7, 0.35)];
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

  // ───────── 맵 배경음 (경기 중에만) ─────────
  //   outdoor: 노을의 바람 · 먼 도시 웅웅거림 · 가끔 새·먼 차 경적·쇠 삐걱임
  //   museum:  환기 장치 웅웅거림 · 실내 공기음 · 가끔 먼 안내 차임·발소리 울림
  startAmbience(kind) {
    if (!this.ctx) {
      this.pendingAmb = kind;
      return;
    }
    this.stopAmbience();
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    out.gain.setTargetAtTime(0.13, ctx.currentTime, 1.2); // 발소리를 가리지 않게 아주 낮게
    const nodes = [];
    const loop = (buf, type, freq, q, gain) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f);
      f.connect(g);
      g.connect(out);
      src.start(0, Math.random());
      nodes.push(src);
      return { src, f, g };
    };
    const lfo = (target, rate, depth) => {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.frequency.value = rate;
      og.gain.value = depth;
      o.connect(og);
      og.connect(target);
      o.start();
      nodes.push(o);
    };
    if (kind === 'museum') {
      const hum = ctx.createOscillator();
      hum.frequency.value = 60;
      const hg = ctx.createGain();
      hg.gain.value = 0.018;
      hum.connect(hg);
      hg.connect(out);
      hum.start();
      nodes.push(hum);
      const hum2 = ctx.createOscillator();
      hum2.type = 'triangle';
      hum2.frequency.value = 120.4;
      const hg2 = ctx.createGain();
      hg2.gain.value = 0.006;
      hum2.connect(hg2);
      hg2.connect(out);
      hum2.start();
      nodes.push(hum2);
      loop(this.brownBuf, 'bandpass', 260, 0.7, 0.05); // 환기구 바람
      loop(this.noiseBuf, 'highpass', 6500, 0.5, 0.006); // 실내 공기
    } else {
      const wind = loop(this.brownBuf, 'bandpass', 420, 0.6, 0.07);
      lfo(wind.g.gain, 0.06, 0.04);
      lfo(wind.f.frequency, 0.045, 160);
      loop(this.brownBuf, 'lowpass', 110, 0.7, 0.07); // 먼 도시
      const gust = loop(this.noiseBuf, 'highpass', 3800, 0.4, 0.004);
      lfo(gust.g.gain, 0.11, 0.004);
    }
    this.amb = { kind, out, nodes, timer: null };
    // 가끔 들리는 소리 (몇 초마다 하나씩)
    const next = () => {
      if (!this.amb || this.amb.kind !== kind) return;
      this.ambientEvent(kind);
      this.amb.timer = setTimeout(next, 5000 + Math.random() * 9000);
    };
    this.amb.timer = setTimeout(next, 3000 + Math.random() * 4000);
  }

  stopAmbience() {
    this.pendingAmb = null;
    const a = this.amb;
    if (!a) return;
    this.amb = null;
    clearTimeout(a.timer);
    const t = this.ctx.currentTime;
    a.out.gain.setTargetAtTime(0, t, 0.3);
    for (const n of a.nodes) n.stop?.(t + 1.5);
    setTimeout(() => a.out.disconnect(), 1800);
  }

  // 배경 속 한 번의 소리: 듣는 사람 주변 먼 곳에서 (입체로)
  ambientEvent(kind) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ang = Math.random() * Math.PI * 2, far = 16 + Math.random() * 18;
    const pos = { x: this.listener.x + Math.cos(ang) * far, y: this.listener.y + 6 + Math.random() * 10, z: this.listener.z + Math.sin(ang) * far };
    const t = this.ctx.currentTime + 0.02;
    const r = Math.random();
    if (kind === 'museum') {
      if (r < 0.35) {
        // 안내 차임 (멀리 울림)
        const o = this.out({ ...pos, y: this.listener.y + 3 }, 0.6, 2.5, 0.9);
        this.tone(o, t, 0.9, { type: 'sine', freq: 784, gain: 0.3, attack: 0.01 });
        this.tone(o, t + 0.35, 1.2, { type: 'sine', freq: 659, gain: 0.3, attack: 0.01 });
      } else {
        // 먼 발소리·문 닫힘이 울림
        const o = this.out({ ...pos, y: this.listener.y }, 0.45, 1.5, 1.0);
        for (let i = 0; i < 3; i++) this.noise(o, t + i * 0.32, 0.04, { type: 'bandpass', freq: 2600, q: 2, gain: 0.6 });
      }
      return;
    }
    if (r < 0.5) {
      // 새 (짧은 지저귐 2~4번)
      const o = this.out(pos, 0.6, 1.4, 0.2);
      const n = 2 + Math.floor(Math.random() * 3), f0 = 2600 + Math.random() * 1200;
      for (let i = 0; i < n; i++) this.tone(o, t + i * 0.13, 0.09, { type: 'sine', freq: f0, to: f0 * 1.3, gain: 0.25 });
    } else if (r < 0.75) {
      // 쇠 구조물 삐걱임
      const o = this.out({ ...pos, y: this.listener.y + 4 }, 0.45, 1.8, 0.5);
      this.tone(o, t, 0.9, { type: 'sawtooth', freq: 180 + Math.random() * 90, to: 130, gain: 0.08, attack: 0.15, vibrato: 7 });
    } else {
      // 먼 차 경적 / 지나가는 차
      const o = this.out({ ...pos, y: this.listener.y }, 0.4, 2.5, 0.6);
      if (r < 0.85) this.tone(o, t, 0.5, { type: 'square', freq: 392, gain: 0.07, attack: 0.02 });
      else this.noise(o, t, 2.2, { type: 'lowpass', freq: 500, gain: 0.5, attack: 0.9, sweepTo: 180 });
    }
  }

  // 체력이 낮거나 섬광을 받으면 소리가 먹먹해짐 (0 = 정상, 1 = 아주 먹먹)
  setMuffle(amount) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(800 / 20000, clamp01(amount));
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
  }

  setListener(pos, fwd) {
    this.listener = { x: pos.x, y: pos.y, z: pos.z };
    if (!this.ctx) return;
    // 머리 위가 막혔는지 (지붕·2층 바닥) → 울림·메아리 비율을 천천히 바꿈
    if (this.map && !this.indoorMap) {
      const k = isCovered(this.map, pos.x, pos.y - 1.6, pos.z) ? 1 : 0;
      if (k !== this.cover) {
        this.cover = k;
        this.updateSpace();
      }
    }
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

  dist(pos) {
    return pos ? Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z) : 0;
  }

  // 소리가 나갈 곳. 위치가 있으면 3D 패너, 멀면 고음이 깎이고 울림이 커짐. echo: 메아리로 보낼 양
  out(pos, vol = 1, dur = 1, reverb = 0.2, echo = 0) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    let head = g;
    if (pos) {
      const d = this.dist(pos);
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
      if (d > 14) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(700, 9000 - d * 125);
        g.connect(lp);
        head = lp;
      }
      head.connect(p);
      p.connect(this.master);
      // 울림·메아리는 직접음보다 천천히 줄어듦 → 멀수록 '울리는 총성'이 되지만 가까운 소리보다 커지지는 않음
      const wet = Math.pow(3 / (3 + Math.max(0, d - 3)), 0.65);
      reverb *= wet * (1 + Math.min(1, d / 30));
      echo *= wet * (1 + Math.min(1, d / 40));
    } else {
      g.connect(this.master);
    }
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      g.connect(send);
      send.connect(this.reverb);
    }
    if (echo > 0 && !this.indoorMap) {
      const send = ctx.createGain();
      send.gain.value = echo;
      g.connect(send);
      send.connect(this.echo);
    }
    this.voices++;
    setTimeout(() => this.voices--, dur * 1000 + 100);
    return g;
  }

  noise(dest, t, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 1, attack = 0.002, sweepTo = null, buf = null } = {}) {
    if (gain <= 0.0002) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf ?? this.noiseBuf;
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
    if (gain <= 0.0002) return;
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

  // 짧은 금속 딸깍 (노리쇠·슬라이드·장비)
  click(dest, t, freq = 3000, gain = 0.6, q = 6) {
    this.noise(dest, t, 0.025, { type: 'bandpass', freq, q, gain, attack: 0.0006 });
  }

  play(name, { pos = null, vol = 1, surface = null } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (pos && Math.hypot(pos.x - this.listener.x, pos.z - this.listener.z) > 110) return;
    if (this.voices > (this.lowPower ? 40 : 60) && pos) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    fn(this, this.ctx.currentTime + 0.005, pos, vol, surface);
  }
}

// ───────── 총성 ─────────
// 가까이: 날카로운 균열음(crack) + 몸통 폭음(body) + 낮은 충격(thump) + 작동음(mech: 슬라이드·노리쇠·펌프)
// 멀리: 균열음이 사라지고 둔탁한 '퍽' + 메아리 (거리에 따라 섞음)
const GUN = {
  pistol: { vol: 0.62, crack: 3200, body: [2300, 900, 0.07], thump: [100, 46, 0.14, 0.75], mech: [[0.035, 3400, 0.45], [0.06, 2600, 0.35]], rev: 0.32, echo: 0.35 },
  sheriff: { vol: 0.8, crack: 2400, body: [1500, 520, 0.11], thump: [66, 30, 0.28, 1.15], mech: [[0.09, 4200, 0.3]], rev: 0.45, echo: 0.55 },
  shotgun: { vol: 0.86, crack: 1900, body: [1000, 300, 0.18], thump: [54, 26, 0.32, 1.25], mech: [[0.34, 1500, 0.55, 0.06], [0.48, 2200, 0.6, 0.05]], rev: 0.5, echo: 0.65 },
  smg: { vol: 0.52, crack: 3600, body: [2600, 1100, 0.05], thump: [118, 62, 0.08, 0.5], mech: [[0.02, 4400, 0.3]], rev: 0.22, echo: 0.25 },
  rifle: { vol: 0.72, crack: 2800, body: [1900, 650, 0.08], thump: [76, 36, 0.2, 1.0], mech: [[0.028, 3600, 0.4]], rev: 0.38, echo: 0.5 },
  sniper: { vol: 0.98, crack: 3800, body: [1600, 420, 0.13], thump: [50, 22, 0.45, 1.3], mech: [[0.55, 2200, 0.5, 0.04], [0.68, 3000, 0.45], [0.82, 2600, 0.5], [0.93, 1800, 0.55, 0.05]], rev: 0.7, echo: 0.9 },
};
function gunshot(a, t, pos, vol, spec) {
  const d = a.dist(pos);
  const near = pos ? clamp01(1 - (d - 8) / 38) : 1;
  const o = a.out(pos, spec.vol * vol, 2.2, spec.rev, spec.echo);
  // 균열음: 공기를 찢는 짧은 고음 (가까울수록)
  a.noise(o, t, 0.011, { type: 'highpass', freq: spec.crack, gain: 1.25 * near, attack: 0.0006 });
  // 몸통 폭음: 내려가는 대역 잡음
  const [b0, b1, bd] = spec.body;
  a.noise(o, t, bd, { type: 'bandpass', freq: b0, q: 0.7, gain: 1.05 * (0.45 + 0.55 * near), attack: 0.0008, sweepTo: b1 });
  // 낮은 충격: 가슴을 치는 저음 (멀어도 남음)
  const [f0, f1, td, tg] = spec.thump;
  a.tone(o, t, td, { type: 'sine', freq: f0, to: f1, gain: tg, attack: 0.0015 });
  a.noise(o, t, td * 1.4, { type: 'lowpass', freq: 520, q: 0.6, gain: 0.8, sweepTo: 120, buf: a.brownBuf });
  // 멀리서: 둔탁한 퍽 소리
  if (near < 0.9) a.noise(o, t, 0.16, { type: 'lowpass', freq: 900, gain: 0.9 * (1 - near), attack: 0.003, sweepTo: 240 });
  // 작동음은 가까울 때만 (내 총이면 확실히)
  if (near > 0.5) for (const [dt, f, g, len] of spec.mech) a.noise(o, t + dt, len ?? 0.022, { type: 'bandpass', freq: f, q: 6, gain: g * near, attack: 0.0006 });
}

const SOUNDS = {
  rifle: (a, t, pos, vol) => gunshot(a, t, pos, vol, GUN.rifle),
  pistol: (a, t, pos, vol) => gunshot(a, t, pos, vol, GUN.pistol),
  sheriff: (a, t, pos, vol) => {
    gunshot(a, t, pos, vol, GUN.sheriff);
    // 실린더가 한 칸 돌아가는 작은 톱니 소리
    if (!pos) a.click(a.out(null, 0.3, 0.3, 0), t + 0.16, 5200, 0.25, 9);
  },
  shotgun: (a, t, pos, vol) => {
    gunshot(a, t, pos, vol, GUN.shotgun);
    // 펌프: 뒤로 당겼다 미는 두 번의 둔탁한 금속음
    const near = pos ? clamp01(1 - (a.dist(pos) - 6) / 20) : 1;
    if (near > 0) {
      const o = a.out(pos, 0.5 * vol * near, 0.8, 0.12);
      a.noise(o, t + 0.34, 0.07, { type: 'lowpass', freq: 700, gain: 0.7 });
      a.noise(o, t + 0.48, 0.06, { type: 'lowpass', freq: 900, gain: 0.7 });
    }
  },
  smg: (a, t, pos, vol) => gunshot(a, t, pos, vol, GUN.smg),
  sniper: (a, t, pos, vol) => gunshot(a, t, pos, vol, GUN.sniper),
  ampShot(a, t) {
    const o = a.out(null, 0.15, 0.2, 0);
    a.tone(o, t, 0.08, { type: 'sawtooth', freq: 520, to: 780, gain: 0.12 });
  },
  dry(a, t) {
    const o = a.out(null, 0.5, 0.1, 0.05);
    a.click(o, t, 3200, 0.8, 4);
    a.noise(o, t + 0.01, 0.03, { type: 'lowpass', freq: 600, gain: 0.3 });
  },
  casing(a, t, pos) {
    const o = a.out(pos, 0.12, 0.3, 0.1);
    const f = 3600 + Math.random() * 900;
    a.tone(o, t, 0.06, { type: 'sine', freq: f, gain: 0.25 });
    a.tone(o, t + 0.07 + Math.random() * 0.03, 0.04, { type: 'sine', freq: f * 1.4, gain: 0.12 });
    a.tone(o, t + 0.15 + Math.random() * 0.04, 0.03, { type: 'sine', freq: f * 1.2, gain: 0.07 });
  },
  // 재장전: 탄창 멈치 → 빈 탄창 빠짐 → 새 탄창 끼움(둔탁 + 딸깍) → 노리쇠
  reload(a, t, pos, vol) {
    const o = a.out(pos, 0.55 * vol, 2.4, 0.08);
    a.click(o, t + 0.22, 3000, 0.7, 5);
    a.noise(o, t + 0.3, 0.14, { type: 'bandpass', freq: 1400, q: 1.5, gain: 0.35, sweepTo: 600 });
    a.noise(o, t + 1.02, 0.06, { type: 'lowpass', freq: 600, gain: 0.9 });
    a.click(o, t + 1.07, 2600, 0.9, 6);
    a.noise(o, t + 1.72, 0.05, { type: 'bandpass', freq: 1200, q: 2, gain: 0.5, sweepTo: 2600 });
    a.click(o, t + 1.9, 2000, 0.9, 5);
    a.click(o, t + 1.94, 3400, 0.5, 7);
  },
  swap(a, t) {
    const o = a.out(null, 0.35, 0.4, 0.05);
    a.noise(o, t, 0.16, { type: 'bandpass', freq: 500, q: 0.8, gain: 0.45, sweepTo: 1200 });
    a.click(o, t + 0.18, 2400, 0.6, 5);
  },
  knife(a, t, pos) {
    const o = a.out(pos, 0.45, 0.3, 0.05);
    a.noise(o, t, 0.13, { type: 'bandpass', freq: 900, q: 1.2, gain: 0.6, sweepTo: 3600 });
  },
  knifeHit(a, t, pos) {
    const o = a.out(pos, 0.6, 0.3, 0.1);
    a.noise(o, t, 0.08, { type: 'lowpass', freq: 500, gain: 1 });
    a.tone(o, t, 0.08, { type: 'sine', freq: 140, to: 70, gain: 0.6 });
  },
  // ───────── 발소리 (바닥 재질별) ─────────
  step(a, t, pos, vol, surface) {
    const o = a.out(pos, 0.6 * vol, 0.3, surface === 'tile' ? 0.16 : 0.08);
    stepLayers(a, o, t, surface, 1);
    // 달릴 때 장비가 덜그럭
    if (Math.random() < 0.45) a.noise(o, t + 0.03 + Math.random() * 0.04, 0.03, { type: 'bandpass', freq: 3600 + Math.random() * 1500, q: 7, gain: 0.12 });
    if (a.wet && surface !== 'tile' && surface !== 'metal') a.noise(o, t + 0.015, 0.09, { type: 'bandpass', freq: 3200 + Math.random() * 900, q: 2.2, gain: 0.35, sweepTo: 1800 });
  },
  quietStep(a, t, pos, vol, surface) {
    const o = a.out(pos, 0.16 * vol, 0.15, 0.02);
    stepLayers(a, o, t, surface, 0.6);
    if (a.wet && surface !== 'tile') a.noise(o, t + 0.01, 0.05, { type: 'bandpass', freq: 2600, q: 2, gain: 0.15 });
  },
  impact(a, t, pos) {
    // 탄이 몸에 맞는 둔탁한 소리 (가까울 때만 들림)
    const o = a.out(pos, 0.38, 0.15, 0.05);
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
    const o = a.out(null, 0.25, 0.3, 0);
    a.tone(o, t, 0.04, { type: 'square', freq: 980, gain: 0.08 });
    a.noise(o, t + 0.03, 0.12, { type: 'bandpass', freq: 2200, q: 1.3, gain: 0.45 });
  },
  wheel(a, t) {
    const o = a.out(null, 0.15, 0.1, 0);
    a.click(o, t, 3800, 0.5, 6);
  },
  // 개념 카드 획득: 계측기가 값을 읽는 듯한 맑은 두 음
  concept(a, t) {
    const o = a.out(null, 0.22, 0.8, 0.15);
    a.tone(o, t, 0.25, { type: 'sine', freq: 880, gain: 0.5 });
    a.tone(o, t + 0.12, 0.45, { type: 'sine', freq: 1320, gain: 0.45 });
    a.tone(o, t + 0.12, 0.3, { type: 'sine', freq: 2640, gain: 0.08 });
  },
  inspect(a, t) {
    const o = a.out(null, 0.3, 0.6, 0.03);
    a.click(o, t + 0.05, 2800, 0.7, 6);
    a.click(o, t + 0.3, 1900, 0.8, 5);
  },
  thunder(a, t, pos, vol) {
    const o = a.out(null, 0.9 * vol, 6, 0.6);
    a.noise(o, t, 0.25, { type: 'lowpass', freq: 900, gain: 0.5, attack: 0.02 });
    a.noise(o, t + 0.1, 4.5, { type: 'lowpass', freq: 220, q: 0.8, gain: 0.4, attack: 0.3, sweepTo: 60, buf: a.brownBuf });
    a.noise(o, t + 0.6, 2.5, { type: 'lowpass', freq: 140, gain: 0.7, attack: 0.4 });
  },
  land(a, t, pos, vol, surface) {
    const o = a.out(pos, 0.5 * vol, 0.4, 0.12);
    a.noise(o, t, 0.16, { type: 'lowpass', freq: 280, gain: 0.35, buf: a.brownBuf });
    a.tone(o, t, 0.12, { type: 'sine', freq: 75, to: 45, gain: 0.3 });
    stepLayers(a, o, t + 0.01, surface, 0.8);
    a.noise(o, t + 0.04, 0.05, { type: 'bandpass', freq: 3800, q: 6, gain: 0.25 }); // 장비 흔들림
    if (a.wet && surface !== 'tile') a.noise(o, t + 0.02, 0.18, { type: 'bandpass', freq: 2600, q: 1.4, gain: 0.45, sweepTo: 1200 });
  },
  // ───────── 내가 맞혔을 때 (몸통 · 보호막 · 머리 · 보호막 깨짐) ─────────
  hit(a, t) {
    const o = a.out(null, 0.26, 0.12, 0);
    a.noise(o, t, 0.03, { type: 'bandpass', freq: 1700, q: 1.6, gain: 0.9, attack: 0.0006 });
    a.tone(o, t, 0.05, { type: 'sine', freq: 180, to: 110, gain: 0.45 });
    a.tone(o, t, 0.035, { type: 'triangle', freq: 900, to: 700, gain: 0.12 });
  },
  armorHit(a, t) {
    const o = a.out(null, 0.28, 0.15, 0);
    a.tone(o, t, 0.06, { type: 'triangle', freq: 1900, to: 1500, gain: 0.25 });
    a.noise(o, t, 0.03, { type: 'bandpass', freq: 3000, q: 3, gain: 0.5, attack: 0.0006 });
    a.tone(o, t, 0.05, { type: 'sine', freq: 240, to: 160, gain: 0.25 });
  },
  armorBreak(a, t) {
    const o = a.out(null, 0.4, 0.6, 0.08);
    a.noise(o, t, 0.25, { type: 'highpass', freq: 2500, gain: 0.6, sweepTo: 6000 });
    a.tone(o, t, 0.3, { type: 'triangle', freq: 1300, to: 420, gain: 0.25 });
    a.tone(o, t + 0.05, 0.2, { type: 'sine', freq: 2600, to: 900, gain: 0.12 });
  },
  headshot(a, t) {
    // 헬멧을 때리는 맑은 금속음
    const o = a.out(null, 0.42, 0.4, 0.06);
    a.noise(o, t, 0.02, { type: 'highpass', freq: 4500, gain: 0.7, attack: 0.0004 });
    a.tone(o, t, 0.22, { type: 'sine', freq: 3150, gain: 0.32 });
    a.tone(o, t, 0.14, { type: 'sine', freq: 4720, gain: 0.16 });
    a.tone(o, t, 0.08, { type: 'sine', freq: 6300, gain: 0.06 });
  },
  kill(a, t) {
    const o = a.out(null, 0.4, 0.3, 0);
    a.tone(o, t, 0.12, { type: 'sine', freq: 180, to: 120, gain: 0.5 });
    a.noise(o, t, 0.05, { type: 'bandpass', freq: 900, q: 2, gain: 0.4 });
  },
  // ───────── 라운드 알림 (짧은 음악 신호: 연구소 계기음 톤) ─────────
  roundWin(a, t) {
    const o = a.out(null, 0.42, 2.2, 0.4);
    // 장조 화음이 차례로 쌓이고 위로 맑은 음
    [262, 330, 392, 523].forEach((f, i) => {
      a.tone(o, t + i * 0.08, 1.1 - i * 0.1, { type: 'triangle', freq: f, gain: 0.2, attack: 0.012 });
      a.tone(o, t + i * 0.08, 1.0 - i * 0.1, { type: 'sine', freq: f * 2, gain: 0.05, attack: 0.012 });
    });
    a.tone(o, t + 0.36, 1.2, { type: 'sine', freq: 1046, gain: 0.08, attack: 0.05 });
  },
  roundLose(a, t) {
    const o = a.out(null, 0.42, 2.2, 0.4);
    [392, 311, 262, 196].forEach((f, i) => a.tone(o, t + i * 0.15, 0.9, { type: 'triangle', freq: f, gain: 0.18, attack: 0.02 }));
    a.noise(o, t, 0.8, { type: 'lowpass', freq: 300, gain: 0.25, attack: 0.1, buf: a.brownBuf });
  },
  // 구매(보급) 시간 시작: 계기가 켜지는 스윕 + 두 번 삑
  roundPrep(a, t) {
    const o = a.out(null, 0.35, 1.2, 0.2);
    a.noise(o, t, 0.5, { type: 'bandpass', freq: 400, q: 0.7, gain: 0.45, sweepTo: 1800 });
    a.tone(o, t + 0.45, 0.12, { type: 'sine', freq: 1047, gain: 0.2 });
    a.tone(o, t + 0.62, 0.2, { type: 'sine', freq: 1568, gain: 0.18 });
  },
  buy(a, t) {
    const o = a.out(null, 0.35, 0.3, 0.05);
    a.tone(o, t, 0.06, { type: 'triangle', freq: 1320, gain: 0.25 });
    a.tone(o, t + 0.05, 0.1, { type: 'triangle', freq: 1760, gain: 0.22 });
    a.click(o, t, 2600, 0.4, 3);
  },
  sell(a, t) {
    const o = a.out(null, 0.3, 0.3, 0.05);
    a.tone(o, t, 0.08, { type: 'triangle', freq: 1320, to: 880, gain: 0.22 });
  },
  hurt(a, t) {
    // 맞은 충격: 둔탁한 저음 + 짧은 숨 (너무 크게 울려 화면·소리를 가리지 않게)
    const o = a.out(null, 0.5, 0.35, 0);
    a.noise(o, t, 0.16, { type: 'lowpass', freq: 380, gain: 1, buf: a.brownBuf });
    a.tone(o, t, 0.14, { type: 'sine', freq: 85, to: 52, gain: 0.65 });
    a.noise(o, t + 0.04, 0.12, { type: 'bandpass', freq: 1200, q: 0.8, gain: 0.12 });
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
    a.noise(o, t + 0.1, 0.6, { type: 'bandpass', freq: 2400, q: 1, gain: 0.08, sweepTo: 900 }); // 바디캠 신호 끊김
  },
  // ───────── 포스 패치 ─────────
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
  // ───────── 힘 장치 ─────────
  // 지레 셔터: 철판 마디가 말리며 덜컹덜컹 + 모터 웅
  shutter(a, t, pos, vol) {
    const o = a.out(pos, 0.55 * vol, 1.1, 0.3, 0.2);
    for (let i = 0; i < 10; i++) a.noise(o, t + i * 0.068, 0.05, { type: 'bandpass', freq: 800 + Math.random() * 600, q: 5, gain: 0.5 });
    a.noise(o, t, 0.75, { type: 'lowpass', freq: 240, gain: 0.4, attack: 0.05, buf: a.brownBuf });
    a.tone(o, t, 0.7, { type: 'sawtooth', freq: 95, to: 88, gain: 0.04, attack: 0.05 });
  },
  shutterStop(a, t, pos, vol) {
    const o = a.out(pos, 0.65 * vol, 0.6, 0.3, 0.25);
    a.noise(o, t, 0.15, { type: 'lowpass', freq: 380, gain: 1, buf: a.brownBuf });
    a.tone(o, t, 0.2, { type: 'sine', freq: 90, to: 60, gain: 0.5 });
    a.click(o, t + 0.02, 1500, 0.5, 4);
  },
  // 미는 상자: 바닥을 긁으며 한 칸
  cratePush(a, t, pos, vol) {
    const o = a.out(pos, 0.55 * vol, 0.6, 0.2);
    a.noise(o, t, 0.32, { type: 'bandpass', freq: 320, q: 1.2, gain: 0.9, attack: 0.03, sweepTo: 180 });
    a.noise(o, t, 0.3, { type: 'bandpass', freq: 1600, q: 3, gain: 0.15, attack: 0.04 });
    a.noise(o, t + 0.3, 0.08, { type: 'lowpass', freq: 200, gain: 0.7 });
  },
  // 승강기 도착: 쿵 + 브레이크 쉬익 + 도착 차임
  liftStop(a, t, pos, vol) {
    const o = a.out(pos, 0.45 * vol, 0.8, 0.2);
    a.noise(o, t, 0.12, { type: 'lowpass', freq: 300, gain: 0.8, buf: a.brownBuf });
    a.noise(o, t + 0.05, 0.25, { type: 'highpass', freq: 3000, gain: 0.12, sweepTo: 1500 });
    a.tone(o, t + 0.12, 0.35, { type: 'sine', freq: 988, gain: 0.08 });
  },
  // 탄성 발판: 용수철이 튕기는 '보잉' + 착지 충격
  pad(a, t, pos, vol) {
    const o = a.out(pos, 0.6 * vol, 0.8, 0.15);
    a.noise(o, t, 0.1, { type: 'lowpass', freq: 220, gain: 1, buf: a.brownBuf });
    a.tone(o, t, 0.12, { type: 'sine', freq: 95, to: 55, gain: 0.8 });
    a.tone(o, t + 0.03, 0.42, { type: 'triangle', freq: 300, to: 560, gain: 0.16, vibrato: 32 });
    a.tone(o, t + 0.03, 0.3, { type: 'sine', freq: 1200, to: 1700, gain: 0.05 });
  },
  amp(a, t, pos, vol) {
    const o = a.out(pos, 0.4 * vol, 0.6, 0.05);
    a.tone(o, t, 0.4, { type: 'sine', freq: 500, to: 2300, gain: 0.18 });
    a.click(o, t + 0.38, 2500, 0.6, 5);
  },
  rounds(a, t, pos, vol) {
    const o = a.out(pos, 0.4 * vol, 0.5, 0.05);
    a.click(o, t, 2200, 0.7, 5);
    a.click(o, t + 0.12, 1800, 0.7, 5);
    a.tone(o, t, 0.25, { type: 'sine', freq: 900, to: 1400, gain: 0.08 });
  },
  ricochet(a, t, pos) {
    const o = a.out(pos, 0.35, 0.4, 0.2, 0.1);
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
    a.noise(o, t, 2.6, { type: 'lowpass', freq: 500, gain: 0.8, attack: 0.4, buf: a.brownBuf });
    a.noise(o, t, 2.4, { type: 'bandpass', freq: 1200, q: 0.6, gain: 0.25, attack: 0.5 });
  },
  collapse(a, t, pos, vol) {
    const o = a.out(pos, 0.9 * vol, 4, 0.4, 0.3);
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
    a.tone(o, t, 0.09, { type: 'square', freq: 220, gain: 0.08 });
    a.noise(o, t, 0.05, { type: 'bandpass', freq: 400, q: 3, gain: 0.5 });
  },
  beep(a, t, pos, vol) {
    const o = a.out(pos, 0.25 * vol, 0.15, 0.1);
    a.tone(o, t, 0.05, { type: 'square', freq: 1350, gain: 0.3 });
  },
  card(a, t) {
    const o = a.out(null, 0.4, 0.1, 0);
    a.click(o, t, 2600, 0.9, 5);
  },
  match(a, t) {
    const o = a.out(null, 0.5, 1.2, 0.05);
    a.noise(o, t, 0.08, { type: 'lowpass', freq: 700, gain: 0.9 });
    for (let i = 0; i < 5; i++) a.click(o, t + 0.12 + i * 0.13, 2200, 0.6, 6);
    a.tone(o, t + 0.75, 0.25, { type: 'sine', freq: 1568, gain: 0.12 });
  },
  defused(a, t) {
    const o = a.out(null, 0.45, 0.8, 0.1);
    a.noise(o, t, 0.06, { type: 'bandpass', freq: 1800, q: 1, gain: 0.4 });
    a.tone(o, t + 0.08, 0.14, { type: 'sine', freq: 880, gain: 0.3 });
    a.tone(o, t + 0.26, 0.2, { type: 'sine', freq: 1320, gain: 0.3 });
    a.tone(o, t + 0.44, 0.35, { type: 'sine', freq: 1760, gain: 0.2 });
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
    a.noise(o, t, 0.08, { type: 'highpass', freq: 1500, gain: 0.8, attack: 0.002 });
    a.noise(o, t, 3.0, { type: 'lowpass', freq: 3000, sweepTo: 60, gain: 1, attack: 0.005 });
    a.noise(o, t, 2.5, { type: 'lowpass', freq: 160, gain: 0.9, attack: 0.01, buf: a.brownBuf });
    a.tone(o, t, 1.8, { type: 'sine', freq: 55, to: 20, gain: 1 });
    for (let i = 0; i < 6; i++) a.noise(o, t + 0.4 + Math.random() * 1.6, 0.05, { type: 'bandpass', freq: 1500 + Math.random() * 2000, q: 3, gain: 0.2 }); // 떨어지는 파편
  },
  // 교전 개시: 무전 '삑' + 두 음 (연구소 작전 시작)
  roundStart(a, t) {
    const o = a.out(null, 0.4, 1.2, 0.12);
    a.noise(o, t, 0.1, { type: 'bandpass', freq: 1500, q: 0.8, gain: 0.45 });
    a.tone(o, t + 0.12, 0.16, { type: 'sine', freq: 784, gain: 0.22 });
    a.tone(o, t + 0.3, 0.3, { type: 'sine', freq: 1175, gain: 0.22 });
    a.noise(o, t + 0.62, 0.07, { type: 'bandpass', freq: 1500, q: 0.8, gain: 0.35 });
  },
  tick(a, t) {
    const o = a.out(null, 0.3, 0.2, 0);
    a.tone(o, t, 0.06, { type: 'sine', freq: 1000, gain: 0.25 });
  },
  win(a, t) {
    const o = a.out(null, 0.32, 3, 0.35);
    [131, 165, 196, 262, 330].forEach((f, i) => a.tone(o, t + i * 0.1, 2.2 - i * 0.1, { type: i < 3 ? 'triangle' : 'sine', freq: f, gain: 0.12, attack: 0.06 }));
    a.tone(o, t + 0.55, 1.6, { type: 'sine', freq: 523, gain: 0.08, attack: 0.1 });
  },
  lose(a, t) {
    const o = a.out(null, 0.32, 3, 0.35);
    [196, 156, 131, 98].forEach((f, i) => a.tone(o, t + i * 0.22, 1.6, { type: 'triangle', freq: f, gain: 0.12, attack: 0.05 }));
    a.noise(o, t, 1.6, { type: 'lowpass', freq: 220, gain: 0.25, attack: 0.3, buf: a.brownBuf });
  },
  ui(a, t) {
    const o = a.out(null, 0.25, 0.1, 0);
    a.click(o, t, 2200, 0.7, 4);
  },
  pick(a, t) {
    const o = a.out(null, 0.4, 0.3, 0.02);
    a.noise(o, t, 0.03, { type: 'lowpass', freq: 900, gain: 0.8 });
    a.click(o, t + 0.04, 2600, 0.7, 5);
  },
  snatched(a, t) {
    const o = a.out(null, 0.25, 0.3, 0);
    a.tone(o, t, 0.12, { type: 'sine', freq: 420, to: 330, gain: 0.2 });
  },
};

// 발소리 층: 바닥 재질마다 다른 소리
//   concrete 콘크리트: 둔탁한 쿵 + 모래 긁힘 / metal 철제 통로: 쨍그랑 울림 + 낮은 공명
//   tile 과학관 타일: 또각 굽 소리 + 짧은 울림 / stairs 계단: 무거운 쿵 + 끌림
function stepLayers(a, o, t, surface, k) {
  const r = Math.random();
  switch (surface) {
    case 'metal':
      a.noise(o, t, 0.05, { type: 'lowpass', freq: 380, gain: 0.7 * k });
      a.noise(o, t, 0.09, { type: 'bandpass', freq: 1000 + r * 400, q: 4, gain: 0.55 * k });
      a.tone(o, t, 0.16, { type: 'triangle', freq: 190 + r * 70, to: 160, gain: 0.12 * k });
      a.noise(o, t + 0.005, 0.12, { type: 'bandpass', freq: 2400 + r * 600, q: 9, gain: 0.18 * k });
      break;
    case 'tile':
      a.noise(o, t, 0.035, { type: 'bandpass', freq: 2800 + r * 700, q: 2.2, gain: 0.55 * k, attack: 0.0006 });
      a.noise(o, t, 0.05, { type: 'lowpass', freq: 320, gain: 0.55 * k });
      break;
    case 'stairs':
      a.noise(o, t, 0.08, { type: 'lowpass', freq: 240 + r * 80, gain: 1.0 * k, buf: a.brownBuf });
      a.noise(o, t + 0.02, 0.06, { type: 'bandpass', freq: 1300, q: 1.2, gain: 0.25 * k, sweepTo: 700 });
      break;
    default:
      a.noise(o, t, 0.06, { type: 'lowpass', freq: 260 + r * 120, gain: 1.0 * k });
      a.noise(o, t + 0.01, 0.045, { type: 'bandpass', freq: 2000 + r * 600, q: 1.5, gain: 0.32 * k });
  }
}

// 처치 확인음: 둔탁한 확인 + 맑은 두 음 (연속 처치일수록 한 단계씩 높아지고 겹이 늘어남, 과하지 않게)
for (let n = 1; n <= 5; n++) {
  SOUNDS[`kill${n}`] = (a, t) => {
    const o = a.out(null, 0.42, 0.9, 0.15);
    const base = 520 * Math.pow(1.122, n - 1);
    a.tone(o, t, 0.1, { type: 'sine', freq: 150, to: 90, gain: 0.45 });
    a.noise(o, t, 0.04, { type: 'highpass', freq: 3000, gain: 0.45, attack: 0.0005 });
    a.tone(o, t, 0.16, { type: 'triangle', freq: base, gain: 0.28 });
    a.tone(o, t + 0.07, 0.3 + n * 0.04, { type: 'triangle', freq: base * 1.5, gain: 0.24 });
    if (n >= 3) a.tone(o, t + 0.14, 0.4, { type: 'sine', freq: base * 2, gain: 0.14 });
    if (n === 5) a.tone(o, t + 0.21, 0.6, { type: 'sine', freq: base * 3, gain: 0.1, vibrato: 6 });
  };
}
