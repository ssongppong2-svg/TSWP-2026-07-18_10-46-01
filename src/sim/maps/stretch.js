// 맵 넓히기: 글자 지도에 줄(가로)·칸(세로)을 끼워 넣어 공간을 늘리고, 맵에 적힌 모든 좌표(장치·문·지키는 자리·구역 이름·장식 …)를
// 같은 규칙으로 옮긴다. 원래 맵은 그대로 두고 넓힌 맵을 새로 만듦 (CQB 작전 맵처럼 원래 크기가 필요한 곳은 원본을 씀)
//
//   rows: { 줄번호: 끼울 수 } — 그 줄 바로 뒤에 같은 줄을 n번 더 넣음 (줄이 길어지는 쪽 = 남북)
//   cols: { 칸번호: 끼울 수 } — 그 칸 바로 오른쪽에 같은 칸을 n번 더 넣음 (동서)
// 끼워 넣는 칸은 원래 칸을 베끼되, 엄폐물(상자·방벽)은 옆으로 이어지지 않으면 바닥으로 바꿔 크기가 그대로이게 함.
// 폭탄(A·B) 칸은 구역 바닥으로. 계단은 길이가 바뀌지 않도록 계단을 따라가는 방향으로는 끼우지 않음(검사해서 막음)
const FLOOR = { A: 'a', B: 'b' };
const COVER = new Set(['C', 'c', '=']);
const UP_COVER = new Set(['C', 'c']);


// 줄 번호 옮기기: 앞쪽에 끼운 줄 수만큼 밀림
function indexMap(ins, n) {
  const at = new Array(n + 1).fill(0);
  let acc = 0;
  for (let i = 0; i <= n; i++) {
    at[i] = i + acc;
    acc += ins[i] ?? 0;
  }
  const idx = (i) => at[Math.max(0, Math.min(n, i))] + (i > n ? i - n : 0);
  return {
    idx, // 칸 하나 → 새 첫 칸
    end: (i) => idx(i) + (ins[i] ?? 0), // 범위 끝 칸 → 늘어난 마지막 칸
    // 연속 좌표 (경계·칸 안 위치): 늘어난 칸 안에서 같은 비율
    cont: (v) => {
      const i = Math.floor(v), f = v - i;
      return idx(i) + f * (1 + (ins[i] ?? 0));
    },
    // 칸 하나 → 늘어난 모든 칸
    all: (i) => Array.from({ length: 1 + (ins[i] ?? 0) }, (_, k) => idx(i) + k),
  };
}

// 끼워 넣는 글자 (k번째와 k+1번째 사이). cell(i) = 끼우는 방향으로 i번째 글자, perp(i, d) = 그 칸에서 수직 방향으로 d칸 옆 글자
//   · 양쪽이 벽 → 벽 (벽이 이어짐)
//   · 한쪽만 벽: 반대쪽이 문간(5칸 이내에 다시 벽이 있고, 둘 중 하나가 두께 2칸 이하의 '선' 벽)이면 → 벽을 늘려 문간 폭을 지킴
//     그 밖(방·마당 쪽 벽면) → 벽 건너편 방을 넓힘 → 벽 두께는 그대로
//   · 바닥 → 바닥 (엄폐물은 다음 칸도 같은 것일 때만 이어 붙여 크기가 그대로, 구역 바닥 a·b는 같은 줄 옆 칸을 따름)
const isWall = (ch) => ch === '#' || ch === 'w';
function fillFrom(x, next, side, upper) {
  if (FLOOR[x] && !upper) return FLOOR[x];
  const cover = upper ? UP_COVER : COVER;
  if (cover.has(x) && next !== x) {
    if (upper) return '-';
    return side.find((ch) => ch === 'a' || ch === 'b') ?? '.';
  }
  return x;
}
function insertCell(cell, perp, k, upper) {
  const a = cell(k), b = cell(k + 1) ?? a;
  if (isWall(a) && isWall(b)) return a;
  // 수직 방향으로 벽이 몇 칸 이어지는지 (2칸 이하 = 끼우는 방향으로 뻗은 담·벽 선)
  const perpRun = (i) => {
    let n = 1;
    for (const s of [-1, 1]) for (let d = s; isWall(perp(i, d)); d += s) n++;
    return n;
  };
  const line = (i) => perpRun(i) <= 2;
  // 문간인가: 벽(w)이 끼우는 방향으로 이어지는 벽 줄의 끝이고(뒤쪽도 벽 · 기둥 하나가 아님),
  // 반대쪽으로 바닥을 지나 5칸 안에 다시 벽이 있으며 둘 중 하나가 선 벽
  const doorway = (w, dir) => {
    if (!isWall(cell(w - dir))) return false;
    for (let j = 1; j <= 6; j++) {
      const ch = cell(w + dir * j);
      if (ch == null) return false;
      if (isWall(ch)) return j >= 2 && (line(w) || line(w + dir * j));
    }
    return false;
  };
  const side = (i) => [perp(i, -1), perp(i, 1)];
  if (isWall(a)) return doorway(k, 1) ? a : fillFrom(b, cell(k + 2), side(k + 1), upper);
  if (isWall(b)) return doorway(k + 1, -1) ? b : fillFrom(a, b, side(k), upper);
  return fillFrom(a, b, side(k), upper);
}

