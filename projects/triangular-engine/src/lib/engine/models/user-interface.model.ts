import { TemplateRef } from '@angular/core';

export interface IUserInterfaceOptions {
  showUI?: boolean;

  showStats?: boolean;
  /** Show the inspection panel when provideSceneTree() from triangular-engine/scene-tree is configured. */
  showSceneTree?: boolean;

  top?: TemplateRef<any>;
  bottom?: TemplateRef<any>;
  left?: TemplateRef<any>;
  right?: TemplateRef<any>;
  main?: TemplateRef<any>;
}
