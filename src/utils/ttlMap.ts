/**
 * A Map that forgets: entries expire after a fixed TTL, and the map never grows past a
 * maximum size (oldest insertion evicted first).
 *
 * Written for the upload→save perceptual-hash handoff in services/pendingHashes.ts. That
 * map only ever removed an entry on a terminal path — a committed save, or a duplicate — so
 * an upload the user abandoned at the review step pinned its entry for the lifetime of the
 * process. Nothing was corrupted by it, but the map grew without bound.
 *
 * Deliberately NOT an LRU: a read must not extend an entry's life. An abandoned upload
 * that something kept polling would otherwise never expire, which is the leak this exists
 * to close.
 *
 * EXPIRY IS REMEMBERED, BRIEFLY. When an entry expires its value is discarded, but the key
 * is recorded in a separate tombstone map for `graceMs` so callers can tell "this expired"
 * from "I never knew this key" — see status(). That distinction is what lets the save path
 * tell a user their upload timed out, instead of silently storing a game with no perceptual
 * hash. Tombstones are held apart from live entries deliberately: they must not consume the
 * live cap or be reported by size().
 *
 * Single-process only. Losing an entry is safe for the current caller — a miss reads as
 * "no hash known".
 */

/**
 * - `fresh`   — a live value is present.
 * - `expired` — a value was stored and has since timed out, within the grace window.
 * - `unknown` — never stored here, already consumed, or so old the tombstone is gone too.
 */
export type TtlMapStatus = 'fresh' | 'expired' | 'unknown';

export class TtlMap<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  /** key → the moment its tombstone stops being reported as `expired`. */
  private readonly tombstones = new Map<string, number>();

  /**
   * @param ttlMs      how long a value stays usable.
   * @param maxEntries hard ceiling on live entries (tombstones are capped separately).
   * @param graceMs    how long after expiry a key still reports `expired` rather than
   *                   `unknown`. Defaults to the TTL itself.
   */
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly graceMs: number = ttlMs,
  ) {}

  set(key: string, value: V): void {
    // Map keeps a key's original position when overwritten, so re-inserting has to delete
    // first or an old key would stay at the front of the eviction order forever.
    this.entries.delete(key);
    // A fresh value supersedes any record that this key once timed out.
    this.tombstones.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    this.prune();
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.expire(key, entry.expiresAt);
      return undefined;
    }
    return entry.value;
  }

  /** Why a get() would miss — see TtlMapStatus. */
  status(key: string): TtlMapStatus {
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.expiresAt > Date.now()) return 'fresh';
      this.expire(key, entry.expiresAt);
    }
    const forgetAt = this.tombstones.get(key);
    if (forgetAt === undefined) return 'unknown';
    if (forgetAt > Date.now()) return 'expired';
    this.tombstones.delete(key);
    return 'unknown';
  }

  /**
   * Removes a key entirely, tombstone included. Used for terminal outcomes: the entry was
   * consumed, so a later lookup should read as `unknown`, not as a timeout.
   */
  delete(key: string): boolean {
    this.tombstones.delete(key);
    return this.entries.delete(key);
  }

  /** Live entries only. Tombstones are bookkeeping and are not reported here. */
  get size(): number {
    return this.entries.size;
  }

  /** Moves an expired key out of the live map and into the tombstone map. */
  private expire(key: string, expiresAt: number): void {
    this.entries.delete(key);
    this.tombstones.set(key, expiresAt + this.graceMs);
    this.pruneTombstones();
  }

  /** Drops expired entries first, then the oldest survivors if still over the cap. */
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.expire(key, entry.expiresAt);
    }
    // Map iterates in insertion order, so the first key is always the oldest.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.pruneTombstones();
  }

  private pruneTombstones(): void {
    const now = Date.now();
    for (const [key, forgetAt] of this.tombstones) {
      if (forgetAt <= now) this.tombstones.delete(key);
    }
    while (this.tombstones.size > this.maxEntries) {
      const oldest = this.tombstones.keys().next();
      if (oldest.done) break;
      this.tombstones.delete(oldest.value);
    }
  }
}
