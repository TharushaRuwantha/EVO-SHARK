import { CONFIG } from '../config';
import { Creature } from '../creature';
import { World } from '../world';
import { CreatureInput } from '../creature';
import { SpeciesAgent } from './agent';
import { ForwardResult } from './network';
import { buildObservation, OBS_SIZE } from './perception';
import { actionToInput } from './actions';
import {
  Checkpoint,
  GenerationRecord,
  SessionRecord,
  loadCheckpoint,
  saveCheckpoint,
  saveCheckpointBeacon,
} from './persistence';

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
  sharkAvgEntropy: number;
  fishAvgEntropy: number;
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

  // One entry per training "session": a continuous lineage that starts when
  // the network is freshly initialized and keeps accumulating history across
  // reloads for as long as checkpoints keep resuming into it. A fresh start
  // (no checkpoint, or an incompatible one -- see init()) begins a new one,
  // so this is what "compare with a previous session" means: distinct
  // training runs, not distinct page loads.
  private sessions: SessionRecord[] = [Trainer.newSession()];
  private static readonly MAX_HISTORY_PER_SESSION = 4000;

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

  private static newSession(): SessionRecord {
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: Date.now(),
      history: [],
    };
  }

  public async init(): Promise<void> {
    if (!this.persist) return;
    const checkpoint = await loadCheckpoint();
    if (!checkpoint) return;

    // A v1 checkpoint (REINFORCE policy-only network, no value head) isn't
    // shaped like today's actor-critic network and would silently produce
    // garbage if loaded as-is -- start fresh instead of crashing or running
    // with nonsense weights. Same guard, same reasoning, as the pre-existing
    // OBS_SIZE check below for an observation-layout change.
    if (checkpoint.version !== 2) {
      // eslint-disable-next-line no-console
      console.warn(
        `[Trainer] Ignoring checkpoint with version=${checkpoint.version} (expected 2, the actor-critic network format); starting fresh training.`
      );
      return;
    }

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
    // Resume the same lineage's history if the checkpoint has one; older
    // checkpoints saved before this field existed just keep the single
    // fresh session created in the constructor, so charts start recording
    // from here on rather than crashing or losing the resumed weights.
    if (checkpoint.sessions && checkpoint.sessions.length > 0) {
      this.sessions = checkpoint.sessions;
    }
  }

  /** All training sessions (distinct lineages) recorded so far, oldest first. */
  public getSessions(): readonly SessionRecord[] {
    return this.sessions;
  }

  private pushHistoryRecord(record: GenerationRecord): void {
    const session = this.sessions[this.sessions.length - 1];
    session.history.push(record);
    if (session.history.length > Trainer.MAX_HISTORY_PER_SESSION) {
      // Thin by half rather than drop the oldest half outright, so the
      // chart still spans the whole session, just at falling resolution the
      // longer training runs -- bounds memory/storage without a hard cutoff.
      session.history = session.history.filter((_, i) => i % 2 === 0);
    }
  }

  public buildCheckpoint(): Checkpoint {
    return {
      version: 2,
      generation: this.generation,
      totalSteps: this.totalSteps,
      savedAt: new Date().toISOString(),
      sessions: this.sessions,
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

    // Every shark shares one policy and every fish shares another, so their
    // observations are gathered per species and run through one batched
    // forward pass each (SpeciesAgent.actBatch) instead of calling the
    // network once per creature -- same math, far less per-call JS overhead.
    const sharkCreatures: Creature[] = [];
    const sharkObs: Float32Array[] = [];
    const fishCreatures: Creature[] = [];
    const fishObs: Float32Array[] = [];

    for (const creature of world.allAliveCreatures) {
      creatureById.set(creature.id, creature);
      foodEatenBefore.set(creature.id, creature.biteScore);
      cloneCountBefore.set(creature.id, creature.cloneCount);

      const obs = buildObservation(creature, world);
      if (creature.type === 'shark') {
        sharkCreatures.push(creature);
        sharkObs.push(obs);
      } else {
        fishCreatures.push(creature);
        fishObs.push(obs);
      }
    }

    const sharkResults = this.sharkAgent.actBatch(sharkObs);
    for (let i = 0; i < sharkCreatures.length; i++) {
      const creature = sharkCreatures[i];
      const { action, forward } = sharkResults[i];
      inputs.set(creature.id, actionToInput(action));
      actedThisTick.set(creature.id, { agent: this.sharkAgent, action, forward });
    }

    const fishResults = this.fishAgent.actBatch(fishObs);
    for (let i = 0; i < fishCreatures.length; i++) {
      const creature = fishCreatures[i];
      const { action, forward } = fishResults[i];
      inputs.set(creature.id, actionToInput(action));
      actedThisTick.set(creature.id, { agent: this.fishAgent, action, forward });
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

    // Snapshot before world.reset() clears ticks/population -- this is the
    // one row of training history this generation contributes to the chart.
    this.pushHistoryRecord({
      generation: this.generation,
      totalSteps: this.totalSteps,
      timestamp: Date.now(),
      durationTicks: this.world.ticks,
      sharkAvgReward: this.sharkAgent.avgReward,
      fishAvgReward: this.fishAgent.avgReward,
      sharkEntropy: this.sharkAgent.avgEntropy,
      fishEntropy: this.fishAgent.avgEntropy,
      sharkEpisodes: this.sharkAgent.episodesTrained,
      fishEpisodes: this.fishAgent.episodesTrained,
      sharkAliveEnd: this.world.aliveSharks.length,
      fishAliveEnd: this.world.aliveFish.length,
    });

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
      sharkAvgEntropy: this.sharkAgent.avgEntropy,
      fishAvgEntropy: this.fishAgent.avgEntropy,
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
