# Marble Works

**Build-and-run marble puzzle · Three.js + Rapier · single-player · phone required · immersive XR required**

> Planned design, not implemented or browser-tested. `index.pseudo.mjs` is an explanatory entry point, not a playable game.

## Experience

Build a short track from a limited kit, release a marble and guide it into the goal.

## What this demonstrates

- Swept/continuous collision handling
- Static track assembly and reusable materials
- Physical testing plus authored construction constraints

## Rules and complete loop

- Build only while paused. Snap ramps, curves and funnels to a known grid; validate overlaps before committing.
- Run releases exactly one marble. Win when it settles in the goal sensor; out-of-bounds or timeout offers retry.
- Editing after a run resets the marble to its start. Do not rewind only the renderer while leaving physics advanced.

## Bounded polished release

Eight authored puzzles and a bounded free-build mode with six track pieces.

- Trajectory replay line after an attempt
- Snap preview unmistakably distinct from committed track
- Goal uses settling dwell, not one noisy overlap

No multiplayer, accounts, server simulation or generic editor is required. Start, rules/help, play/activity, pause, outcome/goal feedback and retry must all be complete. Settings include volume/mute, reduced motion, contrast and game-specific options where meaningful. State changes occur in the game model; animations illustrate them.

## Rive inside this app

Animated start gate and goal sign; visual parts never substitute for physical collider geometry. The requested asset is `marble-gate.riv`; it is **not included**. See [RIVE.md](RIVE.md) for the authoring/integration contract. A placeholder or unrelated animated logo does not satisfy this requirement.

## Save behavior

Layout plus progress; live run snapshot supported only on same pinned physics build. See [SAVE.md](SAVE.md). Loading starts paused; resume is explicit. Entering/exiting XR preserves the live current state even when exported saves are checkpoints.

## Build sequence

Implement the rule loop in [gameplay.pseudo.txt](gameplay.pseudo.txt); bind the exact app lifecycle from [index.pseudo.mjs](index.pseudo.mjs); complete [CONTROLS.md](CONTROLS.md); author/integrate [RIVE.md](RIVE.md); then satisfy [ACCEPTANCE.md](ACCEPTANCE.md). The full XR flow and game-specific presentation are in [XR.md](XR.md).

Target wave: **2**. Integrator first reads [AGENTS.md](../../AGENTS.md); do not guess host APIs from symbolic helper names.

Use original/licensed artwork and audio. Keep the scope small enough to polish; expand content only after the release gates pass.
