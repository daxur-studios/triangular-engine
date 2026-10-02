import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Scene } from 'three';
import { AudioService } from '../../services/audio.service';
import { EngineService } from '../../services/engine.service';
import { LoaderService } from '../../services/loader.service';
import { AudioCacheService } from '../../services/audio-cache.service';
import { MaterialService } from '../../services/material.service';
import { AudioListenerComponent } from './audio-listener.component';
import { PositionalAudioComponent } from './positional-audio.component';
import { AmbientAudioComponent } from './ambient-audio.component';

@Component({
  standalone: true,
  imports: [
    AudioListenerComponent,
    PositionalAudioComponent,
    AmbientAudioComponent,
  ],
  template: `
    <audioListener [(masterVolume)]="masterVolume" />
    <positionalAudio
      [buffer]="sfxBuffer"
      [volume]="sfxVolume()"
      bus="sfx"
      [refDistance]="refDistance()"
      [maxDistance]="maxDistance()"
      [rolloffFactor]="rolloffFactor()"
      [distanceModel]="'linear'"
      [coneInnerAngle]="180"
      [coneOuterAngle]="240"
      [coneOuterGain]="0.2"
    />
    <ambientAudio
      [buffer]="musicBuffer"
      [volume]="musicVolume()"
      bus="music"
      [loop]="true"
      [playbackRate]="1.1"
      [detune]="100"
    />
  `,
})
class TestAudioHostComponent {
  masterVolume = 0.9;
  sfxVolume = signal(0.8);
  musicVolume = signal(0.6);
  refDistance = signal(5);
  maxDistance = signal(500);
  rolloffFactor = signal(2);

  sfxBuffer?: AudioBuffer;
  musicBuffer?: AudioBuffer;
}

describe('Audio Components', () => {
  let fixture: ComponentFixture<TestAudioHostComponent>;
  let host: TestAudioHostComponent;
  let audioService: AudioService;
  let mockEngine: any;

  beforeEach(() => {
    mockEngine = {
      scene: new Scene(),
    };

    TestBed.configureTestingModule({
      imports: [TestAudioHostComponent],
      providers: [
        AudioService,
        {
          provide: LoaderService,
          useValue: {
            loadAndCacheAudio: jasmine.createSpy('loadAndCacheAudio'),
          },
        },
        AudioCacheService,
        MaterialService,
        { provide: EngineService, useValue: mockEngine },
      ],
    });

    audioService = TestBed.inject(AudioService);
    const listener = audioService.getOrCreateListener();
    const ctx = listener.context;

    // Create host and mock buffers
    fixture = TestBed.createComponent(TestAudioHostComponent);
    host = fixture.componentInstance;
    host.sfxBuffer = ctx.createBuffer(1, 100, 44100);
    host.musicBuffer = ctx.createBuffer(1, 100, 44100);

    fixture.detectChanges();
    TestBed.flushEffects();
  });

  it('registers AudioListenerComponent and synchronizes master volume', () => {
    expect(audioService.activeListener()).toBeDefined();
    expect(audioService.getBusVolume('master')).toBeCloseTo(0.9, 5);
    expect(audioService.activeListener()!.getMasterVolume()).toBeCloseTo(0.9, 5);

    host.masterVolume = 0.5;
    fixture.detectChanges();
    TestBed.flushEffects();

    expect(audioService.getBusVolume('master')).toBeCloseTo(0.5, 5);
    expect(audioService.activeListener()!.getMasterVolume()).toBeCloseTo(0.5, 5);
  });

  it('configures PositionalAudioComponent spatial properties and volume', () => {
    const positional = fixture.debugElement.children.find(
      (c) => c.componentInstance instanceof PositionalAudioComponent,
    )?.componentInstance as PositionalAudioComponent;

    expect(positional).toBeDefined();
    const sound = positional.positionalAudio;

    expect(sound.getRefDistance()).toBe(5);
    expect(sound.getMaxDistance()).toBe(500);
    expect(sound.getRolloffFactor()).toBe(2);
    expect(sound.getDistanceModel()).toBe('linear');
    expect(sound.panner.coneInnerAngle).toBe(180);
    expect(sound.panner.coneOuterAngle).toBe(240);
    expect(sound.panner.coneOuterGain).toBe(0.2);

    // Initial effective volume: master (0.9) * sfx bus (1.0) * component (0.8) = 0.72
    expect(sound.getVolume()).toBeCloseTo(0.72, 5);

    // Adjust sfx bus volume globally in AudioService
    audioService.setBusVolume('sfx', 0.5);
    fixture.detectChanges();
    TestBed.flushEffects();

    // 0.9 * 0.5 * 0.8 = 0.36
    expect(sound.getVolume()).toBeCloseTo(0.36, 5);

    // Adjust component volume
    host.sfxVolume.set(1.0);
    fixture.detectChanges();
    TestBed.flushEffects();
    // 0.9 * 0.5 * 1.0 = 0.45
    expect(sound.getVolume()).toBeCloseTo(0.45, 5);

    // Muting SFX bus drops volume to 0
    audioService.setBusMuted('sfx', true);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(sound.getVolume()).toBe(0);
  });

  it('configures AmbientAudioComponent settings and reactive bus volume', () => {
    const ambient = fixture.debugElement.children.find(
      (c) => c.componentInstance instanceof AmbientAudioComponent,
    )?.componentInstance as AmbientAudioComponent;

    expect(ambient).toBeDefined();
    const sound = ambient.audio;

    expect(sound.loop).toBeTrue();
    expect(sound.playbackRate).toBe(1.1);
    expect(sound.detune).toBe(100);

    // Effective volume: master (0.9) * music bus (1.0) * component (0.6) = 0.54
    expect(sound.getVolume()).toBeCloseTo(0.54, 5);

    audioService.setBusVolume('music', 0.5);
    fixture.detectChanges();
    TestBed.flushEffects();
    // 0.9 * 0.5 * 0.6 = 0.27
    expect(sound.getVolume()).toBeCloseTo(0.27, 5);
  });

  it('handles playback lifecycle on audio components', async () => {
    const positional = fixture.debugElement.children.find(
      (c) => c.componentInstance instanceof PositionalAudioComponent,
    )?.componentInstance as PositionalAudioComponent;

    expect(positional.isPlaying).toBeFalse();

    await positional.play();
    expect(positional.isPlaying).toBeTrue();

    positional.pause();
    expect(positional.isPlaying).toBeFalse();

    await positional.play();
    positional.stop();
    expect(positional.isPlaying).toBeFalse();
  });
});
