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

  constructor(container: HTMLElement, world: World, onSwitchToSim: (target?: PilotTarget) => void) {
    this.container = container;
    this.world = world;
    this.onSwitchToSim = onSwitchToSim;
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
      <div class="w-full h-full flex flex-col bg-[#020713] text-slate-100 font-sans select-none overflow-hidden">
        
        <!-- ================= TOP HEADER ================= -->
        <header class="flex items-center justify-between px-6 sm:px-10 py-4 border-b border-cyan-950/80 bg-slate-950/95 backdrop-blur-md shrink-0 z-20">
          <div class="flex items-center gap-3.5">
            <div class="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-500/50 flex items-center justify-center text-xl shadow-md">
              🌊
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-xl sm:text-2xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-sky-300 via-cyan-200 to-teal-300">
                  MENU
                </h1>
                <span class="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-500/40 text-[10px] text-cyan-300 font-mono">
                  ACTORS & GUIDE
                </span>
              </div>
              <p class="text-xs text-slate-400 hidden sm:block">
                Click any actor to inspect live playing animation, biological details, and launch controls
              </p>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button id="menu-btn-pilot-shark-top" class="px-3.5 py-1.5 rounded-xl bg-sky-950/90 border border-sky-500/60 hover:bg-sky-900 text-sky-200 text-xs font-bold transition cursor-pointer shadow">
              <span>🦈</span> Pilot Shark
            </button>
            <button id="menu-btn-pilot-fish-top" class="px-3.5 py-1.5 rounded-xl bg-amber-950/90 border border-amber-500/60 hover:bg-amber-900 text-amber-200 text-xs font-bold transition cursor-pointer shadow">
              <span>🐟</span> Pilot Fish
            </button>
            <button id="menu-btn-enter-sim" class="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 via-teal-500 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-black tracking-wider transition cursor-pointer shadow-lg shadow-cyan-950 hover:scale-[1.03]">
              <span>🌊</span> DIVE INTO OCEAN
            </button>
          </div>
        </header>

        <!-- ================= MAIN MENU BODY: SPLIT VIEW (LIST + DETAILS) ================= -->
        <main class="flex-1 flex flex-col md:flex-row overflow-hidden">
          
          <!-- LEFT COLUMN: ACTOR LIST WITH ANIMATED CIRCLES (MATCHING USER SKETCH) -->
          <div class="w-full md:w-96 lg:w-[420px] bg-slate-950/60 border-r border-cyan-950/80 p-5 sm:p-7 flex flex-col gap-3.5 overflow-y-auto shrink-0">
            <div class="text-[11px] font-mono uppercase text-slate-500 tracking-widest pb-1 flex items-center justify-between">
              <span>Select Actor to View:</span>
              <span class="text-cyan-400">Live 60 FPS</span>
            </div>

            <!-- 1. SHARK (Blue Circle + Shark Title) -->
            <button id="actor-item-shark" class="actor-menu-item group w-full p-3.5 rounded-2xl border-2 border-sky-500/80 bg-sky-950/30 flex items-center gap-4 text-left transition cursor-pointer shadow-lg hover:bg-sky-950/50">
              <!-- Blue Circle from sketch -->
              <div class="relative w-16 h-16 sm:w-18 sm:h-18 rounded-full border-3 border-sky-400 bg-slate-950 shadow-md shadow-sky-900/50 overflow-hidden flex items-center justify-center shrink-0">
                <canvas id="icon-canvas-shark" width="80" height="80" class="w-full h-full block"></canvas>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <h2 class="text-xl sm:text-2xl font-black text-sky-400 group-hover:text-sky-300 tracking-wide">
                    Shark
                  </h2>
                  <span class="text-[10px] font-mono text-sky-300/80 bg-sky-950 px-2 py-0.5 rounded border border-sky-500/40">1 Apex</span>
                </div>
                <p class="text-xs text-slate-300 truncate mt-0.5">Predator · Space to Chomp & Kill</p>
              </div>
            </button>

            <!-- 2. S FISH (Orange Circle + S Fish Title) -->
            <button id="actor-item-fish" class="actor-menu-item group w-full p-3.5 rounded-2xl border-2 border-slate-800 bg-slate-900/40 hover:border-amber-500/80 flex items-center gap-4 text-left transition cursor-pointer shadow-lg hover:bg-amber-950/30">
              <!-- Orange Circle from sketch -->
              <div class="relative w-16 h-16 sm:w-18 sm:h-18 rounded-full border-3 border-amber-400 bg-slate-950 shadow-md shadow-amber-900/50 overflow-hidden flex items-center justify-center shrink-0">
                <canvas id="icon-canvas-fish" width="80" height="80" class="w-full h-full block"></canvas>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <h2 class="text-xl sm:text-2xl font-black text-amber-400 group-hover:text-amber-300 tracking-wide">
                    S Fish
                  </h2>
                  <span class="text-[10px] font-mono text-amber-300/80 bg-amber-950 px-2 py-0.5 rounded border border-amber-500/40">20 Alive</span>
                </div>
                <p class="text-xs text-slate-300 truncate mt-0.5">Small Forager · Hides under plants</p>
              </div>
            </button>

            <!-- 3. PLANT (Green Circle + Plant Title) -->
            <button id="actor-item-plant" class="actor-menu-item group w-full p-3.5 rounded-2xl border-2 border-slate-800 bg-slate-900/40 hover:border-emerald-500/80 flex items-center gap-4 text-left transition cursor-pointer shadow-lg hover:bg-emerald-950/30">
              <!-- Green Circle from sketch -->
              <div class="relative w-16 h-16 sm:w-18 sm:h-18 rounded-full border-3 border-emerald-400 bg-slate-950 shadow-md shadow-emerald-900/50 overflow-hidden flex items-center justify-center shrink-0">
                <canvas id="icon-canvas-plant" width="80" height="80" class="w-full h-full block"></canvas>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <h2 class="text-xl sm:text-2xl font-black text-emerald-400 group-hover:text-emerald-300 tracking-wide">
                    Plant
                  </h2>
                  <span id="label-plant-count" class="text-[10px] font-mono text-emerald-300/80 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/40">Flora</span>
                </div>
                <p class="text-xs text-slate-300 truncate mt-0.5">Bioluminescent · Provides Camouflage</p>
              </div>
            </button>

            <!-- 4. FISH REMAINS (Red Circle + Meat Title) -->
            <button id="actor-item-meat" class="actor-menu-item group w-full p-3.5 rounded-2xl border-2 border-slate-800 bg-slate-900/40 hover:border-rose-500/80 flex items-center gap-4 text-left transition cursor-pointer shadow-lg hover:bg-rose-950/30">
              <!-- Red Circle -->
              <div class="relative w-16 h-16 sm:w-18 sm:h-18 rounded-full border-3 border-rose-500 bg-slate-950 shadow-md shadow-rose-900/50 overflow-hidden flex items-center justify-center shrink-0">
                <canvas id="icon-canvas-meat" width="80" height="80" class="w-full h-full block"></canvas>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <h2 class="text-xl sm:text-2xl font-black text-rose-400 group-hover:text-rose-300 tracking-wide">
                    Fish Remains
                  </h2>
                  <span class="text-[10px] font-mono text-rose-300/80 bg-rose-950 px-2 py-0.5 rounded border border-rose-500/40">Meat</span>
                </div>
                <p class="text-xs text-slate-300 truncate mt-0.5">Dropped on death · Scavenged by all</p>
              </div>
            </button>

            <!-- 5. REEF ROCKS (Slate Circle + Obstacle Title) -->
            <button id="actor-item-obstacle" class="actor-menu-item group w-full p-3.5 rounded-2xl border-2 border-slate-800 bg-slate-900/40 hover:border-slate-400 flex items-center gap-4 text-left transition cursor-pointer shadow-lg hover:bg-slate-900/80">
              <!-- Slate Circle -->
              <div class="relative w-16 h-16 sm:w-18 sm:h-18 rounded-full border-3 border-slate-400 bg-slate-950 shadow-md overflow-hidden flex items-center justify-center shrink-0">
                <canvas id="icon-canvas-obstacle" width="80" height="80" class="w-full h-full block"></canvas>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <h2 class="text-xl sm:text-2xl font-black text-slate-300 group-hover:text-white tracking-wide">
                    Reef Rock
                  </h2>
                  <span class="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-700">Barrier</span>
                </div>
                <p class="text-xs text-slate-400 truncate mt-0.5">Solid formation · Blocks line of sight</p>
              </div>
            </button>
          </div>

          <!-- RIGHT COLUMN: ACTOR DETAILS VIEW ("DETAILS SORT OF A VIEW") -->
          <div class="flex-1 p-6 sm:p-8 overflow-y-auto bg-gradient-to-b from-[#030919] to-[#01050e]">
            
            <!-- DETAIL 1: SHARK DETAILS -->
            <div id="detail-panel-shark" class="actor-detail-panel flex flex-col gap-6 max-w-4xl mx-auto">
              <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-sky-950">
                <div class="flex items-center gap-3">
                  <span class="text-3xl">🦈</span>
                  <div>
                    <h3 class="text-2xl font-black text-sky-300">The Shark (Apex Predator)</h3>
                    <p class="text-xs text-sky-400 font-mono">1 IN OCEAN · APEX HUNTER · CONTROLLABLE [KEY 1]</p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button id="btn-detail-shark-bite" class="px-3.5 py-1.5 rounded-xl bg-rose-950/80 border border-rose-500/60 hover:bg-rose-900 text-rose-300 text-xs font-bold cursor-pointer transition shadow">
                    💥 Test Chomp (Space)
                  </button>
                  <button id="btn-detail-pilot-shark" class="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs cursor-pointer transition shadow-lg shadow-sky-950">
                    🦈 PILOT SHARK IN OCEAN
                  </button>
                </div>
              </div>

              <!-- Live Preview Stage -->
              <div class="relative w-full h-64 sm:h-72 bg-radial from-slate-900 to-[#020713] rounded-2xl border border-sky-950/80 flex items-center justify-center overflow-hidden shadow-2xl">
                <canvas id="canvas-shark-preview" class="w-full h-full"></canvas>
                <div class="absolute bottom-3 right-4 text-[10px] text-sky-400/80 font-mono">
                  LIVE 60 FPS · REALTIME JAW & TAIL PHYSICS
                </div>
              </div>

              <!-- Must Bite Notice -->
              <div class="p-3.5 rounded-2xl bg-rose-950/30 border border-rose-800/50 flex items-start gap-3 text-xs">
                <span class="text-2xl">💥</span>
                <div>
                  <strong class="text-rose-300 font-bold block text-sm">Must Bite to Kill (Spacebar):</strong>
                  <p class="text-slate-300 mt-1 leading-relaxed">
                    Simply swimming into small fish does not kill them. The shark <span class="text-rose-400 font-semibold">must press Space</span> when in range to chomp. When a bite connects, the small fish is killed instantly and explodes into <span class="text-amber-300 font-semibold">3 drifting meat chunks</span>!
                  </p>
                </div>
              </div>

              <!-- Specs Table -->
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">SPEED / THRUST</span>
                  <span class="font-bold text-sky-300 text-sm">190 u/s · 350 u/s²</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">PREY SOURCE</span>
                  <span class="font-bold text-amber-300 text-sm">Small Fish & Meat</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">CLONING GOAL</span>
                  <span class="font-bold text-cyan-300 text-sm">Eat 2 Foods -> Clone</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">RADIUS / MASS</span>
                  <span class="font-bold text-slate-300 text-sm">14 u / 2.5 kg</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">CONTROLS</span>
                  <span class="font-bold text-sky-300 text-sm">W/A/S/D or Arrows</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">CHOMP HOTKEY</span>
                  <span class="font-bold text-rose-400 text-sm">SPACEBAR</span>
                </div>
              </div>
            </div>

            <!-- DETAIL 2: SMALL FISH DETAILS -->
            <div id="detail-panel-fish" class="actor-detail-panel hidden flex flex-col gap-6 max-w-4xl mx-auto">
              <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-amber-950">
                <div class="flex items-center gap-3">
                  <span class="text-3xl">🐟</span>
                  <div>
                    <h3 class="text-2xl font-black text-amber-300">Small Fish (S Fish)</h3>
                    <p class="text-xs text-amber-400 font-mono">20 AT START · FORAGER · CONTROLLABLE [KEY 2]</p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button id="btn-detail-fish-nibble" class="px-3.5 py-1.5 rounded-xl bg-amber-950/80 border border-amber-500/60 hover:bg-amber-900 text-amber-300 text-xs font-bold cursor-pointer transition shadow">
                    🌿 Test Nibble (Space)
                  </button>
                  <button id="btn-detail-pilot-fish" class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer transition shadow-lg shadow-amber-950">
                    🐟 PILOT SMALL FISH
                  </button>
                </div>
              </div>

              <!-- Live Preview Stage -->
              <div class="relative w-full h-64 sm:h-72 bg-radial from-slate-900 to-[#020713] rounded-2xl border border-amber-950/80 flex items-center justify-center overflow-hidden shadow-2xl">
                <canvas id="canvas-fish-preview" class="w-full h-full"></canvas>
                <div class="absolute bottom-3 right-4 text-[10px] text-amber-400/80 font-mono">
                  LIVE 60 FPS · UNDULATING CAUDAL FIN & MOUTH
                </div>
              </div>

              <!-- Camouflage & Still Notice -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div class="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-800/50 flex items-start gap-3">
                  <span class="text-2xl">🌿</span>
                  <div>
                    <strong class="text-emerald-300 font-bold block">Flora Camouflage:</strong>
                    <p class="text-slate-300 mt-1 leading-relaxed">
                      Layers under marine plants. When inside foliage, the shark's targeting lock range drops by <span class="text-emerald-300 font-bold">65%</span>, making fish virtually invisible!
                    </p>
                  </div>
                </div>
                <div class="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/50 flex items-start gap-3">
                  <span class="text-2xl">🛑</span>
                  <div>
                    <strong class="text-amber-300 font-bold block">Motion Only on Press:</strong>
                    <p class="text-slate-300 mt-1 leading-relaxed">
                      Fish remain completely stationary until piloted with <kbd class="px-1 rounded bg-slate-900 text-cyan-300">W/A/S/D</kbd>. Zero random drift—clean for AI development.
                    </p>
                  </div>
                </div>
              </div>

              <!-- Specs Table -->
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">SPEED / THRUST</span>
                  <span class="font-bold text-amber-300 text-sm">220 u/s · 420 u/s² (Agile)</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">START POPULATION</span>
                  <span class="font-bold text-emerald-300 text-sm">20 Small Fish</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">CLONING THRESHOLD</span>
                  <span class="font-bold text-amber-300 text-sm">Eat 3 Foods -> Clone</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">DIET</span>
                  <span class="font-bold text-emerald-300 text-sm">Plants & Meat Remains</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">FEEDING ACTION</span>
                  <span class="font-bold text-rose-300 text-sm">Space to Bite</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">CYCLE HOTKEY</span>
                  <span class="font-bold text-amber-300 text-sm">TAB or KEY 2</span>
                </div>
              </div>
            </div>

            <!-- DETAIL 3: PLANT DETAILS -->
            <div id="detail-panel-plant" class="actor-detail-panel hidden flex flex-col gap-6 max-w-4xl mx-auto">
              <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-emerald-950">
                <div class="flex items-center gap-3">
                  <span class="text-3xl">🌿</span>
                  <div>
                    <h3 class="text-2xl font-black text-emerald-300">Marine Flora (Plant)</h3>
                    <p class="text-xs text-emerald-400 font-mono">BIOLUMINESCENT PRODUCER · PROPAGATES EVERY 4s</p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button id="btn-detail-burst-plant" class="px-3.5 py-1.5 rounded-xl bg-teal-950/80 border border-teal-500/60 hover:bg-teal-900 text-teal-300 text-xs font-bold cursor-pointer transition shadow">
                    ✨ Burst (+30)
                  </button>
                  <button id="btn-detail-regen-plant" class="px-3.5 py-1.5 rounded-xl bg-emerald-950/80 border border-emerald-500/60 hover:bg-emerald-900 text-emerald-300 text-xs font-bold cursor-pointer transition shadow">
                    🌱 Regenerate (E)
                  </button>
                </div>
              </div>

              <!-- Live Preview Stage -->
              <div class="relative w-full h-64 sm:h-72 bg-radial from-slate-900 to-[#020713] rounded-2xl border border-emerald-950/80 flex items-center justify-center overflow-hidden shadow-2xl">
                <canvas id="canvas-plant-preview" class="w-full h-full"></canvas>
                <div id="plant-active-count-badge" class="absolute top-3 left-4 text-xs bg-slate-900/90 px-2.5 py-1 rounded-md border border-emerald-500/40 text-emerald-300 font-mono">
                  Active Flora: <span id="plant-active-count" class="font-bold text-emerald-200">0</span>
                </div>
                <div class="absolute bottom-3 right-4 text-[10px] text-emerald-400/80 font-mono">
                  LIVE 60 FPS · CURRENT FLOW & BULB BLOOM
                </div>
              </div>

              <!-- Camouflage Feature Banner -->
              <div class="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-800/50 flex items-start gap-3 text-xs">
                <span class="text-2xl">🌿</span>
                <div>
                  <strong class="text-emerald-300 font-bold block text-sm">Under-Plant Layering & Shark Camouflage:</strong>
                  <p class="text-slate-300 mt-1 leading-relaxed">
                    Plants are rendered directly above small fish. When a fish hides under the foliage, its opacity dims and the shark cannot target or chomp it from outside the foliage—the predator must swim right into the plant to detect the fish!
                  </p>
                </div>
              </div>

              <!-- Specs Table -->
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">SPAWN INTERVAL</span>
                  <span class="font-bold text-emerald-300 text-sm">Every 4.0 Seconds</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">NUTRITION</span>
                  <span class="font-bold text-emerald-300 text-sm">+25 Energy (1/3 Clone)</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">EATING CONDITION</span>
                  <span class="font-bold text-amber-300 text-sm">Must Bite (Space)</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">COVER RADIUS</span>
                  <span class="font-bold text-cyan-300 text-sm">24 Units</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">PREDATOR REDUCTION</span>
                  <span class="font-bold text-rose-300 text-sm">65% Bite Range Drop</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <span class="text-slate-500 block text-[10px]">RESET CLEAR</span>
                  <button id="btn-clear-plants" class="text-rose-400 hover:text-rose-300 underline font-bold cursor-pointer">Clear All</button>
                </div>
              </div>
            </div>

            <!-- DETAIL 4: FISH REMAINS DETAILS -->
            <div id="detail-panel-meat" class="actor-detail-panel hidden flex flex-col gap-6 max-w-4xl mx-auto">
              <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-rose-950">
                <div class="flex items-center gap-3">
                  <span class="text-3xl">🥩</span>
                  <div>
                    <h3 class="text-2xl font-black text-rose-300">Fish Remains (Meat Chunks)</h3>
                    <p class="text-xs text-rose-400 font-mono">CARCASS SCAVENGING · SPAWNED ON SHARK KILL</p>
                  </div>
                </div>
                <span class="px-3.5 py-1.5 rounded-xl bg-rose-950/80 border border-rose-700/50 text-rose-300 text-xs font-mono font-bold">
                  🥩 Nutritious Morsels
                </span>
              </div>

              <!-- Live Preview Stage -->
              <div class="relative w-full h-64 sm:h-72 bg-radial from-slate-900 to-[#020713] rounded-2xl border border-rose-950/80 flex items-center justify-center overflow-hidden shadow-2xl">
                <canvas id="canvas-meat-preview" class="w-full h-full"></canvas>
                <div class="absolute bottom-3 right-4 text-[10px] text-rose-400/80 font-mono">
                  LIVE 60 FPS · BUOYANCY & DRIFT PHYSICS
                </div>
              </div>

              <!-- Scavenging Banner -->
              <div class="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/50 flex items-start gap-3 text-xs">
                <span class="text-2xl">🥩</span>
                <div>
                  <strong class="text-amber-300 font-bold block text-sm">Nutritious Food for Both Shark & Small Fish:</strong>
                  <p class="text-slate-300 mt-1 leading-relaxed">
                    Whenever a shark bites and kills a small fish, 3 pieces of meat explode outwards. Both sharks (+50 clone pts) and small fish (+40 clone pts) can bite and scavenge these remains!
                  </p>
                </div>
              </div>

              <!-- Specs Table -->
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">ORIGIN</span>
                  <span class="font-bold text-rose-300 text-sm">Shark Kills Small Fish</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">CHUNKS SPAWNED</span>
                  <span class="font-bold text-rose-300 text-sm">3 Chunks per Kill</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">CONSUMABLE BY</span>
                  <span class="font-bold text-amber-300 text-sm">Both Shark & Fish</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">SHARK VALUE</span>
                  <span class="font-bold text-rose-400 text-sm">+50 pts (1/2 Clone)</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">FISH VALUE</span>
                  <span class="font-bold text-amber-400 text-sm">+40 pts (1/3 Clone)</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">DECAY TIME</span>
                  <span class="font-bold text-slate-400 text-sm">50 Seconds</span>
                </div>
              </div>
            </div>

            <!-- DETAIL 5: REEF OBSTACLE DETAILS -->
            <div id="detail-panel-obstacle" class="actor-detail-panel hidden flex flex-col gap-6 max-w-4xl mx-auto">
              <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div class="flex items-center gap-3">
                  <span class="text-3xl">🪨</span>
                  <div>
                    <h3 class="text-2xl font-black text-slate-200">Reef Formations (Rock Barriers)</h3>
                    <p class="text-xs text-slate-400 font-mono">SOLID BARRIER · SMOOTH SLIDE COLLISION · BLOCKS VISION</p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                    <button id="btn-rock-small" class="px-3 py-1 rounded-lg text-slate-400 border border-transparent hover:text-white transition cursor-pointer">Small</button>
                    <button id="btn-rock-medium" class="px-3 py-1 rounded-lg border border-cyan-500 bg-cyan-950 text-cyan-300 transition cursor-pointer">Medium</button>
                    <button id="btn-rock-large" class="px-3 py-1 rounded-lg text-slate-400 border border-transparent hover:text-white transition cursor-pointer">Large</button>
                  </div>
                  <button id="btn-rock-new" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition">
                    🎲 Randomize
                  </button>
                </div>
              </div>

              <!-- Live Preview Stage -->
              <div class="relative w-full h-64 sm:h-72 bg-radial from-slate-900 to-[#020713] rounded-2xl border border-slate-800 flex items-center justify-center overflow-hidden shadow-2xl">
                <canvas id="canvas-obstacle-preview" class="w-full h-full"></canvas>
                <div class="absolute bottom-3 right-4 text-[10px] text-slate-400/80 font-mono">
                  LIVE 60 FPS · PROCEDURAL GEOMETRY
                </div>
              </div>

              <!-- Specs Table -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">TOTAL IN WORLD</span>
                  <span class="font-bold text-slate-200 text-sm">15–25 Formations</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">SIZE MIX</span>
                  <span class="font-bold text-slate-200 text-sm">60% S · 30% M · 10% L</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">MIN SPACING</span>
                  <span class="font-bold text-slate-200 text-sm">80 u between</span>
                </div>
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                  <span class="text-slate-500 block text-[10px]">RAYCAST VISIBILITY</span>
                  <span class="font-bold text-cyan-400 text-sm">Blocks Vision 100%</span>
                </div>
              </div>
            </div>

          </div>

        </main>

        <!-- ================= BOTTOM STATUS FOOTER ================= -->
        <footer class="px-6 py-3 border-t border-cyan-950/80 bg-slate-950/90 flex flex-wrap items-center justify-between text-xs text-slate-500 font-mono shrink-0">
          <div class="flex items-center gap-3">
            <span>Controls: <kbd class="px-1.5 py-0.5 rounded bg-slate-900 text-cyan-300">W/A/S/D</kbd> Move</span>
            <span>·</span>
            <span><kbd class="px-1.5 py-0.5 rounded bg-slate-900 text-rose-300">Space</kbd> Bite/Chomp</span>
            <span>·</span>
            <span><kbd class="px-1.5 py-0.5 rounded bg-slate-900 text-amber-300">1</kbd> Shark / <kbd class="px-1.5 py-0.5 rounded bg-slate-900 text-amber-300">2</kbd> Fish</span>
          </div>
          <div class="flex items-center gap-4">
            <button id="footer-btn-dive" class="text-cyan-400 hover:text-cyan-300 font-bold underline cursor-pointer">
              Launch Simulation →
            </button>
          </div>
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
      shark: ['border-sky-500/80', 'bg-sky-950/30'],
      fish: ['border-amber-500/80', 'bg-amber-950/30'],
      plant: ['border-emerald-500/80', 'bg-emerald-950/30'],
      meat: ['border-rose-500/80', 'bg-rose-950/30'],
      obstacle: ['border-slate-400', 'bg-slate-900/60'],
    };

    (Object.keys(items) as SelectedActor[]).forEach((key) => {
      const item = items[key];
      const panel = panels[key];

      // Remove active borders/bgs
      activeStyles[key].forEach((cls) => item?.classList.remove(cls));
      item?.classList.add('border-slate-800', 'bg-slate-900/40');

      if (key === actor) {
        item?.classList.remove('border-slate-800', 'bg-slate-900/40');
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
