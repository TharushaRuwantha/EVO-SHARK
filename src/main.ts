import './index.css';
import { CONFIG } from './config';
import { World } from './world';
import { InputManager } from './input';
import { Camera } from './camera';
import { Renderer } from './render';
import { ActorShowcase, PilotTarget } from './showcase';
import { sound } from './audio';

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
  canvas.className = 'w-full h-full block cursor-crosshair';
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
    'absolute top-3 left-3 right-3 sm:left-4 sm:right-4 z-40 flex flex-wrap items-center justify-between gap-2.5 px-3.5 sm:px-4 py-2.5 rounded-2xl bg-slate-950/80 backdrop-blur-xl border border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.5)] text-xs text-slate-200 select-none transition-colors duration-300';
  topBar.innerHTML = `
    <!-- Left: Return to Standalone Menu Page + Mode Badge -->
    <div class="flex items-center gap-2">
      <button id="btn-back-to-menu" title="Return to Standalone Menu Page (M or Esc)" class="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-900 to-blue-900 border border-cyan-500/70 hover:from-cyan-800 hover:to-blue-800 text-cyan-200 font-bold transition-all duration-150 flex items-center gap-2 cursor-pointer shadow-md hover:shadow-cyan-950 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
        <span>☰</span> <span class="hidden sm:inline">Main Menu</span> <kbd class="px-1 py-0.5 rounded bg-cyan-950 text-[10px] text-cyan-300 font-mono">M</kbd>
      </button>
      <span id="mode-badge" class="hidden px-2.5 py-1 rounded-lg bg-violet-950/80 border border-violet-500/60 text-violet-300 font-bold text-[10px] tracking-widest uppercase items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"></span> Free Test Arena
      </span>
    </div>

    <!-- Center: Creature Controller Switcher (Shark / Small Fish) -->
    <div id="controller-switcher" class="flex items-center gap-2">
      <span class="text-[11px] font-mono text-slate-400 uppercase tracking-wider hidden sm:inline">Pilot:</span>
      <div class="flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-800">
        <button id="btn-ctrl-shark" class="px-3 py-1.5 rounded-lg font-bold transition-all duration-150 flex items-center gap-1.5 bg-sky-950 border border-sky-500/80 text-sky-300 shadow-sm cursor-pointer active:scale-95">
          <span>🦈</span> <span id="label-shark">Shark</span> <kbd class="px-1 py-0.5 rounded bg-sky-900/80 text-[10px] text-sky-200 font-mono">1</kbd>
        </button>
        <button id="btn-ctrl-fish" class="px-3 py-1.5 rounded-lg font-medium transition-all duration-150 flex items-center gap-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800/80 cursor-pointer active:scale-95">
          <span>🐟</span> <span id="label-fish">Fish (20 alive)</span> <kbd class="px-1 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">2</kbd>
        </button>
      </div>

      <!-- Quick Bite Action Indicator / Button -->
      <button id="btn-quick-bite" class="px-3 py-1.5 rounded-xl font-bold transition-all duration-150 flex items-center gap-1.5 border border-slate-700 bg-slate-900 text-slate-400 cursor-pointer shadow-md active:scale-95">
        <span>💥</span> <span id="bite-button-text">Bite</span> <kbd class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono">Space</kbd>
      </button>
    </div>

    <!-- Right: Quick Environment Actions -->
    <div class="flex items-center gap-1.5 sm:gap-2">
      <button id="btn-top-regen-plants" title="Regenerate all plants in the ocean" class="px-2.5 py-1.5 rounded-xl bg-emerald-950/70 border border-emerald-600/50 hover:bg-emerald-900/60 text-emerald-300 font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer active:scale-95">
        <span>🌱</span> <span class="hidden lg:inline">Regen Plants</span> <kbd class="hidden md:inline px-1 py-0.5 rounded bg-emerald-900/80 text-[10px] text-emerald-200 font-mono">E</kbd>
      </button>

      <button id="btn-toggle-follow" title="Toggle camera following creature" class="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 font-medium flex items-center gap-1 transition-all duration-150 cursor-pointer active:scale-95">
        <span>🎥</span> <span class="hidden lg:inline">Follow</span> <kbd class="hidden md:inline px-1 py-0.5 rounded bg-slate-800 text-[10px] font-mono">F</kbd>
      </button>

      <button id="btn-reset-world" title="Reset ocean with fresh seed" class="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 font-medium flex items-center gap-1 transition-all duration-150 cursor-pointer active:scale-95">
        <span>🔄</span> <span class="hidden lg:inline">Reset</span> <kbd class="hidden md:inline px-1 py-0.5 rounded bg-slate-800 text-[10px] font-mono">R</kbd>
      </button>

      <button id="btn-toggle-sound" title="Toggle sound effects" class="p-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm transition-all duration-150 cursor-pointer active:scale-95">
        🔊
      </button>

      <button id="btn-toggle-help" title="Controls help" class="p-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm transition-all duration-150 cursor-pointer active:scale-95">
        ❓
      </button>
    </div>
  `;
  appContainer.appendChild(topBar);

  // Controls Modal / Guide
  const helpModal = document.createElement('div');
  helpModal.id = 'help-modal';
  helpModal.className =
    'hidden absolute inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4';
  helpModal.innerHTML = `
    <div class="bg-slate-950 border border-cyan-800/60 rounded-2xl p-6 max-w-md w-full shadow-2xl text-slate-200 text-xs">
      <div class="flex items-center justify-between pb-3 border-b border-slate-800">
        <h3 class="text-base font-bold text-cyan-300 flex items-center gap-2">
          <span>🎮</span> Controls & Ecosystem Guide
        </h3>
        <button id="btn-close-help" class="text-slate-400 hover:text-white text-base font-bold cursor-pointer">✕</button>
      </div>

      <div class="mt-4 space-y-3 font-mono">
        <div class="flex justify-between py-1 border-b border-slate-900">
          <span class="text-slate-400">Thrust Forward:</span>
          <span class="text-cyan-300 font-bold">W or ↑</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-900">
          <span class="text-slate-400">Turn Left / Right:</span>
          <span class="text-cyan-300 font-bold">A / D or ← / →</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-900">
          <span class="text-slate-400">Bite (Must Bite to Eat/Kill):</span>
          <span class="text-rose-400 font-bold">SPACE BAR</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-900">
          <span class="text-slate-400">Switch / Cycle Creature:</span>
          <span class="text-amber-300 font-bold">Tab (or 1: Shark, 2: Fish)</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-900">
          <span class="text-slate-400">Click Any Creature:</span>
          <span class="text-cyan-300 font-bold">Instantly Pilots It</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-900">
          <span class="text-slate-400">Shark Eats Small Fish:</span>
          <span class="text-rose-400">Fish dies & spawns meat remains</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-900">
          <span class="text-slate-400">Eat Enough to Clone:</span>
          <span class="text-emerald-400">Fish: 3 foods · Shark: 2 foods</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-900">
          <span class="text-slate-400">Regenerate Plants:</span>
          <span class="text-emerald-400 font-bold">E</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-900">
          <span class="text-slate-400">Actor Showcase View:</span>
          <span class="text-cyan-300 font-bold">M</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-900">
          <span class="text-slate-400">Camera Pan & Zoom:</span>
          <span class="text-slate-300">Mouse Wheel / Middle Drag</span>
        </div>
        <div class="flex justify-between py-1">
          <span class="text-slate-400">Follow Camera:</span>
          <span class="text-slate-300">F</span>
        </div>
      </div>

      <div class="mt-5 pt-3 border-t border-slate-800 text-center">
        <button id="btn-help-got-it" class="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold tracking-wide cursor-pointer transition">
          Got it!
        </button>
      </div>
    </div>
  `;
  appContainer.appendChild(helpModal);

  // Initialize Core Systems
  const input = new InputManager();
  const camera = new Camera(canvas, input);
  const renderer = new Renderer(canvas);

  // Main simulation world (#/sim) and an exact, fully independent copy of it
  // mounted at (#/free) for separate experimentation/testing without ever
  // touching the state of the main simulation.
  const simWorld = new World(CONFIG.world.seed);
  const freeWorld = new World(CONFIG.world.seed + 1);

  // `world` always points at whichever world is currently active/on-screen.
  let world: World = simWorld;

  camera.followTarget = world.controlledCreature;

  // Showcase instance
  let showcase: ActorShowcase | null = null;

  const modeBadge = topBar.querySelector('#mode-badge');

  // Separate Page Router / View Mode Switcher
  function setViewMode(mode: ViewMode, pilotTarget?: PilotTarget): void {
    currentView = mode;

    if (mode === 'simulation' || mode === 'free') {
      world = mode === 'free' ? freeWorld : simWorld;
    }

    if (pilotTarget === 'shark') {
      world.setControlledByIndex(0);
      updateControllerButtons();
    } else if (pilotTarget === 'fish') {
      world.cycleSmallFish();
      updateControllerButtons();
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
      updateControllerButtons();
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

  // Update Creature Controller Buttons UI
  function updateControllerButtons(): void {
    const btnShark = topBar.querySelector('#btn-ctrl-shark');
    const btnFish = topBar.querySelector('#btn-ctrl-fish');
    const labelShark = topBar.querySelector('#label-shark');
    const labelFish = topBar.querySelector('#label-fish');

    const controlled = world.controlledCreature;
    const isShark = controlled && controlled.type === 'shark';

    if (labelShark) {
      labelShark.textContent = `Shark (${world.aliveSharks.length})`;
    }
    if (labelFish) {
      labelFish.textContent = `Fish (${world.aliveFish.length} alive)`;
    }

    if (isShark) {
      btnShark?.classList.add('bg-sky-950', 'border-sky-500/80', 'text-sky-300', 'shadow-sm');
      btnShark?.classList.remove('text-slate-400', 'border-transparent');
      btnFish?.classList.remove('bg-amber-950', 'border-amber-500/80', 'text-amber-300', 'shadow-sm');
      btnFish?.classList.add('text-slate-400');
    } else {
      btnFish?.classList.add('bg-amber-950', 'border-amber-500/80', 'text-amber-300', 'shadow-sm');
      btnFish?.classList.remove('text-slate-400', 'border-transparent');
      btnShark?.classList.remove('bg-sky-950', 'border-sky-500/80', 'text-sky-300', 'shadow-sm');
      btnShark?.classList.add('text-slate-400');
    }

    camera.followTarget = world.controlledCreature;
  }

  // Update Bite Prompt & Button UI
  function updateBiteButtonUI(): void {
    const quickBiteBtn = topBar.querySelector('#btn-quick-bite');
    const biteText = topBar.querySelector('#bite-button-text');
    const inRange = world.isTargetInBiteRange();
    const controlled = world.controlledCreature;

    if (inRange) {
      quickBiteBtn?.classList.remove('border-slate-700', 'bg-slate-900', 'text-slate-400');
      quickBiteBtn?.classList.add('border-rose-500', 'bg-rose-950', 'text-rose-300', 'animate-pulse');
      if (biteText) {
        biteText.textContent = controlled?.type === 'shark' ? 'KILL FISH!' : 'BITE FOOD!';
      }
    } else {
      quickBiteBtn?.classList.add('border-slate-700', 'bg-slate-900', 'text-slate-400');
      quickBiteBtn?.classList.remove('border-rose-500', 'bg-rose-950', 'text-rose-300', 'animate-pulse');
      if (biteText) {
        biteText.textContent = 'Bite';
      }
    }
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

  topBar.querySelector('#btn-ctrl-shark')?.addEventListener('click', () => {
    world.setControlledByIndex(0);
    updateControllerButtons();
  });

  topBar.querySelector('#btn-ctrl-fish')?.addEventListener('click', () => {
    world.cycleSmallFish();
    updateControllerButtons();
  });

  topBar.querySelector('#btn-quick-bite')?.addEventListener('click', () => {
    world.performBite();
  });

  topBar.querySelector('#btn-top-regen-plants')?.addEventListener('click', () => {
    world.triggerRegeneratePlants();
  });

  topBar.querySelector('#btn-toggle-follow')?.addEventListener('click', () => {
    input.cameraFollow = !input.cameraFollow;
    camera.setFollow(input.cameraFollow);
  });

  topBar.querySelector('#btn-reset-world')?.addEventListener('click', () => {
    const newSeed = Math.floor(Math.random() * 1000000);
    world.reset(newSeed);
    updateControllerButtons();
  });

  const soundBtn = topBar.querySelector('#btn-toggle-sound');
  soundBtn?.addEventListener('click', () => {
    const muted = sound.toggleMute();
    if (soundBtn) {
      soundBtn.textContent = muted ? '🔇' : '🔊';
    }
  });

  const helpBtn = topBar.querySelector('#btn-toggle-help');
  const closeHelpBtn = helpModal.querySelector('#btn-close-help');
  const gotItHelpBtn = helpModal.querySelector('#btn-help-got-it');

  helpBtn?.addEventListener('click', () => helpModal.classList.remove('hidden'));
  closeHelpBtn?.addEventListener('click', () => helpModal.classList.add('hidden'));
  gotItHelpBtn?.addEventListener('click', () => helpModal.classList.add('hidden'));

  // Keyboard Event Callbacks
  input.onSwitchCreature = () => {
    world.switchControlledCreature();
    updateControllerButtons();
  };

  input.onSelectCreature = (index: number) => {
    if (index === 0) {
      world.setControlledByIndex(0);
    } else {
      world.cycleSmallFish();
    }
    updateControllerButtons();
  };

  input.onResetWorld = () => {
    const newSeed = Math.floor(Math.random() * 1000000);
    world.reset(newSeed);
    updateControllerButtons();
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

  input.onBiteTriggered = () => {
    world.performBite();
  };

  // Canvas Click to select creatures in world
  canvas.addEventListener('click', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldPos = camera.screenToWorld(mouseX, mouseY);

    // Check all alive creatures (sharks and fish)
    for (const c of world.allAliveCreatures) {
      const dist = Math.hypot(worldPos.x - c.x, worldPos.y - c.y);
      if (dist <= c.radius + 18) {
        world.setControlledCreature(c);
        updateControllerButtons();
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

  // Always boot into the Standalone Menu Page on load
  setViewMode('showcase');

  // 60 Hz Decoupled Physics Loop via Accumulator
  const tickDt = 1 / CONFIG.tick.hz;
  const maxDeltaMs = CONFIG.tick.maxDtMs;
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

    // Run fixed physics ticks
    if (!input.isPaused) {
      accumulator += deltaSec;
      while (accumulator >= tickDt) {
        world.tick(input);
        accumulator -= tickDt;
      }
    }

    // Update Camera position (smooth tracking if follow enabled)
    camera.followTarget = world.controlledCreature;
    camera.update();

    // Render frame if simulation is active
    if (currentView === 'simulation') {
      renderer.render(world, camera, input, currentFps, currentTime / 1000);
      updateBiteButtonUI();
      updateControllerButtons();
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
