import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from '../sim/constants.js';
import { STORY, SLAB } from '../sim/map.js';
import { DEVICE_INFO } from '../sim/devices.js';

// 맵 장치 화면: 탄성 발판 · 승강기(도르래 / 부력) · 지레 셔터(+지렛대) · 마찰 미끄럼틀 안내판.
// 상태는 경기(match.devices)에서 읽기만 한다.

const V3 = THREE.Vector3;
const FONT = '"IBM Plex Sans KR", "Noto Sans KR", "Malgun Gothic", sans-serif';

// 장치 옆 안내판: 이름 + 원리 한 줄 (공부와 이어지는 표지)
function signTexture(title, line, museum) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = museum ? '#f3efe6' : '#1d2126';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = museum ? '#2b3a52' : '#d0a62a';
  g.fillRect(0, 0, 512, 54);
  g.fillStyle = museum ? '#ffffff' : '#141414';
  g.font = `700 32px ${FONT}`;
  g.textBaseline = 'middle';
  g.fillText(title, 22, 28);
  g.fillStyle = museum ? '#2a2c30' : '#e6e2d6';
  g.font = `500 25px ${FONT}`;
  // 줄 바꿈 (글자 수 기준)
  const words = line.split(' ');
  let row = '', y = 92;
  for (const w of words) {
    const t = row ? `${row} ${w}` : w;
    if (g.measureText(t).width > 468) {
      g.fillText(row, 22, y);
      row = w;
      y += 36;
    } else row = t;
  }
  if (row) g.fillText(row, 22, y);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 노랑·검정 경고 줄무늬
let hazardTex = null;
function hazard() {
  if (hazardTex) return hazardTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#d0a62a';
  g.fillRect(0, 0, 128, 16);
  g.fillStyle = '#16181a';
  for (let x = -16; x < 144; x += 32) {
    g.beginPath();
    g.moveTo(x, 16);
    g.lineTo(x + 16, 16);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.fill();
  }
  hazardTex = new THREE.CanvasTexture(c);
  hazardTex.colorSpace = THREE.SRGBColorSpace;
  hazardTex.wrapS = THREE.RepeatWrapping;
  return hazardTex;
}

// 골판 셔터 무늬
let shutterTex = null;
function shutter() {
  if (shutterTex) return shutterTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 256; y += 16) {
    const grd = g.createLinearGradient(0, y, 0, y + 16);
    grd.addColorStop(0, '#8d949b');
    grd.addColorStop(0.5, '#c3c8cc');
    grd.addColorStop(1, '#6b7177');
    g.fillStyle = grd;
    g.fillRect(0, y, 64, 16);
  }
  shutterTex = new THREE.CanvasTexture(c);
  shutterTex.colorSpace = THREE.SRGBColorSpace;
  shutterTex.wrapS = shutterTex.wrapT = THREE.RepeatWrapping;
  return shutterTex;
}

// 미는 상자 옆면: 나무판 + "PUSH" 스텐실 + 합력 화살표
let crateTex = null;
function crateTexture() {
  if (crateTex) return crateTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8a6a44';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    g.fillStyle = y % 64 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
    g.fillRect(0, y, 256, 30);
    g.fillStyle = 'rgba(30,20,10,0.6)';
    g.fillRect(0, y + 30, 256, 2);
  }
  g.strokeStyle = 'rgba(40,28,16,0.8)';
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(10, 10);
  g.lineTo(246, 246);
  g.stroke();
  g.fillStyle = 'rgba(20,20,20,0.85)';
  g.font = `800 40px ${FONT}`;
  g.textAlign = 'center';
  g.fillText('PUSH', 128, 96);
  g.font = `700 22px ${FONT}`;
  g.fillText('→ 합력 ←', 128, 140);
  g.font = `500 16px ${FONT}`;
  g.fillText('함께 밀면 더 빨리', 128, 176);
  crateTex = new THREE.CanvasTexture(c);
  crateTex.colorSpace = THREE.SRGBColorSpace;
  return crateTex;
}

