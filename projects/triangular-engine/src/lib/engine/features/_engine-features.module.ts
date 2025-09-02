import { NgModule } from '@angular/core';
import { SceneTreeComponent } from './scene-tree/scene-tree.component';

const importExport = [SceneTreeComponent] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineFeaturesModule {}
