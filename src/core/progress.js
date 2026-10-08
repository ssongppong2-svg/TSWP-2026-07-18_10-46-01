// 개념 도감·점검 기록·개념 숙달 (이 브라우저에만 저장). 저장이 막힌 환경에서는 이번 접속 동안만 유지.
// 숙달: 개념마다 맞힌 횟수 (경기 뒤 점검·구매 시간 점검·그 개념의 해체 문제를 푼 횟수). MASTERY.need번이면 숙달 →
//       관련 포스 패치의 재사용 대기가 짧아짐
import { MASTERY } from '../sim/constants.js';

const KEY = 'forcebound.progress.v1';

let cache = null;

export function loadProgress() {
  if (cache) return cache;
  cache = { concepts: [], quiz: { solved: 0, correct: 0 }, mastery: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      cache.concepts = Array.isArray(p.concepts) ? p.concepts.filter((x) => typeof x === 'string') : [];
      if (p.quiz) cache.quiz = { solved: p.quiz.solved | 0, correct: p.quiz.correct | 0 };
      if (p.mastery && typeof p.mastery === 'object') for (const [k, v] of Object.entries(p.mastery)) if (typeof k === 'string') cache.mastery[k] = v | 0;
    }
  } catch {
    /* 기본값 */
  }
  return cache;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* 무시 */
  }
}

// 새로 얻은 개념이면 true
export function addConcept(id) {
  const p = loadProgress();
  if (p.concepts.includes(id)) return false;
  p.concepts.push(id);
  save();
  return true;
}

// 점검 문제 결과 (conceptId가 있으면 그 개념의 숙달도 올림). 새로 숙달했으면 true
export function recordQuiz(correct, conceptId = null) {
  const p = loadProgress();
  p.quiz.solved++;
  if (correct) p.quiz.correct++;
  const fresh = correct && conceptId ? bump(conceptId) : false;
  save();
  return fresh;
}

// 해체 문제처럼 개념을 써서 풀었을 때 (점검 횟수에는 넣지 않음). 새로 숙달했으면 true
export function recordUse(conceptId) {
  const fresh = bump(conceptId);
  save();
  return fresh;
}

function bump(id) {
  const p = loadProgress();
  const before = p.mastery[id] ?? 0;
  p.mastery[id] = before + 1;
  return before < MASTERY.need && before + 1 >= MASTERY.need;
}

export const masteryOf = (id) => loadProgress().mastery[id] ?? 0;
export const masteredIds = () => Object.entries(loadProgress().mastery).filter(([, v]) => v >= MASTERY.need).map(([k]) => k);
