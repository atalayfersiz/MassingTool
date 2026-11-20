/* Live Architectural Section Viewport: Simultaneously Updated Terrain Cut, Cut/Fill Soil & Volumes, Height Editing & Dimensions */
(function () {
  class SectionView {
    constructor(canvas, api) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.api = api;

      const meta = window.GROUNDWORK_SITE.meta;
      this.cam = {
        cs: 0,
        cz: (meta.siteBounds.minZ + meta.siteBounds.maxZ) * 0.5 + 2,
        pxPerM: 6.5
      };

      this.dragState = null;
      this.dimDraft = null;
      this.lineDraft = null;
      this.dimHitBoxes = [];
      this.annHitBoxes = [];
      this.hoverItem = null;
      this.spaceHeld = false;
      this.lastSlices = [];

      this._bindEvents();
    }

    fitSection() {
      const plane = this.api.getActivePlane();
      if (!plane) return;
      const eng = window.GROUNDWORK_ENGINE;
      const { pts } = eng.sliceTerrainAlongPlane(plane, 85, 1.0);
      let minZ = Infinity, maxZ = -Infinity;
      for (const p of pts) {
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      for (const v of this.api.getState().volumes) {
        const dims = eng.getEffectiveDims(v, this.api.getState().useGross);
        if (v.zBase < minZ) minZ = v.zBase;
        if (v.zBase + dims.totalHeight > maxZ) maxZ = v.zBase + dims.totalHeight;
      }
      const w = this.canvas.clientWidth || 800;
      const h = this.canvas.clientHeight || 360;
      this.cam.cs = 0;
      this.cam.cz = (minZ + maxZ) * 0.5 + 1.5;
      const spanS = 135;
      const spanZ = Math.max(22, (maxZ - minZ) + 14);
      this.cam.pxPerM = Math.max(2.2, Math.min(28, Math.min(w / spanS, h / spanZ)));
      this.render();
    }

    secToScreen(s, z) {
      const w = this.canvas.clientWidth || 1;
      const h = this.canvas.clientHeight || 1;
      return {
        x: w * 0.5 + (s - this.cam.cs) * this.cam.pxPerM,
        y: h * 0.5 - (z - this.cam.cz) * this.cam.pxPerM
      };
    }

    screenToSec(sx, sy) {
      const w = this.canvas.clientWidth || 1;
      const h = this.canvas.clientHeight || 1;
      return {
        s: this.cam.cs + (sx - w * 0.5) / this.cam.pxPerM,
        z: this.cam.cz - (sy - h * 0.5) / this.cam.pxPerM
      };
    }

    _getPointerPos(e) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _bindEvents() {
      window.addEventListener('keydown', (e) => {
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
          this.spaceHeld = true;
        }
      });
      window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') this.spaceHeld = false;
      });

      this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const pos = this._getPointerPos(e);
        const before = this.screenToSec(pos.x, pos.y);
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.cam.pxPerM = Math.max(1.8, Math.min(48, this.cam.pxPerM * factor));
        const after = this.screenToSec(pos.x, pos.y);
        this.cam.cs += before.s - after.s;
        this.cam.cz += before.z - after.z;
        this.render();
      }, { passive: false });

      this.canvas.addEventListener('dblclick', (e) => {
        const pos = this._getPointerPos(e);
        const state = this.api.getState();
        if (!state.layers.annotations) return;
        const annHit = this._hitTestAnnotations(pos.x, pos.y);
        if (annHit && annHit.kind === 'text') {
          this.api.openInlineTextEditor({
            view: 'section',
            planeId: annHit.ann.planeId,
            clientX: e.clientX,
            clientY: e.clientY,
            existingId: annHit.ann.id,
            initialText: annHit.ann.text
          });
        }
      });

      this.canvas.addEventListener('pointerdown', (e) => {
        const pos = this._getPointerPos(e);
        const sec = this.screenToSec(pos.x, pos.y);
        const state = this.api.getState();
        const plane = this.api.getActivePlane();
        const planeId = plane ? plane.id : 'sec-A';

        if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceHeld)) {
          this.dragState = {
            type: 'pan',
            startX: pos.x,
            startY: pos.y,
            origCs: this.cam.cs,
            origCz: this.cam.cz
          };
          this.canvas.setPointerCapture(e.pointerId);
          return;
        }

        if (e.button !== 0) return;

        // Dimension tool
        if (state.tool === 'dimension') {
          if (!this.dimDraft) {
            this.dimDraft = { planeId, s1: sec.s, z1: sec.z, s2: sec.s, z2: sec.z };
          } else {
            const dim = this.api.addSectionDimension(planeId, this.dimDraft.s1, this.dimDraft.z1, sec.s, sec.z);
            this.dimDraft = null;
            if (dim) this.api.selectItem('dim', dim.id);
          }
          this.render();
          return;
        }

        // Line / Arrow annotation tool
        if (state.tool === 'line') {
          if (!this.lineDraft) {
            this.lineDraft = {
              planeId,
              p1: { s: sec.s, z: sec.z },
              p2: { s: sec.s, z: sec.z },
              startPos: pos,
              moved: false
            };
            this.dragState = { type: 'line-draw' };
            this.canvas.setPointerCapture(e.pointerId);
          } else {
            const p2 = this._snapAngleSec(this.lineDraft.p1, sec, e.shiftKey);
            if (Math.hypot(p2.s - this.lineDraft.p1.s, p2.z - this.lineDraft.p1.z) > 0.2) {
              this.api.addAnnotation({
                type: 'line',
                view: 'section',
                planeId,
                p1: { ...this.lineDraft.p1 },
                p2,
                startCap: 'none',
                endCap: 'arrow',
                dashed: false,
                strokeWidth: 1.5,
                color: 'ink'
              });
            }
            this.lineDraft = null;
          }
          this.render();
          return;
        }

        // Text annotation tool
        if (state.tool === 'text') {
          this.api.openInlineTextEditor({
            view: 'section',
            planeId,
            clientX: e.clientX,
            clientY: e.clientY,
            worldPos: { s: sec.s, z: sec.z }
          });
          return;
        }

        // 1. Selected dimension endpoint handle
        const dimEpHit = this._hitTestSelectedDimEndpoint(pos.x, pos.y);
        if (dimEpHit) {
          this.api.pushUndo();
          this.dragState = {
            type: 'dim-endpoint',
            dimId: dimEpHit.dim.id,
            endKey: dimEpHit.endpoint
          };
          this.canvas.setPointerCapture(e.pointerId);
          return;
        }

        // 2. Selected line annotation endpoint handle
        const lineEpHit = this._hitTestSelectedLineEndpoint(pos.x, pos.y);
        if (lineEpHit) {
          this.api.pushUndo();
          this.dragState = {
            type: 'line-endpoint',
            annId: lineEpHit.ann.id,
            endpoint: lineEpHit.endpoint
          };
          this.canvas.setPointerCapture(e.pointerId);
          return;
        }

        // 3. Dimension text box click/drag
        const dimBoxHit = this._hitTestDimTextBox(pos.x, pos.y);
        if (dimBoxHit) {
          const dim = state.dimensions.find(d => d.id === dimBoxHit.id);
          if (dim) {
            this.api.selectItem('dim', dim.id);
            this.api.pushUndo();
            this.dragState = {
              type: 'dim-move',
              dimId: dim.id,
              startSec: sec,
              orig: { s1: dim.s1, z1: dim.z1, s2: dim.s2, z2: dim.z2 }
            };
            this.canvas.setPointerCapture(e.pointerId);
            this.render();
            return;
          }
        }

        // 4. Annotations (Text & Line/Arrow)
        if (state.layers.annotations) {
          const annHit = this._hitTestAnnotations(pos.x, pos.y);
          if (annHit) {
            const ann = annHit.ann;
            this.api.selectItem(ann.type, ann.id);
            this.api.pushUndo();
            this.dragState = {
              type: 'ann-move',
              annId: ann.id,
              kind: ann.type,
              startSec: sec,
              orig: ann.type === 'text'
                ? { s: ann.s, z: ann.z }
                : { p1: { ...ann.p1 }, p2: { ...ann.p2 } }
            };
            this.canvas.setPointerCapture(e.pointerId);
            this.render();
            return;
          }
        }

        // 5. Top-edge height handles & volume slices
        const hit = this._hitTestSlice(pos.x, pos.y, sec);
        if (hit) {
          const vol = hit.slice.vol;
          if (e.shiftKey) {
            this.api.toggleSelect(vol.id);
          } else if (!state.selectedIds.includes(vol.id)) {
            this.api.selectVolume(vol.id, e.detail < 2);
          }

          this.api.pushUndo();
          if (hit.mode === 'height') {
            this.dragState = {
              type: 'height',
              id: vol.id,
              origFloorHeight: vol.floorHeight || 3.0,
              floors: Math.max(1, vol.floors || 1),
              zBase: vol.zBase,
              startZ: sec.z
            };
          } else {
            const origins = {};
            for (const id of this.api.getState().selectedIds) {
              const v = this.api.getVolume(id);
              if (v) origins[id] = { x: v.x, y: v.y, zBase: v.zBase };
            }
            this.dragState = {
              type: 'move',
              id: vol.id,
              startSec: sec,
              origins
            };
          }
          this.canvas.setPointerCapture(e.pointerId);
          this.render();
          return;
        }

        if (!e.shiftKey) {
          this.api.clearSelection();
        }
      });

      this.canvas.addEventListener('pointermove', (e) => {
        const pos = this._getPointerPos(e);
        const sec = this.screenToSec(pos.x, pos.y);
        const plane = this.api.getActivePlane();
        if (plane) {
          const basis = window.GROUNDWORK_ENGINE.getPlaneBasis(plane);
          const wp = window.GROUNDWORK_ENGINE.planeToWorld(sec.s, 0, basis);
          this.api.updateCursorReadout({ x: wp.x, y: wp.y, z: sec.z });
        }

        const state = this.api.getState();

        if (!this.dragState) {
          if (state.tool === 'dimension' && this.dimDraft) {
            this.dimDraft.s2 = sec.s;
            this.dimDraft.z2 = sec.z;
            this.render();
            return;
          }
          if (state.tool === 'line' && this.lineDraft) {
            this.lineDraft.p2 = this._snapAngleSec(this.lineDraft.p1, sec, e.shiftKey);
            this.render();
            return;
          }
          const hit = this._hitTestSlice(pos.x, pos.y, sec);
          this.hoverItem = hit ? { id: hit.slice.vol.id, mode: hit.mode } : null;
          if (this.spaceHeld) this.canvas.style.cursor = 'grab';
          else if (state.tool === 'text') this.canvas.style.cursor = 'text';
          else if (state.tool === 'dimension' || state.tool === 'line') this.canvas.style.cursor = 'crosshair';
          else if (this._hitTestSelectedDimEndpoint(pos.x, pos.y) || this._hitTestSelectedLineEndpoint(pos.x, pos.y) || this._hitTestDimTextBox(pos.x, pos.y)) this.canvas.style.cursor = 'pointer';
          else if (state.layers.annotations && this._hitTestAnnotations(pos.x, pos.y)) this.canvas.style.cursor = 'move';
          else if (hit && hit.mode === 'height') this.canvas.style.cursor = 'ns-resize';
          else if (hit) this.canvas.style.cursor = 'move';
          else this.canvas.style.cursor = 'default';
          return;
        }

        if (this.dragState.type === 'pan') {
          const dx = (pos.x - this.dragState.startX) / this.cam.pxPerM;
          const dy = (pos.y - this.dragState.startY) / this.cam.pxPerM;
          this.cam.cs = this.dragState.origCs - dx;
          this.cam.cz = this.dragState.origCz + dy;
          this.render();
          return;
        }

        if (this.dragState.type === 'line-draw' && this.lineDraft) {
          if (Math.hypot(pos.x - this.lineDraft.startPos.x, pos.y - this.lineDraft.startPos.y) > 4) {
            this.lineDraft.moved = true;
          }
          this.lineDraft.p2 = this._snapAngleSec(this.lineDraft.p1, sec, e.shiftKey);
          this.render();
          return;
        }

        if (this.dragState.type === 'dim-endpoint') {
          const dim = state.dimensions.find(d => d.id === this.dragState.dimId);
          if (!dim) return;
          const other = this.dragState.endKey === '1'
            ? { s: dim.s2, z: dim.z2 }
            : { s: dim.s1, z: dim.z1 };
          const snapped = this._snapAngleSec(other, sec, e.shiftKey);
          if (this.dragState.endKey === '1') {
            this.api.updateDimension(dim.id, { s1: snapped.s, z1: snapped.z }, { silentUndo: true });
          } else {
            this.api.updateDimension(dim.id, { s2: snapped.s, z2: snapped.z }, { silentUndo: true });
          }
          return;
        }

        if (this.dragState.type === 'dim-move') {
          const ds = sec.s - this.dragState.startSec.s;
          const dz = sec.z - this.dragState.startSec.z;
          const o = this.dragState.orig;
          this.api.updateDimension(this.dragState.dimId, {
            s1: o.s1 + ds, z1: o.z1 + dz,
            s2: o.s2 + ds, z2: o.z2 + dz
          }, { silentUndo: true });
          return;
        }

        if (this.dragState.type === 'line-endpoint') {
          const ann = state.annotations.find(a => a.id === this.dragState.annId);
          if (!ann) return;
          const other = this.dragState.endpoint === 'p1' ? ann.p2 : ann.p1;
          const snapped = this._snapAngleSec(other, sec, e.shiftKey);
          this.api.updateAnnotation(ann.id, { [this.dragState.endpoint]: snapped }, { silentUndo: true });
          return;
        }

        if (this.dragState.type === 'ann-move') {
          const ds = sec.s - this.dragState.startSec.s;
          const dz = sec.z - this.dragState.startSec.z;
          if (this.dragState.kind === 'text') {
            this.api.updateAnnotation(this.dragState.annId, {
              s: this.dragState.orig.s + ds,
              z: this.dragState.orig.z + dz
            }, { silentUndo: true });
          } else {
            this.api.updateAnnotation(this.dragState.annId, {
              p1: { s: this.dragState.orig.p1.s + ds, z: this.dragState.orig.p1.z + dz },
              p2: { s: this.dragState.orig.p2.s + ds, z: this.dragState.orig.p2.z + dz }
            }, { silentUndo: true });
          }
          return;
        }

        if (this.dragState.type === 'height') {
          const totalH = Math.max(1.5, Math.min(24, sec.z - this.dragState.zBase));
          const snappedTotal = Math.round(totalH * 10) / 10;
          const newFloorH = Math.max(1.2, Math.round((snappedTotal / this.dragState.floors) * 10) / 10);
          this.api.updateVolume(this.dragState.id, { floorHeight: newFloorH }, { silentUndo: true });
          return;
        }

        if (this.dragState.type === 'move') {
          const ds = sec.s - this.dragState.startSec.s;
          const dz = sec.z - this.dragState.startSec.z;
          const activePlane = this.api.getActivePlane();
          const basis = window.GROUNDWORK_ENGINE.getPlaneBasis(activePlane);
          const dx = ds * basis.tx;
          const dy = ds * basis.ty;
          const updates = [];
          for (const [id, orig] of Object.entries(this.dragState.origins)) {
            updates.push({
              id,
              x: orig.x + dx,
              y: orig.y + dy,
              zBase: Math.round((orig.zBase + dz) * 100) / 100
            });
          }
          this.api.updateVolumesBatch(updates, { silentUndo: true });
        }
      });

      this.canvas.addEventListener('pointerup', (e) => {
        if (!this.dragState) return;
        if (this.dragState.type === 'line-draw' && this.lineDraft && this.lineDraft.moved) {
          const p2 = this.lineDraft.p2;
          if (Math.hypot(p2.s - this.lineDraft.p1.s, p2.z - this.lineDraft.p1.z) > 0.2) {
            this.api.addAnnotation({
              type: 'line',
              view: 'section',
              planeId: this.lineDraft.planeId,
              p1: { ...this.lineDraft.p1 },
              p2: { ...p2 },
              startCap: 'none',
              endCap: 'arrow',
              dashed: false,
              strokeWidth: 1.5,
              color: 'ink'
            });
          }
          this.lineDraft = null;
        }
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        this.dragState = null;
        this.render();
      });
    }

    _snapAngleSec(origin, target, shiftKey) {
      if (!shiftKey || !origin) return { s: target.s, z: target.z };
      const ds = target.s - origin.s;
      const dz = target.z - origin.z;
      const dist = Math.hypot(ds, dz);
      if (dist < 1e-6) return { s: target.s, z: target.z };
      const step = Math.PI / 12;
      const ang = Math.round(Math.atan2(dz, ds) / step) * step;
      return { s: origin.s + Math.cos(ang) * dist, z: origin.z + Math.sin(ang) * dist };
    }

    _distPointToSegment(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-6) return Math.hypot(px - ax, py - ay);
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    _hitTestSelectedDimEndpoint(sx, sy) {
      const state = this.api.getState();
      const plane = this.api.getActivePlane();
      if (!plane || !state.selectedItem || state.selectedItem.kind !== 'dim') return null;
      const dim = state.dimensions.find(d => d.id === state.selectedItem.id && d.view === 'section' && d.planeId === plane.id);
      if (!dim) return null;
      const p1 = this.secToScreen(dim.s1, dim.z1);
      const p2 = this.secToScreen(dim.s2, dim.z2);
      if (Math.hypot(sx - p1.x, sy - p1.y) <= 9) return { dim, endpoint: '1' };
      if (Math.hypot(sx - p2.x, sy - p2.y) <= 9) return { dim, endpoint: '2' };
      return null;
    }

    _hitTestDimTextBox(sx, sy) {
      for (let i = this.dimHitBoxes.length - 1; i >= 0; i--) {
        const b = this.dimHitBoxes[i];
        if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b;
      }
      return null;
    }

    _hitTestSelectedLineEndpoint(sx, sy) {
      const state = this.api.getState();
      const plane = this.api.getActivePlane();
      if (!plane || !state.layers.annotations || !state.selectedItem || state.selectedItem.kind !== 'line') return null;
      const ann = state.annotations.find(a => a.id === state.selectedItem.id && a.view === 'section' && a.planeId === plane.id);
      if (!ann) return null;
      const p1 = this.secToScreen(ann.p1.s, ann.p1.z);
      const p2 = this.secToScreen(ann.p2.s, ann.p2.z);
      if (Math.hypot(sx - p1.x, sy - p1.y) <= 9) return { ann, endpoint: 'p1' };
      if (Math.hypot(sx - p2.x, sy - p2.y) <= 9) return { ann, endpoint: 'p2' };
      return null;
    }

    _hitTestAnnotations(sx, sy) {
      const state = this.api.getState();
      const plane = this.api.getActivePlane();
      if (!plane || !state.layers.annotations) return null;
      for (let i = this.annHitBoxes.length - 1; i >= 0; i--) {
        const b = this.annHitBoxes[i];
        if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) {
          const ann = state.annotations.find(a => a.id === b.id);
          if (ann) return { kind: 'text', ann };
        }
      }
      const lines = (state.annotations || []).filter(a => a.view === 'section' && a.planeId === plane.id && a.type === 'line');
      for (let i = lines.length - 1; i >= 0; i--) {
        const ann = lines[i];
        const p1 = this.secToScreen(ann.p1.s, ann.p1.z);
        const p2 = this.secToScreen(ann.p2.s, ann.p2.z);
        if (this._distPointToSegment(sx, sy, p1.x, p1.y, p2.x, p2.y) <= 6) {
          return { kind: 'line', ann };
        }
      }
      return null;
    }

    _hitTestSlice(sx, sy, sec) {
      // Check cut slices first (top-down reverse), then projected slices
      const ordered = [
        ...this.lastSlices.filter(sl => sl.kind === 'cut').reverse(),
        ...this.lastSlices.filter(sl => sl.kind === 'projected').reverse()
      ];
      for (const sl of ordered) {
        const pTop = this.secToScreen((sl.sMin + sl.sMax) * 0.5, sl.zTop);
        const pLeft = this.secToScreen(sl.sMin, sl.zTop);
        const pRight = this.secToScreen(sl.sMax, sl.zBase);

        // Top-edge height handle zone (within 7 px of zTop across [sMin..sMax])
        if (sx >= pLeft.x - 4 && sx <= pRight.x + 4 && Math.abs(sy - pTop.y) <= 7) {
          return { slice: sl, mode: 'height' };
        }
        // Body
        if (sec.s >= sl.sMin && sec.s <= sl.sMax && sec.z >= sl.zBase && sec.z <= sl.zTop) {
          return { slice: sl, mode: 'move' };
        }
      }
      return null;
    }

    resize() {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w < 2 || h < 2) return;
      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
      }
      this.render();
    }

    _palette() {
      const dark = this.api.getState().theme === 'dark';
      return dark ? {
        bg: '#181715',
        bldgCutFill: 'rgba(72, 68, 60, 0.55)',
        bldgProjFill: 'rgba(66, 62, 55, 0.25)',
        bldgCutStroke: '#7d776c',
        bldgProjStroke: 'rgba(130, 124, 112, 0.45)',
        projText: '#a49d91',
        earthFill: 'rgba(64, 59, 51, 0.48)',
        earthHatch: 'rgba(168, 158, 140, 0.14)',
        groundLine: '#b8b0a1',
        cutFill: 'rgba(212, 122, 97, 0.36)',
        cutStroke: '#d47a61',
        fillFill: 'rgba(216, 180, 99, 0.38)',
        fillStroke: '#d8b463',
        floorLine: 'rgba(236, 232, 223, 0.45)',
        ink: '#ece8df',
        inkSub: '#cbc4b7',
        inkMuted: '#a49d91',
        gripFill: '#21201d',
        badgeBg: 'rgba(33, 32, 29, 0.94)',
        badgeBorder: '#504b42',
        cutText: '#e08975',
        fillText: '#e0be6f',
        gridMajor: 'rgba(236, 232, 223, 0.11)',
        gridMinor: 'rgba(236, 232, 223, 0.045)',
        plotTick: 'rgba(236, 232, 223, 0.45)',
        dimDraft: '#a49d91',
        dimStroke: '#ece8df',
        summaryBg: 'rgba(33, 32, 29, 0.92)',
        summaryBorder: '#36332e'
      } : {
        bg: '#f6f4ef',
        bldgCutFill: 'rgba(185, 179, 166, 0.45)',
        bldgProjFill: 'rgba(196, 190, 178, 0.22)',
        bldgCutStroke: '#8c867a',
        bldgProjStroke: 'rgba(140, 134, 122, 0.45)',
        projText: '#6d685f',
        earthFill: 'rgba(206, 198, 182, 0.42)',
        earthHatch: 'rgba(130, 120, 102, 0.16)',
        groundLine: '#4e483e',
        cutFill: 'rgba(184, 93, 67, 0.34)',
        cutStroke: '#b85d43',
        fillFill: 'rgba(201, 162, 82, 0.38)',
        fillStroke: '#b58a2d',
        floorLine: 'rgba(34, 32, 29, 0.45)',
        ink: '#22201d',
        inkSub: '#4a453c',
        inkMuted: '#857d6e',
        gripFill: '#fcfbf8',
        badgeBg: 'rgba(252, 251, 248, 0.92)',
        badgeBorder: '#bdb5a5',
        cutText: '#9c4030',
        fillText: '#8d6a1f',
        gridMajor: 'rgba(34, 32, 29, 0.10)',
        gridMinor: 'rgba(34, 32, 29, 0.045)',
        plotTick: 'rgba(34, 32, 29, 0.45)',
        dimDraft: '#6d685f',
        dimStroke: '#22201d',
        summaryBg: 'rgba(252, 251, 248, 0.92)',
        summaryBorder: '#ddd7ca'
      };
    }

    render() {
      const ctx = this.ctx;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.canvas.width / dpr;
      const h = this.canvas.height / dpr;
      if (w <= 0 || h <= 0) return;

      const pal = this._palette();
      this.dimHitBoxes = [];
      this.annHitBoxes = [];

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, w, h);

      const state = this.api.getState();
      const eng = window.GROUNDWORK_ENGINE;
      const prog = window.GROUNDWORK_PROGRAM;
      const site = window.GROUNDWORK_SITE;
      const plane = this.api.getActivePlane();
      if (!plane) { ctx.restore(); return; }

      // Determine visible horizontal span in section coordinates
      const sLeft = this.screenToSec(0, 0).s;
      const sRight = this.screenToSec(w, 0).s;
      const halfSpan = Math.max(80, Math.min(180, Math.max(Math.abs(sLeft), Math.abs(sRight)) + 15));

      this._drawElevationGrid(ctx, w, h, pal);

      // Terrain profile along clipping plane
      const { basis, pts: groundPts } = eng.sliceTerrainAlongPlane(plane, halfSpan, 0.35);

      // Context buildings cut / projected
      if (state.layers.buildings && site.buildings) {
        for (const b of site.buildings) {
          if (eng.isBuildingInsidePlot(b) && !state.layers.plotBuildings) continue;
          const bs = eng.sliceContextBuilding(b, plane, plane.projDepth || 18);
          if (!bs) continue;
          const p1 = this.secToScreen(bs.sMin, bs.maxZ);
          const p2 = this.secToScreen(bs.sMax, bs.minZ);
          ctx.save();
          ctx.fillStyle = bs.isCut ? pal.bldgCutFill : pal.bldgProjFill;
          ctx.strokeStyle = bs.isCut ? pal.bldgCutStroke : pal.bldgProjStroke;
          ctx.lineWidth = bs.isCut ? 1.2 : 0.8;
          ctx.fillRect(p1.x, p1.y, Math.max(2, p2.x - p1.x), Math.max(2, p2.y - p1.y));
          ctx.strokeRect(p1.x, p1.y, Math.max(2, p2.x - p1.x), Math.max(2, p2.y - p1.y));
          ctx.restore();
        }
      }

      // Compute all volume slices
      const slices = [];
      for (const vol of state.volumes) {
        const sl = eng.sliceVolumeWithPlane(vol, plane, state.useGross, plane.projDepth || 18);
        if (sl) slices.push(sl);
      }
      this.lastSlices = slices;

      // 1. Draw projected spaces behind cut plane first
      for (const sl of slices) {
        if (sl.kind !== 'projected') continue;
        const p1 = this.secToScreen(sl.sMin, sl.zTop);
        const p2 = this.secToScreen(sl.sMax, sl.zBase);
        const bw = Math.max(4, p2.x - p1.x);
        const bh = Math.max(4, p2.y - p1.y);
        const cat = prog.getSpaceStyle(sl.vol);
        const isSel = state.selectedIds.includes(sl.vol.id);
        ctx.save();
        ctx.fillStyle = this._rgba(cat.color, 0.12);
        ctx.strokeStyle = isSel ? pal.ink : this._rgba(cat.color, 0.65);
        ctx.lineWidth = isSel ? 1.5 : 1;
        ctx.setLineDash([4, 3]);
        ctx.fillRect(p1.x, p1.y, bw, bh);
        ctx.strokeRect(p1.x, p1.y, bw, bh);
        ctx.setLineDash([]);
        if (bw > 32 && bh > 18) {
          ctx.fillStyle = pal.projText;
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${sl.vol.ref} ${sl.vol.short} (${sl.dims.totalArea.toFixed(0)}m²)`, p1.x + bw * 0.5, p1.y + bh * 0.5);
        }
        ctx.restore();
      }

      // 2. Draw earth fill below terrain line
      if (groundPts.length >= 2) {
        ctx.save();
        ctx.beginPath();
        const first = this.secToScreen(groundPts[0].s, groundPts[0].z);
        ctx.moveTo(first.x, h + 10);
        ctx.lineTo(first.x, first.y);
        for (let i = 1; i < groundPts.length; i++) {
          const sp = this.secToScreen(groundPts[i].s, groundPts[i].z);
          ctx.lineTo(sp.x, sp.y);
        }
        const last = this.secToScreen(groundPts[groundPts.length - 1].s, groundPts[groundPts.length - 1].z);
        ctx.lineTo(last.x, h + 10);
        ctx.closePath();
        ctx.fillStyle = pal.earthFill;
        ctx.fill();

        // Subtle diagonal earth hatch clipped inside soil body
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = pal.earthHatch;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = -h; x < w + h; x += 14) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x + h, h);
        }
        ctx.stroke();
        ctx.restore();

        // Existing ground line
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < groundPts.length; i++) {
          const sp = this.secToScreen(groundPts[i].s, groundPts[i].z);
          ctx.lineTo(sp.x, sp.y);
        }
        ctx.strokeStyle = pal.groundLine;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
      }

      // 3. Draw site boundary intersections on section plane
      this._drawSiteBoundaryTicks(ctx, basis, h, pal);

      // 4. Draw Cut & Fill soil polygons for cut spaces
      let cutSectionTotal = 0;
      let fillSectionTotal = 0;

      for (const sl of slices) {
        if (sl.kind !== 'cut') continue;
        cutSectionTotal += sl.earth.cutVol;
        fillSectionTotal += sl.earth.fillVol;

        if (state.layers.cutFill) {
          for (const poly of sl.cutPolys) {
            this._drawSoilPoly(ctx, poly, pal.cutFill, pal.cutStroke, +1);
          }
          for (const poly of sl.fillPolys) {
            this._drawSoilPoly(ctx, poly, pal.fillFill, pal.fillStroke, -1);
          }
        }
      }

      // 5. Draw cut space volumes ON TOP
      for (const sl of slices) {
        if (sl.kind !== 'cut') continue;
        const p1 = this.secToScreen(sl.sMin, sl.zTop);
        const p2 = this.secToScreen(sl.sMax, sl.zBase);
        const bw = Math.max(6, p2.x - p1.x);
        const bh = Math.max(6, p2.y - p1.y);
        const cat = prog.getSpaceStyle(sl.vol);
        const isSel = state.selectedIds.includes(sl.vol.id);

        ctx.save();
        ctx.fillStyle = this._rgba(cat.color, isSel ? 0.36 : 0.24);
        ctx.fillRect(p1.x, p1.y, bw, bh);

        // Floor dividers when multi-floor
        if (sl.dims.floors > 1) {
          ctx.strokeStyle = pal.floorLine;
          ctx.lineWidth = 1;
          for (let f = 1; f < sl.dims.floors; f++) {
            const fz = sl.zBase + f * sl.dims.floorHeight;
            const fy = this.secToScreen(sl.sMin, fz).y;
            ctx.beginPath();
            ctx.moveTo(p1.x, fy);
            ctx.lineTo(p1.x + bw, fy);
            ctx.stroke();
          }
        }

        ctx.strokeStyle = isSel ? pal.ink : cat.color;
        ctx.lineWidth = isSel ? 2.3 : 1.7;
        ctx.strokeRect(p1.x, p1.y, bw, bh);

        // Interactive top-edge height drag grip
        ctx.fillStyle = isSel ? pal.ink : pal.gripFill;
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = 1.2;
        const gx = p1.x + bw * 0.5;
        ctx.fillRect(gx - 10, p1.y - 3, 20, 6);
        ctx.strokeRect(gx - 10, p1.y - 3, 20, 6);

        // Clean Section Label: Space Name + Area + Height (NO keywords)
        const cx = p1.x + bw * 0.5;
        const cy = p1.y + bh * 0.5;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = pal.ink;
        const nameTxt = `${sl.vol.ref} ${sl.vol.short}`;
        const metaTxt = `${sl.dims.totalArea.toFixed(0)} m² · H ${sl.dims.totalHeight.toFixed(1)}m`;

        if (bw >= 54 && bh >= 28) {
          ctx.font = '600 11px sans-serif';
          ctx.fillText(nameTxt, cx, cy - 6);
          ctx.font = '10px ui-monospace, monospace';
          ctx.fillStyle = pal.inkSub;
          ctx.fillText(metaTxt, cx, cy + 7);
        } else {
          ctx.font = '600 10px sans-serif';
          ctx.fillText(`${nameTxt} · ${sl.dims.totalArea.toFixed(0)}m²`, cx, p1.y - 11);
        }

        // Earthwork Cut & Fill volume badges right beneath/beside the sliced volume
        if (state.layers.cutFill && (sl.earth.cutVol >= 0.5 || sl.earth.fillVol >= 0.5)) {
          const ewParts = [];
          if (sl.earth.cutVol >= 0.5) ewParts.push(`Cut ${sl.earth.cutVol.toFixed(1)} m³`);
          if (sl.earth.fillVol >= 0.5) ewParts.push(`Fill ${sl.earth.fillVol.toFixed(1)} m³`);
          const ewText = ewParts.join(' · ');
          ctx.font = '600 9.5px ui-monospace, monospace';
          const tw = ctx.measureText(ewText).width + 10;
          const by = p2.y + 12;
          ctx.fillStyle = pal.badgeBg;
          ctx.strokeStyle = pal.badgeBorder;
          ctx.lineWidth = 1;
          ctx.fillRect(cx - tw * 0.5, by - 8, tw, 15);
          ctx.strokeRect(cx - tw * 0.5, by - 8, tw, 15);
          ctx.fillStyle = sl.earth.cutVol > sl.earth.fillVol ? pal.cutText : pal.fillText;
          ctx.fillText(ewText, cx, by);
        }

        ctx.restore();
      }

      // 6. Section dimensions + draft
      for (const dim of state.dimensions.filter(d => d.view === 'section' && d.planeId === plane.id)) {
        const isSelDim = !!(state.selectedItem && state.selectedItem.kind === 'dim' && state.selectedItem.id === dim.id);
        this._drawSectionDimension(ctx, dim, false, isSelDim, pal);
      }
      if (this.dimDraft && this.dimDraft.planeId === plane.id) {
        this._drawSectionDimension(ctx, this.dimDraft, true, false, pal);
      }

      // 7. Section Annotations (Lines/Arrows & Text)
      if (state.layers.annotations) {
        for (const ann of (state.annotations || []).filter(a => a.view === 'section' && a.planeId === plane.id)) {
          const isSelAnn = !!(state.selectedItem && state.selectedItem.id === ann.id);
          if (ann.type === 'line') this._drawLineAnnotation(ctx, ann, false, isSelAnn, pal);
          else if (ann.type === 'text') this._drawTextAnnotation(ctx, ann, isSelAnn, pal);
        }
      }
      if (this.lineDraft && this.lineDraft.planeId === plane.id) {
        this._drawLineAnnotation(ctx, {
          p1: this.lineDraft.p1,
          p2: this.lineDraft.p2,
          startCap: 'none',
          endCap: 'arrow',
          dashed: true,
          strokeWidth: 1.5,
          color: 'ink'
        }, true, false, pal);
      }

      // 8. Scale bar + Section earthwork summary readout
      this._drawSectionOverlay(ctx, w, h, plane, cutSectionTotal, fillSectionTotal, slices, pal);

      ctx.restore();
    }

    _drawElevationGrid(ctx, w, h, pal) {
      const topZ = this.screenToSec(0, 0).z;
      const botZ = this.screenToSec(0, h).z;
      const minZ = Math.floor(Math.min(botZ, topZ) / 5) * 5;
      const maxZ = Math.ceil(Math.max(botZ, topZ) / 5) * 5;

      ctx.save();
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (let z = minZ; z <= maxZ; z += 5) {
        const py = this.secToScreen(0, z).y;
        ctx.strokeStyle = (z % 10 === 0) ? pal.gridMajor : pal.gridMinor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
        if (z % 5 === 0) {
          ctx.fillStyle = pal.inkMuted;
          ctx.fillText(`${z}m`, 8, py - 2);
        }
      }
      ctx.restore();
    }

    _drawSiteBoundaryTicks(ctx, basis, h, pal) {
      const sb = window.GROUNDWORK_SITE.siteBoundary;
      if (!sb || sb.length < 3) return;
      const eng = window.GROUNDWORK_ENGINE;
      const hits = [];
      for (let i = 0; i < sb.length; i++) {
        const a = eng.worldToPlane(sb[i][0], sb[i][1], basis);
        const b = eng.worldToPlane(sb[(i + 1) % sb.length][0], sb[(i + 1) % sb.length][1], basis);
        if ((a.depth >= 0 && b.depth <= 0) || (a.depth <= 0 && b.depth >= 0)) {
          const den = a.depth - b.depth;
          if (Math.abs(den) > 1e-8) {
            const t = a.depth / den;
            if (t >= 0 && t <= 1) {
              const s = a.s + t * (b.s - a.s);
              const wp = eng.planeToWorld(s, 0, basis);
              hits.push({ s, z: eng.getGroundZ(wp.x, wp.y) });
            }
          }
        }
      }
      if (!hits.length) return;
      ctx.save();
      ctx.strokeStyle = pal.plotTick;
      ctx.setLineDash([4, 4]);
      ctx.font = '9.5px sans-serif';
      ctx.fillStyle = pal.projText;
      ctx.textAlign = 'center';
      for (const hit of hits) {
        const sp = this.secToScreen(hit.s, hit.z);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - 26);
        ctx.lineTo(sp.x, sp.y + 18);
        ctx.stroke();
        ctx.fillText('Plot Edge', sp.x, sp.y - 30);
      }
      ctx.restore();
    }

    _drawSoilPoly(ctx, poly, fillRgba, strokeColor, dir) {
      if (!poly || poly.length < 3) return;
      const tracePoly = () => {
        ctx.beginPath();
        for (let i = 0; i < poly.length; i++) {
          const sp = this.secToScreen(poly[i].s, poly[i].z);
          if (i === 0) ctx.moveTo(sp.x, sp.y);
          else ctx.lineTo(sp.x, sp.y);
        }
        ctx.closePath();
      };

      ctx.save();
      tracePoly();
      ctx.fillStyle = fillRgba;
      ctx.fill();

      // Clean diagonal hatch clipped strictly inside Cut/Fill region
      ctx.save();
      ctx.clip();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pt of poly) {
        const sp = this.secToScreen(pt.s, pt.z);
        if (sp.x < minX) minX = sp.x;
        if (sp.x > maxX) maxX = sp.x;
        if (sp.y < minY) minY = sp.y;
        if (sp.y > maxY) maxY = sp.y;
      }
      ctx.strokeStyle = strokeColor;
      ctx.globalAlpha = 0.42;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const span = (maxY - minY) + 20;
      for (let x = minX - span; x <= maxX + span; x += 6) {
        if (dir > 0) {
          ctx.moveTo(x, minY - 4);
          ctx.lineTo(x + span, minY - 4 + span);
        } else {
          ctx.moveTo(x + span, minY - 4);
          ctx.lineTo(x, minY - 4 + span);
        }
      }
      ctx.stroke();
      ctx.restore();

      // Rebuild polygon path because ctx.restore() does not restore canvas path
      tracePoly();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.restore();
    }

    _drawSectionDimension(ctx, dim, isDraft, isSelected, pal) {
      const s1 = dim.s1, z1 = dim.z1, s2 = dim.s2, z2 = dim.z2;
      const p1 = this.secToScreen(s1, z1);
      const p2 = this.secToScreen(s2, z2);
      const ds = Math.abs(s2 - s1);
      const dz = z2 - z1;
      const dist = Math.hypot(ds, dz);
      const slope = ds > 0.1 ? (Math.abs(dz) / ds) * 100 : 0;
      const screenDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

      ctx.save();
      ctx.strokeStyle = isDraft ? pal.dimDraft : pal.dimStroke;
      ctx.lineWidth = isSelected ? 1.9 : 1.25;
      if (isDraft) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const p of [p1, p2]) {
        ctx.fillStyle = isSelected ? pal.gripFill : pal.dimStroke;
        ctx.strokeStyle = isDraft ? pal.dimDraft : pal.dimStroke;
        ctx.lineWidth = isSelected ? 1.6 : 1.1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, isSelected ? 5.0 : 3.0, 0, Math.PI * 2);
        ctx.fill();
        if (isSelected) ctx.stroke();
      }

      const showBox = isDraft || isSelected || (this.cam.pxPerM >= 5.2 && screenDist >= 54);
      if (showBox) {
        const mx = (p1.x + p2.x) * 0.5;
        const my = (p1.y + p2.y) * 0.5;
        const txt = `${dist.toFixed(2)} m (ΔS ${ds.toFixed(1)} · ΔZ ${dz >= 0 ? '+' : ''}${dz.toFixed(1)}m · ${slope.toFixed(0)}%)`;
        ctx.font = '500 10px ui-monospace, monospace';
        const tw = ctx.measureText(txt).width + 10;
        const bx = mx - tw * 0.5;
        const by = my - 17;
        const bh = 16;
        ctx.fillStyle = pal.badgeBg;
        ctx.strokeStyle = isSelected ? pal.ink : pal.badgeBorder;
        ctx.lineWidth = isSelected ? 1.6 : 1;
        ctx.fillRect(bx, by, tw, bh);
        ctx.strokeRect(bx, by, tw, bh);
        ctx.fillStyle = pal.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, mx, by + bh * 0.5);
        if (!isDraft && dim.id) {
          this.dimHitBoxes.push({ id: dim.id, x: bx, y: by, w: tw, h: bh });
        }
      }
      ctx.restore();
    }

    _resolveAnnColor(colorVal, pal) {
      return (colorVal && colorVal !== 'ink') ? colorVal : pal.ink;
    }

    _drawCap(ctx, pt, dirX, dirY, capType, sw, color) {
      if (!capType || capType === 'none') return;
      const ang = Math.atan2(dirY, dirX);
      const sz = 7 + sw * 1.4;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1.2, sw);
      if (capType === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x - Math.cos(ang - 0.42) * sz, pt.y - Math.sin(ang - 0.42) * sz);
        ctx.lineTo(pt.x - Math.cos(ang + 0.42) * sz, pt.y - Math.sin(ang + 0.42) * sz);
        ctx.closePath();
        ctx.fill();
      } else if (capType === 'open-arrow') {
        ctx.beginPath();
        ctx.moveTo(pt.x - Math.cos(ang - 0.45) * sz, pt.y - Math.sin(ang - 0.45) * sz);
        ctx.lineTo(pt.x, pt.y);
        ctx.lineTo(pt.x - Math.cos(ang + 0.45) * sz, pt.y - Math.sin(ang + 0.45) * sz);
        ctx.stroke();
      } else if (capType === 'dot') {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5 + sw * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else if (capType === 'tick') {
        const px = -dirY, py = dirX;
        const ts = 5 + sw;
        ctx.beginPath();
        ctx.moveTo(pt.x - (dirX * 0.4 + px) * ts * 0.6, pt.y - (dirY * 0.4 + py) * ts * 0.6);
        ctx.lineTo(pt.x + (dirX * 0.4 + px) * ts * 0.6, pt.y + (dirY * 0.4 + py) * ts * 0.6);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawLineAnnotation(ctx, ann, isDraft, isSelected, pal) {
      const p1 = this.secToScreen(ann.p1.s, ann.p1.z);
      const p2 = this.secToScreen(ann.p2.s, ann.p2.z);
      const col = this._resolveAnnColor(ann.color, pal);
      const sw = ann.strokeWidth || 1.5;

      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = isSelected ? sw + 0.8 : sw;
      if (ann.dashed || isDraft) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        const ux = dx / len, uy = dy / len;
        this._drawCap(ctx, p1, -ux, -uy, ann.startCap || 'none', sw, col);
        this._drawCap(ctx, p2, ux, uy, ann.endCap || 'arrow', sw, col);
      }

      if (isSelected) {
        for (const p of [p1, p2]) {
          ctx.fillStyle = pal.gripFill;
          ctx.strokeStyle = pal.ink;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5.0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    _drawTextAnnotation(ctx, ann, isSelected, pal) {
      const p = this.secToScreen(ann.s, ann.z);
      const col = this._resolveAnnColor(ann.color, pal);
      const fs = ann.fontSize || 12;
      const label = ann.text || '';
      if (!label) return;

      ctx.save();
      ctx.font = `600 ${fs}px sans-serif`;
      const tw = ctx.measureText(label).width + 12;
      const th = fs + 8;
      const bx = p.x - tw * 0.5;
      const by = p.y - th * 0.5;

      if (ann.boxed || isSelected) {
        ctx.fillStyle = pal.badgeBg;
        ctx.strokeStyle = isSelected ? pal.ink : col;
        ctx.lineWidth = isSelected ? 1.4 : 1;
        ctx.fillRect(bx, by, tw, th);
        ctx.strokeRect(bx, by, tw, th);
      } else {
        ctx.strokeStyle = pal.bg;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText(label, p.x, p.y);
      }

      ctx.fillStyle = col;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, p.x, p.y);
      this.annHitBoxes.push({ id: ann.id, x: bx, y: by, w: tw, h: th });
      ctx.restore();
    }

    _drawSectionOverlay(ctx, w, h, plane, cutSectionTotal, fillSectionTotal, slices, pal) {
      // Scale bar bottom right
      const targetPx = 85;
      const rawM = targetPx / this.cam.pxPerM;
      const steps = [1, 2, 5, 10, 20, 25, 50];
      let barM = steps[0];
      for (const st of steps) {
        if (st <= rawM * 1.4) barM = st;
      }
      const barPx = barM * this.cam.pxPerM;
      const bx = w - 20 - barPx;
      const by = h - 18;
      ctx.save();
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + barPx, by);
      ctx.lineTo(bx + barPx, by - 4);
      ctx.stroke();
      ctx.fillStyle = pal.ink;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${barM} m (1:1 H/V)`, bx + barPx * 0.5, by - 7);

      // Legend & Cut/Fill tally for this Section bottom left
      const cutCount = slices.filter(s => s.kind === 'cut').length;
      const summary = `Sec ${plane.name}–${plane.name}' (${cutCount} cut) · Cut: ${cutSectionTotal.toFixed(1)} m³ · Fill: ${fillSectionTotal.toFixed(1)} m³ · Net: ${(cutSectionTotal - fillSectionTotal >= 0 ? '+' : '')}${(cutSectionTotal - fillSectionTotal).toFixed(1)} m³`;
      ctx.font = '11px ui-monospace, monospace';
      const sw = ctx.measureText(summary).width + 16;
      ctx.fillStyle = pal.summaryBg;
      ctx.strokeStyle = pal.summaryBorder;
      ctx.lineWidth = 1;
      ctx.fillRect(10, h - 30, sw, 22);
      ctx.strokeRect(10, h - 30, sw, 22);
      ctx.fillStyle = pal.ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(summary, 18, h - 19);
      ctx.restore();
    }

    _rgba(hex, a) {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (!m) return `rgba(120,120,120,${a})`;
      return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
    }

    exportSVG() {
      const w = Math.max(900, this.canvas.clientWidth || 1000);
      const h = Math.max(360, this.canvas.clientHeight || 420);
      const state = this.api.getState();
      const eng = window.GROUNDWORK_ENGINE;
      const prog = window.GROUNDWORK_PROGRAM;
      const plane = this.api.getActivePlane();
      if (!plane) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

      const pal = this._palette();
      const toS = (s, z) => ({
        x: (w * 0.5 + (s - this.cam.cs) * this.cam.pxPerM).toFixed(2),
        y: (h * 0.5 - (z - this.cam.cz) * this.cam.pxPerM).toFixed(2)
      });

      const parts = [];
      parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
      parts.push(`<rect width="${w}" height="${h}" fill="${pal.bg}"/>`);

      const { pts } = eng.sliceTerrainAlongPlane(plane, 110, 0.4);
      if (pts.length > 1) {
        const dLine = pts.map((p, i) => {
          const sp = toS(p.s, p.z);
          return `${i === 0 ? 'M' : 'L'}${sp.x},${sp.y}`;
        }).join(' ');
        const first = toS(pts[0].s, pts[0].z);
        const last = toS(pts[pts.length - 1].s, pts[pts.length - 1].z);
        parts.push(`<path d="M${first.x},${h} ${dLine.replace(/^M/, 'L')} L${last.x},${h} Z" fill="${pal.earthFill}"/>`);
        parts.push(`<path d="${dLine}" fill="none" stroke="${pal.groundLine}" stroke-width="1.6"/>`);
      }

      const slices = [];
      for (const vol of state.volumes) {
        const sl = eng.sliceVolumeWithPlane(vol, plane, state.useGross, plane.projDepth || 18);
        if (sl) slices.push(sl);
      }

      for (const sl of slices) {
        if (sl.kind !== 'cut') continue;
        for (const poly of sl.cutPolys) {
          const d = poly.map((p, i) => { const sp = toS(p.s, p.z); return `${i ? 'L' : 'M'}${sp.x},${sp.y}`; }).join(' ') + ' Z';
          parts.push(`<path d="${d}" fill="${pal.cutStroke}" fill-opacity="0.38" stroke="${pal.cutStroke}" stroke-width="1.2"/>`);
        }
        for (const poly of sl.fillPolys) {
          const d = poly.map((p, i) => { const sp = toS(p.s, p.z); return `${i ? 'L' : 'M'}${sp.x},${sp.y}`; }).join(' ') + ' Z';
          parts.push(`<path d="${d}" fill="${pal.fillStroke}" fill-opacity="0.42" stroke="${pal.fillStroke}" stroke-width="1.2"/>`);
        }
        const p1 = toS(sl.sMin, sl.zTop);
        const p2 = toS(sl.sMax, sl.zBase);
        const bw = Math.max(4, parseFloat(p2.x) - parseFloat(p1.x));
        const bh = Math.max(4, parseFloat(p2.y) - parseFloat(p1.y));
        const cat = prog.getSpaceStyle(sl.vol);
        parts.push(`<rect x="${p1.x}" y="${p1.y}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="${cat.color}" fill-opacity="0.25" stroke="${cat.color}" stroke-width="1.6"/>`);
        const cx = (parseFloat(p1.x) + bw * 0.5).toFixed(1);
        const cy = (parseFloat(p1.y) + bh * 0.5).toFixed(1);
        parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-family="sans-serif" font-size="10.5" font-weight="600" fill="${pal.ink}">${this._esc((sl.vol.ref || sl.vol.id) + ' ' + sl.vol.short + ' (' + sl.dims.totalArea.toFixed(0) + 'm²)')}</text>`);
      }

      if (state.layers.annotations) {
        for (const ann of (state.annotations || []).filter(a => a.view === 'section' && a.planeId === plane.id)) {
          const col = this._resolveAnnColor(ann.color, pal);
          if (ann.type === 'line') {
            const p1 = toS(ann.p1.s, ann.p1.z), p2 = toS(ann.p2.s, ann.p2.z);
            const dash = ann.dashed ? ' stroke-dasharray="5 4"' : '';
            parts.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${col}" stroke-width="${ann.strokeWidth || 1.5}"${dash}/>`);
          } else if (ann.type === 'text') {
            const p = toS(ann.s, ann.z);
            parts.push(`<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="${ann.fontSize || 12}" font-weight="600" fill="${col}">${this._esc(ann.text || '')}</text>`);
          }
        }
      }

      parts.push('</svg>');
      return parts.join('\n');
    }

    _esc(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  window.GroundworkSectionView = SectionView;
})();
