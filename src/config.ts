export const CONFIG = {
  world: {
    width: 2000,
    height: 1200,
    wallThickness: 20,
    seed: 12345,
  },
  tick: {
    hz: 60,
    maxDtMs: 100,
  },
  obstacles: {
    minCount: 15,
    maxCount: 25,
    minSpacing: 80,
    wallMargin: 60,
  },
  plants: {
    cap: 4000,
    initial: 400,
    spawnIntervalSec: 4,
    radius: 7,
    obstacleMargin: 40,
    wallMargin: 80,
    coverRadius: 24, // Radius within which plants provide visual camouflage cover
  },
  species: {
    shark: {
      name: 'Shark (Large Fish)',
      radius: 14,
      mass: 2.5,
      maxThrust: 350, // Faster, powerful thrust
      maxSpeed: 190,  // Faster top cruising speed
      maxTurnRate: 2.6, // Snappy turns
      drag: 0.90,
      biteRange: 55,
      biteCooldown: 0.35,
      initialCount: 5,
      foodToClone: 2, // Eating 2 small fish (or equivalent meat) triggers cloning
      energyMax: 100,
      energyDrainPerSec: 2.2, // Must hunt regularly or starve
      energyGainPerFood: 45,
    },
    fish: {
      name: 'Fish (Small Fish)',
      radius: 8,
      mass: 1.0,
      maxThrust: 420, // Fast darting thrust
      maxSpeed: 220,  // Faster top dart speed
      maxTurnRate: 4.2, // Agile, rapid turns
      drag: 0.92,
      biteRange: 38,
      biteCooldown: 0.25,
      initialCount: 25, // 25 small fish at startup!
      foodToClone: 3,  // Eating 3 plants or meat remains triggers cloning
      energyMax: 100,
      energyDrainPerSec: 1.4,
      energyGainPerFood: 30,
    },
  },
  rl: {
    hiddenSize: 24,
    learningRate: 0.01,
    rewardDiscount: 0.97,
    baselineDecay: 0.98,
    maxEpisodeTicks: 60 * 90, // 90s safety cap per generation even without extinction
    autosaveIntervalSec: 15,
    perTickSurviveReward: 0.01,
    eatReward: 1.0,
    cloneReward: 2.0,
    deathPenalty: -1.0,
  },
  remains: {
    decayTime: 50,
    radius: 7,
  },
  camera: {
    minZoom: 0.3,
    maxZoom: 3.0,
    initialZoom: 'fit' as const,
  },
  colors: {
    bgTop: '#0a1a2f',
    bgBottom: '#020810',
    obstacle: '#4a5a52',
    obstacleShadow: 'rgba(0,0,0,0.4)',
    plant: '#5fff7a',
    plantGlow: '#00f5d4',
    plantStem: '#10b981',
    shark: '#4a6a8a',
    sharkDark: '#2a3a4a',
    fish: '#ff9a3c',
    fishDark: '#cc7020',
    wall: '#0e1a2a',
    meat: '#ef4444',
    meatDark: '#991b1b',
  },
};

export type SpeciesType = 'shark' | 'fish';
export type SpeciesStats = (typeof CONFIG.species)[SpeciesType];
