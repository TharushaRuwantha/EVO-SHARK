import { CONFIG } from './config';
import { PRNG } from './rng';
import { Obstacle, Point } from './obstacle';
import { World } from './world';
import { sound } from './audio';

export type PilotTarget = 'shark' | 'fish' | undefined;
export type SelectedActor = 'shark' | 'fish' | 'plant' | 'meat' | 'obstacle';

export class ActorShowcase {
  private container: HTMLElement;
  private world: World;
  private sampleRng: PRNG;
  private animFrameId: number | null = null;
  private activeRockVariant: 'small' | 'medium' | 'large' = 'medium';
  private sampleObstacle: Obstacle;
  private selectedActor: SelectedActor = 'shark';

  // Showcase animation states
  private sharkBiteProgress: number = 0;
  private isSharkBiting: boolean = false;
  private fishNibbleProgress: number = 0;
  private isFishNibbling: boolean = false;

  private onSwitchToSim: (target?: PilotTarget) => void;
  private onOpenFreeArena: () => void;

  constructor(
    container: HTMLElement,
    world: World,
    onSwitchToSim: (target?: PilotTarget) => void,
    onOpenFreeArena: () => void = () => {}
  ) {
    this.container = container;
    this.world = world;
    this.onSwitchToSim = onSwitchToSim;
    this.onOpenFreeArena = onOpenFreeArena;
    this.sampleRng = new PRNG(9999);
    this.sampleObstacle = this.generateSampleRock('medium');

    this.renderDOM();
    this.startAnimationLoop();
  }

  private generateSampleRock(variant: 'small' | 'medium' | 'large'): Obstacle {
    let size: number;
    if (variant === 'small') size = this.sampleRng.range(40, 55);
    else if (variant === 'medium') size = this.sampleRng.range(80, 110);
    else size = this.sampleRng.range(140, 175);

    const radius = size / 2;
    const vertexCount = this.sampleRng.rangeInt(7, 12);
    const vertices: Point[] = [];
    const cx = 150;
    const cy = 130;

    let maxDist = 0;
    for (let i = 0; i < vertexCount; i++) {
      const angle = (i / vertexCount) * Math.PI * 2;
      const angleJitter = this.sampleRng.range(-0.15, 0.15);
      const radVariation = this.sampleRng.range(radius * 0.72, radius * 1.18);
      const vx = cx + Math.cos(angle + angleJitter) * radVariation;
      const vy = cy + Math.sin(angle + angleJitter) * radVariation;
      vertices.push({ x: vx, y: vy });

      const d = Math.hypot(vx - cx, vy - cy);
      if (d > maxDist) maxDist = d;
    }

    return {
      id: 9999,
      x: cx,
      y: cy,
      radius,
      boundingRadius: maxDist,
      vertices,
      blocksVision: true,
    };
  }

