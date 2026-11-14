import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Color, Mesh, MeshStandardMaterial, PlaneGeometry, TorusGeometry, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { preProcessText, wordsToVisemes, type ExtendedEmotionName, type VisemeKeyframe } from 'triangular-engine/characters';
import { CapsuleCharacterActor } from 'triangular-engine/procedural';
import { readTranscript, replayPositions, replayState, type ReplayTranscript } from './conversation-replay';

/** One debrief participant seated in the circle. */
export interface DebriefSpeaker {
  readonly id: string;
  readonly name: string;
  readonly stance: string;
  /**
   * How the capsule presents, matched to the speaker's voice so the face and the sound agree.
   * Omitted means "keep the seeded look".
   */
  readonly presentation?: 'feminine' | 'masculine';
}

/** Hair styles used for a feminine-presenting capsule (with eyelashes), cycled per speaker. */
const FEMININE_HAIR_STYLES = ['ponytail', 'bob_cut', 'pigtails', 'space_buns'] as const;

/** Hair styles used for a masculine-presenting capsule, cycled per speaker. */
const MASCULINE_HAIR_STYLES = ['swept', 'spiky', 'receding', 'mullet'] as const;

/** Controls the page exposes on `window.__debrief` for a video recipe. */
export interface DebriefControls {
  init(speakers: readonly DebriefSpeaker[]): void;
  speak(id: string, to: string, envelope: readonly number[], envelopeFps: number, text: string): void;
  idle(): void;
  readonly ready: boolean;
}

interface Seat {
  readonly speaker: DebriefSpeaker;
  readonly actor: CapsuleCharacterActor;
  readonly ring: Mesh;
  readonly label: HTMLElement;
  readonly angle: number;
}

const CIRCLE_RADIUS_M = 3.0;
const SPEAKER_SCALE = 1.07;
const TURN_RATE_PER_S = 7;
const CAMERA_FOLLOW_RATE_PER_S = 3.2;
const SHOT_BLEND = 0.92;
const SHOT_DISTANCE_M = 4.3;
const SHOT_HEIGHT_M = 1.7;
const SHOT_TARGET_HEIGHT_M = 1.0;
const SPEAKER_CAMERA_FACING_SHARE = 0.92;
const SPEECH_ACTIVE_THRESHOLD = 0.04;
const SPEECH_GAP_MERGE_S = 0.12;
const EXPRESSION_BLEND_S = 0.2;
const HOP_HEIGHT_M = 0.07;
const HOP_RATE_RAD_PER_S = 22;

/** Expression a spoken cue such as `[sigh]` produces; `hold` of 0 keeps it to the end of the line. */
interface CueExpression {
  readonly emotion: ExtendedEmotionName;
  readonly intensity: number;
  readonly holdSeconds: number;
  readonly hop: boolean;
}

const CUE_EXPRESSIONS: Readonly<Record<string, CueExpression>> = {
  laugh: { emotion: 'happy', intensity: 1, holdSeconds: 1.3, hop: true },
  chuckle: { emotion: 'happy', intensity: 0.8, holdSeconds: 1, hop: true },
  sigh: { emotion: 'sad', intensity: 0.6, holdSeconds: 1.3, hop: false },
  firmly: { emotion: 'angry', intensity: 0.35, holdSeconds: 0, hop: false },
  skeptical: { emotion: 'skeptical', intensity: 0.85, holdSeconds: 0, hop: false },
};

interface ScheduledCue {
  readonly atSeconds: number;
  readonly cue: CueExpression;
}
const LABEL_HEIGHT_M = 2.05;
const LABEL_ACTIVE_BORDER = '#ffd48c';
const LABEL_IDLE_BORDER = '#56626b';
const ACTIVE_RING_COLOR = '#ffd48c';
const IDLE_RING_COLOR = '#56626b';
const BACKGROUND_COLOR = '#141a22';
const CAMERA_POSITION: [number, number, number] = [0, 4.4, 8.4];
const CAMERA_TARGET: [number, number, number] = [0, 0.8, 0];

/**
 * Consensus debrief scene: capsule humans seated in a circle, one active speaker.
 * A video recipe drives it through `window.__debrief`; there is no user interface.
 */
