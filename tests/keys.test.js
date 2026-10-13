import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_ACTIONS, K, actionOfCode, assignKey, changedKeys, codesOf, isKey, keyName, keyOf, resetKeys, setKeymap } from '../src/core/keys.js';

test('키 바꾸기: 기본 배치 · 겹치는 키는 맞바꿈 · 막힌 키 거절 · 저장은 바뀐 것만', () => {
  resetKeys();
  // 기본 배치에 같은 키를 쓰는 동작이 없음
  const codes = KEY_ACTIONS.map((a) => a.def);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(keyOf('crouch'), 'ControlLeft');
  assert.deepEqual(changedKeys(), {});
  // 앉기를 C로 → C를 쓰던 일반 패치 1은 Ctrl로 맞바꿈
  const r = assignKey('crouch', 'KeyC');
  assert.ok(r.ok);
  assert.equal(r.swapped, 'patch0');
  assert.equal(keyOf('crouch'), 'KeyC');
  assert.equal(keyOf('patch0'), 'ControlLeft');
  assert.deepEqual(changedKeys(), { crouch: 'KeyC', patch0: 'ControlLeft' });
  // Esc · F5 는 쓸 수 없음
  assert.equal(assignKey('reload', 'Escape').ok, false);
  assert.equal(assignKey('reload', 'F5').ok, false);
  assert.equal(keyOf('reload'), 'KeyR');
  // 저장한 것을 다시 읽음 (모르는 동작·막힌 키는 무시)
  setKeymap({ crouch: 'KeyC', patch0: 'ControlLeft', nope: 'KeyP', jump: 'F5' });
  assert.equal(keyOf('crouch'), 'KeyC');
  assert.equal(keyOf('jump'), 'Space');
  resetKeys();
  assert.equal(keyOf('crouch'), 'ControlLeft');
});

test('키 바꾸기: 왼쪽·오른쪽 Shift·Ctrl은 같은 키 · 이름 표시', () => {
  resetKeys();
  assert.ok(isKey('ShiftRight', 'walk'));
  assert.deepEqual(codesOf('crouch'), ['ControlLeft', 'ControlRight']);
  assert.equal(actionOfCode('ControlRight'), 'crouch');
  // 오른쪽 Shift를 앉기로 → 보행(왼쪽 Shift)과 맞바꿈
  assert.equal(assignKey('crouch', 'ShiftRight').swapped, 'walk');
  assert.equal(K('walk'), 'Ctrl');
  assert.equal(K('crouch'), 'Shift');
  assert.equal(keyName('KeyF'), 'F');
  assert.equal(keyName('Digit4'), '4');
  assert.equal(keyName('Minus'), '−');
  assert.equal(keyName('Numpad3'), '숫자판 3');
  resetKeys();
});
