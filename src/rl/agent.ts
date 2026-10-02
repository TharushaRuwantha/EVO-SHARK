import { CONFIG } from '../config';
import { ActorCriticNetwork, ActorCriticNetworkJSON, ForwardResult } from './network';
import { ACTION_COUNT } from './actions';
import { OBS_SIZE } from './perception';

export interface AgentJSON {
  network: ActorCriticNetworkJSON;
  episodesTrained: number;
  avgReward: number;
  avgEntropy: number;
}

/**
 * One shared actor-critic policy per species. Every living instance of that
 * species (e.g. every small fish) samples actions from the same network and
 * contributes its lifetime trajectory back into training -- so the whole
 * population learns from everyone's experience at once.
 */
export class SpeciesAgent {
  public network: ActorCriticNetwork;
  public episodesTrained: number = 0;
  public avgReward: number = 0;
  // Mean policy entropy of the most recently trained trajectories (EMA).
  // Watch this over a long run: collapsing toward 0 means the policy is
  // locking onto one action and exploration has died, independent of
  // whether avgReward also looks flat -- the two symptoms call for
  // different fixes (see the training-progress plan).
  public avgEntropy: number = 0;

  constructor(network?: ActorCriticNetwork) {
    this.network = network ?? new ActorCriticNetwork(OBS_SIZE, CONFIG.rl.hiddenSize, ACTION_COUNT);
  }

  /** Single-observation action sample -- used only for UI/debug paths, not the hot training loop (see actBatch). */
  public act(obs: Float32Array): { action: number; forward: ForwardResult } {
    const forward = this.network.forward(obs);
    const action = this.network.sampleAction(forward.probs);
    return { action, forward };
  }

  /**
   * Batched action sample for every living creature of this species in one
   * tick: builds one obs matrix, does one forwardBatch call (avoiding N
   * separate forward() calls' function/array overhead), then slices and
   * snapshots each creature's own ForwardResult (still one small allocation
   * per creature, since each is held in that creature's trajectory buffer
   * until its episode ends -- but the network math itself runs once, not N
   * times).
   */
  public actBatch(obsList: Float32Array[]): { action: number; forward: ForwardResult }[] {
    const n = obsList.length;
    if (n === 0) return [];

    const inputSize = this.network.inputSize;
    const hiddenSize = this.network.hiddenSize;
    const outputSize = this.network.outputSize;

    const obsBatch = new Float32Array(n * inputSize);
    for (let r = 0; r < n; r++) obsBatch.set(obsList[r], r * inputSize);

    const { hiddenPre, hidden, probs, values } = this.network.forwardBatch(obsBatch, n);

    const results: { action: number; forward: ForwardResult }[] = new Array(n);
    for (let r = 0; r < n; r++) {
      const hOff = r * hiddenSize;
      const pOff = r * outputSize;
      const probsRow = Array.from(probs.subarray(pOff, pOff + outputSize));
      const forward: ForwardResult = {
        obs: Float32Array.from(obsList[r]),
        hiddenPre: Array.from(hiddenPre.subarray(hOff, hOff + hiddenSize)),
        hidden: Array.from(hidden.subarray(hOff, hOff + hiddenSize)),
        probs: probsRow,
        value: values[r],
      };
      const action = this.network.sampleAction(probsRow);
      results[r] = { action, forward };
    }
    return results;
  }

  /**
   * Trains on one completed creature "lifetime" (from spawn to death, or
   * truncated by a generation reset). Computes discounted Monte-Carlo
   * returns, then applies one advantage actor-critic update (see
   * ActorCriticNetwork.trainOnTrajectory) where the critic's own value
   * prediction is the baseline, instead of REINFORCE's single running
   * scalar baseline.
   */
  public learnFromEpisode(steps: { forward: ForwardResult; action: number; reward: number }[]): void {
    if (steps.length === 0) return;

    const gamma = CONFIG.rl.rewardDiscount;
    const returns = new Array<number>(steps.length);
    let running = 0;
    for (let t = steps.length - 1; t >= 0; t--) {
      running = steps[t].reward + gamma * running;
      returns[t] = running;
    }

    const totalReward = steps.reduce((sum, s) => sum + s.reward, 0);
    this.avgReward = this.episodesTrained === 0 ? totalReward : this.avgReward * 0.95 + totalReward * 0.05;
    this.episodesTrained++;

    const trainingSteps = steps.map((s, i) => ({
      forward: s.forward,
      action: s.action,
      returnValue: returns[i],
    }));

    const { avgEntropy } = this.network.trainOnTrajectory(trainingSteps, {
      learningRate: CONFIG.rl.learningRate,
      valueLossCoef: CONFIG.rl.valueLossCoef,
      entropyCoef: CONFIG.rl.entropyCoef,
      adam: CONFIG.rl.adam,
    });
    this.avgEntropy = this.episodesTrained === 1 ? avgEntropy : this.avgEntropy * 0.95 + avgEntropy * 0.05;
  }

  public toJSON(): AgentJSON {
    return {
      network: this.network.toJSON(),
      episodesTrained: this.episodesTrained,
      avgReward: this.avgReward,
      avgEntropy: this.avgEntropy,
    };
  }

  public static fromJSON(data: AgentJSON): SpeciesAgent {
    const agent = new SpeciesAgent(ActorCriticNetwork.fromJSON(data.network));
    agent.episodesTrained = data.episodesTrained;
    agent.avgReward = data.avgReward;
    agent.avgEntropy = data.avgEntropy ?? 0;
    return agent;
  }
}
