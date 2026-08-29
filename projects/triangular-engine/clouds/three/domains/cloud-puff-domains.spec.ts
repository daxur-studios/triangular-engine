import { Group, InstancedMesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';

import { BOX_CLOUD_PUFF_DOMAIN, wrapAxis } from './box-domain';
import {
  CLOUD_PUFF_DOMAINS,
  DEFAULT_CLOUD_PUFF_DOMAIN_ID,
  getCloudPuffDomainById,
} from './cloud-puff-domain-registry';
import { CYLINDER_INTERIOR_CLOUD_PUFF_DOMAIN } from './cylinder-interior-domain';
import { SPHERE_SHELL_CLOUD_PUFF_DOMAIN } from './sphere-shell-domain';
import {
  advectBoxAlongWind,
  advectCylinderAlongWind,
  advectSphereAlongWind,
  curlNoiseSphere,
  windFieldSphere3D,
} from '../../core/cloud-wind-field';

describe('Cloud Puff Domains', () => {
  describe('wrapAxis', () => {
    it('wraps positive values into [-halfRange, halfRange)', () => {
      expect(wrapAxis(0, 10)).toBe(0);
      expect(wrapAxis(5, 10)).toBe(5);
      expect(wrapAxis(12, 10)).toBeCloseTo(-8, 5);
      expect(wrapAxis(22, 10)).toBeCloseTo(2, 5);
    });

    it('wraps negative values into [-halfRange, halfRange)', () => {
      expect(wrapAxis(-5, 10)).toBe(-5);
      expect(wrapAxis(-12, 10)).toBeCloseTo(8, 5);
      expect(wrapAxis(-22, 10)).toBeCloseTo(-2, 5);
    });

    it('handles zero or negative ranges gracefully', () => {
      expect(wrapAxis(5, 0)).toBe(0);
      expect(wrapAxis(5, -5)).toBe(0);
    });
  });

  describe('RK2 Streamline Advection Engine', () => {
    it('spherical curl noise is strictly tangential to the sphere at any point', () => {
      const p = new Vector3(0.577, 0.577, 0.577).normalize();
      const curl = new Vector3();
      curlNoiseSphere(p, 2.5, 1.0, curl);
      expect(Math.abs(curl.dot(p))).toBeLessThan(1e-5);
    });

    it('spherical wind field is strictly tangential to the sphere', () => {
      const p = new Vector3(0.2, 0.8, -0.4).normalize();
      const flow = new Vector3();
      windFieldSphere3D(p, 2.0, {
        zonalSpeed: 0.05,
        zonalFrequency: 3.0,
        curlFrequency: 2.5,
        curlStrength: 0.1,
      }, flow);
      expect(Math.abs(flow.dot(p))).toBeLessThan(1e-5);
    });

    it('16-step RK2 sphere advection produces continuous unit-sphere paths', () => {
      const spawn = new Vector3(1, 0, 0);
      const out = new Vector3();
      advectSphereAlongWind(spawn, 0, 15.0, 40.0, {
        zonalSpeed: 0.05,
        zonalFrequency: 3.0,
        curlFrequency: 2.5,
        curlStrength: 0.1,
      }, out);

      expect(out.length()).toBeCloseTo(1.0, 5);
      expect(out.x).not.toBe(spawn.x); // Traveled along streamline
    });

    it('16-step RK2 cylinder advection stays strictly within cylinder bounds', () => {
      const lengthM = 200;
      const { phi, z } = advectCylinderAlongWind(0.5, 40, 0, 20.0, 40.0, {
        circumferentialSpeed: 0.05,
        curlFrequency: 2.0,
        curlStrength: 0.4,
        lengthM,
      });

      expect(Math.abs(z)).toBeLessThanOrEqual(lengthM / 2);
      expect(phi).not.toBe(0.5); // Traveled circumferentially
    });

    it('16-step RK2 box advection wraps within region', () => {
      const regionSize: readonly [number, number, number] = [50, 20, 50];
      const out = new Vector3();
      advectBoxAlongWind(new Vector3(10, 0, 10), 0, 30.0, 40.0, {
        velocity: [3, 0, 1],
        curlFrequency: 0.02,
        curlStrength: 0.4,
        regionSizeM: regionSize,
      }, out);

      expect(Math.abs(out.x)).toBeLessThanOrEqual(regionSize[0]);
      expect(Math.abs(out.y)).toBeLessThanOrEqual(regionSize[1]);
      expect(Math.abs(out.z)).toBeLessThanOrEqual(regionSize[2]);
    });
  });

  describe('Registry', () => {
    it('contains box, sphere-shell, and cylinder-interior domains', () => {
      const ids = CLOUD_PUFF_DOMAINS.map((d) => d.id);
      expect(ids).toContain('box');
      expect(ids).toContain('sphere-shell');
      expect(ids).toContain('cylinder-interior');
      expect(DEFAULT_CLOUD_PUFF_DOMAIN_ID).toBe('box');
    });

    it('falls back to default box domain for unknown IDs', () => {
      const domain = getCloudPuffDomainById('unknown-domain-id');
      expect(domain.id).toBe('box');
    });
  });

  describe('Box domain', () => {
    it('places instances within region extents and scale range', () => {
      const transforms = BOX_CLOUD_PUFF_DOMAIN.placeInstances({
        instanceCount: 20,
        seed: 42,
        puffScaleRangeM: [5, 12],
        regionSizeM: [50, 10, 50],
      });

      expect(transforms.length).toBe(20);
      for (const t of transforms) {
        expect(Math.abs(t.position.x)).toBeLessThanOrEqual(50.001);
        expect(Math.abs(t.position.y)).toBeLessThanOrEqual(10.001);
        expect(Math.abs(t.position.z)).toBeLessThanOrEqual(50.001);
        expect(t.scale.x).toBeGreaterThanOrEqual(5);
        expect(t.scale.x).toBeLessThanOrEqual(12);
      }
    });
  });

  describe('Sphere shell domain', () => {
    it('places instances in a radial shell with outward-facing orientation', () => {
      const radius = 100;
      const thickness = 10;
      const transforms = SPHERE_SHELL_CLOUD_PUFF_DOMAIN.placeInstances({
        instanceCount: 30,
        seed: 123,
        puffScaleRangeM: [4, 8],
        radiusM: radius,
        shellThicknessM: thickness,
      });

      expect(transforms.length).toBe(30);
      const localUp = new Vector3(0, 1, 0);

      for (const t of transforms) {
        const dist = t.position.length();
        expect(dist).toBeGreaterThanOrEqual(radius - thickness / 2 - 0.001);
        expect(dist).toBeLessThanOrEqual(radius + thickness / 2 + 0.001);

        const radialDirection = t.position.clone().normalize();
        const orientedUp = localUp.clone().applyQuaternion(t.quaternion);
        expect(orientedUp.dot(radialDirection)).toBeCloseTo(1, 4);
      }
    });

    it('respects densityAt rejection sampling (e.g. northern hemisphere only)', () => {
      const transforms = SPHERE_SHELL_CLOUD_PUFF_DOMAIN.placeInstances({
        instanceCount: 25,
        seed: 42,
        puffScaleRangeM: [4, 8],
        radiusM: 75,
        densityAt: (dir) => (dir.y > 0.05 ? 1.0 : 0.0),
      });

      expect(transforms.length).toBe(25);
      for (const t of transforms) {
        expect(t.position.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('advects instances across mesh matrices under wind', () => {
      const group = new Group();
      const mesh = new InstancedMesh(new SphereGeometry(1), new MeshBasicMaterial(), 10);
      group.add(mesh);

      const controller = SPHERE_SHELL_CLOUD_PUFF_DOMAIN.createWindController(group, {
        instanceCount: 10,
        seed: 7,
        puffScaleRangeM: [2, 4],
        radiusM: 60,
      });

      controller.advanceWind(5.0, {
        speed: 8,
        curlTurbulence: 0.5,
        zonalBanding: true,
        zonalFrequency: 4.0,
      });

      expect(mesh.instanceMatrix.needsUpdate).toBeTrue();
    });
  });

  describe('Cylinder interior domain', () => {
    it('places instances on inner cylinder wall with inward-facing orientation', () => {
      const radius = 80;
      const length = 200;
      const thickness = 8;
      const transforms = CYLINDER_INTERIOR_CLOUD_PUFF_DOMAIN.placeInstances({
        instanceCount: 30,
        seed: 456,
        puffScaleRangeM: [3, 9],
        radiusM: radius,
        lengthM: length,
        shellThicknessM: thickness,
      });

      expect(transforms.length).toBe(30);
      const localUp = new Vector3(0, 1, 0);

      for (const t of transforms) {
        expect(Math.abs(t.position.z)).toBeLessThanOrEqual(length / 2 + 0.001);

        const radialDist = Math.hypot(t.position.x, t.position.y);
        expect(radialDist).toBeGreaterThanOrEqual(radius - thickness / 2 - 0.001);
        expect(radialDist).toBeLessThanOrEqual(radius + thickness / 2 + 0.001);

        const inwardDir = new Vector3(-t.position.x, -t.position.y, 0).normalize();
        const orientedUp = localUp.clone().applyQuaternion(t.quaternion);
        expect(orientedUp.dot(inwardDir)).toBeCloseTo(1, 4);
      }
    });

    it('advects instances around cylinder curvature under wind', () => {
      const group = new Group();
      const mesh = new InstancedMesh(new SphereGeometry(1), new MeshBasicMaterial(), 10);
      group.add(mesh);

      const controller = CYLINDER_INTERIOR_CLOUD_PUFF_DOMAIN.createWindController(group, {
        instanceCount: 10,
        seed: 12,
        puffScaleRangeM: [2, 4],
        radiusM: 65,
        lengthM: 200,
      });

      controller.advanceWind(5.0, {
        speed: 6,
        curlTurbulence: 0.4,
      });

      expect(mesh.instanceMatrix.needsUpdate).toBeTrue();
    });
  });
});
