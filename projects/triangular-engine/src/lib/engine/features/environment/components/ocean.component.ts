import {
  Component,
  Injector,
  OnInit,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  BufferAttribute,
  BufferGeometry,
  Matrix3,
  Mesh,
  Vector3,
  MathUtils,
  Uniform,
  PlaneGeometry,
  ShaderMaterial,
  DoubleSide,
} from 'three';
import {
  MeshComponent,
  Object3DComponent,
  provideObject3DComponent,
} from '../../../components';
import { SkyBoxMaterialComponent } from '../materials';
import { EngineService } from '../../../services';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'ocean',
  standalone: true,
  template: ` <ng-content></ng-content> `,
  imports: [],
  providers: [provideObject3DComponent(OceanComponent)],
})
export class OceanComponent extends MeshComponent implements OnInit {
  readonly time = {
    value: 0.0,
  };

  constructor() {
    super();

    // Create a large plane geometry. Increase segments for smoother waves,
    // but note that more segments mean more vertices to process.
    const geometry = new PlaneGeometry(100, 100, 200, 200);
    geometry.rotateX(-Math.PI / 2); // orient the plane horizontally

    // Create the shader material with vertex displacement
    const material = new ShaderMaterial({
      uniforms: {
        time: this.time,
        waveScale: { value: 1.0 },
      },
      vertexShader: `
      uniform float time;
      uniform float waveScale;
      varying vec2 vUv;

      // 2D Simplex noise function by Ian McEwan / Ashima Arts.
      // (This implementation is in the public domain.)
      vec3 mod289(vec3 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }
      vec2 mod289(vec2 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }
      vec3 permute(vec3 x) {
        return mod289(((x*34.0)+1.0)*x);
      }
      float snoise(vec2 v){
        const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                            0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                           -0.577350269189626,  // -1.0 + 2.0 * C.x
                            0.024390243902439); // 1.0 / 41.0
        // First corner
        vec2 i  = floor(v + dot(v, vec2(C.y, C.y)));
        vec2 x0 = v - i + dot(i, vec2(C.x, C.x));
        // Other corners
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec2 x1 = x0 - i1 + C.x;
        vec2 x2 = x0 - 1.0 + 2.0 * C.x;
        // Permutations
        i = mod289(i);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
                          + i.x + vec3(0.0, i1.x, 1.0 ));
        // Gradients: Compute contributions from each corner
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
        m = m*m;
        m = m*m;
        vec3 x = 2.0 * fract(p * C.w) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        // Normalise gradients implicitly by scaling m
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0+h*h );
        // Compute final noise value at P
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.y = a0.y * x1.x + h.y * x1.y;
        g.z = a0.z * x2.x + h.z * x2.y;
        return 130.0 * dot(m, g);
      }
      
      void main() {
        vUv = uv;
        vec3 pos = position;

        // Combine multiple noise layers (octaves) for more complex waves.
        // Adjust the frequencies and speeds to avoid obvious repetition.
        float noise1 = snoise(vec2(pos.x * 0.1 + time * 0.5, pos.z * 0.1));
        float noise2 = snoise(vec2(pos.x * 0.2 - time * 0.3, pos.z * 0.2));
        float noise3 = snoise(vec2(pos.x * 0.05 + time * 0.2, pos.z * 0.05));

        // Mix the noise values and apply a scaling factor
        float displacement = (noise1 + noise2 * 0.5 + noise3 * 0.2) * waveScale;
        pos.y += displacement;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
      fragmentShader: `
      varying vec2 vUv;
      void main() {
        // Basic water color - you can enhance this with reflections or a gradient
        vec3 waterColor = vec3(0.0, 0.3, 0.5);
        gl_FragColor = vec4(waterColor, 1.0);
      }
    `,
      side: DoubleSide,
    });

    this.mesh().geometry = geometry;
    this.mesh().material = material;

    this.engineService.elapsedTime$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((elapsedTime) => {
        this.time.value = elapsedTime;
      });
  }

  override ngOnInit() {
    super.ngOnInit();
  }
}
