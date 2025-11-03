import { Injectable } from '@angular/core';
import { Material, MeshBasicMaterial } from 'three';

export enum DefaultMaterials {
  TransparentWireframe = 'transparentWireframe',
}

@Injectable({
  providedIn: 'root',
})
export class MaterialService {
  readonly materialMap = new Map<string, Material>();

  constructor() {
    this.#initDefaultSharedMaterials();
  }

  getMaterial(name: string): Material | undefined {
    return this.materialMap.get(name);
  }

  setMaterial(name: string, material: Material) {
    this.materialMap.set(name, material);
  }

  #initDefaultSharedMaterials() {
    // transparent wireframe material
    const transparentWireframeMaterial = new MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      wireframe: true,
    });

    const factory: {
      [key in DefaultMaterials]: Material;
    } = {
      [DefaultMaterials.TransparentWireframe]: transparentWireframeMaterial,
    };

    for (const [key, material] of Object.entries(factory)) {
      this.setMaterial(key, material);
    }
  }
}