  private renderDOM(): void {
    this.container.innerHTML = `
      <div class="w-full h-full flex flex-col bg-[#050b16] text-slate-100 font-sans select-none overflow-hidden">

        <!-- ================= TOP HEADER ================= -->
        <header class="flex flex-wrap items-center justify-between gap-4 px-6 sm:px-10 py-5 border-b border-white/[0.06] bg-slate-950/70 backdrop-blur-md shrink-0 z-20">
          <div class="flex items-center gap-4">
            <div class="w-11 h-11 rounded-2xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center text-xl">
              🌊
            </div>
            <div>
              <h1 class="text-lg sm:text-xl font-bold tracking-tight text-slate-50">
                Ocean Simulation
              </h1>
              <p class="text-xs text-slate-400 mt-0.5 hidden sm:block">
                Choose an actor to preview its behavior, then launch a session below
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2.5">
            <button id="menu-btn-pilot-shark-top" class="px-3.5 py-2 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.07] hover:border-sky-400/40 text-slate-300 hover:text-sky-200 text-xs font-medium transition-all duration-150 cursor-pointer">
              🦈 Watch Shark
            </button>
            <button id="menu-btn-pilot-fish-top" class="px-3.5 py-2 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.07] hover:border-amber-400/40 text-slate-300 hover:text-amber-200 text-xs font-medium transition-all duration-150 cursor-pointer">
              🐟 Watch Fish
            </button>
            <div class="w-px h-6 bg-white/10 mx-1 hidden sm:block"></div>
            <button id="menu-btn-free-arena" title="Open an independent, unsaved copy of the training run for separate testing" class="px-3.5 py-2 rounded-xl bg-violet-500/10 border border-violet-400/30 hover:bg-violet-500/20 text-violet-200 text-xs font-semibold transition-all duration-150 cursor-pointer">
              🧪 Free Test Arena
            </button>
            <button id="menu-btn-enter-sim" class="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all duration-150 cursor-pointer shadow-lg shadow-cyan-500/20">
              🌊 Watch Live Training
            </button>
          </div>
        </header>

        <!-- ================= MAIN MENU BODY: SPLIT VIEW (LIST + DETAILS) ================= -->
        <main class="flex-1 flex flex-col md:flex-row overflow-hidden">

          <!-- LEFT COLUMN: ACTOR LIST -->
          <div class="w-full md:w-[360px] lg:w-[400px] border-r border-white/[0.06] p-6 flex flex-col gap-3 overflow-y-auto shrink-0">
            <div class="text-[11px] font-medium uppercase text-slate-500 tracking-wider pb-2 flex items-center justify-between">
              <span>Actors</span>
              <span class="text-slate-600 normal-case">Live preview</span>
            </div>

            <!-- 1. SHARK -->
            <button id="actor-item-shark" class="actor-menu-item group w-full p-4 rounded-2xl border border-sky-400/50 bg-sky-400/[0.07] flex items-center gap-4 text-left transition-all duration-150 cursor-pointer">
              <div class="relative w-14 h-14 rounded-full bg-slate-950/60 ring-1 ring-sky-400/30 overflow-hidden flex items-center justify-center shrink-0">
                <canvas id="icon-canvas-shark" width="80" height="80" class="w-full h-full block"></canvas>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <h2 class="text-base font-semibold text-slate-100">
                    Shark
                  </h2>
                  <span class="text-[10px] text-sky-300/70 shrink-0">1 apex</span>
                </div>
                <p class="text-xs text-slate-400 truncate mt-0.5">Predator · Space to chomp & kill</p>
              </div>
            </button>

            <!-- 2. S FISH -->
            <button id="actor-item-fish" class="actor-menu-item group w-full p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] flex items-center gap-4 text-left transition-all duration-150 cursor-pointer">
              <div class="relative w-14 h-14 rounded-full bg-slate-950/60 ring-1 ring-white/10 overflow-hidden flex items-center justify-center shrink-0">
                <canvas id="icon-canvas-fish" width="80" height="80" class="w-full h-full block"></canvas>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <h2 class="text-base font-semibold text-slate-100">
                    Small Fish
                  </h2>
                  <span class="text-[10px] text-amber-300/70 shrink-0">20 alive</span>
                </div>
                <p class="text-xs text-slate-400 truncate mt-0.5">Forager · Hides under plants</p>
              </div>
            </button>

            <!-- 3. PLANT -->
            <button id="actor-item-plant" class="actor-menu-item group w-full p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] flex items-center gap-4 text-left transition-all duration-150 cursor-pointer">
              <div class="relative w-14 h-14 rounded-full bg-slate-950/60 ring-1 ring-white/10 overflow-hidden flex items-center justify-center shrink-0">
                <canvas id="icon-canvas-plant" width="80" height="80" class="w-full h-full block"></canvas>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <h2 class="text-base font-semibold text-slate-100">
                    Plant
                  </h2>
                  <span id="label-plant-count" class="text-[10px] text-emerald-300/70 shrink-0">Flora</span>
                </div>
                <p class="text-xs text-slate-400 truncate mt-0.5">Bioluminescent · Provides camouflage</p>
              </div>
            </button>

            <!-- 4. FISH REMAINS -->
            <button id="actor-item-meat" class="actor-menu-item group w-full p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] flex items-center gap-4 text-left transition-all duration-150 cursor-pointer">
              <div class="relative w-14 h-14 rounded-full bg-slate-950/60 ring-1 ring-white/10 overflow-hidden flex items-center justify-center shrink-0">
                <canvas id="icon-canvas-meat" width="80" height="80" class="w-full h-full block"></canvas>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <h2 class="text-base font-semibold text-slate-100">
                    Fish Remains
                  </h2>
                  <span class="text-[10px] text-rose-300/70 shrink-0">Meat</span>
                </div>
                <p class="text-xs text-slate-400 truncate mt-0.5">Dropped on death · Scavenged by all</p>
              </div>
            </button>

            <!-- 5. REEF ROCKS -->
            <button id="actor-item-obstacle" class="actor-menu-item group w-full p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] flex items-center gap-4 text-left transition-all duration-150 cursor-pointer">
              <div class="relative w-14 h-14 rounded-full bg-slate-950/60 ring-1 ring-white/10 overflow-hidden flex items-center justify-center shrink-0">
                <canvas id="icon-canvas-obstacle" width="80" height="80" class="w-full h-full block"></canvas>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <h2 class="text-base font-semibold text-slate-100">
                    Reef Rock
                  </h2>
                  <span class="text-[10px] text-slate-400 shrink-0">Barrier</span>
                </div>
                <p class="text-xs text-slate-400 truncate mt-0.5">Solid formation · Blocks line of sight</p>
              </div>
            </button>
          </div>

          <!-- RIGHT COLUMN: ACTOR DETAILS VIEW -->
          <div class="flex-1 p-8 sm:p-12 overflow-y-auto">

            <!-- DETAIL 1: SHARK DETAILS -->
            <div id="detail-panel-shark" class="actor-detail-panel flex flex-col gap-8 max-w-3xl mx-auto">
              <div class="flex flex-wrap items-center justify-between gap-5">
                <div class="flex items-center gap-4">
                  <span class="text-3xl">🦈</span>
                  <div>
                    <h3 class="text-xl font-bold text-slate-50">The Shark</h3>
                    <p class="text-xs text-slate-500 mt-0.5">Apex predator · AI-controlled, trained to survive</p>
                  </div>
                </div>
                <div class="flex items-center gap-2.5">
                  <button id="btn-detail-shark-bite" class="px-3.5 py-2 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.07] text-slate-300 text-xs font-medium cursor-pointer transition-all duration-150">
                    💥 Test Chomp
                  </button>
                  <button id="btn-detail-pilot-shark" class="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs cursor-pointer transition-all duration-150 shadow-lg shadow-sky-500/20">
                    Watch Shark →
                  </button>
                </div>
              </div>

              <!-- Live Preview Stage -->
              <div class="relative w-full h-64 sm:h-72 bg-slate-950/40 rounded-3xl border border-white/[0.06] flex items-center justify-center overflow-hidden">
                <canvas id="canvas-shark-preview" class="w-full h-full"></canvas>
                <div class="absolute bottom-4 right-5 text-[10px] tracking-wide text-slate-500">
                  LIVE · JAW & TAIL PHYSICS
                </div>
              </div>

              <!-- Must Bite Notice -->
              <div class="p-4 rounded-2xl bg-rose-500/[0.06] border border-rose-400/15 flex items-start gap-4 text-sm">
                <span class="text-xl mt-0.5">💥</span>
                <p class="text-slate-300 leading-relaxed">
                  <strong class="text-rose-300 font-semibold">Must bite to kill.</strong> Simply swimming into small fish does not kill them — the shark must press <span class="text-rose-300 font-medium">Space</span> when in range to chomp. A connected bite kills instantly and drops 3 drifting meat chunks.
                </p>
              </div>

              <!-- Specs Table -->
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Speed / Thrust</span>
                  <span class="font-semibold text-slate-100 text-sm">190 u/s · 350 u/s²</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Prey Source</span>
                  <span class="font-semibold text-slate-100 text-sm">Small fish & meat</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Cloning Goal</span>
                  <span class="font-semibold text-slate-100 text-sm">Eat 2 foods</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Radius / Mass</span>
                  <span class="font-semibold text-slate-100 text-sm">14 u / 2.5 kg</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Movement</span>
                  <span class="font-semibold text-slate-100 text-sm">Learned policy network</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Starves Without Food</span>
                  <span class="font-semibold text-slate-100 text-sm">Yes — energy drains over time</span>
                </div>
              </div>
            </div>

            <!-- DETAIL 2: SMALL FISH DETAILS -->
            <div id="detail-panel-fish" class="actor-detail-panel hidden flex flex-col gap-8 max-w-3xl mx-auto">
              <div class="flex flex-wrap items-center justify-between gap-5">
                <div class="flex items-center gap-4">
                  <span class="text-3xl">🐟</span>
                  <div>
                    <h3 class="text-xl font-bold text-slate-50">Small Fish</h3>
                    <p class="text-xs text-slate-500 mt-0.5">Forager · AI-controlled, trained to survive</p>
                  </div>
                </div>
                <div class="flex items-center gap-2.5">
                  <button id="btn-detail-fish-nibble" class="px-3.5 py-2 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.07] text-slate-300 text-xs font-medium cursor-pointer transition-all duration-150">
                    🌿 Test Nibble
                  </button>
                  <button id="btn-detail-pilot-fish" class="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs cursor-pointer transition-all duration-150 shadow-lg shadow-amber-500/20">
                    Watch Fish →
                  </button>
                </div>
              </div>

              <!-- Live Preview Stage -->
              <div class="relative w-full h-64 sm:h-72 bg-slate-950/40 rounded-3xl border border-white/[0.06] flex items-center justify-center overflow-hidden">
                <canvas id="canvas-fish-preview" class="w-full h-full"></canvas>
                <div class="absolute bottom-4 right-5 text-[10px] tracking-wide text-slate-500">
                  LIVE · CAUDAL FIN & MOUTH
                </div>
              </div>

              <!-- Camouflage & Still Notice -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="p-4 rounded-2xl bg-emerald-500/[0.06] border border-emerald-400/15 flex items-start gap-3 text-sm">
                  <span class="text-xl mt-0.5">🌿</span>
                  <p class="text-slate-300 leading-relaxed">
                    <strong class="text-emerald-300 font-semibold">Flora camouflage.</strong> Inside foliage, a shark's targeting range drops by 65% — fish become nearly invisible.
                  </p>
                </div>
                <div class="p-4 rounded-2xl bg-amber-500/[0.06] border border-amber-400/15 flex items-start gap-3 text-sm">
                  <span class="text-xl mt-0.5">🧠</span>
                  <p class="text-slate-300 leading-relaxed">
                    <strong class="text-amber-300 font-semibold">Learns to flee.</strong> Every fish shares one policy network, trained purely on staying alive — avoiding sharks and finding food.
                  </p>
                </div>
              </div>

              <!-- Specs Table -->
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Speed / Thrust</span>
                  <span class="font-semibold text-slate-100 text-sm">220 u/s · 420 u/s²</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Start Population</span>
                  <span class="font-semibold text-slate-100 text-sm">20 small fish</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Cloning Threshold</span>
                  <span class="font-semibold text-slate-100 text-sm">Eat 3 foods</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Diet</span>
                  <span class="font-semibold text-slate-100 text-sm">Plants & meat</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Feeding Action</span>
                  <span class="font-semibold text-slate-100 text-sm">Space to bite</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Cycle Hotkey</span>
                  <span class="font-semibold text-slate-100 text-sm">Tab or key 2</span>
                </div>
              </div>
            </div>

            <!-- DETAIL 3: PLANT DETAILS -->
            <div id="detail-panel-plant" class="actor-detail-panel hidden flex flex-col gap-8 max-w-3xl mx-auto">
              <div class="flex flex-wrap items-center justify-between gap-5">
                <div class="flex items-center gap-4">
                  <span class="text-3xl">🌿</span>
                  <div>
                    <h3 class="text-xl font-bold text-slate-50">Marine Flora</h3>
                    <p class="text-xs text-slate-500 mt-0.5">Bioluminescent · propagates every 4s</p>
                  </div>
                </div>
                <div class="flex items-center gap-2.5">
                  <button id="btn-detail-burst-plant" class="px-3.5 py-2 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.07] text-slate-300 text-xs font-medium cursor-pointer transition-all duration-150">
                    ✨ Burst +30
                  </button>
                  <button id="btn-detail-regen-plant" class="px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs cursor-pointer transition-all duration-150 shadow-lg shadow-emerald-500/20">
                    🌱 Regenerate
                  </button>
                </div>
              </div>

              <!-- Live Preview Stage -->
              <div class="relative w-full h-64 sm:h-72 bg-slate-950/40 rounded-3xl border border-white/[0.06] flex items-center justify-center overflow-hidden">
                <canvas id="canvas-plant-preview" class="w-full h-full"></canvas>
                <div id="plant-active-count-badge" class="absolute top-4 left-5 text-xs bg-slate-950/70 px-3 py-1.5 rounded-full border border-white/10 text-slate-300">
                  Active flora: <span id="plant-active-count" class="font-semibold text-emerald-300">0</span>
                </div>
                <div class="absolute bottom-4 right-5 text-[10px] tracking-wide text-slate-500">
                  LIVE · CURRENT FLOW & BLOOM
                </div>
              </div>

              <!-- Camouflage Feature Banner -->
              <div class="p-4 rounded-2xl bg-emerald-500/[0.06] border border-emerald-400/15 flex items-start gap-4 text-sm">
                <span class="text-xl mt-0.5">🌿</span>
                <p class="text-slate-300 leading-relaxed">
                  <strong class="text-emerald-300 font-semibold">Camouflage layer.</strong> Plants render above small fish; hidden fish dim and can't be targeted from outside the foliage — a shark has to swim right into it to find them.
                </p>
              </div>

              <!-- Specs Table -->
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Spawn Interval</span>
                  <span class="font-semibold text-slate-100 text-sm">Every 4.0s</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Nutrition</span>
                  <span class="font-semibold text-slate-100 text-sm">+25 energy</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Eating Condition</span>
                  <span class="font-semibold text-slate-100 text-sm">Must bite</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Cover Radius</span>
                  <span class="font-semibold text-slate-100 text-sm">24 units</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Predator Reduction</span>
                  <span class="font-semibold text-slate-100 text-sm">65% range drop</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06] flex items-center justify-between">
                  <span class="text-slate-500 text-[11px]">Reset</span>
                  <button id="btn-clear-plants" class="text-rose-300 hover:text-rose-200 text-sm font-medium cursor-pointer">Clear all</button>
                </div>
              </div>
            </div>

            <!-- DETAIL 4: FISH REMAINS DETAILS -->
            <div id="detail-panel-meat" class="actor-detail-panel hidden flex flex-col gap-8 max-w-3xl mx-auto">
              <div class="flex flex-wrap items-center justify-between gap-5">
                <div class="flex items-center gap-4">
                  <span class="text-3xl">🥩</span>
                  <div>
                    <h3 class="text-xl font-bold text-slate-50">Fish Remains</h3>
                    <p class="text-xs text-slate-500 mt-0.5">Spawned on shark kill · scavenged by all</p>
                  </div>
                </div>
              </div>

              <!-- Live Preview Stage -->
              <div class="relative w-full h-64 sm:h-72 bg-slate-950/40 rounded-3xl border border-white/[0.06] flex items-center justify-center overflow-hidden">
                <canvas id="canvas-meat-preview" class="w-full h-full"></canvas>
                <div class="absolute bottom-4 right-5 text-[10px] tracking-wide text-slate-500">
                  LIVE · BUOYANCY & DRIFT
                </div>
              </div>

              <!-- Scavenging Banner -->
              <div class="p-4 rounded-2xl bg-amber-500/[0.06] border border-amber-400/15 flex items-start gap-4 text-sm">
                <span class="text-xl mt-0.5">🥩</span>
                <p class="text-slate-300 leading-relaxed">
                  <strong class="text-amber-300 font-semibold">Nutritious for both.</strong> Killing a small fish drops 3 chunks of meat. Sharks (+50 pts) and small fish (+40 pts) can both scavenge them toward cloning.
                </p>
              </div>

              <!-- Specs Table -->
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Origin</span>
                  <span class="font-semibold text-slate-100 text-sm">Shark kills fish</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Chunks Spawned</span>
                  <span class="font-semibold text-slate-100 text-sm">3 per kill</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Consumable By</span>
                  <span class="font-semibold text-slate-100 text-sm">Shark & fish</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Shark Value</span>
                  <span class="font-semibold text-slate-100 text-sm">+50 pts (1/2 clone)</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Fish Value</span>
                  <span class="font-semibold text-slate-100 text-sm">+40 pts (1/3 clone)</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Decay Time</span>
                  <span class="font-semibold text-slate-100 text-sm">50 seconds</span>
                </div>
              </div>
            </div>

            <!-- DETAIL 5: REEF OBSTACLE DETAILS -->
            <div id="detail-panel-obstacle" class="actor-detail-panel hidden flex flex-col gap-8 max-w-3xl mx-auto">
              <div class="flex flex-wrap items-center justify-between gap-5">
                <div class="flex items-center gap-4">
                  <span class="text-3xl">🪨</span>
                  <div>
                    <h3 class="text-xl font-bold text-slate-50">Reef Formations</h3>
                    <p class="text-xs text-slate-500 mt-0.5">Solid barrier · blocks line of sight</p>
                  </div>
                </div>
                <div class="flex items-center gap-2.5">
                  <div class="flex items-center bg-white/[0.03] p-1 rounded-xl border border-white/10 text-xs">
                    <button id="btn-rock-small" class="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition-colors duration-150 cursor-pointer">Small</button>
                    <button id="btn-rock-medium" class="px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 transition-colors duration-150 cursor-pointer">Medium</button>
                    <button id="btn-rock-large" class="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition-colors duration-150 cursor-pointer">Large</button>
                  </div>
                  <button id="btn-rock-new" class="px-3.5 py-2 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.07] text-slate-300 text-xs font-medium cursor-pointer transition-all duration-150">
                    🎲 Randomize
                  </button>
                </div>
              </div>

              <!-- Live Preview Stage -->
              <div class="relative w-full h-64 sm:h-72 bg-slate-950/40 rounded-3xl border border-white/[0.06] flex items-center justify-center overflow-hidden">
                <canvas id="canvas-obstacle-preview" class="w-full h-full"></canvas>
                <div class="absolute bottom-4 right-5 text-[10px] tracking-wide text-slate-500">
                  LIVE · PROCEDURAL GEOMETRY
                </div>
              </div>

              <!-- Specs Table -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Total in World</span>
                  <span class="font-semibold text-slate-100 text-sm">15–25</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Size Mix</span>
                  <span class="font-semibold text-slate-100 text-sm">60/30/10%</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Min Spacing</span>
                  <span class="font-semibold text-slate-100 text-sm">80 units</span>
                </div>
                <div class="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
                  <span class="text-slate-500 block text-[11px] mb-1">Vision Block</span>
                  <span class="font-semibold text-slate-100 text-sm">100%</span>
                </div>
              </div>
            </div>

          </div>

        </main>

        <!-- ================= BOTTOM STATUS FOOTER ================= -->
        <footer class="px-6 sm:px-10 py-4 border-t border-white/[0.06] bg-slate-950/70 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500 shrink-0">
          <div class="flex items-center gap-3 flex-wrap">
            <span class="flex items-center gap-1.5">🤖 Every creature is AI-controlled — trained to survive</span>
            <span class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300">M</kbd> Menu</span>
            <span class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300">R</kbd> New Gen</span>
          </div>
          <button id="footer-btn-dive" class="text-cyan-300 hover:text-cyan-200 font-medium cursor-pointer transition-colors duration-150">
            Watch Live Training →
          </button>
        </footer>

      </div>
    `;

    this.bindEvents();
    this.selectActor('shark');
  }

