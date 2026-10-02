import { TestBed } from '@angular/core/testing';
import { AudioListener, Scene } from 'three';
import { AudioService } from './audio.service';
import { EngineService } from './engine.service';
import { LoaderService } from './loader.service';
import { AudioCacheService } from './audio-cache.service';

describe('AudioService', () => {
  let service: AudioService;
  let mockEngine: any;

  beforeEach(() => {
    mockEngine = {
      scene: new Scene(),
    };

    TestBed.configureTestingModule({
      providers: [
        AudioService,
        {
          provide: LoaderService,
          useValue: {
            loadAndCacheAudio: jasmine.createSpy('loadAndCacheAudio'),
          },
        },
        AudioCacheService,
        { provide: EngineService, useValue: mockEngine },
      ],
    });

    service = TestBed.inject(AudioService);
  });

  describe('Audio Buses', () => {
    it('initializes default buses with volume 1 and unmuted', () => {
      expect(service.getBusVolume('master')).toBe(1);
      expect(service.getBusVolume('music')).toBe(1);
      expect(service.getBusVolume('sfx')).toBe(1);
      expect(service.getBusVolume('ambient')).toBe(1);
      expect(service.getBusVolume('voice')).toBe(1);
      expect(service.getBusVolume('ui')).toBe(1);

      expect(service.isBusMuted('master')).toBeFalse();
      expect(service.isBusMuted('music')).toBeFalse();
      expect(service.isBusMuted('sfx')).toBeFalse();
    });

    it('sets and gets bus volume', () => {
      service.setBusVolume('sfx', 0.7);
      expect(service.getBusVolume('sfx')).toBe(0.7);

      service.setBusVolume('sfx', -0.5);
      expect(service.getBusVolume('sfx')).toBe(0); // clamps to 0
    });

    it('sets and gets bus mute state', () => {
      service.setBusMuted('music', true);
      expect(service.isBusMuted('music')).toBeTrue();

      service.setBusMuted('music', false);
      expect(service.isBusMuted('music')).toBeFalse();
    });

    it('computes effective volume based on bus and master multipliers', () => {
      service.setBusVolume('master', 0.8);
      service.setBusVolume('sfx', 0.5);

      // 0.8 (master) * 0.5 (sfx) * 1.0 (base) = 0.4
      expect(service.getEffectiveVolume('sfx', 1.0)).toBeCloseTo(0.4, 5);

      // Base volume scaling: 0.4 * 0.5 = 0.2
      expect(service.getEffectiveVolume('sfx', 0.5)).toBeCloseTo(0.2, 5);
    });

    it('returns zero effective volume when bus or master is muted', () => {
      service.setBusVolume('master', 1);
      service.setBusVolume('sfx', 1);

      service.setBusMuted('sfx', true);
      expect(service.getEffectiveVolume('sfx', 1)).toBe(0);

      service.setBusMuted('sfx', false);
      service.setBusMuted('master', true);
      expect(service.getEffectiveVolume('sfx', 1)).toBe(0);
      expect(service.getEffectiveVolume('music', 1)).toBe(0);
    });

    it('increments busStateVersion on bus changes', () => {
      const v0 = service.busStateVersion();
      service.setBusVolume('sfx', 0.5);
      expect(service.busStateVersion()).toBe(v0 + 1);

      service.setBusMuted('sfx', true);
      expect(service.busStateVersion()).toBe(v0 + 2);
    });
  });

  describe('AudioListener Management', () => {
    it('creates and caches fallback listener when none is registered', () => {
      expect(service.activeListener()).toBeUndefined();
      const listener = service.getOrCreateListener();
      expect(listener).toBeDefined();
      expect(service.getOrCreateListener()).toBe(listener);
    });

    it('registers and unregisters custom listener', () => {
      const customListener = new AudioListener();
      service.registerListener(customListener);

      expect(service.activeListener()).toBe(customListener);
      expect(service.getOrCreateListener()).toBe(customListener);

      service.unregisterListener(customListener);
      expect(service.activeListener()).toBeUndefined();
    });

    it('synchronizes master volume to active listener', () => {
      const listener = new AudioListener();
      service.registerListener(listener);

      service.setBusVolume('master', 0.4);
      expect(listener.getMasterVolume()).toBeCloseTo(0.4, 5);

      service.setBusMuted('master', true);
      expect(listener.getMasterVolume()).toBe(0);

      service.setBusMuted('master', false);
      expect(listener.getMasterVolume()).toBeCloseTo(0.4, 5);
    });
  });

  describe('One-shot sound playback', () => {
    function createMockBuffer(): AudioBuffer {
      const listener = service.getOrCreateListener();
      return listener.context.createBuffer(1, 100, 44100);
    }

    it('plays a 2D one-shot audio clip with correct effective volume', async () => {
      const buffer = createMockBuffer();
      service.setBusVolume('master', 0.8);
      service.setBusVolume('ui', 0.5);

      const audio = await service.playOneShot(buffer, {
        bus: 'ui',
        volume: 0.5,
        playbackRate: 1.2,
      });

      expect(audio).toBeDefined();
      expect(audio!.getVolume()).toBeCloseTo(0.2, 5); // 0.8 * 0.5 * 0.5
      expect(audio!.playbackRate).toBe(1.2);
    });

    it('plays a 3D positional one-shot audio clip at a position', async () => {
      const buffer = createMockBuffer();
      const pos: [number, number, number] = [10, 5, -2];

      const sound = await service.playPositionalOneShot(buffer, pos, {
        bus: 'sfx',
        refDistance: 2,
        maxDistance: 200,
        rolloffFactor: 2,
      });

      expect(sound).toBeDefined();
      expect(sound!.position.x).toBe(10);
      expect(sound!.position.y).toBe(5);
      expect(sound!.position.z).toBe(-2);
      expect(sound!.getRefDistance()).toBe(2);
      expect(sound!.getMaxDistance()).toBe(200);
      expect(sound!.getRolloffFactor()).toBe(2);
      expect(mockEngine.scene.children).toContain(sound!);
    });
  });
});
