/**
 * Web Audio sound synthesizer for procedural aquatic sound effects.
 * Requires no external audio assets or network requests.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  public isMuted: boolean = false;

  // Precomputed noise buffers, built once and reused across every play call
  // instead of allocating a fresh Float32Array + Math.random() fill each
  // time. With dozens of AI-controlled creatures biting every tick this was
  // a real allocation hot path.
  private noiseBufferCache: Map<string, AudioBuffer> = new Map();

  // Per-sound throttle: with many creatures acting per physics tick, the
  // same effect can otherwise fire dozens of times in a single frame,
  // stacking up audio nodes for no audible benefit. Skip a repeat play of
  // the same sound within this window.
  private lastPlayedAt: Map<string, number> = new Map();
  private static readonly THROTTLE_MS = 45;

  private initCtx(): AudioContext | null {
    if (this.isMuted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Returns true (and records the play) if `key` is allowed to play now;
   * false if it played too recently and should be skipped.
   */
  private shouldPlay(key: string): boolean {
    const now = performance.now();
    const last = this.lastPlayedAt.get(key) ?? -Infinity;
    if (now - last < SoundManager.THROTTLE_MS) return false;
    this.lastPlayedAt.set(key, now);
    return true;
  }

  private getNoiseBuffer(ctx: AudioContext, key: string, durationSec: number, decay: boolean): AudioBuffer {
    let buffer = this.noiseBufferCache.get(key);
    if (!buffer) {
      const bufferSize = Math.floor(ctx.sampleRate * durationSec);
      buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        const raw = Math.random() * 2 - 1;
        output[i] = decay ? raw * Math.exp(-i / (ctx.sampleRate * 0.05)) : raw;
      }
      this.noiseBufferCache.set(key, buffer);
    }
    return buffer;
  }

  /**
   * Powerful aquatic jaw snapping / crunch sound for Shark bite
   */
  public playBiteChomp(): void {
    if (!this.shouldPlay('biteChomp')) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    const t = ctx.currentTime;

    // 1. Low frequency thump
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.18);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);

    // 2. High snap noise for teeth closure
    const noiseBuffer = this.getNoiseBuffer(ctx, 'biteChomp', 0.08, false);
    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.Q.setValueAtTime(3.0, t);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.005, t + 0.08);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    whiteNoise.start(t);
    whiteNoise.stop(t + 0.08);
  }

  /**
   * Crisp pop / nibble sound when small fish bites a plant
   */
  public playPlantNibble(): void {
    if (!this.shouldPlay('plantNibble')) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.07);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.14);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  /**
   * Sound when fish or shark bites floating meat remains
   */
  public playEatMeat(): void {
    if (!this.shouldPlay('eatMeat')) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.12);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /**
   * Dramatic aquatic crunch and dissipation when a small fish dies
   */
  public playFishDeath(): void {
    if (!this.shouldPlay('fishDeath')) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    const t = ctx.currentTime;

    // Low rumble / impact
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.28);

    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.005, t + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.28);

    // Burst noise
    const noiseBuffer = this.getNoiseBuffer(ctx, 'fishDeath', 0.15, true);
    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, t);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    whiteNoise.start(t);
    whiteNoise.stop(t + 0.15);
  }

  /**
   * Harmonious, triumphant chord when a creature creates a clone
   */
  public playClone(): void {
    if (!this.shouldPlay('clone')) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C Major chord
    notes.forEach((freq, idx) => {
      const t = ctx.currentTime + idx * 0.06;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.05, t + 0.25);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  }

  /**
   * Shimmering harmonic chime when plants are regenerated
   */
  public playRegenerate(): void {
    const ctx = this.initCtx();
    if (!ctx) return;

    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, idx) => {
      const t = ctx.currentTime + idx * 0.05;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  /**
   * Hydrodynamic whoosh when switching controlled creature
   */
  public playSwitchCreature(): void {
    const ctx = this.initCtx();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(450, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.2);

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }
}

export const sound = new SoundManager();
