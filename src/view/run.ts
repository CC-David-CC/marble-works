import {SynthAudio} from '../audio/synth.js';
import {
  GRID,
  MarbleSession,
  PUZZLES,
  decodeSave,
  encodeSave,
  sessionFromSave,
  type PieceType,
  type Rotation,
} from '../model/marble.js';

interface FileContext {
  owner: string;
  valid(): boolean;
  path(value: string): string;
  name(value: string): string;
  files: {
    read(path: string): Promise<{data: Uint8Array; version: string; status?: string}>;
    write(path: string, data: Uint8Array, expected: string | null): Promise<{version: string; status?: string}>;
    stat?(path: string): Promise<{version: string; status?: string}>;
    subscribe?(callback: () => void): () => void;
  };
}

export interface Host {
  signal: AbortSignal;
  w?: {
    title?: string;
    ownerSub?: string;
    launchContext?: {version: 1; storage: 'mirror'; path: string; owner: string};
    marbleWorks?: {dirty: boolean};
  };
  ui: {
    make(tag: string, className?: string, text?: string): HTMLElement;
    textButton(label: string, action: () => void): HTMLButtonElement;
    appInput(label: string, value?: string): HTMLInputElement;
    confirm?(message: string, options?: {
      title?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
      signal?: AbortSignal;
    }): Promise<boolean>;
  };
  storage: {
    signedInSubject(): string;
    mirrorFileContext(): Promise<FileContext>;
    pickFile(options: {extensions: string[]; signal?: AbortSignal}): Promise<string | null>;
    pickFolder(options: {signal?: AbortSignal}): Promise<string | null>;
  };
}

export interface ViewHandle {
  element: HTMLElement;
  dispose(): void;
}

const SIZE = 640;
const CELL = SIZE / GRID;
const KINDS: PieceType[] = ['straight', 'curve', 'funnel', 'ramp'];
const KIT_LABELS: Record<PieceType, string> = {
  straight: 'Straight',
  curve: 'Curve',
  funnel: 'Funnel',
  ramp: 'Ramp',
};

