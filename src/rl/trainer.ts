import { CONFIG } from '../config';
import { Creature } from '../creature';
import { World } from '../world';
import { CreatureInput } from '../creature';
import { SpeciesAgent } from './agent';
import { ForwardResult } from './network';
import { buildObservation, OBS_SIZE } from './perception';
import { actionToInput } from './actions';
import { Checkpoint, loadCheckpoint, saveCheckpoint, saveCheckpointBeacon } from './persistence';

interface PendingStep {
  forward: ForwardResult;
  action: number;
  reward: number;
}

export interface TrainerStats {
  generation: number;
  totalSteps: number;
  sharkAlive: number;
  fishAlive: number;
  sharkAvgReward: number;
  fishAvgReward: number;
  sharkEpisodes: number;
  fishEpisodes: number;
  resumedFromCheckpoint: boolean;
}

/**
 * Drives one World as a continual multi-agent reinforcement learning loop:
 * every alive shark/fish acts from its species' shared policy, rewards are
 * accumulated per-creature for as long as it stays alive, and finished
 * lifetimes (death, or a generation reset) are fed back into that species'
 * policy-gradient update. Both species going "extinct" (population 0) or a
 * safety time limit ends the generation and restarts the environment
 * automatically, without resetting the learned weights.
 */
export class Trainer {
  public world: World;
  public sharkAgent: SpeciesAgent;
  public fishAgent: SpeciesAgent;

  public generation: number = 0;
  public totalSteps: number = 0;
  public resumedFromCheckpoint: boolean = false;

  private pending: Map<number, PendingStep[]> = new Map();
  private readonly persist: boolean;
  private lastAutosave = 0;

  // Latest forward pass per creature, kept around only so the brain
  // visualizer can read what a creature "saw" and decided without the
  // renderer having to duplicate a forward pass itself. Entries are dropped
  // as soon as a creature's trajectory is flushed (death or gen reset).
  private lastForward: Map<number, { forward: ForwardResult; action: number }> = new Map();

  constructor(world: World, options: { persist: boolean } = { persist: true }) {
    this.world = world;
    this.sharkAgent = new SpeciesAgent();
    this.fishAgent = new SpeciesAgent();
    this.persist = options.persist;
  }

  public async init(): Promise<void> {
    if (!this.persist) return;
    const checkpoint = await loadCheckpoint();
    if (!checkpoint) return;

    // A checkpoint saved under a different observation layout (e.g. the
    // pre-refactor 16-input oracle sensors, or an earlier version of this
    // sensor suite before a since-fixed input count) can't be loaded into
    // today's OBS_SIZE-input network — start fresh instead of crashing or
    // silently running with garbage-shaped weights.
    const savedInputSize = checkpoint.shark?.network?.inputSize;
    if (savedInputSize !== OBS_SIZE) {
      // eslint-disable-next-line no-console
      console.warn(
        `[Trainer] Ignoring checkpoint with inputSize=${savedInputSize} (expected ${OBS_SIZE}); starting fresh training.`
      );
      return;
    }

    this.applyCheckpoint(checkpoint);
    this.resumedFromCheckpoint = true;
  }

  private applyCheckpoint(checkpoint: Checkpoint): void {
    this.sharkAgent = SpeciesAgent.fromJSON(checkpoint.shark);
    this.fishAgent = SpeciesAgent.fromJSON(checkpoint.fish);
    this.generation = checkpoint.generation;
    this.totalSteps = checkpoint.totalSteps;
  }

  public buildCheckpoint(): Checkpoint {
    return {
      version: 1,
      generation: this.generation,
      totalSteps: this.totalSteps,
      savedAt: new Date().toISOString(),
      shark: this.sharkAgent.toJSON(),
      fish: this.fishAgent.toJSON(),
    };
  }

  public async save(): Promise<boolean> {
    if (!this.persist) return false;
    return saveCheckpoint(this.buildCheckpoint());
  }

  /** Best-effort synchronous-ish save for page teardown (tab close, server stop). */
  public saveOnUnload(): void {
    if (!this.persist) return;
    saveCheckpointBeacon(this.buildCheckpoint());
  }

  private agentFor(creature: Creature): SpeciesAgent {
    return creature.type === 'shark' ? this.sharkAgent : this.fishAgent;
  }

