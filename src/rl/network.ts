/**
 * A tiny from-scratch 2-layer actor-critic MLP (input -> ReLU hidden ->
 * [softmax policy logits, scalar value]), trained with advantage
 * actor-critic (A2C): the policy head is pushed by `return - value`
 * (the critic's own prediction as the baseline, instead of REINFORCE's
 * single shared scalar), the value head is regressed toward the same
 * Monte-Carlo return, and a small entropy bonus discourages the policy
 * from collapsing onto one action too early.
 *
 * No ML framework dependency: this is plain arrays + hand-derived backprop
 * (verified against numeric finite-difference gradients -- see
 * scripts/gradcheck.mjs -- since a hand-derived gradient with no framework
 * to catch mistakes is exactly the kind of bug that's invisible until a
 * training run quietly fails to learn), small enough to run for many agents
 * at 60Hz in the browser and to serialize as JSON for checkpointing.
 */
export interface ActorCriticNetworkJSON {
  inputSize: number;
  hiddenSize: number;
  outputSize: number;
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];
  wv: number[];
  bv: number;
}

export interface ForwardResult {
  obs: Float32Array;
  hiddenPre: number[];
  hidden: number[];
  probs: number[];
  value: number;
}

export interface TrainResult {
  avgValueError: number; // mean (return - value)^2 over the trajectory
  avgEntropy: number; // mean policy entropy over the trajectory
}

function randInit(fanIn: number): number {
  // Small Xavier-ish uniform init to keep initial policy close to random/uniform.
  const limit = Math.sqrt(6 / fanIn);
  return (Math.random() * 2 - 1) * limit;
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / (sum || 1));
}

/** Clamp a raw (pre-Adam) gradient contribution so one freak tick can't inject NaN/Infinity. */
function clipGrad(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-10, Math.min(10, v));
}

interface AdamOpts {
  beta1: number;
  beta2: number;
  eps: number;
}

/** In-place Adam step on a flat (1D) parameter array, given its matching gradient array. */
function adamStep1D(params: number[], grads: number[], m: number[], v: number[], t: number, lr: number, opts: AdamOpts): void {
  const { beta1, beta2, eps } = opts;
  const biasCorr1 = 1 - Math.pow(beta1, t);
  const biasCorr2 = 1 - Math.pow(beta2, t);
  for (let i = 0; i < params.length; i++) {
    const g = grads[i];
    m[i] = beta1 * m[i] + (1 - beta1) * g;
    v[i] = beta2 * v[i] + (1 - beta2) * g * g;
    const mHat = m[i] / biasCorr1;
    const vHat = v[i] / biasCorr2;
    params[i] += (lr * mHat) / (Math.sqrt(vHat) + eps);
  }
}

/** Same as adamStep1D but for a 2D (row-major) parameter matrix. */
function adamStep2D(params: number[][], grads: number[][], m: number[][], v: number[][], t: number, lr: number, opts: AdamOpts): void {
  for (let r = 0; r < params.length; r++) {
    adamStep1D(params[r], grads[r], m[r], v[r], t, lr, opts);
  }
}

export class ActorCriticNetwork {
  public inputSize: number;
  public hiddenSize: number;
  public outputSize: number;
  public w1: number[][]; // [hidden][input]  -- shared trunk
  public b1: number[];
  public w2: number[][]; // [output][hidden] -- policy head
  public b2: number[];
  public wv: number[]; // [hidden]          -- value head
  public bv: number;

  // Adam moment estimates, one pair per parameter array above. Not
  // serialized (see toJSON) -- re-warms in a handful of updates, which is a
  // deliberately accepted simplification over persisting it too.
  private m1: number[][];
  private v1: number[][];
  private mB1: number[];
  private vB1: number[];
  private m2: number[][];
  private v2: number[][];
  private mB2: number[];
  private vB2: number[];
  private mWv: number[];
  private vWv: number[];
  private mBv = 0;
  private vBv = 0;
  private adamT = 0;

  constructor(inputSize: number, hiddenSize: number, outputSize: number, randomize = true) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;

