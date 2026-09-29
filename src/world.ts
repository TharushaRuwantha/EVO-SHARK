import { CONFIG } from './config';
import { PRNG } from './rng';
import { Obstacle, generateObstacles } from './obstacle';
import {
  Plant,
  FloatingText,
  generateInitialPlants,
  regeneratePlants,
  spawnPlantBurst,
  updatePlantReproduction,
  updateFloatingTexts,
  createFloatingText,
  isValidPlantLocation,
} from './plant';
import { Creature, CreatureInput } from './creature';
import { MeatRemains, spawnFishRemains, updateMeatRemains } from './food';
import { ParticleSystem } from './particles';
import { sound } from './audio';
import { SpatialGrid } from './rl/spatialGrid';
import { SmellField } from './rl/smellField';

const IDLE_INPUT: CreatureInput = {
  thrustInput: 0,
  turnInput: 0,
  isBraking: false,
  wantsBite: false,
};

export class World {
  public seed: number;
  public rng: PRNG;
  public obstacles: Obstacle[] = [];
  public plants: Plant[] = [];
  public meatRemains: MeatRemains[] = [];
  public floatingTexts: FloatingText[] = [];
  public particles: ParticleSystem = new ParticleSystem();

  // Multi-creature ecosystem: 1 Shark and 20 Small Fish initially
  public sharks: Creature[] = [];
  public fishList: Creature[] = [];
  public controlledCreature: Creature;

  public ticks: number = 0;
  private plantTimer = { timer: 0 };

  // Shared per-tick sensor infrastructure: rebuilt/updated once per tick in
  // tickAI() and read by every creature's buildObservation() call next tick
  // (same one-tick-lag convention already used for position/velocity).
  public plantGrid: SpatialGrid<Plant> = new SpatialGrid(64);
  public creatureGrid: SpatialGrid<Creature> = new SpatialGrid(64);
  public smellField: SmellField = new SmellField();

  constructor(seed: number = CONFIG.world.seed) {
    this.seed = seed;
    this.rng = new PRNG(seed);

    // 1. Generate Obstacles
    this.obstacles = generateObstacles(this.rng);

    // 2. Generate Initial Plants
    this.plants = generateInitialPlants(this.rng, this.obstacles);

    // 3. Spawn Initial Sharks & Small Fish
    this.sharks = this.spawnInitialSharks();
    this.fishList = this.spawnInitialFish();

    // Default control to Shark initially
    this.controlledCreature = this.sharks[0];
    this.controlledCreature.isControlled = true;

    this.updatePlantCover();
    this.rebuildSensorGrids();
  }

  /**
   * Rebuilds the shared spatial grids and advances the scent fields. Called
   * once per tick (end of tickAI) so every creature's next sensor read sees
   * this tick's positions.
   */
  private rebuildSensorGrids(): void {
    this.plantGrid.build(this.plants);
    this.creatureGrid.build([...this.sharks, ...this.fishList].filter((c) => !c.isDead));
    this.smellField.update(this.aliveFish, this.aliveSharks, this.meatRemains);
  }

  private spawnInitialSharks(): Creature[] {
    const sharks: Creature[] = [];
    const count = CONFIG.species.shark.initialCount;
    for (let i = 0; i < count; i++) {
      const clusterCenterX = 500 + (i % 3) * 220 + this.rng.range(-60, 60);
      const clusterCenterY = 500 + Math.floor(i / 3) * 220 + this.rng.range(-60, 60);
      const sharkPos = this.findSafeSpawnPosition(clusterCenterX, clusterCenterY, CONFIG.species.shark.radius);
      const heading = this.rng.range(-Math.PI, Math.PI);
      sharks.push(new Creature('shark', sharkPos.x, sharkPos.y, heading));
    }
    return sharks;
  }

