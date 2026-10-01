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
    this.drawAxes(x, y, w, h, 'avg reward');

    let allMin = 0;
    let allMax = 0.001;
    const seriesPerSession: { session: SessionRecord; points: GenerationRecord[] }[] = [];
    for (const session of sessions) {
      const points = this.downsample(session.history, 300);
      seriesPerSession.push({ session, points });
      for (const p of points) {
        allMin = Math.min(allMin, p.sharkAvgReward, p.fishAvgReward);
        allMax = Math.max(allMax, p.sharkAvgReward, p.fishAvgReward);
      }
    }

    for (const { session, points } of seriesPerSession) {
      if (points.length < 2) continue;
      const isLive = session === sessions[sessions.length - 1] && sessions.length - 1 === liveIndex;
      const maxGen = points[points.length - 1].generation || 1;
      const dim = !isLive;
      this.plotLine(points, (p) => p.sharkAvgReward, x, y, w, h, maxGen, allMin, allMax, SHARK_COLOR, dim);
      this.plotLine(points, (p) => p.fishAvgReward, x, y, w, h, maxGen, allMin, allMax, FISH_COLOR, dim);
    }

    ctx.font = '9px monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(allMax.toFixed(2), x - 4, y + 8);
    ctx.fillText(allMin.toFixed(2), x - 4, y + h);
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
    this.drawAxes(x, y, w, h, 'generation length (ticks)');

    let maxDuration = 1;
    const seriesPerSession: { session: SessionRecord; points: GenerationRecord[] }[] = [];
    for (const session of sessions) {
      const points = this.downsample(session.history, 300);
      seriesPerSession.push({ session, points });
      for (const p of points) maxDuration = Math.max(maxDuration, p.durationTicks);
    }

    for (const { session, points } of seriesPerSession) {
      if (points.length < 2) continue;
      const isLive = session === sessions[sessions.length - 1] && sessions.length - 1 === liveIndex;
      const maxGen = points[points.length - 1].generation || 1;
      this.plotLine(points, (p) => p.durationTicks, x, y, w, h, maxGen, 0, maxDuration, '#94a3b8', !isLive);
    }

    ctx.font = '9px monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(maxDuration.toLocaleString(), x - 4, y + 8);
    ctx.fillText('0', x - 4, y + h);
    ctx.textAlign = 'left';
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

  private plotLine(
    points: GenerationRecord[],
    valueOf: (p: GenerationRecord) => number,
    x: number,
    y: number,
    w: number,
    h: number,
    maxGen: number,
    minVal: number,
    maxVal: number,
    color: string,
    dim: boolean
  ): void {
    const ctx = this.ctx;
    const range = maxVal - minVal || 1;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = dim ? 0.35 : 0.95;
    ctx.lineWidth = dim ? 1 : 1.5;
    points.forEach((p, i) => {
      const px = x + (p.generation / maxGen) * w;
      const py = y + h - ((valueOf(p) - minVal) / range) * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
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

    let rowY = y + 62;
    const rowH = 16;
    const maxRows = Math.max(1, Math.floor((h - 62) / rowH));
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
