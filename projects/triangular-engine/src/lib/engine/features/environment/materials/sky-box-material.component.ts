import { Component, OnInit, effect, input, signal } from '@angular/core';
import {
  DataTexture,
  MathUtils,
  RepeatWrapping,
  ShaderMaterial,
  ShaderMaterialParameters,
  TextureLoader,
  Uniform,
  Vector2,
  Vector3,
  Texture,
} from 'three';
import {
  MaterialComponent,
  provideMaterialComponent,
  ShaderMaterialComponent,
} from '../../../components/materials/material.component';

import { skyBoxShader } from '../shaders/SkyBoxShader';

@Component({
  selector: 'skyBoxMaterial',
  template: `<ng-content></ng-content>`,
  standalone: true,
  providers: [provideMaterialComponent(SkyBoxMaterialComponent)],
})
export class SkyBoxMaterialComponent extends ShaderMaterialComponent {}
