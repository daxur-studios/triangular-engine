import { Matrix4, Vector3 } from 'three';
import { buildProceduralChair } from './furniture-chair';

describe('Procedural Chair', () => {
  it('creates a default dining chair with valid sit affordance', () => {
    const chair = buildProceduralChair();
    expect(chair.group).toBeDefined();
    expect(chair.group.children.length).toBeGreaterThan(0);

    const affordance = chair.sitAffordance;
    expect(affordance.seatHeight).toBeCloseTo(0.45, 2);
    expect(affordance.seatPosition.y).toBeCloseTo(0.45, 2);
    expect(affordance.facingDirection.z).toBeCloseTo(1, 2);
    expect(affordance.approachPosition.z).toBeGreaterThan(affordance.seatPosition.z);

    chair.dispose();
  });

  it('supports custom dimensions and styles', () => {
    const stool = buildProceduralChair({
      style: 'stool',
      seatHeightM: 0.65,
      seatWidthM: 0.4,
      seatDepthM: 0.4,
    });

    expect(stool.sitAffordance.seatHeight).toBeCloseTo(0.65, 2);
    expect(stool.sitAffordance.seatPosition.y).toBeCloseTo(0.65, 2);

    const armchair = buildProceduralChair({
      style: 'armchair',
    });
    expect(armchair.group.children.length).toBeGreaterThan(stool.group.children.length);

    stool.dispose();
    armchair.dispose();
  });

  it('transforms sit affordance by world matrix', () => {
    const chair = buildProceduralChair();
    chair.group.position.set(2, 0, 3);
    chair.group.updateMatrixWorld(true);

    const worldAffordance = chair.getSitAffordance();
    expect(worldAffordance.seatPosition.x).toBeCloseTo(2, 2);
    expect(worldAffordance.seatPosition.z).toBeCloseTo(3, 2);
    expect(worldAffordance.seatPosition.y).toBeCloseTo(0.45, 2);

    // Custom world matrix
    const customMat = new Matrix4().makeTranslation(new Vector3(-5, 1, 4));
    const transformed = chair.getSitAffordance(customMat);
    expect(transformed.seatPosition.x).toBeCloseTo(-5, 2);
    expect(transformed.seatPosition.y).toBeCloseTo(1.45, 2);
    expect(transformed.seatPosition.z).toBeCloseTo(4, 2);

    chair.dispose();
  });
});
