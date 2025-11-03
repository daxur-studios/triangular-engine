import { Observable } from 'rxjs';
import { BufferGeometry, Group, Material, Mesh } from 'three';
import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export namespace GltfUtil {
  export interface GltfMap {
    nodes: Record<string, GltfNode>;
    materials: Record<string, Material>;

    scene: Group;
  }

  export interface GltfNode {
    geometry: BufferGeometry;
    material: Material;
  }

  /**
   * Inspired by: https://gltf.pmnd.rs/
   * 
   * Helper function to create a flat object of all the nodes in a gltf
   * 
   * Example:
   * ```html
   *     <group>
      <mesh
        [geometry]="nodes.base.geometry"
        [material]="materials.Material"
        position="[0, 0.673, 0]"
        scale="[5.028, 5.032, 5.032]"
      />
      <mesh
        [geometry]="nodes.city_info.geometry"
        [material]="materials.Material"
        position="[0, 1.396, 4.227]"
      />
      <mesh
        [geometry]="nodes.DESIRE_1.geometry"
        [material]="materials.Material"
        position="[3.457, 1, 0.002]"
      />
    </group>
    ```
   */
  export function toGltfMap(gltf: GLTF): GltfMap {
    const map: GltfMap = {
      nodes: {},
      materials: {},

      scene: gltf.scene,
    };

    gltf.scene.traverse((node) => {
      if (node instanceof Mesh) {
        const material = node.material as Material;
        const geometry = node.geometry as BufferGeometry;

        map.nodes[node.name] = {
          geometry: geometry,
          material: material,
        };
        map.materials[material.name] = material;
      }
    });

    return map;
  }

  //export function useGltf(): Observable<GltfMap> {}
}
