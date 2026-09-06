import { EYE_GAZE_LIMITS, FacialAnimationController } from './face-controller';

describe('FacialAnimationController', () => {
  let controller: FacialAnimationController;

  beforeEach(() => {
    controller = new FacialAnimationController({
      autoBlink: false,
      defaultTransitionSeconds: 0.1,
    });
  });

  it('starts at neutral rest with zeroed channels and forward gaze', () => {
    const frame = controller.update(0.016);
    expect(frame.currentEmotion).toBe('neutral');
    expect(frame.channels['mouth.smile.left'] ?? 0).toBe(0);
    expect(frame.channels['mouth.jawOpen'] ?? 0).toBe(0);
    expect(frame.gaze.left.yaw).toBeCloseTo(0, 3);
    expect(frame.gaze.left.pitch).toBeCloseTo(0, 3);
    expect(frame.isSpeaking).toBe(false);
  });

  it('clamps eye gaze to physiological limits', () => {
    // Extreme target far left and up
    controller.lookAt({ x: -10, y: 10, z: 1 }, 0);
    const frame = controller.update(0.016);

    expect(frame.gaze.left.yaw).toBeGreaterThanOrEqual(-EYE_GAZE_LIMITS.yawLimit);
    expect(frame.gaze.left.yaw).toBeLessThanOrEqual(EYE_GAZE_LIMITS.yawLimit);
    expect(frame.gaze.left.pitch).toBeGreaterThanOrEqual(-EYE_GAZE_LIMITS.pitchUpLimit);
    expect(frame.gaze.left.pitch).toBeLessThanOrEqual(EYE_GAZE_LIMITS.pitchDownLimit);
  });

  it('supports independent left and right eyelid blinking', () => {
    controller.blink('left', 0.2);
    let frame = controller.update(0.08); // middle of blink
    expect(frame.channels['eye.blink.left']).toBeGreaterThan(0.5);
    expect(frame.channels['eye.blink.right'] ?? 0).toBe(0);

    controller.blink('right', 0.2);
    frame = controller.update(0.08);
    expect(frame.channels['eye.blink.right']).toBeGreaterThan(0.5);
  });

  it('supports raising only the right eyebrow independently', () => {
    controller.setFaceChannel('brow.right.raise', 0.9, 0);
    controller.setFaceChannel('brow.left.raise', 0, 0);

    const frame = controller.update(0.016);
    expect(frame.channels['brow.right.raise']).toBe(0.9);
    expect(frame.channels['brow.left.raise'] ?? 0).toBe(0);
    expect(frame.blendShapes.browOuterUpRight).toBe(0.9);
    expect(frame.blendShapes.browOuterUpLeft).toBeUndefined();
  });

  it('transitions between expressions smoothly', () => {
    controller.setExpression('happy', 1.0, 0.1);
    const midFrame = controller.update(0.05);
    expect(midFrame.channels['mouth.smile.left']).toBeGreaterThan(0);
    expect(midFrame.channels['mouth.smile.left']).toBeLessThan(0.75);

    const endFrame = controller.update(0.06);
    expect(endFrame.channels['mouth.smile.left']).toBeCloseTo(0.75, 1);
  });

  it('layers speech articulation with smiling expression without overwriting the smile', () => {
    // 1. Establish happy expression (smiling)
    controller.setExpression('happy', 1.0, 0);
    let frame = controller.update(0.016);
    const baseSmile = frame.channels['mouth.smile.left'];
    expect(baseSmile).toBeGreaterThan(0.5);

    // 2. Play speech viseme sequence (including open-jaw 'A' and closed-lip 'M')
    controller.playVisemes([
      { time: 0, viseme: 'A', duration: 0.2 },
      { time: 0.2, viseme: 'M', duration: 0.2 },
    ]);

    // During 'A', jaw opens and smile remains active!
    frame = controller.update(0.1);
    expect(frame.isSpeaking).toBe(true);
    expect(frame.channels['mouth.jawOpen']).toBeGreaterThan(0.3);
    expect(frame.channels['mouth.smile.left']).toBeCloseTo(baseSmile, 1);

    // During 'M', lip closure activates
    frame = controller.update(0.15);
    expect(frame.channels['mouth.lipClose']).toBeGreaterThan(0.3);
  });

  it('returns mouth smoothly to rest when speech sequence completes', () => {
    controller.playVisemes([{ time: 0, viseme: 'A', duration: 0.1 }]);
    controller.update(0.05); // speaking
    expect(controller.update(0.05).isSpeaking).toBe(true);

    // Advance beyond end
    const frame = controller.update(0.3);
    expect(frame.isSpeaking).toBe(false);
    expect(frame.channels['mouth.jawOpen'] ?? 0).toBeLessThan(0.05);
  });

  it('executes serializable FaceCommand objects', () => {
    controller.execute({ type: 'setExpression', expression: 'surprised', intensity: 0.8, transitionSeconds: 0 });
    let frame = controller.update(0.016);
    expect(frame.currentEmotion).toBe('surprised');
    expect(frame.channels['eye.wide.left']).toBeGreaterThan(0.5);

    controller.execute({ type: 'lookAt', target: { yaw: 0.3, pitch: -0.2 }, transitionSeconds: 0 });
    frame = controller.update(0.016);
    expect(frame.gaze.left.yaw).toBeCloseTo(0.3, 2);
    expect(frame.gaze.left.pitch).toBeCloseTo(-0.2, 2);

    controller.execute({ type: 'reset', transitionSeconds: 0 });
    frame = controller.update(0.016);
    expect(frame.currentEmotion).toBe('neutral');
  });

  it('provides a repeatable deterministic articulation fixture', () => {
    const fixture = FacialAnimationController.createArticulationFixture();
    expect(fixture.length).toBeGreaterThanOrEqual(5);
    const visemes = fixture.map((k) => k.viseme);
    expect(visemes).toContain('M'); // bilabial closed
    expect(visemes).toContain('A'); // open jaw
    expect(visemes).toContain('O'); // rounded
    expect(visemes).toContain('E'); // wide
  });
});
