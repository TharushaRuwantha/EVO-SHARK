import { CreatureInput } from './creature';

export interface DebugToggles {
  grid: boolean;
  velocity: boolean;
  heading: boolean;
  bounds: boolean;
  senses: boolean; // vision rays + touch + electroreception + lateral line, for the controlled creature
  scent: boolean; // world-space scent field heatmap
}

export class InputManager {
  private keys: Set<string> = new Set();
  public debugToggles: DebugToggles = {
    grid: false,
    velocity: false,
    heading: false,
    bounds: false,
    senses: false,
    scent: false,
  };

  public isPaused: boolean = false;
  public cameraFollow: boolean = false;

  get showGrid(): boolean {
    return this.debugToggles.grid;
  }
  get showVelocityArrows(): boolean {
    return this.debugToggles.velocity;
  }
  get showHeadingLines(): boolean {
    return this.debugToggles.heading;
  }
  get showBoundingCircles(): boolean {
    return this.debugToggles.bounds;
  }
  get showSenses(): boolean {
    return this.debugToggles.senses;
  }
  get showScent(): boolean {
    return this.debugToggles.scent;
  }

  private biteTriggerPending: boolean = false;

  public onSwitchCreature?: () => void;
  public onSelectCreature?: (index: number) => void;
  public onResetWorld?: () => void;
  public onToggleFollow?: () => void;
  public onBiteTriggered?: () => void;
  public onRegeneratePlants?: () => void;
  public onToggleViewMode?: () => void;
  public onToggleBrainViz?: () => void;
  public onToggleSensorPanel?: () => void;

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  public destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const isRepeat = e.repeat;
    this.keys.add(e.code);

    // Prevent default browser scrolling/tab-navigation
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }

    if (e.code === 'Tab') {
      this.onSwitchCreature?.();
    } else if (e.code === 'Digit1') {
      this.onSelectCreature?.(0); // Shark / Large Fish
    } else if (e.code === 'Digit2') {
      this.onSelectCreature?.(1); // Small Fish
    } else if (e.code === 'Space') {
      if (!isRepeat) {
        this.biteTriggerPending = true;
        this.onBiteTriggered?.();
      }
    } else if (e.code === 'KeyE') {
      this.onRegeneratePlants?.();
    } else if (e.code === 'KeyM' || e.code === 'Escape') {
      this.onToggleViewMode?.();
    } else if (e.code === 'KeyF') {
      this.cameraFollow = !this.cameraFollow;
      this.onToggleFollow?.();
    } else if (e.code === 'KeyR') {
      this.onResetWorld?.();
    } else if (e.code === 'KeyP') {
      this.isPaused = !this.isPaused;
    } else if (e.code === 'KeyG') {
      this.debugToggles.grid = !this.debugToggles.grid;
    } else if (e.code === 'KeyV') {
      this.debugToggles.velocity = !this.debugToggles.velocity;
    } else if (e.code === 'KeyH') {
      this.debugToggles.heading = !this.debugToggles.heading;
    } else if (e.code === 'KeyB') {
      this.debugToggles.bounds = !this.debugToggles.bounds;
    } else if (e.code === 'KeyN') {
      this.onToggleBrainViz?.();
    } else if (e.code === 'KeyC') {
      this.debugToggles.senses = !this.debugToggles.senses;
    } else if (e.code === 'KeyS') {
      this.debugToggles.scent = !this.debugToggles.scent;
    } else if (e.code === 'KeyX') {
      this.onToggleSensorPanel?.();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  public isSpacePressed(): boolean {
    return this.keys.has('Space');
  }

  /**
   * Produce physics input for the controlled creature
   */
  public getControlledCreatureInput(): CreatureInput {
    // Thrust forward (W or Up arrow)
    const thrust = (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ? 1 : 0;

    // S or Down arrow means coast (do NOT reverse)
    let turn = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
      turn -= 1;
    }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
      turn += 1;
    }

    // Space: acts as bite trigger and also hydrodynamic brake
    const isBraking = this.keys.has('Space');
    const wantsBite = this.biteTriggerPending;
    this.biteTriggerPending = false; // consume trigger

    return {
      thrustInput: thrust,
      turnInput: turn,
      isBraking,
      wantsBite,
    };
  }

  /**
   * For the uncontrolled creature: no input, coasts to a stop via drag
   */
  public getUncontrolledCreatureInput(): CreatureInput {
    return {
      thrustInput: 0,
      turnInput: 0,
      isBraking: false,
      wantsBite: false,
    };
  }
}
