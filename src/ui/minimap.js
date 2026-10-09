import { TILES, STORY } from '../sim/map.js';

const SITE = { A: '#d9a441', B: '#9b8ac4' };
const ZONE_FILL = { friction: 'rgba(150,200,215,0.22)', storm: 'rgba(196,150,90,0.26)', net: 'rgba(181,154,223,0.3)', collapse: 'rgba(181,154,223,0.32)' };

const ALLY = '#4fe0c0';
const ENEMY = '#ff4655';

// 지도: 지형·폭탄·아군·아군이 보고 있는 적(붉은 점)·지휘 지점·무전 보고(? 소리, ! 목격).
// mini = 왼쪽 위 미니맵 (구역 이름 없이 작게), 아니면 M을 누르고 있는 동안 보는 큰 작전 지도
export class TacticalMap {
  constructor(canvas, match, localId, { scale = 9, mini = false } = {}) {
    this.canvas = canvas;
    this.match = match;
    this.localId = localId;
    this.mini = mini;
    this.lastSeen = new Map(); // 적별 마지막으로 보인 곳 { x, z, t }
    const map = match.map;
    this.S = scale;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    canvas.width = map.cols * this.S * dpr;
    canvas.height = map.rows * this.S * dpr;
    canvas.style.width = `${map.cols * this.S}px`;
    canvas.style.height = `${map.rows * this.S}px`;
    this.g = canvas.getContext('2d');
    // 층마다 바탕 그림 (보고 있는 요원이 있는 층을 또렷하게)
    this.bases = [0, 1].map((floor) => this.drawBase(floor));
    this.t = 0;
  }