function stretchRows(rows, ins, upper) {
  const out = [];
  rows.forEach((row, r) => {
    out.push(row);
    const n = ins[r] ?? 0;
    if (!n) return;
    const copy = [...row].map((_, c) => insertCell((i) => rows[i]?.[c], (i, d) => rows[i]?.[c + d], r, upper)).join('');
    for (let k = 0; k < n; k++) out.push(copy);
  });
  return out;
}
function stretchCols(rows, ins, upper) {
  return rows.map((row, r) => {
    let s = '';
    [...row].forEach((ch, c) => {
      s += ch;
      const n = ins[c] ?? 0;
      if (n) s += insertCell((i) => row[i], (i, d) => rows[r + d]?.[i], c, upper).repeat(n);
    });
    return s;
  });
}

// 끼우면 안 되는 줄·칸 검사: 계단을 따라 늘이거나, 문·셔터·미끄럼틀을 자르는 경우
export function checkStretch(def, { rows = {}, cols = {} }) {
  const bad = [];
  const L = def.layout;
  // 남북 계단(^ v)이 있는 줄을 베끼면 계단이 길어지고, 동서 계단(< >)이 있는 칸을 베끼면 마찬가지 (옆으로 넓히는 것은 괜찮음)
  for (const r of Object.keys(rows).map(Number)) {
    if (/[\^v]/.test(L[r])) bad.push(`줄 ${r}: 남북 계단`);
    for (const d of def.doors ?? []) if (d.r === r) bad.push(`줄 ${r}: 문 (${d.r},${d.c})`);
  }
  for (const c of Object.keys(cols).map(Number)) {
    if (L.some((row) => /[<>]/.test(row[c]))) bad.push(`칸 ${c}: 동서 계단`);
    for (const d of def.doors ?? []) if (d.c === c) bad.push(`칸 ${c}: 문 (${d.r},${d.c})`);
  }
  for (const d of def.devices ?? []) {
    if (d.type === 'gate') for (const [r, c] of d.cells) if (r in rows || c in cols) bad.push(`셔터 (${r},${c})`);
    if (d.type === 'slide') {
      for (let r = d.r0; r <= d.r1; r++) if (r in rows) bad.push(`미끄럼틀 줄 ${r}`);
      for (let c = d.c0; c <= d.c1; c++) if (c in cols) bad.push(`미끄럼틀 칸 ${c}`);
    }
  }
  return bad;
}

