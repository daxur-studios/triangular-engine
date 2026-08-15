/**
 * Bake-pass shaders: render one view of the target object into the MRT
 * atlas render target (see `create-octahedral-impostor-atlas.ts`) — albedo
 * to output 0, packed view-space normal + linear depth to output 1. Ported
 * from the reference octahedral-impostor library's
 * `shaders/atlas_texture/octahedral_atlas_{vertex,fragment}.glsl`, which
 * itself is three.js's standard normal/depth material chunks merged with a
 * basic albedo material and two `layout(location = n)` outputs. Requires
 * `GLSL3` (the `layout(location = ...)` MRT outputs are ES 3.00-only).
 */

export const IMPOSTOR_ATLAS_BAKE_VERTEX_GLSL = /* glsl */ `
#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
  varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <color_pars_vertex>
varying vec2 vHighPrecisionZW;

void main() {
  #include <uv_vertex>
  #include <color_vertex>
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <normal_vertex>
  #include <begin_vertex>
  #include <displacementmap_vertex>
  #include <project_vertex>

  vHighPrecisionZW = gl_Position.zw;

  #if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
    vViewPosition = - mvPosition.xyz;
  #endif
}
`;

export const IMPOSTOR_ATLAS_BAKE_FRAGMENT_GLSL = /* glsl */ `
#define NORMAL
uniform vec3 diffuse;
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
  varying vec3 vViewPosition;
#endif
#include <packing>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
varying vec2 vHighPrecisionZW;

layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormalDepth;

void main() {
  vec4 diffuseColor = vec4( diffuse, opacity );
  #include <map_fragment>
  #include <color_fragment>
  #include <alphamap_fragment>
  #include <alphatest_fragment>
  #include <alphahash_fragment>

  if (diffuseColor.a <= 0.2) discard;

  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif
  #ifdef USE_TRANSMISSION
    diffuseColor.a *= material.transmissionAlpha;
  #endif
  gAlbedo = diffuseColor;
  gAlbedo = linearToOutputTexel( gAlbedo );

  #ifdef PREMULTIPLIED_ALPHA
    gAlbedo.rgb *= gAlbedo.a;
  #endif

  #include <normal_fragment_begin>
  #include <normal_fragment_maps>

  float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
  gNormalDepth = vec4( packNormalToRGB( normal ), 1.0 - fragCoordZ );
}
`;