  private flushCreature(creature: Creature, finalReward: number): void {
    const steps = this.pending.get(creature.id);
    this.pending.delete(creature.id);
    this.lastForward.delete(creature.id);
    if (!steps || steps.length === 0) return;
    steps[steps.length - 1].reward += finalReward;
    this.agentFor(creature).learnFromEpisode(steps);
  }

  /**
   * Advances the environment by one physics tick: every alive creature acts
   * from its species policy, the world steps, rewards are assigned, and
   * dead/reset creatures' trajectories are flushed into training.
   */
  public step(): TrainerStats {
    const world = this.world;
    const inputs = new Map<number, CreatureInput>();
    const actedThisTick = new Map<number, { agent: SpeciesAgent; action: number; forward: ForwardResult }>();

    // Built once per tick so the reward pass below can look a creature up by
    // id in O(1) instead of re-scanning (and reallocating) the full
    // sharks+fish array per acted creature. Safe to reuse after tickAI(): a
    // creature that dies this tick is mutated in place (isDead flips), not
    // replaced or removed from its array until its fade animation finishes
    // several ticks later, so these references stay valid.
    const creatureById = new Map<number, Creature>();
    const foodEatenBefore = new Map<number, number>();
    const cloneCountBefore = new Map<number, number>();

    for (const creature of world.allAliveCreatures) {
      creatureById.set(creature.id, creature);
      foodEatenBefore.set(creature.id, creature.biteScore);
      cloneCountBefore.set(creature.id, creature.cloneCount);

      const obs = buildObservation(creature, world);
      const agent = this.agentFor(creature);
      const { action, forward } = agent.act(obs);
      inputs.set(creature.id, actionToInput(action));
      actedThisTick.set(creature.id, { agent, action, forward });
    }

    const wasAlive = creatureById;

    world.tickAI(inputs);
    this.totalSteps++;

    // Assign rewards and record this tick's step for every creature that acted.
    for (const [id, acted] of actedThisTick) {
      const creature = creatureById.get(id);
      if (!creature) continue;

      let reward = 0;
      if (!creature.isDead) {
        reward += CONFIG.rl.perTickSurviveReward;
        if (creature.biteScore > (foodEatenBefore.get(id) ?? 0)) {
          reward += CONFIG.rl.eatReward;
        }
        if (creature.cloneCount > (cloneCountBefore.get(id) ?? 0)) {
          reward += CONFIG.rl.cloneReward;
        }
      }

      if (!this.pending.has(id)) this.pending.set(id, []);
      this.pending.get(id)!.push({ forward: acted.forward, action: acted.action, reward });
      this.lastForward.set(id, { forward: acted.forward, action: acted.action });

      if (creature.isDead && wasAlive.has(id)) {
        this.flushCreature(creature, CONFIG.rl.deathPenalty);
      }
    }

    const generationOver =
      world.isSharkExtinct || world.isFishExtinct || world.ticks >= CONFIG.rl.maxEpisodeTicks;

    if (generationOver) {
      this.endGeneration();
    }

    return this.getStats();
  }

  /** Manually ends the current generation early (e.g. a user-triggered reset). */
  public forceNewGeneration(): void {
    this.endGeneration();
  }

  private endGeneration(): void {
    // Flush every creature still alive at generation end (truncated episode, no death penalty).
    for (const creature of [...this.world.sharks, ...this.world.fishList]) {
      if (!creature.isDead) this.flushCreature(creature, 0);
    }
    this.pending.clear();
    this.lastForward.clear();

    this.generation++;
    this.world.reset();
  }

  /** The most recent forward pass + sampled action for a creature, if it acted this tick. */
  public getLastForward(creatureId: number): { forward: ForwardResult; action: number } | undefined {
    return this.lastForward.get(creatureId);
  }

  public getStats(): TrainerStats {
    return {
      generation: this.generation,
      totalSteps: this.totalSteps,
      sharkAlive: this.world.aliveSharks.length,
      fishAlive: this.world.aliveFish.length,
      sharkAvgReward: this.sharkAgent.avgReward,
      fishAvgReward: this.fishAgent.avgReward,
      sharkEpisodes: this.sharkAgent.episodesTrained,
      fishEpisodes: this.fishAgent.episodesTrained,
      resumedFromCheckpoint: this.resumedFromCheckpoint,
    };
  }

  public maybeAutosave(nowSec: number): void {
    if (!this.persist) return;
    if (nowSec - this.lastAutosave < CONFIG.rl.autosaveIntervalSec) return;
    this.lastAutosave = nowSec;
    void this.save();
  }
}
