import './index.css';
import { CONFIG } from './config';
import { World } from './world';
import { InputManager } from './input';
import { Camera } from './camera';
import { Renderer } from './render';
import { ActorShowcase, PilotTarget } from './showcase';
import { sound } from './audio';
import { Trainer } from './rl/trainer';
import { BrainVisualizer } from './brainviz';
import { SensorPanel } from './sensorPanel';

type ViewMode = 'simulation' | 'showcase' | 'free';

function bootstrap(): void {
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    throw new Error('Root #app container not found');
  }

  appContainer.innerHTML = '';
  appContainer.className = 'relative w-full h-full overflow-hidden bg-[#020810]';

  // State
  let currentView: ViewMode = 'showcase';

  // 1. Simulation Wrapper
  const simWrapper = document.createElement('div');
  simWrapper.id = 'sim-wrapper';
  simWrapper.className = 'absolute inset-0 w-full h-full';
  appContainer.appendChild(simWrapper);

  // Canvas (full-bleed, no border, so the ocean map fills the entire viewport)
  const canvas = document.createElement('canvas');
  canvas.className = 'w-full h-full block';
  simWrapper.appendChild(canvas);

  // 2. Showcase Wrapper
  const showcaseWrapper = document.createElement('div');
  showcaseWrapper.id = 'showcase-wrapper';
  showcaseWrapper.className = 'absolute inset-0 w-full h-full z-30';
  appContainer.appendChild(showcaseWrapper);

  // 3. Global Top Control Navigation Bar (Fixed above simulation)
  const topBar = document.createElement('nav');
  topBar.id = 'top-nav-bar';
  topBar.className =
    'absolute top-4 left-4 right-4 z-40 flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-slate-950/70 backdrop-blur-xl border border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.45)] text-xs text-slate-200 select-none';
  topBar.innerHTML = `
    <!-- Left: Return to Standalone Menu Page + Mode Badge -->
    <div class="flex items-center gap-3">
      <button id="btn-back-to-menu" title="Return to Standalone Menu Page (M or Esc)" class="px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-slate-200 font-medium transition-all duration-150 flex items-center gap-2 cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60">
        <span>☰</span> <span class="hidden sm:inline">Main Menu</span>
      </button>
      <span id="mode-badge" class="hidden px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-400/30 text-violet-300 font-semibold text-[10px] tracking-wide items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"></span> Free Test Arena (not saved)
      </span>
    </div>

    <!-- Center: Live Training Stats -->
    <div id="training-stats" class="flex items-center gap-2 sm:gap-4 px-1 font-mono text-[11px] text-slate-300">
      <span class="flex items-center gap-1.5 text-slate-400">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        <span id="stat-status">Loading…</span>
      </span>
      <span>Gen <span id="stat-generation" class="text-slate-100 font-semibold">0</span></span>
      <span class="hidden md:inline">Steps <span id="stat-steps" class="text-slate-100 font-semibold">0</span></span>
      <span class="text-sky-300">🦈 <span id="stat-shark-alive">0</span> <span class="text-slate-500 hidden lg:inline">avg r=<span id="stat-shark-reward" class="text-sky-200">0</span></span></span>
      <span class="text-amber-300">🐟 <span id="stat-fish-alive">0</span> <span class="text-slate-500 hidden lg:inline">avg r=<span id="stat-fish-reward" class="text-amber-200">0</span></span></span>
    </div>

    <!-- Right: Quick Environment Actions -->
    <div class="flex items-center gap-2">
      <button id="btn-save-now" title="Save training checkpoint now" class="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-400/30 hover:bg-emerald-500/20 text-emerald-300 font-medium flex items-center gap-1.5 transition-all duration-150 cursor-pointer active:scale-95">
        <span>💾</span> <span class="hidden lg:inline">Save</span>
      </button>

      <div id="speed-control-group" title="Training speed (fast-forwards simulated time; rendering still shows every tick)" class="flex items-center gap-0.5 p-1 rounded-xl bg-white/[0.04] border border-white/10">
        <span class="pl-1 pr-0.5 hidden md:inline">⏩</span>
        <button data-speed="1" class="speed-btn px-2 py-1 rounded-lg font-medium text-[11px] transition-all duration-150 cursor-pointer active:scale-95">1x</button>
        <button data-speed="2" class="speed-btn px-2 py-1 rounded-lg font-medium text-[11px] transition-all duration-150 cursor-pointer active:scale-95">2x</button>
        <button data-speed="5" class="speed-btn px-2 py-1 rounded-lg font-medium text-[11px] transition-all duration-150 cursor-pointer active:scale-95">5x</button>
        <button data-speed="10" class="speed-btn px-2 py-1 rounded-lg font-medium text-[11px] transition-all duration-150 cursor-pointer active:scale-95">10x</button>
        <button data-speed="20" class="speed-btn px-2 py-1 rounded-lg font-medium text-[11px] transition-all duration-150 cursor-pointer active:scale-95">20x</button>
        <button id="btn-max-mode" title="Max mode: trains as fast as the CPU allows, skipping rendering for hundreds of generations at a time" class="px-2 py-1 rounded-lg font-bold text-[11px] text-red-300 hover:bg-red-500/10 transition-all duration-150 cursor-pointer active:scale-95">🔥MAX</button>
      </div>

      <button id="btn-top-regen-plants" title="Regenerate all plants in the ocean" class="px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-slate-300 font-medium flex items-center gap-1.5 transition-all duration-150 cursor-pointer active:scale-95">
        <span>🌱</span> <span class="hidden lg:inline">Regen Plants</span>
      </button>

      <button id="btn-toggle-follow" title="Toggle camera following the spectated creature" class="px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-slate-300 font-medium flex items-center gap-1.5 transition-all duration-150 cursor-pointer active:scale-95">
        <span>🎥</span> <span class="hidden lg:inline">Follow</span>
      </button>

      <button id="btn-reset-world" title="Force-start a new generation now (keeps learned weights)" class="px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-slate-300 font-medium flex items-center gap-1.5 transition-all duration-150 cursor-pointer active:scale-95">
        <span>🔄</span> <span class="hidden lg:inline">New Gen</span>
      </button>

      <button id="btn-toggle-sound" title="Toggle sound effects" class="p-2 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-slate-300 text-sm transition-all duration-150 cursor-pointer active:scale-95">
        🔊
      </button>

      <button id="btn-toggle-brain" title="Show/hide the selected creature's neural network (N)" class="px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-slate-300 font-medium flex items-center gap-1.5 transition-all duration-150 cursor-pointer active:scale-95">
        <span>🧠</span> <span class="hidden lg:inline">Brain</span>
      </button>

      <button id="btn-toggle-fullscreen" title="Toggle true fullscreen (double-click map)" class="p-2 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-slate-300 text-sm transition-all duration-150 cursor-pointer active:scale-95">
        ⛶
      </button>

      <button id="btn-toggle-sensor-panel" title="Show/hide the full live sensor vector for the selected creature (X)" class="px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-slate-300 font-medium flex items-center gap-1.5 transition-all duration-150 cursor-pointer active:scale-95">
        <span>📡</span> <span class="hidden lg:inline">Sensors</span>
      </button>

      <button id="btn-toggle-help" title="About this training mode" class="p-2 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-slate-300 text-sm transition-all duration-150 cursor-pointer active:scale-95">
        ❓
      </button>
    </div>
  `;
  appContainer.appendChild(topBar);

  // Info Modal / Guide
  const helpModal = document.createElement('div');
  helpModal.id = 'help-modal';
  helpModal.className =
    'hidden absolute inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  helpModal.innerHTML = `
    <div class="bg-slate-950/95 border border-white/10 rounded-3xl p-7 max-w-md w-full shadow-2xl text-slate-200">
      <div class="flex items-center justify-between pb-4 border-b border-white/[0.06]">
        <h3 class="text-base font-semibold text-slate-50 flex items-center gap-2.5">
          <span>🤖</span> Reinforcement Learning Mode
        </h3>
        <button id="btn-close-help" class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer">✕</button>
      </div>

      <div class="mt-4 flex flex-col gap-3 text-sm text-slate-300 leading-relaxed">
        <p>Every shark and every small fish is piloted by its own species' neural-network policy — there is no scripted or manual control. Both species are trained purely to <strong class="text-slate-100">survive as long as possible</strong> (eating and reproducing help with that).</p>
        <p>If either species' population hits zero, or a generation runs too long, the ocean automatically resets and a new generation begins — the learned weights are kept, only the environment restarts.</p>
        <p>Training progress (both networks' weights, episode counts, and reward averages) is periodically saved to a local checkpoint file, and restored automatically next time this page loads — so stopping the server doesn't lose progress.</p>
      </div>

      <div class="mt-5 flex flex-col gap-0.5 text-xs">
        <div class="flex justify-between items-center py-2 border-b border-white/[0.05]">
          <span class="text-slate-400">Main menu</span>
          <span class="text-slate-100 font-medium">M or Esc</span>
        </div>
        <div class="flex justify-between items-center py-2 border-b border-white/[0.05]">
          <span class="text-slate-400">Regenerate plants</span>
          <span class="text-slate-100 font-medium">E</span>
        </div>
        <div class="flex justify-between items-center py-2 border-b border-white/[0.05]">
          <span class="text-slate-400">Force a new generation</span>
          <span class="text-slate-100 font-medium">R</span>
        </div>
        <div class="flex justify-between items-center py-2 border-b border-white/[0.05]">
          <span class="text-slate-400">Camera pan / zoom / follow</span>
          <span class="text-slate-300">Wheel · middle drag · F</span>
        </div>
        <div class="flex justify-between items-center py-2 border-b border-white/[0.05]">
          <span class="text-slate-400">Show/hide selected creature's brain</span>
          <span class="text-slate-100 font-medium">N</span>
        </div>
        <div class="flex justify-between items-center py-2 border-b border-white/[0.05]">
          <span class="text-slate-400">Show/hide full live sensor vector</span>
          <span class="text-slate-100 font-medium">X</span>
        </div>
        <div class="flex justify-between items-center py-2">
          <span class="text-slate-400">Vision/touch/lateral-line/electro overlay · scent heatmap</span>
          <span class="text-slate-100 font-medium">C · S</span>
        </div>
      </div>

      <div class="mt-6 text-center">
        <button id="btn-help-got-it" class="px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold cursor-pointer transition-colors duration-150">
          Got it
        </button>
      </div>
    </div>
  `;
  appContainer.appendChild(helpModal);

  // Initialize Core Systems
  const input = new InputManager();
  const camera = new Camera(canvas, input);
  const renderer = new Renderer(canvas);
  const brainViz = new BrainVisualizer(simWrapper);
  const sensorPanel = new SensorPanel(simWrapper);

  // Main simulation world (#/sim), persistently trained and checkpointed, and
  // an exact, fully independent copy mounted at (#/free) for separate,
  // throwaway experimentation — its agents start fresh and are never saved.
  const simWorld = new World(CONFIG.world.seed);
  const freeWorld = new World(CONFIG.world.seed + 1);
  const simTrainer = new Trainer(simWorld, { persist: true });
  const freeTrainer = new Trainer(freeWorld, { persist: false });
  void simTrainer.init();

  // `world`/`trainer` always point at whichever arena is currently on-screen.
  let world: World = simWorld;
  let trainer: Trainer = simTrainer;

  camera.followTarget = world.controlledCreature;

  // Showcase instance
  let showcase: ActorShowcase | null = null;

  const modeBadge = topBar.querySelector('#mode-badge');
  const statStatus = topBar.querySelector('#stat-status');
  const statGeneration = topBar.querySelector('#stat-generation');
  const statSteps = topBar.querySelector('#stat-steps');
  const statSharkAlive = topBar.querySelector('#stat-shark-alive');
  const statSharkReward = topBar.querySelector('#stat-shark-reward');
  const statFishAlive = topBar.querySelector('#stat-fish-alive');
  const statFishReward = topBar.querySelector('#stat-fish-reward');

  // Separate Page Router / View Mode Switcher
  function setViewMode(mode: ViewMode, pilotTarget?: PilotTarget): void {
    currentView = mode;

    if (mode === 'simulation' || mode === 'free') {
      world = mode === 'free' ? freeWorld : simWorld;
      trainer = mode === 'free' ? freeTrainer : simTrainer;
    }

    if (pilotTarget === 'shark') {
      world.setControlledByIndex(0);
    } else if (pilotTarget === 'fish') {
      world.cycleSmallFish();
    }

    if (mode === 'simulation' || mode === 'free') {
      const targetHash = mode === 'free' ? '#/free' : '#/sim';
      if (window.location.hash !== targetHash) {
        history.replaceState(null, '', targetHash);
      }
      simWrapper.classList.remove('hidden');
      topBar.classList.remove('hidden');
      showcaseWrapper.classList.add('hidden');
      modeBadge?.classList.toggle('hidden', mode !== 'free');
      modeBadge?.classList.toggle('flex', mode === 'free');

      if (showcase) {
        showcase.destroy();
        showcase = null;
      }
      camera.followTarget = world.controlledCreature;
      handleResize();
    } else {
      if (window.location.hash !== '#/menu') {
        history.replaceState(null, '', '#/menu');
      }
      simWrapper.classList.add('hidden');
      topBar.classList.add('hidden');
      showcaseWrapper.classList.remove('hidden');

      if (!showcase) {
        showcase = new ActorShowcase(
          showcaseWrapper,
          simWorld,
          (target) => setViewMode('simulation', target),
          () => setViewMode('free')
        );
      }
    }
  }

  // Update the live training stats readout in the top bar
  function updateTrainingStatsUI(): void {
    const stats = trainer.getStats();
    if (statStatus) {
      statStatus.textContent = stats.resumedFromCheckpoint ? 'Resumed' : 'Training';
    }
    if (statGeneration) statGeneration.textContent = stats.generation.toString();
    if (statSteps) statSteps.textContent = stats.totalSteps.toLocaleString();
    if (statSharkAlive) statSharkAlive.textContent = stats.sharkAlive.toString();
    if (statSharkReward) statSharkReward.textContent = stats.sharkAvgReward.toFixed(1);
    if (statFishAlive) statFishAlive.textContent = stats.fishAlive.toString();
    if (statFishReward) statFishReward.textContent = stats.fishAvgReward.toFixed(1);

    camera.followTarget = world.controlledCreature;
  }

  // Bind Top Bar UI Clicks
  topBar.querySelector('#btn-back-to-menu')?.addEventListener('click', () => setViewMode('showcase'));

  // Browser navigation support (back/forward between #/menu, #/sim, #/free)
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (hash === '#/sim' && currentView !== 'simulation') {
      setViewMode('simulation');
    } else if (hash === '#/free' && currentView !== 'free') {
      setViewMode('free');
    } else if (hash !== '#/sim' && hash !== '#/free' && currentView !== 'showcase') {
      setViewMode('showcase');
    }
  });

  topBar.querySelector('#btn-save-now')?.addEventListener('click', () => {
    void simTrainer.save();
  });

  // Training speed: fast-forwards simulated time relative to wall-clock
  // time (more physics ticks run per rendered frame) rather than skipping
  // rendering, so the sim visibly runs faster instead of just jumping.
  let speedMultiplier = 1;
  const speedButtons = Array.from(topBar.querySelectorAll<HTMLButtonElement>('.speed-btn'));
  function updateSpeedButtonStyles(): void {
    for (const btn of speedButtons) {
      const isActive = !maxModeActive && Number(btn.dataset.speed) === speedMultiplier;
      btn.classList.toggle('bg-cyan-500/20', isActive);
      btn.classList.toggle('text-cyan-300', isActive);
      btn.classList.toggle('text-slate-400', !isActive);
    }
  }
  for (const btn of speedButtons) {
    btn.addEventListener('click', () => {
      speedMultiplier = Number(btn.dataset.speed) || 1;
      setMaxMode(false);
      updateSpeedButtonStyles();
    });
  }

  // Max mode: decouples training from wall-clock/rAF pacing entirely and
  // steps the trainer in a tight, self-yielding loop bounded only by a CPU
  // time budget, so training runs as fast as the machine can compute it
  // instead of being paced to real time. Rendering is the expensive part
  // (a full canvas redraw), so it's skipped on most batches and only drawn
  // on a wall-clock interval -- generation count is *not* used to gate
  // rendering: a generation can run anywhere from a few hundred ticks to
  // CONFIG.rl.maxEpisodeTicks, so "render every N generations" can't
  // reliably predict how much real time (or how many renders) that spans.
  // A plain time interval is the only gate that reliably skips a large,
  // predictable stretch of training between redraws regardless of how long
  // generations happen to run.
  let maxModeActive = false;
  let maxModeLastRenderAt = 0;
  const MAX_MODE_STEP_BUDGET_MS = 150;
  const MAX_MODE_RENDER_INTERVAL_MS = 5000;
  const maxModeBtn = topBar.querySelector<HTMLButtonElement>('#btn-max-mode');

  function updateMaxModeButtonStyle(): void {
    maxModeBtn?.classList.toggle('bg-red-500/20', maxModeActive);
    maxModeBtn?.classList.toggle('text-red-300', maxModeActive);
    maxModeBtn?.classList.toggle('animate-pulse', maxModeActive);
  }

  function runMaxModeBatch(): void {
    if (!maxModeActive) return;
    if (input.isPaused) {
      setTimeout(runMaxModeBatch, 100);
      return;
    }

    const budgetEnd = performance.now() + MAX_MODE_STEP_BUDGET_MS;
    let stepped = 0;
    while (performance.now() < budgetEnd) {
      trainer.step();
      stepped++;
      // Only check the clock every so often -- calling performance.now()
      // every single tick would itself eat a meaningful slice of the budget.
      if (stepped % 500 === 0 && performance.now() >= budgetEnd) break;
    }

    simTrainer.maybeAutosave(performance.now() / 1000);

    const now = performance.now();
    const dueForRender = now - maxModeLastRenderAt >= MAX_MODE_RENDER_INTERVAL_MS;

    if (dueForRender && (currentView === 'simulation' || currentView === 'free')) {
      renderer.render(world, camera, input, currentFps, now / 1000);
      maxModeLastRenderAt = now;
    }
    if (dueForRender) {
      updateTrainingStatsUI();
    } else if (statGeneration && statSteps) {
      // Cheap text-only refresh so the counters still visibly climb between
      // full renders, without paying for a canvas redraw.
      statGeneration.textContent = trainer.generation.toString();
      statSteps.textContent = trainer.totalSteps.toLocaleString();
    }

    setTimeout(runMaxModeBatch, 0);
  }

  function setMaxMode(active: boolean): void {
    if (maxModeActive === active) return;
    maxModeActive = active;
    // -Infinity (not 0) so the very first batch after activating always
    // renders immediately, rather than waiting out a full interval first.
    maxModeLastRenderAt = -Infinity;
    updateMaxModeButtonStyle();
    updateSpeedButtonStyles();
    if (active) runMaxModeBatch();
  }

  maxModeBtn?.addEventListener('click', () => setMaxMode(!maxModeActive));

  updateSpeedButtonStyles();
  updateMaxModeButtonStyle();

  topBar.querySelector('#btn-top-regen-plants')?.addEventListener('click', () => {
    world.triggerRegeneratePlants();
  });

  topBar.querySelector('#btn-toggle-follow')?.addEventListener('click', () => {
    input.cameraFollow = !input.cameraFollow;
    camera.setFollow(input.cameraFollow);
  });

  topBar.querySelector('#btn-reset-world')?.addEventListener('click', () => {
    trainer.forceNewGeneration();
  });

  const soundBtn = topBar.querySelector('#btn-toggle-sound');
  soundBtn?.addEventListener('click', () => {
    const muted = sound.toggleMute();
    if (soundBtn) {
      soundBtn.textContent = muted ? '🔇' : '🔊';
    }
  });

  const brainBtn = topBar.querySelector('#btn-toggle-brain');
  brainBtn?.addEventListener('click', () => brainViz.toggle());
  input.onToggleBrainViz = () => brainViz.toggle();
  input.onToggleSensorPanel = () => sensorPanel.toggle();
  topBar.querySelector('#btn-toggle-sensor-panel')?.addEventListener('click', () => sensorPanel.toggle());

  // True browser fullscreen, so the ocean map can fill the entire display
  // (not just the browser viewport) while exploring it.
  const fullscreenBtn = topBar.querySelector('#btn-toggle-fullscreen');
  function toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void appContainer?.requestFullscreen();
    }
  }
  fullscreenBtn?.addEventListener('click', toggleFullscreen);
  canvas.addEventListener('dblclick', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn?.setAttribute(
      'title',
      document.fullscreenElement ? 'Exit fullscreen (Esc)' : 'Toggle true fullscreen (double-click map)'
    );
    handleResize();
  });

  const helpBtn = topBar.querySelector('#btn-toggle-help');
  const closeHelpBtn = helpModal.querySelector('#btn-close-help');
  const gotItHelpBtn = helpModal.querySelector('#btn-help-got-it');

  helpBtn?.addEventListener('click', () => helpModal.classList.remove('hidden'));
  closeHelpBtn?.addEventListener('click', () => helpModal.classList.add('hidden'));
  gotItHelpBtn?.addEventListener('click', () => helpModal.classList.add('hidden'));

  // Keyboard Event Callbacks (camera/environment only — every creature is AI-controlled)
  input.onResetWorld = () => {
    trainer.forceNewGeneration();
  };

  input.onToggleFollow = () => {
    camera.setFollow(input.cameraFollow);
  };

  input.onRegeneratePlants = () => {
    world.triggerRegeneratePlants();
    if (showcase) {
      showcase.updatePlantCount();
    }
  };

  input.onToggleViewMode = () => {
    setViewMode(currentView === 'showcase' ? 'simulation' : 'showcase');
  };

  // Canvas click: spectate the clicked creature (camera + HUD focus only — does not control it).
  // Left-click also drags the camera to pan/explore the map, so a click that
  // was really a pan gesture must not additionally select whatever creature
  // happened to be under the cursor when the drag ended.
  canvas.addEventListener('click', (e: MouseEvent) => {
    if (camera.consumeDidDrag()) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldPos = camera.screenToWorld(mouseX, mouseY);

    for (const c of world.allAliveCreatures) {
      const dist = Math.hypot(worldPos.x - c.x, worldPos.y - c.y);
      if (dist <= c.radius + 18) {
        world.setControlledCreature(c);
        return;
      }
    }
  });

  // Window Resize Handling
  function handleResize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (!camera.isFollowing) {
      camera.fitToScreen();
    }
  }

  window.addEventListener('resize', handleResize);
  handleResize();

  // Best-effort save if the tab/server is closed abruptly mid-training.
  window.addEventListener('pagehide', () => simTrainer.saveOnUnload());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) simTrainer.saveOnUnload();
  });

  // Always boot into the Standalone Menu Page on load
  setViewMode('showcase');

  // 60 Hz Decoupled Physics Loop via Accumulator
  const tickDt = 1 / CONFIG.tick.hz;
  const maxDeltaMs = CONFIG.tick.maxDtMs;
  const MAX_TICKS_PER_FRAME = 400; // safety cap so high speed can't hang a stalled tab
  let accumulator = 0;
  let lastTime = performance.now();

  let frameCount = 0;
  let fpsTimer = 0;
  let currentFps = 60;

  function loop(currentTime: number): void {
    const rawDeltaMs = currentTime - lastTime;
    lastTime = currentTime;

    const deltaMs = Math.min(rawDeltaMs, maxDeltaMs);
    const deltaSec = deltaMs / 1000;

    // Track FPS
    frameCount++;
    fpsTimer += deltaMs;
    if (fpsTimer >= 500) {
      currentFps = (frameCount * 1000) / fpsTimer;
      frameCount = 0;
      fpsTimer = 0;
    }

    // Run fixed AI-driven physics ticks for whichever arena is on screen.
    // speedMultiplier fast-forwards simulated time relative to wall-clock
    // time (more ticks run per rendered frame) rather than skipping
    // rendering, so the sim visibly runs faster instead of jumping.
    if (!input.isPaused && !maxModeActive) {
      accumulator += deltaSec * speedMultiplier;
      let ticksThisFrame = 0;
      while (accumulator >= tickDt && ticksThisFrame < MAX_TICKS_PER_FRAME) {
        trainer.step();
        accumulator -= tickDt;
        ticksThisFrame++;
      }
      if (ticksThisFrame >= MAX_TICKS_PER_FRAME) {
        // Drop the backlog rather than spiral into perpetual catch-up if a
        // frame stalls badly (e.g. tab was backgrounded) at high speed.
        accumulator = 0;
      }
    }

    if (!maxModeActive) {
      // In max mode, runMaxModeBatch's own self-scheduled loop owns
      // autosaving -- it runs far more often than this rAF callback does
      // once rendering is being skipped.
      simTrainer.maybeAutosave(currentTime / 1000);
    }

    // Update Camera position (smooth tracking if follow enabled)
    camera.followTarget = world.controlledCreature;
    camera.update();

    // Render frame if a simulation arena is active (max mode renders on its
    // own, much less frequently, from runMaxModeBatch instead).
    if (!maxModeActive && (currentView === 'simulation' || currentView === 'free')) {
      renderer.render(world, camera, input, currentFps, currentTime / 1000);
      updateTrainingStatsUI();

      if (brainViz.isVisible || sensorPanel.isVisible) {
        const controlled = world.controlledCreature;
        if (controlled && !controlled.isDead) {
          const agent = controlled.type === 'shark' ? trainer.sharkAgent : trainer.fishAgent;
          const latest = trainer.getLastForward(controlled.id);
          if (latest) {
            if (brainViz.isVisible) {
              brainViz.render(controlled, agent.network, latest.forward, latest.action, currentTime);
            }
            if (sensorPanel.isVisible) {
              sensorPanel.render(controlled, latest.forward.obs, currentTime);
            }
          }
        }
      }
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// Start simulation when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
