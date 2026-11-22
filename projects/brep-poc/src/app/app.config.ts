import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';

/** Application providers. Zoneless so the tick loop and signals stay the only change sources. */
export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection()],
};