export function stretchMap(def, plan, extra = {}) {
  const { rows = {}, cols = {} } = plan;
  const bad = checkStretch(def, plan);
  if (bad.length) throw new Error(`맵 넓히기 불가 (${def.id}): ${bad.join(', ')}`);
  const R = indexMap(rows, def.layout.length);
  const C = indexMap(cols, def.layout[0].length);
  const cell = (o) => (o ? { ...o, r: R.idx(o.r), c: C.idx(o.c) } : o);
  const look = (o) => ({ ...cell(o), ...(o.lr != null ? { lr: R.idx(o.lr), lc: C.idx(o.lc) } : {}), ...(o.via ? { via: cell(o.via) } : {}) });
  const range = (o) => ({ ...o, r0: R.idx(o.r0), r1: R.end(o.r1), c0: C.idx(o.c0), c1: C.end(o.c1) });
  const out = { ...def, ...extra };
  out.layout = stretchCols(stretchRows(def.layout, rows, false), cols, false);
  if (def.upper) out.upper = stretchCols(stretchRows(def.upper, rows, true), cols, true);
  if (def.roofs) out.roofs = def.roofs.map(range);
  if (def.devices) {
    out.devices = def.devices.map((d) => {
      const n = { ...d };
      if (d.r != null) Object.assign(n, cell(d));
      if (d.to) n.to = { ...d.to, ...cell(d.to) };
      if (d.cells) n.cells = d.cells.map(([r, c]) => [R.idx(r), C.idx(c)]);
      if (d.levers) n.levers = d.levers.map(cell);
      if (d.r0 != null) Object.assign(n, range(d));
      return n;
    });
  }
  if (def.doors) out.doors = def.doors.map(cell);
  if (def.holds) out.holds = Object.fromEntries(Object.entries(def.holds).map(([k, l]) => [k, l.map(look)]));
  if (def.staging) out.staging = Object.fromEntries(Object.entries(def.staging).map(([k, l]) => [k, l.map(look)]));
  if (def.callouts) out.callouts = def.callouts.map(range);
  if (def.concepts) out.concepts = def.concepts.map(cell);
  if (def.decor) {
    const d = def.decor;
    const n = { ...d };
    if (d.lamps) n.lamps = d.lamps.map(cell);
    if (d.posters) n.posters = { ...d.posters, faceRow: R.cont(d.posters.faceRow), cols: d.posters.cols.map(C.cont) };
    if (d.posterList) n.posterList = d.posterList.map((p) => ({ ...p, r: R.cont(p.r), c: C.cont(p.c) }));
    if (d.signs) n.signs = d.signs.map((s) => ({ ...s, x: C.cont(s.x), z: R.cont(s.z) }));
    // 진자는 칸 가운데 기준 좌표 (c + 0.5 = 경계 좌표)
    if (d.pendulum) n.pendulum = { r: R.cont(d.pendulum.r + 0.5) - 0.5, c: C.cont(d.pendulum.c + 0.5) - 0.5 };
    if (d.atriumCeiling) n.atriumCeiling = range(d.atriumCeiling);
    if (d.tanks) n.tanks = d.tanks.flatMap(([r, c]) => R.all(r).flatMap((rr) => C.all(c).map((cc) => [rr, cc])));
    out.decor = n;
  }
  if (def.op) {
    const o = def.op;
    out.op = { ...o, extract: o.extract && range(o.extract), hostages: o.hostages?.map(cell), intel: o.intel?.map(cell), posts: o.posts?.map((p) => ({ ...look(p), ...(p.patrol ? { patrol: cell(p.patrol) } : {}) })) };
  }
  // 넓힌 뒤 손볼 칸 [줄, 칸, 글자] (넓힌 좌표 기준 · 예: 새로 생긴 긴 시야를 상자로 막기)
  for (const [r, c, ch] of plan.edits ?? []) out.layout[r] = out.layout[r].slice(0, c) + ch + out.layout[r].slice(c + 1);
  out.stretched = { rows, cols, from: [def.layout.length, def.layout[0].length] };
  return out;
}
