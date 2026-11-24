/**
 * Fixed-capacity object pool for zero-allocation hot-loop entity recycling.
 */
export class ObjectPool<T extends { active: boolean }> {
  public readonly items: T[];
  private cursor = 0;

  constructor(capacity: number, factory: () => T) {
    const safeCapacity = Math.max(0, Math.floor(capacity));
    this.items = new Array<T>(safeCapacity);
    for (let i = 0; i < safeCapacity; i++) {
      const item = factory();
      item.active = false;
      this.items[i] = item;
    }
  }

  /**
   * Acquires the next inactive item scanning from `cursor` with wraparound.
   * Returns `null` if the pool is exhausted.
   */
  public acquire(): T | null {
    const len = this.items.length;
    if (len === 0) return null;

    let idx = this.cursor;
    for (let i = 0; i < len; i++) {
      const item = this.items[idx];
      if (!item.active) {
        item.active = true;
        this.cursor = idx + 1 >= len ? 0 : idx + 1;
        return item;
      }
      idx++;
      if (idx >= len) idx = 0;
    }

    return null;
  }

  /**
   * Marks an item inactive so it can be reused on future acquisitions.
   */
  public release(item: T): void {
    item.active = false;
  }

  /**
   * Marks every item in the pool inactive and resets the scan cursor.
   */
  public releaseAll(): void {
    const len = this.items.length;
    for (let i = 0; i < len; i++) {
      this.items[i].active = false;
    }
    this.cursor = 0;
  }

  /**
   * Counts currently active items in the pool.
   */
  public activeCount(): number {
    let count = 0;
    const len = this.items.length;
    for (let i = 0; i < len; i++) {
      if (this.items[i].active) {
        count++;
      }
    }
    return count;
  }

  /**
   * Invokes `fn` for each active item without allocating a temporary array.
   */
  public forEachActive(fn: (item: T, index: number) => void): void {
    const len = this.items.length;
    for (let i = 0; i < len; i++) {
      const item = this.items[i];
      if (item.active) {
        fn(item, i);
      }
    }
  }
}
