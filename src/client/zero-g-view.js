// 무중력 구역 꾸밈: 경계를 알리는 빛나는 바닥 선 · 입구 바닥 표지 · 천천히 떠도는 화물·공구 · 떠다니는 먼지
//   떠 있는 물체는 장식(충돌 없음)이라 머리 위(2.4 m 이상)에만 둠 — 중력이 없으니 떨어지지 않고 처음 움직임대로 천천히 돎
import * as THREE from 'three';
import { CELL } from '../sim/constants.js';

const CYAN = '#4fd8ff';

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d');
  // 노랑·검정 빗금 테두리 + 가운데 글자
  g.fillStyle = 'rgba(10,14,20,0.82)';
  g.fillRect(0, 0, 512, 160);
  g.save();
  g.beginPath();
  g.rect(0, 0, 512, 160);
  g.rect(14, 14, 484, 132);
  g.clip('evenodd');
  for (let x = -160; x < 512; x += 36) {
    g.fillStyle = '#e8c23a';
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 18, 0);
    g.lineTo(x + 178, 160);
    g.lineTo(x + 160, 160);
    g.fill();
  }
  g.restore();
  g.fillStyle = CYAN;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 54px "Pretendard", "Noto Sans KR", system-ui, sans-serif';
  g.fillText('무중력 구역', 256, 66);
  g.font = '700 26px "Pretendard", "Noto Sans KR", system-ui, sans-serif';
  g.fillStyle = '#d8e6f2';
  g.fillText('ZERO-G · 중력 0 N/kg · 무게 0 N', 256, 118);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildZeroGDecor(map) {
  const group = new THREE.Group();
  group.name = 'zeroG';
  const floaters = [];
  const dusts = [];
  let seed = 17;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lineMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const mats = {
    box: new THREE.MeshStandardMaterial({ color: '#d7dde4', roughness: 0.5, metalness: 0.35 }),
    strap: new THREE.MeshStandardMaterial({ color: '#e8a23a', roughness: 0.6 }),
    can: new THREE.MeshStandardMaterial({ color: '#6c7f96', roughness: 0.35, metalness: 0.7 }),
    tool: new THREE.MeshStandardMaterial({ color: '#b9c0c8', roughness: 0.3, metalness: 0.9 }),
    cable: new THREE.MeshStandardMaterial({ color: '#e0782a', roughness: 0.7 }),
    led: new THREE.MeshBasicMaterial({ color: CYAN, toneMapped: false }),
  };
  for (const q of map.zeroG ?? []) {
    const x0 = map.originX + q.c0 * CELL, x1 = map.originX + (q.c1 + 1) * CELL;
    const z0 = map.originZ + q.r0 * CELL, z1 = map.originZ + (q.r1 + 1) * CELL;
    // 입구(구역 밖 칸과 이어진 가장자리 칸): 이어진 칸끼리 묶어 바닥 표지 하나씩
    const entries = [];
    const door = (c, r, inward, axis) => entries.push({ c, r, inward, axis });
    // 경계 선: 구역 가장자리 칸 중 걸을 수 있는 칸의 바깥 변 (벽 속에는 긋지 않음)
    const strip = (x, z, w, d) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.025, z);
      group.add(m);
    };
    for (let c = q.c0; c <= q.c1; c++) {
      for (const [r, out, edgeZ] of [[q.r0, q.r0 - 1, z0 + 0.12], [q.r1, q.r1 + 1, z1 - 0.12]]) {
        if (!map.walkable(c, r)) continue;
        strip(map.cellX(c), edgeZ, CELL * 0.8, 0.14);
        if (map.walkable(c, out)) door(c, r, out < r ? 1 : -1, 'z');
      }
    }
    for (let r = q.r0; r <= q.r1; r++) {
      for (const [c, out, edgeX] of [[q.c0, q.c0 - 1, x0 + 0.12], [q.c1, q.c1 + 1, x1 - 0.12]]) {
        if (!map.walkable(c, r)) continue;
        strip(edgeX, map.cellZ(r), 0.14, CELL * 0.8);
        if (map.walkable(out, r)) door(c, r, out < c ? 1 : -1, 'x');
      }
    }
    const runs = [];
    for (const e of entries) {
      const last = runs[runs.length - 1]?.at(-1);
      const along = e.axis === 'z' ? e.c : e.r;
      if (last && last.axis === e.axis && last.inward === e.inward && (e.axis === 'z' ? last.r === e.r : last.c === e.c) && along - (e.axis === 'z' ? last.c : last.r) === 1) runs.at(-1).push(e);
      else runs.push([e]);
    }
    for (const run of runs) {
      const e = run[0];
      const mx = run.reduce((t, q) => t + map.cellX(q.c), 0) / run.length;
      const mz = run.reduce((t, q) => t + map.cellZ(q.r), 0) / run.length;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(3.2, run.length * CELL - 0.3), Math.min(1.0, (run.length * CELL - 0.3) / 3.2)), signMat);
      sign.rotation.x = -Math.PI / 2;
      // 구역 밖에서 들어오며 읽히게: 글자 위쪽이 들어가는 쪽
      sign.rotation.z = e.axis === 'z' ? (e.inward > 0 ? Math.PI : 0) : e.inward > 0 ? -Math.PI / 2 : Math.PI / 2;
      sign.position.set(mx + (e.axis === 'x' ? e.inward * 0.9 : 0), 0.03, mz + (e.axis === 'z' ? e.inward * 0.9 : 0));
      group.add(sign);
    }
    // 떠도는 물체: 화물 상자·가스통·공구·감긴 전선
    const n = Math.round(((q.c1 - q.c0 + 1) * (q.r1 - q.r0 + 1)) / 6);
    for (let i = 0; i < n; i++) {
      const kind = i % 4;
      const o = new THREE.Group();
      if (kind === 0) {
        const s = 0.6 + rnd() * 0.5;
        o.add(new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s * 0.8), mats.box));
        const band = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, s * 0.72, 0.08), mats.strap);
        o.add(band);
      } else if (kind === 1) {
        o.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 14), mats.can));
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.14, 10), mats.tool);
        cap.position.y = 0.52;
        o.add(cap);
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.02), mats.led);
        led.position.set(0, 0.1, 0.205);
        o.add(led);
      } else if (kind === 2) {
        // 렌치
        o.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.6, 0.035), mats.tool));
        const head = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 6, 12, Math.PI * 1.5), mats.tool);
        head.position.y = 0.34;
        o.add(head);
      } else {
        o.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 24), mats.cable));
      }
      o.traverse((m) => m.isMesh && (m.castShadow = true));
      const base = new THREE.Vector3(x0 + 1 + rnd() * (x1 - x0 - 2), 2.6 + rnd() * 3.8, z0 + 1 + rnd() * (z1 - z0 - 2));
      o.position.copy(base);
      o.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
      floaters.push({ o, base, amp: new THREE.Vector3(0.3 + rnd() * 0.6, 0.15 + rnd() * 0.3, 0.3 + rnd() * 0.6), w: 0.08 + rnd() * 0.12, ph: rnd() * 6.28, spin: new THREE.Vector3((rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5) });
      group.add(o);
    }
    // 먼지: 공기 속에 가라앉지 않고 떠 있음
    const N = 140;
    const pos = new Float32Array(N * 3);
    const base = [];
    for (let i = 0; i < N; i++) {
      const p = [x0 + rnd() * (x1 - x0), 0.3 + rnd() * 6.6, z0 + rnd() * (z1 - z0)];
      base.push({ p, ph: rnd() * 6.28, w: 0.1 + rnd() * 0.25 });
      pos.set(p, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#cfe8ff', size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }));
    pts.frustumCulled = false;
    group.add(pts);
    dusts.push({ geo, base });
  }
  let last = null;
  group.userData.tick = (time) => {
    const dt = last == null ? 0 : Math.min(0.1, time - last);
    last = time;
    for (const f of floaters) {
      const t = time * f.w + f.ph;
      f.o.position.set(f.base.x + Math.sin(t) * f.amp.x, f.base.y + Math.sin(t * 1.3 + 1) * f.amp.y, f.base.z + Math.cos(t * 0.8) * f.amp.z);
      f.o.rotation.x += f.spin.x * dt;
      f.o.rotation.y += f.spin.y * dt;
      f.o.rotation.z += f.spin.z * dt;
    }
    for (const d of dusts) {
      const a = d.geo.attributes.position;
      d.base.forEach((b, i) => {
        const t = time * b.w + b.ph;
        a.setXYZ(i, b.p[0] + Math.sin(t) * 0.4, b.p[1] + Math.sin(t * 0.7) * 0.3, b.p[2] + Math.cos(t * 0.9) * 0.4);
      });
      a.needsUpdate = true;
    }
  };
  return group;
}
