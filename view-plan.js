/* Plan Viewport: Interactive True-Scale Bubble Diagram, Keyword Bridges, Grouping, Clipping Plane & Dimensions */
(function () {
  class PlanView {
    constructor(canvas, api) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.api = api;

      const sb = window.GROUNDWORK_SITE.meta.siteBounds;
      this.cam = {
        cx: (sb.minX + sb.maxX) * 0.5,
        cy: (sb.minY + sb.maxY) * 0.5,
        pxPerM: 4.6
      };

      this.hoverId = null;
      this.hoverItem = null;
      this.dragState = null;
      this.dimDraft = null;
      this.lineDraft = null;
      this.dimHitBoxes = [];
      this.sectionTextBoxes = [];
      this.annHitBoxes = [];
      this.marquee = null;
      this.spaceHeld = false;
      this.cursorWorld = null;

      this._bindEvents();
    }

    fitSite() {
      const sb = window.GROUNDWORK_SITE.meta.siteBounds;
      const w = this.canvas.clientWidth || 800;
      const h = this.canvas.clientHeight || 600;
      const siteW = Math.max(40, sb.maxX - sb.minX + 36);
      const siteH = Math.max(40, sb.maxY - sb.minY + 36);
      this.cam.cx = (sb.minX + sb.maxX) * 0.5;
      this.cam.cy = (sb.minY + sb.maxY) * 0.5;
      this.cam.pxPerM = Math.max(1.5, Math.min(20, Math.min(w / siteW, h / siteH)));
      this.render();
    }

    worldToScreen(wx, wy) {
      const w = this.canvas.clientWidth || 1;
      const h = this.canvas.clientHeight || 1;
      return {
        x: w * 0.5 + (wx - this.cam.cx) * this.cam.pxPerM,
        y: h * 0.5 - (wy - this.cam.cy) * this.cam.pxPerM
      };
    }

    screenToWorld(sx, sy) {
      const w = this.canvas.clientWidth || 1;
      const h = this.canvas.clientHeight || 1;
      return {
        x: this.cam.cx + (sx - w * 0.5) / this.cam.pxPerM,
        y: this.cam.cy - (sy - h * 0.5) / this.cam.pxPerM
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
        const before = this.screenToWorld(pos.x, pos.y);
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.cam.pxPerM = Math.max(1.2, Math.min(38, this.cam.pxPerM * factor));
        const after = this.screenToWorld(pos.x, pos.y);
        this.cam.cx += before.x - after.x;
        this.cam.cy += before.y - after.y;
        this.render();
      }, { passive: false });

      this.canvas.addEventListener('dblclick', (e) => {
        const pos = this._getPointerPos(e);
        const state = this.api.getState();
        if (!state.layers.annotations) return;
        const annHit = this._hitTestAnnotations(pos.x, pos.y);
        if (annHit && annHit.kind === 'text') {
          this.api.openInlineTextEditor({
            view: 'plan',
            clientX: e.clientX,
            clientY: e.clientY,
            existingId: annHit.ann.id,
            initialText: annHit.ann.text
          });
        }
      });

      this.canvas.addEventListener('pointerdown', (e) => {
        const pos = this._getPointerPos(e);
        const world = this.screenToWorld(pos.x, pos.y);
        const state = this.api.getState();

        // Pan on middle button, right button, or Space + left button
        if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceHeld)) {
          this.dragState = {
            type: 'pan',
            startX: pos.x,
            startY: pos.y,
            origCx: this.cam.cx,
            origCy: this.cam.cy
          };
          this.canvas.setPointerCapture(e.pointerId);
          return;
        }

        if (e.button !== 0) return;

        // Dimension tool
        if (state.tool === 'dimension') {
          const z = window.GROUNDWORK_ENGINE.getGroundZ(world.x, world.y);
          const pt = { x: world.x, y: world.y, z };
          if (!this.dimDraft) {
            this.dimDraft = { p1: pt, p2: pt };
          } else {
            const dim = this.api.addDimension('plan', this.dimDraft.p1, pt);
            this.dimDraft = null;
            if (dim) this.api.selectItem('dim', dim.id);
          }
          this.render();
          return;
        }

        // Line / Arrow annotation tool (supports click-drag OR click-click)
        if (state.tool === 'line') {
          if (!this.lineDraft) {
            this.lineDraft = {
              p1: { x: world.x, y: world.y },
              p2: { x: world.x, y: world.y },
              startPos: pos,
              moved: false
            };
            this.dragState = { type: 'line-draw' };
            this.canvas.setPointerCapture(e.pointerId);
          } else {
            const p2 = this._snapAnglePoint(this.lineDraft.p1, world, e.shiftKey);
            if (Math.hypot(p2.x - this.lineDraft.p1.x, p2.y - this.lineDraft.p1.y) > 0.25) {
              this.api.addAnnotation({
                type: 'line',
                view: 'plan',
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
            view: 'plan',
            clientX: e.clientX,
            clientY: e.clientY,
            worldPos: { x: world.x, y: world.y }
          });
          return;
        }

        // Section plane tool: active handle drag or draw new line
        if (state.tool === 'section') {
          const secHandle = this._hitTestSectionHandles(pos.x, pos.y, true);
          if (secHandle) {
            this.dragState = {
              type: secHandle === 'center' || secHandle === 'body' ? 'sec-move' : 'sec-rotate',
              handle: secHandle,
              startWorld: world,
              origPlane: { ...this.api.getActivePlane() }
            };
            this.canvas.setPointerCapture(e.pointerId);
            return;
          }
          this.dragState = { type: 'sec-draw', p1: world };
          this.canvas.setPointerCapture(e.pointerId);
          return;
        }

        // 1. Selected dimension endpoints (p1 / p2)
        const dimEpHit = this._hitTestSelectedDimEndpoint(pos.x, pos.y);
        if (dimEpHit) {
          this.api.pushUndo();
          this.dragState = {
            type: 'dim-endpoint',
            dimId: dimEpHit.dim.id,
            endpoint: dimEpHit.endpoint
          };
          this.canvas.setPointerCapture(e.pointerId);
          return;
        }

        // 2. Selected line annotation endpoints (p1 / p2)
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

        // 3. Active section plane handles (ONLY when section is already selected!)
        if (this._isSectionActive(state)) {
          const secHandle = this._hitTestSectionHandles(pos.x, pos.y, true);
          if (secHandle) {
            this.api.pushUndo();
            this.dragState = {
              type: (secHandle === 'center' || secHandle === 'body') ? 'sec-move' : 'sec-rotate',
              handle: secHandle,
              startWorld: world,
              origPlane: { ...this.api.getActivePlane() }
            };
            this.canvas.setPointerCapture(e.pointerId);
            return;
          }
        }

        // 4. Resize/rotate handles on currently selected space (always grabbable when visible)
        const handleHit = this._hitTestHandles(pos.x, pos.y);
        if (handleHit) {
          const vol = this.api.getVolume(handleHit.id);
          if (vol) {
            this.api.pushUndo();
            this.dragState = {
              type: handleHit.kind === 'rotate' ? 'rotate' : 'resize',
              id: vol.id,
              handle: handleHit.kind,
              origVol: { ...vol }
            };
            this.canvas.setPointerCapture(e.pointerId);
            return;
          }
        }

        // 5. Dimension text box -> select & allow drag to move whole dimension
        const dimBoxHit = this._hitTestDimTextBox(pos.x, pos.y);
        if (dimBoxHit) {
          const dim = state.dimensions.find(d => d.id === dimBoxHit.id);
          if (dim) {
            this.api.selectItem('dim', dim.id);
            this.api.pushUndo();
            this.dragState = {
              type: 'dim-move',
              dimId: dim.id,
              startWorld: world,
              origP1: { ...dim.p1 },
              origP2: { ...dim.p2 }
            };
            this.canvas.setPointerCapture(e.pointerId);
            this.render();
            return;
          }
        }

        // 6. Annotations (Text & Line/Arrow) when visible
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
              startWorld: world,
              orig: ann.type === 'text'
                ? { x: ann.x, y: ann.y }
                : { p1: { ...ann.p1 }, p2: { ...ann.p2 } }
            };
            this.canvas.setPointerCapture(e.pointerId);
            this.render();
            return;
          }
        }

        // 7. Unselected section plane clickable ONLY from its text box
        const secBoxHit = this._hitTestSectionTextBoxes(pos.x, pos.y);
        if (secBoxHit) {
          const plane = this.api.getActivePlane();
          this.api.selectItem('section', plane ? plane.id : secBoxHit.planeId);
          this.dragState = {
            type: (secBoxHit.handle === 'a' || secBoxHit.handle === 'b') ? 'sec-rotate' : 'sec-move',
            handle: secBoxHit.handle,
            startPos: pos,
            startWorld: world,
            origPlane: { ...this.api.getActivePlane() }
          };
          this.canvas.setPointerCapture(e.pointerId);
          this.render();
          return;
        }

        // 8. Space bubble hit (topmost zOrder first)
        const hitVol = this._hitTestVolume(world.x, world.y);
        if (hitVol) {
          const alreadySelected = state.selectedIds.includes(hitVol.id);
          if (e.shiftKey) {
            this.api.toggleSelect(hitVol.id);
          } else if (!alreadySelected) {
            this.api.selectVolume(hitVol.id, e.detail < 2);
          }
          const dragIds = this.api.getState().selectedIds.slice();
          const origins = {};
          for (const id of dragIds) {
            const v = this.api.getVolume(id);
            if (v) {
              origins[id] = {
                x: v.x,
                y: v.y,
                zBase: v.zBase,
                gz: window.GROUNDWORK_ENGINE.getGroundZ(v.x, v.y)
              };
            }
          }
          this.api.pushUndo();
          this.dragState = {
            type: 'move',
            startWorld: world,
            primaryId: hitVol.id,
            origins,
            moved: false
          };
          this.canvas.setPointerCapture(e.pointerId);
          this.render();
          return;
        }

        // 9. Empty canvas -> clear selection + marquee select
        if (!e.shiftKey) {
          this.api.clearSelection();
        }
        this.dragState = {
          type: 'marquee',
          startPos: pos,
          currPos: pos
        };
        this.canvas.setPointerCapture(e.pointerId);
        this.render();
      });

      this.canvas.addEventListener('pointermove', (e) => {
        const pos = this._getPointerPos(e);
        const world = this.screenToWorld(pos.x, pos.y);
        this.cursorWorld = {
          x: world.x,
          y: world.y,
          z: window.GROUNDWORK_ENGINE.getGroundZ(world.x, world.y)
        };
        this.api.updateCursorReadout(this.cursorWorld);

        const state = this.api.getState();

        if (!this.dragState) {
          if (state.tool === 'dimension' && this.dimDraft) {
            this.dimDraft.p2 = { ...this.cursorWorld };
            this.render();
            return;
          }
          if (state.tool === 'line' && this.lineDraft) {
            this.lineDraft.p2 = this._snapAnglePoint(this.lineDraft.p1, world, e.shiftKey);
            this.render();
            return;
          }
          const hit = this._hitTestVolume(world.x, world.y);
          const nextHover = hit ? hit.id : null;
          if (nextHover !== this.hoverId) {
            this.hoverId = nextHover;
            this.render();
          }
          this._updateCursorStyle(pos.x, pos.y, hit);
          return;
        }

        if (this.dragState.type === 'pan') {
          const dx = (pos.x - this.dragState.startX) / this.cam.pxPerM;
          const dy = (pos.y - this.dragState.startY) / this.cam.pxPerM;
          this.cam.cx = this.dragState.origCx - dx;
          this.cam.cy = this.dragState.origCy + dy;
          this.render();
          return;
        }

        if (this.dragState.type === 'line-draw' && this.lineDraft) {
          if (Math.hypot(pos.x - this.lineDraft.startPos.x, pos.y - this.lineDraft.startPos.y) > 4) {
            this.lineDraft.moved = true;
          }
          this.lineDraft.p2 = this._snapAnglePoint(this.lineDraft.p1, world, e.shiftKey);
          this.render();
          return;
        }

        if (this.dragState.type === 'dim-endpoint') {
          const dim = state.dimensions.find(d => d.id === this.dragState.dimId);
          if (!dim) return;
          const otherPt = this.dragState.endpoint === 'p1' ? dim.p2 : dim.p1;
          const snapped = this._snapAnglePoint(otherPt, world, e.shiftKey);
          const nz = window.GROUNDWORK_ENGINE.getGroundZ(snapped.x, snapped.y);
          this.api.updateDimension(dim.id, {
            [this.dragState.endpoint]: { x: snapped.x, y: snapped.y, z: nz }
          }, { silentUndo: true });
          return;
        }

        if (this.dragState.type === 'dim-move') {
          const dx = world.x - this.dragState.startWorld.x;
          const dy = world.y - this.dragState.startWorld.y;
          const p1x = this.dragState.origP1.x + dx;
          const p1y = this.dragState.origP1.y + dy;
          const p2x = this.dragState.origP2.x + dx;
          const p2y = this.dragState.origP2.y + dy;
          this.api.updateDimension(this.dragState.dimId, {
            p1: { x: p1x, y: p1y, z: window.GROUNDWORK_ENGINE.getGroundZ(p1x, p1y) },
            p2: { x: p2x, y: p2y, z: window.GROUNDWORK_ENGINE.getGroundZ(p2x, p2y) }
          }, { silentUndo: true });
          return;
        }

        if (this.dragState.type === 'line-endpoint') {
          const ann = state.annotations.find(a => a.id === this.dragState.annId);
          if (!ann) return;
          const otherPt = this.dragState.endpoint === 'p1' ? ann.p2 : ann.p1;
          const snapped = this._snapAnglePoint(otherPt, world, e.shiftKey);
          this.api.updateAnnotation(ann.id, { [this.dragState.endpoint]: snapped }, { silentUndo: true });
          return;
        }

        if (this.dragState.type === 'ann-move') {
          const dx = world.x - this.dragState.startWorld.x;
          const dy = world.y - this.dragState.startWorld.y;
          if (this.dragState.kind === 'text') {
            this.api.updateAnnotation(this.dragState.annId, {
              x: this.dragState.orig.x + dx,
              y: this.dragState.orig.y + dy
            }, { silentUndo: true });
          } else {
            this.api.updateAnnotation(this.dragState.annId, {
              p1: { x: this.dragState.orig.p1.x + dx, y: this.dragState.orig.p1.y + dy },
              p2: { x: this.dragState.orig.p2.x + dx, y: this.dragState.orig.p2.y + dy }
            }, { silentUndo: true });
          }
          return;
        }

        if (this.dragState.type === 'move') {
          const dx = world.x - this.dragState.startWorld.x;
          const dy = world.y - this.dragState.startWorld.y;
          if (Math.hypot(dx, dy) > 0.02) this.dragState.moved = true;
          const updates = [];
          for (const [id, orig] of Object.entries(this.dragState.origins)) {
            const nx = orig.x + dx;
            const ny = orig.y + dy;
            const newGZ = window.GROUNDWORK_ENGINE.getGroundZ(nx, ny);
            const zOffset = orig.zBase - orig.gz;
            updates.push({ id, x: nx, y: ny, zBase: newGZ + zOffset });
          }
          this.api.updateVolumesBatch(updates, { silentUndo: true });
          return;
        }

        if (this.dragState.type === 'rotate') {
          const vol = this.api.getVolume(this.dragState.id);
          if (!vol) return;
          let ang = Math.atan2(world.y - vol.y, world.x - vol.x) - Math.PI * 0.5;
          if (e.shiftKey) {
            const step = Math.PI / 12; // 15 deg snap
            ang = Math.round(ang / step) * step;
          }
          this.api.updateVolume(vol.id, { rot: ang }, { silentUndo: true });
          return;
        }

        if (this.dragState.type === 'resize') {
          const orig = this.dragState.origVol;
          const dx = world.x - orig.x;
          const dy = world.y - orig.y;
          const c = Math.cos(orig.rot || 0);
          const s = Math.sin(orig.rot || 0);
          const lx = dx * c + dy * s;
          const ly = -dx * s + dy * c;

          const dims = window.GROUNDWORK_ENGINE.getEffectiveDims(orig, state.useGross);
          const lin = Math.sqrt(dims.grossFactor);
          const floors = Math.max(1, orig.floors || 1);
          const footprintArea = orig.area / floors;
          const locked = window.GROUNDWORK_PROGRAM.isAreaLocked(orig);

          let newW = orig.w;
          let newD = orig.d;
          const h = this.dragState.handle;

          if (!locked) {
            if (h.includes('e') || h.includes('w')) newW = Math.max(0.8, (Math.abs(lx) * 2) / lin);
            if (h.includes('n') || h.includes('s')) newD = Math.max(0.8, (Math.abs(ly) * 2) / lin);
            const newArea = Math.round(newW * newD * floors * 10) / 10;
            this.api.updateVolume(orig.id, { w: newW, d: newD, area: newArea }, { silentUndo: true });
          } else {
            const minSide = Math.min(1.5, Math.max(0.5, Math.sqrt(footprintArea) * 0.5));
            const maxSide = footprintArea / minSide;
            if (h === 'n' || h === 's') {
              newD = Math.max(minSide, Math.min(maxSide, (Math.abs(ly) * 2) / lin));
              newW = footprintArea / newD;
            } else {
              newW = Math.max(minSide, Math.min(maxSide, (Math.abs(lx) * 2) / lin));
              newD = footprintArea / newW;
            }
            this.api.updateVolume(orig.id, { w: newW, d: newD }, { silentUndo: true });
          }
          return;
        }

        if (this.dragState.type === 'sec-move') {
          if (this.dragState.startPos && Math.hypot(pos.x - this.dragState.startPos.x, pos.y - this.dragState.startPos.y) < 4) return;
          this.dragState.startPos = null;
          const dx = world.x - this.dragState.startWorld.x;
          const dy = world.y - this.dragState.startWorld.y;
          this.api.updateActivePlane({
            cx: this.dragState.origPlane.cx + dx,
            cy: this.dragState.origPlane.cy + dy
          });
          return;
        }

        if (this.dragState.type === 'sec-rotate') {
          if (this.dragState.startPos && Math.hypot(pos.x - this.dragState.startPos.x, pos.y - this.dragState.startPos.y) < 4) return;
          this.dragState.startPos = null;
          const orig = this.dragState.origPlane;
          let deg = Math.atan2(world.y - orig.cy, world.x - orig.cx) * 180 / Math.PI;
          if (this.dragState.handle === 'a') deg += 180;
          if (e.shiftKey) deg = Math.round(deg / 15) * 15;
          this.api.updateActivePlane({ angleDeg: deg });
          return;
        }

        if (this.dragState.type === 'sec-draw') {
          const p1 = this.dragState.p1;
          const dist = Math.hypot(world.x - p1.x, world.y - p1.y);
          if (dist > 2) {
            const cx = (p1.x + world.x) * 0.5;
            const cy = (p1.y + world.y) * 0.5;
            const angleDeg = Math.atan2(world.y - p1.y, world.x - p1.x) * 180 / Math.PI;
            this.api.updateActivePlane({ cx, cy, angleDeg, enabled: true });
          }
          return;
        }

        if (this.dragState.type === 'marquee') {
          this.dragState.currPos = pos;
          this.render();
        }
      });

      this.canvas.addEventListener('pointerup', (e) => {
        if (!this.dragState) return;
        if (this.dragState.type === 'line-draw' && this.lineDraft) {
          if (this.lineDraft.moved) {
            const p2 = this.lineDraft.p2;
            if (Math.hypot(p2.x - this.lineDraft.p1.x, p2.y - this.lineDraft.p1.y) > 0.25) {
              this.api.addAnnotation({
                type: 'line',
                view: 'plan',
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
        }
        if (this.dragState.type === 'marquee') {
          const a = this.screenToWorld(this.dragState.startPos.x, this.dragState.startPos.y);
          const b = this.screenToWorld(this.dragState.currPos.x, this.dragState.currPos.y);
          const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
          const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
          if (maxX - minX > 0.5 && maxY - minY > 0.5) {
            const hits = this.api.getState().volumes.filter(v =>
              v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY
            ).map(v => v.id);
            if (hits.length) this.api.setSelection(hits);
          }
        }
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        this.dragState = null;
        this.render();
      });

      // Drag-and-drop from Program Dock
      this.canvas.addEventListener('dragover', (e) => { e.preventDefault(); });
      this.canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        const spaceId = e.dataTransfer.getData('text/plain');
        if (!spaceId) return;
        const pos = this._getPointerPos(e);
        const world = this.screenToWorld(pos.x, pos.y);
        this.api.placeSpaceAt(spaceId, world.x, world.y);
      });
    }

    _snapAnglePoint(origin, target, shiftKey) {
      if (!shiftKey || !origin) return { x: target.x, y: target.y };
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) return { x: target.x, y: target.y };
      const step = Math.PI / 12; // 15 deg snap
      const ang = Math.round(Math.atan2(dy, dx) / step) * step;
      return { x: origin.x + Math.cos(ang) * dist, y: origin.y + Math.sin(ang) * dist };
    }

    _updateCursorStyle(sx, sy, hitVol) {
      const state = this.api.getState();
      if (this.spaceHeld) { this.canvas.style.cursor = 'grab'; return; }
      if (state.tool === 'text') { this.canvas.style.cursor = 'text'; return; }
      if (state.tool === 'dimension' || state.tool === 'section' || state.tool === 'line') {
        this.canvas.style.cursor = 'crosshair';
        return;
      }
      if (this._hitTestSelectedDimEndpoint(sx, sy) || this._hitTestSelectedLineEndpoint(sx, sy)) {
        this.canvas.style.cursor = 'pointer';
        return;
      }
      if (this._isSectionActive(state) && this._hitTestSectionHandles(sx, sy, true)) {
        this.canvas.style.cursor = 'move';
        return;
      }
      if (this._hitTestHandles(sx, sy)) { this.canvas.style.cursor = 'pointer'; return; }
      if (this._hitTestDimTextBox(sx, sy) || this._hitTestSectionTextBoxes(sx, sy)) {
        this.canvas.style.cursor = 'pointer';
        return;
      }
      if (state.layers.annotations && this._hitTestAnnotations(sx, sy)) {
        this.canvas.style.cursor = 'move';
        return;
      }
      this.canvas.style.cursor = hitVol ? 'move' : 'default';
    }

    _isSectionActive(state) {
      return !!(
        (state.selectedItem && state.selectedItem.kind === 'section') ||
        state.tool === 'section' ||
        (this.dragState && this.dragState.type && this.dragState.type.startsWith('sec-'))
      );
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
      if (!state.selectedItem || state.selectedItem.kind !== 'dim') return null;
      const dim = state.dimensions.find(d => d.id === state.selectedItem.id && d.view === 'plan');
      if (!dim) return null;
      const s1 = this.worldToScreen(dim.p1.x, dim.p1.y);
      const s2 = this.worldToScreen(dim.p2.x, dim.p2.y);
      if (Math.hypot(sx - s1.x, sy - s1.y) <= 9) return { dim, endpoint: 'p1' };
      if (Math.hypot(sx - s2.x, sy - s2.y) <= 9) return { dim, endpoint: 'p2' };
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
      if (!state.layers.annotations || !state.selectedItem || state.selectedItem.kind !== 'line') return null;
      const ann = state.annotations.find(a => a.id === state.selectedItem.id && a.view === 'plan');
      if (!ann) return null;
      const s1 = this.worldToScreen(ann.p1.x, ann.p1.y);
      const s2 = this.worldToScreen(ann.p2.x, ann.p2.y);
      if (Math.hypot(sx - s1.x, sy - s1.y) <= 9) return { ann, endpoint: 'p1' };
      if (Math.hypot(sx - s2.x, sy - s2.y) <= 9) return { ann, endpoint: 'p2' };
      return null;
    }

    _hitTestAnnotations(sx, sy) {
      const state = this.api.getState();
      if (!state.layers.annotations) return null;
      for (let i = this.annHitBoxes.length - 1; i >= 0; i--) {
        const b = this.annHitBoxes[i];
        if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) {
          const ann = state.annotations.find(a => a.id === b.id);
          if (ann) return { kind: 'text', ann };
        }
      }
      const lines = state.annotations.filter(a => a.view === 'plan' && a.type === 'line');
      for (let i = lines.length - 1; i >= 0; i--) {
        const ann = lines[i];
        const s1 = this.worldToScreen(ann.p1.x, ann.p1.y);
        const s2 = this.worldToScreen(ann.p2.x, ann.p2.y);
        if (this._distPointToSegment(sx, sy, s1.x, s1.y, s2.x, s2.y) <= 6) {
          return { kind: 'line', ann };
        }
      }
      return null;
    }

    _hitTestSectionTextBoxes(sx, sy) {
      for (let i = this.sectionTextBoxes.length - 1; i >= 0; i--) {
        const b = this.sectionTextBoxes[i];
        if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b;
      }
      return null;
    }

    _hitTestVolume(wx, wy) {
      const state = this.api.getState();
      const sorted = [...state.volumes].sort((a, b) => (b.zOrder || 0) - (a.zOrder || 0));
      for (const vol of sorted) {
        if (window.GROUNDWORK_ENGINE.pointInFootprint(wx, wy, vol, state.useGross)) {
          return vol;
        }
      }
      return null;
    }

    _getHandlesForVolume(vol, useGross) {
      const dims = window.GROUNDWORK_ENGINE.getEffectiveDims(vol, useGross);
      const hw = dims.w * 0.5;
      const hd = dims.d * 0.5;
      const c = Math.cos(vol.rot || 0);
      const s = Math.sin(vol.rot || 0);
      const toScreen = (lx, ly) => {
        const wx = vol.x + lx * c - ly * s;
        const wy = vol.y + lx * s + ly * c;
        return this.worldToScreen(wx, wy);
      };
      const rotOffset = Math.max(14 / this.cam.pxPerM, 1.5);
      return [
        { kind: 'n', ...toScreen(0, hd) },
        { kind: 's', ...toScreen(0, -hd) },
        { kind: 'e', ...toScreen(hw, 0) },
        { kind: 'w', ...toScreen(-hw, 0) },
        { kind: 'ne', ...toScreen(hw, hd) },
        { kind: 'nw', ...toScreen(-hw, hd) },
        { kind: 'se', ...toScreen(hw, -hd) },
        { kind: 'sw', ...toScreen(-hw, -hd) },
        { kind: 'rotate', ...toScreen(0, hd + rotOffset), anchor: toScreen(0, hd) }
      ];
    }

    _hitTestHandles(sx, sy) {
      const state = this.api.getState();
      if (state.selectedIds.length !== 1) return null;
      const vol = this.api.getVolume(state.selectedIds[0]);
      if (!vol) return null;
      const handles = this._getHandlesForVolume(vol, state.useGross);
      for (const h of handles) {
        if (Math.hypot(sx - h.x, sy - h.y) <= 8) {
          return { id: vol.id, kind: h.kind };
        }
      }
      return null;
    }

    _hitTestSectionHandles(sx, sy, onlyWhenActive) {
      const state = this.api.getState();
      if (onlyWhenActive && !this._isSectionActive(state)) return null;
      const plane = this.api.getActivePlane();
      if (!plane) return null;
      const basis = window.GROUNDWORK_ENGINE.getPlaneBasis(plane);
      const half = 65;
      const pA = this.worldToScreen(basis.cx - half * basis.tx, basis.cy - half * basis.ty);
      const pB = this.worldToScreen(basis.cx + half * basis.tx, basis.cy + half * basis.ty);
      const pC = this.worldToScreen(basis.cx, basis.cy);
      if (Math.hypot(sx - pC.x, sy - pC.y) <= 10) return 'center';
      if (Math.hypot(sx - pA.x, sy - pA.y) <= 12) return 'a';
      if (Math.hypot(sx - pB.x, sy - pB.y) <= 12) return 'b';
      if (this._distPointToSegment(sx, sy, pA.x, pA.y, pB.x, pB.y) <= 6) return 'body';
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
        gridMajor: 'rgba(236, 232, 223, 0.10)',
        gridMinor: 'rgba(236, 232, 223, 0.04)',
        roadFill: 'rgba(66, 62, 55, 0.65)',
        roadStroke: '#524d44',
        roadAxis: '#6b655a',
        water: '#6a94b0',
        contourMinor: 'rgba(175, 166, 150, 0.22)',
        contourMajor: 'rgba(190, 180, 162, 0.52)',
        contourText: '#a49d91',
        bldgFill: 'rgba(72, 68, 60, 0.55)',
        bldgStroke: 'rgba(130, 124, 112, 0.65)',
        boundaryStroke: '#e6e1d6',
        boundaryFill: 'rgba(236, 232, 223, 0.05)',
        treeFill: 'rgba(116, 145, 108, 0.16)',
        treeStroke: 'rgba(135, 164, 126, 0.36)',
        linkFocus: 'rgba(236, 232, 223, 0.78)',
        linkDim: 'rgba(180, 173, 160, 0.20)',
        linkDirect: 'rgba(220, 214, 202, 0.45)',
        linkIndirect: 'rgba(170, 164, 152, 0.22)',
        conflictLine: 'rgba(217, 119, 98, 0.80)',
        conflictBg: '#21201d',
        conflictText: '#e08975',
        pillBg: 'rgba(36, 34, 30, 0.95)',
        pillText: '#ece8df',
        ink: '#ece8df',
        inkSub: '#cbc4b7',
        inkMuted: '#a49d91',
        inkSoft: '#bdb5a5',
        neutralMix: '#524d44',
        floorLine: 'rgba(236, 232, 223, 0.32)',
        handleFill: '#21201d',
        sectionStroke: '#ece8df',
        sectionMuted: 'rgba(236, 232, 223, 0.45)',
        sectionCenterOff: '#21201d',
        dimDraft: '#a49d91',
        dimStroke: '#ece8df',
        dimBg: 'rgba(33, 32, 29, 0.94)',
        dimBorder: '#504b42',
        marqueeFill: 'rgba(236, 232, 223, 0.07)',
        marqueeStroke: 'rgba(236, 232, 223, 0.55)',
        northBg: 'rgba(33, 32, 29, 0.88)',
        northRing: '#504b42'
      } : {
        bg: '#f6f4ef',
        gridMajor: 'rgba(34, 32, 29, 0.09)',
        gridMinor: 'rgba(34, 32, 29, 0.035)',
        roadFill: 'rgba(218, 211, 196, 0.55)',
        roadStroke: '#c8c0af',
        roadAxis: '#b9b09d',
        water: '#7395ab',
        contourMinor: 'rgba(155, 146, 130, 0.28)',
        contourMajor: 'rgba(128, 118, 102, 0.55)',
        contourText: '#857d6e',
        bldgFill: 'rgba(196, 189, 174, 0.45)',
        bldgStroke: 'rgba(140, 134, 122, 0.65)',
        boundaryStroke: '#24221f',
        boundaryFill: 'rgba(255, 255, 255, 0.14)',
        treeFill: 'rgba(116, 140, 108, 0.16)',
        treeStroke: 'rgba(95, 118, 88, 0.35)',
        linkFocus: 'rgba(34, 32, 29, 0.72)',
        linkDim: 'rgba(130, 124, 112, 0.16)',
        linkDirect: 'rgba(60, 56, 48, 0.42)',
        linkIndirect: 'rgba(110, 104, 94, 0.20)',
        conflictLine: 'rgba(166, 68, 48, 0.72)',
        conflictBg: '#fcfbf8',
        conflictText: '#9c4030',
        pillBg: 'rgba(255, 253, 247, 0.95)',
        pillText: '#22201d',
        ink: '#22201d',
        inkSub: '#403c35',
        inkMuted: '#6d685f',
        inkSoft: '#5c574e',
        neutralMix: '#b5afa2',
        floorLine: 'rgba(34, 32, 29, 0.28)',
        handleFill: '#fcfbf8',
        sectionStroke: '#22201d',
        sectionMuted: 'rgba(34, 32, 29, 0.45)',
        sectionCenterOff: '#fcfbf8',
        dimDraft: '#6d685f',
        dimStroke: '#22201d',
        dimBg: 'rgba(252, 251, 248, 0.94)',
        dimBorder: '#bdb5a5',
        marqueeFill: 'rgba(36, 34, 31, 0.06)',
        marqueeStroke: 'rgba(36, 34, 31, 0.55)',
        northBg: 'rgba(252, 251, 248, 0.85)',
        northRing: '#bdb5a5'
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
      this.sectionTextBoxes = [];
      this.annHitBoxes = [];

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, w, h);

      const state = this.api.getState();
      const site = window.GROUNDWORK_SITE;
      const eng = window.GROUNDWORK_ENGINE;
      const prog = window.GROUNDWORK_PROGRAM;

      // Roads
      if (state.layers.roads && site.roadContours) {
        ctx.fillStyle = pal.roadFill;
        ctx.strokeStyle = pal.roadStroke;
        ctx.lineWidth = 1;
        for (const rc of site.roadContours) {
          this._strokePoly(ctx, rc.pts, rc.closed, true);
        }
        ctx.strokeStyle = pal.roadAxis;
        ctx.setLineDash([4, 4]);
        for (const ra of (site.roadAxes || [])) {
          this._strokePoly(ctx, ra.pts, false, false);
        }
        ctx.setLineDash([]);
      }

      // Waterways
      if (state.layers.waterways && site.waterways) {
        ctx.strokeStyle = pal.water;
        ctx.lineWidth = 2;
        for (const ww of site.waterways) {
          this._strokePoly(ctx, ww.pts, false, false);
        }
      }

      // Generated 2m minor contours + Rhino 5m major contours
      if (state.layers.contours) {
        const contours2m = eng.getGeneratedContours(2);
        ctx.strokeStyle = pal.contourMinor;
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        for (const grp of contours2m) {
          if (grp.isMajor) continue;
          for (const [p1, p2] of grp.lines) {
            const s1 = this.worldToScreen(p1[0], p1[1]);
            const s2 = this.worldToScreen(p2[0], p2[1]);
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
          }
        }
        ctx.stroke();

        // 5m major contours
        ctx.strokeStyle = pal.contourMajor;
        ctx.lineWidth = 1.1;
        ctx.fillStyle = pal.contourText;
        ctx.font = '10px ui-monospace, monospace';
        for (const c5 of (site.contours5m || [])) {
          this._strokePoly(ctx, c5.pts, c5.closed, false);
          if (c5.pts.length > 2) {
            const mid = c5.pts[Math.floor(c5.pts.length * 0.5)];
            const sm = this.worldToScreen(mid[0], mid[1]);
            if (sm.x > 20 && sm.x < w - 30 && sm.y > 20 && sm.y < h - 20) {
              ctx.fillText(Math.round(c5.z) + 'm', sm.x + 3, sm.y - 3);
            }
          }
        }
      }

      // Context buildings
      if (state.layers.buildings && site.buildings) {
        ctx.fillStyle = pal.bldgFill;
        ctx.strokeStyle = pal.bldgStroke;
        ctx.lineWidth = 1;
        for (const b of site.buildings) {
          if (eng.isBuildingInsidePlot(b) && !state.layers.plotBuildings) continue;
          if (b.fp && b.fp.length >= 3) {
            this._strokePoly(ctx, b.fp, true, true);
          }
        }
      }

      // Site Boundary
      if (state.layers.siteBoundary && site.siteBoundary) {
        ctx.save();
        ctx.strokeStyle = pal.boundaryStroke;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([8, 4]);
        this._strokePoly(ctx, site.siteBoundary, true, false);
        ctx.setLineDash([]);
        ctx.fillStyle = pal.boundaryFill;
        this._strokePoly(ctx, site.siteBoundary, true, true, true);
        ctx.restore();
      }

      // Trees
      if (state.layers.trees && site.trees) {
        ctx.fillStyle = pal.treeFill;
        ctx.strokeStyle = pal.treeStroke;
        ctx.lineWidth = 0.8;
        for (const t of site.trees) {
          const sp = this.worldToScreen(t[0], t[1]);
          const rad = Math.max(2, t[4] * this.cam.pxPerM);
          if (sp.x < -rad || sp.x > w + rad || sp.y < -rad || sp.y > h + rad) continue;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Unselected section line draws behind bubbles so labels stay uncluttered
      const secActive = this._isSectionActive(state);
      if (!secActive) {
        this._drawSectionLineAndArrows(ctx, pal, false);
      }

      // Determine focus space for relevance grading (dragged or primary selected or hovered)
      const focusId = (this.dragState && this.dragState.primaryId) ||
        (state.selectedIds.length === 1 ? state.selectedIds[0] : null) ||
        this.hoverId;
      const focusVol = focusId ? this.api.getVolume(focusId) : null;
      const activeKws = this.api.getActiveKeywordSet();

      // Compute proximity merges & relevance bridges BEFORE drawing bubbles (lines beneath labels, badges above!)
      const bridges = [];
      const conflicts = [];
      const mergedKwsByVol = new Map();
      const vols = [...state.volumes].sort((a, b) => (a.zOrder || 0) - (b.zOrder || 0));

      for (let i = 0; i < vols.length; i++) {
        for (let j = i + 1; j < vols.length; j++) {
          const A = vols[i], B = vols[j];
          const edgeDist = eng.minEdgeDistanceRects(A, B, state.useGross);
          if (edgeDist > 6.5) continue;
          const rel = prog.computeRelevance(A, B, activeKws);
          if (rel.hasConflict && edgeDist <= 5.0) {
            conflicts.push({ A, B, edgeDist });
          }
          if (rel.sharedKeywords.length > 0 || rel.hasDirectLink) {
            if (rel.score >= 0.25 || rel.hasDirectLink) {
              bridges.push({ A, B, rel, edgeDist });
              if (!mergedKwsByVol.has(A.id)) mergedKwsByVol.set(A.id, new Set());
              if (!mergedKwsByVol.has(B.id)) mergedKwsByVol.set(B.id, new Set());
              for (const k of rel.sharedKeywords) {
                mergedKwsByVol.get(A.id).add(k);
                mergedKwsByVol.get(B.id).add(k);
              }
            }
          }
        }
      }

      // Draw proximity connection hairlines underneath bubbles
      for (const br of bridges) {
        const isFocusLink = focusVol && (br.A.id === focusVol.id || br.B.id === focusVol.id);
        const pA = this.worldToScreen(br.A.x, br.A.y);
        const pB = this.worldToScreen(br.B.x, br.B.y);
        ctx.save();
        if (focusVol) {
          ctx.strokeStyle = isFocusLink ? pal.linkFocus : pal.linkDim;
          ctx.lineWidth = isFocusLink ? 1.7 : 0.8;
        } else {
          ctx.strokeStyle = br.rel.hasDirectLink ? pal.linkDirect : pal.linkIndirect;
          ctx.lineWidth = br.rel.hasDirectLink ? 1.2 : 0.8;
        }
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
        ctx.restore();
      }

      // Draw bubbles
      for (const vol of vols) {
        const isSelected = state.selectedIds.includes(vol.id);
        const isFocus = focusVol && focusVol.id === vol.id;
        let rel = null;
        if (focusVol && !isFocus) {
          rel = prog.computeRelevance(focusVol, vol, activeKws);
        }
        this._drawBubble(ctx, vol, state.useGross, isSelected, isFocus, rel, activeKws, mergedKwsByVol.get(vol.id), pal);
      }

      // Draw conflict warnings
      for (const cf of conflicts) {
        const pA = this.worldToScreen(cf.A.x, cf.A.y);
        const pB = this.worldToScreen(cf.B.x, cf.B.y);
        const mx = (pA.x + pB.x) * 0.5;
        const my = (pA.y + pB.y) * 0.5;
        ctx.save();
        ctx.strokeStyle = pal.conflictLine;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = pal.conflictBg;
        ctx.strokeStyle = pal.conflictLine;
        const txt = 'separate';
        ctx.font = '10px sans-serif';
        const tw = ctx.measureText(txt).width + 10;
        ctx.fillRect(mx - tw * 0.5, my - 9, tw, 18);
        ctx.strokeRect(mx - tw * 0.5, my - 9, tw, 18);
        ctx.fillStyle = pal.conflictText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, mx, my);
        ctx.restore();
      }

      // Draw merged shared-keyword bridges cleanly ON TOP (only focused links, or direct links <= 4.5m when unfocused)
      const placedPills = [];
      for (const br of bridges) {
        if (br.rel.sharedKeywords.length === 0) continue;
        const isFocusLink = focusVol && (br.A.id === focusVol.id || br.B.id === focusVol.id);
        if (focusVol && !isFocusLink) continue;
        if (!focusVol && (!br.rel.hasDirectLink || br.edgeDist > 4.5)) continue;

        const pA = this.worldToScreen(br.A.x, br.A.y);
        const pB = this.worldToScreen(br.B.x, br.B.y);
        let mx = (pA.x + pB.x) * 0.5;
        let my = (pA.y + pB.y) * 0.5;
        // Nudge vertically if overlapping an already-placed bridge pill
        for (const prev of placedPills) {
          if (Math.abs(mx - prev.x) < 95 && Math.abs(my - prev.y) < 18) {
            my = prev.y + 19;
          }
        }
        placedPills.push({ x: mx, y: my });

        const labels = br.rel.sharedKeywords.slice(0, 2).map(id => this.api.getKeywordLabel(id));
        if (br.rel.sharedKeywords.length > 2) labels.push(`+${br.rel.sharedKeywords.length - 2}`);
        const text = labels.join(' · ');

        const accentCat = prog.getSpaceStyle(focusVol ? focusVol : br.A);
        ctx.save();
        ctx.font = '600 9.5px sans-serif';
        const tw = ctx.measureText(text).width + 12;
        const th = 16;
        ctx.fillStyle = pal.pillBg;
        ctx.strokeStyle = accentCat ? accentCat.color : pal.inkSoft;
        ctx.lineWidth = 1.2;
        this._roundRect(ctx, mx - tw * 0.5, my - th * 0.5, tw, th, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = pal.pillText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, mx, my + 0.5);
        ctx.restore();
      }

      // Selection handles
      if (state.selectedIds.length === 1) {
        const sel = this.api.getVolume(state.selectedIds[0]);
        if (sel) this._drawHandles(ctx, sel, state.useGross, pal);
      }

      // Clipping Plane: when selected/active render full line+handles in front; when unselected render only clickable text boxes
      if (secActive) {
        this._drawSectionLineAndArrows(ctx, pal, true);
        this._drawSectionBadgesAndHandles(ctx, pal, true, w, h);
      } else {
        this._drawSectionBadgesAndHandles(ctx, pal, false, w, h);
      }

      // Saved Plan dimensions + draft
      for (const dim of state.dimensions.filter(d => d.view === 'plan')) {
        const isSelDim = !!(state.selectedItem && state.selectedItem.kind === 'dim' && state.selectedItem.id === dim.id);
        this._drawDimension(ctx, dim, false, isSelDim, pal);
      }
      if (this.dimDraft) {
        this._drawDimension(ctx, this.dimDraft, true, false, pal);
      }

      // Plan Annotations (Lines/Arrows & Text)
      if (state.layers.annotations) {
        for (const ann of (state.annotations || []).filter(a => a.view === 'plan')) {
          const isSelAnn = !!(state.selectedItem && state.selectedItem.id === ann.id);
          if (ann.type === 'line') this._drawLineAnnotation(ctx, ann, false, isSelAnn, pal);
          else if (ann.type === 'text') this._drawTextAnnotation(ctx, ann, isSelAnn, pal);
        }
      }
      if (this.lineDraft) {
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

      // Marquee box
      if (this.dragState && this.dragState.type === 'marquee') {
        const s = this.dragState.startPos;
        const c = this.dragState.currPos;
        ctx.save();
        ctx.fillStyle = pal.marqueeFill;
        ctx.strokeStyle = pal.marqueeStroke;
        ctx.setLineDash([4, 3]);
        ctx.fillRect(Math.min(s.x, c.x), Math.min(s.y, c.y), Math.abs(c.x - s.x), Math.abs(c.y - s.y));
        ctx.strokeRect(Math.min(s.x, c.x), Math.min(s.y, c.y), Math.abs(c.x - s.x), Math.abs(c.y - s.y));
        ctx.restore();
      }

      // Scale Bar & North Arrow
      this._drawScaleAndNorth(ctx, w, h, pal);

      ctx.restore();
    }

    _strokePoly(ctx, pts, closed, fill, fillOnly) {
      if (!pts || pts.length < 2) return;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const sp = this.worldToScreen(pts[i][0], pts[i][1]);
        if (i === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      }
      if (closed) ctx.closePath();
      if (fill) ctx.fill();
      if (!fillOnly) ctx.stroke();
    }

    _drawBubble(ctx, vol, useGross, isSelected, isFocus, rel, activeKws, mergedSet, pal) {
      const state = this.api.getState();
      const cat = window.GROUNDWORK_PROGRAM.getSpaceStyle(vol);
      const dims = window.GROUNDWORK_ENGINE.getEffectiveDims(vol, useGross);
      const center = this.worldToScreen(vol.x, vol.y);
      const pw = dims.w * this.cam.pxPerM;
      const pd = dims.d * this.cam.pxPerM;
      const theta = -(vol.rot || 0);

      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(theta);

      // Compute fill & relevance-graded outline saturation
      let fillAlpha = 0.28;
      let strokeColor = cat.color;
      let lineWidth = 1.4;

      if (isSelected || isFocus) {
        fillAlpha = 0.42;
        strokeColor = pal.ink;
        lineWidth = 2.2;
      } else if (rel) {
        const s = rel.score; // 0..1
        strokeColor = this._mixColor(pal.neutralMix, cat.color, Math.pow(s, 0.7));
        lineWidth = 0.9 + s * 2.4;
        fillAlpha = 0.14 + s * 0.26;
      }

      const rgb = this._hexToRgb(cat.color);
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${fillAlpha.toFixed(2)})`;
      ctx.fillRect(-pw * 0.5, -pd * 0.5, pw, pd);

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(-pw * 0.5, -pd * 0.5, pw, pd);

      // Subtle inner floor indicator when multi-floor
      if (dims.floors > 1) {
        ctx.strokeStyle = pal.floorLine;
        ctx.lineWidth = 0.9;
        ctx.strokeRect(-pw * 0.5 + 3, -pd * 0.5 + 3, Math.max(0, pw - 6), Math.max(0, pd - 6));
      }

      // Subtle architectural Plan roof lines & eave overhang
      const roof = window.GROUNDWORK_ENGINE.getRoofSpec(vol);
      if (roof.type !== 'flat' || roof.overhang > 0.05) {
        const ovPx = roof.overhang * this.cam.pxPerM;
        const epw = pw + ovPx * 2;
        const epd = pd + ovPx * 2;
        ctx.save();
        ctx.strokeStyle = pal.ink;
        ctx.fillStyle = pal.ink;
        ctx.globalAlpha = 0.36;
        ctx.lineWidth = 0.9;

        if (ovPx > 1.2) {
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(-epw * 0.5, -epd * 0.5, epw, epd);
          ctx.setLineDash([]);
        }
        if (roof.type === 'gable') {
          ctx.beginPath();
          if (roof.dir === 0 || roof.dir === 180) {
            ctx.moveTo(-epw * 0.5, 0); ctx.lineTo(epw * 0.5, 0);
          } else {
            ctx.moveTo(0, -epd * 0.5); ctx.lineTo(0, epd * 0.5);
          }
          ctx.stroke();
        } else if (roof.type === 'hip') {
          ctx.beginPath();
          if (pw >= pd) {
            const rx = Math.max(0, (pw - pd) * 0.5);
            ctx.moveTo(-epw * 0.5, -epd * 0.5); ctx.lineTo(-rx, 0);
            ctx.moveTo(-epw * 0.5, epd * 0.5); ctx.lineTo(-rx, 0);
            ctx.moveTo(epw * 0.5, -epd * 0.5); ctx.lineTo(rx, 0);
            ctx.moveTo(epw * 0.5, epd * 0.5); ctx.lineTo(rx, 0);
            if (rx > 0.5) { ctx.moveTo(-rx, 0); ctx.lineTo(rx, 0); }
          } else {
            const ry = Math.max(0, (pd - pw) * 0.5);
            ctx.moveTo(-epw * 0.5, -epd * 0.5); ctx.lineTo(0, -ry);
            ctx.moveTo(epw * 0.5, -epd * 0.5); ctx.lineTo(0, -ry);
            ctx.moveTo(-epw * 0.5, epd * 0.5); ctx.lineTo(0, ry);
            ctx.moveTo(epw * 0.5, epd * 0.5); ctx.lineTo(0, ry);
            if (ry > 0.5) { ctx.moveTo(0, -ry); ctx.lineTo(0, ry); }
          }
          ctx.stroke();
        } else if (roof.type === 'skillion' && pw >= 22 && pd >= 18) {
          // Small slope-down arrow placed near the low corner to keep label clear
          const dirs = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] };
          const [ux, uy] = dirs[roof.dir] || [0, -1];
          const ax = ux * (pw * 0.5 - 10) + (ux === 0 ? pw * 0.5 - 10 : 0);
          const ay = uy * (pd * 0.5 - 10) + (uy === 0 ? pd * 0.5 - 10 : 0);
          const sx0 = ax - ux * 6, sy0 = ay - uy * 6;
          const sx1 = ax + ux * 4, sy1 = ay + uy * 4;
          const ang = Math.atan2(uy, ux);
          ctx.beginPath();
          ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy1);
          ctx.moveTo(sx1, sy1); ctx.lineTo(sx1 - Math.cos(ang - 0.55) * 4, sy1 - Math.sin(ang - 0.55) * 4);
          ctx.moveTo(sx1, sy1); ctx.lineTo(sx1 - Math.cos(ang + 0.55) * 4, sy1 - Math.sin(ang + 0.55) * 4);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Labels inside bubble (auto-fit cleanly)
      const areaStr = dims.floors > 1
        ? `${dims.totalArea.toFixed(0)} m² (${dims.floors}F · ${dims.footprintArea.toFixed(1)}/F)`
        : `${dims.totalArea.toFixed(0)} m²`;

      ctx.fillStyle = pal.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const maxTextW = Math.max(24, pw - 8);
      if (pw >= 34 && pd >= 22) {
        const title = `${vol.ref} ${vol.short}`;
        ctx.font = '600 11px sans-serif';
        ctx.fillText(this._truncate(ctx, title, maxTextW), 0, pd > 46 ? -8 : -4);

        ctx.font = '10.5px ui-monospace, monospace';
        ctx.fillStyle = pal.inkSub;
        ctx.fillText(this._truncate(ctx, areaStr, maxTextW), 0, pd > 46 ? 6 : 8);

        // Active keywords (exclude already merged ones so bridge stays clean)
        if (pd >= 66 && pw >= 60) {
          const activeList = (vol.keywords || [])
            .filter(k => activeKws.has(k) && !(mergedSet && mergedSet.has(k)))
            .map(k => this.api.getKeywordLabel(k));
          if (activeList.length > 0) {
            ctx.font = '9.5px sans-serif';
            ctx.fillStyle = pal.inkSoft;
            const kwText = this._truncate(ctx, activeList.slice(0, 3).join(' · '), maxTextW);
            ctx.fillText(kwText, 0, 22);
          }
        }
      } else {
        ctx.font = '600 9.5px sans-serif';
        ctx.fillText(vol.ref, 0, 0);
      }

      // Group badge in corner
      if (vol.groupId && pw >= 36) {
        ctx.font = '600 9px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = pal.ink;
        ctx.fillText('GRP', -pw * 0.5 + 4, -pd * 0.5 + 3);
      }

      // Relevance percentage badge when comparing to focus
      if (rel && rel.score >= 0.15 && pw >= 40) {
        const pct = Math.round(rel.score * 100) + '%';
        ctx.font = '600 9.5px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillStyle = cat.color;
        ctx.fillText(pct, pw * 0.5 - 4, -pd * 0.5 + 3);
      }

      // Zoom-adaptive exterior rectangle dimensions (width & depth along adjacent outer edges)
      if (state.layers.rectDims && this.cam.pxPerM >= 7.5 && pw >= 38 && pd >= 24) {
        const fmt = (v) => Number(v.toFixed(2)) + ' m';
        const wLabel = fmt(dims.w);
        const dLabel = fmt(dims.d);
        const topY = -pd * 0.5 - 8;
        const leftX = -pw * 0.5 - 8;

        ctx.strokeStyle = pal.inkMuted;
        ctx.lineWidth = 0.85;
        ctx.globalAlpha = isSelected ? 0.92 : 0.72;

        // Top width dim line + ticks
        ctx.beginPath();
        ctx.moveTo(-pw * 0.5, topY - 2.5); ctx.lineTo(-pw * 0.5, topY + 2.5);
        ctx.moveTo(pw * 0.5, topY - 2.5); ctx.lineTo(pw * 0.5, topY + 2.5);
        ctx.moveTo(-pw * 0.5, topY); ctx.lineTo(pw * 0.5, topY);
        ctx.stroke();

        // Left depth dim line + ticks
        ctx.beginPath();
        ctx.moveTo(leftX - 2.5, -pd * 0.5); ctx.lineTo(leftX + 2.5, -pd * 0.5);
        ctx.moveTo(leftX - 2.5, pd * 0.5); ctx.lineTo(leftX + 2.5, pd * 0.5);
        ctx.moveTo(leftX, -pd * 0.5); ctx.lineTo(leftX, pd * 0.5);
        ctx.stroke();

        ctx.font = '600 9.5px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1;

        // Width label on top edge
        ctx.save();
        ctx.translate(0, topY);
        if (Math.cos(theta) < -0.1) ctx.rotate(Math.PI);
        const twW = ctx.measureText(wLabel).width + 6;
        ctx.fillStyle = pal.bg;
        ctx.fillRect(-twW * 0.5, -6, twW, 12);
        ctx.fillStyle = pal.inkSub;
        ctx.fillText(wLabel, 0, 0);
        ctx.restore();

        // Depth label on left edge
        ctx.save();
        ctx.translate(leftX, 0);
        ctx.rotate(-Math.PI * 0.5);
        if (Math.cos(theta - Math.PI * 0.5) < -0.15) ctx.rotate(Math.PI);
        const twD = ctx.measureText(dLabel).width + 6;
        ctx.fillStyle = pal.bg;
        ctx.fillRect(-twD * 0.5, -6, twD, 12);
        ctx.fillStyle = pal.inkSub;
        ctx.fillText(dLabel, 0, 0);
        ctx.restore();
      }

      ctx.restore();
    }

    _drawHandles(ctx, vol, useGross, pal) {
      const handles = this._getHandlesForVolume(vol, useGross);
      const rotH = handles.find(h => h.kind === 'rotate');
      if (rotH && rotH.anchor) {
        ctx.save();
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rotH.anchor.x, rotH.anchor.y);
        ctx.lineTo(rotH.x, rotH.y);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      for (const h of handles) {
        ctx.fillStyle = pal.handleFill;
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = 1.3;
        if (h.kind === 'rotate') {
          ctx.beginPath();
          ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(h.x - 3.5, h.y - 3.5, 7, 7);
          ctx.strokeRect(h.x - 3.5, h.y - 3.5, 7, 7);
        }
      }
      ctx.restore();
    }

    _drawSectionLineAndArrows(ctx, pal, isActive) {
      const plane = this.api.getActivePlane();
      if (!plane) return;
      const basis = window.GROUNDWORK_ENGINE.getPlaneBasis(plane);
      const half = 65;
      const pA = this.worldToScreen(basis.cx - half * basis.tx, basis.cy - half * basis.ty);
      const pB = this.worldToScreen(basis.cx + half * basis.tx, basis.cy + half * basis.ty);

      ctx.save();
      ctx.globalAlpha = isActive ? 1 : 0.42;
      ctx.strokeStyle = plane.enabled ? pal.sectionStroke : pal.sectionMuted;
      ctx.lineWidth = isActive ? (plane.enabled ? 2.1 : 1.4) : (plane.enabled ? 1.3 : 1.0);
      ctx.setLineDash([9, 4, 2, 4]);
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // View direction arrows (pointing into kept side: basis.vx, basis.vy)
      const dirScreen = { x: basis.vx, y: -basis.vy };
      for (const endPt of [pA, pB]) {
        const tip = { x: endPt.x + dirScreen.x * 16, y: endPt.y + dirScreen.y * 16 };
        ctx.beginPath();
        ctx.moveTo(endPt.x, endPt.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();

        const ang = Math.atan2(dirScreen.y, dirScreen.x);
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - Math.cos(ang - 0.5) * 6, tip.y - Math.sin(ang - 0.5) * 6);
        ctx.lineTo(tip.x - Math.cos(ang + 0.5) * 6, tip.y - Math.sin(ang + 0.5) * 6);
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
      ctx.restore();
    }

    _drawSectionBadgesAndHandles(ctx, pal, isActive, w, h) {
      const plane = this.api.getActivePlane();
      if (!plane) return;
      const basis = window.GROUNDWORK_ENGINE.getPlaneBasis(plane);
      const half = 65;
      const pA = this.worldToScreen(basis.cx - half * basis.tx, basis.cy - half * basis.ty);
      const pB = this.worldToScreen(basis.cx + half * basis.tx, basis.cy + half * basis.ty);
      const pC = this.worldToScreen(basis.cx, basis.cy);
      const name = plane.name || 'A';

      const drawBadge = (cx, cy, label, handleKey) => {
        ctx.font = '600 10px sans-serif';
        const bw = Math.max(22, ctx.measureText(label).width + 12);
        const bh = 18;
        const bx = cx - bw * 0.5;
        const by = cy - bh * 0.5;
        ctx.fillStyle = isActive ? pal.sectionStroke : pal.dimBg;
        ctx.strokeStyle = isActive ? pal.sectionStroke : pal.dimBorder;
        ctx.lineWidth = isActive ? 1.6 : 1.1;
        this._roundRect(ctx, bx, by, bw, bh, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = isActive ? pal.sectionCenterOff : pal.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cx, cy + 0.5);
        this.sectionTextBoxes.push({ planeId: plane.id, handle: handleKey, x: bx, y: by, w: bw, h: bh });
      };

      ctx.save();
      drawBadge(pA.x, pA.y, `Sec ${name}`, 'a');
      drawBadge(pB.x, pB.y, `${name}'`, 'b');

      // When zoomed in and both endpoint text boxes fall outside the viewport, clip line against inner margin box
      const inView = (pt) => pt.x >= 20 && pt.x <= w - 20 && pt.y >= 36 && pt.y <= h - 22;
      if (!inView(pA) && !inView(pB)) {
        const minX = 46, maxX = Math.max(50, w - 46);
        const minY = 48, maxY = Math.max(52, h - 34);
        const dx = pB.x - pA.x, dy = pB.y - pA.y;
        let t0 = 0, t1 = 1;
        const clip = (p, q) => {
          if (Math.abs(p) < 1e-8) return q >= 0;
          const r = q / p;
          if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
          else { if (r < t0) return false; if (r < t1) t1 = r; }
          return true;
        };
        if (clip(-dx, pA.x - minX) && clip(dx, maxX - pA.x) && clip(-dy, pA.y - minY) && clip(dy, maxY - pA.y) && t0 <= t1) {
          const ex = pA.x + t0 * dx;
          const ey = pA.y + t0 * dy;
          drawBadge(ex, ey, `Sec ${name}–${name}'`, 'body');
        }
      }

      // Center grab handle + endpoint rotate dots ONLY when section is active/selected
      if (isActive) {
        ctx.beginPath();
        ctx.arc(pC.x, pC.y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = plane.enabled ? pal.sectionStroke : pal.sectionCenterOff;
        ctx.strokeStyle = pal.handleFill;
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawDimension(ctx, dim, isDraft, isSelected, pal) {
      const p1 = dim.p1, p2 = dim.p2;
      const s1 = this.worldToScreen(p1.x, p1.y);
      const s2 = this.worldToScreen(p2.x, p2.y);
      const dHoriz = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const dz = p2.z - p1.z;
      const slope = dHoriz > 0.1 ? (Math.abs(dz) / dHoriz) * 100 : 0;
      const screenDist = Math.hypot(s2.x - s1.x, s2.y - s1.y);

      ctx.save();
      ctx.strokeStyle = isDraft ? pal.dimDraft : pal.dimStroke;
      ctx.lineWidth = isSelected ? 1.9 : 1.25;
      if (isDraft) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const s of [s1, s2]) {
        ctx.fillStyle = isSelected ? pal.handleFill : pal.dimStroke;
        ctx.strokeStyle = isDraft ? pal.dimDraft : pal.dimStroke;
        ctx.lineWidth = isSelected ? 1.7 : 1.1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, isSelected ? 5.2 : 2.8, 0, Math.PI * 2);
        ctx.fill();
        if (isSelected) ctx.stroke();
      }

      // Auto-hide dimension text box when zoomed out enough (unless selected or draft)
      const showBox = isDraft || isSelected || (this.cam.pxPerM >= 4.6 && screenDist >= 54);
      if (showBox) {
        const mx = (s1.x + s2.x) * 0.5;
        const my = (s1.y + s2.y) * 0.5;
        const label = `${dHoriz.toFixed(2)} m · ΔZ ${dz >= 0 ? '+' : ''}${dz.toFixed(2)} m (${slope.toFixed(0)}%)`;
        ctx.font = '500 10.5px ui-monospace, monospace';
        const tw = ctx.measureText(label).width + 10;
        const bx = mx - tw * 0.5;
        const by = my - 18;
        const bh = 17;
        ctx.fillStyle = pal.dimBg;
        ctx.strokeStyle = isSelected ? pal.ink : pal.dimBorder;
        ctx.lineWidth = isSelected ? 1.6 : 1;
        ctx.fillRect(bx, by, tw, bh);
        ctx.strokeRect(bx, by, tw, bh);
        ctx.fillStyle = pal.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mx, by + bh * 0.5);
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
      const s1 = this.worldToScreen(ann.p1.x, ann.p1.y);
      const s2 = this.worldToScreen(ann.p2.x, ann.p2.y);
      const col = this._resolveAnnColor(ann.color, pal);
      const sw = ann.strokeWidth || 1.5;

      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = isSelected ? sw + 0.8 : sw;
      if (ann.dashed || isDraft) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const dx = s2.x - s1.x, dy = s2.y - s1.y;
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        const ux = dx / len, uy = dy / len;
        this._drawCap(ctx, s1, -ux, -uy, ann.startCap || 'none', sw, col);
        this._drawCap(ctx, s2, ux, uy, ann.endCap || 'arrow', sw, col);
      }

      if (isSelected) {
        for (const s of [s1, s2]) {
          ctx.fillStyle = pal.handleFill;
          ctx.strokeStyle = pal.ink;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 5.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    _drawTextAnnotation(ctx, ann, isSelected, pal) {
      const s = this.worldToScreen(ann.x, ann.y);
      const col = this._resolveAnnColor(ann.color, pal);
      const fs = ann.fontSize || 12;
      const label = ann.text || '';
      if (!label) return;

      ctx.save();
      ctx.font = `600 ${fs}px sans-serif`;
      const tw = ctx.measureText(label).width + 12;
      const th = fs + 8;
      const bx = s.x - tw * 0.5;
      const by = s.y - th * 0.5;

      if (ann.boxed || isSelected) {
        ctx.fillStyle = pal.dimBg;
        ctx.strokeStyle = isSelected ? pal.ink : col;
        ctx.lineWidth = isSelected ? 1.4 : 1;
        this._roundRect(ctx, bx, by, tw, th, 4);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.strokeStyle = pal.bg;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText(label, s.x, s.y);
      }

      ctx.fillStyle = col;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, s.x, s.y);
      this.annHitBoxes.push({ id: ann.id, x: bx, y: by, w: tw, h: th });
      ctx.restore();
    }

    _drawScaleAndNorth(ctx, w, h, pal) {
      // Choose clean metric bar length
      const targetPx = 90;
      const rawM = targetPx / this.cam.pxPerM;
      const steps = [1, 2, 5, 10, 20, 25, 50, 100];
      let barM = steps[0];
      for (const st of steps) {
        if (st <= rawM * 1.4) barM = st;
      }
      const barPx = barM * this.cam.pxPerM;
      const bx = w - 20 - barPx;
      const by = h - 22;

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
      ctx.font = '10.5px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${barM} m`, bx + barPx * 0.5, by - 7);

      // Minimal North arrow
      const nx = w - 26;
      const ny = 48;
      ctx.beginPath();
      ctx.arc(nx, ny, 12, 0, Math.PI * 2);
      ctx.strokeStyle = pal.northRing;
      ctx.lineWidth = 1;
      ctx.fillStyle = pal.northBg;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(nx, ny - 9);
      ctx.lineTo(nx - 3.5, ny + 4);
      ctx.lineTo(nx, ny + 1);
      ctx.lineTo(nx + 3.5, ny + 4);
      ctx.closePath();
      ctx.fillStyle = pal.ink;
      ctx.fill();
      ctx.font = '600 8.5px sans-serif';
      ctx.fillText('N', nx, ny - 15);
      ctx.restore();
    }

    _roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    _truncate(ctx, text, maxW) {
      if (ctx.measureText(text).width <= maxW) return text;
      let s = text;
      while (s.length > 2 && ctx.measureText(s + '…').width > maxW) {
        s = s.slice(0, -1);
      }
      return s + '…';
    }

    _hexToRgb(hex) {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 120, g: 120, b: 120 };
    }

    _mixColor(hexA, hexB, t) {
      const a = this._hexToRgb(hexA);
      const b = this._hexToRgb(hexB);
      const k = Math.max(0, Math.min(1, t));
      const r = Math.round(a.r + (b.r - a.r) * k);
      const g = Math.round(a.g + (b.g - a.g) * k);
      const bl = Math.round(a.b + (b.b - a.b) * k);
      return `rgb(${r},${g},${bl})`;
    }

    exportSVG() {
      const w = Math.max(800, this.canvas.clientWidth || 1000);
      const h = Math.max(600, this.canvas.clientHeight || 700);
      const state = this.api.getState();
      const site = window.GROUNDWORK_SITE;
      const eng = window.GROUNDWORK_ENGINE;
      const prog = window.GROUNDWORK_PROGRAM;

      const toS = (wx, wy) => ({
        x: (w * 0.5 + (wx - this.cam.cx) * this.cam.pxPerM).toFixed(2),
        y: (h * 0.5 - (wy - this.cam.cy) * this.cam.pxPerM).toFixed(2)
      });
      const polyPath = (pts, closed) => {
        if (!pts || !pts.length) return '';
        return pts.map((p, i) => {
          const s = toS(p[0], p[1]);
          return `${i === 0 ? 'M' : 'L'}${s.x},${s.y}`;
        }).join(' ') + (closed ? ' Z' : '');
      };

      const pal = this._palette();
      const parts = [];
      parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
      parts.push(`<rect width="${w}" height="${h}" fill="${pal.bg}"/>`);

      if (state.layers.roads && site.roadContours) {
        for (const rc of site.roadContours) {
          parts.push(`<path d="${polyPath(rc.pts, rc.closed)}" fill="${pal.roadFill}" stroke="${pal.roadStroke}" stroke-width="1"/>`);
        }
      }
      if (state.layers.waterways && site.waterways) {
        for (const ww of site.waterways) {
          parts.push(`<path d="${polyPath(ww.pts, false)}" fill="none" stroke="${pal.water}" stroke-width="2"/>`);
        }
      }
      if (state.layers.contours && site.contours5m) {
        for (const c5 of site.contours5m) {
          parts.push(`<path d="${polyPath(c5.pts, c5.closed)}" fill="none" stroke="${pal.contourText}" stroke-opacity="0.55" stroke-width="1"/>`);
        }
      }
      if (state.layers.buildings && site.buildings) {
        for (const b of site.buildings) {
          if (eng.isBuildingInsidePlot(b) && !state.layers.plotBuildings) continue;
          if (b.fp && b.fp.length >= 3) {
            parts.push(`<path d="${polyPath(b.fp, true)}" fill="${pal.bldgFill}" stroke="${pal.bldgStroke}" stroke-width="0.9"/>`);
          }
        }
      }
      if (state.layers.siteBoundary && site.siteBoundary) {
        parts.push(`<path d="${polyPath(site.siteBoundary, true)}" fill="${pal.boundaryFill}" stroke="${pal.boundaryStroke}" stroke-width="1.8" stroke-dasharray="8 4"/>`);
      }

      const activeKws = this.api.getActiveKeywordSet();
      const vols = [...state.volumes].sort((a, b) => (a.zOrder || 0) - (b.zOrder || 0));
      for (const vol of vols) {
        const cat = prog.getSpaceStyle(vol);
        const dims = eng.getEffectiveDims(vol, state.useGross);
        const center = toS(vol.x, vol.y);
        const pw = dims.w * this.cam.pxPerM;
        const pd = dims.d * this.cam.pxPerM;
        const deg = -((vol.rot || 0) * 180 / Math.PI);
        parts.push(`<g transform="translate(${center.x},${center.y}) rotate(${deg.toFixed(2)})">`);
        parts.push(`<rect x="${(-pw / 2).toFixed(2)}" y="${(-pd / 2).toFixed(2)}" width="${pw.toFixed(2)}" height="${pd.toFixed(2)}" fill="${cat.color}" fill-opacity="0.30" stroke="${cat.color}" stroke-width="1.4"/>`);
        const roof = eng.getRoofSpec(vol);
        if (roof.type !== 'flat' || roof.overhang > 0.05) {
          const ovPx = roof.overhang * this.cam.pxPerM;
          const epw = pw + ovPx * 2, epd = pd + ovPx * 2;
          if (ovPx > 1.2) {
            parts.push(`<rect x="${(-epw / 2).toFixed(2)}" y="${(-epd / 2).toFixed(2)}" width="${epw.toFixed(2)}" height="${epd.toFixed(2)}" fill="none" stroke="${pal.ink}" stroke-opacity="0.35" stroke-width="0.9" stroke-dasharray="3 3"/>`);
          }
          if (roof.type === 'gable') {
            if (roof.dir === 0 || roof.dir === 180) {
              parts.push(`<line x1="${(-epw / 2).toFixed(2)}" y1="0" x2="${(epw / 2).toFixed(2)}" y2="0" stroke="${pal.ink}" stroke-opacity="0.35" stroke-width="0.9"/>`);
            } else {
              parts.push(`<line x1="0" y1="${(-epd / 2).toFixed(2)}" x2="0" y2="${(epd / 2).toFixed(2)}" stroke="${pal.ink}" stroke-opacity="0.35" stroke-width="0.9"/>`);
            }
          } else if (roof.type === 'hip') {
            if (pw >= pd) {
              const rx = Math.max(0, (pw - pd) * 0.5);
              parts.push(`<path d="M${(-epw / 2).toFixed(2)},${(-epd / 2).toFixed(2)} L${(-rx).toFixed(2)},0 L${(-epw / 2).toFixed(2)},${(epd / 2).toFixed(2)} M${(epw / 2).toFixed(2)},${(-epd / 2).toFixed(2)} L${rx.toFixed(2)},0 L${(epw / 2).toFixed(2)},${(epd / 2).toFixed(2)} M${(-rx).toFixed(2)},0 L${rx.toFixed(2)},0" fill="none" stroke="${pal.ink}" stroke-opacity="0.35" stroke-width="0.9"/>`);
            } else {
              const ry = Math.max(0, (pd - pw) * 0.5);
              parts.push(`<path d="M${(-epw / 2).toFixed(2)},${(-epd / 2).toFixed(2)} L0,${(-ry).toFixed(2)} L${(epw / 2).toFixed(2)},${(-epd / 2).toFixed(2)} M${(-epw / 2).toFixed(2)},${(epd / 2).toFixed(2)} L0,${ry.toFixed(2)} L${(epw / 2).toFixed(2)},${(epd / 2).toFixed(2)} M0,${(-ry).toFixed(2)} L0,${ry.toFixed(2)}" fill="none" stroke="${pal.ink}" stroke-opacity="0.35" stroke-width="0.9"/>`);
            }
          }
        }
        parts.push(`<text x="0" y="-3" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="600" fill="${pal.ink}">${this._esc((vol.ref || vol.id) + ' ' + vol.short)}</text>`);
        parts.push(`<text x="0" y="11" text-anchor="middle" font-family="monospace" font-size="10" fill="${pal.inkSub}">${dims.totalArea.toFixed(0)} m²</text>`);
        if (state.layers.rectDims && this.cam.pxPerM >= 7.5 && pw >= 38 && pd >= 24) {
          parts.push(`<text x="0" y="${(-pd / 2 - 6).toFixed(2)}" text-anchor="middle" font-family="monospace" font-size="9.5" fill="${pal.inkSub}">${Number(dims.w.toFixed(2))} m</text>`);
          parts.push(`<text x="${(-pw / 2 - 6).toFixed(2)}" y="0" text-anchor="middle" transform="rotate(-90 ${(-pw / 2 - 6).toFixed(2)} 0)" font-family="monospace" font-size="9.5" fill="${pal.inkSub}">${Number(dims.d.toFixed(2))} m</text>`);
        }
        parts.push(`</g>`);
      }

      // Bridges
      for (let i = 0; i < vols.length; i++) {
        for (let j = i + 1; j < vols.length; j++) {
          const A = vols[i], B = vols[j];
          if (eng.minEdgeDistanceRects(A, B, state.useGross) > 9.0) continue;
          const rel = prog.computeRelevance(A, B, activeKws);
          if (rel.sharedKeywords.length === 0) continue;
          const pA = toS(A.x, A.y), pB = toS(B.x, B.y);
          const mx = (parseFloat(pA.x) + parseFloat(pB.x)) * 0.5;
          const my = (parseFloat(pA.y) + parseFloat(pB.y)) * 0.5;
          const txt = rel.sharedKeywords.slice(0, 3).map(k => this.api.getKeywordLabel(k)).join(' · ');
          parts.push(`<line x1="${pA.x}" y1="${pA.y}" x2="${pB.x}" y2="${pB.y}" stroke="${pal.linkDirect}" stroke-width="1"/>`);
          parts.push(`<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="9.5" fill="${pal.ink}">${this._esc(txt)}</text>`);
        }
      }

      // Annotations (SVG)
      if (state.layers.annotations) {
        for (const ann of (state.annotations || []).filter(a => a.view === 'plan')) {
          const col = this._resolveAnnColor(ann.color, pal);
          if (ann.type === 'line') {
            const p1 = toS(ann.p1.x, ann.p1.y), p2 = toS(ann.p2.x, ann.p2.y);
            const dash = ann.dashed ? ' stroke-dasharray="5 4"' : '';
            parts.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${col}" stroke-width="${ann.strokeWidth || 1.5}"${dash}/>`);
          } else if (ann.type === 'text') {
            const p = toS(ann.x, ann.y);
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

  window.GroundworkPlanView = PlanView;
})();
