import { CONFIG } from '../config';
import { Creature } from '../creature';
import { World } from '../world';
import { QUADRANTS, ELECTRO_VALUES_PER_DIRECTION, applyNoisePct, bearingToQuadrant } from './sensorLayout';

/**
 * Very short range "something is right next to me" sense: per body-frame
 * quadrant, whether a living creature is present and a rough size estimate.
 * Passes through obstacles/walls (like smell) since it senses bioelectric
 * fields, not light or physical contact.
 */
export function computeElectroreception(self: Creature, world: World, out: Float32Array, outOffset: number): void {
  const cfg = CONFIG.sensors.electroreception[self.type];
  const { range, noisePct } = cfg;

  const bestPresence = new Array<number>(QUADRANTS.length).fill(0);
  const bestSize = new Array<number>(QUADRANTS.length).fill(0);

  const nearby = world.creatureGrid.queryRadius(self.x, self.y, range);
  for (const other of nearby) {
    if (other === self || other.isDead) continue;
    const dx = other.x - self.x;
    const dy = other.y - self.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= range) continue;

    const presence = Math.max(0, 1 - dist / range);
    const qIdx = QUADRANTS.indexOf(bearingToQuadrant(Math.atan2(dy, dx), self.heading));

    if (presence > bestPresence[qIdx]) {
      bestPresence[qIdx] = presence;
      bestSize[qIdx] = other.radius / 14; // 14 = shark radius, the largest body in the sim
    }
  }

  for (let q = 0; q < QUADRANTS.length; q++) {
    const base = outOffset + q * ELECTRO_VALUES_PER_DIRECTION;
    out[base] = Math.max(0, Math.min(1, applyNoisePct(bestPresence[q], noisePct)));
    out[base + 1] = Math.max(0, Math.min(1, applyNoisePct(bestSize[q], noisePct)));
  }
}
