import * as THREE from 'three';

// 이미지 파일 없이 캔버스로 그린 텍스처. 한 파일 빌드(오프라인 실행)를 위해 전부 코드로 만듭니다.

function canvasTexture(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noise(g, w, h, amount, alpha = 0.08, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(rnd() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rnd()})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

export function createTextures() {
  // 바닥: 4m × 4m 한 장에 2m 타일 2×2
  const floor = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#2b323e';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 9000, 0.1, 3);
    const t = w / 2;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const x = i * t, y = j * t;
        const grd = g.createLinearGradient(x, y, x + t, y + t);
        grd.addColorStop(0, 'rgba(255,255,255,0.035)');
        grd.addColorStop(1, 'rgba(0,0,0,0.06)');
        g.fillStyle = grd;
        g.fillRect(x + 3, y + 3, t - 6, t - 6);
        g.strokeStyle = '#1c222b';
        g.lineWidth = 6;
        g.strokeRect(x + 3, y + 3, t - 6, t - 6);
        g.strokeStyle = 'rgba(120,140,170,0.18)';
        g.lineWidth = 1.5;
        g.strokeRect(x + 7, y + 7, t - 14, t - 14);
        g.fillStyle = 'rgba(160,180,210,0.25)';
        for (const [bx, by] of [[14, 14], [t - 14, 14], [14, t - 14], [t - 14, t - 14]]) {
          g.beginPath();
          g.arc(x + bx, y + by, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  });

  // 벽: 가로 4m, 세로는 벽 높이(4.8m) 전체
  const wallDraw = (emissive) => (g, w, h) => {
    if (emissive) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
    } else {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#9aa5b5');
      grd.addColorStop(0.5, '#b8c1cd');
      grd.addColorStop(1, '#8e98a8');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 14000, 0.09, 7);
    }
    const pw = w / 2;
    const stripeY = h * (1 - 1.15 / 4.8);
    const skirtY = h * (1 - 0.35 / 4.8);
    for (let i = 0; i < 2; i++) {
      const x = i * pw;
      if (!emissive) {
        g.strokeStyle = 'rgba(40,48,60,0.55)';
        g.lineWidth = 4;
        g.strokeRect(x + 2, 2, pw - 4, h - 4);
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.lineWidth = 1.5;
        g.strokeRect(x + 8, 10, pw - 16, stripeY - 24);
        // 환풍구
        g.fillStyle = 'rgba(30,36,46,0.5)';
        for (let k = 0; k < 6; k++) g.fillRect(x + pw * 0.3, h * 0.12 + k * 9, pw * 0.4, 4);
        g.fillStyle = 'rgba(30,36,46,0.75)';
        g.fillRect(x, skirtY, pw, h - skirtY);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        for (const [bx, by] of [[10, 10], [pw - 10, 10], [10, skirtY - 10], [pw - 10, skirtY - 10]]) {
          g.beginPath();
          g.arc(x + bx, by, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      // 빛나는 띠
      g.fillStyle = emissive ? '#5fd6ff' : '#3c4a5c';
      g.fillRect(x, stripeY - 5, pw, 10);
      if (!emissive) {
        g.fillStyle = '#9fe9ff';
        g.fillRect(x, stripeY - 2, pw, 4);
      }
    }
  };
  const wall = canvasTexture(512, 614, wallDraw(false));
  const wallEmissive = canvasTexture(512, 614, wallDraw(true));

  const wallTop = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#2f3540';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 4000, 0.12, 11);
    g.strokeStyle = '#ffcc33';
    g.lineWidth = 10;
    g.setLineDash([18, 18]);
    g.strokeRect(5, 5, w - 10, h - 10);
  });

  // 작은 상자: 주황 안전 상자
  const crate = canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#e39a2f';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 6000, 0.12, 5);
    g.save();
    g.beginPath();
    g.rect(0, 0, w, 26);
    g.rect(0, h - 26, w, 26);
    g.clip();
    g.fillStyle = '#1e1e22';
    for (let x = -h; x < w + h; x += 36) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 18, 0);
      g.lineTo(x + 18 + h, h);
      g.lineTo(x + h, h);
      g.fill();
    }
    g.restore();
    g.strokeStyle = 'rgba(60,35,10,0.6)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
    roundRect(g, w * 0.32, h * 0.3, w * 0.36, h * 0.4, 10);
    g.fillStyle = 'rgba(30,24,20,0.85)';
    g.fill();
    g.fillStyle = '#ffd27a';
    g.font = `900 ${h * 0.24}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('10 N', w / 2, h / 2 + 2);
  });

  // 큰 상자: 컨테이너
  const container = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#2f6f7c';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 9000, 0.12, 9);
    for (let x = 0; x < w; x += 32) {
      const grd = g.createLinearGradient(x, 0, x + 32, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0.25)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
      grd.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 32, h);
    }
    g.fillStyle = 'rgba(15,30,36,0.8)';
    g.fillRect(0, 0, w, 18);
    g.fillRect(0, h - 18, w, 18);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = `900 46px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('FORCE LAB', w / 2, h * 0.45);
    g.font = `700 26px ${FONT}`;
    g.fillStyle = 'rgba(255,220,120,0.9)';
    g.fillText('질량 2000 kg · 무게 약 20000 N', w / 2, h * 0.56);
  });

  const barrier = canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#8d939c';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 8000, 0.14, 13);
    g.fillStyle = '#20232a';
    g.fillRect(0, 0, w, 34);
    g.save();
    g.beginPath();
    g.rect(0, 0, w, 34);
    g.clip();
    g.fillStyle = '#f2c230';
    for (let x = -40; x < w + 40; x += 40) {
      g.beginPath();
      g.moveTo(x, 34);
      g.lineTo(x + 20, 34);
      g.lineTo(x + 40, 0);
      g.lineTo(x + 20, 0);
      g.fill();
    }
    g.restore();
    g.strokeStyle = 'rgba(40,44,50,0.5)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 2, h - 4);
  });

  return { floor, wall, wallEmissive, wallTop, crate, container, barrier };
}

