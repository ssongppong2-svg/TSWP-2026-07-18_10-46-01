import { TEAM_INFO } from '../sim/constants.js';
import { TILES } from '../sim/map.js';

const SITE = { A: '#d9a441', B: '#9b8ac4' };
const ZONE_FILL = { friction: 'rgba(150,200,215,0.22)', storm: 'rgba(196,150,90,0.26)', net: 'rgba(181,154,223,0.3)', collapse: 'rgba(181,154,223,0.32)' };

// 작전 지도 (M을 누르고 있는 동안): 지형·구역 이름·폭탄·아군·지휘 지점·무전 보고(? 소리, ! 목격)만 표시. 적 위치는 없음.
export class TacticalMap {
  constructor(canvas, match, localId, { scale = 9 } = {}) {
    this.canvas = canvas;
    this.match = match;
    this.localId = localId;
    const map = match.map;
    this.S = scale;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    canvas.width = map.cols * this.S * dpr;
    canvas.height = map.rows * this.S * dpr;
    canvas.style.width = `${map.cols * this.S}px`;
    canvas.style.height = `${map.rows * this.S}px`;
    this.g = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = canvas.width;
    this.base.height = canvas.height;
    const b = this.base.getContext('2d');
    b.scale(dpr, dpr);
    const S = this.S;
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const ch = map.charAt(c, r);
        const kind = TILES[ch]?.kind;
        if (kind === 'wall') b.fillStyle = 'rgba(8,10,12,0.96)';
        else if (kind) b.fillStyle = 'rgba(112,118,124,0.85)';
        else if ('aA'.includes(ch)) b.fillStyle = 'rgba(217,164,65,0.22)';
        else if ('bB'.includes(ch)) b.fillStyle = 'rgba(155,138,196,0.22)';
        else if (ch === 'F') b.fillStyle = 'rgba(224,138,60,0.2)';
        else if (ch === 'D') b.fillStyle = 'rgba(94,196,214,0.2)';
        else b.fillStyle = 'rgba(52,57,63,0.82)';
        b.fillRect(c * S, r * S, S, S);
      }
    }
    // 구역 이름 (무전 보고에 쓰는 이름)
    b.font = `600 ${Math.max(9, S * 1.05)}px "IBM Plex Sans KR", sans-serif`;
    b.textAlign = 'center';
    b.textBaseline = 'middle';
    for (const k of map.callouts) {
      // 구역 위쪽 가장자리에 표시 (가운데의 폭탄 표시와 겹치지 않게)
      const cx = ((k.c0 + k.c1 + 1) / 2) * S, cy = (k.r1 - k.r0 >= 4 ? k.r0 + 1.2 : (k.r0 + k.r1 + 1) / 2) * S;
      b.fillStyle = 'rgba(0,0,0,0.6)';
      const w = b.measureText(k.name).width + 8;
      b.fillRect(cx - w / 2, cy - S * 0.7, w, S * 1.4);
      b.fillStyle = 'rgba(215,220,226,0.82)';
      b.fillText(k.name, cx, cy + 0.5);
    }
    // 북쪽 표시
    b.fillStyle = 'rgba(215,220,226,0.8)';
    b.font = `700 ${S * 1.3}px Rajdhani, sans-serif`;
    b.fillText('N ▲', map.cols * S - S * 2.2, S * 1.2);
    this.t = 0;
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
    g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const myTeam = m.agentById(this.localId).team;

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
        g.strokeStyle = TEAM_INFO[myTeam].color;
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
    }

    // 아군 (서로 무전으로 위치를 앎)
    for (const a of m.agents) {
      if (!a.alive || a.team !== myTeam) continue;
      const [x, y] = this.toPx(a.pos.x, a.pos.z);
      const col = TEAM_INFO[a.team].color;
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
      if (!me) {
        g.fillStyle = 'rgba(215,220,226,0.85)';
        g.font = `500 ${Math.max(9, S)}px "IBM Plex Sans KR", sans-serif`;
        g.fillText(a.name, x, y - S * 1.3);
      }
    }
  }
}
