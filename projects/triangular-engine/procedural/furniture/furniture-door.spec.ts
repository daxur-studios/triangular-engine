import { Matrix4, Vector3 } from 'three';
import { buildProceduralDoor } from './furniture-door';

describe('Procedural Door', () => {
  it('creates a default door with valid door and reach affordances', () => {
    const door = buildProceduralDoor();
    expect(door.group).toBeDefined();
    expect(door.hingeGroup).toBeDefined();

    const doorAffordance = door.doorAffordance;
    expect(doorAffordance.knobPosition.y).toBeCloseTo(0.98, 2);
    expect(doorAffordance.isOpen).toBeFalse();
    expect(doorAffordance.openAngleRad).toBe(0);

    const reachAffordance = door.knobReachAffordance;
    expect(reachAffordance.targetPosition.y).toBeCloseTo(0.98, 2);
    expect(reachAffordance.handPreference).toBe('right'); // Left hinge -> right hand reaches

    door.dispose();
  });

  it('rotates hinge and updates door affordance on open', () => {
    const door = buildProceduralDoor({ hingeSide: 'left' });
    door.setOpenAngle(Math.PI / 4);

    expect(door.getOpenAngle()).toBeCloseTo(Math.PI / 4, 3);
    const affordance = door.getDoorAffordance();
    expect(affordance.isOpen).toBeTrue();
    expect(affordance.openAngleRad).toBeCloseTo(Math.PI / 4, 3);

    // Knob position should have rotated forward (+Z) relative to closed
    expect(affordance.knobPosition.z).toBeGreaterThan(0.1);

    door.dispose();
  });

  it('supports right-hinged doors and lever knobs', () => {
    const door = buildProceduralDoor({
      hingeSide: 'right',
      knobStyle: 'lever',
      knobHeightM: 1.05,
    });

    const reach = door.knobReachAffordance;
    expect(reach.handPreference).toBe('left');
    expect(reach.gripType).toBe('handle');
    expect(reach.targetPosition.y).toBeCloseTo(1.05, 2);

    door.dispose();
  });

  it('transforms affordances by world matrix', () => {
    const door = buildProceduralDoor();
    door.group.position.set(0, 0, 5);
    door.group.updateMatrixWorld(true);

    const affordance = door.getDoorAffordance();
    expect(affordance.approachPosition.z).toBeGreaterThan(5);

    const customMat = new Matrix4().makeTranslation(new Vector3(10, 0, 2));
    const reach = door.getKnobReachAffordance(customMat);
    expect(reach.targetPosition.x).toBeGreaterThan(9.5);

    door.dispose();
  });
});
