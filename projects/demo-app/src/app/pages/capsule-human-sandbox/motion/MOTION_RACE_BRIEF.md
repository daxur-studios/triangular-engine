# Capsule Human Motion Race Brief (Walk v1)

**TL;DR.** Build a swappable `LocomotionPlugin` for the approved **Orange Pigtails** rig (`?character=orange-pigtails`) so we can test and compare competing walks in `/capsule-human-sandbox` side by side with the same start, course, speed cap, and cameras.

---

## 1. What you read and what you add

Read only these files first:
1. [capsule-motion-types.ts](./capsule-motion-types.ts) — `CapsuleHumanPose`, `LocomotionPlugin`, `GroundSampler`, `RigMeasurements`, coordinate sign rules, and world↔local helpers.
2. [locomotion-registry.ts](./locomotion-registry.ts) — where plugins register.
3. One reference implementation (for example [procedural-stepper.plugin.ts](./procedural-stepper.plugin.ts) or [cartoon-keypose.plugin.ts](./cartoon-keypose.plugin.ts)).

Add **one new plugin file** `<your-strategy>.plugin.ts` implementing `LocomotionPlugin`, register it in `createDefaultLocomotionPlugins()` in [locomotion-registry.ts](./locomotion-registry.ts), and add it to the shared plugin loop in [pigtail-sandbox-walker.spec.ts](../pigtail-sandbox-walker.spec.ts). Do **not** edit the Orange Pigtails rig, face controller, or sandbox harness speed cap.

---

## 2. Fixed shared contract

- **Target character:** Orange Pigtails in the cream spacesuit (`experimental-pigtail-body.ts` + `experimental-pigtail-head.ts`).
- **Pose output (`CapsuleHumanPose`):** Control torso offset + `YXZ` rotation, head additive offset/rotation, 3D left/right foot offset + rotation + optional `kneeBend`, and 3D left/right hand offset + rotation + optional `elbowBend`.
- **Independent layers (automatic):** Blinking, gaze, expressions, lip-sync, and gravity-scaled pigtail bounce run automatically outside your plugin. Boot sole-clipping lift is also applied automatically by the rig.
- **Gravity & airtime:** Respond to `command.gravity` (`Earth 9.81`, `Mars 3.72`, `Moon 1.62` m/s²). Set `position.y = sampleGround(x, z).y + airHeight` (`>= sampleGround(x, z).y`) for Mars/Moon hops; the harness permits true simultaneous both-feet airtime while still preventing sunken soles (`< groundY`) or runaway height.
- **Terrain readiness:** Always query `command.sampleGround(x, z)` for foot landing elevation and root `y` instead of hardcoding `y = 0`.
- **Fairness speed cap:** The sandbox harness clamps horizontal speed to `<= command.maxSpeed` (`1.4 m/s`).

---

## 3. Automated pass gates (must pass, not the winner criteria)

Run:
```powershell
npx ng test demo-app --watch=false --browsers=ChromeHeadless --include=projects/demo-app/src/app/pages/capsule-human-sandbox/pigtail-sandbox-walker.spec.ts
```

Every plugin must pass on the shared test suite:
1. **Planted foot slip `< 1 mm`** (`< 0.001 m`) during flat contact frames (on all gravities).
2. **Zero floor clipping** (`minSoleY >= -0.003 m`) across the full walk, hops, and turns.
3. **Clear step lift** (both boots lift `> 0.07 m`).
4. **Gravity adaptation:** Earth stays grounded (`maxAirHeightM < 0.01 m`), Mars gets buoyant hop clearance (`> 0.03 m`), and Moon gets true two-foot flight (`> 0.12 m` and higher than Mars, `airborneSeconds > 0.25 s`) plus clean mid-course Moon -> Earth switching.
5. **Speed compliance** (`peakSpeedMps <= 1.44 m/s`).
6. **Clean arrival & settle** back to `walking === false`, grounded (`|y| < 1e-4`), and exact approved rest silhouette (`restBlend = 1`).
7. **Live redirect** without a full dead stop or single-frame facing snap.

---

## 4. Human eye scorecard (picks the winner)

Open `http://triangular-demo.localhost:4200/capsule-human-sandbox?character=orange-pigtails&walk=<your-id>&gravity=moon` (or toggle **Earth 1g / Mars 0.38g / Moon 0.16g** in the dock) and click **Run course**, toggling **3/4 cam** and **Side cam**:

1. **Chunky-boot weight & gravity contrast:** Earth feels brisk and grounded, Mars has a springy astronaut lope, and Moon hangs smoothly in both-feet flight with a cushioned crouch before push-off and on landing.
2. **Cute silhouette:** Expressive, charming proportions from both 3/4 and side views; torso, hips, and boots stay cohesive with zero knee/tube kinking.
3. **Smooth turns & stops:** Natural anticipation/banking on the 125° mid-walk redirect and relaxed settle at the end.
4. **Upper-body rhythm:** Relaxed arm counter-swing (and wide Moon balance spread) with bent elbows and subtle torso counter-twist.
