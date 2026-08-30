import {
  AdditiveBlending,
  Color,
  CustomBlending,
  Group,
  OneMinusSrcAlphaFactor,
  Points,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
} from 'three';

import { createCloudPuffClumpGeometry } from './cloud-puff-gpu-geometry';
import {
  GPU_CIRRUS_FRAGMENT_SHADER,
  GPU_CIRRUS_VERTEX_SHADER,
  GPU_PUFF_FRAGMENT_SHADER,
  GPU_PUFF_CLUMP_VERTEX_SHADER,
} from './cloud-puff-gpu-shaders';

export interface ICloudAtmosphereOptions {
  readonly particleCount?: number;
  readonly clumpSize?: number;
  readonly planetRadius?: number;
  readonly puffShellRadius?: number;
  readonly cirrusShellRadius?: number;
  readonly puffPixelScale?: number;
  readonly clumpRadius?: number;
  readonly followLag?: number;
  readonly lifespanS?: number;
  readonly zonalSpeed?: number;
  readonly zonalFrequency?: number;
  readonly curlStrength?: number;
  readonly curlFrequency?: number;
  readonly rimStrength?: number;
  readonly puffColor?: Color | string;
  readonly cirrusColor?: Color | string;
  readonly lodDistanceM?: number;
}

export interface ICloudAtmosphere {
  readonly group: Group;
  readonly puffMaterial: ShaderMaterial;
  readonly cirrusMaterial: ShaderMaterial;
  update(timeS: number): void;
  updateCamera(cameraPos: Vector3, lodDistanceM?: number): void;
  setSunDirection(direction: Vector3): void;
  setPuffPixelScale(scale: number): void;
  setClumpRadius(radius: number): void;
  setFollowLag(lag: number): void;
  setLifespan(lifespanS: number): void;
  setWindParams(params: {
    zonalSpeed?: number;
    zonalFrequency?: number;
    curlStrength?: number;
    curlFrequency?: number;
  }): void;
  showPuffs(visible: boolean): void;
  showCirrus(visible: boolean): void;
  dispose(): void;
}

