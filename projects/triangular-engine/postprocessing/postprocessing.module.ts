import { NgModule } from '@angular/core';
import {
  PostprocessingComposerComponent,
  ToneMappingEffectComponent,
  VignetteEffectComponent,
} from './components';

const components = [
  PostprocessingComposerComponent,
  ToneMappingEffectComponent,
  VignetteEffectComponent,
] as const;

@NgModule({
  imports: [...components],
  exports: [...components],
})
export class PostprocessingModule {}