// 바닥에 그리는 구역 표시 (A, B)
export function siteDecal(letter, color) {
  return canvasTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = color;
    g.globalAlpha = 0.9;
    g.lineWidth = 18;
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 6;
    g.setLineDash([24, 18]);
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.33, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 0.85;
    g.fillStyle = color;
    g.font = `900 ${h * 0.42}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, w / 2, h / 2 + h * 0.03);
  });
}

// 벽에 붙이는 과학 포스터
export function posterTexture({ title, lines, color, icon }) {
  return canvasTexture(512, 704, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#141a26');
    grd.addColorStop(1, '#0b0f17');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 10;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = color;
    g.fillRect(5, 5, w - 10, 96);
    g.fillStyle = '#0b0f17';
    g.font = `900 64px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(title, w / 2, 56);
    if (icon) icon(g, w / 2, 250, color);
    g.fillStyle = '#e8eef8';
    g.font = `700 30px ${FONT}`;
    lines.forEach((l, i) => g.fillText(l, w / 2, 450 + i * 50));
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = `600 22px ${FONT}`;
    g.fillText('FORCE BOUND · 과학 연구소', w / 2, h - 34);
  });
}

// 큰 글자 표지판
export function signTexture(text, color, sub = '') {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = 'rgba(10,14,22,0.92)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = color;
    g.font = `900 ${sub ? 120 : 150}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, sub ? h * 0.42 : h / 2);
    if (sub) {
      g.font = `700 36px ${FONT}`;
      g.fillStyle = '#dfe8f5';
      g.fillText(sub, w / 2, h * 0.8);
    }
  });
}

// 이름표·라벨용 스프라이트 텍스처
export function labelTexture(text, color = '#ffffff', { bg = 'rgba(8,12,20,0.7)', size = 44, width = 320 } = {}) {
  return canvasTexture(width, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = `800 ${size}px ${FONT}`;
    const tw = Math.min(w - 8, g.measureText(text).width + 40);
    if (bg) {
      roundRect(g, (w - tw) / 2, 14, tw, h - 28, 18);
      g.fillStyle = bg;
      g.fill();
    }
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

// 부드러운 빛 점 (파티클·총구 화염)
export function glowTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.15)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, { srgb: false });
}

export function flashTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.translate(w / 2, h / 2);
    for (let i = 0; i < 7; i++) {
      g.rotate((Math.PI * 2) / 7);
      const grd = g.createLinearGradient(0, 0, w * 0.48, 0);
      grd.addColorStop(0, 'rgba(255,240,200,1)');
      grd.addColorStop(1, 'rgba(255,160,60,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, -10);
      g.lineTo(w * 0.48, 0);
      g.lineTo(0, 10);
      g.fill();
    }
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, w * 0.3);
    grd.addColorStop(0, 'rgba(255,255,240,1)');
    grd.addColorStop(1, 'rgba(255,190,90,0)');
    g.fillStyle = grd;
    g.fillRect(-w / 2, -h / 2, w, h);
  }, { srgb: false });
}

export function holeTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(10,10,12,0.95)');
    grd.addColorStop(0.35, 'rgba(20,20,24,0.8)');
    grd.addColorStop(0.6, 'rgba(40,40,46,0.3)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}

// 폭탄 화면 (남은 시간 표시). 매초 다시 그림.
export function createBombScreen() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (text, color, sub) => {
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.strokeRect(3, 3, 250, 122);
    g.fillStyle = color;
    g.font = `900 64px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 56);
    g.font = `700 22px ${FONT}`;
    g.fillText(sub, 128, 104);
    tex.needsUpdate = true;
  };
  return { texture: tex, draw };
}
