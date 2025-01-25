import { Material, BufferGeometry, SpriteMaterial } from 'three';
import { LineComponent } from './curve/line.component';
import { MeshComponent, InstancedMeshComponent } from './mesh';
import { Object3DComponent } from './object-3d';
import { SpriteComponent } from './object-3d/sprite.component';
import { PointsComponent } from './particle';
import { InstancedRigidBodyComponent } from './physics';

export function handleMaterialAndGeometryLinking(
  item: Material | BufferGeometry,
  parent: Object3DComponent,
) {
  //#region Material
  if (item instanceof Material) {
    const material = item;
    // Cast to MeshComponent to see if it should be added to the mesh
    if (parent instanceof MeshComponent) {
      parent.material.set(material);
      parent.mesh().material = material;
    }
    // Cast to PointsComponent to see if it should be added to the points
    else if (parent instanceof PointsComponent) {
      parent.material.set(material);
      parent.points().material = material;
    } else if (parent instanceof InstancedMeshComponent) {
      parent.material.set(material);
      parent.instancedMesh().material = material;
    } else if (parent instanceof InstancedRigidBodyComponent) {
      parent.material.set(material);
    } else if (parent instanceof LineComponent) {
      parent.material.set(material);
    } else if (parent instanceof SpriteComponent) {
      parent.material.set(material as SpriteMaterial);
    }
  }
  //#endregion

  //#region Geometry
  if (item instanceof BufferGeometry) {
    const geometry = item;
    // Cast to MeshComponent to see if it should be added to the mesh
    if (parent instanceof MeshComponent) {
      parent.geometry.set(geometry);
      parent.mesh().geometry = geometry;
    }
    // Cast to PointsComponent to see if it should be added to the points
    else if (parent instanceof PointsComponent) {
      parent.geometry.set(geometry);
      parent.points().geometry = geometry;
    } else if (parent instanceof InstancedMeshComponent) {
      parent.geometry.set(geometry);
      parent.instancedMesh().geometry = geometry;
    } else if (parent instanceof InstancedRigidBodyComponent) {
      parent.geometry.set(geometry);
    } else if (parent instanceof LineComponent) {
      parent.geometry.set(geometry);
    }
  }
  //#endregion
}
