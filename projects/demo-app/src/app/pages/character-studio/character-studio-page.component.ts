import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  Color,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import type { ExtendedEmotionName } from 'triangular-engine/characters';
import {
  createCharacterStudioContributions,
  type CharacterStudioContribution,
  type CharacterStudioFamilyId,
} from './character-studio-contributions';

type CharacterStudioView = 'front' | 'three-quarter' | 'profile' | 'face';

interface CharacterStudioViewOption {
  readonly id: CharacterStudioView;
  readonly label: string;
}

@Component({
  selector: 'app-character-studio-page',
  imports: [EngineModule, RouterLink, UpperCasePipe],
  templateUrl: './character-studio-page.component.html',
  styleUrl: './character-studio-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: false })],
  host: { class: 'flex-page' },
})
export class CharacterStudioPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly contributions = createCharacterStudioContributions();
  private readonly controlsRevision = signal(0);
  private elapsedSeconds = 0;
  private variantSeed = 1;

  readonly familyOptions: readonly CharacterStudioContribution[] = [
    this.contributions.human,
    this.contributions.cat,
  ];
  readonly selectedFamilyId = signal<CharacterStudioFamilyId>('human');
  readonly activeFamily = computed(() => this.contributions[this.selectedFamilyId()]);
  readonly selectedPresetId = signal(this.contributions.human.defaultPresetId);
  readonly selectedMotionId = signal('idle');
  readonly selectedExpression = signal<ExtendedEmotionName>('happy');
  readonly autoRotate = signal(false);
  readonly activeView = signal<CharacterStudioView>('three-quarter');
  readonly cameraPosition = signal<[number, number, number]>([2.6, 1.7, 3.2]);
  readonly cameraTarget = signal<[number, number, number]>([0, 0.98, 0]);
  readonly viewOptions: readonly CharacterStudioViewOption[] = [
    { id: 'front', label: 'Front' },
    { id: 'three-quarter', label: '3/4' },
    { id: 'profile', label: 'Profile' },
    { id: 'face', label: 'Face' },
  ];
  readonly expressionOptions: readonly { readonly id: ExtendedEmotionName; readonly label: string }[] = [
    { id: 'happy', label: 'Happy' },
    { id: 'angry', label: 'Angry' },
    { id: 'sad', label: 'Sad' },
    { id: 'surprised', label: 'Surprised' },
  ];
  readonly activeControls = computed(() => {
    this.controlsRevision();
    return this.activeFamily().controlGroups();
  });
  readonly visiblePresets = computed(() => {
    const family = this.activeFamily();
    const selected = this.selectedPresetId();
    if (selected !== 'custom' || family.presets.some((preset) => preset.value === selected)) {
      return family.presets;
    }
    return [{ value: 'custom', label: 'Custom variation' }, ...family.presets];
  });
  readonly selectedPresetLabel = computed(() => {
    const selected = this.selectedPresetId();
    return this.activeFamily().presets.find((preset) => preset.value === selected)?.label ?? 'Custom variation';
  });

  private readonly floor = new Mesh(
    new PlaneGeometry(60, 60),
    new MeshStandardMaterial({ color: '#151922', roughness: 0.92, metalness: 0.02 }),
  );
  private readonly pedestal = new Mesh(
    new CylinderGeometry(0.82, 0.88, 0.08, 64),
    new MeshStandardMaterial({ color: '#252c38', roughness: 0.58, metalness: 0.34 }),
  );

  constructor() {
    this.engine.scene.background = new Color('#10131b');
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.105;
    this.floor.receiveShadow = true;
    this.pedestal.position.y = -0.04;
    this.pedestal.receiveShadow = true;

    this.engine.scene.add(this.floor, this.pedestal, ...this.familyOptions.map((family) => family.root));
    this.syncFamilyVisibility();
    this.applyView('three-quarter');

    this.engine.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deltaSeconds) => this.update(deltaSeconds));

    this.destroyRef.onDestroy(() => {
      for (const family of this.familyOptions) {
        this.engine.scene.remove(family.root);
        family.dispose();
      }
      this.engine.scene.remove(this.floor, this.pedestal);
      this.floor.geometry.dispose();
      (this.floor.material as MeshStandardMaterial).dispose();
      this.pedestal.geometry.dispose();
      (this.pedestal.material as MeshStandardMaterial).dispose();
    });
  }

  selectFamily(id: CharacterStudioFamilyId): void {
    if (id === this.selectedFamilyId()) return;
    this.selectedFamilyId.set(id);
    const family = this.activeFamily();
    this.selectedPresetId.set(family.defaultPresetId);
    const initialMotion = id === 'cat' ? 'goofy_walk' : 'idle';
    this.selectedMotionId.set(initialMotion);
    family.setMotion(initialMotion);
    family.selectPreset(family.defaultPresetId);
    family.setExpression(this.selectedExpression());
    this.syncFamilyVisibility();
    this.applyView('three-quarter');
    this.refreshControls();
  }

  selectPreset(presetId: string): void {
    if (presetId === 'custom') return;
    this.activeFamily().selectPreset(presetId);
    this.selectedPresetId.set(presetId);
    this.refreshControls();
  }

  selectMotion(motionId: string): void {
    this.activeFamily().setMotion(motionId);
    this.selectedMotionId.set(motionId);
  }

  selectExpression(expression: ExtendedEmotionName): void {
    this.activeFamily().setExpression(expression);
    this.selectedExpression.set(expression);
  }

  setControl(controlId: string, value: string): void {
    this.activeFamily().setControl(controlId, value);
    this.selectedPresetId.set('custom');
    this.refreshControls();
  }

  randomize(): void {
    this.activeFamily().randomize(this.variantSeed++);
    this.selectedPresetId.set('custom');
    this.refreshControls();
  }

  resetCharacter(): void {
    const family = this.activeFamily();
    family.selectPreset(family.defaultPresetId);
    family.setMotion(family.id === 'cat' ? 'goofy_walk' : 'idle');
    family.setExpression('happy');
    this.selectedPresetId.set(family.defaultPresetId);
    this.selectedMotionId.set(family.id === 'cat' ? 'goofy_walk' : 'idle');
    this.selectedExpression.set('happy');
    this.refreshControls();
  }

  setAutoRotate(): void {
    this.autoRotate.update((value) => !value);
  }

  applyView(view: CharacterStudioView): void {
    const family = this.activeFamily();
    const centerY = family.cameraTargetY;
    const faceY = family.faceTargetY;
    this.activeView.set(view);

    switch (view) {
      case 'front':
        this.cameraTarget.set([0, centerY, 0]);
        this.cameraPosition.set([0, centerY + 0.7, this.cameraDistance(3.7)]);
        break;
      case 'profile':
        this.cameraTarget.set([0, centerY, 0]);
        this.cameraPosition.set([this.cameraDistance(3.8), centerY + 0.62, 0.12]);
        break;
      case 'face':
        this.cameraTarget.set([0, faceY, 0]);
        this.cameraPosition.set([0.3, faceY + 0.2, this.cameraDistance(1.7)]);
        break;
      case 'three-quarter':
      default:
        this.cameraTarget.set([0, centerY, 0]);
        this.cameraPosition.set([this.cameraDistance(2.5), centerY + 0.68, this.cameraDistance(3.1)]);
        break;
    }
  }

  private cameraDistance(humanDistance: number): number {
    return this.activeFamily().id === 'human' ? humanDistance : humanDistance * 0.72;
  }

  private syncFamilyVisibility(): void {
    const activeId = this.selectedFamilyId();
    for (const family of this.familyOptions) {
      family.root.visible = family.id === activeId;
    }
  }

  private refreshControls(): void {
    this.controlsRevision.update((value) => value + 1);
  }

  private update(deltaSeconds: number): void {
    this.activeFamily().update(deltaSeconds);
    if (!this.autoRotate()) return;
    this.elapsedSeconds += deltaSeconds;
    this.activeFamily().root.rotation.y = Math.sin(this.elapsedSeconds * 0.32) * 0.48;
  }
}
