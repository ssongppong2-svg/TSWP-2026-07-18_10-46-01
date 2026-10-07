// 맵 목록. 새 맵은 이 폴더에 파일을 만들고 아래 MAPS에 추가하면 선택 화면에 나타난다.
import { FORCE_BOUND } from './force-bound.js';

export const MAPS = {
  [FORCE_BOUND.id]: FORCE_BOUND,
};

export const MAP_ORDER = [FORCE_BOUND.id];
export const DEFAULT_MAP_ID = FORCE_BOUND.id;

export const getMapDef = (id) => MAPS[id] ?? MAPS[DEFAULT_MAP_ID];
