/**
 * Minimal uniform spatial hash grid used to prune "what's near me" queries
 * (vision, lateral line, electroreception, touch) down from O(all plants /
 * all creatures) to O(nearby only), instead of the whole world being
 * scanned per creature per tick.
 *
 * Rebuilt fresh once per tick from the current entity positions — cheap
 * (a handful of array pushes per entity) and avoids any stale-bucket bugs
 * from entities moving between ticks.
 */
export interface GridEntry {
  x: number;
  y: number;
  radius: number;
}

export class SpatialGrid<T extends GridEntry> {
  private cellSize: number;
  private cells: Map<number, T[]> = new Map();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): number {
    // Pack two 16-bit-ish signed cell coords into one number key. World is
    // small (a few thousand units / cellSize), so this comfortably fits.
    return cx * 100003 + cy;
  }

  public clear(): void {
    this.cells.clear();
  }

  public insert(item: T): void {
    const cx = Math.floor(item.x / this.cellSize);
    const cy = Math.floor(item.y / this.cellSize);
    const k = this.key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push(item);
  }

  public build(items: T[]): void {
    this.clear();
    for (const item of items) this.insert(item);
  }

  /** Every item whose cell overlaps a square of the given half-extent around (x, y). */
  public queryRadius(x: number, y: number, radius: number): T[] {
    const result: T[] = [];
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket) result.push(...bucket);
      }
    }
    return result;
  }
}
