import { TemplateRef } from '@angular/core';

export interface IUserInterfaceOptions {
  showUI?: boolean;

  showStats?: boolean;
  showSceneTree?: boolean;

  top?: TemplateRef<any>;
  bottom?: TemplateRef<any>;
  left?: TemplateRef<any>;
  right?: TemplateRef<any>;
  main?: TemplateRef<any>;
}
