import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFiniteNumber } from '../web/resolver/utils/size_utils.js';

test('parseFiniteNumber normalizes numeric size values', () => {
  assert.equal(parseFiniteNumber(2048), 2048);
  assert.equal(parseFiniteNumber('2048'), 2048);
  assert.equal(parseFiniteNumber('0'), 0);
  assert.equal(parseFiniteNumber(0), 0);
});

test('parseFiniteNumber rejects empty, invalid and non-finite values', () => {
  assert.equal(parseFiniteNumber(null), null);
  assert.equal(parseFiniteNumber(undefined), null);
  assert.equal(parseFiniteNumber(''), null);
  assert.equal(parseFiniteNumber('invalid'), null);
  assert.equal(parseFiniteNumber(Infinity), null);
});
