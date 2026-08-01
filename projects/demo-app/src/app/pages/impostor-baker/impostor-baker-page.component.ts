import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { JsonPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  AmbientLight,
  BoxGeometry,
  ConeGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  MeshBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Group,
  OrthographicCamera,
  WebGLRenderTarget,
  WebGLRenderer,
  RGBAFormat,
  UnsignedByteType,
  Scene,
  Sprite,
  SpriteMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EngineModule, EngineService } from 'triangular-engine';
import { ImpostorAtlasMetadata, atlasCellForDirection, atlasDirection } from './impostor-atlas.models';

const IMPOSTOR_VERTEX_SHADER = `
uniform float spritesPerSide;
varying vec2 vSprite1;
varying vec2 vSprite2;
varying vec2 vSprite3;
varying vec3 vWeights;
varying vec2 vUv1;
varying vec2 vUv2;
varying vec2 vUv3;

vec2 encodeDirection(vec3 d) {
  d = normalize(d); float s = abs(d.x) + abs(d.y) + abs(d.z);
  vec2 p = d.xy / s;
  if (d.z < 0.0) p = (1.0 - abs(p.yx)) * sign(p.xy);
  return p * 0.5 + 0.5;
}
vec3 decodeDirection(vec2 cell, float spritesMinusOne) {
  vec2 p = cell / spritesMinusOne * 2.0 - 1.0;
  vec3 d = vec3(p, 1.0 - abs(p.x) - abs(p.y));
  if (d.z < 0.0) d.xy = (1.0 - abs(d.yx)) * sign(d.xy);
  return normalize(d);
}
void computePlaneBasis(vec3 n, out vec3 t, out vec3 b) {
  vec3 up = vec3(0.0, 1.0, 0.0);
  if (n.y > 0.999) up = vec3(-1.0, 0.0, 0.0);
  if (n.y < -0.999) up = vec3(1.0, 0.0, 0.0);
  t = normalize(cross(up, n));
  b = normalize(cross(n, t));
}
vec3 projectVertex(vec3 n) {
  vec3 t, b;
  computePlaneBasis(n, t, b);
  return t * position.x + b * position.y;
}
vec2 projectToPlaneUV(vec3 n, vec3 t, vec3 b, vec3 cameraLocal, vec3 viewDir) {
  float denom = dot(viewDir, n);
  float hit = abs(denom) < 0.0001 ? 0.0 : -dot(cameraLocal, n) / denom;
  vec3 p = cameraLocal + viewDir * hit;
  return vec2(dot(p, t), dot(p, b)) * 0.5 + 0.5;
}
void main() {
  vec3 cameraLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vec3 cameraDir = normalize(cameraLocal);
  float spritesMinusOne = spritesPerSide - 1.0;
  vec2 grid = encodeDirection(cameraDir) * spritesMinusOne;
  vec2 base = min(floor(grid), vec2(spritesMinusOne));
  vec2 f = fract(grid);
  if (f.x >= f.y) {
    vWeights = vec3(1.0-f.x, f.x-f.y, f.y);
    vSprite1 = base;
    vSprite2 = min(base + vec2(1.0, 0.0), vec2(spritesMinusOne));
    vSprite3 = min(base + vec2(1.0), vec2(spritesMinusOne));
  } else {
    vWeights = vec3(1.0-f.y, f.y-f.x, f.x);
    vSprite1 = base;
    vSprite2 = min(base + vec2(0.0, 1.0), vec2(spritesMinusOne));
    vSprite3 = min(base + vec2(1.0), vec2(spritesMinusOne));
  }
  vec3 projectedPosition = projectVertex(cameraDir);
  vec3 viewDirLocal = normalize(projectedPosition - cameraLocal);
  vec3 n1 = decodeDirection(vSprite1, spritesMinusOne);
  vec3 n2 = decodeDirection(vSprite2, spritesMinusOne);
  vec3 n3 = decodeDirection(vSprite3, spritesMinusOne);
  vec3 t1, b1, t2, b2, t3, b3;
  computePlaneBasis(n1, t1, b1);
  computePlaneBasis(n2, t2, b2);
  computePlaneBasis(n3, t3, b3);
  vUv1 = projectToPlaneUV(n1, t1, b1, cameraLocal, viewDirLocal);
  vUv2 = projectToPlaneUV(n2, t2, b2, cameraLocal, viewDirLocal);
  vUv3 = projectToPlaneUV(n3, t3, b3, cameraLocal, viewDirLocal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(projectedPosition, 1.0);
}
`;

const IMPOSTOR_FRAGMENT_SHADER = `
uniform sampler2D map;
uniform float spritesPerSide;
uniform float alphaClamp;
varying vec2 vSprite1;
varying vec2 vSprite2;
varying vec2 vSprite3;
varying vec3 vWeights;
varying vec2 vUv1;
varying vec2 vUv2;
varying vec2 vUv3;
vec4 sampleSprite(vec2 uv, vec2 cell) {
  vec2 atlasUv = (cell + clamp(uv, 0.0, 1.0)) / spritesPerSide;
  return texture2D(map, atlasUv);
}
void main() {
  vec4 color = sampleSprite(vUv1, vSprite1)*vWeights.x + sampleSprite(vUv2, vSprite2)*vWeights.y + sampleSprite(vUv3, vSprite3)*vWeights.z;
  if (color.a < alphaClamp) discard;
  gl_FragColor = color;
}
`;

