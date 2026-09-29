import { ForwardResult, PolicyNetwork } from './rl/network';
import { Creature } from './creature';

/** Short sensor labels, matching the obs[] layout built in rl/perception.ts. */
const INPUT_LABELS = [
  'vel x',
  'vel y',
  'head sin',
  'head cos',
  'energy',
  'clone %',
  'food dist',
  'food sin',
  'food cos',
  'threat dist',
  'threat sin',
  'threat cos',
  'obst dist',
  'obst sin',
  'obst cos',
  'wall dist',
];

/** Action labels, matching rl/actions.ts ACTIONS order. */
const OUTPUT_LABELS = ['idle', 'thrust', 'thrust+L', 'thrust+R', 'turn L', 'turn R', 'bite'];

function lerpColor(t: number, neg: [number, number, number], zero: [number, number, number], pos: [number, number, number]): string {
  const clamped = Math.max(-1, Math.min(1, t));
  const from = clamped < 0 ? neg : pos;
  const mix = Math.abs(clamped);
  const r = Math.round(zero[0] + (from[0] - zero[0]) * mix);
  const g = Math.round(zero[1] + (from[1] - zero[1]) * mix);
  const b = Math.round(zero[2] + (from[2] - zero[2]) * mix);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Standalone overlay panel that draws the currently-selected creature's
 * policy network as an input -> hidden -> output node graph: sensor
 * readings on the left, hidden-layer activations in the middle, and the
 * resulting action probabilities on the right, connected by weight/signal
 * strength lines.
 *
 * Deliberately its own <canvas> (not part of the main world renderer) so it
 * can be shown/hidden freely without touching the simulation's render path,
 * and throttled independently since it's a diagnostic view, not gameplay.
 */
export class BrainVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public visible = false;

  private lastDrawMs = 0;
  private static readonly MIN_REDRAW_INTERVAL_MS = 80; // ~12.5 Hz is plenty for a readout

  private readonly panelWidth = 420;
  private readonly panelHeight = 620;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'brain-viz-canvas';
    this.canvas.style.cssText = `
      position: absolute;
      top: 68px;
      right: 16px;
      width: ${this.panelWidth}px;
      height: ${this.panelHeight}px;
      z-index: 35;
      pointer-events: none;
      display: none;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.45);
    `;
    container.appendChild(this.canvas);

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.panelWidth * dpr;
    this.canvas.height = this.panelHeight * dpr;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to obtain 2D context for brain visualizer canvas');
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

  /**
   * Draws the network for one creature. Cheap no-op when hidden, and
   * internally throttled to a modest refresh rate since this is a
   * diagnostic overlay, not something that needs full 60Hz precision.
   */
  public render(creature: Creature, network: PolicyNetwork, forward: ForwardResult, action: number, nowMs: number): void {
    if (!this.visible) return;
    if (nowMs - this.lastDrawMs < BrainVisualizer.MIN_REDRAW_INTERVAL_MS) return;
    this.lastDrawMs = nowMs;

    const ctx = this.ctx;
    const w = this.panelWidth;
    const h = this.panelHeight;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    // Header
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = creature.type === 'shark' ? '#7dd3fc' : '#fbbf24';
    ctx.fillText(`🧠 ${creature.type === 'shark' ? 'SHARK' : 'FISH'} #${creature.id} — NEURAL NET`, 14, 22);
    ctx.font = '9px monospace';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`${network.inputSize} sensors → ${network.hiddenSize} hidden → ${network.outputSize} actions`, 14, 36);

    const top = 52;
    const bottom = h - 16;
    const inputX = 90;
    const hiddenX = w / 2 + 10;
    const outputX = w - 80;

    const { obs, hidden, probs } = forward;

    const inputY = (i: number) => top + ((bottom - top) * (i + 0.5)) / obs.length;
    const hiddenY = (i: number) => top + ((bottom - top) * (i + 0.5)) / hidden.length;
    const outputY = (i: number) => top + ((bottom - top) * (i + 0.5)) / probs.length;

    // --- Connection lines (drawn first, underneath the nodes) ---
    // Input -> hidden, colored/weighted by the actual signal (weight * input
    // activation) so the picture shows what's driving the hidden layer right
    // now, not just the network's static weights.
    let maxSignal1 = 1e-6;
    const signals1: number[][] = network.w1.map((row, hIdx) =>
      row.map((wgt, iIdx) => {
        const s = wgt * obs[iIdx];
        maxSignal1 = Math.max(maxSignal1, Math.abs(s));
        return s;
      })
    );

    ctx.lineCap = 'round';
    for (let hIdx = 0; hIdx < hidden.length; hIdx++) {
      const hy = hiddenY(hIdx);
      for (let iIdx = 0; iIdx < obs.length; iIdx++) {
        const s = signals1[hIdx][iIdx];
        const mag = Math.abs(s) / maxSignal1;
        if (mag < 0.08) continue; // skip near-zero links to keep it legible
        ctx.strokeStyle = s >= 0 ? `rgba(52, 211, 153, ${0.12 + mag * 0.55})` : `rgba(248, 113, 113, ${0.12 + mag * 0.55})`;
        ctx.lineWidth = 0.5 + mag * 1.8;
        ctx.beginPath();
        ctx.moveTo(inputX + 8, inputY(iIdx));
        ctx.lineTo(hiddenX - 6, hy);
        ctx.stroke();
      }
    }

    // Hidden -> output, same idea with w2 and the hidden activations.
    let maxSignal2 = 1e-6;
    const signals2: number[][] = network.w2.map((row, oIdx) =>
      row.map((wgt, hIdx) => {
        const s = wgt * hidden[hIdx];
        maxSignal2 = Math.max(maxSignal2, Math.abs(s));
        return s;
      })
    );

    for (let oIdx = 0; oIdx < probs.length; oIdx++) {
      const oy = outputY(oIdx);
      for (let hIdx = 0; hIdx < hidden.length; hIdx++) {
        const s = signals2[oIdx][hIdx];
        const mag = Math.abs(s) / maxSignal2;
        if (mag < 0.08) continue;
        ctx.strokeStyle = s >= 0 ? `rgba(52, 211, 153, ${0.12 + mag * 0.55})` : `rgba(248, 113, 113, ${0.12 + mag * 0.55})`;
        ctx.lineWidth = 0.5 + mag * 1.8;
        ctx.beginPath();
        ctx.moveTo(hiddenX + 6, hiddenY(hIdx));
        ctx.lineTo(outputX - 8, oy);
        ctx.stroke();
      }
    }

    // --- Input nodes ---
    ctx.font = '9px monospace';
    for (let i = 0; i < obs.length; i++) {
      const y = inputY(i);
      const v = Math.max(-1, Math.min(1, obs[i]));
      ctx.beginPath();
      ctx.arc(inputX, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = lerpColor(v, [96, 165, 250], [71, 85, 105], [251, 191, 36]);
      ctx.fill();

      ctx.textAlign = 'right';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(INPUT_LABELS[i] ?? `in${i}`, inputX - 10, y + 3);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#475569';
      ctx.fillText(v.toFixed(2), inputX + 10, y + 3);
    }

    // --- Hidden nodes ---
    let maxHiddenAct = 1e-6;
    for (const a of hidden) maxHiddenAct = Math.max(maxHiddenAct, a);
    for (let i = 0; i < hidden.length; i++) {
      const y = hiddenY(i);
      const act = hidden[i] / maxHiddenAct; // 0..1, ReLU so never negative
      const radius = 2.5 + act * 4;
      ctx.beginPath();
      ctx.arc(hiddenX, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.25 + act * 0.7})`;
      ctx.fill();
    }

    // --- Output nodes (actions) ---
    for (let i = 0; i < probs.length; i++) {
      const y = outputY(i);
      const p = probs[i];
      const isChosen = i === action;
      const radius = 4 + p * 14;

      ctx.beginPath();
      ctx.arc(outputX, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(167, 139, 250, ${0.25 + p * 0.7})`;
      ctx.fill();

      if (isChosen) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#facc15';
        ctx.stroke();
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = isChosen ? '#facc15' : '#94a3b8';
      ctx.font = isChosen ? 'bold 9px monospace' : '9px monospace';
      ctx.fillText(`${OUTPUT_LABELS[i] ?? `out${i}`} ${(p * 100).toFixed(0)}%`, outputX + radius + 6, y + 3);
      ctx.font = '9px monospace';
    }

    // Column headers
    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748b';
    ctx.fillText('SENSORS', inputX, top - 10);
    ctx.fillText('HIDDEN', hiddenX, top - 10);
    ctx.fillText('ACTIONS', outputX, top - 10);
  }
}
