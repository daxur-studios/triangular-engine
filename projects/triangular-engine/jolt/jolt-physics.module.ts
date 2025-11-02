import { NgModule } from '@angular/core';
import { JoltDebugRendererComponent } from './jolt-debug-renderer/jolt-debug-renderer.component';
import { JoltPhysicsComponent } from './jolt-physics/jolt-physics.component';
import { JoltRigidBodyComponent } from './jolt-rigid-body/jolt-rigid-body.component';
import { JoltSphereShapeComponent } from './jolt-shapes/jolt-sphere-shape.component';
import { JoltBoxShapeComponent } from './jolt-shapes/jolt-box-shape.component';
import { JoltHullShapeComponent } from './jolt-shapes/jolt-hull-shape.component';
import { JoltMeshShapeComponent } from './jolt-shapes/jolt-mesh-shape.component';
import { JoltHeightFieldShapeComponent } from './jolt-shapes/jolt-height-field-shape.component';
import { JoltFixedConstraintComponent } from './constraints/jolt-fixed-constraint.component';
import { JoltHingeConstraintComponent } from './constraints/jolt-hinge-constraint.component';

const importExport = [
  JoltPhysicsComponent,
  JoltDebugRendererComponent,
  JoltRigidBodyComponent,
  JoltSphereShapeComponent,
  JoltBoxShapeComponent,
  JoltHullShapeComponent,
  JoltMeshShapeComponent,
  JoltHeightFieldShapeComponent,

  JoltFixedConstraintComponent,
  JoltHingeConstraintComponent,
] as const;

/** 🟩 Jolt Physics Module */
@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class JoltPhysicsModule {}
