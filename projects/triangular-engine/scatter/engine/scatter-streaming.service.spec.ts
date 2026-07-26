import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { PerspectiveCamera } from 'three';
import { EngineService } from 'triangular-engine';
import { ScatterStreamingService } from './scatter-streaming.service';

describe('ScatterStreamingService', () => {
  let camera$: BehaviorSubject<PerspectiveCamera>;
  let tick$: BehaviorSubject<number>;
  let service: ScatterStreamingService;

  beforeEach(() => {
    const camera = new PerspectiveCamera();
    camera.position.set(10, 20, 30);
    camera$ = new BehaviorSubject(camera);
    tick$ = new BehaviorSubject(0);

    TestBed.configureTestingModule({
      providers: [
        ScatterStreamingService,
        {
          provide: EngineService,
          useValue: {
            camera$,
            tick$,
            get camera() {
              return camera$.value;
            },
          },
        },
      ],
    });
    service = TestBed.inject(ScatterStreamingService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('uses the active camera world position by default', () => {
    expect(service.viewpointWorldM).toEqual([10, 20, 30]);

    const replacement = new PerspectiveCamera();
    replacement.position.set(-4, 5, 6);
    camera$.next(replacement);

    expect(service.viewpointWorldM).toEqual([-4, 5, 6]);
  });

  it('tracks parented cameras in world space', () => {
    const camera = camera$.value;
    camera.position.set(1, 2, 3);
    camera.parent?.remove(camera);

    const parent = new PerspectiveCamera();
    parent.position.set(10, 0, -5);
    parent.add(camera);
    tick$.next(1 / 60);

    expect(service.viewpointWorldM).toEqual([11, 2, -2]);
  });

  it('coalesces small camera movement using the configurable threshold', () => {
    const emitted: (readonly [number, number, number])[] = [];
    service.viewpointWorldM$.subscribe((value) => emitted.push(value));

    camera$.value.position.x += 0.5;
    tick$.next(1 / 60);
    expect(emitted).toEqual([[10, 20, 30]]);

    camera$.value.position.x += 0.6;
    tick$.next(1 / 60);
    expect(emitted).toEqual([
      [10, 20, 30],
      [11.1, 20, 30],
    ]);
  });

  it('can follow a moving override and return to camera following', () => {
    let playerPosition: readonly [number, number, number] = [100, 2, 3];
    service.setViewpointOverride(() => playerPosition);
    expect(service.viewpointWorldM).toEqual([100, 2, 3]);

    playerPosition = [105, 2, 3];
    tick$.next(1 / 60);
    expect(service.viewpointWorldM).toEqual([105, 2, 3]);

    service.setViewpointOverride(undefined);
    expect(service.viewpointWorldM).toEqual([10, 20, 30]);
  });

  it('rejects invalid thresholds and viewpoints', () => {
    expect(() => service.setMovementThresholdM(-1)).toThrowError(RangeError);
    expect(() => service.setViewpointOverride([Number.NaN, 0, 0])).toThrowError(
      RangeError,
    );
  });
});
