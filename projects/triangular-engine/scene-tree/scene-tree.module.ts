import { NgModule } from '@angular/core';
import { SceneTreeComponent } from './scene-tree.component';
import { provideSceneTree } from './scene-tree.providers';

/** Imports the optional inspection component and enables it for descendant scenes. */
@NgModule({
  imports: [SceneTreeComponent],
  exports: [SceneTreeComponent],
  providers: [provideSceneTree()],
})
export class EngineSceneTreeModule {}

/** Compatibility name for callers migrating the former root module import. */
export { EngineSceneTreeModule as EngineFeaturesModule };
