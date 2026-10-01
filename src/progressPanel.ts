import { Trainer } from './rl/trainer';
import { GenerationRecord, SessionRecord } from './rl/persistence';

const SHARK_COLOR = '#7dd3fc';
const FISH_COLOR = '#fbbf24';
const GRID_COLOR = 'rgba(148, 163, 184, 0.15)';
const AXIS_COLOR = 'rgba(148, 163, 184, 0.4)';

/** A session gets a stable, muted comparison color once it's no longer the live one. */
const COMPARISON_PALETTE = ['#a78bfa', '#f472b6', '#34d399', '#f87171', '#60a5fa'];

interface LegendRow {
  sessionIndex: number;
  isLive: boolean;
  y: number;
  height: number;
}

/**
 * Overlay panel charting training progress over generations: reward curves
 * (shark/fish) and survival duration, read from Trainer.getSessions(). Lets
 * you see, at a glance, whether the policy is actually improving rather than
 * just accumulating a larger generation counter -- and, since sessions
 * persist across reloads, compare the current training lineage against a
 * previous one (e.g. before/after a reward-shaping or sensor change) by
 * clicking its row in the legend to toggle it on/off.
 *
 * Its own <canvas>, independent of the brain visualizer / sensor panel, so
 * any combination can be shown at once.
 */
export class ProgressPanel {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public visible = false;

  private lastDrawMs = 0;
  private static readonly MIN_REDRAW_INTERVAL_MS = 250; // a chart doesn't need to repaint at 60Hz

  private readonly panelWidth: number;
  private readonly panelHeight = 260;

  private hiddenSessionIds = new Set<string>();
  private legendRows: LegendRow[] = [];

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'progress-panel-canvas';
    this.panelWidth = Math.min(900, Math.max(480, Math.floor(window.innerWidth - 32)));
    this.canvas.style.cssText = `
      position: absolute;
      left: 16px;
      bottom: 16px;
      width: ${this.panelWidth}px;
      height: ${this.panelHeight}px;
      z-index: 35;
      pointer-events: auto;
      display: none;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.45);
      cursor: default;
    `;
    container.appendChild(this.canvas);

