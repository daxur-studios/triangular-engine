# @pmndrs/vanilla helpers (optional)

Billboard and Sparkles components wrap [@pmndrs/vanilla](https://www.npmjs.com/package/@pmndrs/vanilla) and live behind a separate package entry point so apps that do not need them avoid the dependency.

## Install

```bash
npm i @pmndrs/vanilla
```

Import from `triangular-engine/pmndrs`, not from `triangular-engine`.

```ts
import { PmndrsModule, BillboardComponent, SparklesComponent } from "triangular-engine/pmndrs";
```

## Billboard

Keeps child content facing the active camera.

```html
<billboard [follow]="true" [lockY]="true">
  <mesh>
    <planeGeometry [params]="[1, 1]" [orientation]="'billboard'" />
    <meshStandardMaterial />
  </mesh>
</billboard>
```

Use `[orientation]="'billboard'"` on `planeGeometry` (no extra geometry rotation — do not add mesh `[rotation]`; that only compensated for an old planeGeometry bug).

| Input    | Default | Description              |
| -------- | ------- | ------------------------ |
| `follow` | `true`  | Orient toward the camera |
| `lockX`  | `false` | Lock rotation on X       |
| `lockY`  | `false` | Lock rotation on Y       |
| `lockZ`  | `false` | Lock rotation on Z       |

## Sparkles

GPU particle sparkles. Changing inputs disposes and recreates the underlying object.

```html
<sparkles [count]="200" color="#ffd700" [size]="2" [speed]="0.5" [sparkleScale]="1" />
```

| Input          | Default   | Description                                     |
| -------------- | --------- | ----------------------------------------------- |
| `count`        | `100`     | Particle count                                  |
| `speed`        | `1`       | Animation speed                                 |
| `opacity`      | `1`       | Opacity                                         |
| `color`        | `#ffffff` | Color                                           |
| `size`         | `1`       | Particle size                                   |
| `sparkleScale` | `1`       | Particle scale (`@pmndrs/vanilla` `scale` prop) |
| `noise`        | `1`       | Noise amount                                    |
