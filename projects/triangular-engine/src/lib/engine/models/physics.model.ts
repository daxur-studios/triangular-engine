import RAPIER from '@dimforge/rapier3d-compat';

export interface IPhysicsOptions {
  rigidBodyType: RAPIER.RigidBodyType;
  shapeType?: RAPIER.ShapeType;
}