class Helix extends THREE.Curve {
  constructor(r, h, turns) {
    super();
    this.r = r;
    this.h = h;
    this.turns = turns;
  }
  getPoint(t, out = new V3()) {
    const a = t * this.turns * Math.PI * 2;
    return out.set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r);
  }
}

export class DevicesView {
  constructor(scene, match, { museum = false } = {}) {
    this.match = match;
    this.map = match.map;
    this.museum = museum;
    this.group = new THREE.Group();
    this.group.name = 'devices';
    scene.add(this.group);
    this.views = [];
    const steel = new THREE.MeshStandardMaterial({ color: '#4a4f55', metalness: 0.8, roughness: 0.38 });
    const dark = new THREE.MeshStandardMaterial({ color: '#25282c', metalness: 0.5, roughness: 0.6 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#d0a62a', metalness: 0.3, roughness: 0.5 });
    const brass = new THREE.MeshStandardMaterial({ color: '#b48a3e', metalness: 0.85, roughness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: '#cfe3ec', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide });
    const water = new THREE.MeshStandardMaterial({ color: '#2b7590', transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.1, emissive: '#0b2833', emissiveIntensity: 0.6 });
    this.mats = { steel, dark, yellow, brass, glass, water };
    for (const d of match.devices.list) {
      const build = { pad: this.buildPad, lift: this.buildLift, gate: this.buildGate, slide: this.buildSlide, crate: this.buildCrate }[d.type];
      const v = build ? build.call(this, d) : null;
      if (v) this.views.push(v);
    }
  }

  floorY(f) {
    return f ? STORY : 0;
  }

  // 안내판 (기둥 위 판). at: 위치, rotY: 바라보는 방향
  sign(info, at, rotY, h = 1.55) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06).translate(0, h / 2, 0), this.mats.dark);
    // 앞뒤 양면에 같은 안내 (어느 쪽에서 와도 읽힘)
    const mat = new THREE.MeshStandardMaterial({ map: signTexture(info.name, info.line, this.museum), roughness: 0.6 });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), mat);
    panel.position.set(0, h + 0.2, 0.03);
    const panel2 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), mat);
    panel2.position.set(0, h + 0.2, -0.03);
    panel2.rotation.y = Math.PI;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.49, 0.05).translate(0, h + 0.2, 0), this.mats.dark);
    g.add(post, back, panel, panel2);
    g.position.copy(at);
    g.rotation.y = rotY;
    this.group.add(g);
    return g;
  }

  // ── 탄성 발판: 받침 + 경고 테두리 + 용수철 + 윗판(목표 방향 화살표)
  buildPad(d) {
    const m = this.map;
    const x = m.cellX(d.c), z = m.cellZ(d.r), y = this.floorY(d.f);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.88, 0.1, 28).translate(0, 0.05, 0), this.mats.dark);
    const rimTex = hazard().clone();
    rimTex.repeat.set(6, 1);
    rimTex.needsUpdate = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.04, 28, 1, true).translate(0, 0.08, 0), new THREE.MeshStandardMaterial({ map: rimTex, roughness: 0.6, side: THREE.DoubleSide }));
    const spring = new THREE.Mesh(new THREE.TubeGeometry(new Helix(0.42, 0.34, 6), 160, 0.035, 6), this.mats.steel);
    spring.position.y = 0.1;
    const top = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.06, 28), this.mats.yellow);
    const arrow = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.12, -0.35), new THREE.Vector2(0.12, -0.35), new THREE.Vector2(0.12, 0.05), new THREE.Vector2(0.3, 0.05), new THREE.Vector2(0, 0.42), new THREE.Vector2(-0.3, 0.05), new THREE.Vector2(-0.12, 0.05)])).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#16181a', roughness: 0.7 }),
    );
    arrow.position.y = 0.032;
    // 화살표가 목표 쪽을 가리킴
    arrow.rotation.y = Math.atan2(-(m.cellX(d.to.c) - x), -(m.cellZ(d.to.r) - z));
    top.add(plate, arrow);
    top.position.y = 0.47;
    g.add(base, rim, spring, top);
    this.group.add(g);
    const info = DEVICE_INFO.pad;
    // 안내판: 발판 뒤쪽(목표 반대쪽) 모서리
    const back = new V3(x - m.cellX(d.to.c), 0, z - m.cellZ(d.to.r)).normalize();
    this.sign(info, new V3(x + back.x * 0.95 + back.z * 0.7, y, z + back.z * 0.95 - back.x * 0.7), Math.atan2(back.x, back.z));
    return {
      d,
      update: () => {
        const t = d.st.t ?? 9;
        const sy = t < 0.06 ? 1 - (t / 0.06) * 0.6 : t < 0.2 ? 0.4 + ((t - 0.06) / 0.14) * 1.1 : 1.5 - Math.min(0.5, (t - 0.2) * 2.5);
        spring.scale.y = sy;
        top.position.y = 0.1 + 0.34 * sy + 0.03;
      },
    };
  }

  // ── 승강기: 바닥판 + 그 아래 기둥 (도르래: 가위형 받침·도르래·평형추 / 부력: 유리관 속 물기둥)
  buildLift(d) {
    const m = this.map;
    const x = m.cellX(d.c), z = m.cellZ(d.r);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const W = CELL * 0.94;
    const buoy = d.kind === 'buoyancy';
    const deck = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, W).translate(0, -0.06, 0), buoy ? this.mats.brass : this.mats.yellow);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.05, W + 0.02).translate(0, -0.15, 0), this.mats.dark);
    deck.add(plate, edge);
    g.add(deck);
    // 네 모서리 기둥 (1층 바닥 ~ 2층 위 2.6m)
    const H = STORY + 2.6;
    const posts = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) posts.push(new THREE.BoxGeometry(0.1, H, 0.1).translate((sx * W) / 2, H / 2, (sz * W) / 2));
    posts.push(new THREE.BoxGeometry(W, 0.12, 0.12).translate(0, H, -W / 2), new THREE.BoxGeometry(W, 0.12, 0.12).translate(0, H, W / 2));
    g.add(new THREE.Mesh(mergeGeometries(posts), buoy ? this.mats.brass : this.mats.dark));
    let column = null, scissor = null, counter = null, cables = null;
    if (buoy) {
      // 유리관 + 물기둥 (물이 차오르는 만큼 바닥판이 뜸 = 부력)
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.42, W * 0.42, 1, 24, 1, true).translate(0, 0.5, 0), this.mats.glass);
      column = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.4, W * 0.4, 1, 24).translate(0, 0.5, 0), this.mats.water);
      column.renderOrder = 2;
      tube.renderOrder = 3;
      g.add(column, tube);
      this.tube = tube;
      column.userData.tube = tube;
    } else {
      // 가위형 받침 (높이에 따라 접힘) + 위 도르래 + 줄 + 평형추
      scissor = new THREE.Group();
      const bar = new THREE.BoxGeometry(1, 0.07, 0.07);
      for (let k = 0; k < 8; k++) scissor.add(new THREE.Mesh(bar, this.mats.yellow));
      g.add(scissor);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 8, 24), this.mats.steel);
      wheel.position.set(0, H + 0.1, 0);
      wheel.rotation.y = Math.PI / 2;
      g.add(wheel);
      counter = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), this.mats.dark);
      counter.position.set(W / 2 - 0.15, 0, 0);
      g.add(counter);
      cables = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5).translate(0, 0.5, 0), this.mats.steel);
      g.add(cables);
      this.wheel = wheel;
    }
    this.group.add(g);
    const info = buoy ? DEVICE_INFO.lift : DEVICE_INFO.pulley;
    this.sign({ ...info, name: buoy ? '부력 승강기' : info.name }, new V3(x - CELL * 0.5 - 0.2, 0, z + CELL * 0.5 + 0.2), Math.PI / 4);
    return {
      d,
      update: () => {
        const y = d.st.y ?? 0;
        deck.position.y = Math.max(0.12, y);
        if (column) {
          column.scale.y = Math.max(0.02, y - 0.1);
          column.userData.tube.scale.y = Math.max(0.15, y + 0.05);
        }
        if (scissor) {
          // 가위형 받침: X 두 겹(양옆)이 바닥판 높이에 맞춰 펴짐
          const hh = Math.max(0.12, y) - 0.15;
          scissor.visible = hh > 0.05;
          const seg = Math.max(0.01, hh) / 2;
          const len = Math.hypot(W * 0.85, seg);
          const ang = Math.atan2(seg, W * 0.85);
          scissor.children.forEach((b, i) => {
            const level = i >> 2, side = (i >> 1) & 1 ? 1 : -1, flip = i & 1 ? 1 : -1;
            b.scale.x = len;
            b.position.set(0, seg * level + seg / 2, side * 0.35);
            b.rotation.z = ang * flip;
          });
          counter.position.y = Math.max(0.3, STORY + 2.0 - y);
          cables.position.set(0, Math.max(0.12, y), 0);
          cables.scale.y = H - Math.max(0.12, y);
        }
      },
    };
  }

  // ── 지레 셔터: 문 칸마다 골판 셔터(위에서 내려옴) + 지렛대(받침점·손잡이)
  buildGate(d) {
    const m = this.map;
    const top = STORY - SLAB;
    const shutters = [];
    const mat = new THREE.MeshStandardMaterial({ map: shutter(), metalness: 0.55, roughness: 0.45 });
    for (const [r, c] of d.cells) {
      // 통로 방향: 남북이 벽이면 동서로 지나가는 문 → 셔터는 남북으로 펼쳐짐
      const ns = m.heightAt(c, r - 1) > 2 && m.heightAt(c, r + 1) > 2;
      const geo = new THREE.BoxGeometry(ns ? 0.1 : CELL, 1, ns ? CELL : 0.1).translate(0, -0.5, 0);
      const s = new THREE.Mesh(geo, mat);
      s.position.set(m.cellX(c), top, m.cellZ(r));
      s.castShadow = true;
      this.group.add(s);
      // 셔터 통 (말려 올라간 부분)
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, CELL, 12).rotateZ(Math.PI / 2).rotateY(ns ? Math.PI / 2 : 0), this.mats.dark);
      drum.position.set(m.cellX(c), top - 0.17, m.cellZ(r));
      this.group.add(drum);
      // 바닥 경고선
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(ns ? 0.3 : CELL, ns ? CELL : 0.3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: hazard(), transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
      stripe.position.set(m.cellX(c), 0.012, m.cellZ(r));
      this.group.add(stripe);
      shutters.push(s);
    }
    // 지렛대: 받침점 위의 긴 막대 (내리면 셔터가 내려옴)
    const levers = [];
    const [gr, gc] = d.cells[0];
    for (const lv of d.levers) {
      const x = m.cellX(lv.c), z = m.cellZ(lv.r), y = this.floorY(lv.f);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      // 셔터 쪽을 바라봄
      g.rotation.y = Math.atan2(-(m.cellX(gc) - x), -(m.cellZ(gr) - z));
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.3).translate(0, 0.45, 0), this.mats.dark);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.12), new THREE.MeshStandardMaterial({ map: hazard(), roughness: 0.6 }));
      plate.position.set(0, 0.84, 0.152);
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.95, 0.05);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8).translate(0, 0.375, 0), this.mats.steel);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10).translate(0, 0.78, 0), new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.4 }));
      const fulcrum = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.14, 3).translate(0, -0.07, 0), this.mats.yellow);
      pivot.add(arm, knob, fulcrum);
      g.add(base, plate, pivot);
      this.group.add(g);
      levers.push(pivot);
    }
    const lv0 = d.levers[0];
    if (lv0) this.sign({ ...DEVICE_INFO.gate, name: d.name ?? DEVICE_INFO.gate.name }, new V3(m.cellX(lv0.c) + 0.75, this.floorY(lv0.f), m.cellZ(lv0.r) + 0.75), Math.atan2(-(m.cellX(gc) - m.cellX(lv0.c)), -(m.cellZ(gr) - m.cellZ(lv0.r))) + Math.PI);
    return {
      d,
      update: () => {
        const st = d.st;
        const k = st.closed ? st.t : 1 - st.t; // 닫힌 정도 0~1
        for (const s of shutters) {
          s.scale.y = Math.max(0.02, k * top);
          s.visible = k > 0.01;
        }
        for (const p of levers) p.rotation.x = -0.75 + k * 1.5;
      },
    };
  }

  // ── 미끄럼틀 안내판 (미끄럼판 자체는 structure.js가 계단 대신 매끈한 판으로 그림)
  buildSlide(d) {
    const m = this.map;
    // 가장 높은 칸 옆에 안내판
    let best = null;
    for (let r = d.r0; r <= d.r1; r++) for (let c = d.c0; c <= d.c1; c++) {
      const rp = m.ramp(c, r);
      if (rp && (!best || rp.h1 > best.h)) best = { r, c, h: rp.h1, dir: rp.dir };
    }
    if (!best) return null;
    const RUP = [null, [0, -1], [0, 1], [-1, 0], [1, 0]][best.dir];
    // 아래쪽 끝 바닥(내려온 곳)에 세움
    const bottomR = best.r - RUP[1] * (Math.abs(d.r1 - d.r0) + 1), bottomC = best.c - RUP[0] * (Math.abs(d.c1 - d.c0) + 1);
    const at = new V3(m.cellX(bottomC) + (RUP[1] !== 0 ? -0.95 : 0), 0, m.cellZ(bottomR) + (RUP[0] !== 0 ? -0.95 : 0));
    this.sign(DEVICE_INFO.slide, at, Math.atan2(-RUP[0], -RUP[1]));
    return null;
  }

  // ── 미는 상자 (공장: 철띠 두른 나무 상자 / 과학관: 바퀴 달린 전시 수레). 칸 사이를 미끄러지듯 옮겨 감
  buildCrate(d) {
    const m = this.map;
    const g = new THREE.Group();
    const W = CELL * 0.9, H = 1.0;
    if (this.museum || d.kind === 'cart') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, W * 0.8).translate(0, 0.42, 0), new THREE.MeshStandardMaterial({ color: '#2b3a52', roughness: 0.5 }));
      const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.05, W * 0.8 + 0.04).translate(0, 0.74, 0), this.mats.brass);
      const glassBox = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.26, W * 0.6).translate(0, 0.9, 0), this.mats.glass);
      glassBox.renderOrder = 3;
      const wheels = [];
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) wheels.push(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14).rotateX(Math.PI / 2).translate((sx * W) / 2.6, 0.1, (sz * W * 0.8) / 2.4));
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 16, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(-W / 2 - 0.02, 0.62, 0), this.mats.brass);
      g.add(body, top, glassBox, new THREE.Mesh(mergeGeometries(wheels), this.mats.dark), handle);
    } else {
      const wood = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, W).translate(0, H / 2, 0), wood);
      const bands = [];
      for (const y of [0.12, H - 0.12]) bands.push(new THREE.BoxGeometry(W + 0.03, 0.07, W + 0.03).translate(0, y, 0));
      g.add(box, new THREE.Mesh(mergeGeometries(bands), this.mats.dark));
    }
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.group.add(g);
    return {
      d,
      update: () => {
        const st = d.st;
        const k = 1 - (1 - st.t) ** 3;
        const x = m.cellX(st.fromC) + (m.cellX(st.c) - m.cellX(st.fromC)) * k;
        const z = m.cellZ(st.fromR) + (m.cellZ(st.r) - m.cellZ(st.fromR)) * k;
        // 밀리는 중이면 살짝 흔들림
        const shake = st.pushers > 0 && st.t >= 1 ? Math.sin(performance.now() * 0.05) * 0.01 * Math.min(1, st.push * 3) : 0;
        g.position.set(x + shake, 0, z);
      },
    };
  }

  update() {
    for (const v of this.views) v.update?.();
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose?.();
        o.material.dispose();
      }
    });
  }
}
