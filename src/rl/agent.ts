import { CONFIG } from '../config';
import { ForwardResult, PolicyNetwork, PolicyNetworkJSON } from './network';
import { ACTION_COUNT } from './actions';
import { OBS_SIZE } from './perception';

export interface AgentJSON {
  network: PolicyNetworkJSON;
  baseline: number;
  episodesTrained: number;
  avgReward: number;
}

/**
 * One shared policy per species. Every living instance of that species
 * (e.g. every small fish) samples actions from the same network and
 * contributes its lifetime trajectory back into training — so the whole
 * population learns from everyone's experience at once.
 */
export class SpeciesAgent {
  public network: PolicyNetwork;
  private baseline: number = 0;
  public episodesTrained: number = 0;
  public avgReward: number = 0;

  constructor(network?: PolicyNetwork) {
    this.network = network ?? new PolicyNetwork(OBS_SIZE, CONFIG.rl.hiddenSize, ACTION_COUNT);
  }

  public act(obs: Float32Array): { action: number; forward: ForwardResult } {
    const forward = this.network.forward(obs);
    const action = this.network.sampleAction(forward.probs);
    return { action, forward };
  }

  /**
   * Trains on one completed creature "lifetime" (from spawn to death, or
   * truncated by a generation reset). Uses discounted returns with a
   * running baseline to reduce variance, then applies one policy-gradient
   * update for this trajectory.
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
    const baselineDecay = CONFIG.rl.baselineDecay;
    this.baseline = this.baseline === 0 ? returns[0] : this.baseline * baselineDecay + returns[0] * (1 - baselineDecay);
    this.avgReward = this.episodesTrained === 0 ? totalReward : this.avgReward * 0.95 + totalReward * 0.05;
    this.episodesTrained++;

    const trainingSteps = steps.map((s, i) => ({
      forward: s.forward,
      action: s.action,
      advantage: returns[i] - this.baseline,
    }));

    this.network.trainOnTrajectory(trainingSteps, CONFIG.rl.learningRate);
  }

  public toJSON(): AgentJSON {
    return {
      network: this.network.toJSON(),
      baseline: this.baseline,
      episodesTrained: this.episodesTrained,
      avgReward: this.avgReward,
    };
  }

  public static fromJSON(data: AgentJSON): SpeciesAgent {
    const agent = new SpeciesAgent(PolicyNetwork.fromJSON(data.network));
    agent.baseline = data.baseline;
    agent.episodesTrained = data.episodesTrained;
    agent.avgReward = data.avgReward;
    return agent;
  }
}