    this.canvas.addEventListener('click', (e) => this.handleClick(e));

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.panelWidth * dpr;
    this.canvas.height = this.panelHeight * dpr;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to obtain 2D context for progress panel canvas');
    this.ctx = ctx;
    ctx.scale(dpr, dpr);
  }

  public get isVisible(): boolean {
    return this.visible;
  }

  public show(): void {
    this.visible = true;
    this.canvas.style.display = 'block';
  }

  public hide(): void {
    this.visible = false;
    this.canvas.style.display = 'none';
  }

  public toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  public destroy(): void {
    this.canvas.remove();
  }

  private handleClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const my = e.clientY - rect.top;
    for (const row of this.legendRows) {
      if (my >= row.y && my <= row.y + row.height) {
        if (row.isLive) return; // the live session always stays visible
        const sessions = this.lastSessions;
        if (!sessions) return;
        const id = sessions[row.sessionIndex].id;
        if (this.hiddenSessionIds.has(id)) this.hiddenSessionIds.delete(id);
        else this.hiddenSessionIds.add(id);
        this.forceRedraw = true;
        return;
      }
    }
  }

  private lastSessions: readonly SessionRecord[] | null = null;
  private forceRedraw = false;

  public render(trainer: Trainer, nowMs: number): void {
    if (!this.visible) return;
    if (!this.forceRedraw && nowMs - this.lastDrawMs < ProgressPanel.MIN_REDRAW_INTERVAL_MS) return;
    this.lastDrawMs = nowMs;
    this.forceRedraw = false;

    const sessions = trainer.getSessions();
    this.lastSessions = sessions;

    const ctx = this.ctx;
    const w = this.panelWidth;
    const h = this.panelHeight;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    const legendWidth = 150;
    const chartAreaX = 10;
    const chartAreaWidth = w - legendWidth - 30;
    const titleH = 22;

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'left';
    ctx.fillText('TRAINING PROGRESS — reward & survival vs generation', 10, 16);

    const visibleSessions = sessions.filter((s, i) => i === sessions.length - 1 || !this.hiddenSessionIds.has(s.id));
    if (sessions.every((s) => s.history.length === 0)) {
      ctx.font = '11px monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText('No completed generations yet — wait for the first one to end.', 10, h / 2);
      this.drawLegend(sessions, w - legendWidth, titleH, h - titleH - 8);
      return;
    }

    // Two stacked charts share the left chart area: reward on top, survival
    // duration on the bottom half.
    const rewardChartY = titleH;
    const rewardChartH = (h - titleH - 24) * 0.55;
    const durationChartY = rewardChartY + rewardChartH + 20;
    const durationChartH = h - durationChartY - 10;

    this.drawRewardChart(visibleSessions, sessions.length - 1, chartAreaX, rewardChartY, chartAreaWidth, rewardChartH);
    this.drawDurationChart(visibleSessions, sessions.length - 1, chartAreaX, durationChartY, chartAreaWidth, durationChartH);

    this.drawLegend(sessions, w - legendWidth, titleH, h - titleH - 8);
  }

  /** Downsamples to at most `maxPoints` using min/max binning so spikes survive, not just a thinned average. */
  private downsample(history: GenerationRecord[], maxPoints: number): GenerationRecord[] {
    if (history.length <= maxPoints) return history;
    const out: GenerationRecord[] = [];
    const binSize = history.length / maxPoints;
    for (let i = 0; i < maxPoints; i++) {
      const start = Math.floor(i * binSize);
      const end = Math.max(start + 1, Math.floor((i + 1) * binSize));
      // Representative point: the one with the largest combined reward in the bin.
      let best = history[start];
      for (let j = start + 1; j < end && j < history.length; j++) {
        if (history[j].sharkAvgReward + history[j].fishAvgReward > best.sharkAvgReward + best.fishAvgReward) {
          best = history[j];
        }
      }
      out.push(best);
    }
    return out;
  }

  private drawRewardChart(
    sessions: SessionRecord[],
    liveIndex: number,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    const ctx = this.ctx;
    this.drawAxes(x, y, w, h, 'avg reward (5th-95th pct; smoothed line = trend)');

    const seriesPerSession: { session: SessionRecord; points: GenerationRecord[] }[] = [];
    const allValues: number[] = [];
    const liveValues: number[] = [];
    for (const session of sessions) {
      const points = this.downsample(session.history, 300);
      seriesPerSession.push({ session, points });
      const isLive = session === sessions[sessions.length - 1] && sessions.length - 1 === liveIndex;
      for (const p of points) {
        allValues.push(p.sharkAvgReward, p.fishAvgReward);
        if (isLive) liveValues.push(p.sharkAvgReward, p.fishAvgReward);
      }
    }
    const [rangeMin, rangeMax] = this.percentileRange(allValues, 0.05, 0.95);

    for (const { session, points } of seriesPerSession) {
      if (points.length < 2) continue;
      const isLive = session === sessions[sessions.length - 1] && sessions.length - 1 === liveIndex;
      const maxGen = points[points.length - 1].generation || 1;
      const window = this.smoothingWindow(points.length);

      // Raw per-generation values are a single-episode Monte Carlo return,
      // so they're inherently spiky -- draw them faint, then the smoothed
      // trailing-average on top solid, since that's what actually answers
      // "is this improving" instead of just "is this noisy".
      this.plotLine(points, (p) => p.sharkAvgReward, x, y, w, h, maxGen, rangeMin, rangeMax, SHARK_COLOR, true, 0.2);
      this.plotLine(points, (p) => p.fishAvgReward, x, y, w, h, maxGen, rangeMin, rangeMax, FISH_COLOR, true, 0.2);
      this.plotLine(
        this.movingAverage(points, (p) => p.sharkAvgReward, window),
        (p) => p.value,
        x, y, w, h, maxGen, rangeMin, rangeMax, SHARK_COLOR, !isLive
      );
      this.plotLine(
        this.movingAverage(points, (p) => p.fishAvgReward, window),
        (p) => p.value,
        x, y, w, h, maxGen, rangeMin, rangeMax, FISH_COLOR, !isLive
      );
    }

    // Reference lines for the live session only (a comparison session's own
    // min/max/avg would just clutter this) -- the lowest point, highest
    // point, and the overall average reward reached, so the trend's actual
    // range and center are legible at a glance without reading the axis.
    this.drawReferenceLines(x, y, w, h, liveValues, rangeMin, rangeMax, (v) => v.toFixed(2));

    ctx.font = '9px monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(rangeMax.toFixed(2), x - 4, y + 8);
    ctx.fillText(rangeMin.toFixed(2), x - 4, y + h);
    ctx.textAlign = 'left';
  }

  private drawDurationChart(
    sessions: SessionRecord[],
    liveIndex: number,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    const ctx = this.ctx;
    this.drawAxes(x, y, w, h, 'generation length, ticks (5th-95th pct)');

    const seriesPerSession: { session: SessionRecord; points: GenerationRecord[] }[] = [];
    const allValues: number[] = [];
    const liveValues: number[] = [];
    for (const session of sessions) {
      const points = this.downsample(session.history, 300);
      seriesPerSession.push({ session, points });
      const isLive = session === sessions[sessions.length - 1] && sessions.length - 1 === liveIndex;
      for (const p of points) {
        allValues.push(p.durationTicks);
        if (isLive) liveValues.push(p.durationTicks);
      }
    }
    const [, rangeMax] = this.percentileRange(allValues, 0.05, 0.95);
    const rangeMin = 0; // ticks can't go negative; always anchor the floor at 0

    for (const { session, points } of seriesPerSession) {
      if (points.length < 2) continue;
      const isLive = session === sessions[sessions.length - 1] && sessions.length - 1 === liveIndex;
      const maxGen = points[points.length - 1].generation || 1;
      const window = this.smoothingWindow(points.length);

      this.plotLine(points, (p) => p.durationTicks, x, y, w, h, maxGen, rangeMin, rangeMax, '#94a3b8', true, 0.2);
      this.plotLine(
        this.movingAverage(points, (p) => p.durationTicks, window),
        (p) => p.value,
        x, y, w, h, maxGen, rangeMin, rangeMax, '#94a3b8', !isLive
      );
    }

    this.drawReferenceLines(x, y, w, h, liveValues, rangeMin, rangeMax, (v) => Math.round(v).toLocaleString());

    ctx.font = '9px monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(rangeMax.toLocaleString(), x - 4, y + 8);
    ctx.fillText('0', x - 4, y + h);
    ctx.textAlign = 'left';
  }

  /** Linear-interpolated percentile of an unsorted array (sorts a copy). */
  private percentileRange(values: number[], loPct: number, hiPct: number): [number, number] {
    if (values.length === 0) return [0, 1];
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p: number): number => {
      const idx = (sorted.length - 1) * p;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo];
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };
    let lo = at(loPct);
    let hi = at(hiPct);
    if (hi - lo < 1e-6) {
      // Degenerate (near-constant data): pad so the line isn't drawn on a
      // zero-height range, which would divide by ~0 in plotLine.
      lo -= 0.5;
      hi += 0.5;
    }
    return [lo, hi];
  }

  /** Trailing moving average over the (already generation-ordered) points. */
  private movingAverage<T extends { generation: number }>(
    points: T[],
    valueOf: (p: T) => number,
    window: number
  ): { generation: number; value: number }[] {
    const out: { generation: number; value: number }[] = [];
    const buffer: number[] = [];
    let sum = 0;
    for (const p of points) {
      const v = valueOf(p);
      buffer.push(v);
      sum += v;
      if (buffer.length > window) sum -= buffer.shift()!;
      out.push({ generation: p.generation, value: sum / buffer.length });
    }
    return out;
  }

  /** Wider smoothing window for longer series, so the trend line stays readable either way. */
  private smoothingWindow(pointCount: number): number {
    return Math.max(3, Math.round(pointCount * 0.08));
  }

  private drawAxes(x: number, y: number, w: number, h: number, label: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i++) {
      const gy = y + (h * i) / 2;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.stroke();
    }
    ctx.strokeStyle = AXIS_COLOR;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.stroke();

    ctx.font = '9px monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y - 2);
  }

  private plotLine<T extends { generation: number }>(
    points: T[],
    valueOf: (p: T) => number,
    x: number,
    y: number,
    w: number,
    h: number,
    maxGen: number,
    minVal: number,
    maxVal: number,
    color: string,
    dim: boolean,
    alphaOverride?: number
  ): void {
    const ctx = this.ctx;
    const range = maxVal - minVal || 1;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alphaOverride ?? (dim ? 0.35 : 0.95);
    ctx.lineWidth = dim ? 1 : 1.5;
    points.forEach((p, i) => {
      const px = x + (p.generation / maxGen) * w;
      // Clamp to the chart box: with a percentile-clipped range, a spike
      // outside [minVal, maxVal] should flatten at the edge, not escape
      // into the chart above/below (there's no canvas clip region here).
      const rawPy = y + h - ((valueOf(p) - minVal) / range) * h;
      const py = Math.max(y, Math.min(y + h, rawPy));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * Dashed horizontal lines marking the live session's lowest point, highest
   * point, and mean -- so the overall range and center of the trend read at
   * a glance, without having to trace the noisy/smoothed lines by eye.
   * Clamped to the chart box the same way plotLine's points are, so a
   * min/max outside the percentile-clipped axis still shows at the edge.
   */
  private drawReferenceLines(
    x: number,
    y: number,
    w: number,
    h: number,
    values: number[],
    rangeMin: number,
    rangeMax: number,
    format: (v: number) => string
  ): void {
    if (values.length === 0) return;
    const ctx = this.ctx;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const range = rangeMax - rangeMin || 1;

    const yFor = (v: number): number => {
      const raw = y + h - ((v - rangeMin) / range) * h;
      return Math.max(y, Math.min(y + h, raw));
    };

    const drawLine = (value: number, color: string, label: string, alpha: number): void => {
      const py = yFor(value);
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x + w, py);
      ctx.stroke();
      ctx.restore();

      ctx.font = '8px monospace';
      ctx.fillStyle = color;
      ctx.globalAlpha = Math.min(1, alpha + 0.2);
      ctx.textAlign = 'left';
      // Nudge the label off the line itself (up if there's room, else down)
      // so it doesn't sit directly on top of the dashes.
      const labelY = py - y < 8 ? py + 9 : py - 3;
      ctx.fillText(`${label} ${format(value)}`, x + 3, labelY);
      ctx.globalAlpha = 1;
    };

    drawLine(max, '#f87171', 'high', 0.55);
    drawLine(min, '#60a5fa', 'low', 0.55);
    drawLine(avg, '#e2e8f0', 'avg', 0.7);
  }

  private drawLegend(sessions: readonly SessionRecord[], x: number, y: number, h: number): void {
    const ctx = this.ctx;
    this.legendRows = [];

    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText('SESSIONS (click to compare)', x, y);

    ctx.font = '10px monospace';
    ctx.fillStyle = SHARK_COLOR;
    ctx.fillText('— shark reward', x, y + 16);
    ctx.fillStyle = FISH_COLOR;
    ctx.fillText('— fish reward', x, y + 30);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('— gen length', x, y + 44);
    ctx.fillStyle = '#475569';
    ctx.font = '9px monospace';
    ctx.fillText('(faint = raw, solid = trend)', x, y + 57);

    let rowY = y + 73;
    const rowH = 16;
    const maxRows = Math.max(1, Math.floor((h - 73) / rowH));
    const startIdx = Math.max(0, sessions.length - maxRows);

    for (let i = sessions.length - 1; i >= startIdx; i--) {
      const session = sessions[i];
      const isLive = i === sessions.length - 1;
      const hidden = !isLive && this.hiddenSessionIds.has(session.id);
      const color = isLive ? '#e2e8f0' : COMPARISON_PALETTE[(sessions.length - 1 - i - 1) % COMPARISON_PALETTE.length];

      ctx.fillStyle = hidden ? 'rgba(100,116,139,0.4)' : color;
      const date = new Date(session.startedAt);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
      const lastGen = session.history.length > 0 ? session.history[session.history.length - 1].generation : 0;
      const labelText = `${isLive ? '● live' : hidden ? '○' : '●'} ${dateStr} (${lastGen}g)`;
      ctx.fillText(labelText, x, rowY);

      this.legendRows.push({ sessionIndex: i, isLive, y: rowY - 10, height: rowH });
      rowY += rowH;
    }

    if (startIdx > 0) {
      ctx.fillStyle = '#475569';
      ctx.fillText(`… +${startIdx} older`, x, rowY);
    }
  }
}