  // 평면도: 1층 지형 + 2층 바닥(빗금)·2층 벽·계단(오르는 쪽 화살표). floor = 강조할 층
  drawBase(floor) {
    const map = this.match.map;
    const S = this.S, mini = this.mini;
    const base = document.createElement('canvas');
    base.width = this.canvas.width;
    base.height = this.canvas.height;
    const b = base.getContext('2d');
    b.scale(this.dpr, this.dpr);
    const up = floor === 1;
    const RUP = [null, [0, -1], [0, 1], [-1, 0], [1, 0]];
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const ch = map.charAt(c, r);
        const kind = TILES[ch]?.kind;
        if (kind === 'wall') b.fillStyle = mini ? 'rgba(10,14,18,0.55)' : 'rgba(8,10,12,0.96)';
        else if (kind) b.fillStyle = 'rgba(150,160,170,0.75)';
        else if ('aA'.includes(ch)) b.fillStyle = 'rgba(217,164,65,0.3)';
        else if ('bB'.includes(ch)) b.fillStyle = 'rgba(155,138,196,0.3)';
        else b.fillStyle = 'rgba(78,88,98,0.78)';
        b.fillRect(c * S, r * S, S, S);
      }
    }
    // 2층을 볼 때는 1층을 어둡게 눌러 둠
    if (up) {
      b.fillStyle = 'rgba(6,8,10,0.55)';
      b.fillRect(0, 0, map.cols * S, map.rows * S);
    }
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const x = c * S, y = r * S;
        const u = map.upperAt(c, r);
        const floor2 = map.surfaces(c, r).includes(STORY);
        const rp = map.ramp(c, r);
        if (floor2) {
          const site = 'aA'.includes(u) ? '217,164,65' : 'bB'.includes(u) ? '155,138,196' : '170,182,194';
          b.fillStyle = `rgba(${site},${up ? 0.62 : 0.22})`;
          b.fillRect(x, y, S, S);
          // 빗금 (2층 표시)
          b.strokeStyle = `rgba(230,236,242,${up ? 0.28 : 0.2})`;
          b.lineWidth = 1;
          b.beginPath();
          b.moveTo(x, y + S);
          b.lineTo(x + S, y);
          b.stroke();
        } else if (up && (u === '#' || u === 'w') && map.charAt(c, r) !== '#') {
          b.fillStyle = 'rgba(8,10,12,0.9)';
          b.fillRect(x, y, S, S);
        }
        // 난간 (2층 가장자리의 노란 선)
        const rm = map.railMask[map.idx(c, r)];
        if (rm) {
          b.strokeStyle = `rgba(214,176,60,${up ? 0.95 : 0.45})`;
          b.lineWidth = 1.2;
          b.beginPath();
          if (rm & 1) { b.moveTo(x, y + 0.6); b.lineTo(x + S, y + 0.6); }
          if (rm & 2) { b.moveTo(x, y + S - 0.6); b.lineTo(x + S, y + S - 0.6); }
          if (rm & 4) { b.moveTo(x + 0.6, y); b.lineTo(x + 0.6, y + S); }
          if (rm & 8) { b.moveTo(x + S - 0.6, y); b.lineTo(x + S - 0.6, y + S); }
          b.stroke();
        }
        if (rp) {
          // 계단: 오르는 쪽을 가리키는 꺾쇠
          const [dx, dy] = RUP[rp.dir];
          b.fillStyle = 'rgba(120,132,144,0.85)';
          b.fillRect(x, y, S, S);
          b.strokeStyle = 'rgba(235,240,245,0.9)';
          b.lineWidth = 1.2;
          const cx = x + S / 2, cy = y + S / 2, k = S * 0.28;
          b.beginPath();
          b.moveTo(cx - dy * k - dx * k * 0.6, cy + dx * k - dy * k * 0.6);
          b.lineTo(cx + dx * k * 0.6, cy + dy * k * 0.6);
          b.lineTo(cx + dy * k - dx * k * 0.6, cy - dx * k - dy * k * 0.6);
          b.stroke();
        }
      }
    }
    if (mini) return base;
    // 구역 이름 (그 층에 해당하는 이름만)
    b.font = `600 ${Math.max(9, S * 1.05)}px "IBM Plex Sans KR", sans-serif`;
    b.textAlign = 'center';
    b.textBaseline = 'middle';
    for (const k of map.callouts) {
      if (k.f != null && k.f !== floor) continue;
      // 구역 위쪽 가장자리에 표시 (가운데의 폭탄 표시와 겹치지 않게)
      const cx = ((k.c0 + k.c1 + 1) / 2) * S, cy = (k.r1 - k.r0 >= 4 ? k.r0 + 1.2 : (k.r0 + k.r1 + 1) / 2) * S;
      b.fillStyle = k.f === 1 ? 'rgba(20,30,40,0.75)' : 'rgba(0,0,0,0.6)';
      const w = b.measureText(k.name).width + 8;
      b.fillRect(cx - w / 2, cy - S * 0.7, w, S * 1.4);
      b.fillStyle = 'rgba(215,220,226,0.82)';
      b.fillText(k.name, cx, cy + 0.5);
    }
    // 북쪽 표시 + 층
    b.fillStyle = 'rgba(215,220,226,0.8)';
    b.font = `700 ${S * 1.3}px Rajdhani, sans-serif`;
    b.fillText('N ▲', map.cols * S - S * 2.2, S * 1.2);
    b.fillText(up ? '2F' : '1F', S * 2, S * 1.2);
    return base;
  }

  toPx(x, z) {
    const map = this.match.map;
    return [((x - map.originX) / map.width) * map.cols * this.S, ((z - map.originZ) / map.depth) * map.rows * this.S];
  }

  update(dt, viewAgent) {
    this.t += dt;
    const g = this.g;
    const m = this.match;
    const S = this.S;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const floor = viewAgent && viewAgent.pos.y > STORY - 1 ? 1 : 0;
    g.drawImage(this.bases[floor], 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const myTeam = m.agentById(this.localId).team;
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // 아군이 만든 패치 구역
    for (const z of m.zones) {
      if (z.team !== myTeam) continue;
      const [x, y] = this.toPx(z.x, z.z);
      g.beginPath();
      g.arc(x, y, (z.radius / m.map.width) * m.map.cols * S, 0, Math.PI * 2);
      g.fillStyle = ZONE_FILL[z.type] ?? 'rgba(200,200,200,0.2)';
      g.fill();
    }

    // 무전으로 보고된 소리·목격 (점점 흐려짐)
    for (const i of m.intel[myTeam] ?? []) {
      const age = m.time - i.t;
      if (age > 8) continue;
      const [x, y] = this.toPx(i.x, i.z);
      const col = i.kind === 'seen' ? '#e5534b' : '#e3b341';
      g.globalAlpha = 1 - age / 8;
      g.strokeStyle = col;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, S * 0.9 + age * 0.6, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = col;
      g.font = `700 ${S * 1.1}px Rajdhani, sans-serif`;
      g.fillText(i.kind === 'seen' ? '!' : '?', x, y + 0.5);
      g.globalAlpha = 1;
    }

    // 지휘 지점
    const o = m.orders[myTeam];
    if (o) {
      let p = o.point;
      if (o.type === 'A' || o.type === 'B') p = m.bombById(o.type);
      if (o.type === 'regroup') p = m.agentById(o.issuerId)?.pos;
      if (p) {
        const [x, y] = this.toPx(p.x, p.z);
        g.strokeStyle = ALLY;
        g.lineWidth = 2;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.arc(x, y, S * 1.6, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    }

    for (const b of m.bombs) {
      const [x, y] = this.toPx(b.x, b.z);
      const col = b.state === 'defused' ? '#6fcf8e' : b.picker && b.picker && m.agentById(b.picker)?.team === myTeam ? '#e3b341' : SITE[b.id];
      g.beginPath();
      g.arc(x, y, S * 0.95, 0, Math.PI * 2);
      g.fillStyle = 'rgba(6,8,10,0.9)';
      g.fill();
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = col;
      g.font = `700 ${S * 1.2}px Rajdhani, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(b.id, x, y + 0.5);
      if ((b.y ?? 0) > 1) this.upMark(x, y, col);
    }

    // 적: 아군 누군가가 지금 보고 있거나 무게 감지기에 잡히면 붉은 점, 놓친 뒤 잠시 ? 표시
    for (const e of m.agents) {
      if (e.team === myTeam) continue;
      const seenNow = e.alive && (m.time - (e.spottedT ?? -99) < 0.35 || e.revealedUntil > m.time);
      if (seenNow) this.lastSeen.set(e.id, { x: e.pos.x, z: e.pos.z, t: m.time });
      if (!e.alive) this.lastSeen.delete(e.id);
      const last = this.lastSeen.get(e.id);
      if (!last) continue;
      const age = m.time - last.t;
      if (age > 3) {
        this.lastSeen.delete(e.id);
        continue;
      }
      const [x, y] = this.toPx(seenNow ? e.pos.x : last.x, seenNow ? e.pos.z : last.z);
      if (seenNow) {
        g.save();
        g.translate(x, y);
        g.rotate(-e.yaw);
        g.beginPath();
        g.moveTo(0, -S * 0.85);
        g.lineTo(S * 0.6, S * 0.55);
        g.lineTo(-S * 0.6, S * 0.55);
        g.closePath();
        g.fillStyle = ENEMY;
        g.fill();
        g.restore();
        if (e.pos.y > STORY - 1) this.upMark(x, y, ENEMY);
      } else {
        g.globalAlpha = 1 - age / 3;
        g.fillStyle = ENEMY;
        g.font = `700 ${S * 1.5}px Rajdhani, sans-serif`;
        g.fillText('?', x, y);
        g.globalAlpha = 1;
      }
    }

    // 아군 (서로 무전으로 위치를 앎)
    for (const a of m.agents) {
      if (!a.alive || a.team !== myTeam) continue;
      const [x, y] = this.toPx(a.pos.x, a.pos.z);
      const col = ALLY;
      // 내 시야 방향
      if (a.id === viewAgent.id) {
        g.save();
        g.translate(x, y);
        g.rotate(-a.yaw - Math.PI / 2);
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, S * 7);
        grad.addColorStop(0, 'rgba(255,255,255,0.28)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, S * 7, -0.6, 0.6);
        g.closePath();
        g.fill();
        g.restore();
      }
      g.save();
      g.translate(x, y);
      g.rotate(-a.yaw);
      const me = a.id === viewAgent.id;
      g.beginPath();
      g.moveTo(0, -S * 0.75);
      g.lineTo(S * 0.55, S * 0.55);
      g.lineTo(0, S * 0.3);
      g.lineTo(-S * 0.55, S * 0.55);
      g.closePath();
      g.fillStyle = me ? '#ffffff' : col;
      g.fill();
      if (me) {
        g.strokeStyle = col;
        g.lineWidth = 1.5;
        g.stroke();
      }
      g.restore();
      if (a.pos.y > STORY - 1) this.upMark(x, y, me ? '#ffffff' : col);
      if (!me && !this.mini) {
        g.fillStyle = 'rgba(215,220,226,0.85)';
        g.font = `500 ${Math.max(9, S)}px "IBM Plex Sans KR", sans-serif`;
        g.fillText(a.name, x, y - S * 1.3);
      }
    }
  }

  // 2층에 있는 것 표시 (바깥 고리)
  upMark(x, y, col) {
    const g = this.g;
    g.strokeStyle = col;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(x, y, this.S * 1.25, 0, Math.PI * 2);
    g.stroke();
  }
}
