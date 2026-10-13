import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { PortalTargetDirective } from '@daxur-studios/portal-layout';
import { EngineService } from 'triangular-engine';
import { EMPTY, Subscription, catchError, filter, map, of, switchMap, take, timeout, timer } from 'rxjs';
import { CatalogThumbnailService } from './catalog-thumbnail.service';

/** Poll only while waiting for the route's scene to initialize. */
const SCENE_POLL_MS = 150;
/** Legacy raw-canvas pages have no engine portal; stop waiting on those routes. */
const SCENE_READY_TIMEOUT_MS = 20000;
/** Frozen scenes may not publish another frame; manual capture forces a render. */
const FRAME_WAIT_MS = 1200;
/** Give async scene content a short settling period before the first preview. */
const AUTO_CAPTURE_DELAY_MS = 1000;

/**
 * Projects the capture control into the existing engine overlay portal.
 *
 * One app-level registration covers scene pages without copying UI into each demo.
 */
@Component({
  selector: 'app-catalog-capture',
  imports: [PortalTargetDirective],
  templateUrl: './catalog-capture.component.html',
  styleUrl: './catalog-capture.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogCaptureComponent {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly thumbnails = inject(CatalogThumbnailService);
  readonly route = signal('');
  readonly engine = signal<EngineService | null>(null);
  readonly capturing = signal(false);
  readonly message = signal('');
  private watching?: Subscription;
  private autoCapture?: ReturnType<typeof setTimeout>;
  private generation = 0;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationStart) this.reset();
      if (event instanceof NavigationEnd) this.watchScene(event.urlAfterRedirects);
    });
    this.watchScene(this.router.url);
    this.destroyRef.onDestroy(() => this.reset());
  }

  async capture(): Promise<void> {
    const engine = this.engine();
    const route = this.route();
    const generation = this.generation;
    if (!engine || this.capturing()) return;
    clearTimeout(this.autoCapture);
    this.capturing.set(true);
    this.message.set('');
    try {
      const persisted = await this.thumbnails.capture(route, engine);
      if (generation === this.generation) this.message.set(persisted ? 'Thumbnail saved' : 'Preview saved for this session; browser storage is unavailable.');
    } catch (error) {
      if (generation === this.generation) this.message.set(error instanceof Error ? error.message : 'Could not capture this scene.');
    } finally {
      if (generation === this.generation) this.capturing.set(false);
    }
  }

  private watchScene(url: string): void {
    this.reset();
    const route = url.split(/[?#]/)[0];
    if (route === '/' || route === '/spikes') return;
    this.route.set(route);
    const generation = this.generation;
    this.watching = timer(0, SCENE_POLL_MS).pipe(
      map(() => EngineService.activeInstance),
      filter((engine): engine is EngineService => !!engine?.renderer && engine.canvas.isConnected && engine.width > 1 && engine.height > 1),
      take(1),
      timeout(SCENE_READY_TIMEOUT_MS),
      catchError(() => EMPTY),
      switchMap((engine) => engine.renderComplete$.pipe(
        take(1),
        timeout(FRAME_WAIT_MS),
        catchError(() => of(null)),
        map(() => engine),
      )),
    ).subscribe(async (engine) => {
      if (generation !== this.generation) return;
      this.engine.set(engine);
      await this.thumbnails.loaded;
      if (generation === this.generation && !this.thumbnails.sources()[route]) {
        this.autoCapture = setTimeout(() => void this.capture(), AUTO_CAPTURE_DELAY_MS);
      }
    });
  }

  private reset(): void {
    this.generation++;
    this.watching?.unsubscribe();
    clearTimeout(this.autoCapture);
    this.engine.set(null);
    this.capturing.set(false);
    this.message.set('');
  }
}
