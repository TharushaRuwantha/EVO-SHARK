import { Creature } from './creature';
import { SENSOR_SECTIONS, HIT_TYPES } from './rl/sensorLayout';

/**
 * Scrolling live text readout of the full sensor buffer for the controlled
 * creature (see OBS_SIZE in rl/sensorLayout.ts for the current total),
 * grouped by modality section. This is the
 * ground-truth verification view: unlike the brain visualizer's grouped
 * sparklines, every individual scalar is shown with its label.
 *
 * Its own overlay canvas (off by default), independent of the brain
 * visualizer panel so either can be toggled without the other.
 */
export class SensorPanel {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public visible = false;

  private lastDrawMs = 0;
  private static readonly MIN_REDRAW_INTERVAL_MS = 100;

  private readonly panelWidth = 300;
  private readonly panelHeight = 620;
  private scrollOffset = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'sensor-panel-canvas';
    this.canvas.style.cssText = `
      position: absolute;
      top: 68px;
      left: 16px;
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

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scrollOffset = Math.max(0, this.scrollOffset + e.deltaY * 0.5);
    }, { passive: false });

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.panelWidth * dpr;
    this.canvas.height = this.panelHeight * dpr;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to obtain 2D context for sensor panel canvas');
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

  public render(creature: Creature, obs: Float32Array, nowMs: number): void {
    if (!this.visible) return;
    if (nowMs - this.lastDrawMs < SensorPanel.MIN_REDRAW_INTERVAL_MS) return;
    this.lastDrawMs = nowMs;

    const ctx = this.ctx;
    const w = this.panelWidth;
    const h = this.panelHeight;
    const lineH = 13;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = creature.type === 'shark' ? '#7dd3fc' : '#fbbf24';
    ctx.textAlign = 'left';
    ctx.fillText(`SENSOR VECTOR — ${obs.length} inputs (scroll)`, 10, 20);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 28, w, h - 28);
    ctx.clip();

    let y = 44 - this.scrollOffset;
    ctx.font = '9px monospace';
    for (const section of SENSOR_SECTIONS) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(`${section.name}`, 10, y);
      y += lineH;
      ctx.font = '9px monospace';

      for (let i = 0; i < section.size; i++) {
        const idx = section.offset + i;
        const label = this.labelFor(section.name, i);
        const v = obs[idx];
        ctx.fillStyle = '#64748b';
        ctx.fillText(`${idx.toString().padStart(3, '0')} ${label}`, 16, y);
        ctx.fillStyle = Math.abs(v) > 0.5 ? '#facc15' : '#cbd5e1';
        ctx.textAlign = 'right';
        ctx.fillText(v.toFixed(2), w - 10, y);
        ctx.textAlign = 'left';
        y += lineH;
      }
      y += 4;
    }

    this.maxScroll = Math.max(0, y + this.scrollOffset - (h - 28) - 44);
    ctx.restore();
  }

  private maxScroll = 0;

  private labelFor(sectionName: string, i: number): string {
    if (sectionName === 'VISION') {
      const ray = Math.floor(i / 6);
      const slot = i % 6;
      return slot === 0 ? `ray${ray} dist` : `ray${ray} ${HIT_TYPES[slot - 1]}`;
    }
    if (sectionName === 'SMELL') {
      const dir = Math.floor(i / 2);
      return i % 2 === 0 ? `dir${dir} prey-scent` : `dir${dir} predator-scent`;
    }
    if (sectionName === 'LATERAL LINE') return `dir${i} motion`;
    if (sectionName === 'ELECTRORECEPTION') {
      const dir = Math.floor(i / 2);
      return i % 2 === 0 ? `q${dir} presence` : `q${dir} size`;
    }
    if (sectionName === 'TOUCH') {
      const quad = Math.floor(i / 4);
      const types = ['wall', 'plant', 'prey', 'predator'];
      return `q${quad} ${types[i % 4]}`;
    }
    if (sectionName === 'PROPRIOCEPTION') {
      return ['forward', 'lateral', 'angular', 'energy', 'health', 'heading_sin', 'heading_cos'][i] ?? `#${i}`;
    }
    if (sectionName === 'PHYSIOLOGY') {
      return ['hunger', 'bite cd', 'dmg flash', 'clone_progress'][i] ?? `#${i}`;
    }
    return `#${i}`;
  }
}
