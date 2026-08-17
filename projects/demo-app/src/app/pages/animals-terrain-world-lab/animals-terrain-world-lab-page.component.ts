import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe, NgFor } from '@angular/common';
import { EngineModule, EngineService } from 'triangular-engine';
import { BackSide, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, MeshBasicMaterial, PlaneGeometry, SphereGeometry, Vector3, ConeGeometry } from 'three';
import {
  createAnimalLandHerdCyclePlayback, type AnimalLandHerdCycleDefinition, type AnimalLandHerdMember,
  type AnimalGrazingPatch, type AnimalWorldSurface, type AnimalVector3,
  createAnimalAirFlockCyclePlayback, type AnimalAirFlockCycleDefinition, type AnimalAirFlockMember,
  createAnimalAquaticSchoolCyclePlayback, type AnimalAquaticSchoolCycleDefinition, type AnimalAquaticSchoolMember, type AnimalWaterVolume,
} from 'triangular-engine/animals';
import { adaptTerrainScatterForAnimals, TerrainAnimalWorldSurface } from 'triangular-engine/animals/terrain';
import { TerrainWaterAnimalVolume } from 'triangular-engine/animals/water';
import { ConstantTerrainField, CylinderTerrainDomain, PlaneTerrainDomain, SphereTerrainDomain, type ITerrainFieldSample, type TerrainVector3 } from 'triangular-engine/terrain';
import { CylinderWaterDomain, PlaneWaterDomain, SphereWaterDomain, type WaterSurface } from 'triangular-engine/water';

type Shape = 'plane' | 'sphere' | 'cylinder';
type WorldSize = 'small' | 'medium' | 'large';
const WORLD_SIZES: readonly WorldSize[] = ['small', 'medium', 'large'];
const SIZE_FACTOR: Record<WorldSize, number> = { small: 1, medium: 3, large: 9 };
// Temporary composition gate: fish terrain fixtures are not yet aligned with
// the aquatic cycle's safe-home contract. Keep this page navigable while the
// dedicated water POC remains the fish validation surface.
const ENABLE_TERRAIN_FISH = true;
interface View { shape: Shape; size: WorldSize; label: string; root: Group; surface: AnimalWorldSurface; water: AnimalWaterVolume; playbacks: readonly ReturnType<typeof createAnimalLandHerdCyclePlayback>[]; birdPlaybacks: readonly ReturnType<typeof createAnimalAirFlockCyclePlayback>[]; fishPlaybacks: readonly ReturnType<typeof createAnimalAquaticSchoolCyclePlayback>[]; animals: Mesh[]; birds: Mesh[]; fish: Mesh[]; trees: Mesh[]; }

@Component({
  selector: 'app-animals-terrain-world-lab-page', imports: [EngineModule, DecimalPipe, NgFor],
  templateUrl: './animals-terrain-world-lab-page.component.html', styleUrl: './animals-terrain-world-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush, providers: [EngineService.provide({ showFPS: true })], host: { class: 'flex-page' },
})
export class AnimalsTerrainWorldLabPageComponent {
  readonly universalTime = signal(0); readonly timeScale = signal(1); readonly paused = signal(false);
  readonly selectedShape = signal<Shape>('plane'); readonly worldSize = signal<WorldSize>('small');
  readonly status = signal<Record<Shape, string>>({ plane: 'ready', sphere: 'ready', cylinder: 'ready' });
  readonly speedOptions = [-10, -5, -1, 0, 1, 5, 10] as const;
  private readonly engine = inject(EngineService); private readonly destroyRef = inject(DestroyRef);
  private readonly animalGeometry = new SphereGeometry(0.28, 10, 7);
  private readonly animalMaterial = new MeshStandardMaterial({ color: '#d39a57' });
  private readonly birdGeometry = new SphereGeometry(0.18, 8, 6);
  private readonly birdMaterial = new MeshStandardMaterial({ color: '#e8e4c7' });
  private readonly fishGeometry = new ConeGeometry(0.16, 0.65, 6);
  private readonly fishMaterial = new MeshStandardMaterial({ color: '#f0a84b' });
  private readonly treeGeometry = new CylinderGeometry(0.18, 0.3, 2.4, 7);
  private readonly treeMaterial = new MeshStandardMaterial({ color: '#3f6f3e' });
  private readonly views: readonly View[];

