import { describe, expect, it } from "./test-shim.ts";
import {
  GOAL_RADIUS,
  GRID,
  MarbleSession,
  PUZZLES,
  decodeSave,
  encodeSave,
  sessionFromSave,
} from "../src/model/marble.ts";

describe("MarbleSession rules", () => {
  it("sub-stepping prevents a fast marble from tunneling past cells", () => {
    const session = new MarbleSession("trace", 0);
    session.run();
    for (let i = 0; i < 60; i += 1) session.advance(16);
    for (let i = 1; i < session.visitedCells.length; i += 1) {
      const [x1, y1] = session.visitedCells[i - 1].split(",").map(Number);
      const [x2, y2] = session.visitedCells[i].split(",").map(Number);
      expect(Math.abs(x2 - x1) + Math.abs(y2 - y1)).toBeLessThanOrEqual(2);
    }
  });

  it("invalid overlapping placement is atomic", () => {
    const session = new MarbleSession("atomic", 0);
    expect(session.placePiece("straight", 3, 3)).toBe(true);
    const before = session.snapshot();
    expect(session.placePiece("curve", 3, 3)).toBe(false);
    expect(session.snapshot()).toEqual(before);
  });

  it("editing while running pauses and resets the marble", () => {
    const session = new MarbleSession("edit", 0);
    session.run();
    session.advance(120);
    expect(session.phase).toBe("running");
    session.edit();
    expect(session.phase).toBe("build");
    expect(session.paused).toBe(true);
    expect(session.marble.x).toBe(session.puzzle.start.x);
  });

  it("goal can only award once", () => {
    const session = new MarbleSession("goal", 0);
    session.run();
    session.advance(800);
    session.marble.x = session.puzzle.goal.x;
    session.marble.y = session.puzzle.goal.y;
    session.marble.vx = 0;
    session.marble.vy = 0;
    for (let elapsed = 0; elapsed < 600; elapsed += 250) session.advance(250);
    expect(session.phase).toBe("won");
    const completed = session.completedAt;
    session.advance(1000);
    expect(session.completedAt).toBe(completed);
  });

  it("save/load round-trips layout and run state", () => {
    const session = new MarbleSession("save", 2);
    session.placePiece("straight", 2, 2);
    session.run();
    session.advance(100);
    const restored = sessionFromSave(decodeSave(encodeSave(session)));
    expect(restored.snapshot()).toEqual(session.snapshot());
  });

  it("rejects malformed layout, accounting and run state without mutation", () => {
    const session = new MarbleSession("invalid", 1);
    session.placePiece("straight", 2, 2);
    const envelope = JSON.parse(encodeSave(session));
    for (const mutate of [
      (doc: any) => { doc.payload.pieces[0].x = 99 },
      (doc: any) => { doc.payload.kitUsed.straight = 0 },
      (doc: any) => { doc.payload.marble.x = Infinity },
      (doc: any) => { doc.payload.phase = "teleported" },
      (doc: any) => { doc.payload.visitedCells = ["bad"] },
    ]) {
      const bad = structuredClone(envelope);
      mutate(bad);
      expect(() => decodeSave(JSON.stringify(bad))).toThrow();
    }
    expect(session.pieces).toHaveLength(1);
  });

  it("model units stay fixed regardless of presentation scale", () => {
    expect(GOAL_RADIUS).toBe(0.6);
    expect(GRID).toBe(8);
    expect(PUZZLES).toHaveLength(8);
  });
});
