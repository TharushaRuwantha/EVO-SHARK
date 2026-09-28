import { CONFIG } from './config';
import { PRNG } from './rng';

export interface Point {
  x: number;
  y: number;
}

export interface Obstacle {
  id: number;
  x: number;
  y: number;
  radius: number;
  boundingRadius: number;
  vertices: Point[];
  blocksVision: boolean;
}

/**
 * Generate 15-25 rock formations from the deterministic PRNG.
 * 60% small (30-60 size), 30% medium (60-120 size), 10% large (120-200 size).
 */
export function generateObstacles(rng: PRNG): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const targetCount = rng.rangeInt(CONFIG.obstacles.minCount, CONFIG.obstacles.maxCount);
  const wallMargin = CONFIG.obstacles.wallMargin + CONFIG.world.wallThickness;
  const minSpacing = CONFIG.obstacles.minSpacing;

  let attempts = 0;
  const maxAttempts = 2000;

  for (let i = 0; i < targetCount && attempts < maxAttempts; i++) {
    attempts++;

    // Determine category based on 60% small, 30% medium, 10% large
    const roll = rng.next();
    let size: number;
    if (roll < 0.60) {
      size = rng.range(30, 60);
    } else if (roll < 0.90) {
      size = rng.range(60, 120);
    } else {
      size = rng.range(120, 200);
    }

    const radius = size / 2;
    const padding = radius + wallMargin;
    const x = rng.range(padding, CONFIG.world.width - padding);
    const y = rng.range(padding, CONFIG.world.height - padding);

    // Check distance against existing obstacles
    let overlaps = false;
    for (const other of obstacles) {
      const dist = Math.hypot(x - other.x, y - other.y);
      if (dist < radius + other.radius + minSpacing) {
        overlaps = true;
        break;
      }
    }

    if (overlaps) {
      i--; // Try again
      continue;
    }

    // Generate irregular polygon vertices (6 to 9 vertices)
    const vertexCount = rng.rangeInt(6, 9);
    const vertices: Point[] = [];
    let maxR = 0;

    for (let v = 0; v < vertexCount; v++) {
      const baseAngle = (v / vertexCount) * Math.PI * 2;
      const angleJitter = rng.range(-0.15, 0.15);
      const angle = baseAngle + angleJitter;
      const rJitter = radius * rng.range(0.75, 1.25);
      if (rJitter > maxR) maxR = rJitter;

      vertices.push({
        x: x + Math.cos(angle) * rJitter,
        y: y + Math.sin(angle) * rJitter,
      });
    }

    obstacles.push({
      id: i + 1,
      x,
      y,
      radius,
      boundingRadius: maxR + 5,
      vertices,
      blocksVision: true,
    });
  }

  return obstacles;
}

/**
 * Check if a point is inside a polygon using ray-casting.
 */
function isPointInPolygon(p: Point, vertices: Point[]): boolean {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;

    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Find the closest point on segment AB to point C
 */
function closestPointOnSegment(c: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return { x: a.x, y: a.y };

  const acx = c.x - a.x;
  const acy = c.y - a.y;
  let t = (acx * abx + acy * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  return {
    x: a.x + t * abx,
    y: a.y + t * aby,
  };
}

/**
 * Resolves collision between a circular creature and an obstacle polygon.
 * Modifies creature position and velocity so it smoothly slides with zero sticking.
 */
export function resolveCreatureObstacleCollision(
  creature: { x: number; y: number; vx: number; vy: number; radius: number },
  obstacle: Obstacle,
): boolean {
  // Broad-phase circle check
  const dx = creature.x - obstacle.x;
  const dy = creature.y - obstacle.y;
  const distCenter = Math.hypot(dx, dy);

  if (distCenter > obstacle.boundingRadius + creature.radius) {
    return false;
  }

  const { vertices } = obstacle;
  const n = vertices.length;
  let minDist = Infinity;
  let closestPoint: Point = { x: obstacle.x, y: obstacle.y };
  let collisionNormal = { x: 0, y: 0 };

  const cPoint = { x: creature.x, y: creature.y };
  const inside = isPointInPolygon(cPoint, vertices);

  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const cp = closestPointOnSegment(cPoint, a, b);
    const d = Math.hypot(creature.x - cp.x, creature.y - cp.y);

    if (d < minDist) {
      minDist = d;
      closestPoint = cp;

      // Outward normal of edge (a -> b)
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const elen = Math.hypot(ex, ey);
      if (elen > 0.0001) {
        // Normal perpendicular to clockwise edge
        collisionNormal = { x: ey / elen, y: -ex / elen };
      }
    }
  }

  // Determine penetration depth and normal
  let penetration = 0;
  let nx = 0;
  let ny = 0;

  if (inside) {
    // If center is inside, push out along direction from center or edge normal
    penetration = creature.radius + minDist;
    const fromCenterDist = Math.hypot(creature.x - obstacle.x, creature.y - obstacle.y);
    if (fromCenterDist > 0.001) {
      nx = (creature.x - obstacle.x) / fromCenterDist;
      ny = (creature.y - obstacle.y) / fromCenterDist;
    } else {
      nx = collisionNormal.x;
      ny = collisionNormal.y;
    }
  } else if (minDist < creature.radius) {
    penetration = creature.radius - minDist;
    if (minDist > 0.0001) {
      nx = (creature.x - closestPoint.x) / minDist;
      ny = (creature.y - closestPoint.y) / minDist;
    } else {
      nx = collisionNormal.x;
      ny = collisionNormal.y;
    }
  } else {
    // No contact
    return false;
  }

  // Normalize normal vector
  const nLen = Math.hypot(nx, ny);
  if (nLen > 0.0001) {
    nx /= nLen;
    ny /= nLen;
  } else {
    nx = 1;
    ny = 0;
  }

  // Push creature out of obstacle
  creature.x += nx * penetration;
  creature.y += ny * penetration;

  // Slide resolution: remove velocity moving into obstacle surface
  const vn = creature.vx * nx + creature.vy * ny;
  if (vn < 0) {
    creature.vx -= vn * nx;
    creature.vy -= vn * ny;
  }

  return true;
}
