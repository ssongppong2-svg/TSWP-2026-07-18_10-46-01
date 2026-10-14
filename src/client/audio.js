import { isCovered } from './sound-surfaces.js';

// 효과음은 전부 Web Audio로 즉석 합성 (소리 파일 없음 → 한 파일로 실행 가능).
// 경로: 소리 → (거리 필터) → (3D 패너) → 마스터 → 먹먹함 필터 → 저음 강화 · 고음 살짝 깎기 → 압축기 → 스피커
//   (무겁게: 전체 크기는 그대로 두고 저음 비율·꼬리·울림을 늘림)
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
      // 압축기 문턱·비율은 그대로 (바꾸면 자동 보정 이득 때문에 모든 소리가 같이 커짐) · 풀림만 조금 길게 → 큰 소리 뒤 묵직하게 가라앉음
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 5;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.22;
      this.muffle = ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      // 저음 강화 (가슴을 치는 대역) · 아주 높은 고음은 살짝 깎아 귀가 덜 따갑게
      this.lowShelf = ctx.createBiquadFilter();
      this.lowShelf.type = 'lowshelf';
      this.lowShelf.frequency.value = 110;
      this.lowShelf.gain.value = 4;
      this.highShelf = ctx.createBiquadFilter();
      this.highShelf.type = 'highshelf';
      this.highShelf.frequency.value = 9000;
      this.highShelf.gain.value = -2;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.muffle);
      this.muffle.connect(this.lowShelf);
      this.lowShelf.connect(this.highShelf);
      this.highShelf.connect(this.comp);
      // 마지막 안전 장치: -3 dB까지는 그대로, 그 위 순간 최고치만 부드럽게 눌러 찢어지는 소리(클리핑) 방지
      this.limitIn = ctx.createGain();
      this.limitIn.gain.value = 0.5; // 곡선이 -2..2 범위를 받도록 절반으로 넣음
      this.limiter = ctx.createWaveShaper();
      this.limiter.curve = softClipCurve();
      this.comp.connect(this.limitIn);
      this.limitIn.connect(this.limiter);
      this.limiter.connect(ctx.destination);
      // 잔향
      this.reverb = ctx.createConvolver();
      this.reverbOut = ctx.createGain();
      this.reverbOut.gain.value = 0.5;
      this.reverb.connect(this.reverbOut);
      this.reverbOut.connect(this.master);
      // 메아리: 건물 사이 메아리 (두 번 정도 되돌아오고 고음이 깎임)
      this.echo = ctx.createDelay(1);
      this.echo.delayTime.value = 0.29;
      const fb = ctx.createGain();
      fb.gain.value = 0.42;
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
    // 울림 길이: 실내 2.3초 · 실외 3초 (저사양은 짧게)
    this.reverb.buffer = this.makeImpulse(this.lowPower ? 1.1 : indoor ? 2.3 : 3.0, indoor);
    this.updateSpace(true);
  }

  // 듣는 사람 위치에 따라 잔향·메아리 비율 (지붕 아래로 들어가면 메아리가 줄고 울림이 늘어남)
  updateSpace(now = false) {
    if (!this.ctx) return;
    const k = this.indoorMap ? 1 : this.cover;
    const t = this.ctx.currentTime;
    const tc = now ? 0.01 : 0.35;
    // 울림·메아리는 크기보다 길이로 무겁게 (임펄스·되먹임이 길어진 만큼 크기는 거의 그대로)
    this.reverbOut.gain.setTargetAtTime(0.44 + k * 0.25, t, tc);
    this.echoOut.gain.setTargetAtTime(this.indoorMap ? 0 : 0.34 * (1 - k * 0.8), t, tc);
  }

  makeImpulse(seconds, indoor = false) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const decay = indoor ? 2.6 : 1.9; // 작을수록 길게 남음
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
    this.rainLevel = intensity;
    this.shelter = false;
    if (this.rain) {
      this.rain.out.gain.setTargetAtTime(intensity * 0.55, ctx.currentTime, 0.8);
      this.rain.layers[0].g.gain.setTargetAtTime(0.22, ctx.currentTime, 0.8);
    }
  }

  // 지붕 아래(실내)에 들어가면 빗소리가 멀어지고 높은 쉬익 소리가 줄어듦 (지붕을 두드리는 낮은 소리만)
  setShelter(indoor) {
    if (!this.rain || !this.ctx || this.shelter === indoor) return;
    this.shelter = indoor;
    const t = this.ctx.currentTime;
    this.rain.out.gain.setTargetAtTime((this.rainLevel ?? 1) * (indoor ? 0.22 : 0.55), t, 0.45);
    this.rain.layers[0].g.gain.setTargetAtTime(indoor ? 0.03 : 0.22, t, 0.45);
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

  // ───────── 계속 나는 소리 (드론 프로펠러 등): key로 켜고·옮기고·끔 ─────────
  setLoop(key, kind, pos) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.loops ??= new Map();
    let L = this.loops.get(key);
    if (!L) {
      const ctx = this.ctx;
      const p = ctx.createPanner();
      p.panningModel = this.lowPower ? 'equalpower' : 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 2;
      p.rolloffFactor = 1.4;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(kind === 'drone' ? 0.12 : kind === 'rc' ? 0.07 : 0.1, ctx.currentTime, 0.2);
      g.connect(p);
      p.connect(this.master);
      const nodes = [];
      const rc = kind === 'rc';
      // 드론: 프로펠러 윙 (톱니파 두 개가 살짝 어긋나 맥놀이) + 바람 소리 · RC카: 작은 모터의 높은 윙 + 바퀴 구르는 소리
      for (const [f, gain] of rc ? [[412, 0.26], [418.5, 0.22], [826, 0.07]] : [[172, 0.35], [176.5, 0.3], [344, 0.12]]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = gain;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = rc ? 1500 : 900;
        bp.Q.value = 0.7;
        o.connect(bp);
        bp.connect(og);
        og.connect(g);
        o.start();
        nodes.push(o);
      }
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      n.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = rc ? 600 : 2400;
      nf.Q.value = 0.6;
      const ng = ctx.createGain();
      ng.gain.value = rc ? 0.35 : 0.25;
      n.connect(nf);
      nf.connect(ng);
      ng.connect(g);
      n.start();
      nodes.push(n);
      L = { p, g, nodes };
      this.loops.set(key, L);
    }
    const t = this.ctx.currentTime;
    if (L.p.positionX) {
      L.p.positionX.setTargetAtTime(pos.x, t, 0.05);
      L.p.positionY.setTargetAtTime(pos.y, t, 0.05);
      L.p.positionZ.setTargetAtTime(pos.z, t, 0.05);
    } else L.p.setPosition(pos.x, pos.y, pos.z);
  }

  stopLoop(key) {
    const L = this.loops?.get(key);
    if (!L) return;
    this.loops.delete(key);
    const t = this.ctx.currentTime;
    L.g.gain.setTargetAtTime(0, t, 0.15);
    for (const n of L.nodes) n.stop(t + 0.6);
    setTimeout(() => L.p.disconnect(), 900);
  }

  stopAllLoops() {
    for (const key of [...(this.loops?.keys() ?? [])]) this.stopLoop(key);
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

  play(name, { pos = null, vol = 1, surface = null, extra = null } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (pos && Math.hypot(pos.x - this.listener.x, pos.z - this.listener.z) > 110) return;
    if (this.voices > (this.lowPower ? 40 : 60) && pos) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    fn(this, this.ctx.currentTime + 0.005, pos, vol, surface, extra);
  }
}

