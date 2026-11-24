const CELL_OFFSET = 32768;
const CELL_MIN = -32768;
const CELL_MAX = 32767;

function cellKey(cx: number, cy: number): number {
  const clampedX = cx < CELL_MIN ? CELL_MIN : cx > CELL_MAX ? CELL_MAX : cx;
  const clampedY = cy < CELL_MIN ? CELL_MIN : cy > CELL_MAX ? CELL_MAX : cy;
  return ((clampedX + CELL_OFFSET) << 16) | ((clampedY + CELL_OFFSET) & 0xffff);
}

/**
 * Reusable spatial hash grid for fast, GC-free broad-phase proximity queries.
 */
export class SpatialHash<
  T extends { id?: number; x: number; y: number; radius: number; active: boolean },
> {
  private readonly invCellSize: number;
  private readonly buckets = new Map<number, T[]>();
  private readonly activeBuckets: T[][] = [];
  private readonly seen = new Set<T>();

  constructor(cellSize = 72) {
    const safeSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 72;
    this.invCellSize = 1 / safeSize;
  }

  /**
   * Empties all populated buckets in place without reallocating arrays or Maps.
   */
  public clear(): void {
    const len = this.activeBuckets.length;
    for (let i = 0; i < len; i++) {
      this.activeBuckets[i].length = 0;
    }
    this.activeBuckets.length = 0;
  }

  /**
   * Inserts an active item into all grid cells overlapped by its bounding box.
   */
  public insert(item: T): void {
    if (!item.active) return;
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) return;

    const r = Number.isFinite(item.radius) && item.radius > 0 ? item.radius : 0;
    const minCx = Math.floor((item.x - r) * this.invCellSize);
    const maxCx = Math.floor((item.x + r) * this.invCellSize);
    const minCy = Math.floor((item.y - r) * this.invCellSize);
    const maxCy = Math.floor((item.y + r) * this.invCellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = cellKey(cx, cy);
        let bucket = this.buckets.get(key);
        if (bucket === undefined) {
          bucket = [];
          this.buckets.set(key, bucket);
        }
        if (bucket.length === 0) {
          this.activeBuckets.push(bucket);
        }
        bucket.push(item);
      }
    }
  }

  /**
   * Queries all unique active items in cells overlapping `(x ± radius, y ± radius)`,
   * writing results into `out` and returning `out`.
   */
  public query(x: number, y: number, radius: number, out: T[]): T[] {
    out.length = 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return out;

    const r = Number.isFinite(radius) && radius > 0 ? radius : 0;
    const minCx = Math.floor((x - r) * this.invCellSize);
    const maxCx = Math.floor((x + r) * this.invCellSize);
    const minCy = Math.floor((y - r) * this.invCellSize);
    const maxCy = Math.floor((y + r) * this.invCellSize);

    this.seen.clear();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(cellKey(cx, cy));
        if (bucket === undefined || bucket.length === 0) continue;

        const len = bucket.length;
        for (let i = 0; i < len; i++) {
          const item = bucket[i];
          if (item.active && !this.seen.has(item)) {
            this.seen.add(item);
            out.push(item);
          }
        }
      }
    }

    this.seen.clear();
    return out;
  }
}