@Component({
  selector: 'app-consensus-debrief-page',
  imports: [EngineModule],
  templateUrl: './consensus-debrief-page.component.html',
  styleUrl: './consensus-debrief-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class ConsensusDebriefPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly projected = new Vector3();
  private readonly shotPosition = new Vector3(...CAMERA_POSITION);
  private readonly shotTarget = new Vector3(...CAMERA_TARGET);
  private readonly desiredPosition = new Vector3();
  private readonly desiredTarget = new Vector3();
  private readonly seats: Seat[] = [];
  readonly replayMode = new URLSearchParams(window.location.search).has('replay');
  readonly transcript = signal<ReplayTranscript | null>(null);
  readonly turnCount = signal(0);
  readonly error = signal('');
  private targets: [number, number][] = [];
  private replayUtterance?: SpeechSynthesisUtterance;
  private activeId?: string;
  private lookAtId?: string;
  private envelope: readonly number[] = [];
  private envelopeFps = 30;
  private speakStartedMs = 0;
  private cues: ScheduledCue[] = [];
  private cueUntilSeconds = 0;
  private hopUntilSeconds = 0;
  private readonly activeMat = new MeshStandardMaterial({ color: ACTIVE_RING_COLOR, emissive: '#7a431c' });
  private readonly idleMat = new MeshStandardMaterial({ color: IDLE_RING_COLOR });


  constructor() {
    this.engine.scene.background = new Color(BACKGROUND_COLOR);
    const ground = new Mesh(new PlaneGeometry(14, 14), new MeshStandardMaterial({ color: '#25313a', roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.035;
    this.engine.scene.add(ground);

    const controls: DebriefControls = {
      ready: true,
      init: (speakers) => this.init(speakers),
      speak: (id, to, env, fps, text) => this.speak(id, to, env, fps, text),
      idle: () => this.idle(),
    };
    (window as unknown as { __debrief: DebriefControls }).__debrief = controls;

    this.engine.tick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((dt) => this.update(dt));
    this.destroyRef.onDestroy(() => {
      this.stopReplaySpeech();
      for (const s of this.seats) {
        s.actor.dispose();
        s.label.remove();
      }
      delete (window as unknown as { __debrief?: DebriefControls }).__debrief;
    });
  }

  private init(speakers: readonly DebriefSpeaker[]): void {
    for (const s of this.seats.splice(0)) {
      s.actor.root.removeFromParent();
      s.actor.dispose();
      s.label.remove();
    }
    speakers.forEach((speaker, i) => {
      const angle = (i / speakers.length) * Math.PI * 2 + Math.PI / speakers.length;
      const actor = new CapsuleCharacterActor({ autoBlink: true });
      actor.setSeed(`consensus-${speaker.id}`);
      if (speaker.presentation) {
        const feminine = speaker.presentation === 'feminine';
        const sameSoFar = speakers.slice(0, i).filter((o) => o.presentation === speaker.presentation).length;
        const hairStyles = feminine ? FEMININE_HAIR_STYLES : MASCULINE_HAIR_STYLES;
        // No helmet and no facial hair, so the hair reads and nothing covers the speaking mouth.
        actor.setDna({
          eyelashes: feminine,
          buckTeeth: false,
          facialHairId: 'none',
          helmet: false,
          hairStyleId: hairStyles[sameSoFar % hairStyles.length],
        });
      }
      actor.root.position.set(Math.sin(angle) * CIRCLE_RADIUS_M, 0, Math.cos(angle) * CIRCLE_RADIUS_M);
      const ring = new Mesh(new TorusGeometry(0.4, 0.03, 8, 32), this.idleMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.025;
      actor.root.add(ring);
      this.engine.scene.add(actor.root);
      const label = document.createElement('div');
      label.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-100%);text-align:center;font:600 20px system-ui,sans-serif;color:#f2f5f7;background:rgba(20,26,34,.82);border:2px solid ' + LABEL_IDLE_BORDER + ';border-radius:10px;padding:5px 12px;pointer-events:none;white-space:nowrap;';
      label.innerHTML = '<div></div><div style="font:400 15px system-ui,sans-serif;color:#aab6bf;margin-top:2px"></div>';
      (label.children[0] as HTMLElement).textContent = speaker.name;
      (label.children[1] as HTMLElement).textContent = speaker.stance;
      this.host.appendChild(label);
      this.seats.push({ speaker, actor, ring, label, angle });
    });
    this.idle();
  }

  async loadTranscript(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const transcript = readTranscript(JSON.parse(await file.text()));
      this.transcript.set(transcript);
      this.turnCount.set(0);
      this.error.set('');
      this.init(transcript.participants.map(name => ({ id: name, name, stance: 'waiting' })));
      this.showTurn(0);
    } catch {
      this.error.set('Could not read this conversation file. Select a coordinator transcript JSON.');
    } finally {
      input.value = '';
    }
  }

  showTurn(count: number): void {
    const transcript = this.transcript();
    if (!transcript) return;
    const next = Math.max(0, Math.min(count, transcript.turns.length));
    this.stopReplaySpeech();
    this.turnCount.set(next);
    const state = replayState(transcript, next);
    this.targets = replayPositions(transcript.participants, state.agreements);
    this.seats.forEach(seat => {
      (seat.label.children[1] as HTMLElement).textContent = state.readiness[seat.speaker.id] ?? 'waiting';
    });
    const turn = transcript.turns[next - 1];
    this.idle();
    if (turn) this.activeId = turn.participant;
  }

  get replayDetails() {
    const transcript = this.transcript();
    return transcript ? replayState(transcript, this.turnCount()) : null;
  }

  /** Browser speech uses the engine's text-estimated visemes; timing is approximate. */
  readTurnAloud(): void {
    const turn = this.transcript()?.turns[this.turnCount() - 1];
    if (!turn?.speech || !('speechSynthesis' in window)) return;
    this.stopReplaySpeech();
    const utterance = new SpeechSynthesisUtterance(turn.speech);
    this.replayUtterance = utterance;
    utterance.onstart = () => {
      if (this.replayUtterance !== utterance) return;
      this.seats.find(seat => seat.speaker.id === turn.participant)?.actor.facialController
        .playVisemes(wordsToVisemes(preProcessText(turn.speech)));
    };
    const finish = () => {
      if (this.replayUtterance !== utterance) return;
      this.replayUtterance = undefined;
      this.seats.find(seat => seat.speaker.id === turn.participant)?.actor.facialController.stopSpeech();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }

  private stopReplaySpeech(): void {
    if (!this.replayUtterance) return;
    this.replayUtterance = undefined;
    window.speechSynthesis.cancel();
    this.stopFaces();
  }

  private speak(id: string, to: string, envelope: readonly number[], fps: number, text: string): void {
    this.stopFaces();
    this.activeId = id;
    this.lookAtId = to;
    this.envelope = envelope;
    this.envelopeFps = fps;
    this.speakStartedMs = performance.now();
    this.cueUntilSeconds = 0;
    this.hopUntilSeconds = 0;
    const seat = this.seats.find((s) => s.speaker.id === id);
    if (!seat) return;
    const plan = this.planSpeech(text, envelope, fps);
    this.cues = plan.cues;
    seat.actor.facialController.playVisemes(plan.visemes);
  }

  private idle(): void {
    this.stopFaces();
    this.activeId = undefined;
    this.lookAtId = undefined;
    this.envelope = [];
    this.cues = [];
  }

  /** Stops speech and returns every face to neutral. */
  private stopFaces(): void {
    for (const seat of this.seats) {
      seat.actor.facialController.stopSpeech();
      seat.actor.facialController.setExpression('neutral', 1, EXPRESSION_BLEND_S);
    }
  }

  /**
   * Builds the viseme track and cue schedule for one line. The estimated viseme track is
   * compressed onto the stretches of the real audio where the voice is audible, so the
   * mouth rests in the pauses.
   */
  private planSpeech(text: string, envelope: readonly number[], fps: number): { visemes: VisemeKeyframe[]; cues: ScheduledCue[] } {
    const cueMarks: { pos: number; name: string }[] = [];
    let clean = '';
    for (const part of text.split(/(\[[^\]]+\])/)) {
      const m = /^\[([^\]]+)\]$/.exec(part);
      if (m) cueMarks.push({ pos: clean.length, name: m[1].trim().toLowerCase() });
      else clean += part;
    }
    const intervals: [number, number][] = [];
    envelope.forEach((v, i) => {
      if (v < SPEECH_ACTIVE_THRESHOLD) return;
      const t0 = i / fps;
      const last = intervals[intervals.length - 1];
      if (last && t0 - last[1] <= SPEECH_GAP_MERGE_S) last[1] = t0 + 1 / fps;
      else intervals.push([t0, t0 + 1 / fps]);
    });
    const activeTotal = intervals.reduce((n, [a, b]) => n + (b - a), 0) || envelope.length / fps;
    const toReal = (activeT: number): number => {
      let rest = activeT;
      for (const [a, b] of intervals) {
        if (rest <= b - a) return a + rest;
        rest -= b - a;
      }
      return envelope.length / fps;
    };
    const base = wordsToVisemes(preProcessText(clean));
    const baseEnd = base.length ? base[base.length - 1].time + base[base.length - 1].duration : 1;
    const k = activeTotal / baseEnd;
    const visemes = base.map((kf) => {
      const start = toReal(kf.time * k);
      return { time: start, viseme: kf.viseme, duration: Math.max(0.02, toReal((kf.time + kf.duration) * k) - start) };
    });
    const cues = cueMarks
      .filter((c) => CUE_EXPRESSIONS[c.name])
      .map((c) => ({ atSeconds: toReal((c.pos / Math.max(1, clean.length)) * activeTotal), cue: CUE_EXPRESSIONS[c.name] }));
    return { visemes, cues };
  }

  /** Fires cues whose time has come and clears timed expressions when their hold ends. */
  private applyCues(active: Seat, elapsed: number): void {
    const face = active.actor.facialController;
    while (this.cues.length && this.cues[0].atSeconds <= elapsed) {
      const { cue } = this.cues.shift()!;
      face.setExpression(cue.emotion, cue.intensity, EXPRESSION_BLEND_S);
      this.cueUntilSeconds = cue.holdSeconds > 0 ? elapsed + cue.holdSeconds : Number.POSITIVE_INFINITY;
      if (cue.hop) this.hopUntilSeconds = elapsed + cue.holdSeconds;
    }
    if (this.cueUntilSeconds && elapsed > this.cueUntilSeconds) {
      face.setExpression('neutral', 1, EXPRESSION_BLEND_S);
      this.cueUntilSeconds = 0;
    }
  }

  /** Eases the camera from the wide shot toward a medium shot of the active speaker. */
  private updateCamera(dt: number, active?: Seat): void {
    if (this.replayMode) active = undefined;
    if (active) {
      const p = active.actor.root.position;
      const out = new Vector3(CAMERA_POSITION[0] - p.x, 0, CAMERA_POSITION[2] - p.z).normalize();
      this.desiredPosition
        .set(p.x + out.x * SHOT_DISTANCE_M, SHOT_HEIGHT_M, p.z + out.z * SHOT_DISTANCE_M)
        .lerp(this.projected.set(...CAMERA_POSITION), 1 - SHOT_BLEND);
      this.desiredTarget.set(p.x, SHOT_TARGET_HEIGHT_M, p.z).lerp(this.projected.set(...CAMERA_TARGET), 1 - SHOT_BLEND);
    } else {
      this.desiredPosition.set(...CAMERA_POSITION);
      this.desiredTarget.set(...CAMERA_TARGET);
    }
    const k = Math.min(1, dt * CAMERA_FOLLOW_RATE_PER_S);
    this.shotPosition.lerp(this.desiredPosition, k);
    this.shotTarget.lerp(this.desiredTarget, k);
    const cam = this.engine.camera;
    cam.position.copy(this.shotPosition);
    cam.lookAt(this.shotTarget);
    cam.updateMatrixWorld(true);
  }

  private update(dt: number): void {
    const active = this.seats.find((s) => s.speaker.id === this.activeId);
    const elapsed = (performance.now() - this.speakStartedMs) / 1000;
    if (active) this.applyCues(active, elapsed);
    this.updateCamera(dt, active);
    for (const [index, seat] of this.seats.entries()) {
      const destination = this.replayMode ? this.targets[index] : undefined;
      if (destination) {
        const k = Math.min(1, dt * 2);
        seat.actor.root.position.x += (destination[0] - seat.actor.root.position.x) * k;
        seat.actor.root.position.z += (destination[1] - seat.actor.root.position.z) * k;
      }
      const isActive = seat === active;
      seat.ring.material = isActive ? this.activeMat : this.idleMat;
      const scale = seat.actor.root.scale.x + ((isActive ? SPEAKER_SCALE : 1) - seat.actor.root.scale.x) * Math.min(1, dt * 8);
      seat.actor.root.scale.setScalar(scale);
      const target = isActive
        ? this.seats.find((s) => s.speaker.id === this.lookAtId) ?? undefined
        : active;
      const from = seat.actor.root.position;
      const to = target?.actor.root.position;
      let desired = to ? Math.atan2(to.x - from.x, to.z - from.z) : Math.atan2(-from.x, -from.z);
      if (isActive || this.replayMode) {
        const toCamera = Math.atan2(this.shotPosition.x - from.x, this.shotPosition.z - from.z);
        const away = Math.atan2(Math.sin(desired - toCamera), Math.cos(desired - toCamera));
        desired = toCamera + away * (this.replayMode ? 0.5 : 1 - SPEAKER_CAMERA_FACING_SHARE);
      }
      let delta = desired - seat.actor.root.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      seat.actor.root.rotation.y += delta * Math.min(1, dt * TURN_RATE_PER_S);
      seat.actor.root.position.y = isActive && elapsed < this.hopUntilSeconds ? Math.abs(Math.sin(elapsed * HOP_RATE_RAD_PER_S)) * HOP_HEIGHT_M : 0;
      seat.actor.update(dt);
      this.projected.set(seat.actor.root.position.x, LABEL_HEIGHT_M * scale, seat.actor.root.position.z).project(this.engine.camera);
      seat.label.style.left = `${((this.projected.x + 1) / 2) * this.host.clientWidth}px`;
      seat.label.style.top = `${((1 - this.projected.y) / 2) * this.host.clientHeight}px`;
      seat.label.style.borderColor = isActive ? LABEL_ACTIVE_BORDER : LABEL_IDLE_BORDER;
    }
  }
}
