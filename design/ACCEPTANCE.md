> Original design reference from 2026-10-30. This describes intended behavior, not current implementation or qualification. The current app README is authoritative for status. Pseudocode and template JSON here are documentation, not build entries.

# Acceptance — Marble Works

**All runtime cases are NOT RUN.** This file is a plan; document checks are not gameplay evidence.

Apply all C01–C24 in [common acceptance](../../../../../docs/games/design-reference/ACCEPTANCE-COMMON.md). Also apply X01–X16 on the actual Galaxy XR.

## Game-specific cases

| ID | Experiment / invariant | Status |
|---|---|---|
| marble-works-G01 | Fast marble does not tunnel through track seams in qualified speed range. | not_run |
| marble-works-G02 | Invalid overlapping placement is atomic. | not_run |
| marble-works-G03 | Edit while running pauses and resets explicitly. | not_run |
| marble-works-G04 | Goal cannot award twice. | not_run |
| marble-works-G05 | Phone piece rotation works without gesture conflicts. | not_run |
| marble-works-G06 | XR scaling does not change marble gravity or goal radius in model units. | not_run |

## Release evidence

Record rules/content and dependency versions, actual asset names/hashes, desktop browser, real phone and (where required) Galaxy XR build, commands/logs, complete-playthrough result, save restoration result, multiwindow/late-disposal behavior, frame timing and unresolved defects. Exercise actual Rive properties and texture input rather than substituting an HTML mock.

A pure rules unit test, a visual smoke test and a hardware XR test are different evidence. Preserve that distinction. All promised features must be demonstrated or explicitly left incomplete; do not relabel a generic engine scene as the finished game.