  public selectActor(actor: SelectedActor): void {
    this.selectedActor = actor;

    const items: Record<SelectedActor, HTMLElement | null> = {
      shark: this.container.querySelector('#actor-item-shark'),
      fish: this.container.querySelector('#actor-item-fish'),
      plant: this.container.querySelector('#actor-item-plant'),
      meat: this.container.querySelector('#actor-item-meat'),
      obstacle: this.container.querySelector('#actor-item-obstacle'),
    };

    const panels: Record<SelectedActor, HTMLElement | null> = {
      shark: this.container.querySelector('#detail-panel-shark'),
      fish: this.container.querySelector('#detail-panel-fish'),
      plant: this.container.querySelector('#detail-panel-plant'),
      meat: this.container.querySelector('#detail-panel-meat'),
      obstacle: this.container.querySelector('#detail-panel-obstacle'),
    };

    const activeStyles: Record<SelectedActor, string[]> = {
      shark: ['border-sky-400/50', 'bg-sky-400/[0.07]'],
      fish: ['border-amber-400/50', 'bg-amber-400/[0.07]'],
      plant: ['border-emerald-400/50', 'bg-emerald-400/[0.07]'],
      meat: ['border-rose-400/50', 'bg-rose-400/[0.07]'],
      obstacle: ['border-slate-300/50', 'bg-slate-300/[0.07]'],
    };
    const inactiveStyles = ['border-white/[0.06]', 'bg-white/[0.02]'];

    (Object.keys(items) as SelectedActor[]).forEach((key) => {
      const item = items[key];
      const panel = panels[key];

      // Remove active borders/bgs
      activeStyles[key].forEach((cls) => item?.classList.remove(cls));
      item?.classList.add(...inactiveStyles);

      if (key === actor) {
        item?.classList.remove(...inactiveStyles);
        activeStyles[key].forEach((cls) => item?.classList.add(cls));
        panel?.classList.remove('hidden');
      } else {
        panel?.classList.add('hidden');
      }
    });
  }

