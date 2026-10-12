// 맵 목록. 새 맵은 이 폴더에 파일을 만들고 아래 MAPS에 추가하면 선택 화면에 나타난다.
import { FORCE_BOUND } from './force-bound.js';
import { SCIENCE_HALL } from './science-hall.js';
import { LAB_ANNEX } from './lab-annex.js';
import { SCIENCE_HALL_OP } from './science-hall-op.js';

export const MAPS = {
  [FORCE_BOUND.id]: FORCE_BOUND,
  [SCIENCE_HALL.id]: SCIENCE_HALL,
  [LAB_ANNEX.id]: LAB_ANNEX,
  [SCIENCE_HALL_OP.id]: SCIENCE_HALL_OP,
};

// 5대5 맵 선택 목록 (CQB 작전 전용 맵은 작전 선택 화면에서)
export const MAP_ORDER = [FORCE_BOUND.id, SCIENCE_HALL.id];
export const DEFAULT_MAP_ID = FORCE_BOUND.id;

export const getMapDef = (id) => MAPS[id] ?? MAPS[DEFAULT_MAP_ID];