export async function startView(host: Host, signal: AbortSignal): Promise<ViewHandle> {
  const {make, textButton, appInput} = host.ui;
  const doc = document;
  const owner = host.w?.launchContext?.owner || host.storage.signedInSubject();
  const state = host.w?.marbleWorks ?? {dirty: false};
  if (host.w) {
    host.w.marbleWorks = state;
    host.w.ownerSub = owner;
  }

  let session = new MarbleSession(`marble-${crypto.randomUUID()}`, 0);
  session.paused = true;
  let selectedKind: PieceType = 'straight';
  let rotation: Rotation = 0;
  let ghost = {x: 1, y: 1};
  let disposed = false;
  let busy = false;
  let dirty = false;
  let revision = 0;
  let savedPath: string | null = null;
  let savedVersion: string | null = null;
  let watchSerial = 0;
  let unwatch = () => {};
  let frame = 0;
  let lastFrame = performance.now();
  let lastPhase = session.phase;

  const root = make('section', 'marble-view');
  const header = make('header', 'marble-header');
  const titleWrap = make('div');
  const title = make('h2', 'marble-heading', 'Marble Works');
  const subtitle = make('p', 'marble-subtitle', 'Build a short run from the available kit, then release the marble.');
  titleWrap.append(title, subtitle);
  const toolbar = make('div', 'marble-toolbar');
  const layout = make('div', 'marble-layout');
  const stage = make('div', 'marble-stage');
  const side = make('div', 'marble-side');
  const canvas = doc.createElement('canvas');
  canvas.className = 'marble-board';
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Marble Works 8 by 8 track board');
  stage.append(canvas);
  layout.append(stage, side);
  const controls = make('div', 'marble-controls');
  const status = make('div', 'app-status');
  status.setAttribute('role', 'status');
  const warning = make('div', 'marble-warning');
  warning.hidden = true;
  warning.setAttribute('role', 'status');
  const info = make('p', 'marble-info');
  const coach = make('div', 'marble-coach');
  coach.innerHTML = '<strong>Gate coach</strong><br>Development preview; final Rive gate artwork is pending.';

  const level = doc.createElement('select');
  level.setAttribute('aria-label', 'Puzzle');
  PUZZLES.forEach((puzzle, index) => level.append(new Option(`Puzzle ${index + 1}`, String(index))));
  const loadLevel = textButton('Load puzzle', () => void changeLevel());
  const runButton = textButton('Run', () => run());
  const editButton = textButton('Edit track', () => edit());
  const retryButton = textButton('Retry', () => retry());
  toolbar.append(make('label', '', 'Kit puzzle '), level, loadLevel, runButton, editButton, retryButton);
  header.append(titleWrap, toolbar);

  const pieceBar = make('div', 'marble-pieces');
  const pieceButtons = new Map<PieceType, HTMLButtonElement>();
  for (const kind of KINDS) {
    const button = textButton(KIT_LABELS[kind], () => {
      selectedKind = kind;
      refresh();
    });
    button.classList.add('marble-piece');
    button.setAttribute('aria-pressed', String(kind === selectedKind));
    pieceButtons.set(kind, button);
    pieceBar.append(button);
  }
  const rotateLeft = textButton('Rotate left', () => rotate(-1));
  const rotateRight = textButton('Rotate right', () => rotate(1));
  const place = textButton('Place ghost', () => placeAt(ghost.x, ghost.y));

  const soundLabel = make('label', '', 'Sound ');
  const sound = doc.createElement('input');
  sound.type = 'checkbox';
  sound.setAttribute('aria-label', 'Sound effects');
  soundLabel.append(sound);
  const volumeLabel = make('label', '', 'Volume ');
  const volume = doc.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.step = '5';
  volume.value = '30';
  volume.disabled = true;
  volume.setAttribute('aria-label', 'Sound volume');
  volumeLabel.append(volume);
  const contrastLabel = make('label', '', 'High contrast ');
  const contrast = doc.createElement('input');
  contrast.type = 'checkbox';
  contrast.setAttribute('aria-label', 'High contrast');
  contrastLabel.append(contrast);
  const reducedLabel = make('label', '', 'Reduce motion ');
  const reduced = doc.createElement('input');
  reduced.type = 'checkbox';
  reduced.setAttribute('aria-label', 'Reduce motion');
  reducedLabel.append(reduced);
  const settings = doc.createElement('details');
  settings.className = 'marble-settings';
  settings.append(make('summary', '', 'Settings'), contrastLabel, reducedLabel, soundLabel, volumeLabel);

  const help = doc.createElement('details');
  help.className = 'marble-help';
  help.append(
    make('summary', '', 'How to play'),
    make('p', '', 'Choose one of six kit pieces, rotate it, and select a board cell. Build only while paused. Run releases one marble. Curves turn its path, funnels aim it at the goal, and ramps accelerate through the selected cell. Reach the goal for half a second. Edit resets an active run.'),
  );

  const saveDetails = doc.createElement('details');
  saveDetails.className = 'marble-save';
  const saveFields = make('div', 'marble-save-fields');
  const path = appInput('Marble save path', host.w?.launchContext?.path || '/Marble Works.game.json');
  const chooseFolder = textButton('Choose folder', () => void chooseFolderPath());
  saveFields.append(path, chooseFolder);
  saveDetails.append(make('summary', '', 'Save location'), saveFields);
  const openButton = textButton('Open from My files', () => void open());
  const saveButton = textButton('Save to My files', () => void save());
  controls.append(pieceBar, rotateLeft, rotateRight, place, openButton, saveButton);
  side.append(coach, info, settings, help, saveDetails);
  root.append(header, layout, controls, warning, status);
  const setBusy = (value: boolean) => {
    busy = value;
    loadLevel.disabled = value;
    runButton.disabled = value || (session.phase !== 'build' && session.phase !== 'running');
    editButton.disabled = value || (session.phase === 'build' && session.paused);
    retryButton.disabled = value;
    rotateLeft.disabled = value;
    rotateRight.disabled = value;
    place.disabled = value;
    openButton.disabled = value;
    saveButton.disabled = value;
    path.disabled = value;
    chooseFolder.disabled = value;
    for (const button of pieceButtons.values()) button.disabled = value;
  };

  const audio = new SynthAudio();
  const settingsKey = 'marble-works-settings:' + owner;
  let preferences = {sound: false, volume: 30, contrast: false, reduced: false};
  try {
    const stored = JSON.parse(localStorage.getItem(settingsKey) || 'null');
    if (stored && typeof stored === 'object') {
      preferences = {
        sound: stored.sound === true,
        volume: Number.isFinite(stored.volume) ? Math.max(0, Math.min(100, stored.volume)) : 30,
        contrast: stored.contrast === true,
        reduced: stored.reduced === true,
      };
    }
  } catch {}
  sound.checked = preferences.sound;
  volume.value = String(preferences.volume);
  volume.disabled = !sound.checked;
  contrast.checked = preferences.contrast;
  reduced.checked = preferences.reduced;
  audio.setMuted(!preferences.sound);

  const valid = () => !disposed && !signal.aborted && root.isConnected && owner === host.storage.signedInSubject();
  const tell = (message: string) => {
    if (valid()) status.textContent = message;
  };
  const mark = () => {
    dirty = true;
    state.dirty = true;
    revision += 1;
  };
  const clearDirty = () => {
    dirty = false;
    state.dirty = false;
  };
  const savePreferences = () => {
    preferences = {
      sound: sound.checked,
      volume: Number(volume.value),
      contrast: contrast.checked,
      reduced: reduced.checked,
    };
    audio.setMuted(!preferences.sound);
    audio.setVolume(preferences.volume / 100);
    try {
      localStorage.setItem(settingsKey, JSON.stringify(preferences));
    } catch {}
  };

  function rotate(direction: number): void {
    rotation = ((rotation + direction + 4) % 4) as Rotation;
    if (!preferences.sound) audio.setMuted(true);
    tell(`Rotation ${rotation}.`);
    draw();
  }

  function placeAt(x: number, y: number): void {
    if (busy) return;
    if (!session.paused) {
      tell('Finish or edit the run before changing its track.');
      return;
    }
    ghost = {x, y};
    if (!session.placePiece(selectedKind, x, y, rotation)) {
      if (preferences.sound) audio.tone(120, 70, 'square');
      tell('That cell is occupied, blocked, reserved, or out of pieces.');
      draw();
      return;
    }
    mark();
    if (preferences.sound) audio.tone(310, 45, 'triangle');
    tell(`Placed ${selectedKind} at ${x + 1}, ${y + 1}.`);
    refresh();
  }

  function run(): void {
    if (busy) return;
    if (session.phase === 'running') {
      session.paused = !session.paused;
      mark();
      tell(session.paused ? 'Marble paused. Press Resume to continue.' : 'Marble running.');
      refresh();
      return;
    }
    if (session.phase !== 'build') {
      tell('Use Retry or Edit track to start another run.');
      return;
    }
    session.run();
    mark();
    if (preferences.sound) audio.unlock();
    tell('Marble released. Watch the route and goal.');
    refresh();
  }

  function edit(): void {
    if (busy) return;
    if (session.phase === 'build' && session.paused) return;
    session.edit();
    mark();
    tell('Track editing restored. The marble returned to its start.');
    refresh();
  }

  function retry(): void {
    if (busy) return;
    session.retry();
    mark();
    tell('Ready to build or run again.');
    refresh();
  }

  async function changeLevel(): Promise<void> {
    if (busy || !valid()) return;
    setBusy(true);
    const atRevision = revision;
    try {
      if (dirty && !await host.ui.confirm?.('Load another puzzle and discard unsaved changes?', {
        title: 'Unsaved Marble Works progress',
        confirmLabel: 'Load puzzle',
        cancelLabel: 'Keep current',
        danger: true,
        signal,
      })) {
        tell('Current puzzle kept.');
        return;
      }
      if (!valid()) return;
      if (revision !== atRevision) throw new Error('The track changed while confirming; try again.');
      clearWatch();
      session = new MarbleSession(`marble-${crypto.randomUUID()}`, Number(level.value));
      session.paused = true;
      lastPhase = session.phase;
      savedPath = null;
      savedVersion = null;
      rotation = 0;
      ghost = {x: session.puzzle.start.x, y: session.puzzle.start.y};
      path.value = '/Marble Works.game.json';
      if (host.w) delete host.w.launchContext;
      clearDirty();
      tell('Puzzle loaded. Build a route, then press Run.');
      refresh();
    } catch (error) {
      tell('Could not load puzzle: ' + (error instanceof Error ? error.message : 'unknown error'));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  function clearWatch(): void {
    watchSerial += 1;
    unwatch();
    unwatch = () => {};
  }

  function watch(context: FileContext, filePath: string, version: string): void {
    clearWatch();
    const serial = watchSerial;
    const check = async () => {
      if (!valid() || !context.valid() || savedPath !== filePath || savedVersion !== version) return;
      try {
        const current = context.files.stat ? await context.files.stat(filePath) : await context.files.read(filePath);
        if (serial !== watchSerial) return;
        warning.textContent = current.status === 'conflict'
          ? 'This track has conflicting copies. Resolve them in Files.'
          : current.version !== version
            ? 'The saved track changed. Your current puzzle is unchanged; save a copy or reopen it.'
            : '';
        warning.hidden = !warning.textContent;
      } catch {
        if (serial === watchSerial) {
          warning.textContent = 'The saved track is unavailable. Your current puzzle is unchanged.';
          warning.hidden = false;
        }
      }
    };
    unwatch = context.files.subscribe?.(check) || (() => {});
    queueMicrotask(check);
  }

  async function chooseFolderPath(): Promise<void> {
    try {
      const folder = await host.storage.pickFolder({signal});
      if (folder === null || !valid()) return;
      const context = await host.storage.mirrorFileContext();
      if (!valid() || !context.valid()) return;
      path.value = context.path((folder === '/' ? '' : folder) + '/' +
        context.name(path.value.split('/').pop() || 'Marble Works.game.json'));
    } catch (error) {
      tell('Could not choose folder: ' + (error instanceof Error ? error.message : 'unknown error'));
    }
  }

  async function save(): Promise<void> {
    if (busy || !valid()) return;
    const wasDirty = dirty;
    const atRevision = revision;
    const captured = session;
    captured.paused = true;
    const capturedState = encodeSave(captured);
    const requested = path.value;
    let committed = false;
    setBusy(true);
    refresh();
    dirty = true;
    state.dirty = true;
    try {
      const context = await host.storage.mirrorFileContext();
      const target = context.path(requested);
      if (!target.toLowerCase().endsWith('.game.json')) throw new Error('Use a .game.json file name.');
      let expected: string | null = null;
      try {
        const current = context.files.stat ? await context.files.stat(target) : await context.files.read(target);
        if (current.status === 'conflict') throw new Error('Resolve the conflict in Files first.');
        if (target === savedPath && savedVersion) {
          if (current.version !== savedVersion) throw new Error('The saved track changed. Save a copy or reopen it.');
        } else if (!await host.ui.confirm?.('Replace ' + target + '?', {
          title: 'Replace Marble Works track',
          confirmLabel: 'Replace',
          cancelLabel: 'Cancel',
          danger: true,
          signal,
        })) {
          tell('Save cancelled. Puzzle remains paused.');
          return;
        }
        expected = current.version;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'File not found.') throw error;
        if (target === savedPath && savedVersion) throw new Error('The saved track was removed. Save a copy or reopen it.');
      }
      if (!valid() || !context.valid()) return;
      if (session !== captured || revision !== atRevision || encodeSave(session) !== capturedState) {
        throw new Error('The track changed while saving; save the newer track separately.');
      }
      const result = await context.files.write(target, new TextEncoder().encode(capturedState), expected);
      if (!valid() || !context.valid()) return;
      savedPath = target;
      savedVersion = result.version;
      path.value = target;
      if (host.w) {
        host.w.title = target.split('/').pop() + ' — Marble Works';
        host.w.launchContext = Object.freeze({version: 1, storage: 'mirror', path: target, owner});
      }
      const newer = session !== captured || revision !== atRevision || encodeSave(session) !== capturedState;
      if (!newer) clearDirty();
      committed = true;
      watch(context, target, result.version);
      tell(result.status === 'conflict'
        ? 'Track saved on this device with conflicting copies. Resolve them in Files.'
        : newer
          ? 'Saved the earlier track; newer changes remain unsaved.'
          : 'Track saved to My files; syncing with the server.');
    } catch (error) {
      tell('Could not save track: ' + (error instanceof Error ? error.message : 'unknown error'));
    } finally {
      if (!committed && valid() && revision === atRevision) {
        dirty = wasDirty;
        state.dirty = wasDirty;
      }
      setBusy(false);
    }
  }

  async function open(selected?: string): Promise<void> {
    if (busy || !valid()) return;
    const live = session;
    live.paused = true;
    const before = encodeSave(live);
    const atRevision = revision;
    setBusy(true);
    refresh();
    try {
      if (dirty && !await host.ui.confirm?.('Open a saved track and discard current progress?', {
        title: 'Unsaved Marble Works progress',
        confirmLabel: 'Discard progress',
        cancelLabel: 'Keep current',
        danger: true,
        signal,
      })) {
        tell('Puzzle paused. Current track kept.');
        return;
      }
      if (!valid()) return;
      if (session !== live || revision !== atRevision || encodeSave(live) !== before) {
        throw new Error('The track changed while confirming; try again.');
      }
      const choice = selected || await host.storage.pickFile({extensions: ['.json'], signal});
      if (!choice || !valid()) return;
      const context = await host.storage.mirrorFileContext();
      const target = context.path(choice);
      const file = await context.files.read(target);
      if (file.status === 'conflict') throw new Error('Resolve the conflict in Files first.');
      if (file.data.byteLength > 8 * 1024 * 1024) throw new Error('Save file is too large.');
      const replacement = sessionFromSave(decodeSave(new TextDecoder('utf-8', {fatal: true}).decode(file.data)));
      replacement.paused = true;
      if (!valid() || !context.valid()) return;
      if (session !== live || revision !== atRevision || encodeSave(live) !== before) {
        throw new Error('The track changed while opening; try again.');
      }
      clearWatch();
      session = replacement;
      lastPhase = session.phase;
      level.value = String(session.puzzleId);
      savedPath = target;
      savedVersion = file.version;
      path.value = target;
      ghost = {x: session.puzzle.start.x, y: session.puzzle.start.y};
      clearDirty();
      warning.hidden = true;
      if (host.w) {
        host.w.title = target.split('/').pop() + ' — Marble Works';
        host.w.launchContext = Object.freeze({version: 1, storage: 'mirror', path: target, owner});
      }
      watch(context, target, file.version);
      tell('Track loaded and paused. Press Run to release the marble.');
      refresh();
    } catch (error) {
      tell('Could not open track: ' + (error instanceof Error ? error.message : 'unknown error'));
    } finally {
      setBusy(false);
    }
  }

  function refresh(): void {
    const remaining = session.kitRemaining;
    for (const [kind, button] of pieceButtons) {
      button.textContent = `${KIT_LABELS[kind]} ${remaining[kind]}`;
      button.disabled = remaining[kind] <= 0;
      button.setAttribute('aria-pressed', String(kind === selectedKind));
    }
    runButton.textContent = session.phase === 'running' ? (session.paused ? 'Resume' : 'Pause') : 'Run';
    runButton.setAttribute('aria-label', runButton.textContent);
    runButton.disabled = busy || (session.phase !== 'build' && session.phase !== 'running');
    editButton.disabled = busy || (session.phase === 'build' && session.paused);
    info.textContent = `${session.paused ? 'Paused' : 'Running'} · ${session.phase} · ` +
      `${session.pieces.length} pieces placed · ${session.elapsedMs.toFixed(0)} ms · ` +
      `Start ${session.puzzle.start.x + 1},${session.puzzle.start.y + 1} · ` +
      `Goal ${session.puzzle.goal.x + 1},${session.puzzle.goal.y + 1}`;
    if (session.phase === 'won') tell('Marble reached the goal.');
    else if (session.phase === 'failed') tell('The marble left the track. Press Retry or Edit track.');
    draw();
  }

  function draw(): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 4);
    const rect = canvas.getBoundingClientRect();
    const cssSize = Math.max(280, Math.floor(rect.width || canvas.clientWidth || 640));
    const targetBuffer = Math.round(cssSize * dpr);
    if (canvas.width !== targetBuffer || canvas.height !== targetBuffer) {
      canvas.width = targetBuffer;
      canvas.height = targetBuffer;
    }
    const scale = cssSize / SIZE;
    context.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    const dark = contrast.checked;
    context.fillStyle = dark ? '#071019' : '#30251b';
    context.fillRect(0, 0, SIZE, SIZE);
    context.strokeStyle = dark ? '#d7e7f5' : '#6d563d';
    context.lineWidth = 2;
    for (let index = 0; index <= GRID; index += 1) {
      const point = index * CELL;
      context.beginPath();
      context.moveTo(point, 0);
      context.lineTo(point, SIZE);
      context.stroke();
      context.beginPath();
      context.moveTo(0, point);
      context.lineTo(SIZE, point);
      context.stroke();
    }
    for (const obstacle of session.puzzle.obstacles) {
      context.fillStyle = dark ? '#6e3a3a' : '#8b2f2f';
      context.fillRect(obstacle.x * CELL + 12, obstacle.y * CELL + 12, CELL - 24, CELL - 24);
    }
    const pieceColors: Record<PieceType, string> = {
      straight: '#56b86b',
      curve: '#e0a640',
      funnel: '#df665d',
      ramp: '#639be0',
    };
    for (const piece of session.pieces) {
      context.save();
      context.translate(piece.x * CELL + CELL / 2, piece.y * CELL + CELL / 2);
      context.rotate(piece.rotation * Math.PI / 2);
      context.fillStyle = pieceColors[piece.type];
      if (piece.type === 'funnel') {
        context.beginPath();
        context.moveTo(-CELL * .36, -CELL * .28);
        context.lineTo(CELL * .36, -CELL * .28);
        context.lineTo(CELL * .12, CELL * .34);
        context.lineTo(-CELL * .12, CELL * .34);
        context.closePath();
        context.fill();
      } else if (piece.type === 'curve') {
        context.lineWidth = CELL * .16;
        context.strokeStyle = pieceColors.curve;
        context.beginPath();
        context.arc(-CELL * .28, CELL * .28, CELL * .55, -Math.PI / 2, 0);
        context.stroke();
      } else {
        context.fillRect(-CELL * .34, -CELL * .2, CELL * .68, CELL * .4);
        if (piece.type === 'ramp') {
          context.fillStyle = '#d7ebff';
          context.fillRect(-CELL * .18, -CELL * .08, CELL * .36, CELL * .16);
        }
      }
      context.restore();
    }
    if (session.paused && session.phase === 'build') {
      context.strokeStyle = '#f4e98a';
      context.lineWidth = 3;
      context.strokeRect(ghost.x * CELL + 6, ghost.y * CELL + 6, CELL - 12, CELL - 12);
    }
    if (session.visitedCells.length > 1) {
      context.strokeStyle = 'rgba(88,206,234,.7)';
      context.lineWidth = 4;
      context.beginPath();
      session.visitedCells.forEach((cell, index) => {
        const [x, y] = cell.split(',').map(Number);
        if (index === 0) context.moveTo(x * CELL + CELL / 2, y * CELL + CELL / 2);
        else context.lineTo(x * CELL + CELL / 2, y * CELL + CELL / 2);
      });
      context.stroke();
    }
    context.fillStyle = '#e9ce55';
    context.beginPath();
    context.arc(
      session.puzzle.goal.x * CELL + CELL / 2,
      session.puzzle.goal.y * CELL + CELL / 2,
      CELL * .24,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.fillStyle = '#56d3ea';
    context.beginPath();
    context.arc(
      session.marble.x * CELL + CELL / 2,
      session.marble.y * CELL + CELL / 2,
      CELL * .16,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  function cellFromPointer(event: PointerEvent): {x: number; y: number} | null {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.floor((event.clientX - rect.left) / rect.width * GRID);
    const y = Math.floor((event.clientY - rect.top) / rect.height * GRID);
    return x >= 0 && y >= 0 && x < GRID && y < GRID ? {x, y} : null;
  }

  const pointerMove = (event: PointerEvent) => {
    const cell = cellFromPointer(event);
    if (!cell || !session.paused) return;
    ghost = cell;
    draw();
  };
  const pointerDown = (event: PointerEvent) => {
    event.preventDefault();
    canvas.focus({preventScroll: true});
    const cell = cellFromPointer(event);
    if (cell) placeAt(cell.x, cell.y);
  };
  const keyboard = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key === 'arrowleft') ghost.x = Math.max(0, ghost.x - 1);
    else if (key === 'arrowright') ghost.x = Math.min(GRID - 1, ghost.x + 1);
    else if (key === 'arrowup') ghost.y = Math.max(0, ghost.y - 1);
    else if (key === 'arrowdown') ghost.y = Math.min(GRID - 1, ghost.y + 1);
    else if (key === 'q') { event.preventDefault(); if (!busy) rotate(-1); return; }
    else if (key === 'e') { event.preventDefault(); if (!busy) rotate(1); return; }
    else if (key === 'enter') { event.preventDefault(); placeAt(ghost.x, ghost.y); return; }
    else if (key === ' ' || key === 'escape') { event.preventDefault(); if (!event.repeat && (key === ' ' || session.phase === 'running')) run(); return; }
    else return;
    event.preventDefault();
    refresh();
  };
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('keydown', keyboard);

  const suspend = () => {
    if (!session.paused) {
      session.paused = true;
      mark();
      refresh();
      tell('Puzzle paused when its window lost attention.');
    }
  };
  const visibility = () => {
    if (doc.hidden) suspend();
  };
  const desktopWindow = root.closest('.window');
  const windowObserver = desktopWindow ? new MutationObserver(() => {
    if (desktopWindow.hasAttribute('hidden') || !desktopWindow.classList.contains('focused') || desktopWindow.classList.contains('rolled')) suspend();
  }) : null;
  windowObserver?.observe(desktopWindow!, {attributes: true, attributeFilter: ['class', 'hidden']});
  window.addEventListener('blur', suspend);
  doc.addEventListener('visibilitychange', visibility);

  sound.addEventListener('change', () => {
    savePreferences();
    volume.disabled = !sound.checked;
    if (sound.checked) audio.unlock();
  });
  volume.addEventListener('input', savePreferences);
  contrast.addEventListener('change', () => {
    savePreferences();
    draw();
  });
  reduced.addEventListener('change', savePreferences);

  function tick(now: number): void {
    if (disposed) return;
    const delta = Math.min(250, now - lastFrame);
    lastFrame = now;
    session.advance(delta);
    if (session.phase !== lastPhase) {
      lastPhase = session.phase;
      mark();
      if (preferences.sound) {
        if (session.phase === 'won') audio.tone(660, 180, 'triangle');
        else if (session.phase === 'failed') audio.tone(140, 180, 'sawtooth');
      }
      refresh();
    } else {
      draw();
    }
    frame = requestAnimationFrame(tick);
  }

  audio.setVolume(preferences.volume / 100);
  if (host.w?.launchContext?.storage === 'mirror' && host.w.launchContext.owner === owner) {
    const initialPath = host.w.launchContext.path;
    path.value = initialPath;
    const openWhenConnected = (attempt = 0): void => {
      if (disposed || signal.aborted) return;
      if (!root.isConnected && attempt < 60) setTimeout(() => openWhenConnected(attempt + 1), 16);
      else if (valid()) void open(initialPath);
    };
    queueMicrotask(() => openWhenConnected());
  } else {
    tell('Build a route, then press Run.');
  }
  refresh();
  const resizeObserver = new ResizeObserver(() => {
    if (!disposed) draw();
  });
  resizeObserver.observe(canvas);
  lastFrame = performance.now();
  frame = requestAnimationFrame(tick);

  return {
    element: root,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      clearWatch();
      resizeObserver.disconnect();
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('keydown', keyboard);
      windowObserver?.disconnect();
      window.removeEventListener('blur', suspend);
      doc.removeEventListener('visibilitychange', visibility);
      audio.dispose();
      root.replaceChildren();
    },
  };
}
