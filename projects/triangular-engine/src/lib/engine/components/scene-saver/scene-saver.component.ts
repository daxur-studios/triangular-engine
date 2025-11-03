import { Component, contentChild, input, signal } from '@angular/core';
import { ISizes } from '../../models/engine.model';
import { SceneComponent } from '../object-3d/scene/scene.component';

@Component({
  selector: 'sceneSaver',
  imports: [],
  templateUrl: './scene-saver.component.html',
  styleUrl: './scene-saver.component.css',
})
export class SceneSaverComponent {
  readonly zoom = input<number>(1);
  readonly filePrefix = input<string>('scene');

  readonly zoomValue = signal(1);
  readonly prefixValue = signal('scene');

  readonly contentChildSceneComponent =
    contentChild.required<SceneComponent>(SceneComponent);

  constructor() {
    this.zoomValue.set(this.zoom());
    this.prefixValue.set(this.filePrefix());
  }

  readonly resolution = input.required<ISizes>();

  async saveScene(): Promise<void> {
    const canvas = this.contentChildSceneComponent().engineService.canvas;
    if (!canvas) {
      console.warn('No canvas available to save');
      return;
    }

    // Temporarily disable pixel ratio scaling for exact output size
    const renderer = this.contentChildSceneComponent().engineService.renderer;
    const originalPixelRatio = renderer.getPixelRatio();
    const { width, height } = this.resolution();

    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false); // don't update style

    // Render once to update the canvas
    this.contentChildSceneComponent().engineService.requestSingleRender();

    // Convert canvas to blob
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });

    // Restore original settings
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(originalPixelRatio);
    this.contentChildSceneComponent().engineService.requestSingleRender();

    if (!blob) {
      console.warn('Failed to create image blob');
      return;
    }

    // Try to use File System Access API if available
    if ('showSaveFilePicker' in window) {
      try {
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: `${this.prefixValue()}-${Date.now()}.png`,
          types: [
            {
              description: 'PNG Image',
              accept: { 'image/png': ['.png'] },
            },
          ],
        });

        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (error) {
        // User cancelled or API failed, fall back to download
        console.log(
          'File picker cancelled or not supported, falling back to download',
        );
      }
    }

    // Fallback: Create a data URL and trigger download
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `${this.prefixValue()}-${Date.now()}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  onZoomChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    this.zoomValue.set(value);
  }

  onPrefixChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.prefixValue.set(target.value);
  }
}
