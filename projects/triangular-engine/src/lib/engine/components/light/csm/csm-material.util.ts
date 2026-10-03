import { Material, Mesh, Object3D } from 'three';

/**
 * Checks if a Three.js material is compatible with CSM shader injection.
 * Standard Three.js built-in materials (MeshStandardMaterial, MeshPhysicalMaterial,
 * MeshLambertMaterial, MeshPhongMaterial, MeshToonMaterial) support CSM through
 * the lights_fragment_begin / lights_pars_begin include hooks.
 */
export function isCsmCompatibleMaterial(material: any): material is Material {
  if (!material || typeof material !== 'object') {
    return false;
  }

  // RawShaderMaterial or custom ShaderMaterial without Three.js lights chunks cannot be setup directly
  if (material.isShaderMaterial || material.isRawShaderMaterial) {
    return false;
  }

  // Material must be a lit material capable of receiving shadows
  const isLitStandard =
    material.isMeshStandardMaterial ||
    material.isMeshPhysicalMaterial ||
    material.isMeshLambertMaterial ||
    material.isMeshPhongMaterial ||
    material.isMeshToonMaterial;

  return !!isLitStandard;
}

/**
 * Traverses an Object3D subtree and executes a callback for each material on every Mesh,
 * correctly handling both single materials and material arrays (`mesh.material as Material[]`).
 * Skips objects explicitly marked with `userData.csmReceiver = false`.
 */
export function forEachMeshMaterial(
  root: Object3D,
  callback: (material: Material, mesh: Mesh) => void,
): void {
  root.traverse((obj) => {
    if (obj.userData?.['csmReceiver'] === false) {
      return;
    }

    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.material) {
      return;
    }

    if (Array.isArray(mesh.material)) {
      for (const mat of mesh.material) {
        if (mat) {
          callback(mat, mesh);
        }
      }
    } else {
      callback(mesh.material, mesh);
    }
  });
}
