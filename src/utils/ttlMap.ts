/**
 * A Map that forgets: entries expire after a fixed TTL, and the map never grows past a
 * maximum size (oldest insertion evicted first).
 *
 * Written for the upload→save perceptual-hash handoff in routes/screenshots.ts. That map
 * only ever removed an entry on a terminal path — a committed save, or a duplicate — so an
 * upload the user abandoned at the review step pinned its entry for the lifetime of the
 * process. Nothing was corrupted by it, but the map grew without bound.
 *
 * Deliberately NOT an LRU: a read must not extend an entry's life. An abandoned upload
 * that something kept polling would otherwise never expire, which is the leak this exists
 * to close.
 *
 * Single-process only, like the map it replaces. Losing an entry is safe — the caller
 * treats a miss as "no hash known" and degrades to saving without one.
 */
export class TtlMap<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  set(key: string, value: V): void {
    // Map keeps a key's original position when overwritten, so re-inserting has to delete
    // first or an old key would stay at the front of the eviction order forever.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    this.prune();
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Drops expired entries first, then the oldest survivors if still over the cap. */
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    // Map iterates in insertion order, so the first key is always the oldest.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
