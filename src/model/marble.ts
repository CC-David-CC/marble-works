import { Rng } from "./rng.ts";

export const GRID = 8;
export const MAX_SPEED = 6; // cells per second
export const SUBSTEP_CELL = 0.25; // continuous collision sub-steps
export const GOAL_RADIUS = 0.6; // model units; never rescaled by presentation
export const GOAL_DWELL_MS = 500;
export const RUN_TIMEOUT_MS = 30_000;

export type PieceType = "straight" | "curve" | "funnel" | "ramp";
export type Rotation = 0 | 1 | 2 | 3;
export type Phase = "build" | "running" | "won" | "failed";

export interface Piece {
  id: number;
  type: PieceType;
  x: number;
  y: number;
  rotation: Rotation;
}

export interface Puzzle {
  id: number;
  start: { x: number; y: number };
  goal: { x: number; y: number };
  kit: Record<PieceType, number>;
  obstacles: { x: number; y: number }[];
}

const KIT_ONE: Record<PieceType, number> = { straight: 4, curve: 2, funnel: 1, ramp: 1 };

export const PUZZLES: readonly Puzzle[] = [
  { id: 0, start: { x: 0, y: 0 }, goal: { x: 7, y: 7 }, kit: { ...KIT_ONE }, obstacles: [] },
  { id: 1, start: { x: 0, y: 1 }, goal: { x: 7, y: 6 }, kit: { ...KIT_ONE }, obstacles: [{ x: 3, y: 3 }, { x: 4, y: 4 }] },
  { id: 2, start: { x: 0, y: 2 }, goal: { x: 7, y: 5 }, kit: { ...KIT_ONE }, obstacles: [{ x: 2, y: 2 }, { x: 5, y: 5 }] },
  { id: 3, start: { x: 1, y: 0 }, goal: { x: 6, y: 7 }, kit: { ...KIT_ONE }, obstacles: [{ x: 4, y: 2 }, { x: 3, y: 6 }] },
  { id: 4, start: { x: 0, y: 3 }, goal: { x: 7, y: 4 }, kit: { ...KIT_ONE }, obstacles: [{ x: 3, y: 3 }, { x: 4, y: 3 }] },
  { id: 5, start: { x: 1, y: 1 }, goal: { x: 6, y: 6 }, kit: { ...KIT_ONE }, obstacles: [{ x: 3, y: 4 }, { x: 4, y: 3 }] },
  { id: 6, start: { x: 0, y: 4 }, goal: { x: 7, y: 3 }, kit: { ...KIT_ONE }, obstacles: [{ x: 2, y: 3 }, { x: 5, y: 4 }] },
  { id: 7, start: { x: 2, y: 0 }, goal: { x: 5, y: 7 }, kit: { ...KIT_ONE }, obstacles: [{ x: 3, y: 3 }, { x: 4, y: 4 }] },
];

export interface MarbleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  goalDwellMs: number;
}

export interface MarbleSnapshot {
  puzzleId: number;
  phase: Phase;
  paused: boolean;
  pieces: Piece[];
  kitUsed: Record<PieceType, number>;
  marble: MarbleState;
  elapsedMs: number;
  completedAt: number | null;
  rngState: number;
  visitedCells: string[];
}

export class MarbleSession {
  readonly rng: Rng;
  puzzleId = 0;
  phase: Phase = "build";
  paused = true;
  pieces: Piece[] = [];
  kitUsed: Record<PieceType, number> = { straight: 0, curve: 0, funnel: 0, ramp: 0 };
  marble: MarbleState = { x: 0, y: 0, vx: 0, vy: 0, goalDwellMs: 0 };
  elapsedMs = 0;
  completedAt: number | null = null;
  visitedCells: string[] = [];
  private nextId = 1;

  constructor(seed: string | number = "marble-works", puzzleId = 0, snapshot?: MarbleSnapshot) {
    this.rng = new Rng(seed);
    this.puzzleId = puzzleId;
    if (snapshot !== undefined) this.applySnapshot(snapshot);
  }

  get puzzle(): Puzzle {
    return PUZZLES[this.puzzleId];
  }

  get kitRemaining(): Record<PieceType, number> {
    return {
      straight: this.puzzle.kit.straight - this.kitUsed.straight,
      curve: this.puzzle.kit.curve - this.kitUsed.curve,
      funnel: this.puzzle.kit.funnel - this.kitUsed.funnel,
      ramp: this.puzzle.kit.ramp - this.kitUsed.ramp,
    };
  }

  private atObstacle(x: number, y: number): boolean {
    return this.puzzle.obstacles.some((obstacle) => Math.hypot(x - obstacle.x, y - obstacle.y) < 0.45);
  }

