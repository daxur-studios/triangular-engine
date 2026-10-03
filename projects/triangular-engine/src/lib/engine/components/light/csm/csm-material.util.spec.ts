import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RawShaderMaterial,
  ShaderMaterial,
} from 'three';
import { forEachMeshMaterial, isCsmCompatibleMaterial } from './csm-material.util';

describe('csm-material.util', () => {
  describe('isCsmCompatibleMaterial', () => {
    it('returns true for MeshStandardMaterial and MeshPhysicalMaterial', () => {
      expect(isCsmCompatibleMaterial(new MeshStandardMaterial())).toBe(true);
      expect(isCsmCompatibleMaterial(new MeshPhysicalMaterial())).toBe(true);
    });

    it('returns false for ShaderMaterial and RawShaderMaterial', () => {
      expect(isCsmCompatibleMaterial(new ShaderMaterial())).toBe(false);
      expect(isCsmCompatibleMaterial(new RawShaderMaterial())).toBe(false);
    });

    it('returns false for null, undefined, or non-lit materials', () => {
      expect(isCsmCompatibleMaterial(null)).toBe(false);
      expect(isCsmCompatibleMaterial(undefined)).toBe(false);
      expect(isCsmCompatibleMaterial(new MeshBasicMaterial())).toBe(false);
    });
  });

  describe('forEachMeshMaterial', () => {
    it('traverses single materials and array materials across mesh hierarchy', () => {
      const root = new Group();
      const mat1 = new MeshStandardMaterial();
      const mat2 = new MeshStandardMaterial();
      const mat3 = new MeshStandardMaterial();

      const mesh1 = new Mesh(undefined, mat1);
      const mesh2 = new Mesh(undefined, [mat2, mat3]);
      root.add(mesh1);
      root.add(mesh2);

      const visited: any[] = [];
      forEachMeshMaterial(root, (mat) => visited.push(mat));

      expect(visited).toContain(mat1);
      expect(visited).toContain(mat2);
      expect(visited).toContain(mat3);
      expect(visited.length).toBe(3);
    });

    it('skips meshes explicitly flagged with userData.csmReceiver = false', () => {
      const root = new Group();
      const mat1 = new MeshStandardMaterial();
      const mat2 = new MeshStandardMaterial();

      const mesh1 = new Mesh(undefined, mat1);
      const mesh2 = new Mesh(undefined, mat2);
      mesh2.userData['csmReceiver'] = false;

      root.add(mesh1);
      root.add(mesh2);

      const visited: any[] = [];
      forEachMeshMaterial(root, (mat) => visited.push(mat));

      expect(visited).toContain(mat1);
      expect(visited).not.toContain(mat2);
      expect(visited.length).toBe(1);
    });
  });
});
