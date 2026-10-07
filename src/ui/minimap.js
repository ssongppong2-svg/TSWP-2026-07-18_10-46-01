import { TEAM_INFO } from '../sim/constants.js';
import { TILES } from '../sim/map.js';

const SITE = { A: '#d9a441', B: '#9b8ac4' };
const ZONE_FILL = { friction: 'rgba(150,200,215,0.22)', storm: 'rgba(196,150,90,0.26)', net: 'rgba(181,154,223,0.3)', collapse: 'rgba(181,154,223,0.32)' };

// 위가 북쪽(포스팀 진영)인 고정 미니맵
export class Minimap {
  constructor(canvas, match, localId) {
    this.canvas = canvas;
    this.match = match;
    this.localId = localId;
    const map = match.map;
    this.S = 5;
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
        if (kind === 'wall') b.fillStyle = 'rgba(8,10,12,0.94)';
        else if (kind) b.fillStyle = 'rgba(112,118,124,0.8)';
        else if ('aA'.includes(ch)) b.fillStyle = 'rgba(217,164,65,0.24)';
        else if ('bB'.includes(ch)) b.fillStyle = 'rgba(155,138,196,0.24)';
        else if (ch === 'F') b.fillStyle = 'rgba(224,138,60,0.22)';
        else if (ch === 'D') b.fillStyle = 'rgba(94,196,214,0.22)';
        else b.fillStyle = 'rgba(58,63,70,0.6)';
        b.fillRect(c * S, r * S, S, S);
      }
    }
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
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    for (const z of m.zones) {
      const [x, y] = this.toPx(z.x, z.z);
      g.beginPath();
      g.arc(x, y, (z.radius / m.map.width) * m.map.cols * this.S, 0, Math.PI * 2);
      g.fillStyle = ZONE_FILL[z.type] ?? 'rgba(200,200,200,0.2)';
      g.fill();
    }

    for (const b of m.bombs) {
      const [x, y] = this.toPx(b.x, b.z);
      const col = b.state === 'defused' ? '#6fcf8e' : b.picker ? '#e3b341' : SITE[b.id];
      const pulse = b.state === 'armed' ? 1 + Math.sin(this.t * 6) * 0.15 : 1;
      g.beginPath();
      g.arc(x, y, 6 * pulse, 0, Math.PI * 2);
      g.fillStyle = 'rgba(6,8,10,0.88)';
      g.fill();
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = col;
      g.font = '700 8px Rajdhani, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(b.id, x, y + 0.5);
    }

    const myTeam = m.agentById(this.localId).team;
    for (const a of m.agents) {
      if (!a.alive) continue;
      const mine = a.team === myTeam;
      const spotted = !mine && m.time - a.spottedT < 1.2;
      if (!mine && !spotted) continue;
      const [x, y] = this.toPx(a.pos.x, a.pos.z);
      const col = TEAM_INFO[a.team].color;
      g.save();
      g.translate(x, y);
      g.rotate(-a.yaw);
      if (a.id === viewAgent.id) {
        g.beginPath();
        g.moveTo(0, -6);
        g.lineTo(4.5, 4.5);
        g.lineTo(0, 2.5);
        g.lineTo(-4.5, 4.5);
        g.closePath();
        g.fillStyle = '#ffffff';
        g.fill();
        g.strokeStyle = col;
        g.lineWidth = 1.5;
        g.stroke();
        // 시야 부채꼴
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, 22, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
        g.closePath();
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fill();
      } else {
        g.beginPath();
        g.arc(0, 0, 3.2, 0, Math.PI * 2);
        g.fillStyle = spotted ? '#e0524a' : col;
        g.fill();
        g.beginPath();
        g.moveTo(0, -5.5);
        g.lineTo(2, -2.6);
        g.lineTo(-2, -2.6);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
  }
}
