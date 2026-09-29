import { CONFIG } from './config';
import { PRNG } from './rng';
import { Obstacle } from './obstacle';

export type PlantType = 'kelp' | 'anemone' | 'sporeFern';

export interface Plant {
  id: number;
  x: number;
  y: number;
  radius: number;
  pulsePhase: number;
  height: number;
  stemSwayPhase: number;
  swaySpeed: number;
  frondCount: number;
  plantType: PlantType;
  colorTone: string;
  glowColor: string;
}

export interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  age: number;      // Seconds lived
  maxAge: number;   // Duration in seconds (e.g., 1.2s)
  color?: string;
  scale?: number;
}

let nextPlantId = 1;
let nextFloatingTextId = 1;

const PLANT_TYPES: PlantType[] = ['kelp', 'anemone', 'sporeFern'];
const PLANT_PALETTES = [
  { tone: '#10b981', glow: '#5fff7a' }, // Emerald neon
  { tone: '#06b6d4', glow: '#00f5d4' }, // Aquamarine cyan
  { tone: '#14b8a6', glow: '#2dd4bf' }, // Teal
  { tone: '#84cc16', glow: '#a3e635' }, // Lime bioluminescent
];

/**
 * Creates a single rich plant instance
 */
export function createPlantInstance(
  x: number,
  y: number,
  rng: PRNG
): Plant {
  const palette = PLANT_PALETTES[Math.floor(rng.range(0, PLANT_PALETTES.length))];
  const typeIndex = Math.floor(rng.range(0, PLANT_TYPES.length));

  return {
    id: nextPlantId++,
    x,
    y,
    radius: CONFIG.plants.radius,
    pulsePhase: rng.range(0, Math.PI * 2),
    height: rng.range(16, 28),
    stemSwayPhase: rng.range(0, Math.PI * 2),
    swaySpeed: rng.range(1.2, 2.0),
    frondCount: rng.rangeInt(3, 5),
    plantType: PLANT_TYPES[typeIndex],
    colorTone: palette.tone,
    glowColor: palette.glow,
  };
}

/**
 * Checks if a candidate plant position (x, y) is valid:
 * Not inside walls and not within obstacleMargin of any obstacle.
 *
 * Note: this is also reused by World.findSafeSpawnPosition for creature
 * spawn placement, so it deliberately does NOT check plant-to-plant
 * spacing — see isFarEnoughFromPlants for that, applied only by the plant
 * spawning functions below.
 */
export function isValidPlantLocation(x: number, y: number, obstacles: Obstacle[]): boolean {
  const wallPad = CONFIG.plants.wallMargin + CONFIG.world.wallThickness;
  if (
    x < wallPad ||
    x > CONFIG.world.width - wallPad ||
    y < wallPad ||
    y > CONFIG.world.height - wallPad
  ) {
    return false;
  }

  const margin = CONFIG.plants.obstacleMargin;
  for (const obs of obstacles) {
    const dist = Math.hypot(x - obs.x, y - obs.y);
    if (dist < obs.boundingRadius + margin + CONFIG.plants.radius) {
      return false;
    }
  }

  return true;
}

/** Whether (x, y) is at least CONFIG.plants.minSpacing away from every existing plant. */
function isFarEnoughFromPlants(x: number, y: number, plants: Plant[]): boolean {
  const minSpacing = CONFIG.plants.minSpacing;
  for (const p of plants) {
    if (Math.hypot(x - p.x, y - p.y) < minSpacing) return false;
  }
  return true;
}

/**
 * Initialize or regenerate starting plants deterministically or randomly.
 */
export function generateInitialPlants(
  rng: PRNG,
  obstacles: Obstacle[],
  targetCount: number = CONFIG.plants.initial
): Plant[] {
  const plants: Plant[] = [];
  let attempts = 0;
  const maxAttempts = targetCount * 50;

  while (plants.length < targetCount && attempts < maxAttempts) {
    attempts++;
    const pad = CONFIG.plants.wallMargin + CONFIG.world.wallThickness;
    const x = rng.range(pad, CONFIG.world.width - pad);
    const y = rng.range(pad, CONFIG.world.height - pad);

    if (isValidPlantLocation(x, y, obstacles) && isFarEnoughFromPlants(x, y, plants)) {
      plants.push(createPlantInstance(x, y, rng));
    }
  }

  return plants;
}

/**
 * Completely regenerates the plants in the world.
 */
export function regeneratePlants(
  rng: PRNG,
  obstacles: Obstacle[],
  count: number = CONFIG.plants.initial
): Plant[] {
  return generateInitialPlants(rng, obstacles, count);
}

