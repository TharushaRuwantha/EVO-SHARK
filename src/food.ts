import { CONFIG } from './config';

export interface MeatRemains {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  age: number;
  maxAge: number;
  rotation: number;
  vRot: number;
  nutrition: number;
}

let nextMeatId = 1;

/**
 * Spawns 2 to 4 meat remains chunks at fish death site
 */
export function spawnFishRemains(x: number, y: number, count: number = 3): MeatRemains[] {
  const remains: MeatRemains[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
    const speed = Math.random() * 45 + 20;

    remains.push({
      id: nextMeatId++,
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: CONFIG.remains.radius * (0.8 + Math.random() * 0.4),
      age: 0,
      maxAge: CONFIG.remains.decayTime,
      rotation: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 2.5,
      nutrition: 1, // 1 food point towards clone
    });
  }

  return remains;
}

/**
 * Updates physics and decay for floating meat remains
 */
export function updateMeatRemains(remains: MeatRemains[], dt: number): void {
  for (let i = remains.length - 1; i >= 0; i--) {
    const meat = remains[i];
    meat.age += dt;

    if (meat.age >= meat.maxAge) {
      remains.splice(i, 1);
      continue;
    }

    // Water drift & subtle buoyancy
    meat.x += meat.vx * dt;
    meat.y += meat.vy * dt;
    meat.rotation += meat.vRot * dt;

    meat.vx *= 0.94;
    meat.vy *= 0.94;
    meat.vRot *= 0.95;

    // Boundary constraints
    const pad = CONFIG.world.wallThickness + meat.radius;
    if (meat.x < pad) {
      meat.x = pad;
      meat.vx = -meat.vx * 0.5;
    } else if (meat.x > CONFIG.world.width - pad) {
      meat.x = CONFIG.world.width - pad;
      meat.vx = -meat.vx * 0.5;
    }

    if (meat.y < pad) {
      meat.y = pad;
      meat.vy = -meat.vy * 0.5;
    } else if (meat.y > CONFIG.world.height - pad) {
      meat.y = CONFIG.world.height - pad;
      meat.vy = -meat.vy * 0.5;
    }
  }
}
