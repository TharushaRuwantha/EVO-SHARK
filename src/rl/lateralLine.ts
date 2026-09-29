import { CONFIG } from '../config';
import { Creature } from '../creature';
import { World } from '../world';
import { LATERAL_LINE_DIRECTIONS, applyNoisePct } from './sensorLayout';

/**
 * Detects motion, not presence: sums speed / (distance^2 + 100) from every
 * nearby creature into one of 8 body-frame 45-degree sectors. A stationary
 * creature contributes nothing; a sprinting one dominates its sector. Carries
 * no species/type information, unlike vision or smell.
 */
export function computeLateralLine(self: Creature, world: World, out: Float32Array, outOffset: number): void {
  const cfg = CONFIG.sensors.lateralLine[self.type];
  const { range, noisePct } = cfg;

  const sums = new Array<number>(LATERAL_LINE_DIRECTIONS).fill(0);
  const sectorWidth = (Math.PI * 2) / LATERAL_LINE_DIRECTIONS;

  const nearby = world.creatureGrid.queryRadius(self.x, self.y, range);
  for (const other of nearby) {
    if (other === self || other.isDead) continue;
    const dx = other.x - self.x;
    const dy = other.y - self.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > range * range) continue;

    const speed = Math.hypot(other.vx, other.vy);
    if (speed <= 0) continue;

    let rel = Math.atan2(dy, dx) - self.heading;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel)); // (-PI, PI]
    let sector = Math.round(rel / sectorWidth) % LATERAL_LINE_DIRECTIONS;
    if (sector < 0) sector += LATERAL_LINE_DIRECTIONS;

    sums[sector] += speed / (distSq + 100);
  }

  for (let k = 0; k < LATERAL_LINE_DIRECTIONS; k++) {
    const noisy = applyNoisePct(sums[k], noisePct);
    out[outOffset + k] = Math.max(0, Math.min(1, noisy));
  }
}
