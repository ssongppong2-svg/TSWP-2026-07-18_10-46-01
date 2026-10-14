import * as THREE from 'three';

// 표면 디테일: UV가 없는 정점색 모형(요원 단색 부품·1인칭 총·장갑·소품·가구)에도 재질감을 주는 공용 텍스처 + 셰이더 조각.
// 모형의 자기 좌표(뼈대에 붙은 몸이면 묶인 자세 좌표)를 세 방향에서 투영(삼면 투영)해 무늬가 몸에 붙어 따라다님.
//   R: 천 짜임 (능직 사선 + 실 굵기 흔들림)       → 천·고무: 밝기·요철
//   G: 긁힘 (가는 직선 · 금속 바탕이 드러남)      → 금속: 밝은 줄 · 매끈해짐
//   B: 때·얼룩 (낮은 주파수)                      → 모든 재질: 어두운 얼룩 · 거칠어짐
//   A: 잔요철 (폴리머 스티플·주물 표면)           → 플라스틱·도장: 잔 요철
// 재질 종류는 거칠기·금속성으로 정함 (거칠고 비금속 = 천, 금속성 높음 = 금속, 나머지 = 폴리머·도장)
// 사진 텍스처를 쓸 수 있으면 setDetailImages()로 같은 채널을 사진에서 뽑은 값으로 바꿈.

const S = 256;
export const DETAIL = {
  on: { value: 1 }, // 품질 '낮음'이면 0 (텍스처 읽기 생략)
  tex: { value: null },
};

const hash2 = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
// 타일 반복되는 값 노이즈 (주기 p 칸)
function tileNoise(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (a, b) => hash2(((a % p) + p) % p, ((b % p) + p) % p, seed);
  const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, p, seed, oct = 4) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += tileNoise(x, y, p, seed + o * 17) * amp;
    norm += amp;
    x *= 2;
    y *= 2;
    p *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

function proceduralDetail() {
  const data = new Uint8Array(S * S * 4);
  // 긁힘: 타일 안에서 감싸며 그은 가는 선
  const scratch = new Float32Array(S * S);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const x0 = rnd() * S, y0 = rnd() * S;
    const ang = (rnd() < 0.6 ? rnd() * 0.5 - 0.25 : rnd() * Math.PI);
    const len = 8 + rnd() * (rnd() < 0.2 ? 120 : 40);
    const strength = 0.35 + rnd() * 0.65;
    const steps = Math.ceil(len * 2);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const x = Math.round(x0 + Math.cos(ang) * len * t), y = Math.round(y0 + Math.sin(ang) * len * t);
      const fade = Math.sin(t * Math.PI);
      const idx = ((y % S) + S) % S * S + ((x % S) + S) % S;
      scratch[idx] = Math.max(scratch[idx], strength * fade);
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // 능직: 실 4개 주기의 사선 + 날실·씨실 굵기 흔들림
      const u = x / S, v = y / S;
      const twill = 0.5 + 0.5 * Math.sin(((x + y) / 4) * Math.PI * 2);
      const warp = 0.5 + 0.5 * Math.sin((x / 2) * Math.PI);
      const slub = fbm(u * 16, v * 64, 16, 3, 2);
      const fabric = 0.18 + 0.5 * twill * (0.75 + 0.25 * warp) + 0.32 * slub;
      // 때: 큰 얼룩 + 잔 얼룩 (밝을수록 깨끗)
      const grime = 0.35 + 0.65 * Math.min(1, Math.max(0, (fbm(u * 4, v * 4, 4, 41, 5) - 0.32) * 1.9));
      // 잔요철: 촘촘한 점무늬
      const stip = 0.5 + 0.5 * (fbm(u * 64, v * 64, 64, 77, 2) - 0.5) * 2.2;
      data[i] = Math.round(Math.min(1, Math.max(0, fabric)) * 255);
      data[i + 1] = Math.round(Math.min(1, scratch[y * S + x]) * 255);
      data[i + 2] = Math.round(Math.min(1, Math.max(0, grime)) * 255);
      data[i + 3] = Math.round(Math.min(1, Math.max(0, stip)) * 255);
    }
  }
  return data;
}

