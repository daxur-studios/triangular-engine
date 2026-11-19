import { MathUtils, Mesh, Vector3 } from 'three';
import { FacialAnimationController } from 'triangular-engine/characters';
import { buildExperimentalPigtailBody } from '../character-studio/experimental-pigtail-body';
import { buildExperimentalPigtailHead } from '../character-studio/experimental-pigtail-head';

const WALK_SPEED = 1.15;
const STEP_DISTANCE = .34;
const MIN_WALK_DISTANCE = .04;

export function buildPigtailSandboxWalker() {
  const body = buildExperimentalPigtailBody();
  const head = buildExperimentalPigtailHead(new FacialAnimationController({ autoBlink: true }));
  body.headSocket.add(head.head);
  const root = body.root;
  root.traverse(object => {
    if (object instanceof Mesh) object.castShadow = true;
  });
  const origin = new Vector3();
  const destination = new Vector3();
  let nextDestination: Vector3 | undefined;
  let elapsed = 0;
  let length = 0;
  let stepCount = 0;
  let duration = 0;
  let ramp = 0;

  function walkTo(target: Vector3): boolean {
    if (length > 0) {
      nextDestination = target.clone();
      return true;
    }
    const distance = Math.hypot(target.x - root.position.x, target.z - root.position.z);
    if (distance < MIN_WALK_DISTANCE) return false;

    origin.copy(root.position);
    destination.set(target.x, root.position.y, target.z);
    root.rotation.y = Math.atan2(destination.x - origin.x, destination.z - origin.z);
    length = distance;
    stepCount = Math.max(2, Math.ceil(distance / STEP_DISTANCE));
    ramp = Math.min(.19, distance / WALK_SPEED);
    duration = distance / WALK_SPEED + ramp;
    elapsed = 0;
    return true;
  }

  function update(delta: number): void {
    head.update(delta);
    if (length === 0 || delta <= 0) return;
    elapsed = Math.min(elapsed + delta, duration);
    if (elapsed === duration) {
      root.position.copy(destination);
      body.setWalkPose();
      length = 0;
      const next = nextDestination;
      nextDestination = undefined;
      if (next) walkTo(next);
      return;
    }

    // Ease velocity at both ends. The same traveled distance drives steps and root translation.
    const remaining = duration - elapsed;
    const distance = elapsed < ramp ? WALK_SPEED * elapsed ** 2 / (2 * ramp)
      : remaining < ramp ? length - WALK_SPEED * remaining ** 2 / (2 * ramp)
      : WALK_SPEED * (elapsed - ramp * .5);
    root.position.lerpVectors(origin, destination, distance / length);

    const stride = length / stepCount;
    const step = Math.floor(distance / stride);
    const progress = distance / stride - step;
    const movingLeft = step % 2 === 0;
    const contact = (index: number) => {
      if (index < 0) return 0;
      // Bring both feet under the hips during the last two steps.
      return index >= stepCount - 2 ? length : (index + 1.5) * stride;
    };
    const planted = { forward: contact(step - 1) - distance, lift: 0 };
    const arc = Math.sin(progress * Math.PI);
    const swing = {
      forward: MathUtils.lerp(contact(step - 2), contact(step), MathUtils.smoothstep(progress, 0, 1)) - distance,
      lift: arc ** 2 * stride * .32,
    };
    body.setWalkPose({
      left: movingLeft ? swing : planted,
      right: movingLeft ? planted : swing,
      bounce: arc ** 2 * stride * .064,
      sway: arc ** 2 * stride * (movingLeft ? .032 : -.032),
    });
  }

  return {
    root,
    update,
    walkTo,
    get walking() { return length > 0; },
    dispose() {
      head.dispose();
      body.dispose();
    },
  };
}
