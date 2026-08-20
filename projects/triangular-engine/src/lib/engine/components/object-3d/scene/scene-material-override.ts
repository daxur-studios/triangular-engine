import { Material, MeshBasicMaterial, Object3D, Scene } from 'three';

type MaterialObject = Object3D & {
  material: Material | Material[] | undefined;
};

/** How the scene-wide wireframe override picks a color per object. */
export type SceneWireframeMode = 'uniform' | 'name-hash';

/** Vivid, spread-out colors used by the `name-hash` mode. */
export const SCENE_WIREFRAME_MODE_PALETTE = [
  0xff5252, 0xffb300, 0x8bc34a, 0x00e5ff, 0x448aff, 0x9c27b0, 0xff4081,
  0xff6f00, 0x76ff03, 0x7c4dff,
];

const UNIFORM_COLOR = 0x00ff00;

/** Deterministic FNV-1a string hash so colors stay stable across runs. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Scene-wide material override for debugging.
 *
 * When enabled it replaces the material of every renderable mesh/line in the
 * scene, remembering the originals so it can restore them later. Objects added
 * to the scene while overrides are active are picked up automatically through
 * three.js `childadded` events.
 *
 * Coloring depends on the [mode](SceneWireframeMode):
 * - `uniform`: every object gets the same shared material (default green).
 * - `name-hash`: each object gets a deterministic color derived from a hash of
 *   its `name` (falling back to its `uuid`), with one cached wireframe material
 *   per color, so objects stay visually distinct without any per-scene setup.
 *
 * Points and sprites are skipped because they require their own material
 * types (`PointsMaterial` / `SpriteMaterial`).
 */
export class SceneMaterialOverride {
  readonly #scene: Scene;
  readonly #originalMaterials = new Map<MaterialObject, Material | Material[]>();
  readonly #listened = new WeakSet<Object3D>();
  readonly #materialCache = new Map<string, Material>();

  #uniformMaterial: Material;
  #mode: SceneWireframeMode = 'uniform';
  #enabled = false;

  constructor(
    scene: Scene,
    material: Material = new MeshBasicMaterial({
      color: UNIFORM_COLOR,
      transparent: true,
      wireframe: true,
    }),
  ) {
    this.#scene = scene;
    this.#uniformMaterial = material;
  }

  get material(): Material {
    return this.#uniformMaterial;
  }

  get mode(): SceneWireframeMode {
    return this.#mode;
  }

  /** Switches the coloring mode; re-colors everything when already enabled. */
  setMode(mode: SceneWireframeMode): void {
    if (mode === this.#mode) {
      return;
    }
    this.#mode = mode;
    if (!this.#enabled) {
      return;
    }
    this.#restoreAll();
    this.#applyToTree(this.#scene);
  }

  /**
   * Forces every overridden object to the given shared material and switches
   * coloring back to `uniform` so the swap is applied consistently.
   */
  setMaterial(material: Material): void {
    this.#uniformMaterial = material;
    this.#mode = 'uniform';
    if (!this.#enabled) {
      return;
    }
    for (const object of this.#originalMaterials.keys()) {
      object.material = material;
    }
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.#enabled) {
      return;
    }
    this.#enabled = enabled;

    if (enabled) {
      this.#attachListener(this.#scene);
      this.#applyToTree(this.#scene);
    } else {
      this.#restoreAll();
      this.#detachListener(this.#scene);
    }
  }

  dispose(): void {
    this.setEnabled(false);
    this.#uniformMaterial.dispose();
    for (const material of this.#materialCache.values()) {
      material.dispose();
    }
    this.#materialCache.clear();
  }

  #applyToTree(root: Object3D): void {
    root.traverse((object) => {
      if (!this.#isOverridable(object)) {
        return;
      }
      const materialObject = object as MaterialObject;
      if (this.#originalMaterials.has(materialObject)) {
        return;
      }
      this.#originalMaterials.set(materialObject, materialObject.material!);
      materialObject.material = this.#materialFor(materialObject);
    });
  }

  #materialFor(object: Object3D): Material {
    if (this.#mode === 'name-hash') {
      const key = object.name || object.uuid;
      let cached = this.#materialCache.get(key);
      if (!cached) {
        const color =
          SCENE_WIREFRAME_MODE_PALETTE[
            hashString(key) % SCENE_WIREFRAME_MODE_PALETTE.length
          ];
        cached = new MeshBasicMaterial({
          color,
          transparent: true,
          wireframe: true,
        });
        this.#materialCache.set(key, cached);
      }
      return cached;
    }
    return this.#uniformMaterial;
  }

  #restoreAll(): void {
    for (const [object, original] of this.#originalMaterials) {
      object.material = original;
    }
    this.#originalMaterials.clear();
  }

  #isOverridable(object: Object3D): boolean {
    if (!('material' in object)) {
      return false;
    }
    const materialObject = object as MaterialObject;
    if (!materialObject.material) {
      return false;
    }
    const candidate = object as unknown as {
      isMesh?: boolean;
      isLine?: boolean;
      isPoints?: boolean;
      isSprite?: boolean;
    };
    if (candidate.isPoints || candidate.isSprite) {
      return false;
    }
    return !!candidate.isMesh || !!candidate.isLine;
  }

  #onChildAdded = (event: { child: Object3D }): void => {
    this.#attachListener(event.child);
    if (this.#enabled) {
      this.#applyToTree(event.child);
    }
  };

  #onChildRemoved = (event: { child: Object3D }): void => {
    this.#detachListener(event.child);
    this.#originalMaterials.delete(event.child as MaterialObject);
  };

  #attachListener(object: Object3D): void {
    if (this.#listened.has(object)) {
      return;
    }
    this.#listened.add(object);
    object.addEventListener('childadded', this.#onChildAdded);
    object.addEventListener('childremoved', this.#onChildRemoved);
    for (const child of object.children) {
      this.#attachListener(child);
    }
  }

  #detachListener(object: Object3D): void {
    if (!this.#listened.has(object)) {
      return;
    }
    this.#listened.delete(object);
    object.removeEventListener('childadded', this.#onChildAdded);
    object.removeEventListener('childremoved', this.#onChildRemoved);
    for (const child of object.children) {
      this.#detachListener(child);
    }
  }
}