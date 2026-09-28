import { AgentJSON } from './agent';

export interface Checkpoint {
  version: 1;
  generation: number;
  totalSteps: number;
  savedAt: string;
  shark: AgentJSON;
  fish: AgentJSON;
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
