import { Creature } from '../creature';
import { World } from '../world';
import { computeVision } from './vision';
import { computeLateralLine } from './lateralLine';
import { computeElectroreception } from './electroreception';
import { computeTouch } from './touch';
import {
  OBS_SIZE,
  SMELL_OFFSET,
  LATERAL_LINE_OFFSET,
  ELECTRO_OFFSET,
  TOUCH_OFFSET,
  PROPRIOCEPTION_OFFSET,
  PHYSIOLOGY_OFFSET,
  BIAS_OFFSET,
} from './sensorLayout';

export { OBS_SIZE };

/**
 * Builds this tick's egocentric, partial-observability sensor reading for
 * `self` directly into its persistent per-creature buffer (no allocation).
 * Every value here is something a body could plausibly sense: vision rays,
 * diffusing scent, motion-detecting lateral line, short-range
 * electroreception, contact touch, body-frame proprioception, and internal
 * physiology. Nothing here is an oracle read of absolute world state (no
 * raw coordinates, world-frame velocity, or "nearest X" distance/bearing
 * outside of what a sense organ with a real field of view/range would
 * report).
 */
export function buildObservation(self: Creature, world: World): Float32Array {
  const out = self.sensorBuffer;

  computeVision(self, world, out, 0);
  world.smellField.sample8Directions(self.x, self.y, self.heading, out, SMELL_OFFSET);
  computeLateralLine(self, world, out, LATERAL_LINE_OFFSET);
  computeElectroreception(self, world, out, ELECTRO_OFFSET);
  computeTouch(self, world, out, TOUCH_OFFSET);

  // --- Proprioception: body-frame velocity + turn rate + internal state ---
  const maxSpeed = self.stats.maxSpeed;
  const cosH = Math.cos(self.heading);
  const sinH = Math.sin(self.heading);
  const forwardSpeed = (self.vx * cosH + self.vy * sinH) / maxSpeed;
  const lateralSpeed = (-self.vx * sinH + self.vy * cosH) / maxSpeed;

  out[PROPRIOCEPTION_OFFSET + 0] = Math.max(-1, Math.min(1, forwardSpeed));
  out[PROPRIOCEPTION_OFFSET + 1] = Math.max(-1, Math.min(1, lateralSpeed));
  out[PROPRIOCEPTION_OFFSET + 2] = Math.max(-1, Math.min(1, self.angularVelocity / self.stats.maxTurnRate));
  out[PROPRIOCEPTION_OFFSET + 3] = self.energyFraction;
  out[PROPRIOCEPTION_OFFSET + 4] = self.healthFraction;
  // Restored per audit fix: the creature's own absolute heading (not a
  // bearing to anything) — internal state, no noise.
  out[PROPRIOCEPTION_OFFSET + 5] = sinH;
  out[PROPRIOCEPTION_OFFSET + 6] = cosH;

  // --- Physiology ---
  out[PHYSIOLOGY_OFFSET + 0] = self.hungerSignal;
  out[PHYSIOLOGY_OFFSET + 1] = Math.max(0, Math.min(1, self.biteCooldownFraction));
  out[PHYSIOLOGY_OFFSET + 2] = self.recentDamage;
  // Restored per audit fix: internal reproduction-charge state (foodEaten /
  // foodToClone), not a "similarity to parent" metric — no noise.
  out[PHYSIOLOGY_OFFSET + 3] = self.cloneProgressRatio;

  // Bias input is constant and set once at buffer creation (see Creature).
  out[BIAS_OFFSET] = 1;

  return out;
}