  private bindEvents(): void {
    // Actor menu item clicks
    this.container.querySelector('#actor-item-shark')?.addEventListener('click', () => this.selectActor('shark'));
    this.container.querySelector('#actor-item-fish')?.addEventListener('click', () => this.selectActor('fish'));
    this.container.querySelector('#actor-item-plant')?.addEventListener('click', () => this.selectActor('plant'));
    this.container.querySelector('#actor-item-meat')?.addEventListener('click', () => this.selectActor('meat'));
    this.container.querySelector('#actor-item-obstacle')?.addEventListener('click', () => this.selectActor('obstacle'));

    // Top Launch Buttons
    this.container.querySelector('#menu-btn-enter-sim')?.addEventListener('click', () => this.onSwitchToSim());
    this.container.querySelector('#footer-btn-dive')?.addEventListener('click', () => this.onSwitchToSim());
    this.container.querySelector('#menu-btn-free-arena')?.addEventListener('click', () => this.onOpenFreeArena());

    this.container.querySelector('#menu-btn-pilot-shark-top')?.addEventListener('click', () => this.onSwitchToSim('shark'));
    this.container.querySelector('#btn-detail-pilot-shark')?.addEventListener('click', () => this.onSwitchToSim('shark'));

    this.container.querySelector('#menu-btn-pilot-fish-top')?.addEventListener('click', () => this.onSwitchToSim('fish'));
    this.container.querySelector('#btn-detail-pilot-fish')?.addEventListener('click', () => this.onSwitchToSim('fish'));

    // Interactive Action Buttons
    this.container.querySelector('#btn-detail-shark-bite')?.addEventListener('click', () => {
      this.triggerShowcaseSharkBite();
    });

    this.container.querySelector('#btn-detail-fish-nibble')?.addEventListener('click', () => {
      this.triggerShowcaseFishNibble();
    });

    this.container.querySelector('#btn-detail-burst-plant')?.addEventListener('click', () => {
      this.world.triggerPlantBurst(30);
      this.updatePlantCount();
    });

    this.container.querySelector('#btn-detail-regen-plant')?.addEventListener('click', () => {
      this.world.triggerRegeneratePlants();
      this.updatePlantCount();
    });

    this.container.querySelector('#btn-clear-plants')?.addEventListener('click', () => {
      this.world.clearAllPlants();
      this.updatePlantCount();
    });

    // Rock Variant Buttons
    const btnSmall = this.container.querySelector('#btn-rock-small');
    const btnMedium = this.container.querySelector('#btn-rock-medium');
    const btnLarge = this.container.querySelector('#btn-rock-large');
    const btnNew = this.container.querySelector('#btn-rock-new');

    const updateRockButtons = () => {
      [btnSmall, btnMedium, btnLarge].forEach((b) => {
        b?.classList.remove('border-cyan-500', 'bg-cyan-950', 'text-cyan-300');
        b?.classList.add('border-transparent', 'text-slate-400');
      });
      if (this.activeRockVariant === 'small') {
        btnSmall?.classList.add('border-cyan-500', 'bg-cyan-950', 'text-cyan-300');
        btnSmall?.classList.remove('border-transparent', 'text-slate-400');
      } else if (this.activeRockVariant === 'medium') {
        btnMedium?.classList.add('border-cyan-500', 'bg-cyan-950', 'text-cyan-300');
        btnMedium?.classList.remove('border-transparent', 'text-slate-400');
      } else {
        btnLarge?.classList.add('border-cyan-500', 'bg-cyan-950', 'text-cyan-300');
        btnLarge?.classList.remove('border-transparent', 'text-slate-400');
      }
    };

    btnSmall?.addEventListener('click', () => {
      this.activeRockVariant = 'small';
      this.sampleObstacle = this.generateSampleRock('small');
      updateRockButtons();
    });

    btnMedium?.addEventListener('click', () => {
      this.activeRockVariant = 'medium';
      this.sampleObstacle = this.generateSampleRock('medium');
      updateRockButtons();
    });

    btnLarge?.addEventListener('click', () => {
      this.activeRockVariant = 'large';
      this.sampleObstacle = this.generateSampleRock('large');
      updateRockButtons();
    });

    btnNew?.addEventListener('click', () => {
      this.sampleObstacle = this.generateSampleRock(this.activeRockVariant);
    });

    this.updatePlantCount();
  }

