import { NgModule } from '@angular/core';
import {
  BallColliderComponent,
  CapsuleColliderComponent,
  CuboidColliderComponent,
  CylinderColliderComponent,
  HullColliderComponent,
  TrimeshColliderComponent,
} from './collider';
import { ConeColliderComponent } from './collider/cone-collider.component';
import { FixedJointComponent } from './joint/fixed-joint.component';
import { SphericalJointComponent } from './joint/spherical-joint.component';
import { PhysicsComponent } from './physics/physics.component';
import { InstancedRigidBodyComponent } from './rigid-body/instanced-rigid-body.component';
import { RigidBodyComponent } from './rigid-body/rigid-body.component';

const importExport = [
  PhysicsComponent,

  RigidBodyComponent,
  InstancedRigidBodyComponent,

  //ColliderComponent,
  CuboidColliderComponent,
  BallColliderComponent,
  CapsuleColliderComponent,
  CylinderColliderComponent,
  ConeColliderComponent,
  HullColliderComponent,
  TrimeshColliderComponent,

  FixedJointComponent,
  SphericalJointComponent,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class PhysicsComponentsModule {}
