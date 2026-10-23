const assert = require('node:assert/strict');
const test = require('node:test');
const { createLock } = require('../src/lock');

test('a second holder is refused while the lock is held', () => {
  const lock = createLock();
  assert.equal(lock.tryAcquire(), true);
  lock.release();
  assert.equal(lock.tryAcquire(), true);
});

test('release lets the next holder in', () => {
  const lock = createLock();
  lock.tryAcquire();
  lock.release();
  assert.equal(lock.tryAcquire(), true);
});
