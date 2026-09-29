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
  spawn: {
    wallMargin: 60, // min distance from any wall at spawn
    obstacleMargin: 40, // min distance from any obstacle at spawn
    sameSpeciesMinDist: 40, // min distance between two creatures of the same species
    preySharkMinDist: 200, // min distance between any fish and any shark
    sharkSharkMinDist: 300, // min distance between two sharks
  },
  plants: {
    cap: 4000, // hard safety ceiling for manual regen/burst actions only
    initial: 400,
    spawnIntervalSec: 4, // used by manual regen/burst actions only
    radius: 7,
    obstacleMargin: 40,
    wallMargin: 80,
    minSpacing: 30, // min distance from any other plant when placing a new one
    coverRadius: 24, // Radius within which plants provide visual camouflage cover
    // Automatic per-tick population growth (see plant.ts updatePlantReproduction):
    // logistic growth growthPerSecond = r * P * (1 - P / K), plus a small
    // constant seeding term below K so the world always has some recovery.
    growth: {
      K: 50, // carrying capacity for automatic regrowth
      r: 0.04, // intrinsic growth rate per second
      seedRatePerSec: 0.02, // minimum growth/sec while below K, even at P=0
    },
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
      biteRange: 55, // proximity used for meat-scavenging and the AI targeting cue
      biteCooldownTicks: 18, // ticks between bite attempts (60Hz tick)
      initialCount: 2,
      foodToClone: 2, // Eating 2 small fish (or equivalent meat) triggers cloning
      // Energy
      energyMax: 100,
      idleDrain: 0.03, // energy/tick while idle
      thrustDrain: 0.15, // extra energy/tick at full thrust
      energyGainPerFood: 45, // scavenging floating meat remains
      preyEnergyGain: 80, // killing prey outright with a bite
      // Health regeneration: costs energy, scales with how fed the
      // creature is, and stops entirely below minEnergyToHeal.
      maxHealth: 100,
      maxRegenRate: 0.03, // HP/tick at full energy
      minEnergyToHeal: 0.3, // energy fraction below which no healing happens
      costPerHP: 0.5, // energy spent per HP restored
      // Bite attack
      biteDamage: 12,
      biteEnergyCost: 2, // spent per bite attempt, hit or miss
      biteHitboxOffset: 20, // units in front of the mouth
      biteHitboxRadius: 18,
      plantEnergyGain: 0, // sharks don't eat plants
    },
    fish: {
      name: 'Fish (Small Fish)',
      radius: 8,
      mass: 1.0,
      maxThrust: 420, // Fast darting thrust
      maxSpeed: 220,  // Faster top dart speed
      maxTurnRate: 4.2, // Agile, rapid turns
      drag: 0.92,
      biteRange: 38, // proximity used for meat-scavenging and the AI targeting cue
      biteCooldownTicks: 15, // ticks between eat attempts (60Hz tick)
      initialCount: 20,
      foodToClone: 3,  // Eating 3 plants or meat remains triggers cloning
      // Energy
      energyMax: 100,
      idleDrain: 0.01, // energy/tick while idle
      thrustDrain: 0.05, // extra energy/tick at full thrust
      energyGainPerFood: 30, // scavenging floating meat remains
      plantEnergyGain: 25, // eating a plant
      preyEnergyGain: 0, // fish don't kill prey
      // Health regeneration: costs energy, scales with how fed the
      // creature is, and stops entirely below minEnergyToHeal.
      maxHealth: 30,
      maxRegenRate: 0.05, // HP/tick at full energy
      minEnergyToHeal: 0.3, // energy fraction below which no healing happens
      costPerHP: 0.5, // energy spent per HP restored
      // Bite attack (fish have no attack damage, but share the shape so
      // SpeciesStats stays a single uniform type across both species)
      biteDamage: 0,
      biteEnergyCost: 0,
      biteHitboxOffset: 0,
      biteHitboxRadius: 0,
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
  sensors: {
    vision: {
      shark: { rayCount: 12, fovDeg: 240, range: 400, angularJitterDeg: 5, distanceNoisePct: 10 },
      fish: { rayCount: 12, fovDeg: 280, range: 350, angularJitterDeg: 5, distanceNoisePct: 10 },
    },
    smell: {
      gridW: 50,
      gridH: 30,
      cellSize: 40,
      diffusionRate: 0.1,
      decayRate: 0.02,
      maxValue: 1.0,
      sampleRadius: 60,
      noisePct: 8,
    },
    lateralLine: {
      shark: { range: 200, noisePct: 10 },
      fish: { range: 180, noisePct: 10 },
    },
    electroreception: {
      shark: { range: 60, noisePct: 15 },
      fish: { range: 50, noisePct: 15 },
    },
    physiology: {
      recentDamageTicks: 6,
    },
  },
  camera: {
    // No static minZoom: Camera computes it dynamically as the
    // fit-entire-world-with-padding zoom level (see Camera.fitToScreen),
    // since that depends on the current viewport size, not a constant.
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