// ───────── 총성 ─────────
// 가까이: 날카로운 균열음(crack) + 몸통 폭음(body) + 낮은 충격(thump) + 작동음(mech: 슬라이드·노리쇠·펌프)
// 멀리: 균열음이 사라지고 둔탁한 '퍽' + 메아리 (거리에 따라 섞음)
// 부드러운 최고치 제한 곡선: 입력은 실제 값의 절반(-2..2 → -1..1). |u| ≤ 0.7(-3 dB)까지 그대로, 그 위는 1에 천천히 다가감
function softClipCurve(n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = ((i / (n - 1)) * 2 - 1) * 2;
    const m = Math.abs(u);
    c[i] = Math.sign(u) * (m <= 0.7 ? m : 0.7 + 0.3 * Math.tanh((m - 0.7) / 0.3));
  }
  return c;
}

const GUN = {
  pistol: { vol: 0.62, crack: 3200, body: [2300, 900, 0.07], thump: [100, 46, 0.14, 0.75], mech: [[0.035, 3400, 0.45], [0.06, 2600, 0.35]], rev: 0.32, echo: 0.35 },
  sheriff: { vol: 0.8, crack: 2400, body: [1500, 520, 0.11], thump: [66, 30, 0.28, 1.15], mech: [[0.09, 4200, 0.3]], rev: 0.45, echo: 0.55 },
  shotgun: { vol: 0.86, crack: 1900, body: [1000, 300, 0.18], thump: [54, 26, 0.32, 1.25], mech: [[0.34, 1500, 0.55, 0.06], [0.48, 2200, 0.6, 0.05]], rev: 0.5, echo: 0.65 },
  smg: { vol: 0.52, crack: 3600, body: [2600, 1100, 0.05], thump: [118, 62, 0.08, 0.5], mech: [[0.02, 4400, 0.3]], rev: 0.22, echo: 0.25 },
  rifle: { vol: 0.72, crack: 2800, body: [1900, 650, 0.08], thump: [76, 36, 0.2, 1.0], mech: [[0.028, 3600, 0.4]], rev: 0.38, echo: 0.5 },
  // 기관권총: 권총보다 가볍고 빠른 '탁탁탁' · 단축 카빈: 짧은 총열이라 폭음이 크고 거칠게 · 3점사 소총: 단단하고 짧게
  mpistol: { vol: 0.56, crack: 3500, body: [2500, 1000, 0.05], thump: [112, 56, 0.08, 0.55], mech: [[0.022, 4100, 0.3]], rev: 0.24, echo: 0.28 },
  carbine: { vol: 0.78, crack: 2500, body: [1700, 560, 0.095], thump: [70, 32, 0.22, 1.05], mech: [[0.026, 3500, 0.38]], rev: 0.42, echo: 0.55 },
  burst: { vol: 0.7, crack: 3000, body: [2050, 720, 0.07], thump: [80, 38, 0.18, 0.95], mech: [[0.022, 3900, 0.34]], rev: 0.36, echo: 0.5 },
  // 지정사수 소총: 큰 탄 · 깊은 폭음과 긴 울림 · 경기관총: 묵직한 연사 + 탄띠 고리 소리
  dmr: { vol: 0.9, crack: 3300, body: [1450, 440, 0.12], thump: [56, 25, 0.36, 1.25], mech: [[0.03, 3000, 0.5]], rev: 0.6, echo: 0.8 },
  lmg: { vol: 0.8, crack: 2700, body: [1650, 520, 0.1], thump: [64, 30, 0.26, 1.12], mech: [[0.028, 2600, 0.42], [0.046, 5200, 0.22, 0.012]], rev: 0.46, echo: 0.62 },
  sniper: { vol: 0.98, crack: 3800, body: [1600, 420, 0.13], thump: [50, 22, 0.45, 1.3], mech: [[0.55, 2200, 0.5, 0.04], [0.68, 3000, 0.45], [0.82, 2600, 0.5], [0.93, 1800, 0.55, 0.05]], rev: 0.7, echo: 0.9 },
};
function gunshot(a, t, pos, vol, spec) {
  const d = a.dist(pos);
  const near = pos ? clamp01(1 - (d - 8) / 38) : 1;
  // 몸통 크기는 예전과 비슷하게(약 +3 dB) 두고 저음·꼬리·울림을 늘려 무게를 냄
  const o = a.out(pos, spec.vol * vol * 0.88, 3, spec.rev * 1.15, spec.echo * 1.2);
  // 균열음: 공기를 찢는 짧은 고음 (가까울수록)
  a.noise(o, t, 0.011, { type: 'highpass', freq: spec.crack, gain: 1.25 * near, attack: 0.0006 });
  // 몸통 폭음: 내려가는 대역 잡음
  const [b0, b1, bd] = spec.body;
  a.noise(o, t, bd, { type: 'bandpass', freq: b0, q: 0.7, gain: 1.05 * (0.45 + 0.55 * near), attack: 0.0008, sweepTo: b1 });
  // 낮은 충격: 가슴을 치는 저음 (멀어도 남음)
  const [f0, f1, td, tg] = spec.thump;
  a.tone(o, t, td * 1.25, { type: 'sine', freq: f0, to: f1, gain: tg * 1.05, attack: 0.0015 });
  a.noise(o, t, td * 1.7, { type: 'lowpass', freq: 520, q: 0.6, gain: 0.85, sweepTo: 110, buf: a.brownBuf });
  // 서브 저음: 큰 총일수록 길고 깊게 (가까울수록 가슴에 울림 · 노트북 스피커에서도 들리게 38 Hz 아래로는 안 내려감)
  a.tone(o, t + 0.002, 0.16 + tg * 0.2, { type: 'sine', freq: Math.max(44, f1 * 1.15), to: Math.max(38, f1 * 0.8), gain: (0.1 + tg * 0.16) * (0.4 + 0.6 * near), attack: 0.003 });
  // 꼬리: 총성이 주변을 흔들며 낮게 우르릉 사라짐
  a.noise(o, t + 0.03, 0.4 + spec.echo * 0.5, { type: 'lowpass', freq: 360, gain: 0.2 * (0.5 + 0.5 * near), attack: 0.012, sweepTo: 80, buf: a.brownBuf });
  // 멀리서: 둔탁한 퍽 소리
  if (near < 0.9) a.noise(o, t, 0.16, { type: 'lowpass', freq: 900, gain: 0.9 * (1 - near), attack: 0.003, sweepTo: 240 });
  // 작동음은 가까울 때만 (내 총이면 확실히)
  if (near > 0.5) for (const [dt, f, g, len] of spec.mech) a.noise(o, t + dt, len ?? 0.022, { type: 'bandpass', freq: f, q: 6, gain: g * near, attack: 0.0006 });
  // 실내(지붕 아래): 가까운 벽에서 바로 튕겨 오는 짧은 반사음 두 번 → 좁은 곳일수록 '쾅' 하고 울림
  if ((a.indoorMap || a.cover > 0.5) && near > 0.25) {
    a.noise(o, t + 0.019, 0.05, { type: 'bandpass', freq: b0 * 0.75, q: 0.9, gain: 0.5 * near, attack: 0.001, sweepTo: b1 });
    a.noise(o, t + 0.043, 0.07, { type: 'bandpass', freq: b0 * 0.55, q: 0.8, gain: 0.32 * near, attack: 0.002, sweepTo: b1 * 0.8 });
  }
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
  mpistol: (a, t, pos, vol) => gunshot(a, t, pos, vol, GUN.mpistol),
  carbine: (a, t, pos, vol) => gunshot(a, t, pos, vol, GUN.carbine),
  burst: (a, t, pos, vol) => gunshot(a, t, pos, vol, GUN.burst),
  dmr: (a, t, pos, vol) => gunshot(a, t, pos, vol, GUN.dmr),
  lmg: (a, t, pos, vol) => gunshot(a, t, pos, vol, GUN.lmg),
  ampShot(a, t) {
    const o = a.out(null, 0.15, 0.2, 0);
    a.tone(o, t, 0.08, { type: 'sawtooth', freq: 520, to: 780, gain: 0.12 });
  },
  // 총알이 머리 옆을 스침: 아주 가까우면 날카로운 '딱'(음속을 넘은 탄의 충격파), 그다음 고음이 내려가며 '휙' 지나감
  whiz(a, t, pos, vol) {
    const d = a.dist(pos);
    const o = a.out(pos, 0.6 * vol, 0.4, 0.05);
    if (d < 0.9) a.noise(o, t, 0.012, { type: 'highpass', freq: 4300, gain: 1.4, attack: 0.0004 });
    a.noise(o, t + 0.004, 0.14, { type: 'bandpass', freq: 3400 + Math.random() * 900, q: 2.4, gain: 0.85, attack: 0.004, sweepTo: 650 });
    a.tone(o, t + 0.012, 0.1, { type: 'sine', freq: 2300 + Math.random() * 400, to: 850, gain: 0.07 });
  },
  // 탄창이 거의 비었을 때: 쏠 때마다 가벼운 쇳소리 (남은 탄을 귀로 앎) · 마지막 탄: 노리쇠가 뒤에 걸리는 '철컥'
  lastRounds(a, t, pos, vol) {
    const o = a.out(null, 0.2 * vol, 0.2, 0.02);
    a.tone(o, t + 0.03, 0.05, { type: 'triangle', freq: 2700, gain: 0.25 });
    a.click(o, t + 0.034, 5400, 0.3, 4);
  },
  boltLock(a, t) {
    const o = a.out(null, 0.5, 0.3, 0.05);
    a.click(o, t + 0.05, 2300, 0.9, 5);
    a.noise(o, t + 0.056, 0.045, { type: 'bandpass', freq: 1700, q: 3, gain: 0.5 });
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
  // extra = 들고 있는 장비 질량(kg): 무거울수록 발뒤꿈치가 묵직하게 쿵, 장비가 더 덜그럭
  step(a, t, pos, vol, surface, kg = 8) {
    const w = clamp01(((kg ?? 8) - 5) / 12);
    const o = a.out(pos, 0.6 * vol, 0.35, surface === 'tile' ? 0.16 : 0.08);
    stepLayers(a, o, t, surface, 1);
    // 군화 뒤꿈치의 둔한 저음 (무게)
    a.tone(o, t, 0.07 + w * 0.05, { type: 'sine', freq: 100 - w * 25, to: 60 - w * 12, gain: 0.025 + w * 0.05, attack: 0.002 });
    // 달릴 때 장비가 덜그럭 (탄창·버클 · 무거울수록 자주·크게)
    if (Math.random() < 0.45 + w * 0.4) a.noise(o, t + 0.03 + Math.random() * 0.04, 0.03, { type: 'bandpass', freq: 3600 + Math.random() * 1500, q: 7, gain: 0.1 + w * 0.06 });
    if (Math.random() < 0.2 + w * 0.5) a.noise(o, t + 0.05 + Math.random() * 0.05, 0.04, { type: 'bandpass', freq: 1700 + Math.random() * 700, q: 5, gain: 0.05 + w * 0.08 });
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
    a.tone(o, t, 0.16, { type: 'sine', freq: 75, to: 42, gain: 0.36 });
    stepLayers(a, o, t + 0.01, surface, 0.8);
    a.noise(o, t + 0.04, 0.05, { type: 'bandpass', freq: 3800, q: 6, gain: 0.25 }); // 장비 흔들림
    if (a.wet && surface !== 'tile') a.noise(o, t + 0.02, 0.18, { type: 'bandpass', freq: 2600, q: 1.4, gain: 0.45, sweepTo: 1200 });
  },
  // ───────── 내가 맞혔을 때 (몸통 · 방탄에 막힘 · 머리 · 방탄 부서짐) ─────────
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
  // 머리 명중 (헬멧 없음): 짧고 날카로운 '딱' + 묵직한 울림
  headshot(a, t) {
    const o = a.out(null, 0.42, 0.3, 0.04);
    a.noise(o, t, 0.018, { type: 'highpass', freq: 3200, gain: 0.9, attack: 0.0004 });
    a.tone(o, t, 0.09, { type: 'sine', freq: 260, to: 95, gain: 0.6 });
    a.tone(o, t + 0.005, 0.05, { type: 'triangle', freq: 1500, to: 1100, gain: 0.14 });
  },
  // 헬멧을 때리는 맑은 금속음 ('차랑')
  helmetPing(a, t, pos, vol = 1) {
    const o = a.out(null, 0.42 * vol, 0.4, 0.06);
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
    const o = a.out(null, 0.42, 0.45, 0);
    a.noise(o, t, 0.2, { type: 'lowpass', freq: 380, gain: 1, buf: a.brownBuf });
    a.tone(o, t, 0.18, { type: 'sine', freq: 85, to: 48, gain: 0.65 });
    a.tone(o, t, 0.24, { type: 'sine', freq: 50, to: 38, gain: 0.22, attack: 0.004 });
    a.noise(o, t + 0.04, 0.12, { type: 'bandpass', freq: 1200, q: 0.8, gain: 0.12 });
  },
  ring(a, t, pos, vol = 1) {
    const o = a.out(null, 0.12 * vol, 2.6, 0);
    a.tone(o, t, 2.5, { type: 'sine', freq: 4200, gain: 0.18, attack: 0.02 });
  },
  // 최후의 1인: 낮게 깔리며 부풀었다 가라앉는 소리 · 긴장: 그 뒤로 몇 초마다 아주 낮은 맥박
  lastStand(a, t) {
    const o = a.out(null, 0.5, 3, 0.25);
    a.tone(o, t, 2.6, { type: 'sine', freq: 55, to: 49, gain: 0.5, attack: 0.5 });
    a.tone(o, t + 0.1, 2.2, { type: 'triangle', freq: 110, to: 98, gain: 0.08, attack: 0.7 });
    a.noise(o, t, 2.4, { type: 'lowpass', freq: 380, gain: 0.35, attack: 0.9, sweepTo: 120, buf: a.brownBuf });
  },
  tension(a, t, pos, vol = 1) {
    const o = a.out(null, 0.35 * vol, 2.2, 0.2);
    a.tone(o, t, 0.5, { type: 'sine', freq: 46, gain: 0.55, attack: 0.08 });
    a.tone(o, t + 0.55, 0.45, { type: 'sine', freq: 44, gain: 0.35, attack: 0.08 });
    a.noise(o, t, 1.8, { type: 'lowpass', freq: 260, gain: 0.18, attack: 0.7, sweepTo: 90, buf: a.brownBuf });
  },
  heartbeat(a, t, pos, vol) {
    const o = a.out(null, 0.7 * vol, 0.5, 0);
    a.tone(o, t, 0.12, { type: 'sine', freq: 58, to: 40, gain: 1 });
    a.tone(o, t + 0.18, 0.1, { type: 'sine', freq: 52, to: 38, gain: 0.7 });
  },
  // 숨 가쁨 (지구력이 바닥날 때): 들이쉼(올라가는 바람 소리) → 내쉼(내려가는 바람 소리)
  breath(a, t, pos, vol) {
    const o = a.out(null, 0.32 * vol, 1.2, 0);
    a.noise(o, t, 0.34, { type: 'bandpass', freq: 700, q: 1.4, gain: 0.5, attack: 0.12, sweepTo: 1300 });
    a.noise(o, t + 0.45, 0.42, { type: 'bandpass', freq: 1100, q: 1.2, gain: 0.6, attack: 0.05, sweepTo: 520 });
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
  // ── 새 포스 패치 ──
  // 반작용 추진기: 가스가 '푸쉭' 뿜어져 나감 + 몸이 밀려 나가는 바람
  dash(a, t, pos, vol) {
    const o = a.out(pos, 0.6 * vol, 0.7, 0.1);
    a.noise(o, t, 0.32, { type: 'bandpass', freq: 900, q: 0.7, gain: 0.9, attack: 0.005, sweepTo: 300 });
    a.noise(o, t, 0.12, { type: 'lowpass', freq: 260, gain: 0.8, buf: a.brownBuf });
    a.noise(o, t + 0.05, 0.4, { type: 'bandpass', freq: 500, q: 0.9, gain: 0.35, attack: 0.08, sweepTo: 1800 });
  },
  // 무게 닻: 무게가 실리며 바닥이 '쿵' + 쇠사슬 소리
  anchor(a, t, pos, vol) {
    const o = a.out(pos, 0.7 * vol, 1.2, 0.25);
    a.tone(o, t, 0.6, { type: 'sine', freq: 70, to: 32, gain: 1 });
    a.noise(o, t, 0.25, { type: 'lowpass', freq: 200, gain: 0.9, buf: a.brownBuf });
    for (let i = 0; i < 4; i++) a.click(o, t + 0.05 + i * 0.05, 2600 + i * 300, 0.25, 9);
  },
  // 마찰 장갑: 거친 면이 긁히는 '끽'
  grip(a, t, pos, vol) {
    const o = a.out(pos, 0.45 * vol, 0.5, 0.05);
    a.noise(o, t, 0.22, { type: 'bandpass', freq: 2400, q: 2, gain: 0.5, attack: 0.01, sweepTo: 1400 });
    a.tone(o, t, 0.18, { type: 'sawtooth', freq: 340, to: 260, gain: 0.06 });
  },
  // 부력 풍선: 가스가 차오르는 '쉬이익' (점점 높아짐)
  balloon(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 1.2, 0.05);
    a.noise(o, t, 0.9, { type: 'bandpass', freq: 700, q: 1.2, gain: 0.5, attack: 0.1, sweepTo: 2200 });
    a.tone(o, t + 0.1, 0.8, { type: 'triangle', freq: 220, to: 420, gain: 0.08 });
  },
  // 풍선이 터짐: '빵'
  pop(a, t, pos, vol) {
    const o = a.out(pos, 0.7 * vol, 0.6, 0.15);
    a.noise(o, t, 0.03, { type: 'highpass', freq: 1800, gain: 1, attack: 0.0005 });
    a.noise(o, t, 0.15, { type: 'bandpass', freq: 900, q: 0.8, gain: 0.6, sweepTo: 300 });
  },
  // 탄성 덫 설치: 용수철을 눌러 거는 '끼릭 · 딸깍'
  trapSet(a, t, pos, vol) {
    const o = a.out(pos, 0.35 * vol, 0.5, 0.05);
    a.tone(o, t, 0.25, { type: 'triangle', freq: 900, to: 500, gain: 0.12, vibrato: 40 });
    a.click(o, t + 0.24, 3600, 0.5, 7);
  },
  // 탄성 덫 작동: 용수철이 펴지는 '보잉' + 쇳소리
  trapSpring(a, t, pos, vol) {
    const o = a.out(pos, 0.8 * vol, 1, 0.15);
    a.click(o, t, 3000, 0.8, 6);
    a.tone(o, t, 0.6, { type: 'triangle', freq: 180, to: 620, gain: 0.35, vibrato: 26 });
    a.tone(o, t, 0.4, { type: 'sine', freq: 80, to: 50, gain: 0.7 });
  },
  // 합력 표적: 조준 고정 '삐비빅'
  mark(a, t, pos, vol) {
    const o = a.out(pos, 0.4 * vol, 0.5, 0.05);
    for (let i = 0; i < 3; i++) a.tone(o, t + i * 0.07, 0.06, { type: 'square', freq: 1500 + i * 300, gain: 0.08 });
  },
  // 중력 낙하: 하늘 위 추가 내는 낮은 웅웅 → 떨어지며 높아지는 휘파람
  dropWarn(a, t, pos, vol) {
    const o = a.out(pos, 0.8 * vol, 3.5, 0.3);
    a.tone(o, t, 0.8, { type: 'sine', freq: 60, to: 90, gain: 0.5, attack: 0.2 });
    a.tone(o, t + 0.8, 2.2, { type: 'sine', freq: 400, to: 1400, gain: 0.12, attack: 0.3 });
    a.noise(o, t + 0.8, 2.2, { type: 'bandpass', freq: 600, q: 2, gain: 0.25, attack: 1.2, sweepTo: 2400 });
  },
  // 1톤 추가 땅에 닿음: 쇳덩이 '쾅' + 땅울림
  dropImpact(a, t, pos, vol) {
    const o = a.out(pos, 1.0 * vol, 4, 0.8, 1.0);
    a.noise(o, t, 0.05, { type: 'highpass', freq: 1400, gain: 1, attack: 0.001 });
    a.tone(o, t, 1.4, { type: 'sine', freq: 52, to: 20, gain: 1 });
    a.noise(o, t, 2, { type: 'lowpass', freq: 180, gain: 1, attack: 0.01, buf: a.brownBuf });
    a.tone(o, t, 1.6, { type: 'triangle', freq: 340, to: 330, gain: 0.18 }); // 쇳덩이 울림
    a.tone(o, t, 1.2, { type: 'triangle', freq: 517, to: 510, gain: 0.1 });
    for (let i = 0; i < 10; i++) a.noise(o, t + 0.15 + Math.random() * 1.2, 0.05, { type: 'bandpass', freq: 900 + Math.random() * 2400, q: 3, gain: 0.2 });
  },
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
    const o = a.out(null, 1.0 * vol, 5, 0.7);
    a.tone(o, t, 2.2, { type: 'sine', freq: 48, to: 24, gain: 0.32, attack: 0.004 }); // 땅이 울리는 깊은 저음
    a.noise(o, t + 0.2, 3.6, { type: 'lowpass', freq: 140, gain: 0.4, attack: 0.3, sweepTo: 45, buf: a.brownBuf });
    a.noise(o, t, 0.08, { type: 'highpass', freq: 1500, gain: 0.8, attack: 0.002 });
    a.noise(o, t, 3.0, { type: 'lowpass', freq: 3000, sweepTo: 60, gain: 1, attack: 0.005 });
    a.noise(o, t, 2.5, { type: 'lowpass', freq: 160, gain: 0.9, attack: 0.01, buf: a.brownBuf });
    a.tone(o, t, 1.8, { type: 'sine', freq: 55, to: 20, gain: 1 });
    for (let i = 0; i < 6; i++) a.noise(o, t + 0.4 + Math.random() * 1.6, 0.05, { type: 'bandpass', freq: 1500 + Math.random() * 2000, q: 3, gain: 0.2 }); // 떨어지는 파편
  },
  // 폭탄 폭발 → 블랙홀: 깊게 꺼지는 쿵 → 점점 커지며 높아지는 웅웅·빨려 드는 바람 → 모두 삼키는 순간 '훅' 끊김
  blackHole(a, t, pos, vol) {
    const o = a.out(null, 1.0 * vol, 7, 0.9, 0.6);
    a.noise(o, t, 0.1, { type: 'highpass', freq: 1300, gain: 0.8, attack: 0.002 });
    a.noise(o, t, 1.4, { type: 'lowpass', freq: 2200, sweepTo: 70, gain: 0.8, attack: 0.004 });
    a.tone(o, t, 2.6, { type: 'sine', freq: 72, to: 21, gain: 1, attack: 0.004 });
    a.tone(o, t + 0.35, 4.2, { type: 'sawtooth', freq: 27, to: 64, gain: 0.2, attack: 3.6 });
    a.tone(o, t + 0.35, 4.2, { type: 'sine', freq: 41, to: 88, gain: 0.5, attack: 3.4, vibrato: 5 });
    a.noise(o, t + 0.35, 4.2, { type: 'bandpass', freq: 160, sweepTo: 2600, q: 1.1, gain: 0.55, attack: 3.7 });
    a.noise(o, t + 0.35, 4.2, { type: 'lowpass', freq: 95, gain: 0.7, attack: 2.8, buf: a.brownBuf });
    const end = t + 4.55;
    a.tone(o, end, 2.2, { type: 'sine', freq: 95, to: 17, gain: 1, attack: 0.003 });
    a.noise(o, end, 0.6, { type: 'lowpass', freq: 700, sweepTo: 35, gain: 0.9, attack: 0.003 });
  },
  // 내가 빨려 듦: 귀가 꽉 막히는 낮은 '우웅'
  absorbed(a, t) {
    const o = a.out(null, 0.7, 1.6, 0.3);
    a.tone(o, t, 1.4, { type: 'sine', freq: 140, to: 30, gain: 0.8, attack: 0.01 });
    a.noise(o, t, 0.8, { type: 'lowpass', freq: 500, sweepTo: 40, gain: 0.6, attack: 0.02, buf: a.brownBuf });
  },
  // ───────── 투척·폭발 장비 ─────────
  // 안전핀 뽑기: 고리 딸깍 + 손잡이 스프링 '팅'
  pinPull(a, t, pos, vol) {
    const o = a.out(pos, 0.4 * vol, 0.5, 0.05);
    a.click(o, t, 3200, 0.7, 6);
    a.tone(o, t + 0.06, 0.18, { type: 'triangle', freq: 2400, to: 1900, gain: 0.12 });
    a.click(o, t + 0.12, 4200, 0.4, 8);
  },
  // 던지는 바람 소리
  throw(a, t, pos, vol) {
    const o = a.out(pos, 0.45 * vol, 0.5, 0.05);
    a.noise(o, t, 0.28, { type: 'bandpass', freq: 600, q: 0.9, gain: 0.6, attack: 0.05, sweepTo: 2200 });
  },
  // 바닥·벽에 부딪힘: 쇠 깡통이 튀는 소리 (세게 부딪힐수록 큼)
  gearBounce(a, t, pos, vol) {
    const o = a.out(pos, 0.45 * vol, 0.4, 0.12);
    a.noise(o, t, 0.04, { type: 'lowpass', freq: 600, gain: 0.7 });
    a.tone(o, t, 0.12, { type: 'triangle', freq: 1300 + Math.random() * 500, to: 900, gain: 0.25 });
    a.click(o, t + 0.005, 3600 + Math.random() * 800, 0.45, 9);
  },
  // 세열 수류탄: 짧고 묵직한 쿵 + 파편이 흩어지는 소리
  fragBlast(a, t, pos, vol) {
    const o = a.out(pos, 0.95 * vol, 3, 0.6, 0.8);
    a.noise(o, t, 0.05, { type: 'highpass', freq: 1800, gain: 0.9, attack: 0.001 });
    a.noise(o, t, 0.9, { type: 'lowpass', freq: 2400, sweepTo: 90, gain: 1, attack: 0.003 });
    a.noise(o, t, 1.2, { type: 'lowpass', freq: 180, gain: 0.8, attack: 0.008, buf: a.brownBuf });
    a.tone(o, t, 0.8, { type: 'sine', freq: 70, to: 26, gain: 0.9 });
    a.tone(o, t, 1.2, { type: 'sine', freq: 46, to: 26, gain: 0.35, attack: 0.004 });
    a.noise(o, t + 0.15, 2, { type: 'lowpass', freq: 150, gain: 0.32, attack: 0.25, sweepTo: 50, buf: a.brownBuf });
    for (let i = 0; i < 8; i++) a.noise(o, t + 0.05 + Math.random() * 0.6, 0.03, { type: 'bandpass', freq: 2000 + Math.random() * 2500, q: 4, gain: 0.18 });
  },
  // C4: 더 크고 길게 (건물이 울림)
  c4Blast(a, t, pos, vol) {
    const o = a.out(pos, 1.0 * vol, 4, 0.8, 1.0);
    a.noise(o, t, 0.06, { type: 'highpass', freq: 1500, gain: 1, attack: 0.001 });
    a.noise(o, t, 1.6, { type: 'lowpass', freq: 2600, sweepTo: 70, gain: 1, attack: 0.004 });
    a.noise(o, t, 2.2, { type: 'lowpass', freq: 160, gain: 1, attack: 0.01, buf: a.brownBuf });
    a.tone(o, t, 1.1, { type: 'sine', freq: 58, to: 22, gain: 1 });
    for (let i = 0; i < 10; i++) a.noise(o, t + 0.2 + Math.random() * 1.2, 0.05, { type: 'bandpass', freq: 900 + Math.random() * 2400, q: 3, gain: 0.2 });
  },
  // 이명 수류탄: 귀를 때리는 큰 '빵' (화약 냄새 나는 날카로운 소리)
  stunBang(a, t, pos, vol) {
    const o = a.out(pos, 1.0 * vol, 2, 0.7, 0.8);
    a.noise(o, t, 0.02, { type: 'highpass', freq: 2500, gain: 1, attack: 0.0005 });
    a.noise(o, t, 0.35, { type: 'bandpass', freq: 1400, q: 0.6, gain: 1, attack: 0.001, sweepTo: 400 });
    a.tone(o, t, 0.3, { type: 'sine', freq: 110, to: 45, gain: 0.8 });
  },
  // 섬광탄: 갈라지는 '팡' + 쉿 하는 소리
  flashBang(a, t, pos, vol) {
    const o = a.out(pos, 0.95 * vol, 1.8, 0.6, 0.6);
    a.noise(o, t, 0.015, { type: 'highpass', freq: 3500, gain: 1, attack: 0.0004 });
    a.noise(o, t, 0.22, { type: 'bandpass', freq: 2200, q: 0.7, gain: 0.9, attack: 0.001, sweepTo: 700 });
    a.noise(o, t + 0.05, 0.9, { type: 'highpass', freq: 5000, gain: 0.15, attack: 0.05 });
    a.tone(o, t, 0.2, { type: 'sine', freq: 140, to: 60, gain: 0.5 });
  },
  // 연막·최루: 깡통에서 '퍽' 하고 길게 쉬익
  smokeHiss(a, t, pos, vol) {
    const o = a.out(pos, 0.6 * vol, 4, 0.2);
    a.noise(o, t, 0.08, { type: 'lowpass', freq: 500, gain: 0.8 });
    a.noise(o, t + 0.05, 3.2, { type: 'highpass', freq: 2800, gain: 0.35, attack: 0.3 });
    a.noise(o, t + 0.05, 3.0, { type: 'bandpass', freq: 900, q: 0.8, gain: 0.25, attack: 0.4 });
  },
  // 최루 가스 안: 기침
  cough(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 0.9, 0.08);
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      const s = t + i * 0.22;
      a.noise(o, s, 0.12, { type: 'bandpass', freq: 700 + Math.random() * 300, q: 1.6, gain: 0.8, attack: 0.008, sweepTo: 420 });
      a.tone(o, s, 0.08, { type: 'sawtooth', freq: 180 + Math.random() * 40, to: 120, gain: 0.05 });
    }
  },
  // C4 붙이기: 끈적하게 붙는 소리 + 삑
  c4Place(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 0.6, 0.08);
    a.noise(o, t, 0.12, { type: 'lowpass', freq: 380, gain: 0.8, attack: 0.01 });
    a.click(o, t + 0.1, 2600, 0.5, 5);
    a.tone(o, t + 0.25, 0.08, { type: 'square', freq: 1700, gain: 0.08 });
  },
  // 드론 띄우기: 모터가 켜지며 올라가는 소리
  droneUp(a, t, pos, vol) {
    const o = a.out(pos, 0.4 * vol, 1, 0.1);
    a.tone(o, t, 0.6, { type: 'sawtooth', freq: 60, to: 172, gain: 0.08, attack: 0.05 });
    a.noise(o, t, 0.5, { type: 'bandpass', freq: 800, q: 0.8, gain: 0.3, attack: 0.1, sweepTo: 2200 });
  },
  // 드론 격추·추락: 퍽 + 부서지는 소리
  droneDown(a, t, pos, vol) {
    const o = a.out(pos, 0.6 * vol, 1.2, 0.2);
    a.noise(o, t, 0.06, { type: 'highpass', freq: 2500, gain: 0.8, attack: 0.001 });
    a.tone(o, t, 0.4, { type: 'sawtooth', freq: 170, to: 50, gain: 0.08 });
    for (let i = 0; i < 4; i++) a.click(o, t + 0.05 + Math.random() * 0.4, 1800 + Math.random() * 2500, 0.4, 5);
  },
  // 드론 표시: 짧은 확인음
  droneMark(a, t, pos, vol) {
    const o = a.out(null, 0.3 * vol, 0.4, 0);
    a.tone(o, t, 0.06, { type: 'square', freq: 1760, gain: 0.08 });
    a.tone(o, t + 0.07, 0.1, { type: 'square', freq: 2350, gain: 0.08 });
  },
  // ───────── 전술 장비 ─────────
  // RC카 내려놓음: 플라스틱이 바닥에 톡 + 모터가 올라가는 소리
  rcDrop(a, t, pos, vol) {
    const o = a.out(pos, 0.4 * vol, 0.8, 0.08);
    a.noise(o, t, 0.03, { type: 'bandpass', freq: 1800, q: 2, gain: 0.5, attack: 0.001 });
    a.tone(o, t + 0.04, 0.5, { type: 'sawtooth', freq: 120, to: 412, gain: 0.05, attack: 0.04 });
  },
  // EMP: 낮은 '퉁' + 전기가 튀는 지지직 + 내려가는 윙 (전자 장비가 꺼지는 소리)
  empBlast(a, t, pos, vol) {
    const o = a.out(pos, 0.85 * vol, 2.2, 0.35, 0.3);
    a.tone(o, t, 0.5, { type: 'sine', freq: 90, to: 38, gain: 0.7, attack: 0.002 });
    a.noise(o, t, 0.6, { type: 'lowpass', freq: 400, gain: 0.5, attack: 0.004, sweepTo: 80, buf: a.brownBuf });
    a.tone(o, t + 0.02, 1.1, { type: 'sawtooth', freq: 1900, to: 140, gain: 0.07, attack: 0.01 });
    a.tone(o, t + 0.02, 0.9, { type: 'square', freq: 3100, to: 400, gain: 0.025, attack: 0.01 });
    for (let i = 0; i < 14; i++) a.noise(o, t + Math.random() * 0.7, 0.012 + Math.random() * 0.02, { type: 'highpass', freq: 3500 + Math.random() * 3000, gain: 0.35 + Math.random() * 0.3, attack: 0.0005 });
  },
  // 카메라가 벽에 붙음: 고무 받침이 철썩 + 작은 전자음
  camStick(a, t, pos, vol) {
    const o = a.out(pos, 0.45 * vol, 0.6, 0.1);
    a.noise(o, t, 0.05, { type: 'lowpass', freq: 900, gain: 0.7, attack: 0.001, buf: a.brownBuf });
    a.click(o, t + 0.01, 2600, 0.35, 4);
    a.tone(o, t + 0.12, 0.06, { type: 'sine', freq: 2400, gain: 0.05 });
  },
  // 카메라 화면 켜기·끄기: 전환 지직 + 짧은 음
  camOn(a, t) {
    const o = a.out(null, 0.3, 0.5, 0);
    a.noise(o, t, 0.09, { type: 'bandpass', freq: 3200, q: 0.8, gain: 0.35, attack: 0.002 });
    a.tone(o, t + 0.05, 0.07, { type: 'square', freq: 1320, gain: 0.05 });
  },
  camOff(a, t) {
    const o = a.out(null, 0.3, 0.4, 0);
    a.tone(o, t, 0.08, { type: 'square', freq: 990, to: 600, gain: 0.05 });
    a.noise(o, t, 0.05, { type: 'bandpass', freq: 2400, q: 1, gain: 0.25 });
  },
  // 경보 센서 붙임: 딸깍 + 켜지는 두 음
  alarmPlace(a, t, pos, vol) {
    const o = a.out(pos, 0.4 * vol, 0.6, 0.08);
    a.click(o, t, 3000, 0.5, 5);
    a.tone(o, t + 0.08, 0.05, { type: 'sine', freq: 1500, gain: 0.06 });
    a.tone(o, t + 0.15, 0.07, { type: 'sine', freq: 2000, gain: 0.06 });
  },
  // 경보: 날카로운 삐삐삐 (들은 적·아군 모두 위치를 앎)
  alarmBeep(a, t, pos, vol) {
    const o = a.out(pos, 0.95 * vol, 1.4, 0.15);
    for (let i = 0; i < 5; i++) a.tone(o, t + i * 0.22, 0.12, { type: 'square', freq: i % 2 ? 2650 : 3150, gain: 0.12, attack: 0.002 });
  },
  // 장비가 부서짐: 플라스틱 깨짐 + 전기 튐
  gadgetBreak(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 0.8, 0.15);
    a.noise(o, t, 0.05, { type: 'highpass', freq: 2600, gain: 0.7, attack: 0.001 });
    for (let i = 0; i < 4; i++) a.click(o, t + 0.02 + Math.random() * 0.2, 2200 + Math.random() * 2600, 0.35, 5);
    a.tone(o, t, 0.25, { type: 'sawtooth', freq: 600, to: 90, gain: 0.04 });
  },
  // 심장 박동 센서: 아무도 없으면 짧은 '틱', 잡히면 낮은 '두근' (가까울수록 크게)
  pulseTick(a, t) {
    const o = a.out(null, 0.2, 0.3, 0);
    a.tone(o, t, 0.04, { type: 'sine', freq: 1450, gain: 0.05 });
  },
  pulseHit(a, t, pos, vol) {
    const o = a.out(null, 0.24 * vol, 0.6, 0);
    a.tone(o, t, 0.09, { type: 'sine', freq: 70, to: 46, gain: 0.45, attack: 0.004 });
    a.tone(o, t + 0.16, 0.08, { type: 'sine', freq: 60, to: 42, gain: 0.32, attack: 0.004 });
    a.tone(o, t, 0.05, { type: 'sine', freq: 1100, gain: 0.04 });
  },
  // ───────── 문 (surface 자리에 재질: 'steel' · 'wood') ─────────
  // 열기: 손잡이 딸깍 + 걸쇠 + 경첩 삐걱 + 문이 공기를 밀어내는 소리 (철문은 낮고 묵직)
  doorOpen(a, t, pos, vol, mat) {
    const steel = mat === 'steel';
    const o = a.out(pos, 0.5 * vol, 1, 0.25);
    a.click(o, t, steel ? 1900 : 2600, 0.7, 6);
    a.click(o, t + 0.05, steel ? 1300 : 1700, 0.45, 5);
    a.tone(o, t + 0.08, 0.32, steel ? { type: 'sawtooth', freq: 150, to: 172, gain: 0.025, attack: 0.04 } : { type: 'triangle', freq: 410, to: 520, gain: 0.04, attack: 0.03, vibrato: 18 });
    a.noise(o, t + 0.06, 0.4, { type: 'lowpass', freq: 420, gain: 0.35, attack: 0.08, buf: a.brownBuf });
  },
  doorClose(a, t, pos, vol, mat) {
    const o = a.out(pos, 0.35 * vol, 0.7, 0.2);
    a.noise(o, t, 0.35, { type: 'lowpass', freq: 380, gain: 0.3, attack: 0.08, buf: a.brownBuf });
    a.tone(o, t + 0.05, 0.22, mat === 'steel' ? { type: 'sawtooth', freq: 170, to: 150, gain: 0.02 } : { type: 'triangle', freq: 500, to: 420, gain: 0.03, vibrato: 14 });
  },
  // 닫힘: 문이 문틀에 '쿵' + 걸쇠가 걸리는 소리 (철문은 쇠 울림)
  doorShut(a, t, pos, vol, mat) {
    const steel = mat === 'steel';
    const o = a.out(pos, 0.65 * vol, 1.1, 0.35, 0.1);
    a.noise(o, t, 0.12, { type: 'lowpass', freq: steel ? 240 : 320, gain: 1, buf: a.brownBuf });
    a.tone(o, t, 0.16, { type: 'sine', freq: steel ? 85 : 120, to: 55, gain: 0.6 });
    a.click(o, t + 0.015, steel ? 1500 : 2200, 0.6, 5);
    if (steel) a.tone(o, t, 0.6, { type: 'triangle', freq: 330, to: 310, gain: 0.05 });
  },
  // 살짝 열기: 걸쇠를 조심스럽게 + 길고 낮은 삐걱
  doorCreak(a, t, pos, vol, mat) {
    const o = a.out(pos, 0.4 * vol, 1.4, 0.2);
    a.click(o, t, mat === 'steel' ? 1700 : 2400, 0.35, 6);
    a.tone(o, t + 0.1, 1.0, mat === 'steel' ? { type: 'sawtooth', freq: 140, to: 158, gain: 0.018, attack: 0.2, vibrato: 6 } : { type: 'triangle', freq: 300, to: 380, gain: 0.035, attack: 0.15, vibrato: 9 });
  },
  // 잠김: 손잡이를 돌려도 걸쇠가 덜컥덜컥
  doorLocked(a, t, pos, vol) {
    const o = a.out(pos, 0.5 * vol, 0.6, 0.15);
    for (let i = 0; i < 3; i++) {
      a.click(o, t + i * 0.085, 2100 + Math.random() * 400, 0.6, 5);
      a.noise(o, t + i * 0.085 + 0.01, 0.05, { type: 'lowpass', freq: 500, gain: 0.35 });
    }
  },
  // 발차기: 쾅 (문이 벽에 부딪히며 한 번 더)
  doorKick(a, t, pos, vol, mat) {
    const steel = mat === 'steel';
    const o = a.out(pos, 0.95 * vol, 1.6, 0.45, 0.3);
    a.noise(o, t, 0.2, { type: 'lowpass', freq: 280, gain: 1, buf: a.brownBuf });
    a.tone(o, t, 0.25, { type: 'sine', freq: 90, to: 38, gain: 0.9 });
    a.noise(o, t, 0.08, { type: 'bandpass', freq: steel ? 1300 : 2400, q: 1.2, gain: 0.7 });
    a.noise(o, t + 0.16, 0.14, { type: 'lowpass', freq: 360, gain: 0.7, buf: a.brownBuf });
    if (steel) a.tone(o, t + 0.16, 0.7, { type: 'triangle', freq: 290, to: 270, gain: 0.06 });
  },
  // 잠긴 문을 찼는데 안 열림: 둔탁한 쿵 + 덜컹
  kickFail(a, t, pos, vol) {
    const o = a.out(pos, 0.8 * vol, 1, 0.35, 0.2);
    a.noise(o, t, 0.16, { type: 'lowpass', freq: 220, gain: 1, buf: a.brownBuf });
    a.tone(o, t, 0.2, { type: 'sine', freq: 75, to: 45, gain: 0.8 });
    a.click(o, t + 0.04, 1600, 0.5, 4);
    a.click(o, t + 0.11, 1900, 0.35, 4);
  },
  // 자물쇠가 부서짐: 쇠가 튕겨 나가는 소리 + 나무 쪼개짐
  lockBreak(a, t, pos, vol) {
    const o = a.out(pos, 0.6 * vol, 0.9, 0.25);
    a.click(o, t, 4200, 0.9, 7);
    a.tone(o, t, 0.12, { type: 'triangle', freq: 1800, to: 900, gain: 0.12 });
    a.noise(o, t + 0.02, 0.18, { type: 'bandpass', freq: 2600, q: 1.5, gain: 0.5, sweepTo: 1200 });
    for (let i = 0; i < 3; i++) a.click(o, t + 0.25 + Math.random() * 0.3, 2800 + Math.random() * 1500, 0.3, 8);
  },
  // 문 폭파: 나무·쇠 조각이 흩어져 떨어짐 (폭발음은 c4Blast)
  doorBreach(a, t, pos, vol, mat) {
    const o = a.out(pos, 0.6 * vol, 2, 0.3);
    a.noise(o, t, 0.25, { type: 'bandpass', freq: mat === 'steel' ? 1500 : 2200, q: 0.8, gain: 0.8, sweepTo: 600 });
    for (let i = 0; i < 9; i++) a.noise(o, t + 0.3 + Math.random() * 1.1, 0.04, { type: 'bandpass', freq: (mat === 'steel' ? 1200 : 1800) + Math.random() * 1800, q: 4, gain: 0.25 });
  },
  // 문에 맞음 (걷어찬 문이 사람을 침)
  doorHit(a, t, pos, vol) {
    const o = a.out(pos, 0.7 * vol, 0.5, 0.15);
    a.noise(o, t, 0.1, { type: 'lowpass', freq: 300, gain: 1, buf: a.brownBuf });
    a.tone(o, t, 0.12, { type: 'sine', freq: 110, to: 60, gain: 0.6 });
  },
  // 총알이 문짝에: 나무는 '턱' + 부스러기, 쇠는 '팅'
  doorImpact(a, t, pos, vol, mat) {
    const o = a.out(pos, 0.4 * vol, 0.4, 0.12);
    if (mat === 'steel') {
      a.click(o, t, 3200, 0.7, 8);
      a.tone(o, t, 0.16, { type: 'triangle', freq: 1700 + Math.random() * 500, to: 1300, gain: 0.08 });
    } else {
      a.noise(o, t, 0.05, { type: 'bandpass', freq: 900, q: 2, gain: 0.9 });
      a.noise(o, t + 0.01, 0.12, { type: 'bandpass', freq: 2600, q: 2, gain: 0.25 });
    }
  },
  // 문 밑 카메라: 작은 모터가 펴지는 소리
  mirrorOn(a, t) {
    const o = a.out(null, 0.25, 0.4, 0);
    a.click(o, t, 3000, 0.4, 6);
    a.tone(o, t + 0.02, 0.2, { type: 'sawtooth', freq: 240, to: 360, gain: 0.025 });
  },
  mirrorOff(a, t) {
    const o = a.out(null, 0.22, 0.4, 0);
    a.tone(o, t, 0.16, { type: 'sawtooth', freq: 360, to: 230, gain: 0.022 });
    a.click(o, t + 0.16, 2600, 0.35, 6);
  },
  // 기폭기 단추
  detClick(a, t) {
    const o = a.out(null, 0.4, 0.3, 0);
    a.click(o, t, 2400, 0.8, 5);
    a.tone(o, t + 0.02, 0.06, { type: 'square', freq: 2100, gain: 0.06 });
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
  // ── CQB 작전 ──
  // 결박 풀기 시작: 커터를 케이블 타이에 거는 플라스틱 긁힘
  snipStart(a, t) {
    const o = a.out(null, 0.32, 0.6, 0.03);
    a.noise(o, t, 0.18, { type: 'bandpass', freq: 3600, q: 3, gain: 0.35, attack: 0.02, sweepTo: 2600 });
    a.click(o, t + 0.22, 3200, 0.45, 7);
    a.noise(o, t + 0.3, 0.22, { type: 'bandpass', freq: 3000, q: 3, gain: 0.3, attack: 0.03, sweepTo: 4200 });
  },
  // 결박 끊김: 날카로운 '딱' + 타이가 떨어지는 짧은 소리
  snip(a, t) {
    const o = a.out(null, 0.42, 0.5, 0.04);
    a.click(o, t, 4200, 1, 9);
    a.noise(o, t, 0.035, { type: 'highpass', freq: 3000, gain: 0.7 });
    a.click(o, t + 0.16, 1900, 0.3, 4);
  },
  // 연구 자료 확보: 노트북 닫힘 + 가방 걸쇠 두 번 + 무전 확인음
  intel(a, t) {
    const o = a.out(null, 0.38, 0.9, 0.05);
    a.noise(o, t, 0.06, { type: 'lowpass', freq: 700, gain: 0.8 });
    a.click(o, t + 0.18, 2500, 0.8, 6);
    a.click(o, t + 0.3, 2300, 0.8, 6);
    a.tone(o, t + 0.45, 0.08, { type: 'sine', freq: 1320, gain: 0.12 });
    a.tone(o, t + 0.56, 0.12, { type: 'sine', freq: 1760, gain: 0.12 });
  },
  // 연구원 구출: 무전 잡음 + 확인 세 음
  rescue(a, t) {
    const o = a.out(null, 0.36, 1.2, 0.1);
    a.noise(o, t, 0.08, { type: 'bandpass', freq: 1500, q: 0.8, gain: 0.4 });
    [880, 1109, 1319].forEach((f, i) => a.tone(o, t + 0.12 + i * 0.11, 0.22, { type: 'sine', freq: f, gain: 0.16 }));
    a.noise(o, t + 0.55, 0.06, { type: 'bandpass', freq: 1500, q: 0.8, gain: 0.3 });
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
