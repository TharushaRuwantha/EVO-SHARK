import { CONFIG } from './config';
import { World } from './world';
import { Camera } from './camera';
import { InputManager } from './input';
import { Creature } from './creature';
import { Plant } from './plant';
import { MeatRemains } from './food';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to obtain 2D canvas rendering context');
    }
    this.ctx = context;
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
    for (const fish of world.aliveFish) {
      const isControlled = fish === world.controlledCreature;
      this.drawCreature(ctx, fish, isControlled, time, input);
    }
  }

  /**
   * 4. Floating Meat Remains (fish carcasses spawned on death)
   */
  private drawMeatRemains(ctx: CanvasRenderingContext2D, remains: MeatRemains[], time: number): void {
    if (remains.length === 0) return;

    ctx.save();
    for (const meat of remains) {
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
      // 1. Soft radial bloom aura
      const grad = ctx.createRadialGradient(tipX, tipY, 1, tipX, tipY, r * 2.4);
      grad.addColorStop(0, plant.glowColor);
      grad.addColorStop(0.4, 'rgba(0, 245, 212, 0.35)');
      grad.addColorStop(1, 'rgba(0, 245, 212, 0)');

      ctx.beginPath();
      ctx.arc(tipX, tipY, r * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

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
    for (const shark of world.aliveSharks) {
      const isControlled = shark === world.controlledCreature;
      this.drawCreature(ctx, shark, isControlled, time, input);
    }
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

    // Glowing badge
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = creature.type === 'shark' ? '#7dd3fc' : '#fbbf24';
    ctx.shadowColor = creature.type === 'shark' ? 'rgba(56, 189, 248, 0.8)' : 'rgba(251, 191, 36, 0.8)';
    ctx.shadowBlur = 6;

    const label = creature.isCoveredByPlants
      ? '🌿 HIDDEN UNDER FLORA'
      : '▼ CONTROLLED';
    ctx.fillText(label, creature.x, overheadY);
    ctx.shadowBlur = 0;

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
    ctx.rotate(creature.heading);

    const isShark = creature.type === 'shark';
    const r = creature.radius;
    const speed = creature.speed;

    // Swimming tail waggle only wiggles when moving; stationary creature is at rest
    const wagFrequency = speed > 5 ? speed * 0.12 : 0;
    const wagAngle = speed > 5 ? Math.sin(time * wagFrequency + creature.id) * 0.35 : 0;

    // Camouflage blending when small fish is under plants: less visible to predators!
    if (!isShark && creature.isCoveredByPlants) {
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
    for (const ft of world.floatingTexts) {
      const alpha = Math.max(0, 1 - ft.age / ft.maxAge);
      ctx.globalAlpha = alpha;
      const s = ft.scale || 1.0;
      ctx.font = `bold ${Math.round(13 * s)}px monospace`;
      ctx.fillStyle = ft.color || '#5fff7a';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(ft.text, ft.x, ft.y);
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
    const h = 222;

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

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '10px monospace';
    const lineSpacing = 15;
    let textY = y + 108;

    ctx.fillText(`Pos: (${c.x.toFixed(0)}, ${c.y.toFixed(0)})`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`Vel: (${c.vx.toFixed(1)}, ${c.vy.toFixed(1)})`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`Speed: ${c.speed.toFixed(1)} u/s`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`Heading: ${c.headingDegrees.toFixed(1)}°`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`FPS: ${fps.toFixed(0)}  |  Ticks: ${world.ticks}`, x + 12, textY);
    textY += lineSpacing;
    ctx.fillText(`Zoom: ${(camera.zoom * 100).toFixed(0)}%  |  Score: ${c.biteScore}`, x + 12, textY);
    textY += lineSpacing;

    const overlays = [
      input.showGrid ? 'G:on' : 'G:off',
      input.showVelocityArrows ? 'V:on' : 'V:off',
      input.showHeadingLines ? 'H:on' : 'H:off',
      input.showBoundingCircles ? 'B:on' : 'B:off',
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
    const controlsText = '🤖 AI-controlled (RL training) | E:Regen Plants | R:New Generation | M:Menu';
    ctx.fillText(controlsText, cw - 16, bannerY + 17);

    ctx.restore();
  }
}
