import { CanvasTexture, Texture } from 'three';

const textureCache = new Map<string, Texture>();

/**
 * Generates and caches procedural 2D particle textures via HTML5 Canvas.
 * Provides zero-asset visual fidelity out of the box without requiring external image files.
 */
export class ParticleTextureUtil {
  /**
   * Soft radial glow circular sprite.
   * Ideal for fire, glowing embers, smoke, snow, and magic particles.
   */
  static getRadialGlowTexture(size = 128): Texture {
    const key = `radial_glow_${size}`;
    let tex = textureCache.get(key);
    if (tex) return tex;

    const canvas = ParticleTextureUtil.createCanvas(size, size);
    if (!canvas) return new Texture();

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const center = size / 2;
      const gradient = ctx.createRadialGradient(
        center,
        center,
        0,
        center,
        center,
        center,
      );
      // Quadratic falloff from bright center to transparent edge
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.85)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)');
      gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.08)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }

    tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    textureCache.set(key, tex);
    return tex;
  }

  /**
   * Sharp 4-point spark / streak sprite.
   * Ideal for welding sparks, ricochets, electrical arcs, and sharp embers.
   */
  static getSparkTexture(size = 128): Texture {
    const key = `spark_${size}`;
    let tex = textureCache.get(key);
    if (tex) return tex;

    const canvas = ParticleTextureUtil.createCanvas(size, size);
    if (!canvas) return new Texture();

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const center = size / 2;

      // Central core
      const coreGrad = ctx.createRadialGradient(
        center,
        center,
        0,
        center,
        center,
        center * 0.25,
      );
      coreGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      coreGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = coreGrad;
      ctx.fillRect(0, 0, size, size);

      // Horizontal spike
      const hGrad = ctx.createLinearGradient(0, center, size, center);
      hGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      hGrad.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
      hGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = hGrad;
      ctx.fillRect(0, center - 2, size, 4);

      // Vertical spike
      const vGrad = ctx.createLinearGradient(center, 0, center, size);
      vGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      vGrad.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
      vGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = vGrad;
      ctx.fillRect(center - 2, 0, 4, size);
    }

    tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    textureCache.set(key, tex);
    return tex;
  }

  /**
   * Shockwave ring sprite.
   * Ideal for explosion blast waves, impact rings, and portal energy pulses.
   */
  static getRingTexture(size = 128): Texture {
    const key = `ring_${size}`;
    let tex = textureCache.get(key);
    if (tex) return tex;

    const canvas = ParticleTextureUtil.createCanvas(size, size);
    if (!canvas) return new Texture();

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const center = size / 2;
      const radius = size * 0.4;
      const thickness = size * 0.08;

      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.lineWidth = thickness;

      const grad = ctx.createRadialGradient(
        center,
        center,
        radius - thickness,
        center,
        center,
        radius + thickness,
      );
      grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.strokeStyle = grad;
      ctx.stroke();
    }

    tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    textureCache.set(key, tex);
    return tex;
  }

  /**
   * Soft organic smoke puff texture.
   * Uses overlapping soft radial circles to generate billowy cloud puffs.
   */
  static getSmokePuffTexture(size = 128): Texture {
    const key = `smoke_puff_${size}`;
    let tex = textureCache.get(key);
    if (tex) return tex;

    const canvas = ParticleTextureUtil.createCanvas(size, size);
    if (!canvas) return new Texture();

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const center = size / 2;
      // Central lobe
      ParticleTextureUtil.drawSoftDisc(ctx, center, center, size * 0.35, 0.7);
      // Secondary lobes
      const offsets = [
        [0.15, 0.1],
        [-0.15, -0.08],
        [0.08, -0.16],
        [-0.1, 0.14],
      ];
      for (const [ox, oy] of offsets) {
        ParticleTextureUtil.drawSoftDisc(
          ctx,
          center + ox * size,
          center + oy * size,
          size * 0.22,
          0.5,
        );
      }
    }

    tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    textureCache.set(key, tex);
    return tex;
  }

  private static drawSoftDisc(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    alpha: number,
  ): void {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    grad.addColorStop(0.6, `rgba(255, 255, 255, ${alpha * 0.4})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private static createCanvas(w: number, h: number): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }
}
