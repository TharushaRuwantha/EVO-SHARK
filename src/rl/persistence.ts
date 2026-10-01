import { AgentJSON } from './agent';

/** One row of training history, recorded at the end of each generation. */
export interface GenerationRecord {
  generation: number;
  totalSteps: number;
  timestamp: number; // Date.now() when the generation ended
  durationTicks: number; // how long this generation lasted (ticks)
  sharkAvgReward: number;
  fishAvgReward: number;
  sharkEpisodes: number;
  fishEpisodes: number;
  sharkAliveEnd: number;
  fishAliveEnd: number;
}

/**
 * One continuous training lineage: starts when the network is freshly
 * initialized (no checkpoint to resume, or an incompatible one) and keeps
 * accumulating `history` across page reloads/server restarts for as long as
 * checkpoints keep resuming into it. A new session only starts when training
 * actually restarts from scratch -- so this is the unit "compare with a
 * previous session" means: a distinct training run, not a distinct page load.
 */
export interface SessionRecord {
  id: string;
  startedAt: number; // Date.now() when this session's network was created
  label?: string;
  history: GenerationRecord[];
}

export interface Checkpoint {
  version: 1;
  generation: number;
  totalSteps: number;
  savedAt: string;
  shark: AgentJSON;
  fish: AgentJSON;
  // Optional: absent on checkpoints saved before this field existed.
  sessions?: SessionRecord[];
}

const CHECKPOINT_URL = '/api/checkpoint';

/**
 * Loads the last saved checkpoint from the local save-server, if any.
 * Returns null if there is nothing saved yet or the save-server isn't
 * running (e.g. `npm run server` wasn't started).
 */
export async function loadCheckpoint(): Promise<Checkpoint | null> {
  try {
    const res = await fetch(CHECKPOINT_URL, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return data as Checkpoint;
  } catch {
    return null;
  }
}

/**
 * Persists a checkpoint via POST so training (episode count, rewards, and
 * both networks' weights) survives the dev/save-server or browser tab
 * being restarted. Always a POST — the server treats the body as the new
 * checkpoint to write to disk.
 */
export async function saveCheckpoint(checkpoint: Checkpoint): Promise<boolean> {
  try {
    const res = await fetch(CHECKPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkpoint),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort save used from 'pagehide'/'visibilitychange' handlers, where
 * the page may be torn down before a normal fetch() would complete.
 * sendBeacon still issues a POST under the hood.
 */
export function saveCheckpointBeacon(checkpoint: Checkpoint): void {
  try {
    const blob = new Blob([JSON.stringify(checkpoint)], { type: 'application/json' });
    navigator.sendBeacon(CHECKPOINT_URL, blob);
  } catch {
    // Best-effort only; ignore failures during teardown.
  }
}
