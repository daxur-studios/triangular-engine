/**
 * Flat ID-colour rendering for the Capsule Doodle character.
 *
 * Each face part renders in one unlit, untone-mapped colour so a render can be decoded
 * pixel by pixel into part IDs. The body mesh uses a shader that shares the shaded body's
 * suit split and mouth outline, so the skin, suit and mouth boundaries are the same
 * mathematics as the normal render.
 */

import {
  Color,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  type Object3D,
  ShaderMaterial,
  type Side,
} from 'three';
import { CAPSULE_MOUTH_SDF_GLSL, type CapsuleBodyUniformMap } from './capsule-body-material';

/** Part IDs a Capsule Doodle ID-colour render can contain, besides the background. */
export type CapsulePartId =
  | 'headSkin'
  | 'suit'
  | 'eyeWhite'
  | 'pupil'
  | 'mouth'
  | 'hair'
  | 'brow'
  | 'eyelid'
  | 'nose'
  | 'other';

/** A decoded ID-colour pixel: a part, or the empty background. */
export type CapsuleIdPixel = CapsulePartId | 'background';

/**
 * Linear RGB colour of each ID, components in [0, 1]. Values are 0, 0.5 or 1 so any two
 * IDs differ by at least 0.5 in one channel, and they read back unchanged from a linear
 * render target. Use a black clear colour for the background.
 */
export const CAPSULE_ID_COLOURS: Readonly<Record<CapsuleIdPixel, readonly [number, number, number]>> = {
  background: [0, 0, 0],
  headSkin: [1, 0.5, 0],
  suit: [0, 0.5, 1],
  eyeWhite: [1, 1, 1],
  pupil: [0, 0, 1],
  mouth: [1, 0, 1],
  hair: [1, 1, 0],
  brow: [0, 1, 1],
  eyelid: [1, 0, 0],
  nose: [0, 1, 0],
  other: [0.5, 0.5, 0.5],
};

const ID_PIXELS = Object.keys(CAPSULE_ID_COLOURS) as CapsuleIdPixel[];

/** `userData` key that holds an object's {@link CapsulePartId}. */
export const CAPSULE_PART_USER_DATA_KEY = 'capsulePart';

/** Tags an object, and by inheritance its untagged descendants, with a part ID. */
export function tagCapsulePart<T extends Object3D>(object: T, part: CapsulePartId): T {
  object.userData[CAPSULE_PART_USER_DATA_KEY] = part;
  return object;
}

/** Returns the part ID of the object or its nearest tagged ancestor, or `'other'`. */
export function resolveCapsulePart(object: Object3D): CapsulePartId {
  for (let o: Object3D | null = object; o; o = o.parent) {
    const part = o.userData[CAPSULE_PART_USER_DATA_KEY] as CapsulePartId | undefined;
    if (part) {
      return part;
    }
  }
  return 'other';
}

/**
 * Decodes an 8-bit linear RGB pixel read from an ID-colour render to the nearest ID.
 * Read pixels from a linear (non-sRGB) render target rendered without antialiasing.
 */
export function decodeCapsuleIdPixel(r: number, g: number, b: number): CapsuleIdPixel {
  let best: CapsuleIdPixel = 'background';
  let bestDistance = Infinity;
  for (const id of ID_PIXELS) {
    const [cr, cg, cb] = CAPSULE_ID_COLOURS[id];
    const d = (r - cr * 255) ** 2 + (g - cg * 255) ** 2 + (b - cb * 255) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = id;
    }
  }
  return best;
}

/** Creates an unlit ID material for a part. */
export function createCapsuleIdMaterial(part: CapsulePartId, side?: Side): MeshBasicMaterial {
  const [r, g, b] = CAPSULE_ID_COLOURS[part];
  const material = new MeshBasicMaterial({ color: new Color(r, g, b), toneMapped: false, fog: false });
  if (side !== undefined) {
    material.side = side;
  }
  material.name = `capsule-id-${part}`;
  return material;
}

/**
 * Creates the ID material for the capsule body. It shares the body's uniforms, so it follows
 * the suit split, mouth pose and body radius live: mouth where the mouth distance is negative
 * on the front (z > 0.25 r), suit below the split, head skin elsewhere.
 */
