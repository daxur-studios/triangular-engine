import { NgModule, Type } from '@angular/core';
import { SceneTreeComponent } from './scene-tree/scene-tree.component';

const importExport: Array<Type<any>> = [SceneTreeComponent];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineFeaturesModule {}