  constructor() {
    const shapes: readonly Shape[] = ['plane', 'sphere', 'cylinder'];
    this.views = WORLD_SIZES.flatMap(size => shapes.map(shape => this.makeSizedView(shape, size)));
    for (const view of this.views) this.engine.scene.add(view.root);
    this.updateViewPresentation();
    this.render(0);
    let previous = performance.now();
    const timer = window.setInterval(() => { const now = performance.now(); const dt = Math.min(.1, Math.max(0, (now - previous) / 1000)); previous = now; if (!this.paused() && this.timeScale() !== 0) { this.universalTime.update(t => t + dt * this.timeScale()); this.render(this.universalTime()); } }, 50);
    this.destroyRef.onDestroy(() => { window.clearInterval(timer); for (const view of this.views) view.root.removeFromParent(); this.animalGeometry.dispose(); this.animalMaterial.dispose(); this.birdGeometry.dispose(); this.birdMaterial.dispose(); this.fishGeometry.dispose(); this.fishMaterial.dispose(); this.treeGeometry.dispose(); this.treeMaterial.dispose(); });
  }
  setUniversalTime(event: Event): void { const value = Number((event.target as HTMLInputElement).value); if (Number.isFinite(value)) { this.universalTime.set(value); this.render(value); } }
  setTimeScale(value: number): void { this.timeScale.set(value); this.paused.set(value === 0); }
  setShape(shape: Shape): void { this.selectedShape.set(shape); this.updateViewPresentation(); }
  setWorldSize(size: WorldSize): void { this.worldSize.set(size); this.updateViewPresentation(); }
  togglePause(): void { this.paused.update(value => !value); }
  reset(): void { this.universalTime.set(0); this.timeScale.set(1); this.paused.set(false); this.render(0); }
  private updateViewPresentation(): void { const selected = this.selectedShape(); const size = this.worldSize(); for (const view of this.views) view.root.visible = view.shape === selected && view.size === size; }
  private makeSizedView(shape: Shape, size: WorldSize): View {
    const factor = SIZE_FACTOR[size];
    if (shape === 'plane') return this.makeView(shape, size, `${size} infinite plane`, new TerrainCheckpointField(), new PlaneTerrainDomain(18 * factor), [0, 0, 0], { x: 0, y: 0, z: 0 });
    if (shape === 'sphere') return this.makeView(shape, size, `${size} planet sphere`, new ConstantTerrainField(0), new SphereTerrainDomain(7 * factor), [0, 0, 0], { x: 7 * factor, y: 0, z: 0 });
    // The cylinder is an inside-facing tube: Y is its longitudinal axis, so
    // sample from the middle of the volume rather than the capped end.
    return this.makeView(shape, size, `${size} inside cylinder`, new ConstantTerrainField(0), new CylinderTerrainDomain({ radiusM: 7 * factor, lengthM: 14 * factor }), [0, 0, 0], { x: 0, y: 0, z: 0 });
  }

