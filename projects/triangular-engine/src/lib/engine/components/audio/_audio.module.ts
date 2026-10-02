import { NgModule } from '@angular/core';
import { AmbientAudioComponent } from './ambient-audio.component';
import { AudioListenerComponent } from './audio-listener.component';
import { PositionalAudioComponent } from './positional-audio.component';

const importExport = [
  AudioListenerComponent,
  PositionalAudioComponent,
  AmbientAudioComponent,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineAudioModule {}
