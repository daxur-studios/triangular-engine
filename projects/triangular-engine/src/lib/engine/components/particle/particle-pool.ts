import { Color, MathUtils, Vector3, Vector3Tuple } from 'three';
import { ParticleEmitterConfig, RangeValue } from './particle.model';

export class ParticlePool {
  public activeCount = 0;
  private maxCount = 0;

  // CPU particle simulation buffers
  private pos!: Float32Array; // x, y, z
  private vel!: Float32Array; // vx, vy, vz
  private life!: Float32Array; // current age
  private maxLife!: Float32Array; // total lifetime
  private scaleStartEnd!: Float32Array; // start, end
  private opacityStartEnd!: Float32Array; // start, end
  private rot!: Float32Array; // rotation in rad
  private rotSpeed!: Float32Array; // rotation speed in rad/sec

  // Parsed color ramp (RGBA values per stop)
  private parsedColors: Color[] = [];

  // GPU Instanced Attributes arrays
  public aOffset!: Float32Array;
  public aScale!: Float32Array;
  public aColor!: Float32Array;
  public aRotation!: Float32Array;

  constructor(maxParticles = 500) {
    this.allocate(maxParticles);
  }

  allocate(maxParticles: number): void {
    if (this.maxCount === maxParticles) return;
    this.maxCount = maxParticles;
    this.activeCount = 0;

    // Allocate simulation state arrays
    this.pos = new Float32Array(maxParticles * 3);
    this.vel = new Float32Array(maxParticles * 3);
    this.life = new Float32Array(maxParticles);
    this.maxLife = new Float32Array(maxParticles);
    this.scaleStartEnd = new Float32Array(maxParticles * 2);
    this.opacityStartEnd = new Float32Array(maxParticles * 2);
    this.rot = new Float32Array(maxParticles);
    this.rotSpeed = new Float32Array(maxParticles);

    // Allocate GPU buffer arrays
    this.aOffset = new Float32Array(maxParticles * 3);
    this.aScale = new Float32Array(maxParticles);
    this.aColor = new Float32Array(maxParticles * 4);
    this.aRotation = new Float32Array(maxParticles);
  }

  setColorRamp(colorInput?: string | string[]): void {
    this.parsedColors = [];
    if (!colorInput) {
      this.parsedColors.push(new Color('#ffffff'));
      return;
    }
    const colors = Array.isArray(colorInput) ? colorInput : [colorInput];
    for (const c of colors) {
      this.parsedColors.push(new Color(c));
    }
  }

  spawn(config: ParticleEmitterConfig, origin = new Vector3()): boolean {
    if (this.activeCount >= this.maxCount) return false;

    const i = this.activeCount;
    this.activeCount++;

    const i2 = i * 2;
    const i3 = i * 3;

    // 1. Position from emitter shape
    const offset = this.sampleEmitterShape(config.shape ?? 'point', config.shapeSize ?? 0);
    this.pos[i3] = origin.x + offset.x;
    this.pos[i3 + 1] = origin.y + offset.y;
    this.pos[i3 + 2] = origin.z + offset.z;

    // 2. Velocity from direction, spread, and speed
    const dir = new Vector3(...(config.direction ?? [0, 1, 0])).normalize();
    const speed = this.sampleRange(config.speed ?? [1, 2]);
    const spreadRad = MathUtils.degToRad(config.spread ?? 45);

    const v = this.sampleConeDirection(dir, spreadRad).multiplyScalar(speed);
    this.vel[i3] = v.x;
    this.vel[i3 + 1] = v.y;
    this.vel[i3 + 2] = v.z;

    // 3. Lifetime
    const maxAge = Math.max(0.01, this.sampleRange(config.lifetime ?? [1, 2]));
    this.life[i] = 0;
    this.maxLife[i] = maxAge;

    // 4. Size evolution
    const size = config.size ?? [0.3, 0.1];
    if (Array.isArray(size)) {
      this.scaleStartEnd[i2] = size[0];
      this.scaleStartEnd[i2 + 1] = size[1];
    } else {
      this.scaleStartEnd[i2] = size;
      this.scaleStartEnd[i2 + 1] = size;
    }

    // 5. Opacity evolution
    const opacity = config.opacity ?? [1, 0];
    if (Array.isArray(opacity)) {
      this.opacityStartEnd[i2] = opacity[0];
      this.opacityStartEnd[i2 + 1] = opacity[1];
    } else {
      this.opacityStartEnd[i2] = opacity;
      this.opacityStartEnd[i2 + 1] = opacity;
    }

    // 6. Rotation
    this.rot[i] = Math.random() * Math.PI * 2;
    this.rotSpeed[i] = this.sampleRange(config.rotationSpeed ?? 0);

    return true;
  }

