import * as THREE from 'three';

// 점광원 예산 관리.
// 장면의 점광원 수가 많을수록 모든 표면의 픽셀 계산이 그만큼 늘어나므로(저사양 기기의 가장 큰 부담),
// 실제 PointLight는 품질별로 정해진 개수(slots)만 두고, 매 프레임 카메라에 가장 영향이 큰 광원(등·폭탄·폭발)에 배정한다.
// 배정이 바뀔 때는 서서히 바꿔 깜빡임이 없게 하고, 실제 광원이 없는 등은 바닥·벽의 빛 웅덩이(world-view)로 대신한다.
// 개수는 바뀌지 않으므로 셰이더를 다시 컴파일하지 않는다.
export class LightRig {
  constructor(scene) {
    this.scene = scene;
    this.sources = new Set();
    this.slots = [];
    this.muzzles = [];
    this.muzzleNext = 0;
    this.group = new THREE.Group();
    this.group.name = 'lightRig';
    scene.add(this.group);
    this._list = [];
  }

  // 광원 수 설정 (품질 변경 시에만)
  setBudget(points, muzzles) {
    for (const s of this.slots) this.group.remove(s.light);
    for (const m of this.muzzles) this.group.remove(m.light);
    for (const src of this.sources) src.realW = 0;
    this.slots = Array.from({ length: points }, () => {
      const light = new THREE.PointLight('#ffffff', 0, 10, 2);
      this.group.add(light);
      return { light, src: null, w: 0 };
    });
    this.muzzles = Array.from({ length: muzzles }, () => {
      const light = new THREE.PointLight('#ffb866', 0, 11, 2);
      this.group.add(light);
      return { light, t: 0 };
    });
  }

  // src: { pos: Vector3, color: Color, intensity, distance, priority? } — 값은 바깥에서 바꿔도 됨
  add(src) {
    src.realW = 0;
    this.sources.add(src);
    return src;
  }

  remove(src) {
    this.sources.delete(src);
    for (const s of this.slots) if (s.src === src) s.src = null;
  }

  clear(filter = () => true) {
    for (const src of [...this.sources]) if (filter(src)) this.remove(src);
  }

  // 총구 섬광 (짧게 번쩍)
  flash(pos, intensity, dur = 0.045) {
    if (!this.muzzles.length) return;
    const m = this.muzzles[this.muzzleNext];
    this.muzzleNext = (this.muzzleNext + 1) % this.muzzles.length;
    m.light.position.copy(pos);
    m.light.intensity = intensity;
    m.t = dur;
  }

  update(dt, eye) {
    for (const m of this.muzzles) {
      if (m.t <= 0) continue;
      m.t -= dt;
      if (m.t <= 0) m.light.intensity = 0;
    }
    if (!this.slots.length) {
      for (const src of this.sources) src.realW = 0;
      return;
    }
    // 카메라 기준 영향도: 밝을수록, 가까울수록 (범위 밖은 제외)
    const list = this._list;
    list.length = 0;
    for (const src of this.sources) {
      if (!(src.intensity > 0)) continue;
      const d = src.pos.distanceTo(eye);
      const reach = src.distance + 18;
      if (d > reach) continue;
      const k = d / src.distance;
      src._score = (src.intensity / (1 + k * k)) * (1 + (src.priority ?? 0));
      list.push(src);
    }
    list.sort((a, b) => b._score - a._score);
    const want = new Set(list.slice(0, this.slots.length));
    const rate = dt * 5;
    // 빠지는 광원은 서서히 끄고, 새 광원은 빈 자리에 서서히 켬
    for (const s of this.slots) {
      if (s.src && !want.has(s.src)) {
        s.w = Math.max(0, s.w - rate);
        if (s.w === 0) {
          s.src.realW = 0;
          s.src = null;
        }
      }
    }
    for (const src of want) {
      let s = this.slots.find((x) => x.src === src);
      if (!s) {
        s = this.slots.find((x) => !x.src);
        if (!s) continue;
        s.src = src;
        s.w = (src.priority ?? 0) > 1 ? 1 : 0; // 폭발처럼 급한 빛은 바로
      }
      s.w = Math.min(1, s.w + rate);
    }
    for (const s of this.slots) {
      const L = s.light;
      if (!s.src) {
        L.intensity = 0;
        continue;
      }
      L.position.copy(s.src.pos);
      L.color.copy(s.src.color);
      L.distance = s.src.distance;
      L.intensity = s.src.intensity * s.w;
      s.src.realW = s.w;
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