export function detailTexture() {
  if (DETAIL.tex.value) return DETAIL.tex.value;
  const t = new THREE.DataTexture(proceduralDetail(), S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  DETAIL.tex.value = t;
  return t;
}

// ───── 셰이더 조각 ─────
const VERT_PARS = /* glsl */ `
  uniform float uDScale;
  varying vec3 vDP;
  varying vec3 vDN;
`;
const VERT_MAIN = /* glsl */ `
  vDP = position * uDScale;
  vDN = normal;
`;
const FRAG_PARS = /* glsl */ `
  uniform sampler2D uDTex;
  uniform float uDOn;
  uniform vec4 uDAmt; // 천 · 폴리머 · 금속 · 때 세기
  uniform float uDBump; // 요철 세기
  uniform float uDEdge; // 모서리 닳음 (1인칭 총: 화면에서 법선이 급히 꺾이는 곳 = 모서리)
  varying vec3 vDP;
  varying vec3 vDN;
  vec4 dTri(vec3 p, vec3 n) {
    vec3 w = pow(abs(n), vec3(4.0));
    w /= (w.x + w.y + w.z + 1e-5);
    return texture2D(uDTex, p.yz) * w.x + texture2D(uDTex, p.zx) * w.y + texture2D(uDTex, p.xy) * w.z;
  }
  // 높이 값의 화면 기울기로 법선을 기울임 (bump)
  vec3 dPerturb(vec3 pos, vec3 n, float h, float k) {
    vec3 sx = dFdx(pos), sy = dFdy(pos);
    vec3 r1 = cross(sy, n), r2 = cross(n, sx);
    float det = dot(sx, r1);
    vec2 dh = vec2(dFdx(h), dFdy(h)) * k;
    vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
    return normalize(abs(det) * n - grad);
  }
`;
// fab/pol/met: 재질 비중 식 (GLSL 표현식, rough·metal 변수 사용)
function fragColor(fab, pol, met) {
  return /* glsl */ `
    float dFade = uDOn * clamp(1.6 - length(vViewPosition) / 14.0, 0.0, 1.0);
    vec4 dD = vec4(0.5, 0.0, 1.0, 0.5);
    float dFab = 0.0, dPol = 0.0, dMet = 0.0, dH = 0.0;
    if (dFade > 0.001) {
      dD = dTri(vDP, normalize(vDN));
      dFab = (${fab}) * uDAmt.x;
      dMet = (${met}) * uDAmt.z;
      dPol = clamp(1.0 - dFab - dMet, 0.0, 1.0) * (${pol}) * uDAmt.y;
      float grimeK = mix(1.0, 0.68 + 0.32 * dD.b, uDAmt.w * dFade);
      diffuseColor.rgb *= grimeK * (1.0 + dFade * ((dD.r - 0.5) * 0.3 * dFab + (dD.a - 0.5) * 0.1 * dPol));
      diffuseColor.rgb += dFade * dMet * dD.g * 0.22 * (0.4 + diffuseColor.rgb);
      dH = dD.r * dFab + dD.a * dPol * 0.35 + dD.g * dMet * 0.4 - dD.b * 0.1;
    }
    float dWear = 0.0;
    #ifndef FLAT_SHADED
    if (uDEdge > 0.0 && dFade > 0.001) {
      // 모서리: 화면 한 칸 사이 법선 변화가 큰 곳 (둥근 모서리·홈 테두리) · 긁힘·잔요철로 끊어지게
      float curv = length(fwidth(normalize(vNormal)));
      dWear = smoothstep(0.07, 0.3, curv) * smoothstep(0.35, 0.75, dD.a * 0.7 + dD.g * 0.6 + (1.0 - dD.b) * 0.3) * uDEdge * (1.0 - dFab);
      vec3 bare = mix(diffuseColor.rgb * 1.7 + 0.025, vec3(0.2, 0.205, 0.215), dMet);
      diffuseColor.rgb = mix(diffuseColor.rgb, bare, dWear * 0.75);
    }
    #endif
  `;
}
const FRAG_ROUGH = /* glsl */ `
    if (dFade > 0.001) roughnessFactor = clamp(roughnessFactor + dFade * ((1.0 - dD.b) * 0.12 * uDAmt.w - dD.g * dMet * 0.35 + (dD.a - 0.5) * 0.1 * dPol) - dWear * 0.3, 0.04, 1.0);
`;
const FRAG_NORMAL = /* glsl */ `
    if (dFade > 0.001) normal = dPerturb(-vViewPosition, normal, dH, uDBump * dFade);
`;

// 정점색 재질(makeSolidMaterial)용: 재질 종류를 거칠기(vRME.x)·금속성(vRME.y)으로
export function solidDetailChunks() {
  return {
    vertPars: VERT_PARS,
    vertMain: VERT_MAIN,
    fragPars: FRAG_PARS,
    fragColor: fragColor('smoothstep(0.72, 0.9, vRME.x) * (1.0 - vRME.y)', '1.0', 'smoothstep(0.25, 0.6, vRME.y)'),
    fragRough: FRAG_ROUGH,
    fragNormal: FRAG_NORMAL,
  };
}

export function detailUniforms(scale, amt = [1, 1, 1, 1], bump = 0.006, edge = 0) {
  detailTexture();
  return { uDTex: DETAIL.tex, uDOn: DETAIL.on, uDScale: { value: scale }, uDAmt: { value: new THREE.Vector4(...amt) }, uDBump: { value: bump }, uDEdge: { value: edge } };
}

// 일반 MeshStandardMaterial에 디테일을 덧붙임 (이미 텍스처가 있는 천·장갑 등). kind: 'fabric' | 'poly' | 'metal'
export function addDetail(material, { scale = 6, kind = 'fabric', amt = [1, 1, 1, 1], bump = 0.006 } = {}) {
  const fab = kind === 'fabric' ? '1.0' : '0.0';
  const met = kind === 'metal' ? '1.0' : '0.0';
  const prev = material.onBeforeCompile;
  const uni = detailUniforms(scale, amt, bump);
  material.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragColor(fab, '1.0', met)}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|detail-${kind}`;
  material.needsUpdate = true;
  return material;
}
