import { LOADOUT_SLOTS, PATCHES, PATCH_ORDER } from './data.js';

// 포스 패치 선택 규칙
//  - 개인 장착: 일반 2 · 특수 1 · 필살 1 (C·Q·E·X)
//  - 패치마다 팀당 2개 (같은 팀에서 최대 2명)
//  - 먼저 고른 사람이 가져감 (선착순)
export const COPIES_PER_TEAM = 2;
export const TIER_SLOTS = LOADOUT_SLOTS.reduce((m, s) => ({ ...m, [s.tier]: (m[s.tier] ?? 0) + 1 }), {});
export const SLOTS_PER_PLAYER = LOADOUT_SLOTS.length;

const tierOf = (id) => PATCHES[id].tier;

export class TeamDraft {
  constructor(memberIds, patchIds = PATCH_ORDER) {
    this.patchIds = [...patchIds];
    this.stock = Object.fromEntries(this.patchIds.map((id) => [id, COPIES_PER_TEAM]));
    this.picks = new Map(memberIds.map((m) => [m, []]));
  }

  holders(patchId) {
    const out = [];
    for (const [m, list] of this.picks) if (list.includes(patchId)) out.push(m);
    return out;
  }

  tierCount(memberId, tier) {
    return (this.picks.get(memberId) ?? []).filter((id) => tierOf(id) === tier).length;
  }

  canPick(memberId, patchId) {
    const list = this.picks.get(memberId);
    if (!list || this.stock[patchId] <= 0 || list.includes(patchId)) return false;
    return this.tierCount(memberId, tierOf(patchId)) < TIER_SLOTS[tierOf(patchId)];
  }

  pick(memberId, patchId) {
    if (!this.canPick(memberId, patchId)) return false;
    this.stock[patchId]--;
    this.picks.get(memberId).push(patchId);
    return true;
  }

  unpick(memberId, patchId) {
    const list = this.picks.get(memberId);
    const i = list ? list.indexOf(patchId) : -1;
    if (i < 0) return false;
    list.splice(i, 1);
    this.stock[patchId]++;
    return true;
  }

  // 남은 사람 모두가 등급별로 서로 다른 패치를 채울 수 있는지 (등급마다 따로 백트래킹)
  feasible(stock = this.stock, picks = this.picks) {
    for (const tier of Object.keys(TIER_SLOTS)) {
      const ids = this.patchIds.filter((id) => tierOf(id) === tier);
      const needs = [];
      for (const [, list] of picks) {
        const have = list.filter((id) => tierOf(id) === tier).length;
        for (let k = have; k < TIER_SLOTS[tier]; k++) needs.push(list);
      }
      const s = { ...stock };
      const extra = new Map();
      const solve = (i) => {
        if (i === needs.length) return true;
        const owned = needs[i];
        const mine = extra.get(owned) || [];
        for (const id of ids) {
          if (s[id] <= 0 || owned.includes(id) || mine.includes(id)) continue;
          s[id]--;
          mine.push(id);
          extra.set(owned, mine);
          if (solve(i + 1)) return true;
          mine.pop();
          s[id]++;
        }
        return false;
      };
      if (!solve(0)) return false;
    }
    return true;
  }

  isFeasibleAfter(memberId, patchId) {
    if (!this.canPick(memberId, patchId)) return false;
    const stock = { ...this.stock, [patchId]: this.stock[patchId] - 1 };
    const picks = new Map([...this.picks].map(([m, l]) => [m, m === memberId ? [...l, patchId] : [...l]]));
    return this.feasible(stock, picks);
  }

  // 봇이 고를 수 있는 패치 (다른 사람이 슬롯을 못 채우게 되는 선택은 피함)
  botOptions(memberId) {
    const safe = this.patchIds.filter((id) => this.isFeasibleAfter(memberId, id));
    return safe.length ? safe : this.patchIds.filter((id) => this.canPick(memberId, id));
  }

  // 시간이 끝났을 때 빈 슬롯 채우기. priorityIds 먼저.
  autoFill(rng, priorityIds = []) {
    const order = [...priorityIds, ...[...this.picks.keys()].filter((m) => !priorityIds.includes(m))];
    for (const m of order) {
      while (!this.isComplete(m)) {
        const opts = this.botOptions(m);
        if (!opts.length) break;
        this.pick(m, rng.pick(opts));
      }
    }
  }

  isComplete(memberId) {
    return this.picks.get(memberId)?.length === SLOTS_PER_PLAYER;
  }

  // 슬롯 순서(C, Q, E, X)로 정렬한 장착 목록. 빈 슬롯은 null.
  loadoutOf(memberId) {
    const list = [...(this.picks.get(memberId) ?? [])];
    return LOADOUT_SLOTS.map((slot) => {
      const i = list.findIndex((id) => tierOf(id) === slot.tier);
      return i >= 0 ? list.splice(i, 1)[0] : null;
    });
  }

  loadouts() {
    return new Map([...this.picks.keys()].map((m) => [m, this.loadoutOf(m)]));
  }
}
