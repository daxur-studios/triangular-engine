import { NgModule, Type } from '@angular/core';
import {
  BallColliderComponent,
  CapsuleColliderComponent,
  ColliderComponent,
  CuboidColliderComponent,
  CylinderColliderComponent,
} from './collider';
import { RigidBodyComponent } from './rigid-body/rigid-body.component';
import { ConeColliderComponent } from './collider/cone-collider.component';
import { InstancedRigidBodyComponent } from './rigid-body/instanced-rigid-body.component';
import { JointComponent } from './joint/joint.component';
import { FixedJointComponent } from './joint/fixed-joint.component';
import { SphericalJointComponent } from './joint/spherical-joint.component';

const importExport: Array<Type<any>> = [
  RigidBodyComponent,
  InstancedRigidBodyComponent,

  //ColliderComponent,
  CuboidColliderComponent,
  BallColliderComponent,
  CapsuleColliderComponent,
  CylinderColliderComponent,
  ConeColliderComponent,

  FixedJointComponent,
  SphericalJointComponent,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class PhysicsComponentsModule {}
