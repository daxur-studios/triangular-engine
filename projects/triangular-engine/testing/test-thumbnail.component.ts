import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';

/** Milliseconds each frame of a looped thumbnail stays. */
export const THUMBNAIL_FRAME_MS = 700;

/**
 * What a test case looked at: one still, or several frames that loop on hover and focus (and on tap, which pins the loop),
 * or constantly with `autoplay`. With `prefers-reduced-motion` nothing moves by itself; a click steps to the next frame.
 */
@Component({
  selector: 'tri-test-thumbnail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (urls().length === 0) {
      <span class="thumb empty" aria-hidden="true">no image</span>
    } @else if (urls().length === 1) {
      <img class="thumb" [src]="urls()[0]" [alt]="label()" loading="lazy" decoding="async" />
    } @else {
      <button type="button" class="thumb multi" [attr.aria-label]="label() + ', ' + urls().length + ' frames'" [attr.aria-pressed]="pinned()"
        (mouseenter)="hover.set(true)" (mouseleave)="hover.set(false)" (focus)="hover.set(true)" (blur)="hover.set(false)" (click)="click()">
        <img [src]="urls()[frame()]" [alt]="label()" loading="lazy" decoding="async" />
        <span class="dots" aria-hidden="true">
          @for (url of urls(); track $index) { <i [class.on]="$index === frame()"></i> }
        </span>
      </button>
    }
  `,
  styles: `
    :host { display: block; }
    .thumb { display: block; box-sizing: border-box; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 0.25rem;
      border: 1px solid var(--ui-border, #627080); background: var(--ui-surface-raised, #253242); }
    .empty { display: grid; place-items: center; font-size: 0.7rem; color: var(--ui-muted, #b0becd); border-style: dashed; }
    button.multi { position: relative; padding: 0; cursor: pointer; overflow: hidden; }
    button.multi img { width: 100%; height: 100%; object-fit: cover; display: block; }
    button.multi:focus-visible { outline: 2px solid var(--ui-accent, #8ac9ff); outline-offset: 2px; }
    .dots { position: absolute; inset-inline: 0; bottom: 3px; display: flex; justify-content: center; gap: 3px; }
    .dots i { width: 5px; height: 5px; border-radius: 50%; background: rgba(255, 255, 255, 0.45); }
    .dots i.on { background: #fff; }
  `,
})
export class TestThumbnailComponent {
  /** Image URLs, in frame order. */
  readonly urls = input.required<readonly string[]>();
  readonly label = input('Case thumbnail');
  /** Loop several frames without hover. Ignored with reduced motion. */
  readonly autoplay = input(false);

  readonly hover = signal(false);
  readonly pinned = signal(false);
  readonly index = signal(0);
  readonly reducedMotion = signal(false);
  readonly frame = computed(() => Math.min(this.index(), Math.max(0, this.urls().length - 1)));
  private readonly playing = computed(() => this.urls().length > 1 && !this.reducedMotion() && (this.autoplay() || this.hover() || this.pinned()));

  constructor() {
    const query = inject(DOCUMENT).defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (query) {
      this.reducedMotion.set(query.matches);
      const change = (event: MediaQueryListEvent) => this.reducedMotion.set(event.matches);
      query.addEventListener?.('change', change);
      inject(DestroyRef).onDestroy(() => query.removeEventListener?.('change', change));
    }
    effect((onCleanup) => {
      if (!this.playing()) return;
      const timer = setInterval(() => this.index.update((current) => (current + 1) % this.urls().length), THUMBNAIL_FRAME_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  /** A tap pins the loop (there is no hover on a phone); with reduced motion it steps one frame instead. */
  click(): void {
    if (this.reducedMotion()) this.index.update((current) => (current + 1) % this.urls().length);
    else this.pinned.update((value) => !value);
  }
}
