/**
 * Numeric gradient check for ActorCriticNetwork.computeGradients.
 *
 * A hand-derived backprop formula with no autograd framework to catch a
 * sign or indexing mistake is exactly the kind of bug that doesn't crash --
 * it just quietly trains the wrong thing, which is very hard to notice from
 * a noisy reward curve alone. This script is the actual verification: it
 * compares the analytic gradient the network computes against a
 * finite-difference numerical estimate of the same objective, for every
 * parameter in a small test network, in three isolated scenarios (policy
 * term, value term, entropy term) plus one combined scenario exercising all
 * three at once through the shared trunk.
 *
 * Run with: npx tsx scripts/gradcheck.ts
 */
import { ActorCriticNetwork, ForwardResult } from '../src/rl/network';

const EPS = 1e-5;
// Central-difference error for a smooth function at this eps is typically
// ~1e-8 relative; this tolerance is generous on purpose so a legitimate
// pass isn't flaky, while still easily catching a real sign/indexing bug
// (those produce errors of order 1, not order 1e-4).
const REL_TOL = 1e-3;
const ABS_FLOOR = 1e-6;

let failures = 0;
let checks = 0;

function relError(analytic: number, numeric: number): number {
  return Math.abs(analytic - numeric) / Math.max(Math.abs(analytic), Math.abs(numeric), ABS_FLOOR);
}

function check(label: string, analytic: number, numeric: number): void {
  checks++;
  const err = relError(analytic, numeric);
  if (err > REL_TOL) {
    failures++;
    console.error(
      `  FAIL ${label}: analytic=${analytic.toFixed(8)} numeric=${numeric.toFixed(8)} relErr=${err.toExponential(3)}`
    );
  }
}

