import { CONFIG } from './config';
import { World } from './world';
import { Camera } from './camera';
import { InputManager } from './input';
import { Creature } from './creature';
import { Plant } from './plant';
import { MeatRemains } from './food';
import { computeVision } from './rl/vision';
import { computeTouch } from './rl/touch';
import { computeElectroreception } from './rl/electroreception';
import { computeLateralLine } from './rl/lateralLine';
import {
  VISION_SIZE,
  TOUCH_SIZE,
  TOUCH_VALUES_PER_QUADRANT,
  ELECTRO_SIZE,
  ELECTRO_VALUES_PER_DIRECTION,
  LATERAL_LINE_SIZE,
  LATERAL_LINE_DIRECTIONS,
  QUADRANTS,
} from './rl/sensorLayout';

const HIT_COLORS: Record<string, string> = {
  empty: 'rgba(74, 222, 128, 0.3)',
  wall: 'rgba(148, 163, 184, 0.65)',
  plant: 'rgba(52, 211, 153, 0.9)',
  prey: 'rgba(251, 146, 60, 0.9)',
  predator: 'rgba(239, 68, 68, 0.9)',
};

const QUADRANT_ANGLE_OFFSET: Record<string, number> = {
  front: 0,
  right: Math.PI / 2,
  back: Math.PI,
  left: -Math.PI / 2,
};

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Cached gradients reused across frames instead of being rebuilt per-plant,
  // per-frame (createRadialGradient is one of the costlier canvas calls, and
  // with plant counts running into the thousands this was the single
  // biggest render cost). Keyed by glow color since only a handful of plant
  // palettes exist; pulse animation is applied via ctx.scale instead of by
  // rebuilding the gradient with a different radius every frame.
  private plantGlowGradients: Map<string, CanvasGradient> = new Map();

  // Current camera-visible world-space rectangle, recomputed once per
  // render() call and used to skip drawing/looping over off-screen entities.
  private viewLeft = 0;
  private viewTop = 0;
  private viewRight = 0;
  private viewBottom = 0;

  // Scratch buffers reused for sense-debug recomputation (drawing only —
  // these never touch the creature's real sensorBuffer or training data).
  private debugVisionBuf = new Float32Array(VISION_SIZE);
  private debugTouchBuf = new Float32Array(TOUCH_SIZE);
  private debugElectroBuf = new Float32Array(ELECTRO_SIZE);
  private debugLateralBuf = new Float32Array(LATERAL_LINE_SIZE);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to obtain 2D canvas rendering context');
    }
    this.ctx = context;
  }

  private updateViewport(camera: Camera, dpr: number): void {
    const cw = this.canvas.width / dpr;
    const ch = this.canvas.height / dpr;
    const margin = 60; // covers largest sprite radii + glow bloom
    this.viewLeft = -camera.x / camera.zoom - margin;
    this.viewTop = -camera.y / camera.zoom - margin;
    this.viewRight = this.viewLeft + cw / camera.zoom + margin * 2;
    this.viewBottom = this.viewTop + ch / camera.zoom + margin * 2;
  }

  private isInView(x: number, y: number): boolean {
    return x >= this.viewLeft && x <= this.viewRight && y >= this.viewTop && y <= this.viewBottom;
  }

  private getPlantGlowGradient(ctx: CanvasRenderingContext2D, glowColor: string, refRadius: number): CanvasGradient {
    let grad = this.plantGlowGradients.get(glowColor);
    if (!grad) {
      grad = ctx.createRadialGradient(0, 0, 1, 0, 0, refRadius);
      grad.addColorStop(0, glowColor);
      grad.addColorStop(0.4, 'rgba(0, 245, 212, 0.35)');
      grad.addColorStop(1, 'rgba(0, 245, 212, 0)');
      this.plantGlowGradients.set(glowColor, grad);
    }
    return grad;
  }

  /**
   * Main render loop executing the layered draw pipeline.
   * Note: Small fish are layered UNDER the plants for realistic concealment & camouflage!
   */
  public render(
    world: World,
    camera: Camera,
    input: InputManager,
    fps: number,
    time: number
  ): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;

    this.updateViewport(camera, dpr);

    // Reset transform to identity and clear screen
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply camera transform (pan + zoom)
    ctx.save();
    camera.applyTransform(ctx);

    // 1. Background deep blue sea
    this.drawBackground(ctx);

    // 2. Debug grid (G)
    if (input.showGrid) {
      this.drawGrid(ctx);
    }

    // 3. Small Fish (Prey) - LAYERED UNDER PLANTS so foliage obscures and conceals them!
    this.drawSmallFishLayer(ctx, world, time, input);

    // 4. Meat Remains (fish carcasses)
    this.drawMeatRemains(ctx, world.meatRemains, time);

    // 5. Upgraded Bioluminescent Plants (Drawn ON TOP of small fish!)
    this.drawPlants(ctx, world, time);

    // 6. Obstacles with drop shadow
    this.drawObstacles(ctx, world);

    // 7. Sharks (Predators - swimming above the seabed flora)
    this.drawSharksLayer(ctx, world, time, input);

    // 8. Controlled Creature Overhead HUD/Badge
    if (world.controlledCreature && !world.controlledCreature.isDead) {
      this.drawControlledOverheadUI(ctx, world.controlledCreature);
    }

    // 9. Bite Target Indicators (with camouflage awareness)
    this.drawBiteTargetCue(ctx, world);

    // 10. Particles (blood clouds, bubbles, spores, sparks)
    world.particles.draw(ctx);

    // 11. In-world Floating Texts
    this.drawFloatingTexts(ctx, world);

    // 11b. Sensor debug overlays (off by default; C = senses, S = scent)
    if (input.showScent) {
      this.drawScentHeatmap(ctx, world);
    }
    if (input.showSenses && world.controlledCreature && !world.controlledCreature.isDead) {
      this.drawSensesDebug(ctx, world, world.controlledCreature);
    }

    // 12. World solid border (20 units thick)
    this.drawWorldBorder(ctx);

    ctx.restore();

    // 13. Fixed Screen HUD (Unscaled, pixel-perfect)
    this.drawHUD(ctx, world, camera, input, fps, dpr);
    this.drawControlsBanner(ctx, world, input, dpr);
  }

  /**
   * 1. Background deep blue sea gradient
   */
  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const w = CONFIG.world.width;
    const h = CONFIG.world.height;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, CONFIG.colors.bgTop);
    grad.addColorStop(0.5, '#051224');
    grad.addColorStop(1, CONFIG.colors.bgBottom);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle water caustics effect
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.fillStyle = '#38bdf8';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(w * 0.2 + i * 300, h * 0.3 + (i % 2) * 200, 180, 80, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 2. Debug grid (100 units)
   */
  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const w = CONFIG.world.width;
    const h = CONFIG.world.height;
    const step = 100;

    ctx.save();
    ctx.strokeStyle = 'rgba(74, 144, 226, 0.14)';
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(74, 144, 226, 0.35)';

    ctx.beginPath();
    for (let x = 0; x <= w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y <= h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    for (let x = 0; x <= w; x += step * 2) {
      for (let y = 0; y <= h; y += step * 2) {
        ctx.fillText(`${x},${y}`, x + 4, y + 14);
      }
    }
    ctx.restore();
  }

  /**
   * 3. Small Fish Layer - Rendered UNDER the plants!
   */
  private drawSmallFishLayer(
    ctx: CanvasRenderingContext2D,
    world: World,
    time: number,
    input: InputManager
  ): void {
    // Includes fish still mid-death-fade so their shrink/fade animation plays out.
    for (const fish of world.fishList) {
      if (!this.isInView(fish.x, fish.y)) continue;
      const isControlled = fish === world.controlledCreature;
      this.drawCreature(ctx, fish, isControlled, time, input);
      this.drawVitalsBars(ctx, fish);
    }
  }

  /**
   * 4. Floating Meat Remains (fish carcasses spawned on death)
   */
  private drawMeatRemains(ctx: CanvasRenderingContext2D, remains: MeatRemains[], time: number): void {
    if (remains.length === 0) return;

    ctx.save();
    for (const meat of remains) {
      if (!this.isInView(meat.x, meat.y)) continue;
      const bob = Math.sin(time * 3 + meat.id) * 1.5;
      const decayRatio = meat.age / meat.maxAge;
      const alpha = Math.max(0.3, 1 - decayRatio * 0.7);

      ctx.save();
      ctx.translate(meat.x, meat.y + bob);
      ctx.rotate(meat.rotation);
      ctx.globalAlpha = alpha;

      // Drop shadow in water
      ctx.beginPath();
      ctx.ellipse(0, 3, meat.radius * 1.1, meat.radius * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fill();

      // Meat morsel body (crimson / meat chunk)
      ctx.beginPath();
      ctx.moveTo(-meat.radius * 0.8, -meat.radius * 0.4);
      ctx.lineTo(meat.radius * 0.7, -meat.radius * 0.6);
      ctx.lineTo(meat.radius * 1.1, meat.radius * 0.2);
      ctx.lineTo(meat.radius * 0.2, meat.radius * 0.8);
      ctx.lineTo(-meat.radius * 0.9, meat.radius * 0.5);
      ctx.closePath();

      ctx.fillStyle = CONFIG.colors.meat;
      ctx.fill();
      ctx.strokeStyle = CONFIG.colors.meatDark;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Bone/cartilage center fragment
      ctx.beginPath();
      ctx.arc(-meat.radius * 0.1, 0, meat.radius * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = '#fef2f2';
      ctx.fill();

      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * 5. Enhanced Plants: Bioluminescent swaying kelp, fronds, and glowing spore bulbs
   * Rendered ON TOP of small fish, physically covering and camouflaging them!
   */
  private drawPlants(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    ctx.save();

    for (const plant of world.plants) {
      if (!this.isInView(plant.x, plant.y)) continue;
      const sway = Math.sin(time * plant.swaySpeed + plant.stemSwayPhase) * 5;
      const pulse = 1 + 0.16 * Math.sin(time * 2.2 + plant.pulsePhase);
      const r = plant.radius * pulse;

      // Base holdfast (roots)
      ctx.beginPath();
      ctx.ellipse(plant.x, plant.y + 4, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#064e3b';
      ctx.fill();

      // Swaying Stem (curved upward tendril)
      const tipX = plant.x + sway;
      const tipY = plant.y - plant.height;

      ctx.beginPath();
      ctx.moveTo(plant.x, plant.y);
      ctx.quadraticCurveTo(plant.x + sway * 0.4, plant.y - plant.height * 0.5, tipX, tipY);
      ctx.strokeStyle = plant.colorTone;
      ctx.lineWidth = 2.4;
      ctx.stroke();

      // Fronds / leafy tendrils along the stem
      for (let f = 1; f <= plant.frondCount; f++) {
        const ratio = f / (plant.frondCount + 1);
        const frondY = plant.y - plant.height * ratio;
        const frondBaseX = plant.x + sway * ratio * 0.7;
        const side = f % 2 === 0 ? 1 : -1;
        const frondLength = 8 + ratio * 4;
        const frondTipX = frondBaseX + side * frondLength + Math.sin(time * 2 + f) * 2;
        const frondTipY = frondY - 4;

        ctx.beginPath();
        ctx.moveTo(frondBaseX, frondY);
        ctx.quadraticCurveTo(frondBaseX + side * 4, frondY - 6, frondTipX, frondTipY);
        ctx.strokeStyle = plant.colorTone;
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Small leaf bulb at frond tip
        ctx.beginPath();
        ctx.arc(frondTipX, frondTipY, 2.0, 0, Math.PI * 2);
        ctx.fillStyle = plant.glowColor;
        ctx.fill();
      }

      // Bioluminescent Crown Bulb
      // 1. Soft radial bloom aura (gradient is built once per glow color and
      // reused every frame/plant; the pulse animation is applied via a
      // transform scale instead of recreating the gradient at a new radius)
      const glowGrad = this.getPlantGlowGradient(ctx, plant.glowColor, plant.radius * 2.4);
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.scale(pulse, pulse);
      ctx.beginPath();
      ctx.arc(0, 0, plant.radius * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = glowGrad;
      ctx.fill();
      ctx.restore();

      // 2. Main glowing spore bulb
      ctx.beginPath();
      ctx.arc(tipX, tipY, r, 0, Math.PI * 2);
      ctx.fillStyle = plant.glowColor;
      ctx.fill();

      // 3. Bright center highlight
      ctx.beginPath();
      ctx.arc(tipX - r * 0.25, tipY - r * 0.25, r * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * 6. Obstacles: Gray-green rock polygons with subtle drop shadows
   */
  private drawObstacles(ctx: CanvasRenderingContext2D, world: World): void {
    ctx.save();

    for (const obs of world.obstacles) {
      if (!this.isInView(obs.x, obs.y)) continue;
      const verts = obs.vertices;
      if (verts.length === 0) continue;

      // Drop shadow (offset by +8, +8)
      ctx.beginPath();
      ctx.moveTo(verts[0].x + 8, verts[0].y + 8);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x + 8, verts[i].y + 8);
      }
      ctx.closePath();
      ctx.fillStyle = CONFIG.colors.obstacleShadow;
      ctx.fill();

      // Main rock polygon
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();

      // Gradient rock texture
      const grad = ctx.createLinearGradient(obs.x - obs.radius, obs.y - obs.radius, obs.x + obs.radius, obs.y + obs.radius);
      grad.addColorStop(0, '#5a6b63');
      grad.addColorStop(0.5, CONFIG.colors.obstacle);
      grad.addColorStop(1, '#334139');

      ctx.fillStyle = grad;
      ctx.fill();

      // Outline
      ctx.strokeStyle = '#27332d';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Facet interior highlights
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < verts.length; i += 2) {
        ctx.moveTo(obs.x, obs.y);
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 7. Sharks Layer (Predators cruising above the flora)
   */
  private drawSharksLayer(
    ctx: CanvasRenderingContext2D,
    world: World,
    time: number,
    input: InputManager
  ): void {
    for (const shark of world.sharks) {
      if (!this.isInView(shark.x, shark.y)) continue;
      const isControlled = shark === world.controlledCreature;
      this.drawCreature(ctx, shark, isControlled, time, input);
      this.drawVitalsBars(ctx, shark);
    }
  }

  /**
   * Energy (green/yellow/red, 4px) and health (red, 3px) bars stacked above
   * a creature. Fades out along with the creature's death animation.
   */
  private drawVitalsBars(ctx: CanvasRenderingContext2D, creature: Creature): void {
    const deathAlpha = creature.isDead ? Math.max(0, 1 - creature.deathFadeTicks / 30) : 1;
    if (deathAlpha <= 0) return;

    const w = creature.radius * 2;
    const x = creature.x - w / 2;
    const energyY = creature.y - creature.radius - 20;
    const healthY = energyY + 4 + 2;

    ctx.save();
    ctx.globalAlpha = deathAlpha;

    // Single shared backdrop behind both bars (was two separate fillRects)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(x - 1, energyY - 1, w + 2, healthY - energyY + 3 + 2);

    // Energy bar
    const ef = Math.max(0, Math.min(1, creature.energyFraction));
    ctx.fillStyle = ef < 0.2 ? '#ef4444' : ef < 0.5 ? '#facc15' : '#22c55e';
    ctx.fillRect(x, energyY, w * ef, 4);

    // Health bar
    const hf = Math.max(0, Math.min(1, creature.healthFraction));
    ctx.fillStyle = `rgba(239, 68, 68, ${(0.5 + 0.5 * hf).toFixed(2)})`;
    ctx.fillRect(x, healthY, w * hf, 3);

    ctx.restore();
  }

  /**
   * 8. Controlled creature overhead status bar: [CONTROLLED], camouflage tag, and clone progress
   */
  private drawControlledOverheadUI(
    ctx: CanvasRenderingContext2D,
    creature: Creature
  ): void {
    ctx.save();
    const overheadY = creature.y - creature.radius - 18;

    // Badge (no shadowBlur: it's one of the costlier canvas ops and this
    // renders every frame; a plain dark outline reads fine without it)
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    const label = creature.isCoveredByPlants
      ? '🌿 HIDDEN UNDER FLORA'
      : '▼ CONTROLLED';
    ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.fillText(label, creature.x + 1, overheadY + 1);
    ctx.fillStyle = creature.type === 'shark' ? '#7dd3fc' : '#fbbf24';
    ctx.fillText(label, creature.x, overheadY);

    // Clone progress bar
    const barWidth = 32;
    const barHeight = 4;
    const barX = creature.x - barWidth / 2;
    const barY = overheadY + 4;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);

    const fillRatio = creature.cloneProgressRatio;
    ctx.fillStyle = creature.type === 'shark' ? '#38bdf8' : '#34d399';
    ctx.fillRect(barX, barY, barWidth * fillRatio, barHeight);

    ctx.restore();
  }

  /**
   * Generic creature renderer with species shapes, fins, eyes, animated jaws, and camouflage shading
   */
  private drawCreature(
    ctx: CanvasRenderingContext2D,
    creature: Creature,
    isControlled: boolean,
    time: number,
    input: InputManager
  ): void {
    ctx.save();
    ctx.translate(creature.x, creature.y);

    // Death animation: fade to transparent and shrink to half size over 30 ticks
    if (creature.isDead) {
      const t = Math.min(1, creature.deathFadeTicks / 30);
      ctx.globalAlpha = 1 - t;
      ctx.scale(1 - 0.5 * t, 1 - 0.5 * t);
    }

    ctx.rotate(creature.heading);

    const isShark = creature.type === 'shark';
    const r = creature.radius;
    const speed = creature.speed;

    // Swimming tail waggle only wiggles when moving; stationary creature is at rest
    const wagFrequency = speed > 5 ? speed * 0.12 : 0;
    const wagAngle = speed > 5 ? Math.sin(time * wagFrequency + creature.id) * 0.35 : 0;

    // Camouflage blending when small fish is under plants: less visible to predators!
    if (!creature.isDead && !isShark && creature.isCoveredByPlants) {
      ctx.globalAlpha = isControlled ? 0.70 : 0.40;
    }

    // 1. Controlled Aura Glow
    if (isControlled) {
      ctx.save();
      const glowColor = isShark ? 'rgba(56, 189, 248, 0.4)' : 'rgba(251, 191, 36, 0.45)';
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.6, r * 1.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.fill();
      ctx.restore();
    }

    if (isShark) {
      // --- SHARK (PREDATOR) ---
      // Pectoral Fins
      ctx.fillStyle = CONFIG.colors.sharkDark;
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 0.8);
      ctx.lineTo(-r * 0.6, -r * 1.8);
      ctx.lineTo(-r * 0.2, -r * 0.6);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(r * 0.2, r * 0.8);
      ctx.lineTo(-r * 0.6, r * 1.8);
      ctx.lineTo(-r * 0.2, r * 0.6);
      ctx.closePath();
      ctx.fill();

      // Tail & Caudal Fin
      ctx.save();
      ctx.translate(-r * 1.2, 0);
      ctx.rotate(wagAngle);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 1.2, -r * 1.1);
      ctx.lineTo(-r * 0.8, 0);
      ctx.lineTo(-r * 1.1, r * 0.8);
      ctx.closePath();
      ctx.fillStyle = CONFIG.colors.sharkDark;
      ctx.fill();
      ctx.restore();

      // Main Torpedo / Teardrop Body
      ctx.beginPath();
      ctx.moveTo(r * 1.8, 0); // Snout
      ctx.bezierCurveTo(r * 1.2, -r * 1.0, -r * 0.5, -r * 1.0, -r * 1.4, 0);
      ctx.bezierCurveTo(-r * 0.5, r * 1.0, r * 1.2, r * 1.0, r * 1.8, 0);
      ctx.closePath();

      const sharkGrad = ctx.createLinearGradient(0, -r, 0, r);
      sharkGrad.addColorStop(0, CONFIG.colors.shark);
      sharkGrad.addColorStop(0.5, '#3a536e');
      sharkGrad.addColorStop(1, CONFIG.colors.sharkDark);

      ctx.fillStyle = sharkGrad;
      ctx.fill();

      // Outline
      ctx.strokeStyle = isControlled ? '#38bdf8' : '#1e293b';
      ctx.lineWidth = isControlled ? 2.5 : 1.8;
      ctx.stroke();

      // Dorsal Fin
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, 0);
      ctx.lineTo(-r * 0.7, -r * 0.8);
      ctx.lineTo(-r * 0.4, 0);
      ctx.closePath();
      ctx.fillStyle = '#1e293b';
      ctx.fill();

      // Gill slits
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.6)';
      ctx.lineWidth = 1.2;
      for (let g = 0; g < 3; g++) {
        ctx.beginPath();
        const gx = r * 0.1 - g * 4;
        ctx.moveTo(gx, -r * 0.5);
        ctx.lineTo(gx - 2, r * 0.5);
        ctx.stroke();
      }

      // Predatory Eyes
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(r * 0.9, -r * 0.5, 2.8, 0, Math.PI * 2);
      ctx.arc(r * 0.9, r * 0.5, 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(r * 1.0, -r * 0.5, 1.4, 0, Math.PI * 2);
      ctx.arc(r * 1.0, r * 0.5, 1.4, 0, Math.PI * 2);
      ctx.fill();

      // Animated Snapping Jaws
      if (creature.isBiting) {
        const biteCycle = Math.sin(creature.biteAnimationProgress * Math.PI);
        const jawOpening = biteCycle * 14;

        ctx.save();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(r * 1.8, 0);
        ctx.lineTo(r * 1.3, -jawOpening * 0.6);
        ctx.lineTo(r * 1.1, 0);
        ctx.lineTo(r * 1.3, jawOpening * 0.6);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        for (let t = 0; t < 4; t++) {
          const tx = r * 1.3 + t * 2.2;
          ctx.beginPath();
          ctx.moveTo(tx, -jawOpening * 0.5);
          ctx.lineTo(tx + 1.2, -jawOpening * 0.1);
          ctx.lineTo(tx + 2.4, -jawOpening * 0.5);
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(tx, jawOpening * 0.5);
          ctx.lineTo(tx + 1.2, jawOpening * 0.1);
          ctx.lineTo(tx + 2.4, jawOpening * 0.5);
          ctx.fill();
        }
        ctx.restore();
      }
    } else {
      // --- FISH (PREY / SMALL FISH) ---
      // Tail fin
      ctx.save();
      ctx.translate(-r * 1.1, 0);
      ctx.rotate(wagAngle);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 1.0, -r * 0.85);
      ctx.lineTo(-r * 0.65, 0);
      ctx.lineTo(-r * 1.0, r * 0.85);
      ctx.closePath();
      ctx.fillStyle = CONFIG.colors.fishDark;
      ctx.fill();
      ctx.restore();

      // Streamlined Body (with plant camouflage hue if covered)
      ctx.beginPath();
      ctx.moveTo(r * 1.6, 0);
      ctx.bezierCurveTo(r * 0.8, -r * 1.05, -r * 0.6, -r * 0.9, -r * 1.2, 0);
      ctx.bezierCurveTo(-r * 0.6, r * 0.9, r * 0.8, r * 1.05, r * 1.6, 0);
      ctx.closePath();

      const fishGrad = ctx.createLinearGradient(0, -r, 0, r);
      if (creature.isCoveredByPlants) {
        fishGrad.addColorStop(0, '#86efac');
        fishGrad.addColorStop(0.5, '#10b981');
        fishGrad.addColorStop(1, '#064e3b');
      } else {
        fishGrad.addColorStop(0, '#ffb366');
        fishGrad.addColorStop(0.5, CONFIG.colors.fish);
        fishGrad.addColorStop(1, CONFIG.colors.fishDark);
      }

      ctx.fillStyle = fishGrad;
      ctx.fill();

      // Outline
      ctx.strokeStyle = isControlled
        ? '#fbbf24'
        : creature.isCoveredByPlants
        ? '#059669'
        : '#9a3412';
      ctx.lineWidth = isControlled ? 2.2 : 1.4;
      ctx.stroke();

      // Side fin
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 0.4, r * 0.6);
      ctx.lineTo(r * 0.2, r * 0.4);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 237, 213, 0.8)';
      ctx.fill();

      // Eye
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(r * 0.85, -r * 0.4, 2.5, 0, Math.PI * 2);
      ctx.arc(r * 0.85, r * 0.4, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(r * 0.95, -r * 0.4, 1.3, 0, Math.PI * 2);
      ctx.arc(r * 0.95, r * 0.4, 1.3, 0, Math.PI * 2);
      ctx.fill();

      // Animated Nibble Mouth
      if (creature.isBiting) {
        const biteCycle = Math.sin(creature.biteAnimationProgress * Math.PI);
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.arc(r * 1.5, 0, biteCycle * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Recent-damage flash: red tint overlay for 6 ticks after taking a bite
    if (creature.recentDamageTicks > 0) {
      ctx.save();
      ctx.globalAlpha = (creature.recentDamageTicks / 6) * 0.55;
      ctx.fillStyle = '#ff1a1a';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.6, r * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Debug overlays
    if (input.showBoundingCircles) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (input.showHeadingLines) {
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r + 35, 0);
      ctx.stroke();
    }

    if (input.showVelocityArrows && speed > 2) {
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.95)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(creature.vx * 0.4, creature.vy * 0.4);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 9. Visual targeting indicator when prey/plant/meat is within biting range
   */
  private drawBiteTargetCue(ctx: CanvasRenderingContext2D, world: World): void {
    const controlled = world.controlledCreature;
    if (!controlled || controlled.isDead) return;

    const inRange = world.isTargetInBiteRange();
    if (!inRange) return;

    ctx.save();
    const mouth = controlled.mouthPosition;

    if (controlled.type === 'shark') {
      // 1. Shark targeting Small Fish
      for (const fish of world.aliveFish) {
        const effectiveRange = fish.isCoveredByPlants
          ? CONFIG.species.shark.biteRange * 0.35
          : CONFIG.species.shark.biteRange;

        const dist = Math.hypot(mouth.x - fish.x, mouth.y - fish.y);
        if (dist <= effectiveRange + fish.radius) {
          ctx.strokeStyle = fish.isCoveredByPlants ? 'rgba(251, 146, 60, 0.9)' : 'rgba(244, 63, 94, 0.9)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);

          ctx.beginPath();
          ctx.arc(fish.x, fish.y, fish.radius + 12, 0, Math.PI * 2);
          ctx.stroke();

          // Reticle crosshairs
          ctx.beginPath();
          ctx.moveTo(fish.x - fish.radius - 14, fish.y);
          ctx.lineTo(fish.x + fish.radius + 14, fish.y);
          ctx.moveTo(fish.x, fish.y - fish.radius - 14);
          ctx.lineTo(fish.x, fish.y + fish.radius + 14);
          ctx.stroke();

          // Overhead Prompt
          ctx.font = 'bold 10px monospace';
          ctx.fillStyle = fish.isCoveredByPlants ? '#fb923c' : '#f43f5e';
          ctx.textAlign = 'center';
          const cueText = fish.isCoveredByPlants
            ? '[SPACE] CHOMP (IN FLORA)'
            : '[SPACE] BITE TO KILL!';
          ctx.fillText(cueText, fish.x, fish.y - fish.radius - 16);
          break;
        }
      }

      // 2. Shark targeting Meat Remains
      for (const meat of world.meatRemains) {
        const dist = Math.hypot(mouth.x - meat.x, mouth.y - meat.y);
        if (dist <= CONFIG.species.shark.biteRange + meat.radius) {
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(meat.x, meat.y, meat.radius + 8, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = 'bold 9px monospace';
          ctx.fillStyle = '#fb7185';
          ctx.textAlign = 'center';
          ctx.fillText('[SPACE] EAT MEAT', meat.x, meat.y - meat.radius - 10);
          break;
        }
      }
    } else {
      // Small Fish targeting: Meat or Plant
      for (const meat of world.meatRemains) {
        const dist = Math.hypot(mouth.x - meat.x, mouth.y - meat.y);
        if (dist <= CONFIG.species.fish.biteRange + meat.radius) {
          ctx.strokeStyle = 'rgba(251, 146, 60, 0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(meat.x, meat.y, meat.radius + 8, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = 'bold 9px monospace';
          ctx.fillStyle = '#fb923c';
          ctx.textAlign = 'center';
          ctx.fillText('[SPACE] BITE MEAT', meat.x, meat.y - meat.radius - 10);
          ctx.restore();
          return;
        }
      }

      for (const plant of world.plants) {
        const dist = Math.hypot(mouth.x - plant.x, mouth.y - plant.y);
        if (dist <= CONFIG.species.fish.biteRange + plant.radius) {
          ctx.strokeStyle = 'rgba(95, 255, 122, 0.95)';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(plant.x, plant.y, plant.radius + 8, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = 'bold 9px monospace';
          ctx.fillStyle = '#5fff7a';
          ctx.textAlign = 'center';
          ctx.fillText('[SPACE] BITE PLANT', plant.x, plant.y - plant.radius - 10);
          break;
        }
      }
    }

    ctx.restore();
  }

  /**
   * 11. In-world Floating text indicators
   */
  private drawFloatingTexts(ctx: CanvasRenderingContext2D, world: World): void {
    if (world.floatingTexts.length === 0) return;

    ctx.save();
    ctx.textAlign = 'center';
    for (const ft of world.floatingTexts) {
      if (!this.isInView(ft.x, ft.y)) continue;
      const alpha = Math.max(0, 1 - ft.age / ft.maxAge);
      ctx.globalAlpha = alpha;
      const s = ft.scale || 1.0;
      ctx.font = `bold ${Math.round(13 * s)}px monospace`;
      // Plain dark outline instead of shadowBlur (no per-frame blur pass)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
      ctx.fillStyle = ft.color || '#5fff7a';
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.restore();
  }

  /**
   * Debug overlay: world-space heatmap of the two scent fields (green =
   * prey-scent, red = predator-scent), only over cells currently on
   * screen. Toggle with S.
   */
  private drawScentHeatmap(ctx: CanvasRenderingContext2D, world: World): void {
    const { gridW, gridH, cellSize } = world.smellField.dimensions;
    ctx.save();

    const minCx = Math.max(0, Math.floor(this.viewLeft / cellSize));
    const maxCx = Math.min(gridW - 1, Math.floor(this.viewRight / cellSize));
    const minCy = Math.max(0, Math.floor(this.viewTop / cellSize));
    const maxCy = Math.min(gridH - 1, Math.floor(this.viewBottom / cellSize));

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const x = cx * cellSize;
        const y = cy * cellSize;
        const prey = world.smellField.preyValueAt(x + cellSize / 2, y + cellSize / 2);
        const predator = world.smellField.predatorValueAt(x + cellSize / 2, y + cellSize / 2);
        if (prey < 0.02 && predator < 0.02) continue;

        if (prey >= predator) {
          ctx.fillStyle = `rgba(52, 211, 153, ${Math.min(0.6, prey * 0.6)})`;
        } else {
          ctx.fillStyle = `rgba(239, 68, 68, ${Math.min(0.6, predator * 0.6)})`;
        }
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }

    ctx.restore();
  }

  /**
   * Debug overlay for the controlled creature's non-vision-panel senses:
   * vision rays (colored by hit type), touch contact markers, the
   * electroreception range ring (highlighted per quadrant when it fires),
   * and lateral-line motion arrows. Toggle with C. Recomputes each sense
   * fresh from scratch buffers purely for visualization — it never reads
   * or writes the creature's real sensor buffer used for training.
   */
  private drawSensesDebug(ctx: CanvasRenderingContext2D, world: World, creature: Creature): void {
    ctx.save();

    // --- Vision rays ---
    const visionCfg = CONFIG.sensors.vision[creature.type];
    const fovRad = (visionCfg.fovDeg * Math.PI) / 180;
    const hits = computeVision(creature, world, this.debugVisionBuf, 0);
    for (let i = 0; i < hits.length; i++) {
      const spread = hits.length > 1 ? (i / (hits.length - 1) - 0.5) * fovRad : 0;
      const angle = creature.heading + spread;
      const hit = hits[i];
      ctx.strokeStyle = HIT_COLORS[hit.hitType] ?? HIT_COLORS.empty;
      ctx.lineWidth = hit.hitType === 'empty' ? 1 : 1.8;
      ctx.beginPath();
      ctx.moveTo(creature.x, creature.y);
      ctx.lineTo(creature.x + Math.cos(angle) * hit.distance, creature.y + Math.sin(angle) * hit.distance);
      ctx.stroke();
    }

    // --- Electroreception range ring, highlighted per quadrant when firing ---
    const electroCfg = CONFIG.sensors.electroreception[creature.type];
    computeElectroreception(creature, world, this.debugElectroBuf, 0);
    for (let q = 0; q < QUADRANTS.length; q++) {
      const presence = this.debugElectroBuf[q * ELECTRO_VALUES_PER_DIRECTION];
      const centerAngle = creature.heading + QUADRANT_ANGLE_OFFSET[QUADRANTS[q]];
      ctx.strokeStyle = presence > 0.05 ? `rgba(232, 121, 249, ${0.3 + presence * 0.6})` : 'rgba(148, 163, 184, 0.18)';
      ctx.lineWidth = presence > 0.05 ? 2 : 1;
      ctx.beginPath();
      ctx.arc(creature.x, creature.y, electroCfg.range, centerAngle - Math.PI / 4, centerAngle + Math.PI / 4);
      ctx.stroke();
    }

    // --- Lateral line motion arrows ---
    computeLateralLine(creature, world, this.debugLateralBuf, 0);
    for (let k = 0; k < LATERAL_LINE_DIRECTIONS; k++) {
      const intensity = this.debugLateralBuf[k];
      if (intensity < 0.02) continue;
      const angle = creature.heading + (k * Math.PI) / 4;
      const len = 14 + intensity * 40;
      const baseR = creature.radius + 6;
      const sx = creature.x + Math.cos(angle) * baseR;
      const sy = creature.y + Math.sin(angle) * baseR;
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.4 + intensity * 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(angle) * len, sy + Math.sin(angle) * len);
      ctx.stroke();
    }

    // --- Touch contact markers ---
    computeTouch(creature, world, this.debugTouchBuf, 0);
    const touchColors = ['rgba(148, 163, 184, 0.95)', 'rgba(52, 211, 153, 0.95)', 'rgba(251, 146, 60, 0.95)', 'rgba(239, 68, 68, 0.95)'];
    for (let q = 0; q < QUADRANTS.length; q++) {
      const centerAngle = creature.heading + QUADRANT_ANGLE_OFFSET[QUADRANTS[q]];
      for (let t = 0; t < TOUCH_VALUES_PER_QUADRANT; t++) {
        if (this.debugTouchBuf[q * TOUCH_VALUES_PER_QUADRANT + t] < 1) continue;
        const mx = creature.x + Math.cos(centerAngle) * (creature.radius + 14);
        const my = creature.y + Math.sin(centerAngle) * (creature.radius + 14);
        ctx.beginPath();
        ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.fillStyle = touchColors[t];
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * 12. World solid border (dark navy, 20 units thick)
   */
  private drawWorldBorder(ctx: CanvasRenderingContext2D): void {
    const w = CONFIG.world.width;
    const h = CONFIG.world.height;
    const t = CONFIG.world.wallThickness;

    ctx.save();
    ctx.fillStyle = CONFIG.colors.wall;

    ctx.fillRect(0, 0, w, t);
    ctx.fillRect(0, h - t, w, t);
    ctx.fillRect(0, t, t, h - 2 * t);
    ctx.fillRect(w - t, t, t, h - 2 * t);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(t, t, w - 2 * t, h - 2 * t);

    ctx.restore();
  }

  /**
   * 13. HUD (fixed to screen, not affected by camera)
   */
  private drawHUD(
    ctx: CanvasRenderingContext2D,
    world: World,
    camera: Camera,
    input: InputManager,
    fps: number,
    dpr: number
  ): void {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const c = world.controlledCreature;
    const isShark = c?.type === 'shark';

    const x = 16;
    const y = 68;
    const w = 275;
    const h = 290;

    ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = isShark ? 'rgba(56, 189, 248, 0.4)' : 'rgba(251, 191, 36, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // Header badge
    ctx.fillStyle = isShark ? '#38bdf8' : '#fbbf24';
    ctx.font = 'bold 12px monospace';
    const tag = isShark ? '🦈 LARGE FISH (SHARK)' : `🐟 SMALL FISH (#${c.id})`;
    ctx.fillText(tag, x + 12, y + 22);

    // Plant cover status
    if (!isShark && c.isCoveredByPlants) {
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#34d399';
      ctx.fillText('🌿 [CONCEALED UNDER FLORA]', x + 12, y + 36);
    } else {
      ctx.font = '10px monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText('🌊 [OPEN WATER]', x + 12, y + 36);
    }

    // Food & Clone Progress
    const foodRatio = c ? c.cloneProgressRatio : 0;
    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(
      `Clone Progress: ${c?.foodEaten || 0}/${c?.foodToClone || 3} (${c?.cloneCount || 0} born)`,
      x + 12,
      y + 54
    );

    // Progress Bar
    const pbW = w - 24;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(x + 12, y + 60, pbW, 6);
    ctx.fillStyle = isShark ? '#38bdf8' : '#34d399';
    ctx.fillRect(x + 12, y + 60, pbW * foodRatio, 6);

    // Hunger / Energy status — starves to death at 0
    const hungerRatio = c ? c.energy / c.stats.energyMax : 0;
    const hungerColor = hungerRatio > 0.5 ? '#4ade80' : hungerRatio > 0.2 ? '#facc15' : '#f87171';
    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`Hunger: ${(hungerRatio * 100).toFixed(0)}% ${hungerRatio <= 0.2 ? '⚠️ STARVING' : ''}`, x + 12, y + 78);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(x + 12, y + 84, pbW, 6);
    ctx.fillStyle = hungerColor;
    ctx.fillRect(x + 12, y + 84, pbW * hungerRatio, 6);

    // Health bar
    const healthRatio = c ? c.healthFraction : 0;
    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`Health: ${c ? c.health.toFixed(0) : 0} / ${c ? c.stats.maxHealth : 0}`, x + 12, y + 106);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(x + 12, y + 112, pbW, 6);
    ctx.fillStyle = `rgba(239, 68, 68, ${(0.5 + 0.5 * healthRatio).toFixed(2)})`;
    ctx.fillRect(x + 12, y + 112, pbW * healthRatio, 6);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '10px monospace';
    const lineSpacing = 15;
    let textY = y + 136;

    ctx.fillText(`Pos: (${c.x.toFixed(0)}, ${c.y.toFixed(0)})`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`Vel: (${c.vx.toFixed(1)}, ${c.vy.toFixed(1)})  Speed: ${c.speed.toFixed(1)}`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`Heading: ${c.headingDegrees.toFixed(0)}°`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`Hunger signal: ${c.hungerSignal.toFixed(2)}`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`Bite cooldown: ${Math.max(0, c.biteCooldownTimer)} ticks`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`Recent damage: ${c.recentDamage ? 'yes' : 'no'}`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`FPS: ${fps.toFixed(0)}  |  Tick: ${world.ticks}`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`Zoom: ${(camera.zoom * 100).toFixed(0)}%  |  Score: ${c.biteScore}`, x + 12, textY);
    textY += lineSpacing;

    const overlays = [
      input.showGrid ? 'G:on' : 'G:off',
      input.showVelocityArrows ? 'V:on' : 'V:off',
      input.showHeadingLines ? 'H:on' : 'H:off',
      input.showBoundingCircles ? 'B:on' : 'B:off',
      input.showSenses ? 'C:on' : 'C:off',
      input.showScent ? 'S:on' : 'S:off',
    ].join(' ');
    ctx.fillStyle = '#64748b';
    ctx.fillText(`Overlays: ${overlays}`, x + 12, textY);

    ctx.restore();
  }

  /**
   * Bottom controls and status bar
   */
  private drawControlsBanner(
    ctx: CanvasRenderingContext2D,
    world: World,
    input: InputManager,
    dpr: number
  ): void {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cw = this.canvas.width / dpr;
    const ch = this.canvas.height / dpr;

    const bannerH = 26;
    const bannerY = ch - bannerH;

    ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.fillRect(0, bannerY, cw, bannerH);
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, bannerY);
    ctx.lineTo(cw, bannerY);
    ctx.stroke();

    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';

    const popInfo = `🦈 Sharks: ${world.aliveSharks.length} | 🐟 Small Fish: ${world.aliveFish.length} | 🌿 Plants: ${world.plants.length} | 🥩 Remains: ${world.meatRemains.length}`;
    ctx.fillText(popInfo, 16, bannerY + 17);

    ctx.textAlign = 'right';
    const controlsText = '🤖 AI-controlled (RL training) | E:Regen Plants | R:New Generation | N:Brain | X:Sensors | C:Senses | S:Scent | M:Menu';
    ctx.fillText(controlsText, cw - 16, bannerY + 17);

    ctx.restore();
  }
}
