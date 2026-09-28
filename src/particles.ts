export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

export class ParticleSystem {
  public particles: Particle[] = [];

  public emitBubbles(x: number, y: number, count: number = 8, color: string = 'rgba(180, 230, 255, 0.8)'): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 45 + 15;
      const life = Math.random() * 0.4 + 0.3;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 15, // slight upward buoyancy
        radius: Math.random() * 3 + 1.5,
        color,
        alpha: 0.9,
        life: 0,
        maxLife: life,
      });
    }
  }

  public emitBiteImpact(x: number, y: number): void {
    // Sharp bite impact sparks / water cavitation
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 90 + 30;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 2.5 + 1,
        color: '#f8fafc',
        alpha: 1,
        life: 0,
        maxLife: 0.35,
      });
    }
    // Bubbles
    this.emitBubbles(x, y, 10, 'rgba(147, 197, 253, 0.7)');
  }

  public emitPlantSpores(x: number, y: number): void {
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 40 + 10;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 3 + 1,
        color: Math.random() > 0.4 ? '#5fff7a' : '#00f5d4',
        alpha: 1,
        life: 0,
        maxLife: 0.5,
      });
    }
  }

  /**
   * Dramatic blood & bubble cloud when small fish dies
   */
  public emitBloodCloud(x: number, y: number): void {
    // Ruby/crimson dissipating cloud
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 65 + 15;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 12,
        y: y + (Math.random() - 0.5) * 12,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 5 + 2.5,
        color: Math.random() > 0.5 ? 'rgba(239, 68, 68, 0.85)' : 'rgba(185, 28, 28, 0.85)',
        alpha: 0.95,
        life: 0,
        maxLife: Math.random() * 0.5 + 0.4,
      });
    }

    // Cavitation and water turbulence bubbles
    this.emitBubbles(x, y, 16, 'rgba(254, 205, 211, 0.8)');
  }

  /**
   * Meat chunk bite particles
   */
  public emitMeatBite(x: number, y: number): void {
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 50 + 20;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 3 + 1.2,
        color: '#f87171',
        alpha: 1,
        life: 0,
        maxLife: 0.4,
      });
    }
    this.emitBubbles(x, y, 6, 'rgba(254, 226, 226, 0.7)');
  }

  /**
   * Golden/cyan celebratory sparks when cloning reproduces a creature
   */
  public emitReproductionSparks(x: number, y: number, isShark: boolean = false): void {
    const mainColor = isShark ? '#38bdf8' : '#fbbf24';
    const subColor = isShark ? '#a5f3fc' : '#fef08a';

    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 80 + 35;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 3.5 + 1.5,
        color: Math.random() > 0.5 ? mainColor : subColor,
        alpha: 1,
        life: 0,
        maxLife: Math.random() * 0.4 + 0.4,
      });
    }
    this.emitBubbles(x, y, 12, 'rgba(255, 255, 255, 0.85)');
  }

  public update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.alpha = Math.max(0, 1 - p.life / p.maxLife);
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    if (this.particles.length === 0) return;

    ctx.save();
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