  private spawnInitialFish(): Creature[] {
    const fishList: Creature[] = [];
    const count = CONFIG.species.fish.initialCount;
    for (let i = 0; i < count; i++) {
      const clusterCenterX = 1100 + (i % 4) * 180 + this.rng.range(-60, 60);
      const clusterCenterY = 400 + Math.floor(i / 4) * 140 + this.rng.range(-50, 50);
      const fishPos = this.findSafeSpawnPosition(clusterCenterX, clusterCenterY, CONFIG.species.fish.radius);
      const heading = this.rng.range(-Math.PI, Math.PI);
      fishList.push(new Creature('fish', fishPos.x, fishPos.y, heading));
    }
    return fishList;
  }

  public get primaryShark(): Creature {
    return this.sharks[0] || this.controlledCreature;
  }

  public get aliveFish(): Creature[] {
    return this.fishList.filter((f) => !f.isDead);
  }

  public get aliveSharks(): Creature[] {
    return this.sharks.filter((s) => !s.isDead);
  }

  public get allAliveCreatures(): Creature[] {
    return [...this.aliveSharks, ...this.aliveFish];
  }

  public setControlledCreature(target: Creature, playSound: boolean = true): void {
    if (!target || target.isDead) return;

    if (this.controlledCreature) {
      this.controlledCreature.isControlled = false;
    }

    this.controlledCreature = target;
    this.controlledCreature.isControlled = true;
    if (playSound) sound.playSwitchCreature();
  }

  public setControlledByIndex(typeIndex: number): void {
    if (typeIndex === 0) {
      const shark = this.aliveSharks[0];
      if (shark) this.setControlledCreature(shark);
    } else {
      const fish = this.aliveFish[0];
      if (fish) this.setControlledCreature(fish);
    }
  }

  public switchControlledCreature(): void {
    const list = this.allAliveCreatures;
    if (list.length === 0) return;

    const currentIndex = list.indexOf(this.controlledCreature);
    const nextIndex = (currentIndex + 1) % list.length;
    this.setControlledCreature(list[nextIndex]);
  }

  public cycleSmallFish(): void {
    const fish = this.aliveFish;
    if (fish.length === 0) return;

    const currentIndex = fish.indexOf(this.controlledCreature);
    const nextIndex = (currentIndex + 1) % fish.length;
    this.setControlledCreature(fish[nextIndex]);
  }

  /**
   * Updates whether small fish are concealed underneath plant foliage
   */
  public updatePlantCover(): void {
    const coverR = CONFIG.plants.coverRadius;
    for (const fish of this.aliveFish) {
      let covered = false;
      for (const plant of this.plants) {
        const d = Math.hypot(fish.x - plant.x, fish.y - plant.y);
        if (d <= coverR) {
          covered = true;
          break;
        }
      }
      fish.isCoveredByPlants = covered;
    }
  }

  /**
   * Check if a biteable target is currently within biting range of the controlled creature.
   * If a small fish is hidden under plants, it is less visible and requires closer proximity.
   */
  public isTargetInBiteRange(actor: Creature = this.controlledCreature): boolean {
    const controlled = actor;
    if (!controlled || controlled.isDead) return false;
    const mouth = controlled.mouthPosition;

    if (controlled.type === 'shark') {
      // 1. Shark can bite any alive small fish (camouflage under plants conceals fish from predator)
      const hitbox = {
        x: mouth.x + Math.cos(controlled.heading) * CONFIG.species.shark.biteHitboxOffset,
        y: mouth.y + Math.sin(controlled.heading) * CONFIG.species.shark.biteHitboxOffset,
      };
      for (const fish of this.aliveFish) {
        const effectiveRadius = fish.isCoveredByPlants
          ? CONFIG.species.shark.biteHitboxRadius * 0.35 // Concealed under plant flora: shark must be right on top of fish
          : CONFIG.species.shark.biteHitboxRadius;

        const dist = Math.hypot(hitbox.x - fish.x, hitbox.y - fish.y);
        if (dist <= effectiveRadius + fish.radius) {
          return true;
        }
      }
      // 2. Shark can bite meat remains
      for (const meat of this.meatRemains) {
        const dist = Math.hypot(mouth.x - meat.x, mouth.y - meat.y);
        if (dist <= CONFIG.species.shark.biteRange + meat.radius) {
          return true;
        }
      }
      return false;
    } else {
      // Small Fish: must bite to eat plants OR meat remains
      for (const meat of this.meatRemains) {
        const dist = Math.hypot(mouth.x - meat.x, mouth.y - meat.y);
        if (dist <= CONFIG.species.fish.biteRange + meat.radius) {
          return true;
        }
      }
      for (const plant of this.plants) {
        const dist = Math.hypot(controlled.x - plant.x, controlled.y - plant.y);
        if (dist <= controlled.radius + plant.radius) {
          return true;
        }
      }
      return false;
    }
  }

