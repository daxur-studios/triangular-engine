import { Group, Vector3 } from 'three';

import { BOX_CLOUD_PUFF_DOMAIN, wrapAxis } from './box-domain';
import {
  CLOUD_PUFF_DOMAINS,
  DEFAULT_CLOUD_PUFF_DOMAIN_ID,
  getCloudPuffDomainById,
} from './cloud-puff-domain-registry';
import { CYLINDER_INTERIOR_CLOUD_PUFF_DOMAIN } from './cylinder-interior-domain';
import { SPHERE_SHELL_CLOUD_PUFF_DOMAIN } from './sphere-shell-domain';

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

    it('translates group and wraps position on advanceWind', () => {
      const group = new Group();
      const controller = BOX_CLOUD_PUFF_DOMAIN.createWindController(group, {
        instanceCount: 1,
        seed: 1,
        puffScaleRangeM: [1, 2],
        originM: [0, 10, 0],
        regionSizeM: [20, 5, 20],
      });

      expect(group.position.x).toBe(0);
      expect(group.position.y).toBe(10);
      expect(group.position.z).toBe(0);

      // Advance with scalar speed
      controller.advanceWind(1.0, 10);
      expect(group.position.x).toBe(10);
      expect(group.position.y).toBe(10);
      expect(group.position.z).toBeCloseTo(3.5, 4);

      // Advance past boundary -> wraps
      controller.advanceWind(2.0, 10);
      expect(group.position.x).toBeCloseTo(-10, 4);
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

        // Verify puff's local UP transformed by quaternion matches radial outward direction
        const radialDirection = t.position.clone().normalize();
        const orientedUp = localUp.clone().applyQuaternion(t.quaternion);
        expect(orientedUp.dot(radialDirection)).toBeCloseTo(1, 4);
      }
    });

    it('rotates group smoothly on advanceWind', () => {
      const group = new Group();
      const controller = SPHERE_SHELL_CLOUD_PUFF_DOMAIN.createWindController(group, {
        instanceCount: 1,
        seed: 1,
        puffScaleRangeM: [1, 2],
        radiusM: 50,
      });

      controller.advanceWind(1.0, 5); // 5 / 50 = 0.1 rad/s
      expect(group.rotation.y).toBeCloseTo(0.1, 4);
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

        // Inward direction in XY plane
        const inwardDir = new Vector3(-t.position.x, -t.position.y, 0).normalize();
        const orientedUp = localUp.clone().applyQuaternion(t.quaternion);
        expect(orientedUp.dot(inwardDir)).toBeCloseTo(1, 4);
      }
    });

    it('advances both axial drift and rotation on advanceWind', () => {
      const group = new Group();
      const controller = CYLINDER_INTERIOR_CLOUD_PUFF_DOMAIN.createWindController(group, {
        instanceCount: 1,
        seed: 1,
        puffScaleRangeM: [1, 2],
        radiusM: 100,
        lengthM: 100,
      });

      controller.advanceWind(1.0, 10);
      // Axial movement along Z
      expect(group.position.z).toBeCloseTo(7.0, 3);
      // Angular rotation around Z
      expect(group.rotation.z).toBeGreaterThan(0);
    });
  });
});
