import {
  AerialPerspectiveEffect,
  PrecomputedTexturesGenerator,
} from '@takram/three-atmosphere';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
  CLOUD_SHAPE_TEXTURE_SIZE,
  CloudsEffect,
} from '@takram/three-clouds';
import {
  DataTextureLoader,
  DEFAULT_STBN_URL,
  Ellipsoid,
  parseUint8Array,
  STBNLoader,
} from '@takram/three-geospatial';
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import {
  Clock,
  Data3DTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipMapLinearFilter,
  Matrix4,
  NoColorSpace,
  PerspectiveCamera,
  RedFormat,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

@Component({
  selector: 'app-takram-clouds-spike',
  templateUrl: './takram-clouds-spike.component.html',
  styleUrl: './takram-clouds-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TakramCloudsSpikeComponent implements AfterViewInit {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly message = signal('Loading cloud textures…');
  readonly diagnostics = signal('WebGL: checking');

  ngAfterViewInit(): void {
    try {
      this.start(this.canvas().nativeElement);
    } catch (error) {
      this.status.set('error');
      this.message.set(error instanceof Error ? error.message : String(error));
    }
  }

  private start(canvas: HTMLCanvasElement): void {
    const renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(1);

    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      throw new Error('Takram clouds require WebGL2-class functionality.');
    }

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 1, 300_000);
    camera.position.set(0, 100, 1_500);

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 800, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minPolarAngle = Math.PI / 2;
    controls.maxPolarAngle = 2.05;
    controls.update();

    // Takram performs its atmosphere and cloud calculations in ECEF space.
    // Keep the demo camera in convenient local metre coordinates and map its
    // origin to the WGS84 surface at latitude/longitude 0, with local Y as up.
    const earthRadius = Ellipsoid.WGS84.maximumRadius;
    const worldToECEF = new Matrix4().set(
      0, 1, 0, earthRadius,
      1, 0, 0, 0,
      0, 0, -1, 0,
      0, 0, 0, 1,
    );

    const clouds = new CloudsEffect(camera, { resolutionScale: 0.25 });
    clouds.qualityPreset = 'low';
    clouds.coverage = 0.45;
    clouds.sunDirection.copy(new Vector3(1, 0.7, 0.4).normalize());
    clouds.localWeatherVelocity.set(0.002, 0);
    clouds.shadow.cascadeCount = 0;
    clouds.worldToECEFMatrix.copy(worldToECEF);
    clouds.cloudLayers.set([
      {
        channel: 'r',
        altitude: 750,
        height: 650,
        densityScale: 0.2,
        shadow: false,
      },
    ]);

    const aerialPerspective = new AerialPerspectiveEffect(camera, {
      sky: true,
    });
    aerialPerspective.overlay = clouds.atmosphereOverlay;
    aerialPerspective.sunDirection.copy(clouds.sunDirection);
    aerialPerspective.worldToECEFMatrix.copy(worldToECEF);

    const composer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
    });
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
      new EffectPass(
        camera,
        clouds,
        aerialPerspective,
        new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
      ),
    );

    const atmosphereGenerator = new PrecomputedTexturesGenerator(renderer);
    Object.assign(clouds, atmosphereGenerator.textures);
    Object.assign(aerialPerspective, atmosphereGenerator.textures);
    atmosphereGenerator.update().catch((error: unknown) => {
      this.status.set('error');
      this.message.set(
        `Atmosphere generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    const textures: Texture[] = [];
    const loadingManager = new TextureLoader().manager;
    loadingManager.onLoad = () => {
      this.status.set('ready');
      this.message.set('Rendering one default cloud layer');
    };
    loadingManager.onError = url => {
      this.status.set('error');
      this.message.set(`Failed to load texture: ${url}`);
    };

    const textureLoader = new TextureLoader(loadingManager);
    const configure2D = (texture: Texture): void => {
      texture.minFilter = LinearMipMapLinearFilter;
      texture.magFilter = LinearFilter;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.colorSpace = NoColorSpace;
    };
    clouds.localWeatherTexture = textureLoader.load(
      '/takram-clouds/local_weather.png',
      configure2D,
    );
    clouds.turbulenceTexture = textureLoader.load(
      '/takram-clouds/turbulence.png',
      configure2D,
    );
    textures.push(clouds.localWeatherTexture, clouds.turbulenceTexture);

    const loadVolume = (url: string, size: number): Data3DTexture =>
      new DataTextureLoader(Data3DTexture, parseUint8Array, {
        width: size,
        height: size,
        depth: size,
        format: RedFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        wrapS: RepeatWrapping,
        wrapT: RepeatWrapping,
        wrapR: RepeatWrapping,
        colorSpace: NoColorSpace,
        manager: loadingManager,
      }).load(url);

    clouds.shapeTexture = loadVolume(
      '/takram-clouds/shape.bin',
      CLOUD_SHAPE_TEXTURE_SIZE,
    );
    clouds.shapeDetailTexture = loadVolume(
      '/takram-clouds/shape_detail.bin',
      CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
    );
    clouds.stbnTexture = new STBNLoader(loadingManager).load(DEFAULT_STBN_URL);
    textures.push(clouds.shapeTexture, clouds.shapeDetailTexture, clouds.stbnTexture);

    const resizeObserver = new ResizeObserver(() => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(canvas);

    const clock = new Clock();
    let animationFrame = 0;
    let sampleTime = performance.now();
    let frames = 0;
    const animate = (): void => {
      animationFrame = requestAnimationFrame(animate);
      controls.update();
      aerialPerspective.overlay = clouds.atmosphereOverlay;
      composer.render(clock.getDelta());
      frames += 1;

      const now = performance.now();
      if (now - sampleTime >= 1_000) {
        const fps = Math.round((frames * 1_000) / (now - sampleTime));
        this.diagnostics.set(
          `WebGL2 · ${fps} fps · textures ${renderer.info.memory.textures}`,
        );
        frames = 0;
        sampleTime = now;
      }
    };
    animate();

    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(animationFrame);
      controls.dispose();
      resizeObserver.disconnect();
      composer.dispose();
      clouds.dispose();
      aerialPerspective.dispose();
      atmosphereGenerator.dispose();
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
    });
  }
}