export function createCapsuleBodyIdMaterial(uniforms: CapsuleBodyUniformMap): ShaderMaterial {
  const colour = (part: CapsulePartId) => ({ value: new Color(...CAPSULE_ID_COLOURS[part]) });
  const material = new ShaderMaterial({
    name: 'capsule-id-body',
    uniforms: {
      uSuitSplitY: uniforms.uSuitSplitY,
      uMouthCenterY: uniforms.uMouthCenterY,
      uBodyRadius: uniforms.uBodyRadius,
      uMouthOpen: uniforms.uMouthOpen,
      uMouthWidth: uniforms.uMouthWidth,
      uMouthCurve: uniforms.uMouthCurve,
      uMouthWave: uniforms.uMouthWave,
      uIdHeadSkin: colour('headSkin'),
      uIdSuit: colour('suit'),
      uIdMouth: colour('mouth'),
    },
    vertexShader: /* glsl */ `
varying vec3 vCapsuleLocalPos;
void main() {
  vCapsuleLocalPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
varying vec3 vCapsuleLocalPos;
uniform float uSuitSplitY;
uniform float uMouthCenterY;
uniform float uBodyRadius;
uniform float uMouthOpen;
uniform float uMouthWidth;
uniform float uMouthCurve;
uniform float uMouthWave;
uniform vec3 uIdHeadSkin;
uniform vec3 uIdSuit;
uniform vec3 uIdMouth;
${CAPSULE_MOUTH_SDF_GLSL}
void main() {
  vec3 id = vCapsuleLocalPos.y < uSuitSplitY ? uIdSuit : uIdHeadSkin;
  if (vCapsuleLocalPos.z > uBodyRadius * 0.25) {
    vec2 mp = vec2(
      vCapsuleLocalPos.x / max(0.15, uBodyRadius),
      (vCapsuleLocalPos.y - uMouthCenterY) / max(0.15, uBodyRadius)
    );
    vec2 q;
    float halfW;
    float halfH;
    float openAmt;
    if (capsuleMouthDistance(mp, uMouthWidth, uMouthOpen, uMouthCurve, uMouthWave, q, halfW, halfH, openAmt) < 0.0) {
      id = uIdMouth;
    }
  }
  gl_FragColor = vec4(id, 1.0);
  #include <colorspace_fragment>
}`,
  });
  material.toneMapped = false;
  material.fog = false;
  return material;
}

/** The capsule body to give the shader-driven ID material. */
export interface CapsuleIdColourBody {
  readonly mesh: Mesh;
  readonly uniforms: CapsuleBodyUniformMap;
}

/**
 * Swaps every mesh under a root to its flat ID material and restores the originals.
 *
 * Meshes take the part of their nearest tagged ancestor (`'other'` if none). See-through
 * meshes (transparent with opacity below 0.5, such as a helmet dome) are not drawn, so the
 * face beneath them stays readable. Call {@link apply} again after the scene graph changes.
 */
export class CapsuleIdColourSwap {
  private readonly originals = new Map<Mesh, Material | Material[]>();
  private readonly partMaterials = new Map<string, MeshBasicMaterial>();
  private readonly hiddenMaterial = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private bodyMaterial?: ShaderMaterial;
  private bodyUniforms?: CapsuleBodyUniformMap;

  /** Whether ID materials are currently applied. */
  get active(): boolean {
    return this.originals.size > 0;
  }

  /** Restores any previous swap, then swaps every mesh under `root` to its ID material. */
  apply(root: Object3D, body?: CapsuleIdColourBody): void {
    this.restore();
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      const original = mesh.material;
      this.originals.set(mesh, original);
      if (body && mesh === body.mesh) {
        mesh.material = this.bodyIdMaterial(body.uniforms);
        return;
      }
      const reference = Array.isArray(original) ? original[0] : original;
      if (reference && reference.transparent && reference.opacity < 0.5) {
        mesh.material = this.hiddenMaterial;
        return;
      }
      mesh.material = this.partMaterial(resolveCapsulePart(mesh), reference?.side);
    });
  }

  /** Puts every swapped mesh's original material back. */
  restore(): void {
    for (const [mesh, material] of this.originals) {
      mesh.material = material;
    }
    this.originals.clear();
  }

  /** Restores the originals and disposes the ID materials. */
  dispose(): void {
    this.restore();
    for (const material of this.partMaterials.values()) {
      material.dispose();
    }
    this.partMaterials.clear();
    this.hiddenMaterial.dispose();
    this.bodyMaterial?.dispose();
    this.bodyMaterial = undefined;
  }

  private partMaterial(part: CapsulePartId, side: Side | undefined): MeshBasicMaterial {
    const key = `${part}:${side ?? ''}`;
    let material = this.partMaterials.get(key);
    if (!material) {
      material = createCapsuleIdMaterial(part, side);
      this.partMaterials.set(key, material);
    }
    return material;
  }

  private bodyIdMaterial(uniforms: CapsuleBodyUniformMap): ShaderMaterial {
    if (!this.bodyMaterial || this.bodyUniforms !== uniforms) {
      this.bodyMaterial?.dispose();
      this.bodyMaterial = createCapsuleBodyIdMaterial(uniforms);
      this.bodyUniforms = uniforms;
    }
    return this.bodyMaterial;
  }
}
