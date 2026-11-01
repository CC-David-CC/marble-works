# Marble Works — desktop integration

Marble Works is a deterministic build-and-run track puzzle for the Simplified
desktop. Each window owns its puzzle, track, marble, render loop, audio context,
file watcher and disposal scope.

The available implementation renders the finished rules model with a responsive
Canvas2D presentation. It provides eight puzzles, bounded kit pieces, invalid
placement protection, explicit edit/reset behavior, goal dwell, trajectory
trace, desktop keyboard/pointer controls and touch controls. Save/Open uses the
signed-in desktop's My files context and restores a validated logical snapshot
paused.

Save and Open capture their logical snapshot and destination before asynchronous
work, block track mutations while the operation is pending, and reject stale
results if the puzzle changes. Saved-file overwrites use the current version.
Losing desktop-window focus, switching workspaces, minimizing, rolling up,
leaving the browser, or hiding the page pauses an active run. The Run control changes
to Pause or Resume so phone users can continue a paused run. Toolbar actions
remain at least 40px on desktop and 44px on phone-sized layouts.

## Evidence

```sh
npm ci --prefix apps/games/02-three-physics-xr/marble-works --ignore-scripts
npm run typecheck --prefix apps/games/02-three-physics-xr/marble-works
npm test --prefix apps/games/02-three-physics-xr/marble-works
node tests/marble-works-browser.test.mjs
CODI_PHONE=1 node tests/marble-works-browser.test.mjs
node tests/marble-works-account.test.mjs
node tests/marble-works-pause-review.test.mjs
```

The model tests cover sub-stepping, atomic invalid placement, edit/reset,
one-time goal completion, exact logical save restoration, bounded content and
malformed-save rejection.

## Remaining gates

- The standalone handoff did not provide a Three.js/Rapier view despite pinning
  those dependencies. This desktop preview therefore does not claim a physical
  3D/Rapier implementation or fast-collision acceptance.
- No authored `marble-gate.riv` is available. The visible coach is explicitly a
  procedural development fallback.
- Entered WebXR, world-space controls, Galaxy XR hardware behavior, physical
  phone play and performance/thermal measurements remain unverified.
- A complete eight-puzzle playthrough matrix and authored level design review
  remain open.
