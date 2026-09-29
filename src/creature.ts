import { CONFIG, SpeciesStats, SpeciesType } from './config';
import { Obstacle, resolveCreatureObstacleCollision } from './obstacle';

export interface CreatureInput {
  thrustInput: number; // [0, 1]
  turnInput: number;   // [-1, 1]
  isBraking: boolean;  // Space key
  wantsBite?: boolean; // Space key triggers bite
}

let nextCreatureId = 1;

export class Creature {
  public id: number;
  public type: SpeciesType;
  public stats: SpeciesStats;
  public x: number;
  public y: number;
  public vx: number = 0;
  public vy: number = 0;
  public heading: number; // Radians, 0 = pointing right along +X
  public isControlled: boolean = false;
  public isDead: boolean = false;
  public isCoveredByPlants: boolean = false; // Concealed under plant foliage

  // Energy & Cloning
  public foodEaten: number = 0;
  public foodToClone: number;
  public cloneCount: number = 0;
  public energy: number;

  // Health & death
  public health: number;
  public deathCause: 'STARVATION' | 'EATEN' | null = null;
  public deathFadeTicks: number = 0; // ticks since death; fade/shrink completes at 30

  // Bite mechanics & animation
  public biteCooldownTimer: number = 0; // ticks remaining until next bite/eat allowed
  public biteAnimationProgress: number = 0; // 0 to 1
  public isBiting: boolean = false;
  public mouthFlashTicks: number = 0; // ticks remaining on the mouth-flash / jaw animation
  public recentDamageTicks: number = 0; // ticks remaining on the "just got bitten" red flash
  public biteScore: number = 0;

  constructor(type: SpeciesType, x: number, y: number, heading: number = 0) {
    this.id = nextCreatureId++;
    this.type = type;
    this.stats = CONFIG.species[type];
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.foodToClone = this.stats.foodToClone;
    this.energy = this.stats.energyMax;
    this.health = this.stats.maxHealth;
  }

  // --- Physiology, computed every tick (see World.tickAI) ---
  get energyFraction(): number {
    return this.energy / this.stats.energyMax;
  }

  get healthFraction(): number {
    return this.health / this.stats.maxHealth;
  }

  get hungerSignal(): number {
    return 1 - this.energyFraction;
  }

  get biteCooldownFraction(): number {
    return this.biteCooldownTimer / this.stats.biteCooldownTicks;
  }

  get recentDamage(): number {
    return this.recentDamageTicks > 0 ? 1 : 0;
  }

  get radius(): number {
    return this.stats.radius;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  get headingDegrees(): number {
    let deg = (this.heading * 180) / Math.PI;
    deg = ((deg % 360) + 360) % 360;
    return deg;
  }

  get cloneProgressRatio(): number {
    return Math.min(1, this.foodEaten / this.foodToClone);
  }

  /**
   * World coordinates of mouth / jaws
   */
  get mouthPosition(): { x: number; y: number } {
    const forwardOffset = this.type === 'shark' ? 22 : 12;
    return {
      x: this.x + Math.cos(this.heading) * forwardOffset,
      y: this.y + Math.sin(this.heading) * forwardOffset,
    };
  }

  /**
   * Triggers a bite action if cooldown allows
   */
  public triggerBite(): boolean {
    if (this.biteCooldownTimer <= 0) {
      this.biteCooldownTimer = this.stats.biteCooldownTicks;
      this.mouthFlashTicks = 6;
      this.biteAnimationProgress = 0.01;
      this.isBiting = true;
      return true;
    }
    return false;
  }

  /**
   * Physics step for fixed timestep dt (1/60s).
   * Note: Creatures only move when input is applied; otherwise they coast to a stop via drag.
   */
  public tick(input: CreatureInput, obstacles: Obstacle[], dt: number): void {
    if (this.isDead) return;

    const { maxTurnRate, maxThrust, maxSpeed, drag } = this.stats;

    // Advance bite cooldown, mouth-flash and damage-flash timers (all tick-based,
    // one tick per call since tick() runs once per fixed 60Hz physics step).
    // The actual bite/eat attempt itself is triggered by World.attemptBite(),
    // which calls triggerBite() when input.wantsBite fires.
    if (this.biteCooldownTimer > 0) {
      this.biteCooldownTimer--;
    }
    if (this.mouthFlashTicks > 0) {
      this.mouthFlashTicks--;
      this.biteAnimationProgress = 1 - this.mouthFlashTicks / 6;
      if (this.mouthFlashTicks === 0) {
        this.isBiting = false;
        this.biteAnimationProgress = 0;
      }
    }
    if (this.recentDamageTicks > 0) {
      this.recentDamageTicks--;
    }

    // 1. heading += turnInput * maxTurnRate * dt (only turns when key pressed)
    if (input.turnInput !== 0) {
      this.heading += input.turnInput * maxTurnRate * dt;
      this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
    }

    // 2. vx += cos(heading) * thrustInput * maxThrust * dt
    // 3. vy += sin(heading) * thrustInput * maxThrust * dt
    const clampedThrust = Math.max(0, Math.min(1, input.thrustInput));
    if (clampedThrust > 0) {
      this.vx += Math.cos(this.heading) * clampedThrust * maxThrust * dt;
      this.vy += Math.sin(this.heading) * clampedThrust * maxThrust * dt;
    }

    // 4. vx *= drag; vy *= drag (coasts to a complete stop when key is released)
    const effectiveDrag = input.isBraking ? drag * drag : drag;
    this.vx *= effectiveDrag;
    this.vy *= effectiveDrag;

    // Stop microscopic floating point drift so motionless creatures stay truly still
    if (Math.abs(this.vx) < 0.01) this.vx = 0;
    if (Math.abs(this.vy) < 0.01) this.vy = 0;

    // 5. clamp velocity magnitude to maxSpeed
    const currentSpeed = Math.hypot(this.vx, this.vy);
    if (currentSpeed > maxSpeed) {
      const scale = maxSpeed / currentSpeed;
      this.vx *= scale;
      this.vy *= scale;
    }

    // 6. x += vx * dt; y += vy * dt (only changes if velocity > 0)
    if (this.vx !== 0 || this.vy !== 0) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // 7. resolve wall collision (slide)
      this.resolveWallCollisions();

      // 8. resolve obstacle collision (slide) - 2 passes for acute angles/corners
      for (let pass = 0; pass < 2; pass++) {
        for (const obstacle of obstacles) {
          resolveCreatureObstacleCollision(this, obstacle);
        }
        this.resolveWallCollisions();
      }
    }
  }

  /**
   * Keep creature within solid walls (20 units thick) with slide physics.
   */
  private resolveWallCollisions(): void {
    const wallThickness = CONFIG.world.wallThickness;
    const r = this.radius;

    const minX = wallThickness + r;
    const maxX = CONFIG.world.width - wallThickness - r;
    const minY = wallThickness + r;
    const maxY = CONFIG.world.height - wallThickness - r;

    if (this.x < minX) {
      this.x = minX;
      if (this.vx < 0) this.vx = 0; // Slide along Y
    } else if (this.x > maxX) {
      this.x = maxX;
      if (this.vx > 0) this.vx = 0; // Slide along Y
    }

    if (this.y < minY) {
      this.y = minY;
      if (this.vy < 0) this.vy = 0; // Slide along X
    } else if (this.y > maxY) {
      this.y = maxY;
      if (this.vy > 0) this.vy = 0; // Slide along X
    }
  }
}
