import {
  CapsuleGeometry, Color, Group, LatheGeometry, Mesh, MeshStandardMaterial,
  SphereGeometry, Vector2,
} from 'three';
import type { CapsuleCatCharacterDNA } from 'triangular-engine/characters';

export function buildConceptCatSuit() {
  const fur = { value: new Color() };
  const accent = { value: new Color() };
  const suit = { value: new Color() };
  const trim = { value: new Color() };
  const pattern = { value: 0 };
  const material = new MeshStandardMaterial({ roughness: 0.72 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { catFur: fur, catAccent: accent, catSuit: suit, catTrim: trim, catPattern: pattern });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 catPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ncatPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 catPosition;
uniform vec3 catFur, catAccent, catSuit, catTrim;
uniform float catPattern;

float catRumpStroke(vec2 point, vec2 end) {
  return length(point - end * clamp(dot(point, end) / dot(end, end), -1.0, 1.0));
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float seam = catPosition.z + 0.018;
float feather = max(fwidth(seam), 0.002);
float front = smoothstep(-feather, feather, seam);
if (catPattern > 1.5) {
  diffuseColor.rgb = mix(catAccent, catFur, smoothstep(-0.04, 0.04, seam));
} else {
  float stripe = 1.0 - smoothstep(0.022, 0.027, abs(catPosition.x));
  stripe *= smoothstep(0.08, 0.10, catPosition.z);
  float suited = catPattern > 0.5 ? 1.0 : front;
  diffuseColor.rgb = mix(catFur, mix(catSuit, catTrim, stripe), suited);
}

// Paint a small asterisk onto the exposed rump below the tail.
if (catPosition.z < -0.4 && (catPattern < 0.5 || catPattern > 1.5)) {
  vec2 point = catPosition.xy;
  float diagonals = min(catRumpStroke(point, vec2(0.022, 0.013)),
                        catRumpStroke(point, vec2(0.022, -0.013)));
  float distanceToInk = min(diagonals, catRumpStroke(point, vec2(0.0, 0.024))) - 0.0045;
  float aa = max(fwidth(distanceToInk), 0.001);
  float ink = 1.0 - smoothstep(-aa, aa, distanceToInk);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.48, 0.38, 0.34), ink);
}`);
  };
  const geometry = new CapsuleGeometry(0.266, 0.355, 20, 48);
  geometry.rotateX(Math.PI / 2);
  geometry.scale(1.04, 1.04, 1);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'concept-cat-torso';
  mesh.position.set(0, -0.062, 0.012);
  mesh.castShadow = mesh.receiveShadow = true;

  return {
    mesh,
    setAppearance(dna: CapsuleCatCharacterDNA): void {
      fur.value.set(dna.furColor);
      accent.value.set(dna.furAccentColor);
      suit.value.set(dna.suitColor);
      trim.value.set(dna.suitTrimColor);
      pattern.value = dna.bodyPattern === 'natural_two_tone' ? 2 : dna.bodyPattern === 'full_suit' ? 1 : 0;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function buildConceptCatHelmet() {
  const root = new Group();
  root.name = 'concept-cat-helmet';
  root.position.set(0, 0.105, 0.365);
  root.rotation.x = 0.71;
  const rimRadius = 0.318;
  const domeRadius = 0.417;
  const aperture = Math.PI - Math.asin(rimRadius / domeRadius);
  const collarGeometry = new LatheGeometry([
    new Vector2(0.222, -0.059), new Vector2(0.286, -0.065), new Vector2(0.32, -0.053),
    new Vector2(0.335, -0.032), new Vector2(0.332, 0.002), new Vector2(0.318, 0.015),
    new Vector2(0.259, -0.005), new Vector2(0.222, -0.059),
  ], 64);
  const collarMaterial = new MeshStandardMaterial({ color: '#716761', roughness: 0.57, metalness: 0.12 });
  const collar = new Mesh(collarGeometry, collarMaterial);
  collar.name = 'concept-cat-collar';
  collar.castShadow = true;
  root.add(collar);

  const domeGeometry = new SphereGeometry(domeRadius, 64, 40, 0, 2 * Math.PI, 0, aperture);
  const domeMaterial = new MeshStandardMaterial({
    color: '#d6e0e8', transparent: true, opacity: 0.08, depthWrite: false, roughness: 0.18,
  });
  domeMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float grazing = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.5);
      diffuseColor.a += 0.48 * grazing;
      outgoingLight = mix(outgoingLight, vec3(0.31, 0.39, 0.48), grazing * 0.85);
      #include <opaque_fragment>
    `);
  };
  const dome = new Mesh(domeGeometry, domeMaterial);
  dome.name = 'concept-cat-helmet-dome';
  dome.position.y = -domeRadius * Math.cos(aperture);
  dome.renderOrder = 2;
  root.add(dome);
  return {
    root,
    setAppearance(dna: CapsuleCatCharacterDNA): void {
      dome.visible = dna.helmet;
      root.visible = dna.helmet || dna.pack !== 'none' || dna.harness;
    },
    dispose(): void {
      domeGeometry.dispose();
      domeMaterial.dispose();
      collarGeometry.dispose();
      collarMaterial.dispose();
    },
  };
}
