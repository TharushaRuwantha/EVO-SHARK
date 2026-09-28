import { CreatureInput } from '../creature';

/**
 * Small discrete action set. Every action is a distinct combination of
 * thrust/turn/bite so the policy network only has to pick one of these
 * indices (softmax over ACTION_COUNT logits) rather than learn a
 * continuous control signal.
 */
export const ACTIONS: CreatureInput[] = [
  { thrustInput: 0, turnInput: 0, isBraking: false, wantsBite: false }, // 0: idle / coast
  { thrustInput: 1, turnInput: 0, isBraking: false, wantsBite: false }, // 1: thrust straight
  { thrustInput: 1, turnInput: -1, isBraking: false, wantsBite: false }, // 2: thrust + turn left
  { thrustInput: 1, turnInput: 1, isBraking: false, wantsBite: false }, // 3: thrust + turn right
  { thrustInput: 0, turnInput: -1, isBraking: false, wantsBite: false }, // 4: turn left in place
  { thrustInput: 0, turnInput: 1, isBraking: false, wantsBite: false }, // 5: turn right in place
  { thrustInput: 0, turnInput: 0, isBraking: false, wantsBite: true }, // 6: bite
];

export const ACTION_COUNT = ACTIONS.length;

export function actionToInput(actionIndex: number): CreatureInput {
  return ACTIONS[actionIndex] ?? ACTIONS[0];
}
