import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDueum, allowedStarts, isHangulWord, euro } from '../lib/hangul.js';

test('두음법칙: ㄴ → ㅇ', () => {
  assert.equal(applyDueum('녀'), '여');
  assert.equal(applyDueum('뇨'), '요');
  assert.equal(applyDueum('뉴'), '유');
  assert.equal(applyDueum('니'), '이');
  assert.equal(applyDueum('년'), '연'); // 받침 유지
});

test('두음법칙: ㄹ → ㅇ / ㄹ → ㄴ', () => {
  assert.equal(applyDueum('력'), '역');
  assert.equal(applyDueum('률'), '율');
  assert.equal(applyDueum('례'), '예');
  assert.equal(applyDueum('리'), '이');
  assert.equal(applyDueum('락'), '낙');
  assert.equal(applyDueum('로'), '노');
  assert.equal(applyDueum('뢰'), '뇌');
  assert.equal(applyDueum('름'), '늠');
});

test('두음법칙 대상이 아니면 null', () => {
  assert.equal(applyDueum('가'), null);
  assert.equal(applyDueum('나'), null);
  assert.equal(applyDueum('a'), null);
});

test('allowedStarts', () => {
  assert.deepEqual(allowedStarts('력'), ['력', '역']);
  assert.deepEqual(allowedStarts('력', { dueum: false }), ['력']);
  assert.deepEqual(allowedStarts('가'), ['가']);
});

test('isHangulWord / euro', () => {
  assert.equal(isHangulWord('사과'), true);
  assert.equal(isHangulWord('사과1'), false);
  assert.equal(isHangulWord(''), false);
  assert.equal(euro('사과'), '로');
  assert.equal(euro('가방'), '으로');
  assert.equal(euro('하늘'), '로');
});
