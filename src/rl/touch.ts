import { CONFIG } from '../config';
import { Creature } from '../creature';
import { World } from '../world';
import { QUADRANTS, TOUCH_SIZE, TOUCH_VALUES_PER_QUADRANT, bearingToQuadrant } from './sensorLayout';

const CONTACT_TYPE_INDEX = { wall: 0, plant: 1, prey: 2, predator: 3 } as const;

function setContact(out: Float32Array, outOffset: number, bearing: number, heading: number, type: keyof typeof CONTACT_TYPE_INDEX): void {
  const quadrant = bearingToQuadrant(bearing, heading);
  const qIdx = QUADRANTS.indexOf(quadrant);
  out[outOffset + qIdx * TOUCH_VALUES_PER_QUADRANT + CONTACT_TYPE_INDEX[type]] = 1;
}

/**
 * Ground-truth (no noise) contact flags: is something touching me, and in
 * which of my 4 body-frame quadrants. Unlike the other senses this isn't
 * approximate — a real body knows immediately and exactly when something
 * is pressed against it.
 */
export function computeTouch(self: Creature, world: World, out: Float32Array, outOffset: number): void {
  // Ground truth, but only for THIS tick: every slot must start at 0, or a
  // flag set once (e.g. brushing a wall) would stay 1 forever since `out`
  // is the creature's persistent, never-reallocated sensor buffer.
  out.fill(0, outOffset, outOffset + TOUCH_SIZE);

  const wallThickness = CONFIG.world.wallThickness;
  const r = self.radius;
  const eps = 0.5;

  const minX = wallThickness + r;
  const maxX = CONFIG.world.width - wallThickness - r;
  const minY = wallThickness + r;
  const maxY = CONFIG.world.height - wallThickness - r;

  if (self.x <= minX + eps) setContact(out, outOffset, Math.PI, self.heading, 'wall');
  if (self.x >= maxX - eps) setContact(out, outOffset, 0, self.heading, 'wall');
  if (self.y <= minY + eps) setContact(out, outOffset, -Math.PI / 2, self.heading, 'wall');
  if (self.y >= maxY - eps) setContact(out, outOffset, Math.PI / 2, self.heading, 'wall');

  // Obstacles are few (a couple dozen at most), so a brute-force scan is
  // cheap; plants and creatures can both be in the hundreds/thousands, so
  // those are pruned with the shared spatial grids first -- touch only ever
  // fires within a few body-radii, so almost everything in the full lists
  // would've failed the distance check anyway.
  for (const obs of world.obstacles) {
    const dx = obs.x - self.x;
    const dy = obs.y - self.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= r + obs.boundingRadius) {
      setContact(out, outOffset, Math.atan2(dy, dx), self.heading, 'wall');
    }
  }

  // Largest possible contact distance: self's radius + the biggest plant/
  // meat/creature radius we could touch. Generous but still tiny next to
  // the world, so the grid query stays local.
  const touchRange = r + CONFIG.plants.radius + CONFIG.species.shark.radius + CONFIG.remains.radius;

  for (const plant of world.plantGrid.queryRadius(self.x, self.y, touchRange)) {
    const dx = plant.x - self.x;
    const dy = plant.y - self.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= r + plant.radius) {
      setContact(out, outOffset, Math.atan2(dy, dx), self.heading, 'plant');
    }
  }

  for (const meat of world.meatRemains) {
    const dx = meat.x - self.x;
    const dy = meat.y - self.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= r + meat.radius) {
      setContact(out, outOffset, Math.atan2(dy, dx), self.heading, 'prey');
    }
  }

  for (const other of world.creatureGrid.queryRadius(self.x, self.y, touchRange)) {
    if (other === self || other.isDead) continue;
    const dx = other.x - self.x;
    const dy = other.y - self.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= r + other.radius) {
      const bearing = Math.atan2(dy, dx);
      if (other.type === self.type) {
        setContact(out, outOffset, bearing, self.heading, 'wall');
      } else {
        setContact(out, outOffset, bearing, self.heading, other.type === 'fish' ? 'prey' : 'predator');
      }
    }
  }
}
