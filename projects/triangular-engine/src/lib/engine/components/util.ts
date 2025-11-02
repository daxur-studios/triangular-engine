import { Material, BufferGeometry, SpriteMaterial } from 'three';
import { LineComponent } from './curve/line.component';
import { MeshComponent } from './mesh/mesh.component';
import { Object3DComponent } from './object-3d/object-3d.component';
import { SpriteComponent } from './object-3d/sprite.component';
import { PointsComponent } from './particle/points.component';
import { isSignal, WritableSignal } from '@angular/core';
import { InstancedMeshComponent } from './mesh/instanced-mesh.component';

/**
 * Interface for components that have a material property.
 * This is used to ensure that the material is linked to the correct parent.
 */
export interface IMaterialComponent {
  material: WritableSignal<Material | undefined>;
}
export function isMaterialComponent(parent: any): parent is IMaterialComponent {
  return 'material' in parent && isSignal(parent.material);
}

export interface IGeometryComponent {
  geometry: WritableSignal<BufferGeometry | undefined>;
}
export function isGeometryComponent(parent: any): parent is IGeometryComponent {
  return 'geometry' in parent && isSignal(parent.geometry);
}
export type MeshLikeComponent = IMaterialComponent & IGeometryComponent;

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
    } else if (parent instanceof LineComponent) {
      parent.material.set(material);
    } else if (parent instanceof SpriteComponent) {
      parent.material.set(material as SpriteMaterial);
    } else if (isMaterialComponent(parent)) {
      parent.material.set(material);
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
    } else if (parent instanceof LineComponent) {
      parent.geometry.set(geometry);
    } else if (isGeometryComponent(parent)) {
      parent.geometry.set(geometry);
    }
  }
  //#endregion
}
