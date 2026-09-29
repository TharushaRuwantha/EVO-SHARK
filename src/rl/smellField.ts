import { CONFIG } from '../config';
import { applyNoisePct } from './sensorLayout';

/**
 * Two diffusing scalar scent fields (prey-scent, predator-scent) covering
 * the whole world on a coarse grid. This is the one sensor modality that's
 * a genuine shared world resource rather than something computed on demand
 * per creature: it's updated once per tick (emit -> diffuse -> decay ->
 * clamp) and creatures merely sample it at a few points around themselves.
 *
 * Deliberately passes through walls/obstacles (unlike vision) — that's
 * what makes hiding behind cover temporary rather than absolute.
 */
export class SmellField {
  private readonly gridW: number;
  private readonly gridH: number;
  private readonly cellSize: number;

  // Double-buffered per field so diffusion reads a stable "current" state
  // while writing "next", then the two are swapped — no per-tick allocation.
  private preyCurrent: Float32Array;
  private preyNext: Float32Array;
  private predatorCurrent: Float32Array;
  private predatorNext: Float32Array;

  constructor() {
    const cfg = CONFIG.sensors.smell;
    this.gridW = cfg.gridW;
    this.gridH = cfg.gridH;
    this.cellSize = cfg.cellSize;

    const n = this.gridW * this.gridH;
    this.preyCurrent = new Float32Array(n);
    this.preyNext = new Float32Array(n);
    this.predatorCurrent = new Float32Array(n);
    this.predatorNext = new Float32Array(n);
  }

  public reset(): void {
    this.preyCurrent.fill(0);
    this.preyNext.fill(0);
    this.predatorCurrent.fill(0);
    this.predatorNext.fill(0);
  }

  private cellIndex(x: number, y: number): number {
    let cx = Math.floor(x / this.cellSize);
    let cy = Math.floor(y / this.cellSize);
    cx = Math.max(0, Math.min(this.gridW - 1, cx));
    cy = Math.max(0, Math.min(this.gridH - 1, cy));
    return cy * this.gridW + cx;
  }

  private diffuseAndDecay(current: Float32Array, next: Float32Array): void {
    const { diffusionRate, decayRate, maxValue } = CONFIG.sensors.smell;
    const w = this.gridW;
    const h = this.gridH;

    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const idx = cy * w + cx;
        const self = current[idx];

        const left = cx > 0 ? current[idx - 1] : self;
        const right = cx < w - 1 ? current[idx + 1] : self;
        const up = cy > 0 ? current[idx - w] : self;
        const down = cy < h - 1 ? current[idx + w] : self;
        const neighborAvg = (left + right + up + down) / 4;

        let v = self + diffusionRate * (neighborAvg - self);
        v *= 1 - decayRate;
        if (v < 0) v = 0;
        else if (v > maxValue) v = maxValue;
        next[idx] = v;
      }
    }
  }

  /**
   * Advances the fields by one tick: emit (from live prey/predators) into
   * the current buffer, diffuse + decay + clamp into the next buffer, then
   * swap. Called once per world tick regardless of how many creatures
   * sample it.
   */
  public update(aliveFish: { x: number; y: number; energyFraction: number }[], aliveSharks: { x: number; y: number }[], meatRemains: { x: number; y: number; age: number; maxAge: number }[]): void {
    // Emit directly into the "current" buffers before diffusing them.
    for (const fish of aliveFish) {
      const idx = this.cellIndex(fish.x, fish.y);
      this.preyCurrent[idx] = Math.min(CONFIG.sensors.smell.maxValue, this.preyCurrent[idx] + Math.max(0, fish.energyFraction));
    }
    for (const meat of meatRemains) {
      const freshness = Math.max(0, 1 - meat.age / meat.maxAge);
      const idx = this.cellIndex(meat.x, meat.y);
      this.preyCurrent[idx] = Math.min(CONFIG.sensors.smell.maxValue, this.preyCurrent[idx] + freshness);
    }
    for (const shark of aliveSharks) {
      const idx = this.cellIndex(shark.x, shark.y);
      this.predatorCurrent[idx] = Math.min(CONFIG.sensors.smell.maxValue, this.predatorCurrent[idx] + 1);
    }

    this.diffuseAndDecay(this.preyCurrent, this.preyNext);
    this.diffuseAndDecay(this.predatorCurrent, this.predatorNext);

    [this.preyCurrent, this.preyNext] = [this.preyNext, this.preyCurrent];
    [this.predatorCurrent, this.predatorNext] = [this.predatorNext, this.predatorCurrent];
  }

  /** Raw prey-scent value at a world point, for the debug heatmap overlay. */
  public preyValueAt(x: number, y: number): number {
    return this.preyCurrent[this.cellIndex(x, y)];
  }

  /** Raw predator-scent value at a world point, for the debug heatmap overlay. */
  public predatorValueAt(x: number, y: number): number {
    return this.predatorCurrent[this.cellIndex(x, y)];
  }

  public get dimensions(): { gridW: number; gridH: number; cellSize: number } {
    return { gridW: this.gridW, gridH: this.gridH, cellSize: this.cellSize };
  }

  /**
   * Samples both fields at 8 evenly-spaced points (45 degrees apart, body-
   * frame, starting directly ahead of `heading`) around (x, y) at
   * `sampleRadius`. Writes [preyScent, predatorScent] per direction into
   * `out` starting at `outOffset`, with per-sample noise applied.
   */
  public sample8Directions(x: number, y: number, heading: number, out: Float32Array, outOffset: number): void {
    const { sampleRadius, noisePct } = CONFIG.sensors.smell;

    for (let k = 0; k < 8; k++) {
      const angle = heading + (k * Math.PI) / 4;
      const sx = x + Math.cos(angle) * sampleRadius;
      const sy = y + Math.sin(angle) * sampleRadius;

      const prey = applyNoisePct(this.preyValueAt(sx, sy), noisePct);
      const predator = applyNoisePct(this.predatorValueAt(sx, sy), noisePct);

      const base = outOffset + k * 2;
      out[base] = Math.max(0, Math.min(1, prey));
      out[base + 1] = Math.max(0, Math.min(1, predator));
    }
  }
}