  /** Build only while paused; invalid overlaps are fully atomic. */
  placePiece(type: PieceType, x: number, y: number, rotation: Rotation = 0): boolean {
    if (!this.paused || this.phase === "won" || this.phase === "failed") return false;
    const cellX = Math.round(x);
    const cellY = Math.round(y);
    if (cellX < 0 || cellY < 0 || cellX >= GRID || cellY >= GRID) return false;
    if (this.kitRemaining[type] <= 0) return false;
    if (this.atObstacle(cellX, cellY)) return false;
    if (this.pieces.some((piece) => piece.x === cellX && piece.y === cellY)) return false;
    if (Math.hypot(cellX - this.puzzle.start.x, cellY - this.puzzle.start.y) < 0.5) return false;
    if (Math.hypot(cellX - this.puzzle.goal.x, cellY - this.puzzle.goal.y) < 0.5) return false;
    this.pieces.push({ id: this.nextId++, type, x: cellX, y: cellY, rotation });
    this.kitUsed[type] += 1;
    return true;
  }

  run(): void {
    if (this.phase !== "build") return;
    const dx = this.puzzle.goal.x - this.puzzle.start.x;
    const dy = this.puzzle.goal.y - this.puzzle.start.y;
    const length = Math.hypot(dx, dy) || 1;
    this.marble = {
      x: this.puzzle.start.x,
      y: this.puzzle.start.y,
      vx: (dx / length) * MAX_SPEED,
      vy: (dy / length) * MAX_SPEED,
      goalDwellMs: 0,
    };
    this.elapsedMs = 0;
    this.visitedCells = [`${this.puzzle.start.x},${this.puzzle.start.y}`];
    this.phase = "running";
    this.paused = false;
  }

  /** Editing a run pauses and resets the marble to its start. */
  edit(): void {
    if (this.phase === "running") {
      this.marble = { ...this.marble, x: this.puzzle.start.x, y: this.puzzle.start.y, vx: 0, vy: 0, goalDwellMs: 0 };
    }
    this.phase = "build";
    this.paused = true;
  }

  advance(deltaMs: number): void {
    if (this.paused || this.phase !== "running") return;
    const step = Math.min(Math.max(0, deltaMs), 250);
    const targetElapsed = this.elapsedMs + step;
    while (this.elapsedMs < targetElapsed && this.phase === "running") {
      const dt = Math.min((SUBSTEP_CELL / MAX_SPEED) * 1000, targetElapsed - this.elapsedMs);
      this.elapsedMs += dt;
      this.marble.x += this.marble.vx * (dt / 1000);
      this.marble.y += this.marble.vy * (dt / 1000);
      const cell = `${Math.round(this.marble.x)},${Math.round(this.marble.y)}`;
      if (this.visitedCells[this.visitedCells.length - 1] !== cell) this.visitedCells.push(cell);
      const piece = this.pieces.find(
        (candidate) => candidate.x === Math.round(this.marble.x) && candidate.y === Math.round(this.marble.y),
      );
      if (piece?.type === "curve") {
        const vx = this.marble.vy;
        this.marble.vy = -this.marble.vx;
        this.marble.vx = vx;
      } else if (piece?.type === "funnel") {
        const dx = this.puzzle.goal.x - this.marble.x;
        const dy = this.puzzle.goal.y - this.marble.y;
        const length = Math.hypot(dx, dy) || 1;
        this.marble.vx = (dx / length) * MAX_SPEED;
        this.marble.vy = (dy / length) * MAX_SPEED;
      }
      if (
        this.marble.x < -0.5 ||
        this.marble.y < -0.5 ||
        this.marble.x > GRID - 0.5 ||
        this.marble.y > GRID - 0.5 ||
        this.atObstacle(this.marble.x, this.marble.y)
      ) {
        this.phase = "failed";
        this.paused = true;
        return;
      }
      if (Math.hypot(this.marble.x - this.puzzle.goal.x, this.marble.y - this.puzzle.goal.y) < GOAL_RADIUS) {
        this.marble.goalDwellMs += dt;
        if (this.marble.goalDwellMs >= GOAL_DWELL_MS) {
          this.phase = "won";
          this.completedAt = this.elapsedMs;
          this.paused = true;
          return;
        }
      } else {
        this.marble.goalDwellMs = 0;
      }
      if (this.elapsedMs >= RUN_TIMEOUT_MS) {
        this.phase = "failed";
        this.paused = true;
      }
    }
  }

  retry(): void {
    this.phase = "build";
    this.paused = true;
    this.marble = { ...this.marble, x: this.puzzle.start.x, y: this.puzzle.start.y, vx: 0, vy: 0, goalDwellMs: 0 };
    this.elapsedMs = 0;
    this.visitedCells = [];
  }

  snapshot(): MarbleSnapshot {
    return {
      puzzleId: this.puzzleId,
      phase: this.phase,
      paused: this.paused,
      pieces: this.pieces.map((piece) => ({ ...piece })),
      kitUsed: { ...this.kitUsed },
      marble: { ...this.marble },
      elapsedMs: this.elapsedMs,
      completedAt: this.completedAt,
      rngState: this.rng.getState(),
      visitedCells: [...this.visitedCells],
    };
  }

