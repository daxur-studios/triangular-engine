import {
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  NearestFilter,
  NearestMipMapNearestFilter,
  Texture,
} from 'three';

import { compressOctahedralImpostorAtlas } from './compress-octahedral-impostor-atlas';
import type { IOctahedralImpostorAtlas } from './create-octahedral-impostor-atlas';

describe('compressOctahedralImpostorAtlas', () => {
  it('is defined as a function', () => {
    expect(typeof compressOctahedralImpostorAtlas).toBe('function');
  });
});
