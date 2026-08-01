/**
 * Unit tests for TtlMap — the bounded, self-expiring map behind the upload→save
 * perceptual-hash handoff.
 *
 * The two properties that matter are the ones that make it a leak fix rather than a cache:
 * a read must not extend an entry's life, and the map must have a hard ceiling regardless
 * of whether anything ever expires.
 */

import { TtlMap } from '@/utils/ttlMap';

describe('TtlMap', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a value before its TTL elapses', () => {
    const map = new TtlMap<string>(1000, 10);
    map.set('a', 'hash-a');

    jest.advanceTimersByTime(999);

    expect(map.get('a')).toBe('hash-a');
  });

  it('forgets a value once its TTL has elapsed', () => {
    const map = new TtlMap<string>(1000, 10);
    map.set('a', 'hash-a');

    jest.advanceTimersByTime(1000);

    expect(map.get('a')).toBeUndefined();
  });

  it('drops the expired entry rather than leaving it to be re-read', () => {
    const map = new TtlMap<string>(1000, 10);
    map.set('a', 'hash-a');
    jest.advanceTimersByTime(1000);

    expect(map.get('a')).toBeUndefined();
    expect(map.size).toBe(0);
  });

  it('does not extend a TTL on read', () => {
    // The leak this class exists to close: an abandoned upload that something keeps
    // polling must still expire on schedule, so reads deliberately do not refresh.
    const map = new TtlMap<string>(1000, 10);
    map.set('a', 'hash-a');

    jest.advanceTimersByTime(600);
    expect(map.get('a')).toBe('hash-a');
    jest.advanceTimersByTime(400);

    expect(map.get('a')).toBeUndefined();
  });

  it('evicts the oldest entry when the cap is exceeded', () => {
    const map = new TtlMap<string>(60_000, 2);
    map.set('a', 'hash-a');
    map.set('b', 'hash-b');
    map.set('c', 'hash-c');

    expect(map.size).toBe(2);
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBe('hash-b');
    expect(map.get('c')).toBe('hash-c');
  });

  it('re-setting a key refreshes its TTL and moves it to the back of the eviction order', () => {
    const map = new TtlMap<string>(60_000, 2);
    map.set('a', 'hash-a');
    map.set('b', 'hash-b');
    map.set('a', 'hash-a2');
    // 'a' was re-inserted, so 'b' is now the oldest and goes first.
    map.set('c', 'hash-c');

    expect(map.get('a')).toBe('hash-a2');
    expect(map.get('b')).toBeUndefined();
    expect(map.get('c')).toBe('hash-c');
  });

  it('reclaims expired entries instead of counting them toward the cap', () => {
    const map = new TtlMap<string>(1000, 2);
    map.set('a', 'hash-a');
    map.set('b', 'hash-b');

    jest.advanceTimersByTime(1000);

    // Both are expired, so this insert should evict neither by the size rule.
    map.set('c', 'hash-c');

    expect(map.size).toBe(1);
    expect(map.get('c')).toBe('hash-c');
  });

  it('deletes an entry on request', () => {
    const map = new TtlMap<string>(60_000, 10);
    map.set('a', 'hash-a');

    expect(map.delete('a')).toBe(true);
    expect(map.get('a')).toBeUndefined();
    expect(map.delete('a')).toBe(false);
  });
});

describe('TtlMap.status', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('separates a key that timed out from one it never held', () => {
    // The whole point of the tombstone: the save path tells a user their upload expired
    // only when it actually expired. A key it never knew must stay indistinguishable from
    // a save that legitimately never went through the upload route.
    const map = new TtlMap<string>(1000, 10, 5000);
    map.set('known', 'hash');

    expect(map.status('known')).toBe('fresh');
    expect(map.status('never-seen')).toBe('unknown');

    jest.advanceTimersByTime(1000);

    expect(map.status('known')).toBe('expired');
    expect(map.status('never-seen')).toBe('unknown');
  });

  it('forgets that a key expired once the grace window closes', () => {
    const map = new TtlMap<string>(1000, 10, 5000);
    map.set('a', 'hash');

    jest.advanceTimersByTime(1000 + 5000);

    expect(map.status('a')).toBe('unknown');
  });

  it('defaults the grace window to the TTL', () => {
    const map = new TtlMap<string>(1000, 10);
    map.set('a', 'hash');

    jest.advanceTimersByTime(1500);
    expect(map.status('a')).toBe('expired');

    jest.advanceTimersByTime(600);
    expect(map.status('a')).toBe('unknown');
  });

  it('treats a re-set key as fresh again, clearing the tombstone', () => {
    // Re-uploading the same screenshot after a timeout has to work, not stay stuck
    // reporting `expired` forever.
    const map = new TtlMap<string>(1000, 10, 60_000);
    map.set('a', 'hash-1');
    jest.advanceTimersByTime(1000);
    expect(map.status('a')).toBe('expired');

    map.set('a', 'hash-2');

    expect(map.status('a')).toBe('fresh');
    expect(map.get('a')).toBe('hash-2');
  });

  it('reports a consumed key as unknown, not expired', () => {
    // delete() marks a terminal outcome — the save committed. A later lookup must not
    // claim the upload timed out, which would be a confusing lie.
    const map = new TtlMap<string>(1000, 10, 60_000);
    map.set('a', 'hash');
    map.delete('a');

    expect(map.status('a')).toBe('unknown');

    jest.advanceTimersByTime(1000);
    expect(map.status('a')).toBe('unknown');
  });

  it('keeps tombstones out of size and out of the live cap', () => {
    const map = new TtlMap<string>(1000, 2, 60_000);
    map.set('a', 'hash-a');
    map.set('b', 'hash-b');

    jest.advanceTimersByTime(1000);
    // Both are expired; inserting now must not evict c to make room for dead entries.
    map.set('c', 'hash-c');

    expect(map.size).toBe(1);
    expect(map.get('c')).toBe('hash-c');
    expect(map.status('a')).toBe('expired');
    expect(map.status('b')).toBe('expired');
  });
});