  applySnapshot(snapshot: MarbleSnapshot): void {
    this.puzzleId = snapshot.puzzleId;
    this.phase = snapshot.phase;
    this.paused = snapshot.paused;
    this.pieces = snapshot.pieces.map((piece) => ({ ...piece }));
    this.kitUsed = { ...snapshot.kitUsed };
    this.marble = { ...snapshot.marble };
    this.elapsedMs = snapshot.elapsedMs;
    this.completedAt = snapshot.completedAt;
    this.rng.setState(snapshot.rngState);
    this.visitedCells = [...snapshot.visitedCells];
  }
}

export const SAVE_FORMAT = "ksu.game.save";
export const SAVE_APP_ID = "marble-works";

export class SaveError extends Error {
  constructor(reason: string) {
    super(`marble-works save rejected: ${reason}`);
    this.name = "SaveError";
  }
}

export function encodeSave(session: MarbleSession): string {
  return JSON.stringify({
    format: SAVE_FORMAT,
    schemaVersion: 1,
    appId: SAVE_APP_ID,
    kind: "logical-snapshot",
    gameBuild: "unbound",
    contentVersion: "1",
    payload: session.snapshot(),
  });
}

export function decodeSave(text: string, maxBytes = 8 * 1024 * 1024): { payload: MarbleSnapshot } {
  if (text.length > maxBytes) throw new SaveError("document exceeds the size limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveError("document is not valid JSON");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== SAVE_FORMAT || envelope.appId !== SAVE_APP_ID || envelope.kind !== "logical-snapshot") {
    throw new SaveError("wrong envelope");
  }
  const payload = envelope.payload as MarbleSnapshot;
  if (!payload || typeof payload !== "object" || !Number.isInteger(payload.puzzleId) ||
      payload.puzzleId < 0 || payload.puzzleId >= PUZZLES.length) {
    throw new SaveError("invalid puzzle id");
  }
  if (!["build", "running", "won", "failed"].includes(payload.phase) || typeof payload.paused !== "boolean") {
    throw new SaveError("invalid phase");
  }
  if (!Array.isArray(payload.pieces) || payload.pieces.length > 64) throw new SaveError("too many pieces");
  const ids = new Set<number>(), cells = new Set<string>(), puzzle = PUZZLES[payload.puzzleId];
  for (const piece of payload.pieces) {
    if (!piece || !["straight", "curve", "funnel", "ramp"].includes(piece.type) ||
        !Number.isSafeInteger(piece.id) || piece.id < 1 || ids.has(piece.id) ||
        !Number.isInteger(piece.x) || !Number.isInteger(piece.y) ||
        piece.x < 0 || piece.x >= GRID || piece.y < 0 || piece.y >= GRID ||
        !Number.isInteger(piece.rotation) || piece.rotation < 0 || piece.rotation > 3 ||
        cells.has(`${piece.x},${piece.y}`) ||
        puzzle.obstacles.some(obstacle => obstacle.x === piece.x && obstacle.y === piece.y) ||
        (piece.x === puzzle.start.x && piece.y === puzzle.start.y) ||
        (piece.x === puzzle.goal.x && piece.y === puzzle.goal.y)) {
      throw new SaveError("invalid piece");
    }
    ids.add(piece.id);
    cells.add(`${piece.x},${piece.y}`);
  }
  const counts = {straight: 0, curve: 0, funnel: 0, ramp: 0};
  for (const piece of payload.pieces) counts[piece.type] += 1;
  if (!payload.kitUsed || typeof payload.kitUsed !== "object") throw new SaveError("invalid kit accounting");
  for (const type of ["straight", "curve", "funnel", "ramp"] as PieceType[]) {
    if (!Number.isSafeInteger(payload.kitUsed?.[type]) || payload.kitUsed[type] < 0 ||
        payload.kitUsed[type] > puzzle.kit[type] || payload.kitUsed[type] !== counts[type]) {
      throw new SaveError("invalid kit accounting");
    }
  }
  const marble = payload.marble;
  if (!marble || ![marble.x, marble.y, marble.vx, marble.vy, marble.goalDwellMs].every(Number.isFinite) ||
      marble.goalDwellMs < 0 || marble.goalDwellMs > GOAL_DWELL_MS) {
    throw new SaveError("invalid marble");
  }
  if (!Number.isFinite(payload.elapsedMs) || payload.elapsedMs < 0 ||
      payload.elapsedMs > RUN_TIMEOUT_MS ||
      !(payload.completedAt === null || (Number.isFinite(payload.completedAt) &&
        payload.completedAt >= 0 && payload.completedAt <= payload.elapsedMs)) ||
      !Number.isInteger(payload.rngState) || payload.rngState < 0 || payload.rngState > 0xffffffff ||
      !Array.isArray(payload.visitedCells) || payload.visitedCells.length > 4096 ||
      !payload.visitedCells.every(cell => typeof cell === "string" && /^\d+,\d+$/.test(cell))) {
    throw new SaveError("invalid run state");
  }
  return { payload };
}

export function sessionFromSave(envelope: { payload: MarbleSnapshot }): MarbleSession {
  return new MarbleSession("restore", envelope.payload.puzzleId, envelope.payload);
}
