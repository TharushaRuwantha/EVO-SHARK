/**
 * Fixed layout of the egocentric sensor buffer shared by both species.
 * Kept as its own module (no dependency on Creature or World) so it can be
 * imported by the sensor implementations, the network, and the creature
 * class without creating a circular import.
 *
 * Order matters: this is the exact order values are written into the
 * buffer, and it's what the debug sensor-vector viewer labels by section.
 */
export const VISION_RAYS = 12;
export const VISION_VALUES_PER_RAY = 6; // [distance, empty, wall, plant, prey, predator]
export const VISION_SIZE = VISION_RAYS * VISION_VALUES_PER_RAY; // 72

export const SMELL_DIRECTIONS = 8;
export const SMELL_FIELDS = 2; // [prey-scent, predator-scent]
export const SMELL_SIZE = SMELL_DIRECTIONS * SMELL_FIELDS; // 16

export const LATERAL_LINE_DIRECTIONS = 8;
export const LATERAL_LINE_SIZE = LATERAL_LINE_DIRECTIONS; // 8

export const ELECTRO_DIRECTIONS = 4;
export const ELECTRO_VALUES_PER_DIRECTION = 2; // [living_presence, size_estimate]
export const ELECTRO_SIZE = ELECTRO_DIRECTIONS * ELECTRO_VALUES_PER_DIRECTION; // 8

export const TOUCH_QUADRANTS = 4;
export const TOUCH_VALUES_PER_QUADRANT = 4; // [wall, plant, prey, predator]
export const TOUCH_SIZE = TOUCH_QUADRANTS * TOUCH_VALUES_PER_QUADRANT; // 16

export const PROPRIOCEPTION_SIZE = 5;
export const PHYSIOLOGY_SIZE = 3;

// Offsets into the flat sensor buffer, in write order.
export const VISION_OFFSET = 0;
export const SMELL_OFFSET = VISION_OFFSET + VISION_SIZE;
export const LATERAL_LINE_OFFSET = SMELL_OFFSET + SMELL_SIZE;
export const ELECTRO_OFFSET = LATERAL_LINE_OFFSET + LATERAL_LINE_SIZE;
export const TOUCH_OFFSET = ELECTRO_OFFSET + ELECTRO_SIZE;
export const PROPRIOCEPTION_OFFSET = TOUCH_OFFSET + TOUCH_SIZE;
export const PHYSIOLOGY_OFFSET = PROPRIOCEPTION_OFFSET + PROPRIOCEPTION_SIZE;

export const SENSOR_SIZE = PHYSIOLOGY_OFFSET + PHYSIOLOGY_SIZE; // 128
export const BIAS_OFFSET = SENSOR_SIZE;
export const OBS_SIZE = SENSOR_SIZE + 1; // +1 bias input = 129

/** Human-readable section boundaries, used by the sensor-vector debug viewer. */
export const SENSOR_SECTIONS: { name: string; offset: number; size: number }[] = [
  { name: 'VISION', offset: VISION_OFFSET, size: VISION_SIZE },
  { name: 'SMELL', offset: SMELL_OFFSET, size: SMELL_SIZE },
  { name: 'LATERAL LINE', offset: LATERAL_LINE_OFFSET, size: LATERAL_LINE_SIZE },
  { name: 'ELECTRORECEPTION', offset: ELECTRO_OFFSET, size: ELECTRO_SIZE },
  { name: 'TOUCH', offset: TOUCH_OFFSET, size: TOUCH_SIZE },
  { name: 'PROPRIOCEPTION', offset: PROPRIOCEPTION_OFFSET, size: PROPRIOCEPTION_SIZE },
  { name: 'PHYSIOLOGY', offset: PHYSIOLOGY_OFFSET, size: PHYSIOLOGY_SIZE },
  { name: 'BIAS', offset: BIAS_OFFSET, size: 1 },
];

export type HitType = 'empty' | 'wall' | 'plant' | 'prey' | 'predator';
export const HIT_TYPES: HitType[] = ['empty', 'wall', 'plant', 'prey', 'predator'];

export type Quadrant = 'front' | 'right' | 'back' | 'left';
export const QUADRANTS: Quadrant[] = ['front', 'right', 'back', 'left'];

/**
 * Buckets a bearing (radians, absolute world angle) relative to a heading
 * (radians) into one of the 4 body-frame quadrants: front/right/back/left,
 * each spanning 90 degrees centered on its axis.
 */
export function bearingToQuadrant(bearingRad: number, headingRad: number): Quadrant {
  let rel = bearingRad - headingRad;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel)); // normalize to (-PI, PI]
  const deg = (rel * 180) / Math.PI;
  if (deg >= -45 && deg < 45) return 'front';
  if (deg >= 45 && deg < 135) return 'right';
  if (deg >= -135 && deg < -45) return 'left';
  return 'back';
}

/** Applies +/-pct% multiplicative noise to a value (pct is e.g. 10 for +/-10%). */
export function applyNoisePct(value: number, pct: number): number {
  if (pct <= 0) return value;
  const jitter = 1 + (Math.random() * 2 - 1) * (pct / 100);
  return value * jitter;
}
