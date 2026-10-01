import { CONFIG } from '../config';
import { Creature } from '../creature';
import { World } from '../world';
import { HIT_TYPES, HitType, VISION_VALUES_PER_RAY, applyNoisePct } from './sensorLayout';

interface RayHit {
  distance: number;
  hitType: HitType;
}

/**
 * Ray-vs-circle intersection. Returns the distance from `originX,originY`
 * along the unit direction `(dx, dy)` to the nearest point on the circle,
 * or null if the ray (in its positive direction) never touches it. If the
 * origin is already inside the circle, returns 0 (touching).
 */
function rayCircleDistance(
  originX: number,
  originY: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  radius: number
): number | null {
  const ox = cx - originX;
  const oy = cy - originY;
  const tca = ox * dx + oy * dy;
  const d2 = ox * ox + oy * oy;
  const r2 = radius * radius;

  if (tca < 0 && d2 > r2) return null; // behind the ray and not overlapping the origin

  const closest2 = d2 - tca * tca;
  if (closest2 > r2) return null; // ray line misses the circle entirely

  const thc = Math.sqrt(Math.max(0, r2 - closest2));
  const t0 = tca - thc;
  return Math.max(0, t0);
}

/** Distance from (originX, originY) to where the ray exits the playable arena box. */
function rayWallDistance(originX: number, originY: number, dx: number, dy: number): number {
  const t = CONFIG.world.wallThickness;
  const minX = t;
  const maxX = CONFIG.world.width - t;
  const minY = t;
  const maxY = CONFIG.world.height - t;

  let tx = Infinity;
  if (dx > 1e-9) tx = (maxX - originX) / dx;
  else if (dx < -1e-9) tx = (minX - originX) / dx;

  let ty = Infinity;
  if (dy > 1e-9) ty = (maxY - originY) / dy;
  else if (dy < -1e-9) ty = (minY - originY) / dy;

  return Math.max(0, Math.min(tx, ty));
}

/**
 * Casts one species' full ray fan from `self` and writes [distance, one-hot
 * hit type] per ray into `out` starting at `outOffset`. Also returns the
 * per-ray hit info (world-space), purely so the debug overlay can redraw
 * the exact same rays without recomputing them.
 */
export function computeVision(self: Creature, world: World, out: Float32Array, outOffset: number): RayHit[] {
  const cfg = CONFIG.sensors.vision[self.type];
  const { rayCount, range, distanceNoisePct } = cfg;
  const fovRad = (cfg.fovDeg * Math.PI) / 180;
  const jitterRad = (cfg.angularJitterDeg * Math.PI) / 180;

  const originX = self.x;
  const originY = self.y;

  // Gather candidates once per creature (not per ray): everything within
  // vision range, via the shared per-tick spatial grids for plants and
  // creatures, plus a brute-force scan of obstacles (a couple dozen at
  // most) and meat remains (usually few).
  const nearbyPlants = world.plantGrid.queryRadius(originX, originY, range);
  const nearbyCreatures = world.creatureGrid.queryRadius(originX, originY, range);

  const hits: RayHit[] = new Array(rayCount);

  for (let i = 0; i < rayCount; i++) {
    const spread = rayCount > 1 ? (i / (rayCount - 1) - 0.5) * fovRad : 0;
    const jitter = (Math.random() * 2 - 1) * jitterRad;
    const angle = self.heading + spread + jitter;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let bestDist = rayWallDistance(originX, originY, dx, dy);
    let bestType: HitType = 'wall';

    for (const obs of world.obstacles) {
      const d = rayCircleDistance(originX, originY, dx, dy, obs.x, obs.y, obs.boundingRadius);
      if (d !== null && d < bestDist) {
        bestDist = d;
        bestType = 'wall'; // no dedicated "obstacle" channel; solid terrain reads as wall
      }
    }

    for (const plant of nearbyPlants) {
      const d = rayCircleDistance(originX, originY, dx, dy, plant.x, plant.y, plant.radius);
      if (d !== null && d < bestDist) {
        bestDist = d;
        bestType = 'plant';
      }
    }

    for (const meat of world.meatRemains) {
      const d = rayCircleDistance(originX, originY, dx, dy, meat.x, meat.y, meat.radius);
      if (d !== null && d < bestDist) {
        bestDist = d;
        bestType = 'prey'; // meat is sensed as prey, per design decision
      }
    }

    for (const other of nearbyCreatures) {
      if (other === self || other.isDead) continue;
      const d = rayCircleDistance(originX, originY, dx, dy, other.x, other.y, other.radius);
      if (d !== null && d < bestDist) {
        bestDist = d;
        // Same-species creatures aren't prey or predator to each other;
        // they just read as generic solid obstruction, same as terrain.
        bestType = other.type === self.type ? 'wall' : other.type === 'fish' ? 'prey' : 'predator';
      }
    }

    // A living creature is harder to positively identify from a distance
    // than static terrain/plants: a shape near the edge of vision range
    // isn't confidently "that's a predator" yet, the way it would be once
    // it's close. Within an inner confident-ID radius the read is always
    // reliable; beyond it, identification confidence fades linearly to 0 at
    // max range, and an unconfident read comes back as 'empty' (something
    // is sensed -- the distance channel still reports it truthfully -- just
    // not positively identified) rather than a guaranteed species label.
    if ((bestType === 'prey' || bestType === 'predator') && bestDist < range) {
      const confidentRadius = range * CONFIG.sensors.vision.idConfidentRangePct;
      if (bestDist > confidentRadius) {
        const uncertainty = (bestDist - confidentRadius) / (range - confidentRadius);
        if (Math.random() < uncertainty) {
          bestType = 'empty';
        }
      }
    }

    let finalType: HitType = bestType;
    let finalDist = bestDist;
    if (bestDist >= range) {
      finalDist = range;
      finalType = 'empty';
    }

    const noisyDist = applyNoisePct(finalDist, distanceNoisePct);
    const normalizedDist = Math.max(0, Math.min(1, noisyDist / range));

    const base = outOffset + i * VISION_VALUES_PER_RAY;
    out[base] = normalizedDist;
    for (let h = 0; h < HIT_TYPES.length; h++) {
      out[base + 1 + h] = HIT_TYPES[h] === finalType ? 1 : 0;
    }

    hits[i] = { distance: finalDist, hitType: finalType };
  }

  return hits;
}
