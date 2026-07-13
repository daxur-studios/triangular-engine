import { NgModule } from '@angular/core';
import {
  PostprocessingComposerComponent,
  VignetteEffectComponent,
} from './components';

const components = [
  PostprocessingComposerComponent,
  VignetteEffectComponent,
] as const;

@NgModule({
  imports: [...components],
  exports: [...components],
})
export class PostprocessingModule {}