export function buildCloudAtmosphere(options: ICloudAtmosphereOptions = {}): ICloudAtmosphere {
  const particleCount = options.particleCount ?? 800;
  const clumpSize = options.clumpSize ?? 4;
  const planetR = options.planetRadius ?? 55;
  const puffShellR = options.puffShellRadius ?? (planetR * 1.025);
  const cirrusShellR = options.cirrusShellRadius ?? (planetR * 1.055);

  const group = new Group();
  group.name = 'cloud-atmosphere-system';

  // Lower Cumulus Puff Clump Layer
  const puffGeometry = createCloudPuffClumpGeometry(particleCount, clumpSize);
  const puffMaterial = new ShaderMaterial({
    vertexShader: GPU_PUFF_CLUMP_VERTEX_SHADER,
    fragmentShader: GPU_PUFF_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0.0 },
      uLifespan: { value: options.lifespanS ?? 20.0 },
      uZonalSpeed: { value: options.zonalSpeed ?? 0.05 },
      uZonalFrequency: { value: options.zonalFrequency ?? 3.5 },
      uCurlStrength: { value: options.curlStrength ?? 0.06 },
      uCurlFrequency: { value: options.curlFrequency ?? 2.0 },
      uPuffPixelScale: { value: options.puffPixelScale ?? 9.0 },
      uClumpRadius: { value: options.clumpRadius ?? 0.015 },
      uFollowLag: { value: options.followLag ?? 1.5 },
      uShellRadius: { value: puffShellR },
      uRimStrength: { value: options.rimStrength ?? 1.2 },
      uSunDirection: { value: new Vector3(0.6, 0.7, 0.4).normalize() },
      uPuffColor: { value: new Color(options.puffColor ?? '#f8fafc') },
      uCameraPosition: { value: new Vector3(0, 50, 150) },
      uLodDistance: { value: options.lodDistanceM ?? 0.0 },
    },
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
  const puffPoints = new Points(puffGeometry, puffMaterial);
  puffPoints.frustumCulled = false;
  group.add(puffPoints);

  // Upper Wispy Cirrus Layer
  const cirrusGeometry = createCloudPuffClumpGeometry(Math.floor(particleCount * 0.4), 2);
  const cirrusMaterial = new ShaderMaterial({
    vertexShader: GPU_CIRRUS_VERTEX_SHADER,
    fragmentShader: GPU_CIRRUS_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0.0 },
      uLifespan: { value: (options.lifespanS ?? 20.0) * 1.5 },
      uZonalSpeed: { value: (options.zonalSpeed ?? 0.05) * 1.4 },
      uZonalFrequency: { value: options.zonalFrequency ?? 3.5 },
      uCurlStrength: { value: (options.curlStrength ?? 0.06) * 0.7 },
      uCurlFrequency: { value: options.curlFrequency ?? 2.0 },
      uPuffPixelScale: { value: (options.puffPixelScale ?? 9.0) * 1.8 },
      uShellRadius: { value: cirrusShellR },
      uSunDirection: { value: new Vector3(0.6, 0.7, 0.4).normalize() },
      uCirrusColor: { value: new Color(options.cirrusColor ?? '#e2e8f0') },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const cirrusPoints = new Points(cirrusGeometry, cirrusMaterial);
  cirrusPoints.frustumCulled = false;
  group.add(cirrusPoints);

  return {
    group,
    puffMaterial,
    cirrusMaterial,
    update(timeS: number) {
      puffMaterial.uniforms['uTime'].value = timeS;
      cirrusMaterial.uniforms['uTime'].value = timeS;
    },
    updateCamera(cameraPos: Vector3, lodDistanceM?: number) {
      puffMaterial.uniforms['uCameraPosition'].value.copy(cameraPos);
      if (lodDistanceM !== undefined) {
        puffMaterial.uniforms['uLodDistance'].value = lodDistanceM;
      }
    },
    setSunDirection(direction: Vector3) {
      puffMaterial.uniforms['uSunDirection'].value.copy(direction);
      cirrusMaterial.uniforms['uSunDirection'].value.copy(direction);
    },
    setPuffPixelScale(scale: number) {
      puffMaterial.uniforms['uPuffPixelScale'].value = scale;
      cirrusMaterial.uniforms['uPuffPixelScale'].value = scale * 1.8;
    },
    setClumpRadius(radius: number) {
      puffMaterial.uniforms['uClumpRadius'].value = radius;
    },
    setFollowLag(lag: number) {
      puffMaterial.uniforms['uFollowLag'].value = lag;
    },
    setLifespan(lifespanS: number) {
      puffMaterial.uniforms['uLifespan'].value = lifespanS;
      cirrusMaterial.uniforms['uLifespan'].value = lifespanS * 1.5;
    },
    setWindParams(params) {
      if (params.zonalSpeed !== undefined) {
        puffMaterial.uniforms['uZonalSpeed'].value = params.zonalSpeed;
        cirrusMaterial.uniforms['uZonalSpeed'].value = params.zonalSpeed * 1.4;
      }
      if (params.zonalFrequency !== undefined) {
        puffMaterial.uniforms['uZonalFrequency'].value = params.zonalFrequency;
        cirrusMaterial.uniforms['uZonalFrequency'].value = params.zonalFrequency;
      }
      if (params.curlStrength !== undefined) {
        puffMaterial.uniforms['uCurlStrength'].value = params.curlStrength;
        cirrusMaterial.uniforms['uCurlStrength'].value = params.curlStrength * 0.7;
      }
      if (params.curlFrequency !== undefined) {
        puffMaterial.uniforms['uCurlFrequency'].value = params.curlFrequency;
        cirrusMaterial.uniforms['uCurlFrequency'].value = params.curlFrequency;
      }
    },
    showPuffs(visible: boolean) {
      puffPoints.visible = visible;
    },
    showCirrus(visible: boolean) {
      cirrusPoints.visible = visible;
    },
    dispose() {
      puffGeometry.dispose();
      puffMaterial.dispose();
      cirrusGeometry.dispose();
      cirrusMaterial.dispose();
      group.clear();
    },
  };
}