  /**
   * Manual-mode convenience wrapper: bites with the currently spectated creature.
   */
  public performBite(): boolean {
    return this.attemptBite(this.controlledCreature);
  }

  /**
   * Executes a bite action for any given creature (used by both manual input and AI agents).
   */
  public attemptBite(actor: Creature): boolean {
    const controlled = actor;
    if (!controlled || controlled.isDead) return false;

    const canBite = controlled.triggerBite();
    if (!canBite) return false;

    const mouth = controlled.mouthPosition;
    const gainEnergy = () => {
      controlled.energy = Math.min(controlled.stats.energyMax, controlled.energy + controlled.stats.energyGainPerFood);
    };

    if (controlled.type === 'shark') {
      // Every bite attempt costs energy, hit or miss, to discourage spam.
      controlled.energy = Math.max(0, controlled.energy - controlled.stats.biteEnergyCost);
      if (controlled.energy <= 0) {
        this.killCreature(controlled, 'STARVATION');
        return false;
      }

      // 1. Try biting an alive Small Fish: hitbox is a circle offset in front
      // of the shark's mouth, not an instant kill — it takes several hits.
      const hitbox = {
        x: mouth.x + Math.cos(controlled.heading) * controlled.stats.biteHitboxOffset,
        y: mouth.y + Math.sin(controlled.heading) * controlled.stats.biteHitboxOffset,
      };

      let targetFish: Creature | null = null;
      let minFishDist = Infinity;

      for (const fish of this.aliveFish) {
        const effectiveRadius = fish.isCoveredByPlants
          ? controlled.stats.biteHitboxRadius * 0.35 // Concealed under flora: shark needs to be right on top of it!
          : controlled.stats.biteHitboxRadius;

        const dist = Math.hypot(hitbox.x - fish.x, hitbox.y - fish.y);
        if (dist <= effectiveRadius + fish.radius && dist < minFishDist) {
          minFishDist = dist;
          targetFish = fish;
        }
      }

      if (targetFish) {
        targetFish.health = Math.max(0, targetFish.health - controlled.stats.biteDamage);
        targetFish.recentDamageTicks = CONFIG.sensors.physiology.recentDamageTicks;
        this.particles.emitBiteImpact(mouth.x, mouth.y);
        sound.playBiteChomp();
        controlled.biteScore += 20;

        if (targetFish.health <= 0) {
          // Killing blow -> FISH DIES & SPAWNS MEAT REMAINS!
          const deadX = targetFish.x;
          const deadY = targetFish.y;
          this.killCreature(targetFish, 'EATEN');

          sound.playFishDeath();
          this.particles.emitBloodCloud(deadX, deadY);

          // Spawn 3 floating meat remains chunks
          const spawnedMeat = spawnFishRemains(deadX, deadY, 3);
          this.meatRemains.push(...spawnedMeat);

          controlled.biteScore += 100;
          controlled.foodEaten += 1;
          controlled.energy = Math.min(controlled.stats.energyMax, controlled.energy + controlled.stats.preyEnergyGain);
          createFloatingText(this.floatingTexts, deadX, deadY - 15, '+80', '#facc15', 1.4, 1.6);

          if (targetFish === this.controlledCreature) {
            const nextFish = this.aliveFish[0];
            this.setControlledCreature(nextFish || this.sharks[0], false);
          }

          this.checkCloning(controlled);
        } else {
          createFloatingText(
            this.floatingTexts,
            targetFish.x,
            targetFish.y - 10,
            `-${controlled.stats.biteDamage}`,
            '#f87171',
            0.8
          );
        }

        return true;
      }

      // 2. Try biting floating meat remains
      let nearestMeatIndex = -1;
      let minMeatDist = Infinity;
      for (let i = 0; i < this.meatRemains.length; i++) {
        const meat = this.meatRemains[i];
        const dist = Math.hypot(mouth.x - meat.x, mouth.y - meat.y);
        if (dist <= CONFIG.species.shark.biteRange + meat.radius && dist < minMeatDist) {
          minMeatDist = dist;
          nearestMeatIndex = i;
        }
      }

      if (nearestMeatIndex !== -1) {
        const meat = this.meatRemains[nearestMeatIndex];
        sound.playEatMeat();
        this.particles.emitMeatBite(meat.x, meat.y);
        createFloatingText(this.floatingTexts, meat.x, meat.y - 10, 'CHOMP MEAT! +50', '#fb7175', 1.3);
        this.meatRemains.splice(nearestMeatIndex, 1);
        controlled.biteScore += 50;
        controlled.foodEaten += 1;
        gainEnergy();

        this.checkCloning(controlled);
        return true;
      }

      // Empty water bite
      sound.playBiteChomp();
      this.particles.emitBubbles(mouth.x, mouth.y, 4, 'rgba(180, 220, 255, 0.6)');
      return false;
    } else {
      // Small Fish biting: eats meat remains or plants!
      let nearestMeatIndex = -1;
      let minMeatDist = Infinity;
      for (let i = 0; i < this.meatRemains.length; i++) {
        const meat = this.meatRemains[i];
        const dist = Math.hypot(mouth.x - meat.x, mouth.y - meat.y);
        if (dist <= CONFIG.species.fish.biteRange + meat.radius && dist < minMeatDist) {
          minMeatDist = dist;
          nearestMeatIndex = i;
        }
      }

      if (nearestMeatIndex !== -1) {
        const meat = this.meatRemains[nearestMeatIndex];
        sound.playEatMeat();
        this.particles.emitMeatBite(meat.x, meat.y);
        createFloatingText(this.floatingTexts, meat.x, meat.y - 10, 'SCAVENGE! +40', '#fb923c', 1.4);
        this.meatRemains.splice(nearestMeatIndex, 1);
        controlled.biteScore += 40;
        controlled.foodEaten += 1;
        gainEnergy();

        this.checkCloning(controlled);
        return true;
      }

      // Check plants: true circle-circle overlap between the fish's body and the plant
      let nearestPlantIndex = -1;
      let minPlantDist = Infinity;
      for (let i = 0; i < this.plants.length; i++) {
        const p = this.plants[i];
        const dist = Math.hypot(controlled.x - p.x, controlled.y - p.y);
        if (dist <= controlled.radius + p.radius && dist < minPlantDist) {
          minPlantDist = dist;
          nearestPlantIndex = i;
        }
      }

      if (nearestPlantIndex !== -1) {
        const plant = this.plants[nearestPlantIndex];
        sound.playPlantNibble();
        this.particles.emitPlantSpores(plant.x, plant.y);
        createFloatingText(this.floatingTexts, plant.x, plant.y - 10, '+25', '#5fff7a', 1.0);
        this.plants.splice(nearestPlantIndex, 1);
        controlled.biteScore += 25;
        controlled.foodEaten += 1;
        controlled.energy = Math.min(controlled.stats.energyMax, controlled.energy + controlled.stats.plantEnergyGain);

        this.checkCloning(controlled);
        return true;
      }

      sound.playPlantNibble();
      this.particles.emitBubbles(mouth.x, mouth.y, 3, 'rgba(160, 240, 255, 0.6)');
      return false;
    }
  }