  private makeView(shape: Shape, size: WorldSize, label: string, field: ConstantTerrainField, domain: PlaneTerrainDomain | SphereTerrainDomain | CylinderTerrainDomain, offset: readonly [number, number, number], query: AnimalVector3): View {
    const surface = new TerrainAnimalWorldSurface(field, domain, { maxWalkableSlope01: .75 }) as AnimalWorldSurface;
    const factor = SIZE_FACTOR[size]; const root = new Group(); root.position.set(...offset); root.add(this.makeTerrain(shape, factor));
    const home = surface.sample(query); const patch = (id: string, position: AnimalVector3, radiusM: number, suitability01: number): AnimalGrazingPatch => ({ id, position, radiusM, capacity: 12, suitability01 });
    const grazingPatches = [patch(`${shape}-home`, home.position, 2, 1), patch(`${shape}-meadow`, surface.moveAlongSurface(home.position, scale(home.tangentU, 5), 1), 2.5, .9), patch(`${shape}-ridge`, surface.moveAlongSurface(home.position, scale(home.tangentV, 4), 1), 2.5, .75)];
    const scatterInstances = grazingPatches.map((p, index) => ({ instanceId: `tree-${index}`, worldPositionM: [p.position.x, p.position.y, p.position.z] as [number, number, number], normal: [home.normal.x, home.normal.y, home.normal.z] as [number, number, number], surfaceUp: [home.surfaceUp.x, home.surfaceUp.y, home.surfaceUp.z] as [number, number, number], rotationSeed01: index / 3, scaleSeed01: .5, embedSeed01: 0 }));
    const adapted = adaptTerrainScatterForAnimals({ habitatVersion: `${shape}-terrain-v1`, sources: [{ speciesId: 'tree', instances: scatterInstances, habitatKind: 'meadow', activities: ['feed', 'rest'], obstacleRadiusM: .7, blocksLand: true, roostCapacity: 4 }] });
    const trees = adapted.obstacles.map(obstacle => { const tree = new Mesh(this.treeGeometry, this.treeMaterial); tree.position.set(obstacle.position.x, obstacle.position.y, obstacle.position.z); root.add(tree); return tree; });
    for (const p of grazingPatches) root.add(this.patchMesh(p));
    const policy = { surface, maximumMembers: 8, maximumPatches: 3, maximumSpeedMps: 1.8, maximumAccelerationMps2: 3, maximumSubstepDistanceM: .25, maximumSubsteps: 8, maximumSlope01: .75, maximumPatchDistanceM: 20, minimumPatchSuitability01: .5, separationRadiusM: 1.3, separationWeight: 2.5, cohesionWeight: .15, alignmentWeight: .2, targetWeight: .5, arrivalRadiusM: .35, slotSpacingM: .7, travelLineSpacingM: 1.1, leaderFollowDelaySeconds: .8, maximumAvoidanceAttempts: 4, obstacles: adapted.obstacles };
    const definition: AnimalLandHerdCycleDefinition = { groupId: `${shape}-terrain-herd-a`, groupSeed: 0x7a11 + shape.length, memberCount: 6, homePatch: grazingPatches[0], grazingPatches, restDurationS: 6, outboundTravelDurationS: 10, grazeDurationS: 10, returnTravelDurationS: 12, fixedStepSeconds: .1, maximumReplaySteps: 400, policy };
    const groupCount = size === 'small' ? 2 : size === 'medium' ? 4 : 8;
    const herdDefinitions: AnimalLandHerdCycleDefinition[] = Array.from({ length: groupCount }, (_, index) => {
      if (index === 0) return definition;
      const spreadTangent = shape === 'cylinder' ? home.tangentU : home.tangentV;
      const shift = scale(spreadTangent, (index % 4) * 2.5 + Math.floor(index / 4) * 1.25);
      const shiftedPatches = grazingPatches.map(patch => ({ ...patch, position: surface.moveAlongSurface(patch.position, shift, 1) }));
      return { ...definition, groupId: `${shape}-${size}-terrain-herd-${index}`, groupSeed: definition.groupSeed + index, homePatch: shiftedPatches[index % shiftedPatches.length], grazingPatches: shiftedPatches };
    });
    const flightTarget = surface.moveAlongSurface(home.position, scale(home.tangentU, 6), 1);
    const airPolicy = { surface, maximumMembers: 8, maximumRoostSites: 4, maximumSpeedMps: 4, maximumAccelerationMps2: 5, maximumSubstepDistanceM: .35, maximumSubsteps: 10, minimumAltitudeM: 2.5, maximumAltitudeM: 5.5, preferredAltitudeM: 3.5, flightBehavior: 'boid3d' as const, flightAltitudeSpreadM: 1.3, separationRadiusM: 1.4, separationWeight: 1.5, cohesionWeight: .35, alignmentWeight: .4, targetWeight: 1, arrivalRadiusM: .4, holdingRadiusM: 2.5, holdingSpeedMps: .8, roostSlotSpacingM: .8, obstacles: adapted.obstacles };
    const birdDefinition: AnimalAirFlockCycleDefinition = { groupId: `${shape}-terrain-birds-a`, memberCount: 6, roostSites: adapted.roostSites, flightTarget: surface.sample(flightTarget).position, roostDurationS: 5, flightDurationS: 12, returnDurationS: 12, fixedStepSeconds: .1, maximumReplaySteps: 400, policy: airPolicy };
    const birdDefinitions: AnimalAirFlockCycleDefinition[] = Array.from({ length: groupCount }, (_, index) => {
      if (index === 0) return birdDefinition;
      const spreadTangent = shape === 'cylinder' ? home.tangentU : home.tangentV;
      const shift = scale(spreadTangent, (index % 4) * 2.5 + Math.floor(index / 4) * 1.25);
      return { ...birdDefinition, groupId: `${shape}-${size}-terrain-birds-${index}`, flightTarget: surface.sample(surface.moveAlongSurface(flightTarget, shift, 1)).position };
    });
    const water = this.makeWater(shape, factor);
    const fishHome = this.fishPosition(shape, factor);
    const fishSample = water.sample(fishHome, 0);
    if (!fishSample.containsWater) this.status.update(status => ({ ...status, [shape]: 'fish fixture outside water' }));
    const fishFeeding = { id: `${shape}-fish-feeding`, position: fishHome, radiusM: 2, capacity: 8, suitability01: .9 };
    const aquaticPolicy = { water, maximumMembers: 8, maximumZones: 3, maximumZoneDistanceM: 20, minimumZoneSuitability01: .4, maximumSpeedMps: 2.2, maximumAccelerationMps2: 4, maximumSubstepDistanceM: .3, maximumSubsteps: 8, minimumSurfaceClearanceM: .7, minimumBottomClearanceM: .7, preferredSurfaceClearanceM: 1.4, maximumSurfaceClearanceM: 2.3, segmentSampleSpacingM: .25, separationRadiusM: 1, separationWeight: 2.4, cohesionWeight: .55, alignmentWeight: .45, targetWeight: 1.1, flowWeight: .1, depthWeight: 1.2, arrivalRadiusM: .3, slotSpacingM: .6, loiterRadiusM: 1.1, loiterAngularSpeedRadPerSecond: .65, maximumAvoidanceAttempts: 4 };
    const fishDefinition: AnimalAquaticSchoolCycleDefinition = { groupId: `${shape}-terrain-fish-a`, groupSeed: 0x5eed + shape.length, memberCount: 6, homeZone: { id: `${shape}-fish-home-a`, position: fishHome, radiusM: 2, capacity: 8, suitability01: 1 }, feedingZones: [fishFeeding], schoolingDurationS: 5, outboundDurationS: 10, feedingDurationS: 10, returnDurationS: 12, fixedStepSeconds: .1, maximumReplaySteps: 400, policy: aquaticPolicy };
    const secondFish = { ...fishDefinition, groupId: `${shape}-terrain-fish-b`, groupSeed: fishDefinition.groupSeed + 1, homeZone: { ...fishDefinition.homeZone, id: `${shape}-fish-home-b`, position: this.fishOffset(shape, fishHome, 2.5) }, feedingZones: [{ ...fishFeeding, id: `${shape}-fish-feeding-b`, position: this.fishOffset(shape, fishFeeding.position, 2.5) }] };
    const animals = Array.from({ length: definition.memberCount * groupCount }, () => { const animal = new Mesh(this.animalGeometry, this.animalMaterial); root.add(animal); return animal; });
    const birds = Array.from({ length: birdDefinition.memberCount * groupCount }, () => { const bird = new Mesh(this.birdGeometry, this.birdMaterial); root.add(bird); return bird; });
    const fish = Array.from({ length: fishDefinition.memberCount * groupCount }, () => { const fish = new Mesh(this.fishGeometry, this.fishMaterial); root.add(fish); return fish; });
    const fishPlaybacks = ENABLE_TERRAIN_FISH && fishSample.containsWater
      ? [createAnimalAquaticSchoolCyclePlayback(fishDefinition), createAnimalAquaticSchoolCyclePlayback(secondFish)]
      : [];
    return { shape, size, label, root, surface, water, playbacks: herdDefinitions.map(createAnimalLandHerdCyclePlayback), birdPlaybacks: birdDefinitions.map(createAnimalAirFlockCyclePlayback), fishPlaybacks, animals, birds, fish, trees };
  }
  private makeWater(shape: Shape, factor = 1): AnimalWaterVolume {
    // Positive inward elevation leaves a usable water column inside the
    // cylinder (negative elevation would push the floor outside the body).
    // Curved domains point inward: positive elevation moves the bathymetry
    // toward the centre, leaving a real water column between surface and bed.
    const terrain = new TerrainAnimalWorldSurface(new ConstantTerrainField(3), shape === 'plane' ? new PlaneTerrainDomain(18 * factor) : shape === 'sphere' ? new SphereTerrainDomain(7 * factor) : new CylinderTerrainDomain({ radiusM: 7 * factor, lengthM: 14 * factor }));
    const surface: WaterSurface = { getHeight: () => 0, getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0), getFlow: (_x, _z, _time, out = new Vector3()) => out.set(.15, 0, .05) };
    // The terrain cylinder uses its canonical Y axis; keep the water body on
    // the same axis so bathymetry and the water footprint agree.
    const domain = shape === 'plane' ? new PlaneWaterDomain() : shape === 'sphere' ? new SphereWaterDomain(7 * factor) : new CylinderWaterDomain(7 * factor, { axis: new Vector3(1, 0, 0), lengthM: 14 * factor });
    return new TerrainWaterAnimalVolume({ terrain, bodies: [{ body: { id: `${shape}-checkpoint-water`, domain, surface } }] });
  }
  private fishPosition(shape: Shape, factor = 1): AnimalVector3 { return shape === 'plane' ? { x: 0, y: -1.4, z: 0 } : shape === 'sphere' ? { x: 5.6 * factor, y: 0, z: 0 } : { x: 0, y: 5.6 * factor, z: 0 }; }
  private fishOffset(shape: Shape, position: AnimalVector3, distance: number): AnimalVector3 { return shape === 'plane' ? { x: position.x, y: position.y, z: position.z + distance } : shape === 'sphere' ? { x: position.x, y: distance, z: position.z } : { x: position.x, y: position.y, z: position.z + distance }; }
  private makeTerrain(shape: Shape, factor = 1): Mesh { if (shape === 'sphere') return new Mesh(new SphereGeometry(7 * factor, 32, 18), new MeshStandardMaterial({ color: '#55784c', side: BackSide })); if (shape === 'cylinder') { const mesh = new Mesh(new CylinderGeometry(7 * factor, 7 * factor, 14 * factor, 32, 1, true), new MeshStandardMaterial({ color: '#55784c', side: BackSide })); mesh.rotation.z = Math.PI / 2; return mesh; } const geometry = new PlaneGeometry(18 * factor, 18 * factor, 20, 20); geometry.rotateX(-Math.PI / 2); return new Mesh(geometry, new MeshStandardMaterial({ color: '#55784c' })); }
  private patchMesh(patch: AnimalGrazingPatch): Mesh { const mesh = new Mesh(new CylinderGeometry(patch.radiusM, patch.radiusM, .04, 24), new MeshStandardMaterial({ color: '#9bad53', transparent: true, opacity: .45 })); mesh.position.set(patch.position.x, patch.position.y, patch.position.z); return mesh; }
  private render(time: number): void { const statuses = { ...this.status() }; const activeShape = this.selectedShape(); const activeSize = this.worldSize(); for (const view of this.views) { if (view.shape !== activeShape || view.size !== activeSize) continue; let animalIndex = 0; let birdIndex = 0; let fishIndex = 0; let phase = ''; let birdPhase = ''; let fishPhase = ''; view.playbacks.forEach(playback => { const snapshot = playback.sample(time); phase += `${snapshot.phase} `; snapshot.members.forEach(member => this.renderAnimal(view, view.animals[animalIndex++], member)); }); view.birdPlaybacks.forEach(playback => { const snapshot = playback.sample(time); birdPhase += `${snapshot.phase} `; snapshot.members.forEach(member => this.renderBird(view, view.birds[birdIndex++], member)); }); view.fishPlaybacks.forEach(playback => { const snapshot = playback.sample(time); fishPhase += `${snapshot.phase} `; snapshot.members.forEach(member => this.renderFish(view, view.fish[fishIndex++], member, time)); }); statuses[view.shape] = `${view.size}: ${phase.trim()} · birds ${birdPhase.trim()} · fish ${fishPhase.trim()} · groups ${view.playbacks.length}`; } this.status.set(statuses); }
  private renderAnimal(view: View, mesh: Mesh, member: AnimalLandHerdMember): void { const frame = view.surface.sample(member.position); mesh.position.set(member.position.x + frame.surfaceUp.x * .35, member.position.y + frame.surfaceUp.y * .35, member.position.z + frame.surfaceUp.z * .35); mesh.up.set(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z); }
  private renderBird(view: View, mesh: Mesh, member: AnimalAirFlockMember): void { mesh.position.set(member.position.x, member.position.y, member.position.z); }
  private renderFish(view: View, mesh: Mesh, member: AnimalAquaticSchoolMember, time: number): void { mesh.position.set(member.position.x, member.position.y, member.position.z); const sample = view.water.sample(member.position, time); const velocity = new Vector3(member.velocity.x, member.velocity.y, member.velocity.z); if (velocity.lengthSq() > 1e-8) mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), velocity.normalize()); else if (sample.bottom) mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(sample.bottom.tangentU.x, sample.bottom.tangentU.y, sample.bottom.tangentU.z)); }
}

function scale(value: AnimalVector3, factor: number): AnimalVector3 { return { x: value.x * factor, y: value.y * factor, z: value.z * factor }; }
class TerrainCheckpointField extends ConstantTerrainField {
  constructor() { super(0); }
  override sample([x, _y, z]: TerrainVector3): ITerrainFieldSample { return { elevationM: Math.sin(x / 7) * .35 + Math.cos(z / 9) * .25 }; }
}