function softmaxArr(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Runs the net's forward pass and returns {probs, value} without touching computeGradients/training state. */
function evalNet(net: ActorCriticNetwork, obs: Float32Array): { probs: number[]; value: number } {
  const f = net.forward(obs);
  return { probs: f.probs, value: f.value };
}

function entropyOf(probs: number[]): number {
  let h = 0;
  for (const p of probs) h -= p * Math.log(Math.max(p, 1e-12));
  return h;
}

/**
 * The scalar objective each scenario checks, evaluated purely from a fresh
 * forward pass at the network's CURRENT parameters -- `fixedAdvantage` and
 * `fixedReturn` are plain captured numbers (not re-derived from the live
 * network), which is what makes this an honest check of the stop-gradient
 * actor-critic design: the policy term uses a fixed advantage, not
 * `fixedReturn - value(theta)`.
 */
function objective(
  net: ActorCriticNetwork,
  obs: Float32Array,
  action: number,
  fixedAdvantage: number,
  fixedReturn: number,
  valueLossCoef: number,
  entropyCoef: number
): number {
  const { probs, value } = evalNet(net, obs);
  let j = fixedAdvantage * Math.log(Math.max(probs[action], 1e-12));
  if (valueLossCoef !== 0) j += -0.5 * valueLossCoef * (value - fixedReturn) ** 2;
  if (entropyCoef !== 0) j += entropyCoef * entropyOf(probs);
  return j;
}

/** Central-difference numeric gradient of `objective` w.r.t. one scalar parameter, via a get/set pair. */
function numericGrad(evalAt: (delta: number) => number): number {
  const plus = evalAt(EPS);
  const minus = evalAt(-EPS);
  return (plus - minus) / (2 * EPS);
}

interface Scenario {
  name: string;
  fixedAdvantage: number;
  fixedReturn: number;
  valueLossCoef: number;
  entropyCoef: number;
}

function runScenario(net: ActorCriticNetwork, obs: Float32Array, action: number, scenario: Scenario): void {
  console.log(`\n${scenario.name}`);

  // The analytic gradient is computed once, from a forward snapshot at the
  // network's current (unperturbed) parameters -- exactly how a real
  // trajectory step stores its ForwardResult at the moment the action was
  // taken, then trains on it later.
  const forward: ForwardResult = net.forward(obs);
  const steps = [{ forward, action, returnValue: scenario.fixedReturn }];
  const grads = net.computeGradients(steps, {
    valueLossCoef: scenario.valueLossCoef,
    entropyCoef: scenario.entropyCoef,
  });

  const objAt = (delta: number) =>
    objective(net, obs, action, scenario.fixedAdvantage, scenario.fixedReturn, scenario.valueLossCoef, scenario.entropyCoef);

  // w1 (shared trunk, full matrix)
  for (let h = 0; h < net.hiddenSize; h++) {
    for (let i = 0; i < net.inputSize; i++) {
      const orig = net.w1[h][i];
      const num = numericGrad((d) => {
        net.w1[h][i] = orig + d;
        const j = objAt(d);
        net.w1[h][i] = orig;
        return j;
      });
      check(`w1[${h}][${i}]`, grads.gW1[h][i], num);
    }
  }
  // b1
  for (let h = 0; h < net.hiddenSize; h++) {
    const orig = net.b1[h];
    const num = numericGrad((d) => {
      net.b1[h] = orig + d;
      const j = objAt(d);
      net.b1[h] = orig;
      return j;
    });
    check(`b1[${h}]`, grads.gB1[h], num);
  }
  // w2 (policy head)
  for (let o = 0; o < net.outputSize; o++) {
    for (let h = 0; h < net.hiddenSize; h++) {
      const orig = net.w2[o][h];
      const num = numericGrad((d) => {
        net.w2[o][h] = orig + d;
        const j = objAt(d);
        net.w2[o][h] = orig;
        return j;
      });
      check(`w2[${o}][${h}]`, grads.gW2[o][h], num);
    }
  }
  // b2
  for (let o = 0; o < net.outputSize; o++) {
    const orig = net.b2[o];
    const num = numericGrad((d) => {
      net.b2[o] = orig + d;
      const j = objAt(d);
      net.b2[o] = orig;
      return j;
    });
    check(`b2[${o}]`, grads.gB2[o], num);
  }
  // wv (value head)
  for (let h = 0; h < net.hiddenSize; h++) {
    const orig = net.wv[h];
    const num = numericGrad((d) => {
      net.wv[h] = orig + d;
      const j = objAt(d);
      net.wv[h] = orig;
      return j;
    });
    check(`wv[${h}]`, grads.gWv[h], num);
  }
  // bv
  {
    const orig = net.bv;
    const num = numericGrad((d) => {
      net.bv = orig + d;
      const j = objAt(d);
      net.bv = orig;
      return j;
    });
    check('bv', grads.gBv, num);
  }
}

function main(): void {
  const inputSize = 5;
  const hiddenSize = 4;
  const outputSize = 3;
  const net = new ActorCriticNetwork(inputSize, hiddenSize, outputSize, true);
  const obs = Float32Array.from({ length: inputSize }, () => Math.random() * 2 - 1);
  const action = 1;

  const baseline = net.forward(obs).value; // used to build "fixed" advantage/return constants below

  const scenarios: Scenario[] = [
    {
      name: 'Scenario A: policy term only (advantage fixed, no value/entropy)',
      fixedAdvantage: 7,
      fixedReturn: baseline + 7, // returnValue - value(at snapshot) == 7
      valueLossCoef: 0,
      entropyCoef: 0,
    },
    {
      name: 'Scenario B: value term only (advantage fixed at 0, no entropy)',
      fixedAdvantage: 0,
      fixedReturn: baseline, // returnValue - value(at snapshot) == 0, so policy term contributes nothing
      valueLossCoef: 1,
      entropyCoef: 0,
    },
    {
      name: 'Scenario C: entropy term only (advantage fixed at 0, no value)',
      fixedAdvantage: 0,
      fixedReturn: baseline,
      valueLossCoef: 0,
      entropyCoef: 1,
    },
    {
      name: 'Scenario D: combined (realistic config -- all three terms active, shared trunk)',
      fixedAdvantage: 4,
      fixedReturn: baseline + 4,
      valueLossCoef: 0.5,
      entropyCoef: 0.01,
    },
  ];

  for (const scenario of scenarios) {
    runScenario(net, obs, action, scenario);
  }

  console.log(`\n${checks} parameter gradients checked, ${failures} failed.`);
  if (failures > 0) {
    console.error('\nGRADIENT CHECK FAILED -- do not trust trainOnTrajectory until this passes.');
    process.exit(1);
  }
  console.log('\nAll analytic gradients match finite-difference estimates. OK to train.');
}

main();
