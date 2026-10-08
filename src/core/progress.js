// 개념 도감·점검 기록 (이 브라우저에만 저장). 저장이 막힌 환경에서는 이번 접속 동안만 유지.
const KEY = 'forcebound.progress.v1';

let cache = null;

export function loadProgress() {
  if (cache) return cache;
  cache = { concepts: [], quiz: { solved: 0, correct: 0 } };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      cache.concepts = Array.isArray(p.concepts) ? p.concepts.filter((x) => typeof x === 'string') : [];
      if (p.quiz) cache.quiz = { solved: p.quiz.solved | 0, correct: p.quiz.correct | 0 };
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

export function recordQuiz(correct) {
  const p = loadProgress();
  p.quiz.solved++;
  if (correct) p.quiz.correct++;
  save();
}