    this.w1 = Array.from({ length: hiddenSize }, () =>
      Array.from({ length: inputSize }, () => (randomize ? randInit(inputSize) : 0))
    );
    this.b1 = new Array(hiddenSize).fill(0);
    this.w2 = Array.from({ length: outputSize }, () =>
      Array.from({ length: hiddenSize }, () => (randomize ? randInit(hiddenSize) : 0))
    );
    this.b2 = new Array(outputSize).fill(0);
    this.wv = Array.from({ length: hiddenSize }, () => (randomize ? randInit(hiddenSize) : 0));
    this.bv = 0;

    this.m1 = this.w1.map((row) => row.map(() => 0));
    this.v1 = this.w1.map((row) => row.map(() => 0));
    this.mB1 = this.b1.map(() => 0);
    this.vB1 = this.b1.map(() => 0);
    this.m2 = this.w2.map((row) => row.map(() => 0));
    this.v2 = this.w2.map((row) => row.map(() => 0));
    this.mB2 = this.b2.map(() => 0);
    this.vB2 = this.b2.map(() => 0);
    this.mWv = this.wv.map(() => 0);
    this.vWv = this.wv.map(() => 0);
  }

  /** Single-observation forward pass -- used for the one spectated creature's debug panels. */
  public forward(obs: Float32Array): ForwardResult {
    const hiddenPre = new Array(this.hiddenSize).fill(0);
    for (let h = 0; h < this.hiddenSize; h++) {
      let z = this.b1[h];
      const row = this.w1[h];
      for (let i = 0; i < this.inputSize; i++) z += row[i] * obs[i];
      hiddenPre[h] = z;
    }
    const hidden = hiddenPre.map((z) => Math.max(0, z));

    const logits = new Array(this.outputSize).fill(0);
    for (let o = 0; o < this.outputSize; o++) {
      let z = this.b2[o];
      const row = this.w2[o];
      for (let h = 0; h < this.hiddenSize; h++) z += row[h] * hidden[h];
      logits[o] = z;
    }
    const probs = softmax(logits);

    let value = this.bv;
    for (let h = 0; h < this.hiddenSize; h++) value += this.wv[h] * hidden[h];

    // `obs` is the creature's persistent, reused-every-tick sensor buffer —
    // it must be snapshotted here (not stored by reference) since this
    // ForwardResult gets held in the trajectory buffer until the episode
    // ends, long after the live buffer has been overwritten by later ticks.
    return { obs: Float32Array.from(obs), hiddenPre, hidden, probs, value };
  }

  /**
   * Batched forward pass for every creature of one species in one call:
   * removes the per-creature function-call and small-array-allocation
   * overhead of calling forward() in a loop (the actual math per row is the
   * same). `obsBatch` is row-major [n * inputSize]; returns typed-array
   * buffers the caller slices per creature to build each one's ForwardResult
   * snapshot for its trajectory.
   */
  public forwardBatch(obsBatch: Float32Array, n: number): { hiddenPre: Float32Array; hidden: Float32Array; probs: Float32Array; values: Float32Array } {
    const { inputSize, hiddenSize, outputSize, w1, b1, w2, b2, wv, bv } = this;
    const hiddenPre = new Float32Array(n * hiddenSize);
    const hidden = new Float32Array(n * hiddenSize);
    const probs = new Float32Array(n * outputSize);
    const values = new Float32Array(n);
    const logitsRow = new Float64Array(outputSize);

    for (let r = 0; r < n; r++) {
      const obsOff = r * inputSize;
      const hOff = r * hiddenSize;

      for (let h = 0; h < hiddenSize; h++) {
        let z = b1[h];
        const row = w1[h];
        for (let i = 0; i < inputSize; i++) z += row[i] * obsBatch[obsOff + i];
        hiddenPre[hOff + h] = z;
        hidden[hOff + h] = z > 0 ? z : 0;
      }

      let max = -Infinity;
      for (let o = 0; o < outputSize; o++) {
        let z = b2[o];
        const row = w2[o];
        for (let h = 0; h < hiddenSize; h++) z += row[h] * hidden[hOff + h];
        logitsRow[o] = z;
        if (z > max) max = z;
      }
      let sum = 0;
      const pOff = r * outputSize;
      for (let o = 0; o < outputSize; o++) {
        const e = Math.exp(logitsRow[o] - max);
        probs[pOff + o] = e;
        sum += e;
      }
      for (let o = 0; o < outputSize; o++) probs[pOff + o] /= sum || 1;

      let v = bv;
      for (let h = 0; h < hiddenSize; h++) v += wv[h] * hidden[hOff + h];
      values[r] = v;
    }

    return { hiddenPre, hidden, probs, values };
  }

  public sampleAction(probs: ArrayLike<number>): number {
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (r <= cumulative) return i;
    }
    return probs.length - 1;
  }

  /**
   * Pure gradient computation for one trajectory -- no parameter mutation,
   * so this is what scripts/gradcheck.mjs calls to compare against
   * finite-difference numerical gradients before trusting trainOnTrajectory
   * to actually apply anything. Kept separate from the Adam step for
   * exactly that reason: comparing a raw analytic gradient against a
   * finite-difference estimate is meaningful, comparing an *Adam-adapted*
   * parameter delta against one would not be (Adam's per-parameter scaling
   * isn't the gradient).
   *
   * `steps[i].returnValue` is the already-computed discounted Monte-Carlo
   * return from that step to the end of the episode (same backward-
   * recursion the old REINFORCE code used) -- note this means the whole
   * episode is used as the return, so there's no bootstrap/"done flag"
   * subtlety to get right here the way there would be with n-step or TD
   * bootstrapping: truncation (generation timeout) and true termination
   * (death) are already handled identically by whatever finalReward was
   * added before the return was computed.
   *
   * advantage = return - value (the critic's own prediction is the
   * baseline, replacing REINFORCE's single running scalar).
   */
  public computeGradients(
    steps: { forward: ForwardResult; action: number; returnValue: number }[],
    opts: { valueLossCoef: number; entropyCoef: number }
  ): {
    gW1: number[][];
    gB1: number[];
    gW2: number[][];
    gB2: number[];
    gWv: number[];
    gBv: number;
    avgValueError: number;
    avgEntropy: number;
  } {
    const gW1 = this.w1.map((row) => row.map(() => 0));
    const gB1 = this.b1.map(() => 0);
    const gW2 = this.w2.map((row) => row.map(() => 0));
    const gB2 = this.b2.map(() => 0);
    const gWv = this.wv.map(() => 0);
    let gBv = 0;

    let totalEntropy = 0;
    let totalValueError = 0;

    for (const { forward, action, returnValue } of steps) {
      const { obs, hiddenPre, hidden, probs, value } = forward;
      const advantage = returnValue - value;

      // Policy entropy H = -sum p*log(p), and its gradient w.r.t. the
      // logits (verified numerically in scripts/gradcheck.mjs):
      // dH/dz_k = -p_k * (log(p_k) + H).
      const logProbs = probs.map((p) => Math.log(Math.max(p, 1e-8)));
      let entropy = 0;
      for (let o = 0; o < this.outputSize; o++) entropy -= probs[o] * logProbs[o];
      totalEntropy += entropy;

      const dLogits = new Array(this.outputSize).fill(0);
      for (let o = 0; o < this.outputSize; o++) {
        const onehot = o === action ? 1 : 0;
        const dEntropy = -probs[o] * (logProbs[o] + entropy);
        dLogits[o] = advantage * (onehot - probs[o]) + opts.entropyCoef * dEntropy;
      }

      // Value head: ascend -(value - return)^2, i.e. d/dValue = (return - value).
      const valueErr = returnValue - value;
      totalValueError += valueErr * valueErr;
      const dValue = opts.valueLossCoef * valueErr;

      for (let o = 0; o < this.outputSize; o++) {
        gB2[o] += dLogits[o];
        for (let h = 0; h < this.hiddenSize; h++) gW2[o][h] += dLogits[o] * hidden[h];
      }
      gBv += dValue;
      for (let h = 0; h < this.hiddenSize; h++) gWv[h] += dValue * hidden[h];

      // Shared trunk receives gradient from BOTH heads.
      const dHidden = new Array(this.hiddenSize).fill(0);
      for (let h = 0; h < this.hiddenSize; h++) {
        let sum = 0;
        for (let o = 0; o < this.outputSize; o++) sum += dLogits[o] * this.w2[o][h];
        sum += dValue * this.wv[h];
        dHidden[h] = hiddenPre[h] > 0 ? sum : 0; // ReLU derivative
      }
      for (let h = 0; h < this.hiddenSize; h++) {
        gB1[h] += dHidden[h];
        for (let i = 0; i < this.inputSize; i++) gW1[h][i] += dHidden[h] * obs[i];
      }
    }

    const n = steps.length;
    return {
      gW1: gW1.map((row) => row.map((x) => x / n)),
      gB1: gB1.map((x) => x / n),
      gW2: gW2.map((row) => row.map((x) => x / n)),
      gB2: gB2.map((x) => x / n),
      gWv: gWv.map((x) => x / n),
      gBv: gBv / n,
      avgValueError: totalValueError / n,
      avgEntropy: totalEntropy / n,
    };
  }

  /**
   * Advantage actor-critic update for one completed trajectory: computes
   * gradients (see computeGradients) then applies one Adam step with them,
   * same update cadence (once per completed/truncated creature lifetime) as
   * the REINFORCE code this replaced.
   */
  public trainOnTrajectory(
    steps: { forward: ForwardResult; action: number; returnValue: number }[],
    opts: { learningRate: number; valueLossCoef: number; entropyCoef: number; adam: AdamOpts }
  ): TrainResult {
    if (steps.length === 0) return { avgValueError: 0, avgEntropy: 0 };

    const { gW1, gB1, gW2, gB2, gWv, gBv, avgValueError, avgEntropy } = this.computeGradients(steps, opts);
    const clip2D = (g: number[][]): number[][] => g.map((row) => row.map(clipGrad));
    const clip1D = (g: number[]): number[] => g.map(clipGrad);

    this.adamT++;
    const lr = opts.learningRate;
    adamStep2D(this.w1, clip2D(gW1), this.m1, this.v1, this.adamT, lr, opts.adam);
    adamStep1D(this.b1, clip1D(gB1), this.mB1, this.vB1, this.adamT, lr, opts.adam);
    adamStep2D(this.w2, clip2D(gW2), this.m2, this.v2, this.adamT, lr, opts.adam);
    adamStep1D(this.b2, clip1D(gB2), this.mB2, this.vB2, this.adamT, lr, opts.adam);
    adamStep1D(this.wv, clip1D(gWv), this.mWv, this.vWv, this.adamT, lr, opts.adam);
    // bv/mBv/vBv are plain scalars (not arrays like every other parameter),
    // so adamStep1D -- which mutates its array arguments in place -- needs
    // them boxed into 1-element arrays, then unboxed back out afterward.
    {
      const boxedBv = [this.bv];
      const boxedM = [this.mBv];
      const boxedV = [this.vBv];
      adamStep1D(boxedBv, [clipGrad(gBv)], boxedM, boxedV, this.adamT, lr, opts.adam);
      this.bv = boxedBv[0];
      this.mBv = boxedM[0];
      this.vBv = boxedV[0];
    }

    return { avgValueError, avgEntropy };
  }

  public toJSON(): ActorCriticNetworkJSON {
    return {
      inputSize: this.inputSize,
      hiddenSize: this.hiddenSize,
      outputSize: this.outputSize,
      w1: this.w1,
      b1: this.b1,
      w2: this.w2,
      b2: this.b2,
      wv: this.wv,
      bv: this.bv,
    };
  }

  public static fromJSON(data: ActorCriticNetworkJSON): ActorCriticNetwork {
    const net = new ActorCriticNetwork(data.inputSize, data.hiddenSize, data.outputSize, false);
    net.w1 = data.w1;
    net.b1 = data.b1;
    net.w2 = data.w2;
    net.b2 = data.b2;
    net.wv = data.wv;
    net.bv = data.bv;
    return net;
  }
}
