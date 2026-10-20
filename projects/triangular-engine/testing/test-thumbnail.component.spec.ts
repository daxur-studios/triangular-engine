import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TestThumbnailComponent, THUMBNAIL_FRAME_MS } from './test-thumbnail.component';

describe('TestThumbnailComponent', () => {
  let fixture: ComponentFixture<TestThumbnailComponent>;
  const urls = ['/a.webp', '/b.webp', '/c.webp'];
  const el = () => fixture.nativeElement as HTMLElement;
  const src = () => el().querySelector('img')?.getAttribute('src');

  function create(inputs: { urls: string[]; autoplay?: boolean }, reducedMotion = false) {
    spyOn(window, 'matchMedia').and.returnValue({ matches: reducedMotion, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList);
    fixture = TestBed.createComponent(TestThumbnailComponent);
    fixture.componentRef.setInput('urls', inputs.urls);
    fixture.componentRef.setInput('label', 'Orbit view');
    if (inputs.autoplay) fixture.componentRef.setInput('autoplay', true);
    fixture.detectChanges();
  }
  const tick = (ms: number) => { jasmine.clock().tick(ms); fixture.detectChanges(); };

  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  it('shows a single image as a still, with no control', () => {
    create({ urls: ['/a.webp'] });
    expect(src()).toBe('/a.webp');
    expect(el().querySelector('button')).toBeNull();
    expect(el().querySelector('img')?.getAttribute('alt')).toBe('Orbit view');
    expect(el().querySelector('img')?.getAttribute('loading')).toBe('lazy');
  });

  it('shows a placeholder when there is no image', () => {
    create({ urls: [] });
    expect(el().querySelector('img')).toBeNull();
    expect(el().querySelector('.empty')).not.toBeNull();
  });

  it('loops several images while hovered or focused, and stops when the pointer leaves', () => {
    create({ urls });
    const button = el().querySelector('button')!;
    expect(src()).toBe('/a.webp');
    tick(THUMBNAIL_FRAME_MS * 2);
    expect(src()).toBe('/a.webp');
    button.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    tick(THUMBNAIL_FRAME_MS);
    expect(src()).toBe('/b.webp');
    tick(THUMBNAIL_FRAME_MS * 2);
    expect(src()).toBe('/a.webp');
    button.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();
    tick(THUMBNAIL_FRAME_MS * 3);
    expect(src()).toBe('/a.webp');
    button.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    tick(THUMBNAIL_FRAME_MS);
    expect(src()).toBe('/b.webp');
  });

  it('pins the loop on tap, for a phone without hover', () => {
    create({ urls });
    const button = el().querySelector('button')!;
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    tick(THUMBNAIL_FRAME_MS);
    expect(src()).toBe('/b.webp');
    button.click();
    fixture.detectChanges();
    tick(THUMBNAIL_FRAME_MS * 3);
    expect(src()).toBe('/b.webp');
  });

  it('autoplays on request', () => {
    create({ urls, autoplay: true });
    tick(THUMBNAIL_FRAME_MS);
    expect(src()).toBe('/b.webp');
    tick(THUMBNAIL_FRAME_MS);
    expect(src()).toBe('/c.webp');
  });

  it('never moves by itself with reduced motion; a click steps one frame', () => {
    create({ urls, autoplay: true }, true);
    const button = el().querySelector('button')!;
    button.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    tick(THUMBNAIL_FRAME_MS * 3);
    expect(src()).toBe('/a.webp');
    button.click();
    fixture.detectChanges();
    expect(src()).toBe('/b.webp');
    tick(THUMBNAIL_FRAME_MS * 3);
    expect(src()).toBe('/b.webp');
  });
});
