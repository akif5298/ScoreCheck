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