  public updatePlantCount(): void {
    const countEl = this.container.querySelector('#plant-active-count');
    const labelCount = this.container.querySelector('#label-plant-count');
    if (countEl) {
      countEl.textContent = this.world.plants.length.toString();
    }
    if (labelCount) {
      labelCount.textContent = `${this.world.plants.length} Flora`;
    }
  }

  public triggerShowcaseSharkBite(): void {
    this.isSharkBiting = true;
    this.sharkBiteProgress = 0.01;
    sound.playBiteChomp();
  }

  public triggerShowcaseFishNibble(): void {
    this.isFishNibbling = true;
    this.fishNibbleProgress = 0.01;
    sound.playPlantNibble();
  }

  private startAnimationLoop(): void {
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;
      const timeSec = currentTime / 1000;

      if (this.isSharkBiting) {
        this.sharkBiteProgress += dt / 0.35;
        if (this.sharkBiteProgress >= 1) {
          this.isSharkBiting = false;
          this.sharkBiteProgress = 0;
        }
      }

      if (this.isFishNibbling) {
        this.fishNibbleProgress += dt / 0.25;
        if (this.fishNibbleProgress >= 1) {
          this.isFishNibbling = false;
          this.fishNibbleProgress = 0;
        }
      }

      // Draw all circular icon animations in the left list (matches user drawing!)
      this.drawSharkIcon(timeSec);
      this.drawFishIcon(timeSec);
      this.drawPlantIcon(timeSec);
      this.drawMeatIcon(timeSec);
      this.drawObstacleIcon(timeSec);

      // Draw active detail preview on right
      if (this.selectedActor === 'shark') {
        this.drawSharkPreview(timeSec);
      } else if (this.selectedActor === 'fish') {
        this.drawFishPreview(timeSec);
      } else if (this.selectedActor === 'plant') {
        this.drawPlantPreview(timeSec);
      } else if (this.selectedActor === 'meat') {
        this.drawMeatPreview(timeSec);
      } else if (this.selectedActor === 'obstacle') {
        this.drawObstaclePreview(timeSec);
      }

      this.updatePlantCount();
      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  // ================= 1. SHARK ANIMATIONS =================
  private drawSharkPreview(time: number): void {
    const canvas = this.container.querySelector('#canvas-shark-preview') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(2.3, 2.3);

    const tailAngle = Math.sin(time * 5) * 0.22;
    this.drawSharkShowcase(ctx, tailAngle, this.sharkBiteProgress);
    ctx.restore();
  }

  private drawSharkIcon(time: number): void {
    const canvas = this.container.querySelector('#icon-canvas-shark') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);

    const scale = (canvas.width / 80) * 1.35;
    ctx.scale(scale, scale);

    const tailAngle = Math.sin(time * 5.2) * 0.25;
    this.drawSharkShowcase(ctx, tailAngle, this.sharkBiteProgress);
    ctx.restore();
  }

