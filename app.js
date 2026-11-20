/* Application Controller, State Management, Dock, Sidebar, Persistence & Export for GROUNDWORK Studio */
(function () {
  const STORAGE_KEY = 'groundwork_studio_v1';

  const prog = window.GROUNDWORK_PROGRAM;
  const eng = window.GROUNDWORK_ENGINE;
  const site = window.GROUNDWORK_SITE;
  const catalog = prog.createCatalogSpaces();
  const catalogById = new Map(catalog.map(s => [s.id, s]));

  function cloneKeywords() {
    return prog.KEYWORDS.map(k => ({ ...k }));
  }

  function createDefaultPlane() {
    return {
      id: 'sec-A',
      name: 'A',
      cx: -2,
      cy: -22,
      angleDeg: 22,
      flipped: false,
      enabled: true,
      projDepth: 18
    };
  }

  function createDefaultState() {
    return {
      theme: 'light',
      layout: 'split',
      tool: 'select',
      dockSort: 'program',
      useGross: false,
      sidebarTab: 'selected',
      sidebarOpen: true,
      dockOpen: true,
      keywords: cloneKeywords(),
      volumes: [],
      customSpaces: [],
      selectedIds: [],
      selectedItem: null,
      planes: [createDefaultPlane()],
      activePlaneId: 'sec-A',
      dimensions: [],
      annotations: [],
      layers: {
        siteBoundary: true,
        contours: true,
        roads: true,
        waterways: true,
        buildings: true,
        plotBuildings: false,
        trees: true,
        cutFill: true,
        translucentTerrain: false,
        rectDims: true,
        annotations: true,
        snap: true
      },
      iterations: [],
      nextGroupNum: 1,
      nextZOrder: 1,
      nextCustomNum: 1
    };
  }

  let state = loadInitialState();
  let undoStack = [];
  let redoStack = [];
  let kwSearch = '';

  function normalizeVolume(v) {
    const locked = prog.isAreaLocked(v);
    const roof = eng.getRoofSpec(v);
    return {
      ...v,
      areaLocked: locked,
      freeResize: !locked,
      floors: Math.max(1, v.floors || 1),
      floorHeight: v.floorHeight || prog.DEFAULT_FLOOR_HEIGHT,
      roofType: roof.type,
      roofAngle: roof.angle,
      roofDir: roof.dir,
      roofOverhang: roof.overhang
    };
  }

  function loadInitialState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.volumes) && Array.isArray(parsed.planes)) {
          return normalizeState(parsed);
        }
      }
    } catch (_) {}
    return createDefaultState();
  }

  function normalizeState(s) {
    const def = createDefaultState();
    return {
      ...def,
      ...s,
      layers: { ...def.layers, ...(s.layers || {}) },
      keywords: Array.isArray(s.keywords) && s.keywords.length ? s.keywords : def.keywords,
      planes: Array.isArray(s.planes) && s.planes.length ? s.planes : def.planes,
      volumes: Array.isArray(s.volumes) ? s.volumes.map(normalizeVolume) : [],
      customSpaces: Array.isArray(s.customSpaces) ? s.customSpaces.map(normalizeVolume) : [],
      selectedIds: Array.isArray(s.selectedIds) ? s.selectedIds : [],
      selectedItem: s.selectedItem && s.selectedItem.kind ? s.selectedItem : null,
      dimensions: Array.isArray(s.dimensions) ? s.dimensions : [],
      annotations: Array.isArray(s.annotations) ? s.annotations : [],
      iterations: Array.isArray(s.iterations) ? s.iterations : [],
      nextCustomNum: Number.isFinite(s.nextCustomNum) ? s.nextCustomNum : 1
    };
  }

  function persistAuto() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function snapshotForUndo() {
    return JSON.stringify({
      volumes: state.volumes,
      customSpaces: state.customSpaces,
      planes: state.planes,
      activePlaneId: state.activePlaneId,
      dimensions: state.dimensions,
      annotations: state.annotations,
      keywords: state.keywords,
      selectedIds: state.selectedIds,
      selectedItem: state.selectedItem,
      nextGroupNum: state.nextGroupNum,
      nextZOrder: state.nextZOrder,
      nextCustomNum: state.nextCustomNum
    });
  }

  function pushUndo() {
    undoStack.push(snapshotForUndo());
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
  }

  function applySnapshot(jsonStr) {
    const snap = JSON.parse(jsonStr);
    Object.assign(state, snap);
    refreshAll();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshotForUndo());
    applySnapshot(undoStack.pop());
    toast('Undid last change');
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshotForUndo());
    applySnapshot(redoStack.pop());
    toast('Redid change');
  }

  function getActiveKeywordSet() {
    const set = new Set();
    for (const k of state.keywords) {
      if (k.enabled) set.add(k.id);
    }
    return set;
  }

  function getKeywordLabel(id) {
    const found = state.keywords.find(k => k.id === id);
    return found ? found.label : id;
  }

  function getVolume(id) {
    return state.volumes.find(v => v.id === id) || null;
  }

  function getActivePlane() {
    return state.planes.find(p => p.id === state.activePlaneId) || state.planes[0] || null;
  }

  function selectVolume(id, expandGroup = true) {
    const vol = getVolume(id);
    if (!vol) return;
    state.selectedItem = null;
    if (expandGroup && vol.groupId) {
      state.selectedIds = state.volumes.filter(v => v.groupId === vol.groupId).map(v => v.id);
    } else {
      state.selectedIds = [id];
    }
    refreshAll({ forceSidebar: true });
  }

  function toggleSelect(id) {
    state.selectedItem = null;
    const idx = state.selectedIds.indexOf(id);
    if (idx >= 0) state.selectedIds.splice(idx, 1);
    else state.selectedIds.push(id);
    refreshAll({ forceSidebar: true });
  }

  function setSelection(ids) {
    state.selectedItem = null;
    state.selectedIds = ids.slice();
    refreshAll({ forceSidebar: true });
  }

  function selectItem(kind, id) {
    state.selectedIds = [];
    state.selectedItem = kind && id ? { kind, id } : null;
    refreshAll({ forceSidebar: true });
  }

  function clearSelection() {
    if (state.selectedIds.length === 0 && !state.selectedItem) return;
    state.selectedIds = [];
    state.selectedItem = null;
    refreshAll({ forceSidebar: true });
  }

  function getSpaceTemplate(spaceId) {
    return catalogById.get(spaceId) || state.customSpaces.find(s => s.id === spaceId) || null;
  }

  function createVolumeFromSpace(space, x, y) {
    const floors = Math.max(1, space.floors || 1);
    const fpArea = space.area / floors;
    const w = Math.round(Math.sqrt(fpArea * (space.aspect || 1.4)) * 100) / 100;
    const d = fpArea / w;
    const gz = eng.getGroundZ(x, y);
    const locked = prog.isAreaLocked(space);
    const roof = eng.getRoofSpec(space);
    return {
      id: space.id,
      ref: space.ref,
      name: space.name,
      short: space.short,
      cat: space.cat || 'CUSTOM',
      customColor: space.customColor || null,
      isCustom: !!space.isCustom,
      area: space.area,
      areaLocked: locked,
      freeResize: !locked,
      excludeFromNetTotal: !!space.excludeFromNetTotal,
      w,
      d,
      floors,
      floorHeight: space.floorHeight || prog.DEFAULT_FLOOR_HEIGHT,
      roofType: roof.type,
      roofAngle: roof.angle,
      roofDir: roof.dir,
      roofOverhang: roof.overhang,
      rot: 0,
      x,
      y,
      zBase: Math.round(gz * 100) / 100,
      groupId: null,
      zOrder: state.nextZOrder++,
      keywords: (space.keywords || []).slice(),
      links: (space.links || []).slice(),
      separations: (space.separations || []).slice(),
      note: space.note || ''
    };
  }

  function placeSpaceAt(spaceId, x, y) {
    const existing = getVolume(spaceId);
    if (existing) {
      pushUndo();
      const oldGZ = eng.getGroundZ(existing.x, existing.y);
      const newGZ = eng.getGroundZ(x, y);
      existing.x = x;
      existing.y = y;
      existing.zBase = Math.round((newGZ + (existing.zBase - oldGZ)) * 100) / 100;
      selectVolume(existing.id, false);
      return;
    }
    const space = getSpaceTemplate(spaceId);
    if (!space) return;
    pushUndo();
    const vol = createVolumeFromSpace(space, x, y);
    state.volumes.push(vol);
    state.selectedIds = [vol.id];
    state.selectedItem = null;
    refreshAll({ forceSidebar: true });
  }

  function smartPlaceFromDock(spaceId) {
    const existing = getVolume(spaceId);
    if (existing) {
      selectVolume(existing.id, true);
      return;
    }
    const n = state.volumes.length;
    const cols = 4;
    const col = n % cols;
    const row = Math.floor(n / cols);
    const sx = -22 + col * 14;
    const sy = 10 - row * 15;
    placeSpaceAt(spaceId, sx, sy);
  }

  function syncCustomTemplateFromVolume(vol) {
    if (!vol || !vol.isCustom) return;
    const tpl = state.customSpaces.find(s => s.id === vol.id);
    if (!tpl) return;
    tpl.name = vol.name;
    tpl.short = vol.short;
    tpl.ref = vol.ref;
    tpl.note = vol.note;
    tpl.customColor = vol.customColor;
    tpl.area = vol.area;
    tpl.areaLocked = vol.areaLocked;
    tpl.freeResize = vol.freeResize;
    tpl.floors = vol.floors;
    tpl.floorHeight = vol.floorHeight;
    tpl.roofType = vol.roofType;
    tpl.roofAngle = vol.roofAngle;
    tpl.roofDir = vol.roofDir;
    tpl.roofOverhang = vol.roofOverhang;
    tpl.keywords = (vol.keywords || []).slice();
  }

  function createCustomBubble({ name, ref, note, customColor, area, areaLocked, floors, floorHeight, roofType }) {
    pushUndo();
    const num = state.nextCustomNum++;
    const cleanName = (name || '').trim() || `Custom Space ${num}`;
    const cleanRef = (ref || '').trim() || `U${num}`;
    const cleanShort = cleanName.length > 14 ? cleanName.slice(0, 13).trim() + '…' : cleanName;
    const cleanArea = Math.max(1, parseFloat(area) || 40);
    const cleanFloors = Math.max(1, Math.min(6, Math.round(parseFloat(floors) || 1)));
    const cleanFH = Math.max(1.5, Math.min(14, parseFloat(floorHeight) || prog.DEFAULT_FLOOR_HEIGHT));
    const locked = areaLocked !== false;
    const cleanRoof = ['flat', 'skillion', 'gable', 'hip'].includes(roofType) ? roofType : 'flat';
    const id = 'custom-' + Date.now() + '-' + num;

    const tpl = {
      id,
      ref: cleanRef,
      name: cleanName,
      short: cleanShort,
      cat: 'CUSTOM',
      customColor: customColor || '#8b7285',
      isCustom: true,
      area: cleanArea,
      aspect: 1.4,
      areaLocked: locked,
      freeResize: !locked,
      floors: cleanFloors,
      floorHeight: cleanFH,
      roofType: cleanRoof,
      roofAngle: 22,
      roofDir: 0,
      roofOverhang: cleanRoof === 'flat' ? 0 : 0.5,
      excludeFromNetTotal: false,
      keywords: [],
      links: [],
      separations: [],
      note: (note || '').trim()
    };
    state.customSpaces.push(tpl);

    let px = planView.cam.cx;
    let py = planView.cam.cy;
    while (state.volumes.some(v => Math.hypot(v.x - px, v.y - py) < 2.2)) {
      px += 3.5;
      py -= 2.5;
    }
    const vol = createVolumeFromSpace(tpl, px, py);
    state.volumes.push(vol);
    state.selectedIds = [vol.id];
    state.selectedItem = null;
    refreshAll({ forceSidebar: true });
    toast(`Created custom space "${cleanName}" (${cleanArea.toFixed(0)} m²)`);
    return vol;
  }

  function deleteCustomSpace(id) {
    pushUndo();
    state.volumes = state.volumes.filter(v => v.id !== id);
    state.customSpaces = state.customSpaces.filter(s => s.id !== id);
    state.selectedIds = state.selectedIds.filter(x => x !== id);
    refreshAll({ forceSidebar: true });
    toast('Deleted custom bubble');
  }

  function updateVolume(id, patch, opts = {}) {
    const vol = getVolume(id);
    if (!vol) return;
    if (!opts.silentUndo) pushUndo();
    Object.assign(vol, patch);
    if (typeof patch.areaLocked === 'boolean') {
      vol.freeResize = !patch.areaLocked;
    } else if (typeof patch.freeResize === 'boolean') {
      vol.areaLocked = !patch.freeResize;
    }
    syncCustomTemplateFromVolume(vol);
    refreshAll(opts);
  }

  function updateVolumesBatch(updates, opts = {}) {
    if (!opts.silentUndo) pushUndo();
    for (const u of updates) {
      const vol = getVolume(u.id);
      if (vol) {
        const { id, ...rest } = u;
        Object.assign(vol, rest);
        syncCustomTemplateFromVolume(vol);
      }
    }
    refreshAll(opts);
  }

  function removeVolumes(ids) {
    if (!ids.length) return;
    pushUndo();
    const drop = new Set(ids);
    state.volumes = state.volumes.filter(v => !drop.has(v.id));
    state.selectedIds = state.selectedIds.filter(id => !drop.has(id));
    refreshAll({ forceSidebar: true });
  }

  function groupSelected() {
    if (state.selectedIds.length < 2) {
      toast('Select 2 or more spaces (Shift+click or box drag) to group');
      return;
    }
    pushUndo();
    const gid = 'G' + state.nextGroupNum++;
    for (const id of state.selectedIds) {
      const v = getVolume(id);
      if (v) v.groupId = gid;
    }
    refreshAll();
    toast(`Grouped ${state.selectedIds.length} spaces (${gid})`);
  }

  function ungroupSelected() {
    if (!state.selectedIds.length) return;
    pushUndo();
    const gids = new Set();
    for (const id of state.selectedIds) {
      const v = getVolume(id);
      if (v && v.groupId) gids.add(v.groupId);
      if (v) v.groupId = null;
    }
    for (const v of state.volumes) {
      if (v.groupId && gids.has(v.groupId)) v.groupId = null;
    }
    refreshAll();
    toast('Ungrouped selection');
  }

  function findNearestOtherVolume(vol) {
    let best = null;
    let bestDist = Infinity;
    for (const other of state.volumes) {
      if (other.id === vol.id) continue;
      const d = eng.minEdgeDistanceRects(vol, other, state.useGross);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  function snapVolumeToNearest(volId, opts = {}) {
    const vol = getVolume(volId);
    if (!vol) return false;
    const B = findNearestOtherVolume(vol);
    if (!B) {
      toast('No nearby bubble to snap to');
      return false;
    }
    const rotB = B.rot || 0;
    const matchAngle = opts.matchAngle !== false;
    const newRot = matchAngle
      ? rotB + Math.round(((vol.rot || 0) - rotB) / (Math.PI * 0.5)) * (Math.PI * 0.5)
      : (vol.rot || 0);

    const cB = Math.cos(rotB), sB = Math.sin(rotB);
    const dx = vol.x - B.x, dy = vol.y - B.y;
    const rx = dx * cB + dy * sB;
    const ry = -dx * sB + dy * cB;

    const dimsA = eng.getEffectiveDims({ ...vol, rot: newRot }, state.useGross);
    const dimsB = eng.getEffectiveDims(B, state.useGross);
    const dRot = newRot - rotB;
    const ca = Math.abs(Math.cos(dRot)), sa = Math.abs(Math.sin(dRot));
    const halfAx = (dimsA.w * ca + dimsA.d * sa) * 0.5;
    const halfAy = (dimsA.w * sa + dimsA.d * ca) * 0.5;
    const halfBx = dimsB.w * 0.5;
    const halfBy = dimsB.d * 0.5;
    const abutX = halfBx + halfAx;
    const abutY = halfBy + halfAy;

    let targetRx = rx;
    let targetRy = ry;
    if (Math.abs(rx) / Math.max(1, abutX) >= Math.abs(ry) / Math.max(1, abutY)) {
      targetRx = (rx >= 0 ? 1 : -1) * abutX;
      let bestY = ry, bestDY = 3.0;
      for (const cy of [0, halfBy - halfAy, -(halfBy - halfAy)]) {
        const dist = Math.abs(ry - cy);
        if (dist < bestDY) { bestDY = dist; bestY = cy; }
      }
      targetRy = bestY;
    } else {
      targetRy = (ry >= 0 ? 1 : -1) * abutY;
      let bestX = rx, bestDX = 3.0;
      for (const cx of [0, halfBx - halfAx, -(halfBx - halfAx)]) {
        const dist = Math.abs(rx - cx);
        if (dist < bestDX) { bestDX = dist; bestX = cx; }
      }
      targetRx = bestX;
    }

    const nx = B.x + targetRx * cB - targetRy * sB;
    const ny = B.y + targetRx * sB + targetRy * cB;
    const zOffset = vol.zBase - eng.getGroundZ(vol.x, vol.y);
    const zBase = Math.round((eng.getGroundZ(nx, ny) + zOffset) * 100) / 100;
    updateVolume(vol.id, { x: nx, y: ny, rot: newRot, zBase }, { forceSidebar: true });
    toast(`Snapped ${vol.ref || vol.id} to ${B.ref || B.id}`);
    return true;
  }

  function matchNearestAngle(volId) {
    const vol = getVolume(volId);
    if (!vol) return false;
    const B = findNearestOtherVolume(vol);
    if (!B) {
      toast('No nearby bubble to match angle');
      return false;
    }
    updateVolume(vol.id, { rot: B.rot || 0 }, { forceSidebar: true });
    toast(`Matched angle to ${B.ref || B.id}`);
    return true;
  }

  function alignSelectedVolumes(mode) {
    const selVols = state.selectedIds.map(getVolume).filter(Boolean);
    if (selVols.length < 2) {
      toast('Select 2 or more bubbles to align');
      return false;
    }
    const anchor = selVols[0];
    const theta = anchor.rot || 0;
    const c = Math.cos(theta), s = Math.sin(theta);

    const items = selVols.map((v) => {
      const dx = v.x - anchor.x;
      const dy = v.y - anchor.y;
      const u = dx * c + dy * s;
      const vCoord = -dx * s + dy * c;
      const dims = eng.getEffectiveDims(v, state.useGross);
      const dRot = (v.rot || 0) - theta;
      const ca = Math.abs(Math.cos(dRot)), sa = Math.abs(Math.sin(dRot));
      const hu = (dims.w * ca + dims.d * sa) * 0.5;
      const hv = (dims.w * sa + dims.d * ca) * 0.5;
      return {
        vol: v,
        dims,
        u,
        v: vCoord,
        hu,
        hv,
        targetU: u,
        targetV: vCoord,
        targetRot: v.rot || 0,
        targetZBase: v.zBase
      };
    });

    const a0 = items[0];
    if (mode === 'left') {
      items.forEach(it => { it.targetU = -a0.hu + it.hu; });
    } else if (mode === 'center-u') {
      items.forEach(it => { it.targetU = 0; });
    } else if (mode === 'right') {
      items.forEach(it => { it.targetU = a0.hu - it.hu; });
    } else if (mode === 'top') {
      items.forEach(it => { it.targetV = a0.hv - it.hv; });
    } else if (mode === 'center-v') {
      items.forEach(it => { it.targetV = 0; });
    } else if (mode === 'bottom') {
      items.forEach(it => { it.targetV = -a0.hv + it.hv; });
    } else if (mode === 'abut-row') {
      const sorted = items.slice().sort((a, b) => a.u - b.u);
      let curU = sorted[0].u - sorted[0].dims.w * 0.5;
      for (const it of sorted) {
        it.targetRot = theta;
        it.targetV = 0;
        it.targetU = curU + it.dims.w * 0.5;
        curU += it.dims.w;
      }
    } else if (mode === 'abut-col') {
      const sorted = items.slice().sort((a, b) => b.v - a.v);
      let curV = sorted[0].v + sorted[0].dims.d * 0.5;
      for (const it of sorted) {
        it.targetRot = theta;
        it.targetU = 0;
        it.targetV = curV - it.dims.d * 0.5;
        curV -= it.dims.d;
      }
    } else if (mode === 'dist-u') {
      const sorted = items.slice().sort((a, b) => a.u - b.u);
      const u0 = sorted[0].u;
      const span = sorted[sorted.length - 1].u - u0;
      sorted.forEach((it, idx) => { it.targetU = u0 + (span * idx) / (sorted.length - 1); });
    } else if (mode === 'dist-v') {
      const sorted = items.slice().sort((a, b) => a.v - b.v);
      const v0 = sorted[0].v;
      const span = sorted[sorted.length - 1].v - v0;
      sorted.forEach((it, idx) => { it.targetV = v0 + (span * idx) / (sorted.length - 1); });
    } else if (mode === 'match-angle') {
      items.forEach(it => { it.targetRot = theta; });
    } else if (mode === 'match-z') {
      items.forEach(it => { it.targetZBase = Math.round(anchor.zBase * 100) / 100; });
    }

    const updates = items.map((it) => {
      if (mode === 'match-angle') return { id: it.vol.id, rot: it.targetRot };
      if (mode === 'match-z') return { id: it.vol.id, zBase: it.targetZBase };
      const nx = anchor.x + it.targetU * c - it.targetV * s;
      const ny = anchor.y + it.targetU * s + it.targetV * c;
      const zOffset = it.vol.zBase - eng.getGroundZ(it.vol.x, it.vol.y);
      const zBase = Math.round((eng.getGroundZ(nx, ny) + zOffset) * 100) / 100;
      return { id: it.vol.id, x: nx, y: ny, rot: it.targetRot, zBase };
    });

    updateVolumesBatch(updates, { forceSidebar: true });
    toast(`Aligned ${selVols.length} bubbles (${mode})`);
    return true;
  }

  function updateActivePlane(patch) {
    const p = getActivePlane();
    if (!p) return;
    Object.assign(p, patch);
    refreshAll();
  }

  function addDimension(view, p1, p2) {
    pushUndo();
    const dim = {
      id: 'dim-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      view,
      p1,
      p2
    };
    state.dimensions.push(dim);
    refreshAll();
    return dim;
  }

  function addSectionDimension(planeId, s1, z1, s2, z2) {
    pushUndo();
    const dim = {
      id: 'dim-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      view: 'section',
      planeId,
      s1,
      z1,
      s2,
      z2
    };
    state.dimensions.push(dim);
    refreshAll();
    return dim;
  }

  function updateDimension(id, patch, opts = {}) {
    const dim = state.dimensions.find(d => d.id === id);
    if (!dim) return;
    if (!opts.silentUndo) pushUndo();
    Object.assign(dim, patch);
    refreshAll(opts);
  }

  function deleteDimension(id) {
    pushUndo();
    state.dimensions = state.dimensions.filter(d => d.id !== id);
    if (state.selectedItem && state.selectedItem.kind === 'dim' && state.selectedItem.id === id) {
      state.selectedItem = null;
    }
    refreshAll({ forceSidebar: true });
  }

  function addAnnotation(ann) {
    pushUndo();
    state.layers.annotations = true;
    const item = {
      id: 'ann-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ...ann
    };
    state.annotations.push(item);
    state.selectedIds = [];
    state.selectedItem = { kind: item.type, id: item.id };
    refreshAll({ forceSidebar: true });
    return item;
  }

  function updateAnnotation(id, patch, opts = {}) {
    const ann = state.annotations.find(a => a.id === id);
    if (!ann) return;
    if (!opts.silentUndo) pushUndo();
    Object.assign(ann, patch);
    refreshAll(opts);
  }

  function deleteAnnotation(id) {
    pushUndo();
    state.annotations = state.annotations.filter(a => a.id !== id);
    if (state.selectedItem && state.selectedItem.id === id) {
      state.selectedItem = null;
    }
    refreshAll({ forceSidebar: true });
  }

  let activeInlineCleanup = null;
  function closeInlineTextEditor() {
    if (activeInlineCleanup) {
      activeInlineCleanup(true);
      activeInlineCleanup = null;
    }
  }

  function openInlineTextEditor({ view, planeId, clientX, clientY, worldPos, existingId, initialText }) {
    closeInlineTextEditor();
    const el = document.getElementById('inlineTextEditor');
    if (!el) return;

    const left = Math.max(8, Math.min(window.innerWidth - 200, clientX));
    const top = Math.max(8, Math.min(window.innerHeight - 40, clientY - 14));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.value = initialText || '';
    el.style.display = 'block';
    setTimeout(() => {
      el.focus();
      if (initialText) el.select();
    }, 0);

    let done = false;
    const finish = (cancelled) => {
      if (done) return;
      done = true;
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      el.style.display = 'none';
      activeInlineCleanup = null;
      const val = el.value.trim();
      if (!cancelled && val) {
        if (existingId) {
          updateAnnotation(existingId, { text: val }, { forceSidebar: true });
        } else if (view === 'section') {
          addAnnotation({
            type: 'text',
            view: 'section',
            planeId: planeId || (getActivePlane() ? getActivePlane().id : 'sec-A'),
            s: worldPos.s,
            z: worldPos.z,
            text: val,
            fontSize: 12,
            color: 'ink',
            boxed: false
          });
        } else {
          addAnnotation({
            type: 'text',
            view: 'plan',
            x: worldPos.x,
            y: worldPos.y,
            text: val,
            fontSize: 12,
            color: 'ink',
            boxed: false
          });
        }
      }
    };
    const onKey = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(false);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(true);
      }
    };
    const onBlur = () => finish(false);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
    activeInlineCleanup = finish;
  }

  function placeStarterProgram() {
    pushUndo();
    state.volumes = [];
    // Thoughtful Kotagiri slope arrangement:
    // Upper-west ridge: 5x A1 studios (grouped) + A2 Amenity
    // Upper road entry: D10 Parking, A3 Housekeeper, B1 Reception
    // Mid-slope public & knowledge core: B2 Hall, B3 Kitchen, B4 Verandah, B5 Sanitary, B6 Housekeeping, D9 Food Store, C1 Library, C2 Seedbank
    // Lower-east fertile edge: D1 Vegetable terraces, D5 Poultry, D6 Compost, D7 Water, D8 Tool store
    const gidStudios = 'G' + state.nextGroupNum++;
    const placements = [
      { id: 'A1-1', x: -34, y: 12, rot: -0.25, groupId: gidStudios },
      { id: 'A1-2', x: -31, y: 1,  rot: -0.25, groupId: gidStudios },
      { id: 'A1-3', x: -28, y: -10, rot: -0.25, groupId: gidStudios },
      { id: 'A1-4', x: -25, y: -21, rot: -0.25, groupId: gidStudios },
      { id: 'A1-5', x: -22, y: -32, rot: -0.25, groupId: gidStudios },
      { id: 'A2',   x: -17, y: -8, rot: -0.2 },

      { id: 'D10',  x: -28, y: -62, rot: 0.1 },
      { id: 'A3',   x: -14, y: -56, rot: 0.1 },
      { id: 'B1',   x: -3,  y: -52, rot: 0.1 },

      { id: 'B2',   x: 2,   y: -24, rot: 0.32 },
      { id: 'B3',   x: 19,  y: -36, rot: 0.32 },
      { id: 'D9',   x: 27,  y: -44, rot: 0.32 },
      { id: 'B4',   x: 23,  y: -20, rot: 0.32 },
      { id: 'B5',   x: 7,   y: -42, rot: 0.32 },
      { id: 'B6',   x: 16,  y: -49, rot: 0.32 },

      { id: 'C1',   x: -7,  y: 14, rot: 0.15 },
      { id: 'C2',   x: -16, y: 23, rot: 0.15 },

      { id: 'D1',   x: 27,  y: 8,  rot: 0.35 },
      { id: 'D7',   x: 12,  y: 0,  rot: 0.35 },
      { id: 'D6',   x: 34,  y: -14, rot: 0.35 },
      { id: 'D5-1', x: 39,  y: -5, rot: 0.35 },
      { id: 'D5-2', x: 43,  y: 2,  rot: 0.35 },
      { id: 'D8',   x: 22,  y: -10, rot: 0.35 }
    ];

    for (const p of placements) {
      const sp = catalogById.get(p.id);
      if (!sp) continue;
      const v = createVolumeFromSpace(sp, p.x, p.y);
      v.rot = p.rot || 0;
      v.groupId = p.groupId || null;
      if (p.id === 'B2') { v.floorHeight = 4.5; }
      state.volumes.push(v);
    }
    state.selectedIds = ['B2'];
    refreshAll();
    planView.fitSite();
    sectionView.fitSection();
    toast('Starter program placed across Kotagiri slope');
  }

  function clearBoard() {
    pushUndo();
    state.volumes = [];
    state.selectedIds = [];
    state.selectedItem = null;
    state.dimensions = [];
    state.annotations = [];
    refreshAll({ forceSidebar: true });
    toast('Board cleared');
  }

  // Instantiate Viewports
  const api = {
    getState: () => state,
    getVolume,
    getActivePlane,
    getActiveKeywordSet,
    getKeywordLabel,
    pushUndo,
    placeSpaceAt,
    selectVolume,
    toggleSelect,
    setSelection,
    selectItem,
    clearSelection,
    updateVolume,
    updateVolumesBatch,
    updateActivePlane,
    addDimension,
    addSectionDimension,
    updateDimension,
    deleteDimension,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    openInlineTextEditor,
    updateCursorReadout: (pt) => {
      const el = document.getElementById('cursorReadout');
      if (el && pt) {
        el.textContent = `X: ${pt.x.toFixed(1)} m · Y: ${pt.y.toFixed(1)} m · Z: ${pt.z.toFixed(2)} m`;
      }
    }
  };

  const planView = new window.GroundworkPlanView(document.getElementById('planCanvas'), api);
  const view3D = new window.GroundworkView3D(
    document.getElementById('view3dContainer'),
    document.getElementById('labels3dLayer'),
    api
  );
  const sectionView = new window.GroundworkSectionView(document.getElementById('sectionCanvas'), api);

  function refreshAll(opts = {}) {
    persistAuto();
    updateTopBarMetrics();
    renderProgramDock();
    renderSectionHud();
    const ae = document.activeElement;
    const editingSidebarInput = !opts.forceSidebar && ae && ae.closest && ae.closest('#sidebarBody') &&
      (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type !== 'checkbox' && ae.type !== 'radio' && ae.type !== 'color'));
    if (editingSidebarInput) {
      updateSidebarLiveValues();
    } else {
      renderSidebar();
    }
    planView.render();
    view3D.syncFromState(opts);
    sectionView.render();
  }

  function updateTopBarMetrics() {
    let placedNet = 0;
    let totalCut = 0;
    let totalFill = 0;

    for (const v of state.volumes) {
      const dims = eng.getEffectiveDims(v, state.useGross);
      if (!v.excludeFromNetTotal) {
        placedNet += v.area;
      }
      const ew = eng.computeEarthwork(v, state.useGross, 14);
      totalCut += ew.cutVol;
      totalFill += ew.fillVol;
    }

    const netTarget = prog.NET_TOTAL_TARGET;
    const netVol = totalCut - totalFill;
    document.getElementById('mPlaced').textContent = `${placedNet.toFixed(0)}/${netTarget}m²`;
    document.getElementById('mCut').textContent = `Cut ${totalCut.toFixed(0)}m³`;
    document.getElementById('mFill').textContent = `Fill ${totalFill.toFixed(0)}m³`;
    document.getElementById('mNet').textContent = `Net ${netVol >= 0 ? '+' : ''}${netVol.toFixed(0)}m³`;

    // Button active states
    document.querySelectorAll('#layoutSwitch .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.layout === state.layout);
    });
    document.querySelectorAll('#toolSwitch .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === state.tool);
    });
    document.querySelectorAll('#dockSortSwitch .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sort === state.dockSort);
    });
    document.getElementById('btnGross').classList.toggle('active', state.useGross);
    document.getElementById('btnGross').textContent = state.useGross ? 'Gross +32%' : 'Net Area';

    const vpArea = document.getElementById('viewportsArea');
    vpArea.className = `viewports-area mode-${state.layout}`;

    document.getElementById('btnToggleSidebar').classList.toggle('active', state.sidebarOpen);
    document.getElementById('sidebar').classList.toggle('hidden', !state.sidebarOpen);
    document.getElementById('programDock').classList.toggle('collapsed', !state.dockOpen);
    document.getElementById('btnShowDock').style.display = state.dockOpen ? 'none' : 'inline-block';

    const activePlane = getActivePlane();
    document.getElementById('btn3dClipToggle').classList.toggle('active', !!(activePlane && activePlane.enabled));
    document.getElementById('btn3dTranslucent').classList.toggle('active', !!state.layers.translucentTerrain);

    const snapEnabled = state.layers.snap !== false;
    const snapBtn = document.getElementById('btnToggleSnap');
    if (snapBtn) snapBtn.classList.toggle('active', snapEnabled);
    const secSnapBtn = document.getElementById('btnSecSnapToggle');
    if (secSnapBtn) secSnapBtn.classList.toggle('active', snapEnabled);
    const rectDimBtn = document.getElementById('btnToggleRectDims');
    if (rectDimBtn) rectDimBtn.classList.toggle('active', !!state.layers.rectDims);
    const planAnnBtn = document.getElementById('btnPlanAnnToggle');
    if (planAnnBtn) planAnnBtn.classList.toggle('active', !!state.layers.annotations);
    const secAnnBtn = document.getElementById('btnSecAnnToggle');
    if (secAnnBtn) secAnnBtn.classList.toggle('active', !!state.layers.annotations);

    const isDark = state.theme === 'dark';
    document.body.dataset.theme = isDark ? 'dark' : 'light';
    const themeBtn = document.getElementById('btnTheme');
    if (themeBtn) {
      themeBtn.textContent = isDark ? 'Light' : 'Dark';
      themeBtn.classList.toggle('active', isDark);
    }
  }

  function renderProgramDock() {
    const container = document.getElementById('dockChips');
    const activeKws = getActiveKeywordSet();

    const focusVol = state.selectedIds.length > 0 ? getVolume(state.selectedIds[0]) : null;
    const focusSpace = focusVol || (state.selectedIds.length ? getSpaceTemplate(state.selectedIds[0]) : null);

    const allTemplates = [...catalog, ...state.customSpaces];
    let items = allTemplates.map(sp => {
      const placed = getVolume(sp.id);
      const current = placed || sp;
      const rel = focusSpace && focusSpace.id !== sp.id
        ? prog.computeRelevance(focusSpace, current, activeKws)
        : { score: 0 };
      return { sp, placed: !!placed, current, relScore: rel.score };
    });

    if (state.dockSort === 'relevance' && focusSpace) {
      items.sort((a, b) => {
        if (a.sp.id === focusSpace.id) return -1;
        if (b.sp.id === focusSpace.id) return 1;
        return b.relScore - a.relScore || a.sp.id.localeCompare(b.sp.id);
      });
    } else if (state.dockSort === 'area') {
      items.sort((a, b) => b.current.area - a.current.area);
    }

    container.innerHTML = '';
    for (const item of items) {
      const { sp, placed, current, relScore } = item;
      const style = prog.getSpaceStyle(current);
      const isSelected = state.selectedIds.includes(sp.id);

      const chip = document.createElement('div');
      chip.className = 'space-chip' + (placed ? ' placed' : '') + (isSelected ? ' selected' : '');
      chip.draggable = true;
      const titleNote = current.note || 'Custom space';
      chip.title = `${current.name} (${current.area.toFixed(0)} m²) — ${titleNote}`;

      const relBadge = (focusSpace && focusSpace.id !== sp.id && relScore >= 0.12)
        ? `<span class="chip-rel">${Math.round(relScore * 100)}%</span>`
        : '';

      chip.innerHTML = `
        <span class="chip-dot" style="background:${style.color}"></span>
        <span class="chip-ref">${escapeHtml(current.ref || current.id)}</span>
        <span class="chip-name">${escapeHtml(current.short || sp.short)}</span>
        <span class="chip-area">${current.area.toFixed(0)}m²</span>
        ${relBadge}
      `;

      chip.addEventListener('click', () => smartPlaceFromDock(sp.id));
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', sp.id);
      });
      container.appendChild(chip);
    }
  }

  function renderSectionHud() {
    const active = getActivePlane();
    const titleEl = document.getElementById('secHudTitle');
    if (active) {
      titleEl.textContent = `Section ${active.name}–${active.name}' (${Math.round(active.angleDeg)}°)`;
    }
    const tabsEl = document.getElementById('secQuickTabs');
    tabsEl.innerHTML = '';
    for (const pl of state.planes) {
      const btn = document.createElement('button');
      btn.className = 'vp-btn' + (pl.id === state.activePlaneId ? ' active' : '');
      btn.textContent = `${pl.name}–${pl.name}'`;
      btn.addEventListener('click', () => {
        state.activePlaneId = pl.id;
        refreshAll();
        sectionView.fitSection();
      });
      tabsEl.appendChild(btn);
    }
  }

  function renderSidebar() {
    document.querySelectorAll('#sidebarTabs .tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === state.sidebarTab);
    });
    const body = document.getElementById('sidebarBody');
    body.innerHTML = '';

    if (state.sidebarTab === 'selected') renderTabSelected(body);
    else if (state.sidebarTab === 'keywords') renderTabKeywords(body);
    else if (state.sidebarTab === 'sections') renderTabSections(body);
    else renderTabIterations(body);
  }

  function updateSidebarLiveValues() {
    if (state.sidebarTab !== 'selected' || state.selectedIds.length !== 1) return;
    const vol = getVolume(state.selectedIds[0]);
    if (!vol) return;
    const ew = eng.computeEarthwork(vol, state.useGross, 14);
    const cutEl = document.getElementById('liveVolCut');
    const fillEl = document.getElementById('liveVolFill');
    const maxCEl = document.getElementById('liveMaxCut');
    const maxFEl = document.getElementById('liveMaxFill');
    if (cutEl) cutEl.textContent = `${ew.cutVol.toFixed(1)} m³`;
    if (fillEl) fillEl.textContent = `${ew.fillVol.toFixed(1)} m³`;
    if (maxCEl) maxCEl.textContent = `${ew.maxCutDepth.toFixed(2)} m`;
    if (maxFEl) maxFEl.textContent = `${ew.maxFillHeight.toFixed(2)} m`;
  }

  function renderSelectedDim(body, dim) {
    const isSec = dim.view === 'section';
    const dHoriz = isSec ? Math.abs(dim.s2 - dim.s1) : Math.hypot(dim.p2.x - dim.p1.x, dim.p2.y - dim.p1.y);
    const dz = isSec ? (dim.z2 - dim.z1) : (dim.p2.z - dim.p1.z);
    const totalDist = isSec ? Math.hypot(dHoriz, dz) : dHoriz;
    const slope = dHoriz > 0.1 ? (Math.abs(dz) / dHoriz) * 100 : 0;

    body.innerHTML = `
      <div class="panel-section">
        <div class="panel-title">
          <span>Selected Dimension (${isSec ? 'Section' : dim.view.toUpperCase()})</span>
        </div>
        <div class="earth-box">
          <div class="earth-stat"><div class="k">${isSec ? 'Section Dist' : 'Plan Dist'}</div><div class="v">${totalDist.toFixed(2)} m</div></div>
          <div class="earth-stat"><div class="k">Slope · ΔZ</div><div class="v" style="font-size:11px;">${dz >= 0 ? '+' : ''}${dz.toFixed(2)}m (${slope.toFixed(0)}%)</div></div>
        </div>
        <div class="note-box">
          Drag either circular endpoint handle on the canvas to adjust endpoints, or drag the dimension text box to reposition it.
        </div>
        <div class="row-between">
          <button class="btn" id="btnDoneItemSel" style="flex:1">Done</button>
          <button class="btn danger" id="btnDelSelectedDim">Delete</button>
        </div>
      </div>
    `;
    document.getElementById('btnDoneItemSel').addEventListener('click', clearSelection);
    document.getElementById('btnDelSelectedDim').addEventListener('click', () => deleteDimension(dim.id));
  }

  function renderSelectedLine(body, ann) {
    const caps = [
      ['none', 'None'],
      ['arrow', 'Arrow'],
      ['open-arrow', 'Open Arrow'],
      ['dot', 'Dot'],
      ['tick', 'Tick / Slash']
    ];
    const capOpts = (val) => caps.map(([k, lbl]) => `<option value="${k}" ${(val || 'none') === k ? 'selected' : ''}>${lbl}</option>`).join('');
    const currentCol = ann.color || 'ink';
    const swatches = prog.ANNOTATION_SWATCHES.map(c => {
      const bg = c === 'ink' ? 'var(--ink)' : c;
      return `<button type="button" class="swatch-btn ${currentCol === c ? 'active' : ''}" data-anncol="${c}" style="background:${bg};" title="${c}"></button>`;
    }).join('');

    body.innerHTML = `
      <div class="panel-section">
        <div class="panel-title">
          <span>Line / Arrow Annotation</span>
          <span>${ann.view === 'section' ? 'Section' : 'Plan'}</span>
        </div>
        <div class="field-grid">
          <div class="field">
            <label>Start Endpoint</label>
            <select id="selAnnStartCap">${capOpts(ann.startCap || 'none')}</select>
          </div>
          <div class="field">
            <label>End Endpoint</label>
            <select id="selAnnEndCap">${capOpts(ann.endCap || 'arrow')}</select>
          </div>
          <div class="field">
            <label>Line Style</label>
            <select id="selAnnStyle">
              <option value="solid" ${!ann.dashed ? 'selected' : ''}>Solid</option>
              <option value="dashed" ${ann.dashed ? 'selected' : ''}>Dashed</option>
            </select>
          </div>
          <div class="field">
            <label>Stroke Weight</label>
            <select id="selAnnWeight">
              <option value="1" ${(ann.strokeWidth || 1.5) === 1 ? 'selected' : ''}>Thin (1 px)</option>
              <option value="1.5" ${(ann.strokeWidth || 1.5) === 1.5 ? 'selected' : ''}>Medium (1.5 px)</option>
              <option value="2.5" ${(ann.strokeWidth || 1.5) === 2.5 ? 'selected' : ''}>Heavy (2.5 px)</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Color</label>
          <div class="swatch-row">${swatches}</div>
        </div>
        <div class="note-box">Drag either endpoint handle on the canvas to move ends, or drag the line itself.</div>
        <div class="row-between">
          <button class="btn" id="btnSwapAnnEnds" style="flex:1">Swap Ends</button>
          <button class="btn danger" id="btnDelSelectedAnn">Delete</button>
        </div>
      </div>
    `;
    document.getElementById('selAnnStartCap').addEventListener('change', (e) => {
      updateAnnotation(ann.id, { startCap: e.target.value }, { forceSidebar: true });
    });
    document.getElementById('selAnnEndCap').addEventListener('change', (e) => {
      updateAnnotation(ann.id, { endCap: e.target.value }, { forceSidebar: true });
    });
    document.getElementById('selAnnStyle').addEventListener('change', (e) => {
      updateAnnotation(ann.id, { dashed: e.target.value === 'dashed' }, { forceSidebar: true });
    });
    document.getElementById('selAnnWeight').addEventListener('change', (e) => {
      updateAnnotation(ann.id, { strokeWidth: parseFloat(e.target.value) || 1.5 }, { forceSidebar: true });
    });
    body.querySelectorAll('[data-anncol]').forEach(btn => {
      btn.addEventListener('click', () => updateAnnotation(ann.id, { color: btn.dataset.anncol }, { forceSidebar: true }));
    });
    document.getElementById('btnSwapAnnEnds').addEventListener('click', () => {
      updateAnnotation(ann.id, {
        p1: { ...ann.p2 },
        p2: { ...ann.p1 },
        startCap: ann.endCap || 'arrow',
        endCap: ann.startCap || 'none'
      }, { forceSidebar: true });
    });
    document.getElementById('btnDelSelectedAnn').addEventListener('click', () => deleteAnnotation(ann.id));
  }

  function renderSelectedText(body, ann) {
    const currentCol = ann.color || 'ink';
    const swatches = prog.ANNOTATION_SWATCHES.map(c => {
      const bg = c === 'ink' ? 'var(--ink)' : c;
      return `<button type="button" class="swatch-btn ${currentCol === c ? 'active' : ''}" data-anncol="${c}" style="background:${bg};" title="${c}"></button>`;
    }).join('');
    const fs = ann.fontSize || 12;

    body.innerHTML = `
      <div class="panel-section">
        <div class="panel-title">
          <span>Text Annotation</span>
          <span>${ann.view === 'section' ? 'Section' : 'Plan'}</span>
        </div>
        <div class="field">
          <label>Label Text</label>
          <input type="text" id="inAnnText" value="${escapeHtml(ann.text || '')}" />
        </div>
        <div class="field-grid">
          <div class="field">
            <label>Size (px)</label>
            <select id="selAnnFontSize">
              ${[10, 12, 14, 16, 20].map(sz => `<option value="${sz}" ${fs === sz ? 'selected' : ''}>${sz} px</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <label class="kw-check-row" style="border:1px solid var(--border);border-radius:4px;padding:3px 6px;background:var(--surface);">
              <span class="kw-check-left"><input type="checkbox" id="chkAnnBoxed" ${ann.boxed ? 'checked' : ''} /><span>Box Frame</span></span>
            </label>
          </div>
        </div>
        <div class="field">
          <label>Color</label>
          <div class="swatch-row">${swatches}</div>
        </div>
        <div class="note-box">Drag on canvas to move, or double-click on canvas for quick inline edit.</div>
        <div class="row-between">
          <button class="btn" id="btnDoneTextSel" style="flex:1">Done</button>
          <button class="btn danger" id="btnDelSelectedText">Delete</button>
        </div>
      </div>
    `;
    const inp = document.getElementById('inAnnText');
    let textUndoPushed = false;
    inp.addEventListener('input', (e) => {
      if (!textUndoPushed) { pushUndo(); textUndoPushed = true; }
      updateAnnotation(ann.id, { text: e.target.value }, { silentUndo: true });
    });
    inp.addEventListener('change', () => { refreshAll({ forceSidebar: true }); });
    document.getElementById('selAnnFontSize').addEventListener('change', (e) => {
      updateAnnotation(ann.id, { fontSize: parseInt(e.target.value, 10) || 12 }, { forceSidebar: true });
    });
    document.getElementById('chkAnnBoxed').addEventListener('change', (e) => {
      updateAnnotation(ann.id, { boxed: e.target.checked }, { forceSidebar: true });
    });
    body.querySelectorAll('[data-anncol]').forEach(btn => {
      btn.addEventListener('click', () => updateAnnotation(ann.id, { color: btn.dataset.anncol }, { forceSidebar: true }));
    });
    document.getElementById('btnDoneTextSel').addEventListener('click', clearSelection);
    document.getElementById('btnDelSelectedText').addEventListener('click', () => deleteAnnotation(ann.id));
  }

  function renderSelectedSectionPlane(body, plane) {
    body.innerHTML = `
      <div class="panel-section">
        <div class="panel-title">
          <span>Section Plane ${escapeHtml(plane.name)}–${escapeHtml(plane.name)}'</span>
          <span>Selected</span>
        </div>
        <label class="kw-check-row">
          <span class="kw-check-left"><input type="checkbox" id="selSecClipEnabled" ${plane.enabled ? 'checked' : ''} /><span>Enable 3D Clipping Plane</span></span>
        </label>
        <div class="field">
          <label>Angle: <span id="selSecAngleVal">${Math.round(plane.angleDeg)}°</span></label>
          <input type="range" id="selSecAngle" min="-180" max="180" step="1" value="${Math.round(plane.angleDeg)}" />
        </div>
        <div class="row-between">
          <button class="btn" id="selSecSlideBack" style="flex:1">Slide -2 m</button>
          <button class="btn" id="selSecSlideFwd" style="flex:1">Slide +2 m</button>
          <button class="btn" id="selSecFlip">Flip</button>
        </div>
        <div class="field-grid">
          <div class="field"><label>Center X (m)</label><input type="number" id="selSecCx" step="1" value="${plane.cx.toFixed(1)}" /></div>
          <div class="field"><label>Center Y (m)</label><input type="number" id="selSecCy" step="1" value="${plane.cy.toFixed(1)}" /></div>
        </div>
        <div class="field">
          <label>Projection Depth (m)</label>
          <input type="number" id="selSecDepth" step="2" min="2" max="80" value="${plane.projDepth || 18}" />
        </div>
        <div class="note-box">Drag the center handle, endpoints, or dashed line on Plan while selected. Click Done (or Esc / canvas) to send behind bubbles.</div>
        <button class="btn" id="btnDoneSectionEdit">Done Editing Section</button>
      </div>
    `;
    document.getElementById('selSecClipEnabled').addEventListener('change', (e) => {
      updateActivePlane({ enabled: e.target.checked });
    });
    document.getElementById('selSecAngle').addEventListener('input', (e) => {
      const lbl = document.getElementById('selSecAngleVal');
      if (lbl) lbl.textContent = e.target.value + '°';
      updateActivePlane({ angleDeg: parseFloat(e.target.value) });
    });
    document.getElementById('selSecSlideBack').addEventListener('click', () => {
      const b = eng.getPlaneBasis(plane);
      updateActivePlane({ cx: plane.cx - b.vx * 2, cy: plane.cy - b.vy * 2 });
    });
    document.getElementById('selSecSlideFwd').addEventListener('click', () => {
      const b = eng.getPlaneBasis(plane);
      updateActivePlane({ cx: plane.cx + b.vx * 2, cy: plane.cy + b.vy * 2 });
    });
    document.getElementById('selSecFlip').addEventListener('click', () => {
      updateActivePlane({ flipped: !plane.flipped });
    });
    document.getElementById('selSecCx').addEventListener('change', (e) => {
      updateActivePlane({ cx: parseFloat(e.target.value) || 0 });
    });
    document.getElementById('selSecCy').addEventListener('change', (e) => {
      updateActivePlane({ cy: parseFloat(e.target.value) || 0 });
    });
    document.getElementById('selSecDepth').addEventListener('change', (e) => {
      updateActivePlane({ projDepth: Math.max(2, parseFloat(e.target.value) || 18) });
    });
    document.getElementById('btnDoneSectionEdit').addEventListener('click', clearSelection);
  }

  function renderTabSelected(body) {
    if (state.selectedItem) {
      if (state.selectedItem.kind === 'dim') {
        const dim = state.dimensions.find(d => d.id === state.selectedItem.id);
        if (dim) { renderSelectedDim(body, dim); return; }
        state.selectedItem = null;
      } else if (state.selectedItem.kind === 'line') {
        const ann = state.annotations.find(a => a.id === state.selectedItem.id);
        if (ann) { renderSelectedLine(body, ann); return; }
        state.selectedItem = null;
      } else if (state.selectedItem.kind === 'text') {
        const ann = state.annotations.find(a => a.id === state.selectedItem.id);
        if (ann) { renderSelectedText(body, ann); return; }
        state.selectedItem = null;
      } else if (state.selectedItem.kind === 'section') {
        const plane = state.planes.find(p => p.id === state.selectedItem.id) || getActivePlane();
        if (plane) { renderSelectedSectionPlane(body, plane); return; }
        state.selectedItem = null;
      }
    }

    if (state.selectedIds.length === 0) {
      body.innerHTML = `
        <div class="panel-section">
          <div class="panel-title">Site &amp; Program Summary</div>
          <div class="earth-box">
            <div class="earth-stat"><div class="k">Plot Area</div><div class="v">${site.meta.siteArea.toFixed(0)} m²</div></div>
            <div class="earth-stat"><div class="k">Slope Drop</div><div class="v">${(site.meta.siteBounds.maxZ - site.meta.siteBounds.minZ).toFixed(1)} m</div></div>
            <div class="earth-stat"><div class="k">Target Net</div><div class="v">${prog.NET_TOTAL_TARGET} m²</div></div>
            <div class="earth-stat"><div class="k">Default Height</div><div class="v">${prog.DEFAULT_FLOOR_HEIGHT.toFixed(1)} m</div></div>
          </div>
          <div class="note-box">
            Click any space chip in the Program Bar above (or create a + Custom bubble) to place a space volume. Zoom in on Plan to view rectangle dimensions, or click section / dim labels to edit.
          </div>
          <div class="row-between">
            <button class="btn" id="sbStarterBtn" style="flex:1">Place Starter Program</button>
          </div>
        </div>
        <div class="panel-section">
          <div class="panel-title">Kotagiri Site Rules (Brief)</div>
          <div class="note-box">
            • Touch the slope lightly: stepped contour benching (retaining walls ≤ 1.5–2 m each) or lifted on posts.<br/>
            • Balance cut against fill on site; no spoil tipped downslope.<br/>
            • Cool &amp; wet (~15–25 °C, intense monsoons): cross-ventilate, shed water, keep Seedbank earth-sheltered &amp; dry.
          </div>
        </div>
      `;
      document.getElementById('sbStarterBtn').addEventListener('click', placeStarterProgram);
      return;
    }

    if (state.selectedIds.length > 1) {
      const selVols = state.selectedIds.map(getVolume).filter(Boolean);
      const totalArea = selVols.reduce((s, v) => s + eng.getEffectiveDims(v, state.useGross).totalArea, 0);
      let cutSum = 0, fillSum = 0;
      for (const v of selVols) {
        const ew = eng.computeEarthwork(v, state.useGross, 12);
        cutSum += ew.cutVol;
        fillSum += ew.fillVol;
      }
      const avgH = selVols.reduce((s, v) => s + (v.floorHeight || 3.0), 0) / selVols.length;
      body.innerHTML = `
        <div class="panel-section">
          <div class="panel-title">Multi-Selection (${selVols.length} spaces)</div>
          <div class="earth-box">
            <div class="earth-stat"><div class="k">Combined Area</div><div class="v">${totalArea.toFixed(0)} m²</div></div>
            <div class="earth-stat"><div class="k">Earthwork</div><div class="v" style="font-size:11px;">C ${cutSum.toFixed(0)} · F ${fillSum.toFixed(0)} m³</div></div>
          </div>
          <div class="row-between">
            <button class="btn" id="sbGrpBtn" style="flex:1">Group Selected</button>
            <button class="btn" id="sbUngrpBtn" style="flex:1">Ungroup</button>
          </div>
          <div class="field">
            <label>Align &amp; Snap Bubbles (to First Selected)</label>
            <div class="align-grid">
              <button type="button" class="btn align-btn" data-align="left" title="Align Left edges">Left</button>
              <button type="button" class="btn align-btn" data-align="center-u" title="Align Horizontal centers">Center H</button>
              <button type="button" class="btn align-btn" data-align="right" title="Align Right edges">Right</button>
              <button type="button" class="btn align-btn" data-align="top" title="Align Top edges">Top</button>
              <button type="button" class="btn align-btn" data-align="center-v" title="Align Vertical centers">Center V</button>
              <button type="button" class="btn align-btn" data-align="bottom" title="Align Bottom edges">Bottom</button>
            </div>
            <div class="align-grid-2" style="margin-top:4px;">
              <button type="button" class="btn align-btn" data-align="abut-row" title="Pack edge-to-edge along X row">Abut Row (H)</button>
              <button type="button" class="btn align-btn" data-align="abut-col" title="Pack edge-to-edge along Y column">Abut Col (V)</button>
              <button type="button" class="btn align-btn" data-align="dist-u" title="Distribute evenly horizontally">Distribute H</button>
              <button type="button" class="btn align-btn" data-align="dist-v" title="Distribute evenly vertically">Distribute V</button>
              <button type="button" class="btn align-btn" data-align="match-angle" title="Match angle of anchor bubble">Match Angle</button>
              <button type="button" class="btn align-btn" data-align="match-z" title="Match base elevation of anchor bubble">Match Base Z</button>
            </div>
          </div>
          <div class="field">
            <label>Set Floor Height for All (m)</label>
            <div class="row-between">
              <input type="number" id="sbBatchHeight" step="0.1" min="1.5" max="12" value="${avgH.toFixed(1)}" style="flex:1" />
              <button class="btn" id="sbApplyBatchHeight">Apply</button>
            </div>
          </div>
          <div class="field">
            <label>Set Roof for All</label>
            <div class="row-between">
              <select id="sbBatchRoofType" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:4px;background:var(--surface);">
                <option value="flat">Flat</option>
                <option value="skillion" selected>Skillion</option>
                <option value="gable">Gable</option>
                <option value="hip">Hip</option>
              </select>
              <input type="number" id="sbBatchRoofAngle" step="1" min="5" max="55" value="22" style="width:54px;" title="Pitch Angle (°)" />
              <button class="btn" id="sbApplyBatchRoof">Apply</button>
            </div>
          </div>
          <div class="row-between">
            <button class="btn" id="sbBatchSnapZ" style="flex:1">Snap All Z to Ground</button>
            <button class="btn danger" id="sbBatchRemove">Remove</button>
          </div>
        </div>
      `;
      document.getElementById('sbGrpBtn').addEventListener('click', groupSelected);
      document.getElementById('sbUngrpBtn').addEventListener('click', ungroupSelected);
      body.querySelectorAll('[data-align]').forEach(btn => {
        btn.addEventListener('click', () => alignSelectedVolumes(btn.dataset.align));
      });
      document.getElementById('sbApplyBatchHeight').addEventListener('click', () => {
        const val = Math.max(1.5, parseFloat(document.getElementById('sbBatchHeight').value) || 3.0);
        updateVolumesBatch(selVols.map(v => ({ id: v.id, floorHeight: val })));
      });
      document.getElementById('sbApplyBatchRoof').addEventListener('click', () => {
        const rt = document.getElementById('sbBatchRoofType').value;
        const ang = Math.max(5, Math.min(55, parseFloat(document.getElementById('sbBatchRoofAngle').value) || 22));
        updateVolumesBatch(selVols.map(v => ({
          id: v.id,
          roofType: rt,
          roofAngle: ang,
          roofOverhang: rt === 'flat' ? 0 : (v.roofOverhang > 0 ? v.roofOverhang : 0.5)
        })));
      });
      document.getElementById('sbBatchSnapZ').addEventListener('click', () => {
        updateVolumesBatch(selVols.map(v => ({ id: v.id, zBase: Math.round(eng.getGroundZ(v.x, v.y) * 100) / 100 })));
      });
      document.getElementById('sbBatchRemove').addEventListener('click', () => removeVolumes(state.selectedIds));
      return;
    }

    const vol = getVolume(state.selectedIds[0]);
    if (!vol) return;
    const dims = eng.getEffectiveDims(vol, state.useGross);
    const ew = eng.computeEarthwork(vol, state.useGross, 14);
    const style = prog.getSpaceStyle(vol);
    const locked = prog.isAreaLocked(vol);

    const sec = document.createElement('div');
    sec.className = 'panel-section';
    const customIdentityHtml = vol.isCustom ? `
      <div class="field">
        <label>Name</label>
        <input type="text" id="inCustomName" value="${escapeHtml(vol.name)}" />
      </div>
      <div class="field">
        <label>Color</label>
        <div class="row-between">
          <div class="swatch-row" id="inCustomSwatches">
            ${prog.CUSTOM_SWATCHES.map(hex => `<button type="button" class="swatch-btn ${style.color.toLowerCase() === hex ? 'active' : ''}" data-cswatch="${hex}" style="background:${hex};"></button>`).join('')}
          </div>
          <label class="color-picker-inline" title="Custom color">
            <input type="color" id="inCustomColor" value="${style.color}" />
          </label>
        </div>
      </div>
    ` : `<div style="font-weight:600;font-size:12px;">${escapeHtml(vol.name)}</div>`;

    sec.innerHTML = `
      <div class="panel-title">
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${style.color};margin-right:5px;"></span>${escapeHtml(vol.ref || vol.id)} · ${escapeHtml(vol.short)}</span>
        <span>${vol.groupId ? 'Group ' + vol.groupId : (vol.isCustom ? 'Custom' : 'Single')}</span>
      </div>
      ${customIdentityHtml}
      <div class="field-grid">
        <div class="field">
          <label>Total Area (m²)</label>
          <div class="row-between" style="gap:4px;">
            <input type="number" id="inArea" step="1" min="1" max="5000" value="${vol.area.toFixed(1)}" style="flex:1;min-width:0;" />
            <button type="button" class="lock-toggle-btn ${locked ? 'locked' : ''}" id="btnToggleAreaLock" title="Lock area to keep constant during resize">${locked ? 'Locked' : 'Flex'}</button>
          </div>
        </div>
        <div class="field">
          <label>Floors (Area Split)</label>
          <input type="number" id="inFloors" step="1" min="1" max="6" value="${dims.floors}" />
        </div>
        <div class="field">
          <label>Width W (m)</label>
          <input type="number" id="inW" step="0.1" min="0.5" value="${vol.w.toFixed(2)}" />
        </div>
        <div class="field">
          <label>Depth D (m)</label>
          <input type="number" id="inD" step="0.1" min="0.5" value="${vol.d.toFixed(2)}" />
        </div>
        <div class="field">
          <label>Floor Height (m)</label>
          <input type="number" id="inFloorH" step="0.1" min="1.5" max="14" value="${(vol.floorHeight || 3.0).toFixed(1)}" />
        </div>
        <div class="field">
          <label>Rotation (°)</label>
          <input type="number" id="inRot" step="5" min="-180" max="180" value="${Math.round((vol.rot || 0) * 180 / Math.PI)}" />
        </div>
        <div class="field">
          <label>Base Z (m MSL)</label>
          <input type="number" id="inZBase" step="0.1" value="${vol.zBase.toFixed(2)}" />
        </div>
        <div class="field">
          <label>Total Height</label>
          <input type="text" disabled value="${dims.totalHeight.toFixed(1)} m (${dims.footprintArea.toFixed(1)}m²/F)" />
        </div>
      </div>
      <div class="row-between">
        <button class="btn" id="btnSnapNearest" style="flex:1">Snap to Nearest</button>
        <button class="btn" id="btnMatchAngle" style="flex:1">Match Angle</button>
      </div>
      <div class="row-between">
        <button class="btn" id="btnSnapZ" style="flex:1">Snap Z to Slope</button>
        <button class="btn" id="btnStackOnBelow" style="flex:1">Stack Above</button>
      </div>
      <div class="row-between">
        <button class="btn subtle" id="btnZFront" style="flex:1">Bring Front</button>
        <button class="btn subtle" id="btnZBack" style="flex:1">Send Back</button>
        ${vol.groupId ? '<button class="btn subtle" id="btnUngrpOne">Ungroup</button>' : ''}
      </div>
    `;
    body.appendChild(sec);

    // Roof Panel (Flat / Skillion / Gable / Hip + Pitch Angle / Direction / Overhang)
    const roof = eng.getRoofSpec(vol);
    const roofApex = eng.getRoofApexRise(dims, roof);
    const roofPanel = document.createElement('div');
    roofPanel.className = 'panel-section';
    const roofTypes = [['flat', 'Flat'], ['skillion', 'Skillion'], ['gable', 'Gable'], ['hip', 'Hip']];
    const typeBtnsHtml = roofTypes.map(([k, lbl]) =>
      `<button type="button" class="seg-btn ${roof.type === k ? 'active' : ''}" data-rooftype="${k}" style="flex:1;">${lbl}</button>`
    ).join('');

    let dirControlsHtml = '';
    if (roof.type === 'skillion') {
      const dirs = [[0, 'Back'], [90, 'Right'], [180, 'Front'], [270, 'Left']];
      dirControlsHtml = `
        <div class="field">
          <label>Slope Down</label>
          <div class="segmented" style="display:flex;">
            ${dirs.map(([dVal, lbl]) => `<button type="button" class="seg-btn ${roof.dir === dVal ? 'active' : ''}" data-roofdir="${dVal}" style="flex:1;">${lbl}</button>`).join('')}
          </div>
        </div>
      `;
    } else if (roof.type === 'gable') {
      const axis0 = roof.dir === 0 || roof.dir === 180;
      dirControlsHtml = `
        <div class="field">
          <label>Ridge Direction</label>
          <div class="segmented" style="display:flex;">
            <button type="button" class="seg-btn ${axis0 ? 'active' : ''}" data-roofdir="0" style="flex:1;">Along W</button>
            <button type="button" class="seg-btn ${!axis0 ? 'active' : ''}" data-roofdir="90" style="flex:1;">Along D</button>
          </div>
        </div>
      `;
    }

    const pitchControlsHtml = roof.type !== 'flat' ? `
      <div class="field-grid">
        <div class="field">
          <label>Pitch Angle (°)</label>
          <input type="number" id="inRoofAngle" step="1" min="5" max="55" value="${Math.round(roof.angle)}" />
        </div>
        <div class="field">
          <label>Overhang (m)</label>
          <input type="number" id="inRoofOverhang" step="0.1" min="0" max="2.5" value="${roof.overhang.toFixed(1)}" />
        </div>
      </div>
      <div class="field">
        <div class="row-between">
          <label>Slope Pitch</label>
          <span style="font-size:10.5px;font-family:var(--mono);color:var(--ink-muted);" id="roofRiseVal">Rise +${roofApex.toFixed(1)} m</span>
        </div>
        <input type="range" id="rngRoofAngle" min="5" max="55" step="1" value="${Math.round(roof.angle)}" />
      </div>
      ${dirControlsHtml}
    ` : `
      <div class="field">
        <label>Eave Overhang (m)</label>
        <input type="number" id="inRoofOverhang" step="0.1" min="0" max="2.5" value="${roof.overhang.toFixed(1)}" />
      </div>
    `;

    roofPanel.innerHTML = `
      <div class="panel-title">
        <span>Roof Type</span>
        <span>${roof.type === 'flat' ? 'Flat' : `${Math.round(roof.angle)}° (+${roofApex.toFixed(1)}m)`}</span>
      </div>
      <div class="segmented" style="display:flex;">${typeBtnsHtml}</div>
      ${pitchControlsHtml}
    `;
    body.appendChild(roofPanel);

    roofPanel.querySelectorAll('[data-rooftype]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rt = btn.dataset.rooftype;
        const nextOv = (rt !== 'flat' && roof.type === 'flat' && roof.overhang === 0)
          ? 0.5
          : (rt === 'flat' ? 0 : roof.overhang);
        updateVolume(vol.id, { roofType: rt, roofAngle: roof.angle, roofOverhang: nextOv }, { forceSidebar: true });
      });
    });
    roofPanel.querySelectorAll('[data-roofdir]').forEach(btn => {
      btn.addEventListener('click', () => {
        updateVolume(vol.id, { roofDir: parseInt(btn.dataset.roofdir, 10) || 0 }, { forceSidebar: true });
      });
    });
    const inRoofAng = document.getElementById('inRoofAngle');
    if (inRoofAng) {
      inRoofAng.addEventListener('change', (e) => {
        const ang = Math.max(5, Math.min(55, parseFloat(e.target.value) || 22));
        updateVolume(vol.id, { roofAngle: ang }, { forceSidebar: true });
      });
    }
    const rngRoofAng = document.getElementById('rngRoofAngle');
    if (rngRoofAng) {
      let roofAngUndo = false;
      rngRoofAng.addEventListener('input', (e) => {
        if (!roofAngUndo) { pushUndo(); roofAngUndo = true; }
        const ang = Math.max(5, Math.min(55, parseFloat(e.target.value) || 22));
        if (inRoofAng) inRoofAng.value = ang;
        const riseEl = document.getElementById('roofRiseVal');
        if (riseEl) riseEl.textContent = `Rise +${eng.getRoofApexRise(dims, { ...roof, angle: ang }).toFixed(1)} m`;
        updateVolume(vol.id, { roofAngle: ang }, { silentUndo: true });
      });
      rngRoofAng.addEventListener('change', () => refreshAll({ forceSidebar: true }));
    }
    const inRoofOv = document.getElementById('inRoofOverhang');
    if (inRoofOv) {
      inRoofOv.addEventListener('change', (e) => {
        const ov = Math.max(0, Math.min(2.5, parseFloat(e.target.value) || 0));
        updateVolume(vol.id, { roofOverhang: ov }, { forceSidebar: true });
      });
    }

    // Earthwork Panel
    const ewPanel = document.createElement('div');
    ewPanel.className = 'panel-section';
    const warnWall = ew.maxCutDepth > 2.0 || ew.maxFillHeight > 2.0;
    ewPanel.innerHTML = `
      <div class="panel-title">Slope Contact &amp; Earthwork</div>
      <div class="earth-box">
        <div class="earth-stat"><div class="k">Cut Soil</div><div class="v m-cut" id="liveVolCut">${ew.cutVol.toFixed(1)} m³</div></div>
        <div class="earth-stat"><div class="k">Fill Soil</div><div class="v m-fill" id="liveVolFill">${ew.fillVol.toFixed(1)} m³</div></div>
        <div class="earth-stat"><div class="k">Max Cut Depth</div><div class="v" id="liveMaxCut">${ew.maxCutDepth.toFixed(2)} m</div></div>
        <div class="earth-stat"><div class="k">Max Fill Height</div><div class="v" id="liveMaxFill">${ew.maxFillHeight.toFixed(2)} m</div></div>
      </div>
      ${warnWall ? '<div class="warn-line">Brief note: cut/fill exceeds ~2.0 m single wall limit — consider stepping, lifting on posts, or moving along contour.</div>' : ''}
    `;
    body.appendChild(ewPanel);

    // Keywords & Description on this space
    const kwPanel = document.createElement('div');
    kwPanel.className = 'panel-section';
    const pillsHtml = state.keywords.map(k => {
      const has = vol.keywords.includes(k.id);
      if (!has) return '';
      return `<span class="kw-pill active-space ${k.enabled ? '' : 'off'}" data-kw="${k.id}" title="Click to remove from this space">${k.label} ×</span>`;
    }).join('');
    const availOptions = state.keywords
      .filter(k => !vol.keywords.includes(k.id))
      .map(k => `<option value="${k.id}">${k.label}</option>`)
      .join('');
    const noteHtml = vol.isCustom
      ? `<div class="field"><label>Description</label><textarea id="inCustomNote" rows="2" placeholder="Add space notes…">${escapeHtml(vol.note || '')}</textarea></div>`
      : `<div class="note-box">${escapeHtml(vol.note || '')}</div>`;
    kwPanel.innerHTML = `
      <div class="panel-title">Keywords &amp; Description</div>
      <div class="row-wrap" id="spaceKwPills">${pillsHtml || '<span style="color:var(--ink-muted)">No keywords assigned</span>'}</div>
      <div class="row-between">
        <select id="selAddKwToSpace" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:4px;background:var(--surface);">
          <option value="">+ Add keyword to space…</option>
          ${availOptions}
        </select>
      </div>
      ${noteHtml}
      <div class="row-between">
        <button class="btn danger" id="btnRemoveOne" style="flex:1">Remove from Site</button>
        ${vol.isCustom ? '<button class="btn danger" id="btnDeleteCustom">Delete Custom</button>' : ''}
      </div>
    `;
    body.appendChild(kwPanel);

    // Custom Name / Color / Note listeners
    if (vol.isCustom) {
      const nameInp = document.getElementById('inCustomName');
      let nameUndo = false;
      nameInp.addEventListener('input', (e) => {
        if (!nameUndo) { pushUndo(); nameUndo = true; }
        const val = e.target.value;
        const short = val.trim().length > 14 ? val.trim().slice(0, 13).trim() + '…' : (val.trim() || vol.ref);
        updateVolume(vol.id, { name: val, short }, { silentUndo: true });
      });
      nameInp.addEventListener('change', () => refreshAll({ forceSidebar: true }));

      document.querySelectorAll('#inCustomSwatches [data-cswatch]').forEach(btn => {
        btn.addEventListener('click', () => {
          updateVolume(vol.id, { customColor: btn.dataset.cswatch }, { forceSidebar: true });
        });
      });
      document.getElementById('inCustomColor').addEventListener('change', (e) => {
        updateVolume(vol.id, { customColor: e.target.value }, { forceSidebar: true });
      });
      const noteInp = document.getElementById('inCustomNote');
      if (noteInp) {
        let noteUndo = false;
        noteInp.addEventListener('input', (e) => {
          if (!noteUndo) { pushUndo(); noteUndo = true; }
          updateVolume(vol.id, { note: e.target.value }, { silentUndo: true });
        });
      }
      const delCustomBtn = document.getElementById('btnDeleteCustom');
      if (delCustomBtn) {
        delCustomBtn.addEventListener('click', () => deleteCustomSpace(vol.id));
      }
    }

    // Bind Area / Lock / Dimensions controls
    document.getElementById('inArea').addEventListener('change', (e) => {
      const newArea = Math.max(1, Math.min(5000, parseFloat(e.target.value) || vol.area));
      const ratio = Math.sqrt(newArea / Math.max(0.1, vol.area));
      updateVolume(vol.id, { area: newArea, w: vol.w * ratio, d: vol.d * ratio }, { forceSidebar: true });
    });
    document.getElementById('btnToggleAreaLock').addEventListener('click', () => {
      const nextLocked = !prog.isAreaLocked(vol);
      updateVolume(vol.id, { areaLocked: nextLocked, freeResize: !nextLocked }, { forceSidebar: true });
      toast(nextLocked ? `Area locked at ${vol.area.toFixed(1)} m²` : 'Area unlocked for free resize');
    });
    document.getElementById('inFloors').addEventListener('change', (e) => {
      const f = Math.max(1, Math.min(6, Math.round(parseFloat(e.target.value) || 1)));
      const fpArea = vol.area / f;
      const ratio = vol.w / Math.max(0.2, vol.d);
      const nw = Math.sqrt(fpArea * ratio);
      const nd = fpArea / nw;
      updateVolume(vol.id, { floors: f, w: nw, d: nd }, { forceSidebar: true });
    });
    document.getElementById('inW').addEventListener('change', (e) => {
      const fpArea = vol.area / Math.max(1, vol.floors || 1);
      const isLocked = prog.isAreaLocked(vol);
      const minSide = Math.min(1.5, Math.max(0.5, Math.sqrt(fpArea) * 0.5));
      const nw = Math.max(minSide, Math.min(isLocked ? fpArea / minSide : 200, parseFloat(e.target.value) || vol.w));
      if (isLocked) {
        updateVolume(vol.id, { w: nw, d: fpArea / nw }, { forceSidebar: true });
      } else {
        updateVolume(vol.id, { w: nw, area: Math.round(nw * vol.d * Math.max(1, vol.floors || 1) * 10) / 10 }, { forceSidebar: true });
      }
    });
    document.getElementById('inD').addEventListener('change', (e) => {
      const fpArea = vol.area / Math.max(1, vol.floors || 1);
      const isLocked = prog.isAreaLocked(vol);
      const minSide = Math.min(1.5, Math.max(0.5, Math.sqrt(fpArea) * 0.5));
      const nd = Math.max(minSide, Math.min(isLocked ? fpArea / minSide : 200, parseFloat(e.target.value) || vol.d));
      if (isLocked) {
        updateVolume(vol.id, { d: nd, w: fpArea / nd }, { forceSidebar: true });
      } else {
        updateVolume(vol.id, { d: nd, area: Math.round(vol.w * nd * Math.max(1, vol.floors || 1) * 10) / 10 }, { forceSidebar: true });
      }
    });
    document.getElementById('inFloorH').addEventListener('change', (e) => {
      const fh = Math.max(1.5, Math.min(14, parseFloat(e.target.value) || 3.0));
      updateVolume(vol.id, { floorHeight: fh }, { forceSidebar: true });
    });
    document.getElementById('inRot').addEventListener('change', (e) => {
      const deg = parseFloat(e.target.value) || 0;
      updateVolume(vol.id, { rot: deg * Math.PI / 180 }, { forceSidebar: true });
    });
    document.getElementById('inZBase').addEventListener('change', (e) => {
      const zb = parseFloat(e.target.value);
      if (!Number.isNaN(zb)) updateVolume(vol.id, { zBase: zb }, { forceSidebar: true });
    });
    document.getElementById('btnSnapNearest').addEventListener('click', () => snapVolumeToNearest(vol.id));
    document.getElementById('btnMatchAngle').addEventListener('click', () => matchNearestAngle(vol.id));
    document.getElementById('btnSnapZ').addEventListener('click', () => {
      updateVolume(vol.id, { zBase: Math.round(eng.getGroundZ(vol.x, vol.y) * 100) / 100 }, { forceSidebar: true });
    });
    document.getElementById('btnStackOnBelow').addEventListener('click', () => {
      const others = state.volumes.filter(v => v.id !== vol.id && eng.minEdgeDistanceRects(vol, v, state.useGross) === 0);
      if (!others.length) {
        toast('Place bubble overlapping another bubble first to stack on top');
        return;
      }
      others.sort((a, b) => (b.zBase + eng.getEffectiveDims(b, state.useGross).totalHeight) - (a.zBase + eng.getEffectiveDims(a, state.useGross).totalHeight));
      const base = others[0];
      const topZ = base.zBase + eng.getEffectiveDims(base, state.useGross).totalHeight;
      updateVolume(vol.id, { zBase: Math.round(topZ * 100) / 100, zOrder: state.nextZOrder++ }, { forceSidebar: true });
      toast(`Stacked on top of ${base.ref} (${topZ.toFixed(1)} m)`);
    });
    document.getElementById('btnZFront').addEventListener('click', () => {
      updateVolume(vol.id, { zOrder: state.nextZOrder++ });
    });
    document.getElementById('btnZBack').addEventListener('click', () => {
      const minZOrd = Math.min(...state.volumes.map(v => v.zOrder || 0));
      updateVolume(vol.id, { zOrder: minZOrd - 1 });
    });
    const ungrpBtn = document.getElementById('btnUngrpOne');
    if (ungrpBtn) ungrpBtn.addEventListener('click', ungroupSelected);

    document.querySelectorAll('#spaceKwPills .kw-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const kw = pill.dataset.kw;
        updateVolume(vol.id, { keywords: vol.keywords.filter(k => k !== kw) }, { forceSidebar: true });
      });
    });
    document.getElementById('selAddKwToSpace').addEventListener('change', (e) => {
      const kw = e.target.value;
      if (!kw) return;
      if (!vol.keywords.includes(kw)) {
        updateVolume(vol.id, { keywords: [...vol.keywords, kw] }, { forceSidebar: true });
      }
    });
    document.getElementById('btnRemoveOne').addEventListener('click', () => removeVolumes([vol.id]));
  }

  function renderTabKeywords(body) {
    const header = document.createElement('div');
    header.className = 'panel-section';
    header.innerHTML = `
      <div class="panel-title">Roombook Keywords (Include / Exclude)</div>
      <div class="note-box">Toggle any keyword below to include or exclude it from relevance grading, outline saturation, merged bridges, and Relevance sorting.</div>
      <div class="field"><input type="text" id="kwFilterInput" placeholder="Filter keywords…" value="${kwSearch}" /></div>
      <div class="row-between">
        <button class="btn" id="btnKwAll" style="flex:1">Include All</button>
        <button class="btn" id="btnKwNone" style="flex:1">Exclude All</button>
      </div>
      <div class="row-between">
        <input type="text" id="kwCustomInput" placeholder="New custom keyword…" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);" />
        <button class="btn" id="btnKwAddCustom">Add</button>
      </div>
    `;
    body.appendChild(header);

    const groups = new Map();
    const q = kwSearch.trim().toLowerCase();
    for (const kw of state.keywords) {
      if (q && !kw.label.toLowerCase().includes(q) && !kw.group.toLowerCase().includes(q)) continue;
      if (!groups.has(kw.group)) groups.set(kw.group, []);
      groups.get(kw.group).push(kw);
    }

    const listSec = document.createElement('div');
    listSec.className = 'panel-section';
    for (const [grpName, kws] of groups.entries()) {
      const gt = document.createElement('div');
      gt.className = 'kw-group-title';
      gt.textContent = grpName;
      listSec.appendChild(gt);

      for (const kw of kws) {
        const count = catalog.filter(s => s.keywords.includes(kw.id)).length;
        const row = document.createElement('label');
        row.className = 'kw-check-row';
        row.innerHTML = `
          <span class="kw-check-left">
            <input type="checkbox" ${kw.enabled ? 'checked' : ''} data-kwid="${kw.id}" />
            <span>${kw.label}</span>
          </span>
          <span class="kw-count">${count}</span>
        `;
        row.querySelector('input').addEventListener('change', (e) => {
          pushUndo();
          kw.enabled = e.target.checked;
          refreshAll();
        });
        listSec.appendChild(row);
      }
    }
    body.appendChild(listSec);

    document.getElementById('kwFilterInput').addEventListener('input', (e) => {
      kwSearch = e.target.value;
      renderSidebar();
      const inp = document.getElementById('kwFilterInput');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
    document.getElementById('btnKwAll').addEventListener('click', () => {
      pushUndo();
      state.keywords.forEach(k => { k.enabled = true; });
      refreshAll();
    });
    document.getElementById('btnKwNone').addEventListener('click', () => {
      pushUndo();
      state.keywords.forEach(k => { k.enabled = false; });
      refreshAll();
    });
    document.getElementById('btnKwAddCustom').addEventListener('click', () => {
      const inp = document.getElementById('kwCustomInput');
      const raw = (inp.value || '').trim();
      if (!raw) return;
      const id = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!state.keywords.some(k => k.id === id)) {
        pushUndo();
        state.keywords.push({ id, label: raw, group: 'Custom', enabled: true });
        refreshAll();
        toast(`Added keyword "${raw}"`);
      }
    });
  }

  function renderTabSections(body) {
    const plane = getActivePlane();
    const secPanel = document.createElement('div');
    secPanel.className = 'panel-section';
    const optsHtml = state.planes.map(p => `<option value="${p.id}" ${p.id === plane.id ? 'selected' : ''}>Section ${p.name}–${p.name}'</option>`).join('');
    secPanel.innerHTML = `
      <div class="panel-title">Clipping Planes (Rhino-style)</div>
      <div class="row-between">
        <select id="selPlaneSelect" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);">${optsHtml}</select>
        <button class="btn" id="btnAddPlane">+ New</button>
        ${state.planes.length > 1 ? '<button class="btn danger" id="btnDelPlane">Del</button>' : ''}
      </div>
      <label class="kw-check-row">
        <span class="kw-check-left"><input type="checkbox" id="chkClipEnabled" ${plane.enabled ? 'checked' : ''} /><span>Enable 3D Clipping Plane</span></span>
      </label>
      <div class="field">
        <label>Angle: ${Math.round(plane.angleDeg)}°</label>
        <input type="range" id="rngPlaneAngle" min="-180" max="180" step="1" value="${Math.round(plane.angleDeg)}" />
      </div>
      <div class="row-between">
        <button class="btn" id="btnPlaneSlideBack" style="flex:1">Slide -2 m</button>
        <button class="btn" id="btnPlaneSlideFwd" style="flex:1">Slide +2 m</button>
        <button class="btn" id="btnPlaneFlip">Flip</button>
      </div>
      <div class="field-grid">
        <div class="field"><label>Center X (m)</label><input type="number" id="inPlaneCx" step="1" value="${plane.cx.toFixed(1)}" /></div>
        <div class="field"><label>Center Y (m)</label><input type="number" id="inPlaneCy" step="1" value="${plane.cy.toFixed(1)}" /></div>
      </div>
      <div class="field">
        <label>Section Projection Depth (m)</label>
        <input type="number" id="inPlaneDepth" step="2" min="2" max="80" value="${plane.projDepth || 18}" />
      </div>
    `;
    body.appendChild(secPanel);

    const layerPanel = document.createElement('div');
    layerPanel.className = 'panel-section';
    const layerDefs = [
      ['siteBoundary', 'Site Boundary (6,390 m²)'],
      ['contours', 'Contour Lines (2m & 5m)'],
      ['roads', 'Access Roads'],
      ['waterways', 'Waterways / Streams'],
      ['buildings', 'Context Buildings'],
      ['plotBuildings', 'Existing Buildings Inside Plot'],
      ['trees', 'Site Vegetation (Trees)'],
      ['cutFill', 'Cut & Fill Soil Volumes'],
      ['snap', 'Magnetic Snap & Smart Guides (S)'],
      ['rectDims', 'Rectangle Dimensions (Zoomed)'],
      ['annotations', 'Annotations (Text & Lines)'],
      ['translucentTerrain', 'Translucent Terrain (3D)']
    ];
    layerPanel.innerHTML = `<div class="panel-title">Site &amp; Model Layers</div>` +
      layerDefs.map(([k, lbl]) => `
        <label class="kw-check-row">
          <span class="kw-check-left"><input type="checkbox" data-layer="${k}" ${state.layers[k] ? 'checked' : ''} /><span>${lbl}</span></span>
        </label>
      `).join('');
    body.appendChild(layerPanel);

    document.getElementById('selPlaneSelect').addEventListener('change', (e) => {
      state.activePlaneId = e.target.value;
      refreshAll();
      sectionView.fitSection();
    });
    document.getElementById('btnAddPlane').addEventListener('click', () => {
      const code = String.fromCharCode(65 + state.planes.length);
      const id = 'sec-' + Date.now();
      state.planes.push({
        id,
        name: code,
        cx: 0,
        cy: -20,
        angleDeg: (plane.angleDeg + 90) % 180,
        flipped: false,
        enabled: true,
        projDepth: 18
      });
      state.activePlaneId = id;
      refreshAll();
      sectionView.fitSection();
    });
    const delBtn = document.getElementById('btnDelPlane');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        state.planes = state.planes.filter(p => p.id !== plane.id);
        state.activePlaneId = state.planes[0].id;
        refreshAll();
      });
    }
    document.getElementById('chkClipEnabled').addEventListener('change', (e) => {
      updateActivePlane({ enabled: e.target.checked });
    });
    document.getElementById('rngPlaneAngle').addEventListener('input', (e) => {
      updateActivePlane({ angleDeg: parseFloat(e.target.value) });
    });
    document.getElementById('btnPlaneSlideBack').addEventListener('click', () => {
      const b = eng.getPlaneBasis(plane);
      updateActivePlane({ cx: plane.cx - b.vx * 2, cy: plane.cy - b.vy * 2 });
    });
    document.getElementById('btnPlaneSlideFwd').addEventListener('click', () => {
      const b = eng.getPlaneBasis(plane);
      updateActivePlane({ cx: plane.cx + b.vx * 2, cy: plane.cy + b.vy * 2 });
    });
    document.getElementById('btnPlaneFlip').addEventListener('click', () => {
      updateActivePlane({ flipped: !plane.flipped });
    });
    document.getElementById('inPlaneCx').addEventListener('change', (e) => {
      updateActivePlane({ cx: parseFloat(e.target.value) || 0 });
    });
    document.getElementById('inPlaneCy').addEventListener('change', (e) => {
      updateActivePlane({ cy: parseFloat(e.target.value) || 0 });
    });
    document.getElementById('inPlaneDepth').addEventListener('change', (e) => {
      updateActivePlane({ projDepth: Math.max(2, parseFloat(e.target.value) || 18) });
    });
    layerPanel.querySelectorAll('input[data-layer]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        state.layers[cb.dataset.layer] = e.target.checked;
        refreshAll();
      });
    });
  }

  function renderTabIterations(body) {
    const p = document.createElement('div');
    p.className = 'panel-section';
    p.innerHTML = `
      <div class="panel-title">Save Iteration Snapshot</div>
      <div class="row-between">
        <input type="text" id="inIterName" placeholder="e.g. Option B - Stepped Ridge" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);" />
        <button class="btn" id="btnSaveIter">Save</button>
      </div>
      <div class="row-between">
        <button class="btn" id="btnIterExportJson" style="flex:1">Export .json</button>
        <button class="btn" id="btnIterImportJson" style="flex:1">Import .json</button>
      </div>
    `;
    body.appendChild(p);

    const listP = document.createElement('div');
    listP.className = 'panel-section';
    listP.innerHTML = `<div class="panel-title">Saved Iterations (${state.iterations.length})</div>`;
    if (state.iterations.length === 0) {
      listP.innerHTML += `<div class="note-box">No snapshots yet. Save iterations here to compare massing &amp; earthwork options.</div>`;
    } else {
      for (const it of state.iterations) {
        const row = document.createElement('div');
        row.className = 'iter-item';
        row.innerHTML = `
          <div style="min-width:0;">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(it.name)}</div>
            <div style="font-size:10px;color:var(--ink-muted);font-family:var(--mono);">${it.volumes.length} spaces · Cut ${it.cut.toFixed(0)} / Fill ${it.fill.toFixed(0)} m³</div>
          </div>
          <div class="bar-group">
            <button class="btn" data-load="${it.id}">Load</button>
            <button class="btn danger" data-del="${it.id}">×</button>
          </div>
        `;
        row.querySelector('[data-load]').addEventListener('click', () => {
          pushUndo();
          state.volumes = JSON.parse(JSON.stringify(it.volumes || [])).map(normalizeVolume);
          state.planes = JSON.parse(JSON.stringify(it.planes || [createDefaultPlane()]));
          state.annotations = JSON.parse(JSON.stringify(it.annotations || []));
          if (Array.isArray(it.customSpaces)) {
            state.customSpaces = JSON.parse(JSON.stringify(it.customSpaces)).map(normalizeVolume);
          }
          state.activePlaneId = it.activePlaneId || state.planes[0].id;
          state.selectedIds = [];
          state.selectedItem = null;
          refreshAll({ forceSidebar: true });
          toast(`Loaded "${it.name}"`);
        });
        row.querySelector('[data-del]').addEventListener('click', () => {
          state.iterations = state.iterations.filter(x => x.id !== it.id);
          refreshAll();
        });
        listP.appendChild(row);
      }
    }
    body.appendChild(listP);

    document.getElementById('btnSaveIter').addEventListener('click', () => {
      saveIterationSnapshot(document.getElementById('inIterName').value);
    });
    document.getElementById('btnIterExportJson').addEventListener('click', saveProjectJSON);
    document.getElementById('btnIterImportJson').addEventListener('click', () => document.getElementById('fileLoadJson').click());
  }

  function saveIterationSnapshot(nameRaw) {
    const name = (nameRaw || '').trim() || `Iteration ${state.iterations.length + 1}`;
    let cut = 0, fill = 0;
    for (const v of state.volumes) {
      const ew = eng.computeEarthwork(v, state.useGross, 12);
      cut += ew.cutVol;
      fill += ew.fillVol;
    }
    state.iterations.unshift({
      id: 'iter-' + Date.now(),
      name,
      timestamp: new Date().toISOString(),
      cut,
      fill,
      volumes: JSON.parse(JSON.stringify(state.volumes)),
      planes: JSON.parse(JSON.stringify(state.planes)),
      annotations: JSON.parse(JSON.stringify(state.annotations)),
      customSpaces: JSON.parse(JSON.stringify(state.customSpaces)),
      activePlaneId: state.activePlaneId
    });
    refreshAll();
    toast(`Saved snapshot "${name}"`);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function saveProjectJSON() {
    const data = JSON.stringify(state, null, 2);
    downloadBlob(new Blob([data], { type: 'application/json' }), 'groundwork-kotagiri-project.json');
    toast('Saved project JSON');
  }

  function exportPNG() {
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    if (state.layout === 'plan') {
      document.getElementById('planCanvas').toBlob(b => downloadBlob(b, `groundwork-plan-${ts}.png`));
    } else if (state.layout === 'section') {
      document.getElementById('sectionCanvas').toBlob(b => downloadBlob(b, `groundwork-section-${ts}.png`));
    } else if (state.layout === '3d') {
      const url = view3D.captureImageDataURL();
      fetch(url).then(r => r.blob()).then(b => downloadBlob(b, `groundwork-3d-${ts}.png`));
    } else {
      // Split composite sheet
      const cPlan = document.getElementById('planCanvas');
      const cSec = document.getElementById('sectionCanvas');
      const img3dUrl = view3D.captureImageDataURL();
      const img3d = new Image();
      img3d.onload = () => {
        const W = 1600, H = 1040, topH = 600, botH = 400, footH = 40;
        const isDark = state.theme === 'dark';
        const out = document.createElement('canvas');
        out.width = W; out.height = H;
        const ctx = out.getContext('2d');
        ctx.fillStyle = isDark ? '#181715' : '#f6f4ef';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(cPlan, 0, 0, W / 2 - 1, topH);
        ctx.drawImage(img3d, W / 2 + 1, 0, W / 2 - 1, topH);
        ctx.drawImage(cSec, 0, topH + 2, W, botH - 2);
        ctx.fillStyle = isDark ? '#36332e' : '#ddd7ca';
        ctx.fillRect(W / 2 - 1, 0, 2, topH);
        ctx.fillRect(0, topH, W, 2);
        ctx.fillStyle = isDark ? '#21201d' : '#fcfbf8';
        ctx.fillRect(0, H - footH, W, footH);
        ctx.fillStyle = isDark ? '#ece8df' : '#22201d';
        ctx.font = '600 13px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(`GROUNDWORK · KOTAGIRI — ${document.getElementById('mPlaced').textContent} · ${document.getElementById('mCut').textContent} · ${document.getElementById('mFill').textContent}`, 20, H - footH / 2);
        out.toBlob(b => downloadBlob(b, `groundwork-board-${ts}.png`));
      };
      img3d.src = img3dUrl;
    }
    toast('Exported PNG');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // Bind UI Events
  document.querySelectorAll('#layoutSwitch .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.layout = btn.dataset.layout;
      refreshAll();
      setTimeout(handleResize, 20);
    });
  });

  document.querySelectorAll('#toolSwitch .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTool(btn.dataset.tool);
    });
  });

  document.querySelectorAll('#dockSortSwitch .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.dockSort = btn.dataset.sort;
      refreshAll();
    });
  });

  document.querySelectorAll('#sidebarTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sidebarTab = btn.dataset.tab;
      renderSidebar();
    });
  });

  document.getElementById('btnGroup').addEventListener('click', groupSelected);
  document.getElementById('btnUngroup').addEventListener('click', ungroupSelected);
  document.getElementById('btnGross').addEventListener('click', () => {
    state.useGross = !state.useGross;
    refreshAll();
  });
  document.getElementById('btnClearDims').addEventListener('click', () => {
    if (!state.dimensions.length) return;
    pushUndo();
    state.dimensions = [];
    if (state.selectedItem && state.selectedItem.kind === 'dim') state.selectedItem = null;
    refreshAll({ forceSidebar: true });
    toast('Cleared dimensions');
  });
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);

  document.getElementById('btnToggleSidebar').addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen;
    refreshAll();
    setTimeout(handleResize, 20);
  });
  document.getElementById('btnCollapseDock').addEventListener('click', () => {
    state.dockOpen = false;
    refreshAll();
    setTimeout(handleResize, 20);
  });
  document.getElementById('btnShowDock').addEventListener('click', () => {
    state.dockOpen = true;
    refreshAll();
    setTimeout(handleResize, 20);
  });

  function toggleSnapLayer() {
    state.layers.snap = state.layers.snap === false;
    refreshAll();
    toast(state.layers.snap ? 'Magnetic Snap & Align ON' : 'Magnetic Snap & Align OFF');
  }
  document.getElementById('btnToggleSnap').addEventListener('click', toggleSnapLayer);
  document.getElementById('btnSecSnapToggle').addEventListener('click', toggleSnapLayer);

  document.getElementById('btnToggleRectDims').addEventListener('click', () => {
    state.layers.rectDims = !state.layers.rectDims;
    refreshAll();
    toast(state.layers.rectDims ? 'Rectangle Dimensions ON' : 'Rectangle Dimensions OFF');
  });
  function toggleAnnotationsLayer() {
    state.layers.annotations = !state.layers.annotations;
    refreshAll();
    toast(state.layers.annotations ? 'Annotations ON' : 'Annotations OFF');
  }
  document.getElementById('btnPlanAnnToggle').addEventListener('click', toggleAnnotationsLayer);
  document.getElementById('btnSecAnnToggle').addEventListener('click', toggleAnnotationsLayer);

  document.getElementById('btnPlanFit').addEventListener('click', () => planView.fitSite());
  document.getElementById('btn3dFit').addEventListener('click', () => view3D.fitSite());
  document.getElementById('btnSecFit').addEventListener('click', () => sectionView.fitSection());
  document.getElementById('btnSecFlip').addEventListener('click', () => {
    const p = getActivePlane();
    if (p) updateActivePlane({ flipped: !p.flipped });
  });
  document.getElementById('btn3dClipToggle').addEventListener('click', () => {
    const p = getActivePlane();
    if (p) updateActivePlane({ enabled: !p.enabled });
  });
  document.getElementById('btn3dTranslucent').addEventListener('click', () => {
    state.layers.translucentTerrain = !state.layers.translucentTerrain;
    refreshAll();
  });

  // Theme Toggle
  document.getElementById('btnTheme').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    refreshAll();
  });

  // Centered Project / Export, Shortcuts & Custom Bubble Modals
  const projectModal = document.getElementById('projectModal');
  const shortcutsModal = document.getElementById('shortcutsModal');
  const customBubbleModal = document.getElementById('customBubbleModal');
  const cbColorInput = document.getElementById('cbColor');
  const cbColorHex = document.getElementById('cbColorHex');
  const cbSwatches = document.getElementById('cbSwatches');

  function syncCbSwatches(hex) {
    cbColorInput.value = hex;
    cbColorHex.textContent = hex;
    cbSwatches.querySelectorAll('.swatch-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.swatch.toLowerCase() === hex.toLowerCase());
    });
  }
  if (cbSwatches) {
    cbSwatches.innerHTML = prog.CUSTOM_SWATCHES.map(hex =>
      `<button type="button" class="swatch-btn" data-swatch="${hex}" style="background:${hex};" title="${hex}"></button>`
    ).join('');
    cbSwatches.querySelectorAll('.swatch-btn').forEach(b => {
      b.addEventListener('click', () => syncCbSwatches(b.dataset.swatch));
    });
    cbColorInput.addEventListener('input', (e) => syncCbSwatches(e.target.value));
  }

  function closeAllModals() {
    projectModal.classList.remove('open');
    shortcutsModal.classList.remove('open');
    customBubbleModal.classList.remove('open');
  }
  function openProjectModal() { closeAllModals(); projectModal.classList.add('open'); }
  function closeProjectModal() { projectModal.classList.remove('open'); }
  function toggleShortcutsModal() {
    const wasOpen = shortcutsModal.classList.contains('open');
    closeAllModals();
    if (!wasOpen) shortcutsModal.classList.add('open');
  }
  function openCustomBubbleModal() {
    closeAllModals();
    document.getElementById('cbName').value = '';
    document.getElementById('cbRef').value = 'U' + state.nextCustomNum;
    document.getElementById('cbDesc').value = '';
    document.getElementById('cbArea').value = '40';
    document.getElementById('cbAreaLocked').checked = true;
    document.getElementById('cbFloors').value = '1';
    document.getElementById('cbFloorH').value = String(prog.DEFAULT_FLOOR_HEIGHT);
    const cbRoofSel = document.getElementById('cbRoofType');
    if (cbRoofSel) cbRoofSel.value = 'flat';
    syncCbSwatches(prog.CUSTOM_SWATCHES[(state.nextCustomNum - 1) % prog.CUSTOM_SWATCHES.length]);
    customBubbleModal.classList.add('open');
    setTimeout(() => document.getElementById('cbName').focus(), 20);
  }
  function closeCustomBubbleModal() { customBubbleModal.classList.remove('open'); }

  document.getElementById('btnAddCustomBubble').addEventListener('click', openCustomBubbleModal);
  document.getElementById('btnCloseCustomModal').addEventListener('click', closeCustomBubbleModal);
  document.getElementById('btnCancelCustomModal').addEventListener('click', closeCustomBubbleModal);
  customBubbleModal.addEventListener('click', (e) => {
    if (e.target === customBubbleModal) closeCustomBubbleModal();
  });
  document.getElementById('customBubbleForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('cbName').value;
    const ref = document.getElementById('cbRef').value;
    const note = document.getElementById('cbDesc').value;
    const customColor = cbColorInput.value;
    const area = parseFloat(document.getElementById('cbArea').value) || 40;
    const areaLocked = document.getElementById('cbAreaLocked').checked;
    const floors = parseInt(document.getElementById('cbFloors').value, 10) || 1;
    const floorHeight = parseFloat(document.getElementById('cbFloorH').value) || prog.DEFAULT_FLOOR_HEIGHT;
    const roofType = document.getElementById('cbRoofType') ? document.getElementById('cbRoofType').value : 'flat';
    closeCustomBubbleModal();
    createCustomBubble({ name, ref, note, customColor, area, areaLocked, floors, floorHeight, roofType });
  });

  document.getElementById('btnExportMenu').addEventListener('click', openProjectModal);
  document.getElementById('btnCloseProjectModal').addEventListener('click', closeProjectModal);
  projectModal.addEventListener('click', (e) => {
    if (e.target === projectModal) closeProjectModal();
  });

  document.getElementById('btnShortcuts').addEventListener('click', toggleShortcutsModal);
  document.getElementById('btnCloseShortcutsModal').addEventListener('click', () => shortcutsModal.classList.remove('open'));
  shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) shortcutsModal.classList.remove('open');
  });

  document.getElementById('actSaveJson').addEventListener('click', () => { closeProjectModal(); saveProjectJSON(); });
  document.getElementById('actLoadJson').addEventListener('click', () => { closeProjectModal(); document.getElementById('fileLoadJson').click(); });
  document.getElementById('fileLoadJson').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const loaded = JSON.parse(reader.result);
        pushUndo();
        state = normalizeState(loaded);
        refreshAll();
        planView.fitSite();
        sectionView.fitSection();
        toast('Project loaded');
      } catch (err) {
        toast('Invalid project JSON');
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  });
  document.getElementById('actSaveIteration').addEventListener('click', () => {
    closeProjectModal();
    state.sidebarTab = 'iterations';
    state.sidebarOpen = true;
    saveIterationSnapshot('');
    setTimeout(handleResize, 20);
  });
  document.getElementById('actExportPng').addEventListener('click', () => { closeProjectModal(); exportPNG(); });
  document.getElementById('actExportPlanSvg').addEventListener('click', () => {
    closeProjectModal();
    downloadBlob(new Blob([planView.exportSVG()], { type: 'image/svg+xml' }), 'groundwork-plan.svg');
    toast('Exported Plan SVG');
  });
  document.getElementById('actExportSectionSvg').addEventListener('click', () => {
    closeProjectModal();
    downloadBlob(new Blob([sectionView.exportSVG()], { type: 'image/svg+xml' }), 'groundwork-section.svg');
    toast('Exported Section SVG');
  });
  document.getElementById('actStarterLayout').addEventListener('click', () => { closeProjectModal(); placeStarterProgram(); });
  document.getElementById('actClearBoard').addEventListener('click', () => { closeProjectModal(); clearBoard(); });

  function setTool(toolName) {
    closeInlineTextEditor();
    state.tool = toolName;
    planView.dimDraft = null;
    planView.lineDraft = null;
    view3D.dimDraft = null;
    sectionView.dimDraft = null;
    sectionView.lineDraft = null;
    refreshAll();
    const names = {
      select: 'Select tool (V)',
      dimension: 'Dimension tool (D)',
      line: 'Line / Arrow tool (L)',
      text: 'Text Annotation tool (A)',
      section: 'Section Plane tool (C)'
    };
    toast(names[toolName] || toolName);
  }

  function setLayout(layoutName) {
    state.layout = layoutName;
    refreshAll();
    setTimeout(handleResize, 20);
  }

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (projectModal.classList.contains('open') || shortcutsModal.classList.contains('open') || customBubbleModal.classList.contains('open'))) {
      closeAllModals();
      return;
    }
    if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    const k = e.key.toLowerCase();
    const hasMod = e.ctrlKey || e.metaKey || e.altKey;

    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 's') {
      e.preventDefault();
      openProjectModal();
      return;
    }

    if (e.key === '?' || (!hasMod && k === 'h')) {
      e.preventDefault();
      toggleShortcutsModal();
      return;
    }

    if (hasMod) return;

    if (k === 'v') { setTool('select'); }
    else if (k === 'd') { setTool('dimension'); }
    else if (k === 'l') { setTool('line'); }
    else if (k === 'a') { setTool('text'); }
    else if (k === 's') { toggleSnapLayer(); }
    else if (k === 'r') {
      state.layers.rectDims = !state.layers.rectDims;
      refreshAll();
      toast(state.layers.rectDims ? 'Rectangle Dimensions ON' : 'Rectangle Dimensions OFF');
    }
    else if (k === 'c' && e.shiftKey) {
      const p = getActivePlane();
      if (p) {
        updateActivePlane({ enabled: !p.enabled });
        toast(p.enabled ? '3D Clipping Plane ON' : '3D Clipping Plane OFF');
      }
    } else if (k === 'c') { setTool('section'); }
    else if (k === 'x') {
      const p = getActivePlane();
      if (p) {
        updateActivePlane({ flipped: !p.flipped });
        toast('Flipped Section direction');
      }
    } else if (e.key === '1') { setLayout('split'); }
    else if (e.key === '2') { setLayout('plan'); }
    else if (e.key === '3') { setLayout('3d'); }
    else if (e.key === '4') { setLayout('section'); }
    else if (k === 'f') {
      planView.fitSite();
      view3D.fitSite();
      sectionView.fitSection();
      toast('Fitted site');
    } else if (k === 't') {
      state.layers.translucentTerrain = !state.layers.translucentTerrain;
      refreshAll();
      toast(state.layers.translucentTerrain ? 'Translucent Ground ON' : 'Translucent Ground OFF');
    } else if (k === 'n') {
      state.useGross = !state.useGross;
      refreshAll();
      toast(state.useGross ? 'Gross Area (+32%)' : 'Net Area');
    } else if (k === 'i') {
      state.sidebarOpen = !state.sidebarOpen;
      refreshAll();
      setTimeout(handleResize, 20);
    } else if (k === 'b') {
      state.dockOpen = !state.dockOpen;
      refreshAll();
      setTimeout(handleResize, 20);
    } else if (k === 'm') {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      refreshAll();
      toast(state.theme === 'dark' ? 'Dark Mode' : 'Light Mode');
    } else if (k === 'g' && e.shiftKey) {
      ungroupSelected();
    } else if (k === 'g') {
      groupSelected();
    } else if (k === 'z' && state.selectedIds.length) {
      const sel = state.selectedIds.map(getVolume).filter(Boolean);
      updateVolumesBatch(sel.map(v => ({ id: v.id, zBase: Math.round(eng.getGroundZ(v.x, v.y) * 100) / 100 })));
      toast('Snapped Z to slope');
    } else if ((k === 'q' || k === 'e') && state.selectedIds.length) {
      const delta = (k === 'q' ? 15 : -15) * Math.PI / 180;
      const sel = state.selectedIds.map(getVolume).filter(Boolean);
      updateVolumesBatch(sel.map(v => ({ id: v.id, rot: (v.rot || 0) + delta })));
    } else if ((e.key === '[' || e.key === ']') && state.selectedIds.length) {
      const dh = e.key === ']' ? 0.2 : -0.2;
      const sel = state.selectedIds.map(getVolume).filter(Boolean);
      updateVolumesBatch(sel.map(v => ({
        id: v.id,
        floorHeight: Math.max(1.5, Math.min(14, Math.round(((v.floorHeight || 3.0) + dh) * 10) / 10))
      })));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedIds.length) {
        e.preventDefault();
        removeVolumes(state.selectedIds);
      } else if (state.selectedItem) {
        e.preventDefault();
        if (state.selectedItem.kind === 'dim') deleteDimension(state.selectedItem.id);
        else if (state.selectedItem.kind === 'line' || state.selectedItem.kind === 'text') deleteAnnotation(state.selectedItem.id);
        else if (state.selectedItem.kind === 'section') clearSelection();
      }
    } else if (e.key === 'Escape') {
      if (state.selectedItem) clearSelection();
      setTool('select');
    }
  });

  function handleResize() {
    planView.resize();
    view3D.resize();
    sectionView.resize();
  }
  window.addEventListener('resize', handleResize);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => handleResize());
    document.querySelectorAll('.viewport').forEach(el => ro.observe(el));
  }

  // Expose debug handle for automated checks
  window.__GROUNDWORK_APP__ = {
    getState: () => state,
    placeStarterProgram,
    clearBoard,
    alignSelectedVolumes,
    snapVolumeToNearest,
    matchNearestAngle,
    planView,
    view3D,
    sectionView,
    refreshAll,
    exportPlanSVG: () => planView.exportSVG(),
    exportSectionSVG: () => sectionView.exportSVG()
  };

  // Boot: apply DOM layout classes first, then size and fit all viewports
  refreshAll();
  handleResize();
  planView.fitSite();
  view3D.fitSite();
  sectionView.fitSection();
})();
