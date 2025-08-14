import {
  Component,
  OnInit,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
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
import { initEnvironmentShaderChunks } from '../shaders/Settings';

import { IMAGES } from '../../../../assets';

initEnvironmentShaderChunks();

@Component({
  selector: 'skyBoxMaterial',
  template: `<ng-content></ng-content>`,
  standalone: true,
  providers: [provideMaterialComponent(SkyBoxMaterialComponent)],
})
export class SkyBoxMaterialComponent
  extends ShaderMaterialComponent
  implements OnInit
{
  // Shader uniforms
  readonly ditherSize = signal<Vector2>(new Vector2());
  readonly dither = signal<Texture | null>(null);
  readonly sunVisibility = input<number>(1);
  readonly twilightTime = input<number>(0);
  readonly twilightVisibility = input<number>(0);
  readonly specularVisibility = input<number>(Math.sqrt(1));
  readonly light = input<Vector3>(new Vector3(1, 1, 1));

  // Stars configuration
  private readonly starsSeed = 87;
  private readonly gridSize = 64;
  private readonly starsCount = 10000;
  private readonly maxOffset = 0.43;
  private readonly starsMap = new Uint8Array(
    this.gridSize * this.gridSize * 24,
  );
  private readonly stars = new Uniform(
    new DataTexture(this.starsMap, this.gridSize * 6, this.gridSize),
  );

  constructor() {
    super();
    this.initializeStars();
    this.initializeMaterial();
  }

  ngOnInit() {
    // Initialize component
  }

  private initializeStars() {
    // Seeded RNG for deterministic starfield
    const rng = ((seed) => {
      // mulberry32
      let t = seed >>> 0;
      return () => {
        t += 0x6d2b79f5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
    })(this.starsSeed);

    // Distribute stars uniformly across the entire cube atlas (6 faces x gridSize x gridSize)
    const totalCells = this.gridSize * this.gridSize * 6;
    const targetCount = Math.min(this.starsCount, totalCells);

    // Pick unique random cells for stars to avoid clustering only in the first block
    const chosen = new Set<number>();
    while (chosen.size < targetCount) {
      const cell = Math.floor(rng() * totalCells);
      chosen.add(cell);
    }

    // Initialize selected cells with per-cell parameters
    chosen.forEach((cell) => {
      const base = cell * 4;
      this.starsMap[base] =
        MathUtils.lerp(0.5 - this.maxOffset, 0.5 + this.maxOffset, rng()) * 255;
      this.starsMap[base + 1] =
        MathUtils.lerp(0.5 - this.maxOffset, 0.5 + this.maxOffset, rng()) * 255;
      this.starsMap[base + 2] = Math.pow(rng(), 6) * 255; // intensity
      this.starsMap[base + 3] = rng() * 255; // color index
    });

    this.stars.value.needsUpdate = true;
  }

  private initializeMaterial() {
    const material = new ShaderMaterial({
      vertexShader: skyBoxShader.vertex,
      fragmentShader: skyBoxShader.fragment,
      uniforms: {
        _DitherTexture: { value: null },
        _DitherTextureSize: { value: new Vector2() },
        _SunVisibility: { value: 1 },
        _TwilightTime: { value: 0 },
        _TwilightVisibility: { value: 0 },
        _GridSize: { value: this.gridSize },
        _GridSizeScaled: { value: this.gridSize * 6 },
        _Stars: this.stars,
        _SpecularVisibility: { value: Math.sqrt(1) },
        _Light: { value: new Vector3(1, 1, 1) },
      },
    });

    this.material.update(() => material);

    // Load dither texture
    new TextureLoader().load(IMAGES.bluenoise, (texture) => {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      this.dither.set(texture);
      this.ditherSize.set(
        new Vector2(texture.image.width, texture.image.height),
      );
    });

    // Setup uniform updates
    effect(() => {
      const uniforms = material.uniforms;
      uniforms['_DitherTexture'].value = this.dither();
      uniforms['_DitherTextureSize'].value = this.ditherSize();
      uniforms['_SunVisibility'].value = this.sunVisibility();
      uniforms['_TwilightTime'].value = this.twilightTime();
      uniforms['_TwilightVisibility'].value = this.twilightVisibility();
      uniforms['_SpecularVisibility'].value = this.specularVisibility();
      uniforms['_Light'].value = this.light();
    });
  }
}