@Component({
  selector: 'app-impostor-baker-page',
  imports: [RouterLink, EngineModule, JsonPipe],
  templateUrl: './impostor-baker-page.component.html',
  styleUrl: './impostor-baker-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class ImpostorBakerPageComponent implements AfterViewInit {
  @ViewChild('atlasCanvas', { static: true }) private readonly atlasCanvas!: ElementRef<HTMLCanvasElement>;
  readonly columns = signal(8);
  readonly rows = signal(8);
  readonly frameSize = signal(96);
  readonly selectedCell = signal('0,0');
  readonly model = signal<'cube' | 'tree'>('cube');
  readonly runtimeMode = signal<'discrete' | 'reference'>('discrete');
  readonly metadata = signal<ImpostorAtlasMetadata | undefined>(undefined);
  readonly atlasUrl = signal('');
  readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  readonly cameraPosition: [number, number, number] = [4, 3, 5];
  readonly cameraTarget: [number, number, number] = [0, 0, 0];
  private impostorTexture?: CanvasTexture;
  private impostorSprite?: Mesh<PlaneGeometry, ShaderMaterial> | Sprite;
  private readonly impostorDirection = new Vector3();
  private readonly impostorPosition = new Vector3();
  private readonly bakeUp = new Vector3();
  private readonly runtimeUp = new Vector3();
  private readonly cameraQuaternion = new Quaternion();
  private readonly worldUp = new Vector3(0, 1, 0);
  private readonly fallbackUp = new Vector3(0, 0, 1);

  ngAfterViewInit(): void {
    this.engine.tick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.updateRuntimeImpostor());
    this.generateAtlas();
  }

  async generateAtlas(): Promise<void> {
    const columns = this.columns();
    const rows = this.rows();
    const frameSize = this.frameSize();
    const canvas = this.atlasCanvas.nativeElement;
    canvas.width = columns * frameSize;
    canvas.height = rows * frameSize;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(frameSize, frameSize, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    const renderTarget = new WebGLRenderTarget(frameSize, frameSize, {
      format: RGBAFormat, type: UnsignedByteType, depthBuffer: true, stencilBuffer: false,
    });
    const bakeScene = new Scene();
    bakeScene.background = null;
    const sourceModel = this.createSourceModel(this.model());
    bakeScene.add(sourceModel, new AmbientLight(0xffffff, 1));
    const cube = sourceModel;
    const light = new DirectionalLight(0xffffff, 1.5);
    light.position.set(4, 6, 5);
    bakeScene.add(light);
    // Leave room for the cube's diagonal projection at pole-adjacent views.
    const camera = new OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 20);
    const pixels = new Uint8Array(frameSize * frameSize * 4);
    const uprightPixels = new Uint8ClampedArray(frameSize * frameSize * 4);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const direction = atlasDirection(column, row, columns, rows);
        camera.position.copy(direction).multiplyScalar(5);
        camera.up.copy(this.getBakeUp(direction, this.bakeUp));
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        renderer.setRenderTarget(renderTarget);
        renderer.clear();
        renderer.render(bakeScene, camera);
        renderer.readRenderTargetPixels(renderTarget, 0, 0, frameSize, frameSize, pixels);
        // WebGL readback starts at the bottom-left, whereas ImageData starts at
        // the top-left. Copy rows in reverse order so frames are not vertically
        // mirrored (which makes polar camera movement appear backwards).
        const rowBytes = frameSize * 4;
        for (let pixelRow = 0; pixelRow < frameSize; pixelRow++) {
          const sourceOffset = (frameSize - 1 - pixelRow) * rowBytes;
          uprightPixels.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), pixelRow * rowBytes);
        }
        const image = new ImageData(uprightPixels, frameSize, frameSize);
        const imageCanvas = document.createElement('canvas');
        imageCanvas.width = frameSize; imageCanvas.height = frameSize;
        imageCanvas.getContext('2d')?.putImageData(image, 0, 0);
        context.drawImage(imageCanvas, column * frameSize, row * frameSize);
      }
    }
    renderer.setRenderTarget(null);
    renderTarget.dispose();
    cube.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    renderer.dispose();
    renderer.domElement.remove();
    const metadata: ImpostorAtlasMetadata = {
      version: 1, projection: 'octahedral', columns, rows,
      viewCount: columns * rows, frameSize, padding: 4, rowOrigin: 'top',
      sourceBounds: { center: [0, 0, 0], radius: Math.sqrt(3) },
    };
    this.metadata.set(metadata);
    this.atlasUrl.set(canvas.toDataURL('image/png'));
    this.selectedCell.set('0,0');
    this.createRuntimeImpostor(canvas);
  }

  selectModel(model: 'cube' | 'tree'): void {
    this.model.set(model);
    void this.generateAtlas();
  }

  private createSourceModel(model: 'cube' | 'tree'): Group {
    const group = new Group();
    if (model === 'cube') {
      group.add(new Mesh(new BoxGeometry(2, 2, 2), [
        new MeshBasicMaterial({ color: '#55d6be' }), new MeshBasicMaterial({ color: '#ff6b6b' }),
        new MeshBasicMaterial({ color: '#6c8cff' }), new MeshBasicMaterial({ color: '#ffd166' }),
        new MeshBasicMaterial({ color: '#c77dff' }), new MeshBasicMaterial({ color: '#4cc9f0' }),
      ]));
      return group;
    }
    const trunk = new Mesh(new ConeGeometry(0.28, 2.4, 8), new MeshStandardMaterial({ color: '#75452a' }));
    trunk.position.y = -0.35;
    group.add(trunk);
    for (const [radius, height, y] of [[1.15, 1.7, 0.35], [0.9, 1.5, 1.15], [0.62, 1.25, 1.85]] as const) {
      const foliage = new Mesh(new ConeGeometry(radius, height, 10), new MeshStandardMaterial({ color: '#2e9f5b' }));
      foliage.position.y = y;
      group.add(foliage);
    }
    return group;
  }

  private createRuntimeImpostor(atlas: HTMLCanvasElement): void {
    this.impostorTexture?.dispose();
    this.impostorSprite?.removeFromParent();
    if (this.impostorSprite instanceof Mesh) {
      this.impostorSprite.geometry.dispose();
      this.impostorSprite.material.dispose();
    } else {
      this.impostorSprite?.material.dispose();
    }
    this.impostorTexture = new CanvasTexture(atlas);
    this.impostorTexture.needsUpdate = true;
    if (this.runtimeMode() === 'discrete') {
      const sprite = new Sprite(new SpriteMaterial({ map: this.impostorTexture, transparent: true, depthWrite: false }));
      sprite.scale.set(5.6, 5.6, 1);
      this.impostorSprite = sprite;
      this.engine.scene.add(sprite);
      this.updateRuntimeImpostor();
      return;
    }
    const material = new ShaderMaterial({
      uniforms: {
        map: { value: this.impostorTexture },
        spritesPerSide: { value: this.columns() },
        alphaClamp: { value: 0.02 },
      },
      vertexShader: IMPOSTOR_VERTEX_SHADER,
      fragmentShader: IMPOSTOR_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: 2,
    });
    this.impostorSprite = new Mesh(new PlaneGeometry(2, 2), material);
    this.impostorSprite.position.set(0, 0, 0);
    this.impostorSprite.scale.set(2.8, 2.8, 1);
    this.engine.scene.add(this.impostorSprite);
    this.updateRuntimeImpostor();
  }

  private updateRuntimeImpostor(): void {
    const sprite = this.impostorSprite;
    const texture = this.impostorTexture;
    const camera = this.engine.camera$.value;
    const data = this.metadata();
    if (!sprite || !texture || !camera || !data) return;
    // Atlas views are baked around the source object's center; the runtime
    // direction is measured from the preview sprite's own world position.
    // The preview sprite is offset from the source cube, so use the camera
    // direction relative to the sprite rather than relative to world origin.
    camera.getWorldPosition(this.impostorDirection);
    sprite.getWorldPosition(this.impostorPosition);
    this.impostorDirection.sub(this.impostorPosition).normalize();
    const { column, row } = atlasCellForDirection(this.impostorDirection, data.columns, data.rows);
    if (sprite instanceof Sprite) {
      const material = sprite.material as SpriteMaterial;
      const uv = atlasCellForDirection(this.impostorDirection, data.columns, data.rows);
      texture.repeat.set(1 / data.columns, 1 / data.rows);
      texture.offset.set(uv.column / data.columns, 1 - (uv.row + 1) / data.rows);
      material.map = texture;
      material.needsUpdate = true;
    } else {
      sprite.material.uniforms['spritesPerSide'].value = data.columns;
      sprite.material.uniforms['map'].value = texture;
    }
    this.selectedCell.set(`${column},${row}`);
  }

  setRuntimeMode(mode: 'discrete' | 'reference'): void {
    if (this.runtimeMode() === mode) return;
    this.runtimeMode.set(mode);
    const canvas = this.atlasCanvas?.nativeElement;
    if (canvas) this.createRuntimeImpostor(canvas);
  }

  /** Returns the stable image-up axis used for a given baked camera direction. */
  private getBakeUp(direction: Vector3, target: Vector3): Vector3 {
    target.copy(this.worldUp).addScaledVector(direction, -this.worldUp.dot(direction));
    if (target.lengthSq() < 0.000001) {
      target.copy(this.fallbackUp).addScaledVector(direction, -this.fallbackUp.dot(direction));
    }
    return target.normalize();
  }

  selectCell(column: number, row: number): void {
    this.selectedCell.set(`${column},${row}`);
  }

  downloadAtlas(): void {
    const link = document.createElement('a');
    link.href = this.atlasUrl();
    link.download = 'octahedral-cube-atlas.png';
    link.click();
  }

  downloadMetadata(): void {
    const blob = new Blob([JSON.stringify(this.metadata(), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'octahedral-cube-atlas.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

}