/**
 * Spawns an immediate burst of daughter plants around existing plants.
 */
export function spawnPlantBurst(
  plants: Plant[],
  obstacles: Obstacle[],
  rng: PRNG,
  count: number = 30
): number {
  let spawned = 0;
  const target = Math.min(count, CONFIG.plants.cap - plants.length);
  if (target <= 0) return 0;

  for (let i = 0; i < target; i++) {
    let placed = false;
    if (plants.length > 0) {
      const parent = plants[Math.floor(rng.range(0, plants.length))];
      for (let attempt = 0; attempt < 20; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        const dist = rng.range(20, 80);
        const nx = parent.x + Math.cos(angle) * dist;
        const ny = parent.y + Math.sin(angle) * dist;
        if (isValidPlantLocation(nx, ny, obstacles) && isFarEnoughFromPlants(nx, ny, plants)) {
          plants.push(createPlantInstance(nx, ny, rng));
          spawned++;
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      const pad = CONFIG.plants.wallMargin + CONFIG.world.wallThickness;
      for (let attempt = 0; attempt < 15; attempt++) {
        const rx = rng.range(pad, CONFIG.world.width - pad);
        const ry = rng.range(pad, CONFIG.world.height - pad);
        if (isValidPlantLocation(rx, ry, obstacles) && isFarEnoughFromPlants(rx, ry, plants)) {
          plants.push(createPlantInstance(rx, ry, rng));
          spawned++;
          break;
        }
      }
    }
  }

  return spawned;
}

/**
 * Attempts to place one new plant: near a random existing parent first (like
 * natural vegetative spread), falling back to open water. Respects the same
 * spacing rules as every other plant-placement path.
 */
function spawnOnePlant(plants: Plant[], obstacles: Obstacle[], rng: PRNG): boolean {
  if (plants.length > 0) {
    const parent = plants[Math.floor(rng.range(0, plants.length))];
    for (let attempt = 0; attempt < 15; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const dist = rng.range(25, 75);
      const nx = parent.x + Math.cos(angle) * dist;
      const ny = parent.y + Math.sin(angle) * dist;
      if (isValidPlantLocation(nx, ny, obstacles) && isFarEnoughFromPlants(nx, ny, plants)) {
        plants.push(createPlantInstance(nx, ny, rng));
        return true;
      }
    }
  }

  const pad = CONFIG.plants.wallMargin + CONFIG.world.wallThickness;
  for (let attempt = 0; attempt < 15; attempt++) {
    const rx = rng.range(pad, CONFIG.world.width - pad);
    const ry = rng.range(pad, CONFIG.world.height - pad);
    if (isValidPlantLocation(rx, ry, obstacles) && isFarEnoughFromPlants(rx, ry, plants)) {
      plants.push(createPlantInstance(rx, ry, rng));
      return true;
    }
  }

  return false;
}

/**
 * Logistic-growth plant regrowth: growthPerSecond = r * P * (1 - P / K),
 * plus a small constant seeding term while below K so the population can
 * always recover from near-zero, not just decelerate as it approaches
 * capacity. Fractional growth accumulates in `state.spawnAccumulator`
 * until it reaches a whole plant. Growth is zero at or above K.
 */
export function updatePlantReproduction(
  plants: Plant[],
  obstacles: Obstacle[],
  rng: PRNG,
  dt: number,
  state: { spawnAccumulator: number },
): void {
  const { K, r, seedRatePerSec } = CONFIG.plants.growth;
  const currentCount = plants.length;

  if (currentCount >= K) return;

  const logisticGrowth = r * currentCount * (1 - currentCount / K);
  const growthPerSecond = Math.max(0, logisticGrowth) + seedRatePerSec;
  state.spawnAccumulator += growthPerSecond * dt;

  while (state.spawnAccumulator >= 1 && plants.length < K) {
    state.spawnAccumulator -= 1;
    spawnOnePlant(plants, obstacles, rng);
  }
}

/**
 * Update active floating text elements.
 */
export function updateFloatingTexts(floatingTexts: FloatingText[], dt: number): void {
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.age += dt;
    ft.y -= 25 * dt; // Float up
    if (ft.age >= ft.maxAge) {
      floatingTexts.splice(i, 1);
    }
  }
}

export function createFloatingText(
  floatingTexts: FloatingText[],
  x: number,
  y: number,
  text: string,
  color: string = '#5fff7a',
  maxAge: number = 1.2,
  scale: number = 1.0
): void {
  floatingTexts.push({
    id: nextFloatingTextId++,
    x,
    y,
    text,
    age: 0,
    maxAge,
    color,
    scale,
  });
}
