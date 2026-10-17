---
type: Runbook
title: Procedural Creature Animation
description: Findings, decisions and motion-quality evidence for procedural creature and stylized character animation.
timestamp: 2026-10-17T00:00:00Z
tags: [animation, procedural, creatures, characters, ik, skinning, metaballs, agents, testing]
plans: [/docs/plans/052_procedural_creature_animation.md]
---

# Runbook 052: Procedural Creature Animation

Plan: [Plan 052](/docs/plans/052_procedural_creature_animation.md).

## 2026-10-17 — Plan written (cloud session, code reading only)

Nothing was built, run or measured.

- **Owner's ask:** animation (rigging, moving arms and legs) for games built on the engine, without the owner
  animating by hand and with work that AI agents can do and the owner can check by eye. Not realistic, but more
  than nothing. Candidate games:
  - a Spore-inspired game with procedural creature parts (jaws, legs, arms, tails), built from metaball bodies,
    extruded SVG parts and other procedural meshes;
  - games with stylized humans that walk around, speak and show emotion.
- **Owner's worries:** complexity growing with the number of moving parts; agents struggling with visual work
  that changes over time; earlier agent attempts at procedural humans and faces looked uncanny.
- **What exists (code reading):**
  - `characters/core`: humanoid bone names, rig, FK, `solveTwoBoneIk`, look-at with clamps, named poses,
    `FacialAnimationController` (ARKit 52, layered), visemes, affordances.
  - `characters/three`: bone visualization, `applyPoseToSkeleton`, `retargetMixamoClip`, `bindCharacterFace`.
  - `procedural/parts`: archetype → variant with sockets, a hinge joint, colliders, mass.
  - `/characters-lab` uses an `AnimationMixer` directly for a Mixamo clip picker.
- **Gaps found:**
  - `characters/core/locomotion.ts` is a sine-wave gait on joint angles. Feet are not planted, so they slide.
  - The rig is humanoid-only; there is no general skeleton graph for any leg count, tails or jaws.
  - No clip state controller: Runbook 041 feature #3 is not built.
  - Nothing measures motion quality, so an agent cannot tell good motion from bad.
  - `animals` covers populations and flocks, not body animation. The `sketch` extrude/revolve sublibrary
    (Runbook 013) is not in the tree, so SVG parts would use `SVGLoader` + `ExtrudeGeometry` for now.
- **Key reframing:** the number of joints is not the problem. Letting anyone (the owner or an agent) control
  joints directly is. Controls stay few (speed, heading, look target, mood, jaw), and IK, springs and rules set
  the joints.
- **Prior art:**
  - Spore authored animation once in a space independent of body shape and solved it on each creature at run
    time with IK (Hecker et al., *Real-time Motion Retargeting to Highly Varied User-Created Morphologies*,
    SIGGRAPH 2008).
  - David Rosen's GDC 2014 talk *An Indie Approach to Procedural Animation* (Overgrowth) shows humanoids alive from
    a few poses, springs and IK.
- **Recommendation recorded in the plan:**
  - procedural stepping IK, body follow, spring chains and look-at as the main approach for creatures;
  - skeleton-first creatures, so skin weights come from construction;
  - metaball skin meshed once in rest pose and skinned;
  - stylized assets (VRM, Mixamo, CC0 packs) plus a clip state controller for humans;
  - motion metrics and filmstrips as gate evidence;
  - a viewer/inspector lab page rather than a keyframe editor.
- **Judged too ambitious for now:** agent keyframing, realistic humans or faces, procedural human modeling,
  physics-driven or learned locomotion, auto-rigging arbitrary meshes.
- **Next:** Phase 0. Confirm the entry-point split, build the metrics and filmstrip tools, and record the
  existing sine gait as the known-bad baseline.
