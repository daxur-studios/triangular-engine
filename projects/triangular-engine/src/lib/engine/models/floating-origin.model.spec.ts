import { Object3D, Vector3 } from 'three';
import { CameraFollowController, FloatingOrigin } from './floating-origin.model';

describe('FloatingOrigin', () => {
  it('rebases synchronously and keeps world/local conversion reversible', () => {
    const floatingOrigin = new FloatingOrigin({ threshold: 100 });
    let observedOrigin = new Vector3();
    floatingOrigin.onRebase((event) => observedOrigin.copy(event.origin));

    expect(floatingOrigin.rebaseIfNeeded([50, 0, 0])).toBeUndefined();
    const event = floatingOrigin.rebaseIfNeeded([125, 10, 0]);

    expect(event?.delta.toArray()).toEqual([125, 10, 0]);
    expect(observedOrigin.toArray()).toEqual([125, 10, 0]);
    const local = floatingOrigin.toLocal([140, 15, 0]);
    expect(local.toArray()).toEqual([15, 5, 0]);
    expect(floatingOrigin.toWorld(local).toArray()).toEqual([140, 15, 0]);
  });

  it('supports app-owned scene shifting', () => {
    const floatingOrigin = new FloatingOrigin({ threshold: 10 });
    const object = new Object3D();
    object.position.set(25, 2, 0);
    floatingOrigin.onRebase((event) => FloatingOrigin.shiftObject(object, event));

    floatingOrigin.rebase([20, 0, 0]);
    expect(object.position.toArray()).toEqual([5, 2, 0]);
  });
});

describe('CameraFollowController', () => {
  it('preserves camera offset through movement and a rebase', () => {
    const camera = new Object3D();
    camera.position.set(0, 4, 10);
    const target = new Vector3();
    const follow = new CameraFollowController(camera, target);
    const floatingOrigin = new FloatingOrigin({ threshold: 10 });
    floatingOrigin.onRebase((event) => follow.applyRebase(event));

    follow.update([2, 0, 0]);
    follow.update([8, 0, 0]);
    const event = floatingOrigin.rebase([12, 0, 0]);
    follow.update([0, 0, 0]);

    expect(event.delta.toArray()).toEqual([12, 0, 0]);
    expect(target.toArray()).toEqual([0, 0, 0]);
    expect(camera.position.clone().sub(target).toArray()).toEqual([0, 4, 10]);
  });
});
