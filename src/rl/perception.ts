import { CONFIG } from '../config';
import { Creature } from '../creature';
import { World } from '../world';

export const OBS_SIZE = 16;

const MAX_SENSE_DIST = 600; // units; beyond this, distance reads as "not visible" (1.0)

function relativeAngleParts(dx: number, dy: number, heading: number): { sin: number; cos: number } {
  const angleToTarget = Math.atan2(dy, dx);
  const rel = angleToTarget - heading;
  return { sin: Math.sin(rel), cos: Math.cos(rel) };
}

/**
 * Builds a fixed-size, normalized observation vector for a creature so a
 * single shared policy network can be used across every instance of a
 * species. Distances are relative to the creature's mouth so "in range"
 * roughly lines up with when a bite would actually connect.
 */
export function buildObservation(self: Creature, world: World): number[] {
  const mouth = self.mouthPosition;
  const maxSpeed = self.stats.maxSpeed;

  const obs = new Array<number>(OBS_SIZE).fill(0);

  obs[0] = self.vx / maxSpeed;
  obs[1] = self.vy / maxSpeed;
  obs[2] = Math.sin(self.heading);
  obs[3] = Math.cos(self.heading);
  obs[4] = self.energy / self.stats.energyMax;
  obs[5] = self.cloneProgressRatio;

  // --- Nearest food target ---
  let bestFoodDist = Infinity;
  let bestFoodDx = 0;
  let bestFoodDy = 0;

  if (self.type === 'shark') {
    for (const fish of world.aliveFish) {
      const d = Math.hypot(fish.x - mouth.x, fish.y - mouth.y);
      if (d < bestFoodDist) {
        bestFoodDist = d;
        bestFoodDx = fish.x - mouth.x;
        bestFoodDy = fish.y - mouth.y;
      }
    }
  } else {
    for (const plant of world.plants) {
      const d = Math.hypot(plant.x - mouth.x, plant.y - mouth.y);
      if (d < bestFoodDist) {
        bestFoodDist = d;
        bestFoodDx = plant.x - mouth.x;
        bestFoodDy = plant.y - mouth.y;
      }
    }
  }
  for (const meat of world.meatRemains) {
    const d = Math.hypot(meat.x - mouth.x, meat.y - mouth.y);
    if (d < bestFoodDist) {
      bestFoodDist = d;
      bestFoodDx = meat.x - mouth.x;
      bestFoodDy = meat.y - mouth.y;
    }
  }

  if (bestFoodDist === Infinity) {
    obs[6] = 1;
    obs[7] = 0;
    obs[8] = 0;
  } else {
    obs[6] = Math.min(1, bestFoodDist / MAX_SENSE_DIST);
    const { sin, cos } = relativeAngleParts(bestFoodDx, bestFoodDy, self.heading);
    obs[7] = sin;
    obs[8] = cos;
  }

  // --- Nearest threat (fish only; sharks have none) ---
  if (self.type === 'fish') {
    let bestThreatDist = Infinity;
    let bestDx = 0;
    let bestDy = 0;
    for (const shark of world.aliveSharks) {
      const d = Math.hypot(shark.x - mouth.x, shark.y - mouth.y);
      if (d < bestThreatDist) {
        bestThreatDist = d;
        bestDx = shark.x - mouth.x;
        bestDy = shark.y - mouth.y;
      }
    }
    if (bestThreatDist === Infinity) {
      obs[9] = 1;
    } else {
      obs[9] = Math.min(1, bestThreatDist / MAX_SENSE_DIST);
      const { sin, cos } = relativeAngleParts(bestDx, bestDy, self.heading);
      obs[10] = sin;
      obs[11] = cos;
    }
  } else {
    obs[9] = 1;
  }

  // --- Nearest obstacle ---
  let bestObsDist = Infinity;
  let bestObsDx = 0;
  let bestObsDy = 0;
  for (const obstacle of world.obstacles) {
    const d = Math.hypot(obstacle.x - mouth.x, obstacle.y - mouth.y) - obstacle.boundingRadius;
    if (d < bestObsDist) {
      bestObsDist = d;
      bestObsDx = obstacle.x - mouth.x;
      bestObsDy = obstacle.y - mouth.y;
    }
  }
  if (bestObsDist === Infinity) {
    obs[12] = 1;
  } else {
    obs[12] = Math.max(0, Math.min(1, bestObsDist / MAX_SENSE_DIST));
    const { sin, cos } = relativeAngleParts(bestObsDx, bestObsDy, self.heading);
    obs[13] = sin;
    obs[14] = cos;
  }

  // --- Nearest wall ---
  const wallThickness = CONFIG.world.wallThickness;
  const distLeft = self.x - wallThickness;
  const distRight = CONFIG.world.width - wallThickness - self.x;
  const distTop = self.y - wallThickness;
  const distBottom = CONFIG.world.height - wallThickness - self.y;
  const minWallDist = Math.min(distLeft, distRight, distTop, distBottom);
  obs[15] = Math.max(0, Math.min(1, minWallDist / MAX_SENSE_DIST));

  return obs;
}