  /**
   * Checks if creature has eaten enough to reproduce / clone!
   */
  private checkCloning(parent: Creature): void {
    if (parent.foodEaten >= parent.foodToClone) {
      parent.foodEaten = 0;
      parent.cloneCount++;

      const spawnAngle = Math.random() * Math.PI * 2;
      const dist = parent.radius * 2.8;
      const cx = parent.x + Math.cos(spawnAngle) * dist;
      const cy = parent.y + Math.sin(spawnAngle) * dist;

      const safePos = this.findSafeSpawnPosition(cx, cy, parent.radius);
      const child = new Creature(parent.type, safePos.x, safePos.y, spawnAngle);

      if (parent.type === 'shark') {
        this.sharks.push(child);
        this.particles.emitReproductionSparks(safePos.x, safePos.y, true);
        sound.playClone();
        createFloatingText(
          this.floatingTexts,
          safePos.x,
          safePos.y - 20,
          '🦈 BABY SHARK BORN! (+1 CLONE)',
          '#38bdf8',
          2.0,
          1.2
        );
      } else {
        this.fishList.push(child);
        this.particles.emitReproductionSparks(safePos.x, safePos.y, false);
        sound.playClone();
        createFloatingText(
          this.floatingTexts,
          safePos.x,
          safePos.y - 15,
          '✨ SISTER FISH BORN! (+1 CLONE)',
          '#facc15',
          2.0,
          1.2
        );
      }
    }
  }