  private drawSharkShowcase(ctx: CanvasRenderingContext2D, tailAngle: number, biteProgress: number): void {
    ctx.fillStyle = CONFIG.colors.sharkDark;
    ctx.beginPath();
    ctx.moveTo(3, -12);
    ctx.lineTo(-9, -26);
    ctx.lineTo(-3, -9);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(3, 12);
    ctx.lineTo(-9, 26);
    ctx.lineTo(-3, 9);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(-18, 0);
    ctx.rotate(tailAngle);
    ctx.fillStyle = CONFIG.colors.sharkDark;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-18, -16);
    ctx.lineTo(-12, 0);
    ctx.lineTo(-16, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.bezierCurveTo(18, -14, -8, -14, -20, 0);
    ctx.bezierCurveTo(-8, 14, 18, 14, 26, 0);
    ctx.closePath();

    const sharkGrad = ctx.createLinearGradient(0, -14, 0, 14);
    sharkGrad.addColorStop(0, CONFIG.colors.shark);
    sharkGrad.addColorStop(0.5, '#3a536e');
    sharkGrad.addColorStop(1, CONFIG.colors.sharkDark);
    ctx.fillStyle = sharkGrad;
    ctx.fill();

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    if (biteProgress > 0) {
      const jawGap = Math.sin(biteProgress * Math.PI) * 16;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(26, 0);
      ctx.lineTo(16, -jawGap * 0.6);
      ctx.lineTo(12, 0);
      ctx.lineTo(16, jawGap * 0.6);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 4; i++) {
        const tx = 16 + i * 2.5;
        ctx.beginPath();
        ctx.moveTo(tx, -jawGap * 0.5);
        ctx.lineTo(tx + 1.2, 0);
        ctx.lineTo(tx + 2.4, -jawGap * 0.5);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(tx, jawGap * 0.5);
        ctx.lineTo(tx + 1.2, 0);
        ctx.lineTo(tx + 2.4, jawGap * 0.5);
        ctx.fill();
      }
    }

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(14, -6, 2.4, 0, Math.PI * 2);
    ctx.arc(14, 6, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(14.6, -6.5, 0.9, 0, Math.PI * 2);
    ctx.arc(14.6, 5.5, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // ================= 2. SMALL FISH ANIMATIONS =================
  private drawFishPreview(time: number): void {
    const canvas = this.container.querySelector('#canvas-fish-preview') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(3.4, 3.4);

    const tailAngle = Math.sin(time * 6) * 0.28;
    this.drawFishShowcase(ctx, tailAngle, this.fishNibbleProgress);
    ctx.restore();
  }

  private drawFishIcon(time: number): void {
    const canvas = this.container.querySelector('#icon-canvas-fish') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);

    const scale = (canvas.width / 80) * 2.2;
    ctx.scale(scale, scale);

    const tailAngle = Math.sin(time * 6.5) * 0.32;
    this.drawFishShowcase(ctx, tailAngle, this.fishNibbleProgress);
    ctx.restore();
  }

  private drawFishShowcase(ctx: CanvasRenderingContext2D, tailAngle: number, nibbleProgress: number): void {
    ctx.save();
    ctx.translate(-10, 0);
    ctx.rotate(tailAngle);
    ctx.fillStyle = CONFIG.colors.fishDark;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-8, -8);
    ctx.bezierCurveTo(-5, 0, -5, 0, -8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    let mouthOpen = 0;
    if (nibbleProgress > 0) {
      mouthOpen = Math.sin(nibbleProgress * Math.PI) * 3;
    }

    ctx.fillStyle = CONFIG.colors.fish;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.bezierCurveTo(7, -8 - mouthOpen, -4, -8, -10, 0);
    ctx.bezierCurveTo(-4, 8, 7, 8 + mouthOpen, 12, 0);
    ctx.closePath();
    ctx.fill();

    if (mouthOpen > 1) {
      ctx.fillStyle = '#7c2d12';
      ctx.beginPath();
      ctx.arc(11, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(6, -3, 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(6.8, -3, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // ================= 3. PLANT ANIMATIONS =================
  private drawPlantPreview(time: number): void {
    const canvas = this.container.querySelector('#canvas-plant-preview') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    const cx = canvas.width / 2;
    const baseY = canvas.height - 35;

    ctx.fillStyle = '#0a192f';
    ctx.fillRect(0, baseY, canvas.width, 35);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(canvas.width, baseY);
    ctx.stroke();

    const plants = [
      { x: cx - 80, height: 75, fronds: 4, swaySpeed: 1.5, phase: 0, tone: '#06b6d4', glow: '#00f5d4', label: 'Sea Anemone' },
      { x: cx,      height: 95, fronds: 5, swaySpeed: 1.8, phase: 1.2, tone: '#10b981', glow: '#5fff7a', label: 'Bioluminescent Kelp' },
      { x: cx + 80, height: 65, fronds: 3, swaySpeed: 2.1, phase: 2.5, tone: '#84cc16', glow: '#a3e635', label: 'Spore Fern' },
    ];

    for (const p of plants) {
      const sway = Math.sin(time * p.swaySpeed + p.phase) * 14;
      const tipX = p.x + sway;
      const tipY = baseY - p.height;
      const pulse = 1 + 0.18 * Math.sin(time * 2.5 + p.phase);
      const r = 9 * pulse;

      ctx.fillStyle = '#064e3b';
      ctx.beginPath();
      ctx.ellipse(p.x, baseY, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(p.x, baseY);
      ctx.quadraticCurveTo(p.x + sway * 0.4, baseY - p.height * 0.5, tipX, tipY);
      ctx.strokeStyle = p.tone;
      ctx.lineWidth = 3.5;
      ctx.stroke();

      for (let f = 1; f <= p.fronds; f++) {
        const ratio = f / (p.fronds + 1);
        const frondY = baseY - p.height * ratio;
        const frondBaseX = p.x + sway * ratio * 0.7;
        const side = f % 2 === 0 ? 1 : -1;
        const frondLength = 16 + ratio * 8;
        const frondTipX = frondBaseX + side * frondLength + Math.sin(time * 2 + f) * 4;
        const frondTipY = frondY - 8;

        ctx.beginPath();
        ctx.moveTo(frondBaseX, frondY);
        ctx.quadraticCurveTo(frondBaseX + side * 8, frondY - 10, frondTipX, frondTipY);
        ctx.strokeStyle = p.tone;
        ctx.lineWidth = 2.2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(frondTipX, frondTipY, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = p.glow;
        ctx.fill();
      }

      const grad = ctx.createRadialGradient(tipX, tipY, 1, tipX, tipY, r * 2.5);
      grad.addColorStop(0, p.glow);
      grad.addColorStop(0.5, 'rgba(0, 245, 212, 0.4)');
      grad.addColorStop(1, 'rgba(0, 245, 212, 0)');

      ctx.beginPath();
      ctx.arc(tipX, tipY, r * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(tipX, tipY, r, 0, Math.PI * 2);
      ctx.fillStyle = p.glow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(tipX - r * 0.25, tipY - r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      ctx.font = '9px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText(p.label, p.x, baseY + 18);
    }

    ctx.restore();
  }

  private drawPlantIcon(time: number): void {
    const canvas = this.container.querySelector('#icon-canvas-plant') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    const cx = canvas.width / 2;
    const baseY = canvas.height - 6;
    const height = canvas.height * 0.65;
    const sway = Math.sin(time * 2.2) * (canvas.width * 0.12);
    const tipX = cx + sway;
    const tipY = baseY - height;
    const pulse = 1 + 0.2 * Math.sin(time * 3);
    const r = (canvas.width * 0.1) * pulse;

    ctx.beginPath();
    ctx.moveTo(cx, baseY);
    ctx.quadraticCurveTo(cx + sway * 0.4, baseY - height * 0.5, tipX, tipY);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = Math.max(1.8, canvas.width * 0.04);
    ctx.stroke();

    for (let f = 1; f <= 3; f++) {
      const ratio = f / 4;
      const fy = baseY - height * ratio;
      const fbx = cx + sway * ratio * 0.7;
      const side = f % 2 === 0 ? 1 : -1;
      const fl = canvas.width * 0.2;
      const ftx = fbx + side * fl;
      const fty = fy - 4;

      ctx.beginPath();
      ctx.moveTo(fbx, fy);
      ctx.quadraticCurveTo(fbx + side * (fl * 0.5), fy - 6, ftx, fty);
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(ftx, fty, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = '#00f5d4';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(tipX, tipY, r * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 245, 212, 0.4)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(tipX, tipY, r, 0, Math.PI * 2);
    ctx.fillStyle = '#5fff7a';
    ctx.fill();

    ctx.restore();
  }

  // ================= 4. FISH REMAINS (MEAT CHUNKS) =================
  private drawMeatPreview(time: number): void {
    const canvas = this.container.querySelector('#canvas-meat-preview') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);

    const chunks = [
      { x: -45, y: Math.sin(time * 3) * 6, rot: time * 0.5, scale: 2.2 },
      { x: 35,  y: Math.sin(time * 3 + 1.5) * 8, rot: -time * 0.6, scale: 2.6 },
      { x: -5,  y: Math.sin(time * 2.8 + 3) * 7, rot: time * 0.4, scale: 1.8 },
    ];

    for (const chunk of chunks) {
      ctx.save();
      ctx.translate(chunk.x, chunk.y);
      ctx.rotate(chunk.rot);
      ctx.scale(chunk.scale, chunk.scale);

      const r = 8;
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -r * 0.4);
      ctx.lineTo(r * 0.7, -r * 0.6);
      ctx.lineTo(r * 1.1, r * 0.2);
      ctx.lineTo(r * 0.2, r * 0.8);
      ctx.lineTo(-r * 0.9, r * 0.5);
      ctx.closePath();

      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.strokeStyle = '#991b1b';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(-r * 0.1, 0, r * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = '#fef2f2';
      ctx.fill();

      ctx.restore();
    }

    ctx.restore();
  }

  private drawMeatIcon(time: number): void {
    const canvas = this.container.querySelector('#icon-canvas-meat') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);

    const scale = (canvas.width / 80) * 1.8;
    ctx.scale(scale, scale);

    const rot = Math.sin(time * 2) * 0.3;
    const bobY = Math.sin(time * 3.5) * 3;
    ctx.translate(0, bobY);
    ctx.rotate(rot);

    const r = 9;
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, -r * 0.4);
    ctx.lineTo(r * 0.7, -r * 0.6);
    ctx.lineTo(r * 1.1, r * 0.2);
    ctx.lineTo(r * 0.2, r * 0.8);
    ctx.lineTo(-r * 0.9, r * 0.5);
    ctx.closePath();

    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-r * 0.1, 0, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = '#fef2f2';
    ctx.fill();

    const b1Y = -12 - ((time * 20) % 20);
    const b1Alpha = 1 - ((-b1Y - 12) / 20);
    ctx.fillStyle = `rgba(254, 202, 202, ${Math.max(0, b1Alpha)})`;
    ctx.beginPath();
    ctx.arc(Math.sin(time * 3) * 4, b1Y, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ================= 5. OBSTACLE ANIMATIONS =================
  private drawObstaclePreview(time: number): void {
    const canvas = this.container.querySelector('#canvas-obstacle-preview') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2 - 150, canvas.height / 2 - 130);

    const verts = this.sampleObstacle.vertices;
    if (verts.length > 0) {
      ctx.beginPath();
      ctx.moveTo(verts[0].x + 8, verts[0].y + 8);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x + 8, verts[i].y + 8);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(100, 80, 200, 180);
      grad.addColorStop(0, '#5a6b63');
      grad.addColorStop(0.5, '#4a5a52');
      grad.addColorStop(1, '#27332d');
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < verts.length; i += 2) {
        ctx.moveTo(150, 130);
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawObstacleIcon(time: number): void {
    const canvas = this.container.querySelector('#icon-canvas-obstacle') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);

    const r = (canvas.width / 80) * 22;

    ctx.beginPath();
    ctx.moveTo(-r * 0.9, r * 0.3);
    ctx.lineTo(-r * 0.7, -r * 0.6);
    ctx.lineTo(r * 0.1, -r * 0.9);
    ctx.lineTo(r * 0.8, -r * 0.4);
    ctx.lineTo(r * 0.9, r * 0.5);
    ctx.lineTo(-r * 0.1, r * 0.9);
    ctx.closePath();

    const grad = ctx.createLinearGradient(-r, -r, r, r);
    grad.addColorStop(0, '#64748b');
    grad.addColorStop(0.6, '#334155');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.6);
    ctx.lineTo(0, 0);
    ctx.lineTo(r * 0.4, -r * 0.4);
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.1, r * 0.9);
    ctx.stroke();

    ctx.restore();
  }

  public destroy(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
