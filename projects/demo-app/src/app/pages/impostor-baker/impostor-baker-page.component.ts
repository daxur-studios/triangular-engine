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
  CanvasTexture,
  Color,
  DirectionalLight,
  MeshBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  WebGLRenderTarget,
  WebGLRenderer,
  RGBAFormat,
  UnsignedByteType,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EngineModule, EngineService } from 'triangular-engine';
import { ImpostorAtlasMetadata, atlasDirection, octahedralEncode } from './impostor-atlas.models';

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
  readonly metadata = signal<ImpostorAtlasMetadata | undefined>(undefined);
  readonly atlasUrl = signal('');
  readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  readonly cameraPosition: [number, number, number] = [4, 3, 5];
  readonly cameraTarget: [number, number, number] = [0, 0, 0];
  private impostorTexture?: CanvasTexture;
  private impostorSprite?: Sprite;
  private readonly impostorDirection = new Vector3();

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
    const cube = new Mesh(
      new BoxGeometry(2, 2, 2),
      [
        new MeshBasicMaterial({ color: '#55d6be' }), new MeshBasicMaterial({ color: '#ff6b6b' }),
        new MeshBasicMaterial({ color: '#6c8cff' }), new MeshBasicMaterial({ color: '#ffd166' }),
        new MeshBasicMaterial({ color: '#c77dff' }), new MeshBasicMaterial({ color: '#4cc9f0' }),
      ],
    );
    bakeScene.add(cube, new AmbientLight(0xffffff, 1));
    const light = new DirectionalLight(0xffffff, 1.5);
    light.position.set(4, 6, 5);
    bakeScene.add(light);
    const camera = new OrthographicCamera(-1.45, 1.45, 1.45, -1.45, 0.1, 20);
    const pixels = new Uint8Array(frameSize * frameSize * 4);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const direction = atlasDirection(column, row, columns, rows);
        camera.position.copy(direction).multiplyScalar(5);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        renderer.setRenderTarget(renderTarget);
        renderer.clear();
        renderer.render(bakeScene, camera);
        renderer.readRenderTargetPixels(renderTarget, 0, 0, frameSize, frameSize, pixels);
        const image = new ImageData(new Uint8ClampedArray(pixels), frameSize, frameSize);
        const imageCanvas = document.createElement('canvas');
        imageCanvas.width = frameSize; imageCanvas.height = frameSize;
        imageCanvas.getContext('2d')?.putImageData(image, 0, 0);
        context.drawImage(imageCanvas, column * frameSize, row * frameSize);
      }
    }
    renderer.setRenderTarget(null);
    renderTarget.dispose();
    cube.geometry.dispose();
    (cube.material as MeshBasicMaterial[]).forEach((material) => material.dispose());
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

  private createRuntimeImpostor(atlas: HTMLCanvasElement): void {
    this.impostorTexture?.dispose();
    this.impostorSprite?.removeFromParent();
    this.impostorTexture = new CanvasTexture(atlas);
    this.impostorTexture.needsUpdate = true;
    const material = new SpriteMaterial({ map: this.impostorTexture, transparent: true });
    this.impostorSprite = new Sprite(material);
    this.impostorSprite.position.set(2.8, 0, 0);
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
    // Atlas views are baked around the source object's center (the origin),
    // so do not measure the lookup direction from the preview sprite's offset
    // position. Using the sprite position skews the vertical orbit direction.
    this.impostorDirection.copy(camera.position).normalize();
    const encoded = octahedralEncode(this.impostorDirection);
    // octahedralEncode already returns normalized atlas UVs in the 0–1 range.
    // Match the camera orbit's vertical convention to the baked row order.
    // The atlas image is displayed top-to-bottom, but the orbit's up/down
    // direction is already represented by the encoded Y coordinate here.
    const column = Math.min(data.columns - 1, Math.max(0, Math.floor(encoded.x * data.columns)));
    const row = Math.min(data.rows - 1, Math.max(0, Math.floor(encoded.y * data.rows)));
    texture.repeat.set(1 / data.columns, 1 / data.rows);
    texture.offset.set(column / data.columns, 1 - (row + 1) / data.rows);
    texture.needsUpdate = true;
    this.selectedCell.set(`${column},${row}`);
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
