import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
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
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { ImpostorAtlasMetadata, atlasDirection } from './impostor-atlas.models';

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
  readonly cameraPosition: [number, number, number] = [4, 3, 5];
  readonly cameraTarget: [number, number, number] = [0, 0, 0];

  ngAfterViewInit(): void {
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
