import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CatalogThumbnailService } from './catalog-thumbnail.service';

/** Shows the same browser-local preview wherever a scene appears in a catalog. */
@Component({
  selector: 'app-catalog-thumbnail',
  templateUrl: './catalog-thumbnail.component.html',
  styleUrl: './catalog-thumbnail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogThumbnailComponent {
  readonly route = input.required<string>();
  readonly title = input.required<string>();
  private readonly thumbnails = inject(CatalogThumbnailService);
  readonly preview = computed(() => this.thumbnails.sources()[this.route()]);

  onImageError(): void {
    if (this.preview()) this.thumbnails.forget(this.route());
  }
}
