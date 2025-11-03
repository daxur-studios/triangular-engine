import { NgModule } from '@angular/core';
import { PhysicsComponentsModule } from './components';

const importExport = [PhysicsComponentsModule] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class RapierPhysicsModule {}