  public triggerRegeneratePlants(count: number = CONFIG.plants.initial): void {
    this.plants = regeneratePlants(this.rng, this.obstacles, count);
    this.plantTimer.timer = 0;
    sound.playRegenerate();

    const center = this.controlledCreature;
    createFloatingText(
      this.floatingTexts,
      center.x,
      center.y - 40,
      `🌱 ${this.plants.length} PLANTS REGENERATED!`,
      '#4ade80',
      2.0
    );

    for (let i = 0; i < 6; i++) {
      if (this.plants[i]) {
        this.particles.emitPlantSpores(this.plants[i].x, this.plants[i].y);
      }
    }

    this.updatePlantCover();
  }

  public triggerPlantBurst(count: number = 30): number {
    const added = spawnPlantBurst(this.plants, this.obstacles, this.rng, count);
    sound.playRegenerate();
    const center = this.controlledCreature;
    createFloatingText(
      this.floatingTexts,
      center.x,
      center.y - 30,
      `✨ +${added} NEW PLANTS SPROUTED!`,
      '#86efac',
      1.8
    );
    this.updatePlantCover();
    return added;
  }

  public clearAllPlants(): void {
    this.plants = [];
    createFloatingText(
      this.floatingTexts,
      this.controlledCreature.x,
      this.controlledCreature.y - 30,
      '🧹 PLANTS CLEARED',
      '#94a3b8',
      1.5
    );
    this.updatePlantCover();
  }

  public reset(newSeed?: number): void {
    const s = newSeed !== undefined ? newSeed : Math.floor(Math.random() * 1000000);
    this.seed = s;
    this.rng.reseed(s);
    this.ticks = 0;
    this.plantTimer.timer = 0;
    this.floatingTexts = [];
    this.meatRemains = [];
    this.particles = new ParticleSystem();

    this.obstacles = generateObstacles(this.rng);
    this.plants = generateInitialPlants(this.rng, this.obstacles);

    this.sharks = this.spawnInitialSharks();
    this.fishList = this.spawnInitialFish();

    this.controlledCreature = this.sharks[0];
    this.controlledCreature.isControlled = true;

    this.updatePlantCover();
    this.smellField.reset();
    this.rebuildSensorGrids();
  }

  public findSafeSpawnPosition(prefX: number, prefY: number, radius: number): { x: number; y: number } {
    if (isValidPlantLocation(prefX, prefY, this.obstacles)) {
      return { x: prefX, y: prefY };
    }

    const pad = CONFIG.world.wallThickness + 100;
    for (let i = 0; i < 200; i++) {
      const rx = this.rng.range(pad, CONFIG.world.width - pad);
      const ry = this.rng.range(pad, CONFIG.world.height - pad);
      if (isValidPlantLocation(rx, ry, this.obstacles)) {
        return { x: rx, y: ry };
      }
    }

    return { x: CONFIG.world.width / 2, y: CONFIG.world.height / 2 };
  }

  public get isSharkExtinct(): boolean {
    return this.aliveSharks.length === 0;
  }

