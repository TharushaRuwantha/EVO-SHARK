/**
 * A tiny from-scratch 2-layer MLP policy network (input -> ReLU hidden ->
 * softmax logits), trained with REINFORCE (Monte-Carlo policy gradient).
 * No ML framework dependency: this is plain arrays + hand-derived backprop,
 * small enough to run for many agents at 60Hz in the browser and to
 * serialize as JSON for checkpointing.
 */
export interface PolicyNetworkJSON {
  inputSize: number;
  hiddenSize: number;
  outputSize: number;
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];
}

export interface ForwardResult {
  obs: Float32Array;
  hiddenPre: number[];
  hidden: number[];
  probs: number[];
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

export class PolicyNetwork {
  public inputSize: number;
  public hiddenSize: number;
  public outputSize: number;
  public w1: number[][]; // [hidden][input]
  public b1: number[];
  public w2: number[][]; // [output][hidden]
  public b2: number[];

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
  }

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

    // `obs` is the creature's persistent, reused-every-tick sensor buffer —
    // it must be snapshotted here (not stored by reference) since this
    // ForwardResult gets held in the trajectory buffer until the episode
    // ends, long after the live buffer has been overwritten by later ticks.
    return { obs: Float32Array.from(obs), hiddenPre, hidden, probs };
  }

  public sampleAction(probs: number[]): number {
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (r <= cumulative) return i;
    }
    return probs.length - 1;
  }

  /**
   * REINFORCE update: for each (forward pass, chosen action, advantage) step,
   * push the log-probability of that action up or down proportional to the
   * advantage, then backprop that signal through the hidden layer.
   * Gradients are accumulated over the whole trajectory and applied as one
   * averaged ascent step.
   */
  public trainOnTrajectory(
    steps: { forward: ForwardResult; action: number; advantage: number }[],
    learningRate: number
  ): void {
    if (steps.length === 0) return;

    const gW1 = Array.from({ length: this.hiddenSize }, () => new Array(this.inputSize).fill(0));
    const gB1 = new Array(this.hiddenSize).fill(0);
    const gW2 = Array.from({ length: this.outputSize }, () => new Array(this.hiddenSize).fill(0));
    const gB2 = new Array(this.outputSize).fill(0);

    for (const { forward, action, advantage } of steps) {
      const { obs, hiddenPre, hidden, probs } = forward;

      // dJ/dLogits = advantage * (onehot(action) - probs)
      const dLogits = new Array(this.outputSize).fill(0);
      for (let o = 0; o < this.outputSize; o++) {
        const onehot = o === action ? 1 : 0;
        dLogits[o] = advantage * (onehot - probs[o]);
      }

      for (let o = 0; o < this.outputSize; o++) {
        gB2[o] += dLogits[o];
        for (let h = 0; h < this.hiddenSize; h++) {
          gW2[o][h] += dLogits[o] * hidden[h];
        }
      }

      const dHidden = new Array(this.hiddenSize).fill(0);
      for (let h = 0; h < this.hiddenSize; h++) {
        let sum = 0;
        for (let o = 0; o < this.outputSize; o++) sum += dLogits[o] * this.w2[o][h];
        dHidden[h] = hiddenPre[h] > 0 ? sum : 0; // ReLU derivative
      }

      for (let h = 0; h < this.hiddenSize; h++) {
        gB1[h] += dHidden[h];
        for (let i = 0; i < this.inputSize; i++) {
          gW1[h][i] += dHidden[h] * obs[i];
        }
      }
    }

    const scale = learningRate / steps.length;
    const clip = (v: number) => Math.max(-2, Math.min(2, v));

    for (let o = 0; o < this.outputSize; o++) {
      this.b2[o] += clip(gB2[o] * scale);
      for (let h = 0; h < this.hiddenSize; h++) {
        this.w2[o][h] += clip(gW2[o][h] * scale);
      }
    }
    for (let h = 0; h < this.hiddenSize; h++) {
      this.b1[h] += clip(gB1[h] * scale);
      for (let i = 0; i < this.inputSize; i++) {
        this.w1[h][i] += clip(gW1[h][i] * scale);
      }
    }
  }

  public toJSON(): PolicyNetworkJSON {
    return {
      inputSize: this.inputSize,
      hiddenSize: this.hiddenSize,
      outputSize: this.outputSize,
      w1: this.w1,
      b1: this.b1,
      w2: this.w2,
      b2: this.b2,
    };
  }

  public static fromJSON(data: PolicyNetworkJSON): PolicyNetwork {
    const net = new PolicyNetwork(data.inputSize, data.hiddenSize, data.outputSize, false);
    net.w1 = data.w1;
    net.b1 = data.b1;
    net.w2 = data.w2;
    net.b2 = data.b2;
    return net;
  }
}
