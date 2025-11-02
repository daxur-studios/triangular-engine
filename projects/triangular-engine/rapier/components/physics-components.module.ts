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
import { SpringJointComponent } from './joint/spring-joint.component';
import { InstancedRigidBodyComponent } from './rigid-body/instanced-rigid-body.component';
import { RigidBodyComponent } from './rigid-body/rigid-body.component';
import { PhysicsComponent } from './physics.component';

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
  SpringJointComponent,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class PhysicsComponentsModule {}