  update(delta: number, config: ParticleEmitterConfig): void {
    const grav = config.gravity ?? [0, 0, 0];
    const gx = grav[0];
    const gy = grav[1];
    const gz = grav[2];

    const damping = config.damping ?? 1.0;
    const dampingFactor = damping === 1.0 ? 1.0 : Math.pow(damping, delta * 60);

    const colorStops = this.parsedColors;
    const stopCount = colorStops.length;

    let i = 0;
    while (i < this.activeCount) {
      const age = this.life[i] + delta;
      const maxAge = this.maxLife[i];

      if (age >= maxAge) {
        // Particle died - swap with last active particle
        this.activeCount--;
        if (i < this.activeCount) {
          this.swap(i, this.activeCount);
        }
        continue;
      }

      this.life[i] = age;
      const t = age / maxAge; // Normalized progress 0 to 1

      const i2 = i * 2;
      const i3 = i * 3;
      const i4 = i * 4;

      // Integrate physics
      this.vel[i3] = (this.vel[i3] + gx * delta) * dampingFactor;
      this.vel[i3 + 1] = (this.vel[i3 + 1] + gy * delta) * dampingFactor;
      this.vel[i3 + 2] = (this.vel[i3 + 2] + gz * delta) * dampingFactor;

      const px = (this.pos[i3] += this.vel[i3] * delta);
      const py = (this.pos[i3 + 1] += this.vel[i3 + 1] * delta);
      const pz = (this.pos[i3 + 2] += this.vel[i3 + 2] * delta);

      // Write GPU offset
      this.aOffset[i3] = px;
      this.aOffset[i3 + 1] = py;
      this.aOffset[i3 + 2] = pz;

      // Interpolate Scale
      const s0 = this.scaleStartEnd[i2];
      const s1 = this.scaleStartEnd[i2 + 1];
      this.aScale[i] = s0 + (s1 - s0) * t;

      // Update Rotation
      this.rot[i] += this.rotSpeed[i] * delta;
      this.aRotation[i] = this.rot[i];

      // Interpolate Opacity
      const a0 = this.opacityStartEnd[i2];
      const a1 = this.opacityStartEnd[i2 + 1];
      const alpha = Math.max(0, Math.min(1, a0 + (a1 - a0) * t));

      // Interpolate Color Ramp
      let r = 1;
      let g = 1;
      let b = 1;
      if (stopCount === 1) {
        r = colorStops[0].r;
        g = colorStops[0].g;
        b = colorStops[0].b;
      } else if (stopCount > 1) {
        const scaledT = t * (stopCount - 1);
        const idx = Math.min(Math.floor(scaledT), stopCount - 2);
        const segmentT = scaledT - idx;
        const c0 = colorStops[idx];
        const c1 = colorStops[idx + 1];
        r = c0.r + (c1.r - c0.r) * segmentT;
        g = c0.g + (c1.g - c0.g) * segmentT;
        b = c0.b + (c1.b - c0.b) * segmentT;
      }

      this.aColor[i4] = r;
      this.aColor[i4 + 1] = g;
      this.aColor[i4 + 2] = b;
      this.aColor[i4 + 3] = alpha;

      i++;
    }
  }

  private swap(a: number, b: number): void {
    const a2 = a * 2;
    const b2 = b * 2;
    const a3 = a * 3;
    const b3 = b * 3;

    this.pos[a3] = this.pos[b3];
    this.pos[a3 + 1] = this.pos[b3 + 1];
    this.pos[a3 + 2] = this.pos[b3 + 2];

    this.vel[a3] = this.vel[b3];
    this.vel[a3 + 1] = this.vel[b3 + 1];
    this.vel[a3 + 2] = this.vel[b3 + 2];

    this.life[a] = this.life[b];
    this.maxLife[a] = this.maxLife[b];

    this.scaleStartEnd[a2] = this.scaleStartEnd[b2];
    this.scaleStartEnd[a2 + 1] = this.scaleStartEnd[b2 + 1];

    this.opacityStartEnd[a2] = this.opacityStartEnd[b2];
    this.opacityStartEnd[a2 + 1] = this.opacityStartEnd[b2 + 1];

    this.rot[a] = this.rot[b];
    this.rotSpeed[a] = this.rotSpeed[b];
  }

  clear(): void {
    this.activeCount = 0;
  }

  private sampleRange(val: RangeValue): number {
    if (typeof val === 'number') return val;
    return val[0] + Math.random() * (val[1] - val[0]);
  }

  private sampleConeDirection(direction: Vector3, spreadRad: number): Vector3 {
    if (spreadRad >= Math.PI) {
      // Full 360 sphere distribution
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      return new Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      );
    }

    if (spreadRad <= 0.001) {
      return direction.clone();
    }

    // Cone deviation around direction vector
    const cosAngle = Math.cos(spreadRad);
    const z = cosAngle + Math.random() * (1 - cosAngle);
    const phi = Math.random() * 2 * Math.PI;
    const sinTheta = Math.sqrt(1 - z * z);
    const local = new Vector3(sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), z);

    // Rotate local vector to align with target direction
    const defaultDir = new Vector3(0, 0, 1);
    if (direction.dot(defaultDir) > 0.999) return local;
    if (direction.dot(defaultDir) < -0.999) return local.set(-local.x, -local.y, -local.z);

    const axis = new Vector3().crossVectors(defaultDir, direction).normalize();
    const angle = defaultDir.angleTo(direction);
    return local.applyAxisAngle(axis, angle);
  }

  private sampleEmitterShape(shape: string, size: Vector3Tuple | number): Vector3 {
    if (shape === 'point') return new Vector3(0, 0, 0);

    if (shape === 'sphere') {
      const radius = typeof size === 'number' ? size : size[0];
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = Math.cbrt(Math.random()) * radius;
      return new Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      );
    }

    if (shape === 'ring') {
      const radius = typeof size === 'number' ? size : size[0];
      const theta = Math.random() * Math.PI * 2;
      return new Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius);
    }

    if (shape === 'box') {
      const halfW = (Array.isArray(size) ? size[0] : size) * 0.5;
      const halfH = (Array.isArray(size) ? size[1] : size) * 0.5;
      const halfD = (Array.isArray(size) ? size[2] : size) * 0.5;
      return new Vector3(
        (Math.random() * 2 - 1) * halfW,
        (Math.random() * 2 - 1) * halfH,
        (Math.random() * 2 - 1) * halfD,
      );
    }

    return new Vector3(0, 0, 0);
  }
}