  public get isFishExtinct(): boolean {
    return this.aliveFish.length === 0;
  }

  /**
   * Marks a creature dead with a cause (STARVATION or EATEN), logs it, and
   * starts its 30-tick fade-and-shrink death animation. The creature is only
   * actually removed from the world once that animation finishes (see
   * tickAI). There is no aging — these are the only two ways to die.
   */
  private killCreature(creature: Creature, cause: 'STARVATION' | 'EATEN'): void {
    if (creature.isDead) return;
    creature.isDead = true;
    creature.deathCause = cause;
    creature.deathFadeTicks = 0;
    // eslint-disable-next-line no-console
    console.log(
      `[DEATH] ${creature.type} #${creature.id} died of ${cause} at tick ${this.ticks}, pos=(${creature.x.toFixed(0)}, ${creature.y.toFixed(0)})`
    );
  }

  /**
   * Applies energy drain each tick: a flat idle cost plus an extra cost that
   * scales with thrust input. Energy reaching 0 starves the creature.
   */
  private applyEnergyDrain(creature: Creature, input: CreatureInput): void {
    if (creature.isDead) return;
    const thrust = Math.max(0, Math.min(1, input.thrustInput));
    const drain = creature.stats.idleDrain + (thrust > 0 ? creature.stats.thrustDrain * thrust : 0);
    creature.energy = Math.max(0, Math.min(creature.stats.energyMax, creature.energy - drain));
    if (creature.energy <= 0) {
      this.killCreature(creature, 'STARVATION');
    }
  }

  /**
   * A well-fed creature (energy fraction above its species' threshold) slowly
   * regenerates health each tick. A starving creature never heals.
   */
  private applyRegeneration(creature: Creature): void {
    if (creature.isDead) return;
    if (creature.energyFraction > creature.stats.regenEnergyThreshold) {
      creature.health = Math.min(creature.stats.maxHealth, creature.health + creature.stats.regenRate);
    }
  }

  /**
   * Multi-agent physics tick (60 Hz, dt = 1/60). Every alive shark and fish
   * moves according to the CreatureInput supplied for it (from an AI agent,
   * or IDLE_INPUT if none was supplied), and may attempt a bite. Creatures
   * that died fade out over 30 ticks before being removed from the world.
   */
  public tickAI(inputs: Map<number, CreatureInput>): void {
    const dt = 1 / CONFIG.tick.hz;
    this.ticks++;

    for (const shark of this.sharks) {
      if (shark.isDead) {
        shark.deathFadeTicks++;
        continue;
      }
      const input = inputs.get(shark.id) || IDLE_INPUT;
      shark.tick(input, this.obstacles, dt);
      if (input.wantsBite) this.attemptBite(shark);
      this.applyEnergyDrain(shark, input);
      this.applyRegeneration(shark);
    }

    for (const fish of this.fishList) {
      if (fish.isDead) {
        fish.deathFadeTicks++;
        continue;
      }
      const input = inputs.get(fish.id) || IDLE_INPUT;
      fish.tick(input, this.obstacles, dt);
      if (input.wantsBite) this.attemptBite(fish);
      this.applyEnergyDrain(fish, input);
      this.applyRegeneration(fish);
    }

    // Drop creatures whose death-fade animation has finished
    this.sharks = this.sharks.filter((s) => !s.isDead || s.deathFadeTicks < 30);
    this.fishList = this.fishList.filter((f) => !f.isDead || f.deathFadeTicks < 30);

    // Keep the spectated creature valid (camera/HUD) if it just died
    if (!this.controlledCreature || this.controlledCreature.isDead) {
      const fallback = this.aliveSharks[0] || this.aliveFish[0];
      if (fallback) this.setControlledCreature(fallback, false);
    }

    this.updatePlantCover();
    updateMeatRemains(this.meatRemains, dt);
    updateFloatingTexts(this.floatingTexts, dt);
    this.particles.update(dt);
    updatePlantReproduction(this.plants, this.obstacles, this.rng, dt, this.plantTimer);

    this.rebuildSensorGrids();
  }
}
