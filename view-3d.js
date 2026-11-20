/* 3D Viewport: Real Kotagiri Terrain, XYZ Volume Editing, Cut & Fill Prisms, Rhino Clipping Plane & 3D Dimensions */
(function () {
  class View3D {
    constructor(container, labelLayer, api) {
      this.container = container;
      this.labelLayer = labelLayer;
      this.api = api;

      this.site = window.GROUNDWORK_SITE;
      this.zDatum = this.site.meta.zDatum;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0xf4f1ea);

      const w = Math.max(200, container.clientWidth);
      const h = Math.max(200, container.clientHeight);
      this.camera = new THREE.PerspectiveCamera(44, w / h, 0.5, 1600);
      const sb = this.site.meta.siteBounds;
      const cx = (sb.minX + sb.maxX) * 0.5;
      const cy = (sb.minY + sb.maxY) * 0.5;
      const cz = (sb.minZ + sb.maxZ) * 0.5 - this.zDatum;
      this.camera.position.set(cx + 68, cz + 56, -cy + 78);

      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h);
      this.renderer.localClippingEnabled = true;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      container.insertBefore(this.renderer.domElement, labelLayer);

      this.orbit = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.orbit.enableDamping = true;
      this.orbit.dampingFactor = 0.08;
      this.orbit.target.set(cx, cz, -cy);
      this.orbit.maxPolarAngle = Math.PI * 0.495;
      this.orbit.update();

      this.transform = new THREE.TransformControls(this.camera, this.renderer.domElement);
      this.transform.setMode('translate');
      this.transform.setSize(0.85);
      this.scene.add(this.transform);

      this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6);
      this.activeClipPlanes = [this.clipPlane];

      this.raycaster = new THREE.Raycaster();
      this.pointerNDC = new THREE.Vector2();
      this.isTransforming = false;
      this.transformOrig = null;
      this.dimDraft = null;
      this.pointerDownPos = null;
      this._pendingOrbitFocus = false;
      this._lastOrbitSelKey = '';
      this._lastPivotPos = null;

      this.volumeGroups = new Map();
      this.earthworkGroup = new THREE.Group();
      this.dimGroup = new THREE.Group();
      this.labelEls = new Map();
      this.dimLabelEls = [];

      this._setupLights();
      this._buildSiteEnvironment();
      this._buildClipFrame();
      this.scene.add(this.earthworkGroup);
      this.scene.add(this.dimGroup);

      this._bindEvents();
      this._animate();
    }

    toThree(x, y, z) {
      return new THREE.Vector3(x, z - this.zDatum, -y);
    }

    fromThree(v) {
      return { x: v.x, y: -v.z, z: v.y + this.zDatum };
    }

    _setupLights() {
      this.hemiLight = new THREE.HemisphereLight(0xfffdf8, 0x9b9588, 0.78);
      this.scene.add(this.hemiLight);

      this.dirLight = new THREE.DirectionalLight(0xfff8ed, 0.72);
      this.dirLight.position.set(110, 180, 95);
      this.dirLight.castShadow = true;
      this.dirLight.shadow.mapSize.set(2048, 2048);
      this.dirLight.shadow.camera.left = -150;
      this.dirLight.shadow.camera.right = 150;
      this.dirLight.shadow.camera.top = 150;
      this.dirLight.shadow.camera.bottom = -150;
      this.dirLight.shadow.camera.near = 20;
      this.dirLight.shadow.camera.far = 450;
      this.dirLight.shadow.bias = -0.0005;
      this.scene.add(this.dirLight);

      const fill = new THREE.DirectionalLight(0xeef3f7, 0.25);
      fill.position.set(-100, 80, -120);
      this.scene.add(fill);
    }

    _buildSiteEnvironment() {
      const hf = this.site.heightfield;
      const nx = hf.nx;
      const ny = hf.ny;
      const positions = new Float32Array(nx * ny * 3);
      const colors = new Float32Array(nx * ny * 3);
      const zMin = this.site.meta.zMin;
      const zSpan = Math.max(1, this.site.meta.zMax - zMin);

      for (let iy = 0; iy < ny; iy++) {
        const wy = hf.minY + iy * hf.cellSize;
        for (let ix = 0; ix < nx; ix++) {
          const wx = hf.minX + ix * hf.cellSize;
          const idx = iy * nx + ix;
          const wz = hf.z[idx];
          positions[idx * 3] = wx;
          positions[idx * 3 + 1] = wz - this.zDatum;
          positions[idx * 3 + 2] = -wy;

          // Subtle muted elevation gradient (valley moss-grey -> upper warm stone)
          const t = Math.max(0, Math.min(1, (wz - zMin) / zSpan));
          colors[idx * 3] = 0.76 + t * 0.14;
          colors[idx * 3 + 1] = 0.76 + t * 0.11;
          colors[idx * 3 + 2] = 0.69 + t * 0.11;
        }
      }

      const indices = [];
      for (let iy = 0; iy < ny - 1; iy++) {
        for (let ix = 0; ix < nx - 1; ix++) {
          const a = iy * nx + ix;
          const b = a + 1;
          const c = (iy + 1) * nx + ix + 1;
          const d = (iy + 1) * nx + ix;
          indices.push(a, b, c, a, c, d);
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();

      this.terrainMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.92,
        metalness: 0.02,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1.0,
        clippingPlanes: this.activeClipPlanes
      });
      this.terrainMesh = new THREE.Mesh(geom, this.terrainMat);
      this.terrainMesh.receiveShadow = true;
      this.scene.add(this.terrainMesh);

      // Contours in 3D
      this.contoursGroup = new THREE.Group();
      this.contourMat = new THREE.LineBasicMaterial({
        color: 0x7c7465,
        transparent: true,
        opacity: 0.55,
        clippingPlanes: this.activeClipPlanes
      });
      for (const c5 of (this.site.contours5m || [])) {
        const pts = c5.pts.map(p => this.toThree(p[0], p[1], p[2] + 0.08));
        if (c5.closed && pts.length > 1) pts.push(pts[0].clone());
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        this.contoursGroup.add(new THREE.Line(g, this.contourMat));
      }
      this.scene.add(this.contoursGroup);

      // Site Boundary in 3D
      this.boundaryGroup = new THREE.Group();
      this.boundaryMat = new THREE.LineBasicMaterial({
        color: 0x22201d,
        clippingPlanes: this.activeClipPlanes
      });
      if (this.site.siteBoundary && this.site.siteBoundary.length > 2) {
        const pts = this.site.siteBoundary.map(p => this.toThree(p[0], p[1], p[2] + 0.16));
        pts.push(pts[0].clone());
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        this.boundaryGroup.add(new THREE.Line(g, this.boundaryMat));
      }
      this.scene.add(this.boundaryGroup);

      // Roads & Waterways in 3D
      this.roadsGroup = new THREE.Group();
      this.roadMat = new THREE.LineBasicMaterial({
        color: 0x999080,
        clippingPlanes: this.activeClipPlanes
      });
      for (const ra of (this.site.roadAxes || [])) {
        const pts = ra.pts.map(p => {
          const gz = window.GROUNDWORK_ENGINE.getGroundZ(p[0], p[1]);
          return this.toThree(p[0], p[1], Math.max(p[2], gz) + 0.14);
        });
        this.roadsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.roadMat));
      }
      this.scene.add(this.roadsGroup);

      this.waterwaysGroup = new THREE.Group();
      this.waterMat = new THREE.LineBasicMaterial({
        color: 0x6187a0,
        clippingPlanes: this.activeClipPlanes
      });
      for (const ww of (this.site.waterways || [])) {
        const pts = ww.pts.map(p => {
          const gz = window.GROUNDWORK_ENGINE.getGroundZ(p[0], p[1]);
          return this.toThree(p[0], p[1], Math.max(p[2], gz) + 0.18);
        });
        this.waterwaysGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.waterMat));
      }
      this.scene.add(this.waterwaysGroup);

      // Context Buildings (split outside vs inside plot boundary)
      this.buildingsGroup = new THREE.Group();
      this.plotBuildingsGroup = new THREE.Group();
      this.bldgMat = new THREE.MeshStandardMaterial({
        color: 0xd9d3c7,
        roughness: 0.88,
        metalness: 0.02,
        side: THREE.DoubleSide,
        clippingPlanes: this.activeClipPlanes
      });
      this.bldgEdgeMat = new THREE.LineBasicMaterial({
        color: 0x9c9587,
        transparent: true,
        opacity: 0.45,
        clippingPlanes: this.activeClipPlanes
      });
      for (const b of (this.site.buildings || [])) {
        if (!b.v || !b.i || !b.i.length) continue;
        const pos = new Float32Array(b.v.length);
        for (let k = 0; k < b.v.length; k += 3) {
          pos[k] = b.v[k];
          pos[k + 1] = b.v[k + 2] - this.zDatum;
          pos[k + 2] = -b.v[k + 1];
        }
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        bg.setIndex(b.i);
        bg.computeVertexNormals();
        const mesh = new THREE.Mesh(bg, this.bldgMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bg, 25), this.bldgEdgeMat);
        const targetGrp = window.GROUNDWORK_ENGINE.isBuildingInsidePlot(b)
          ? this.plotBuildingsGroup
          : this.buildingsGroup;
        targetGrp.add(mesh);
        targetGrp.add(edges);
      }
      this.scene.add(this.buildingsGroup);
      this.scene.add(this.plotBuildingsGroup);

      // Trees (InstancedMesh trunks + crowns)
      this.treesGroup = new THREE.Group();
      const trees = this.site.trees || [];
      if (trees.length > 0) {
        const crownGeom = new THREE.SphereGeometry(1, 8, 6);
        const crownMat = new THREE.MeshStandardMaterial({
          color: 0x7e9478,
          roughness: 0.9,
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
          clippingPlanes: this.activeClipPlanes
        });
        const inst = new THREE.InstancedMesh(crownGeom, crownMat, trees.length);
        const dummy = new THREE.Object3D();
        trees.forEach((t, idx) => {
          const [tx, ty, tz, th, tr] = t;
          const r = Math.max(1.4, Math.min(6.5, tr));
          const h = Math.max(3.5, Math.min(22, th));
          dummy.position.set(tx, tz - this.zDatum + h * 0.55, -ty);
          dummy.scale.set(r, h * 0.45, r);
          dummy.updateMatrix();
          inst.setMatrixAt(idx, dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        this.treesGroup.add(inst);
      }
      this.scene.add(this.treesGroup);
    }

    _buildClipFrame() {
      this.clipFrameGroup = new THREE.Group();
      const planeGeom = new THREE.PlaneGeometry(140, 56);
      this.clipFillMat = new THREE.MeshBasicMaterial({
        color: 0x22201d,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const fill = new THREE.Mesh(planeGeom, this.clipFillMat);
      this.clipEdgeMat = new THREE.LineBasicMaterial({ color: 0x22201d, transparent: true, opacity: 0.6 });
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(planeGeom),
        this.clipEdgeMat
      );
      this.clipFrameGroup.add(fill);
      this.clipFrameGroup.add(edges);
      this.scene.add(this.clipFrameGroup);
    }

    _applyTheme(isDark) {
      if (this.currentTheme === isDark) return;
      this.currentTheme = isDark;
      this.scene.background.setHex(isDark ? 0x181715 : 0xf4f1ea);
      this.terrainMat.color.setHex(isDark ? 0x4b4842 : 0xffffff);
      this.contourMat.color.setHex(isDark ? 0xa49c8d : 0x7c7465);
      this.boundaryMat.color.setHex(isDark ? 0xe6e1d6 : 0x22201d);
      this.roadMat.color.setHex(isDark ? 0x787166 : 0x999080);
      this.waterMat.color.setHex(isDark ? 0x78a5c2 : 0x6187a0);
      this.bldgMat.color.setHex(isDark ? 0x3d3b36 : 0xd9d3c7);
      this.bldgEdgeMat.color.setHex(isDark ? 0x6c675d : 0x9c9587);
      this.clipFillMat.color.setHex(isDark ? 0xe6e1d6 : 0x22201d);
      this.clipEdgeMat.color.setHex(isDark ? 0xdcd6ca : 0x22201d);
      if (this.hemiLight) {
        this.hemiLight.intensity = isDark ? 0.65 : 0.78;
      }
      if (this.dirLight) {
        this.dirLight.intensity = isDark ? 0.68 : 0.72;
      }
    }

    _getSelectionPivot3D(state) {
      if (!state || !state.selectedIds || state.selectedIds.length === 0) return null;
      const eng = window.GROUNDWORK_ENGINE;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      let count = 0;
      let primaryVol = null;

      for (const id of state.selectedIds) {
        const vol = this.api.getVolume(id);
        if (!vol) continue;
        if (!primaryVol) primaryVol = vol;
        count++;
        const dims = eng.getEffectiveDims(vol, state.useGross);
        const roof = eng.getRoofSpec(vol);
        const apexRise = eng.getRoofApexRise(dims, roof);
        const totalH = dims.totalHeight + apexRise;
        const cx = vol.x;
        const cy = vol.zBase + totalH * 0.5 - this.zDatum;
        const cz = -vol.y;
        const c = Math.abs(Math.cos(vol.rot || 0));
        const s = Math.abs(Math.sin(vol.rot || 0));
        const hw = dims.w * 0.5 * c + dims.d * 0.5 * s;
        const hh = totalH * 0.5;
        const hd = dims.w * 0.5 * s + dims.d * 0.5 * c;
        if (cx - hw < minX) minX = cx - hw;
        if (cx + hw > maxX) maxX = cx + hw;
        if (cy - hh < minY) minY = cy - hh;
        if (cy + hh > maxY) maxY = cy + hh;
        if (cz - hd < minZ) minZ = cz - hd;
        if (cz + hd > maxZ) maxZ = cz + hd;
      }
      if (count === 0) return null;
      return {
        pivot: new THREE.Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5),
        radius: Math.max(4, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5),
        count,
        primaryVol
      };
    }

    focusSelection(opts = {}) {
      const info = this._getSelectionPivot3D(this.api.getState());
      if (!info) return false;
      const offset = new THREE.Vector3().subVectors(this.camera.position, this.orbit.target);
      if (offset.lengthSq() < 1e-4) offset.set(36, 28, 42);
      if (opts.fitDistance) {
        offset.setLength(Math.max(22, info.radius * 3.0));
      }
      this.orbit.target.copy(info.pivot);
      this.camera.position.copy(info.pivot).add(offset);
      this.orbit.update();
      this._lastPivotPos = info.pivot.clone();
      return true;
    }

    fitSite() {
      const sb = this.site.meta.siteBounds;
      const cx = (sb.minX + sb.maxX) * 0.5;
      const cy = (sb.minY + sb.maxY) * 0.5;
      const cz = (sb.minZ + sb.maxZ) * 0.5 - this.zDatum;
      this._lastOrbitSelKey = '';
      this._lastPivotPos = null;
      this.orbit.target.set(cx, cz, -cy);
      this.camera.position.set(cx + 68, cz + 56, -cy + 78);
      this.orbit.update();
    }

    _bindEvents() {
      this.transform.addEventListener('dragging-changed', (e) => {
        this.orbit.enabled = !e.value;
        this.isTransforming = e.value;
        if (e.value) {
          this.api.pushUndo();
          const state = this.api.getState();
          const primary = this.transform.object ? this.transform.object.userData.volId : null;
          const pVol = primary ? this.api.getVolume(primary) : null;
          const origins = {};
          for (const id of state.selectedIds) {
            const v = this.api.getVolume(id);
            if (v) origins[id] = { x: v.x, y: v.y, zBase: v.zBase };
          }
          this.transformOrig = pVol ? {
            primaryId: pVol.id,
            origX: pVol.x,
            origY: pVol.y,
            origZBase: pVol.zBase,
            origins
          } : null;
        } else {
          this.transformOrig = null;
          this.focusSelection();
        }
      });

      this.transform.addEventListener('objectChange', () => {
        if (!this.transform.object || !this.transformOrig) return;
        const grp = this.transform.object;
        const vol = this.api.getVolume(this.transformOrig.primaryId);
        if (!vol) return;
        const dims = window.GROUNDWORK_ENGINE.getEffectiveDims(vol, this.api.getState().useGross);
        const worldPos = this.fromThree(grp.position);
        const newZBase = worldPos.z - dims.totalHeight * 0.5;
        const dx = worldPos.x - this.transformOrig.origX;
        const dy = worldPos.y - this.transformOrig.origY;
        const dz = newZBase - this.transformOrig.origZBase;

        const updates = [];
        for (const [id, orig] of Object.entries(this.transformOrig.origins)) {
          updates.push({
            id,
            x: orig.x + dx,
            y: orig.y + dy,
            zBase: orig.zBase + dz
          });
        }
        this.api.updateVolumesBatch(updates, { silentUndo: true, skip3DTransformSync: true });
      });

      const dom = this.renderer.domElement;
      dom.addEventListener('pointerdown', (e) => {
        this.pointerDownPos = { x: e.clientX, y: e.clientY, button: e.button };
        this._pendingOrbitFocus = (
          e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey &&
          !this.isTransforming && !this.transform.axis &&
          this.api.getState().selectedIds.length > 0
        );
      });

      dom.addEventListener('pointermove', (e) => {
        if (this._pendingOrbitFocus && this.pointerDownPos && !this.isTransforming) {
          const moveDist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
          if (moveDist > 4) {
            this._pendingOrbitFocus = false;
            this.focusSelection();
          }
        }
        const state = this.api.getState();
        const pt = this._raycastSiteOrVolume(e);
        if (pt) {
          this.api.updateCursorReadout(pt);
          if (state.tool === 'dimension' && this.dimDraft) {
            this.dimDraft.p2 = pt;
            this._rebuildDimensions();
          }
        }
      });

      dom.addEventListener('pointerup', (e) => {
        this._pendingOrbitFocus = false;
        if (e.button !== 0 || this.isTransforming || !this.pointerDownPos) return;
        const moveDist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
        this.pointerDownPos = null;
        if (moveDist > 5) return; // Was orbit drag

        const state = this.api.getState();
        if (state.tool === 'dimension') {
          const pt = this._raycastSiteOrVolume(e);
          if (!pt) return;
          if (!this.dimDraft) {
            this.dimDraft = { p1: pt, p2: pt };
          } else {
            this.api.addDimension('3d', this.dimDraft.p1, pt);
            this.dimDraft = null;
          }
          this._rebuildDimensions();
          return;
        }

        // Raycast volume boxes
        const rect = dom.getBoundingClientRect();
        this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointerNDC, this.camera);

        const meshes = [];
        for (const grp of this.volumeGroups.values()) {
          if (grp.userData.pickMeshes) meshes.push(...grp.userData.pickMeshes);
          else if (grp.userData.boxMesh) meshes.push(grp.userData.boxMesh);
        }
        const hits = this.raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
          const volId = hits[0].object.userData.volId;
          if (e.shiftKey) this.api.toggleSelect(volId);
          else this.api.selectVolume(volId, e.detail < 2);
          this.focusSelection({ fitDistance: e.detail >= 2 });
        } else if (!e.shiftKey) {
          this.api.clearSelection();
        }
      });
    }

    _raycastSiteOrVolume(e) {
      const dom = this.renderer.domElement;
      const rect = dom.getBoundingClientRect();
      this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointerNDC, this.camera);

      const targets = [this.terrainMesh];
      for (const grp of this.volumeGroups.values()) {
        if (grp.userData.pickMeshes) targets.push(...grp.userData.pickMeshes);
        else if (grp.userData.boxMesh) targets.push(grp.userData.boxMesh);
      }
      const hits = this.raycaster.intersectObjects(targets, false);
      if (hits.length === 0) return null;
      return this.fromThree(hits[0].point);
    }

    resize() {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w < 4 || h < 4) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    syncFromState(opts = {}) {
      const state = this.api.getState();
      const eng = window.GROUNDWORK_ENGINE;
      const prog = window.GROUNDWORK_PROGRAM;
      const isDark = state.theme === 'dark';
      this._applyTheme(isDark);

      // 1. Layers visibility & terrain translucency
      this.contoursGroup.visible = state.layers.contours;
      this.boundaryGroup.visible = state.layers.siteBoundary;
      this.roadsGroup.visible = state.layers.roads;
      this.waterwaysGroup.visible = state.layers.waterways;
      this.buildingsGroup.visible = state.layers.buildings;
      this.plotBuildingsGroup.visible = state.layers.buildings && !!state.layers.plotBuildings;
      this.treesGroup.visible = state.layers.trees;
      this.earthworkGroup.visible = state.layers.cutFill;

      if (this.terrainMat.transparent !== state.layers.translucentTerrain) {
        this.terrainMat.transparent = state.layers.translucentTerrain;
        this.terrainMat.opacity = state.layers.translucentTerrain ? 0.56 : 1.0;
        this.terrainMat.depthWrite = !state.layers.translucentTerrain;
        this.terrainMat.needsUpdate = true;
      }

      // 2. Clipping Plane sync (Rhino-style, keep array length 1 to avoid shader recompiles)
      const plane = this.api.getActivePlane();
      if (plane) {
        const basis = eng.getPlaneBasis(plane);
        if (plane.enabled) {
          const n3 = new THREE.Vector3(basis.vx, 0, -basis.vy).normalize();
          const c = -(basis.vx * basis.cx + basis.vy * basis.cy);
          this.clipPlane.normal.copy(n3);
          this.clipPlane.constant = c;
        } else {
          this.clipPlane.set(new THREE.Vector3(0, 1, 0), 1e6);
        }

        const gzMid = eng.getGroundZ(basis.cx, basis.cy);
        this.clipFrameGroup.position.set(basis.cx, gzMid - this.zDatum + 6, -basis.cy);
        this.clipFrameGroup.rotation.set(0, basis.rad, 0);
        this.clipFrameGroup.visible = plane.enabled || state.tool === 'section';
      }

      // 3. Space Volumes sync
      const seenIds = new Set();
      for (const vol of state.volumes) {
        seenIds.add(vol.id);
        const dims = eng.getEffectiveDims(vol, state.useGross);
        const roof = eng.getRoofSpec(vol);
        const cat = prog.getSpaceStyle(vol);
        const isSelected = state.selectedIds.includes(vol.id);

        let grp = this.volumeGroups.get(vol.id);
        const sig = `${dims.w.toFixed(3)}|${dims.d.toFixed(3)}|${dims.totalHeight.toFixed(3)}|${dims.floors}|${cat.color}|${roof.type}|${roof.angle}|${roof.dir}|${roof.overhang.toFixed(2)}`;
        if (!grp) {
          grp = new THREE.Group();
          grp.userData.volId = vol.id;
          this.scene.add(grp);
          this.volumeGroups.set(vol.id, grp);
        }

        if (grp.userData.sig !== sig || grp.userData.sel !== isSelected || grp.userData.theme !== isDark) {
          while (grp.children.length) {
            const ch = grp.children.pop();
            if (ch.geometry) ch.geometry.dispose();
            if (ch.material) ch.material.dispose();
          }

          const boxGeom = new THREE.BoxGeometry(dims.w, dims.totalHeight, dims.d);
          const boxMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(cat.color),
            roughness: 0.72,
            metalness: 0.04,
            transparent: true,
            opacity: isSelected ? 0.88 : 0.74,
            clippingPlanes: this.activeClipPlanes
          });
          const boxMesh = new THREE.Mesh(boxGeom, boxMat);
          boxMesh.castShadow = true;
          boxMesh.receiveShadow = true;
          boxMesh.userData.volId = vol.id;
          grp.add(boxMesh);
          grp.userData.boxMesh = boxMesh;
          grp.userData.pickMeshes = [boxMesh];

          const selEdgeColor = isDark ? 0xf2eee6 : 0x11100e;
          const normEdgeColor = isDark ? 0xc5bfb2 : 0x3b3832;
          const edgeMat = new THREE.LineBasicMaterial({
            color: isSelected ? selEdgeColor : normEdgeColor,
            clippingPlanes: this.activeClipPlanes
          });
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeom), edgeMat);
          grp.add(edges);

          if (roof.type !== 'flat' || roof.overhang > 0.01) {
            const roofColor = new THREE.Color(cat.color).multiplyScalar(isDark ? 0.82 : 0.72);
            const roofMat = new THREE.MeshStandardMaterial({
              color: roofColor,
              roughness: 0.78,
              metalness: 0.05,
              transparent: true,
              opacity: isSelected ? 0.94 : 0.86,
              clippingPlanes: this.activeClipPlanes
            });
            const roofBuilt = this._buildRoofMeshes(vol.id, dims, roof, boxMat, roofMat, edgeMat);
            for (const obj of roofBuilt.objects) grp.add(obj);
            grp.userData.pickMeshes.push(...roofBuilt.pickMeshes);
          }

          // Subtle floor plate divider lines when multi-floor
          if (dims.floors > 1) {
            const linePts = [];
            for (let f = 1; f < dims.floors; f++) {
              const fy = -dims.totalHeight * 0.5 + f * dims.floorHeight;
              const hw = dims.w * 0.5 + 0.02;
              const hd = dims.d * 0.5 + 0.02;
              linePts.push(
                new THREE.Vector3(-hw, fy, -hd), new THREE.Vector3(hw, fy, -hd),
                new THREE.Vector3(hw, fy, -hd), new THREE.Vector3(hw, fy, hd),
                new THREE.Vector3(hw, fy, hd), new THREE.Vector3(-hw, fy, hd),
                new THREE.Vector3(-hw, fy, hd), new THREE.Vector3(-hw, fy, -hd)
              );
            }
            const flGeom = new THREE.BufferGeometry().setFromPoints(linePts);
            const flMat = new THREE.LineBasicMaterial({
              color: isDark ? 0xece8df : 0x22201d,
              transparent: true,
              opacity: 0.55,
              clippingPlanes: this.activeClipPlanes
            });
            grp.add(new THREE.LineSegments(flGeom, flMat));
          }

          grp.userData.sig = sig;
          grp.userData.sel = isSelected;
          grp.userData.theme = isDark;
        }

        if (!(opts.skip3DTransformSync && this.transform.object === grp)) {
          grp.position.set(vol.x, vol.zBase + dims.totalHeight * 0.5 - this.zDatum, -vol.y);
          grp.rotation.set(0, vol.rot || 0, 0);
        }
      }

      // Remove deleted volumes
      for (const [id, grp] of this.volumeGroups.entries()) {
        if (!seenIds.has(id)) {
          if (this.transform.object === grp) this.transform.detach();
          this.scene.remove(grp);
          this.volumeGroups.delete(id);
        }
      }

      // Attach XYZ TransformControls to primary selected volume
      if (!this.isTransforming) {
        if (state.selectedIds.length > 0 && state.tool === 'select') {
          const targetGrp = this.volumeGroups.get(state.selectedIds[0]);
          if (targetGrp) {
            if (this.transform.object !== targetGrp) this.transform.attach(targetGrp);
          } else {
            this.transform.detach();
          }
        } else {
          this.transform.detach();
        }
      }

      // Revit-style orbit pivot lock around selected space(s)
      const selKey = state.selectedIds.slice().sort().join(',');
      const selInfo = this._getSelectionPivot3D(state);
      const hintEl = document.getElementById('vp3dOrbitHint');
      if (hintEl) {
        if (!selInfo) {
          hintEl.textContent = 'Click space to orbit around it & edit XYZ';
        } else if (selInfo.count === 1 && selInfo.primaryVol) {
          hintEl.textContent = `Orbit Pivot: ${selInfo.primaryVol.ref || selInfo.primaryVol.id} ${selInfo.primaryVol.short} · Drag to orbit`;
        } else {
          hintEl.textContent = `Orbit Pivot: ${selInfo.count} selected spaces · Drag to orbit`;
        }
      }
      if (selInfo && !this.isTransforming && !opts.skip3DTransformSync) {
        if (selKey !== this._lastOrbitSelKey || !this._lastPivotPos || this._lastPivotPos.distanceToSquared(selInfo.pivot) > 1e-4) {
          this.focusSelection();
        }
      }
      this._lastOrbitSelKey = selKey;
      if (!selInfo) this._lastPivotPos = null;

      // 4. Rebuild Cut & Fill Soil Meshes
      this._rebuildEarthworkMeshes(state);

      // 5. Rebuild 3D Dimensions
      this._rebuildDimensions();

      // 6. Sync clean HTML 3D labels (Name + Area ONLY, NO keywords)
      this._syncLabelElements(state);
    }

    _rebuildEarthworkMeshes(state) {
      while (this.earthworkGroup.children.length) {
        const ch = this.earthworkGroup.children.pop();
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) ch.material.dispose();
      }
      if (!state.layers.cutFill) return;

      const eng = window.GROUNDWORK_ENGINE;
      const cutPos = [];
      const fillPos = [];

      const pushQuad = (arr, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) => {
        arr.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        arr.push(ax, ay, az, cx, cy, cz, dx, dy, dz);
      };

      for (const vol of state.volumes) {
        const ew = eng.computeEarthwork(vol, state.useGross, 14);
        const stride = ew.nx + 1;
        const zB = ew.zBase - this.zDatum;

        for (let iy = 0; iy < ew.ny; iy++) {
          for (let ix = 0; ix < ew.nx; ix++) {
            const i00 = iy * stride + ix;
            const i10 = i00 + 1;
            const i01 = i00 + stride;
            const i11 = i01 + 1;

            const gz00 = ew.cornerGZ[i00] - this.zDatum;
            const gz10 = ew.cornerGZ[i10] - this.zDatum;
            const gz11 = ew.cornerGZ[i11] - this.zDatum;
            const gz01 = ew.cornerGZ[i01] - this.zDatum;

            const x00 = ew.cornerX[i00], z00 = -ew.cornerY[i00];
            const x10 = ew.cornerX[i10], z10 = -ew.cornerY[i10];
            const x11 = ew.cornerX[i11], z11 = -ew.cornerY[i11];
            const x01 = ew.cornerX[i01], z01 = -ew.cornerY[i01];

            // Cut cell (ground above zBase)
            const maxD = Math.max(gz00 - zB, gz10 - zB, gz11 - zB, gz01 - zB);
            if (maxD > 0.03) {
              const t00 = Math.max(zB, gz00);
              const t10 = Math.max(zB, gz10);
              const t11 = Math.max(zB, gz11);
              const t01 = Math.max(zB, gz01);
              // Top slope face + flat base
              pushQuad(cutPos, x00, t00, z00, x10, t10, z10, x11, t11, z11, x01, t01, z01);
              pushQuad(cutPos, x00, zB, z00, x01, zB, z01, x11, zB, z11, x10, zB, z10);
              // Perimeter skirts
              if (ix === 0) pushQuad(cutPos, x00, zB, z00, x00, t00, z00, x01, t01, z01, x01, zB, z01);
              if (ix === ew.nx - 1) pushQuad(cutPos, x10, zB, z10, x11, zB, z11, x11, t11, z11, x10, t10, z10);
              if (iy === 0) pushQuad(cutPos, x00, zB, z00, x10, zB, z10, x10, t10, z10, x00, t00, z00);
              if (iy === ew.ny - 1) pushQuad(cutPos, x01, zB, z01, x01, t01, z01, x11, t11, z11, x11, zB, z11);
            }

            // Fill cell (ground below zBase)
            const minD = Math.min(gz00 - zB, gz10 - zB, gz11 - zB, gz01 - zB);
            if (minD < -0.03) {
              const b00 = Math.min(zB, gz00);
              const b10 = Math.min(zB, gz10);
              const b11 = Math.min(zB, gz11);
              const b01 = Math.min(zB, gz01);
              // Top level pad + bottom slope contact
              pushQuad(fillPos, x00, zB, z00, x10, zB, z10, x11, zB, z11, x01, zB, z01);
              pushQuad(fillPos, x00, b00, z00, x01, b01, z01, x11, b11, z11, x10, b10, z10);
              if (ix === 0) pushQuad(fillPos, x00, b00, z00, x00, zB, z00, x01, zB, z01, x01, b01, z01);
              if (ix === ew.nx - 1) pushQuad(fillPos, x10, b10, z10, x11, b11, z11, x11, zB, z11, x10, zB, z10);
              if (iy === 0) pushQuad(fillPos, x00, b00, z00, x10, b10, z10, x10, zB, z10, x00, zB, z00);
              if (iy === ew.ny - 1) pushQuad(fillPos, x01, b01, z01, x01, zB, z01, x11, zB, z11, x11, b11, z11);
            }
          }
        }
      }

      if (cutPos.length > 0) {
        const gCut = new THREE.BufferGeometry();
        gCut.setAttribute('position', new THREE.Float32BufferAttribute(cutPos, 3));
        gCut.computeVertexNormals();
        const mCut = new THREE.MeshStandardMaterial({
          color: 0xb85d43,
          roughness: 0.85,
          transparent: true,
          opacity: 0.60,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          clippingPlanes: this.activeClipPlanes
        });
        this.earthworkGroup.add(new THREE.Mesh(gCut, mCut));
      }

      if (fillPos.length > 0) {
        const gFill = new THREE.BufferGeometry();
        gFill.setAttribute('position', new THREE.Float32BufferAttribute(fillPos, 3));
        gFill.computeVertexNormals();
        const mFill = new THREE.MeshStandardMaterial({
          color: 0xc9a252,
          roughness: 0.85,
          transparent: true,
          opacity: 0.62,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          clippingPlanes: this.activeClipPlanes
        });
        this.earthworkGroup.add(new THREE.Mesh(gFill, mFill));
      }
    }

    _rebuildDimensions() {
      while (this.dimGroup.children.length) {
        const ch = this.dimGroup.children.pop();
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) ch.material.dispose();
      }
      for (const el of this.dimLabelEls) el.remove();
      this.dimLabelEls = [];

      const state = this.api.getState();
      const isDark = state.theme === 'dark';
      const dims = state.dimensions.filter(d => d.view === '3d');
      const all = this.dimDraft ? [...dims, { ...this.dimDraft, draft: true }] : dims;

      for (const d of all) {
        const a = this.toThree(d.p1.x, d.p1.y, d.p1.z + 0.15);
        const b = this.toThree(d.p2.x, d.p2.y, d.p2.z + 0.15);
        const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
        const lineCol = d.draft ? (isDark ? 0xa49d91 : 0x6d685f) : (isDark ? 0xece8df : 0x22201d);
        const mat = new THREE.LineBasicMaterial({ color: lineCol });
        this.dimGroup.add(new THREE.Line(geom, mat));

        const el = document.createElement('div');
        el.className = 'label-3d';
        const dist3d = Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y, d.p2.z - d.p1.z);
        const dHoriz = Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y);
        const dz = d.p2.z - d.p1.z;
        el.textContent = `${dist3d.toFixed(2)} m (H ${dHoriz.toFixed(1)} · ΔZ ${dz >= 0 ? '+' : ''}${dz.toFixed(1)}m)`;
        this.labelLayer.appendChild(el);
        this.dimLabelEls.push({
          el,
          pos: new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
          a: a.clone(),
          b: b.clone(),
          isDraft: !!d.draft
        });
      }
    }

    _syncLabelElements(state) {
      const seen = new Set();
      for (const vol of state.volumes) {
        seen.add(vol.id);
        const dims = window.GROUNDWORK_ENGINE.getEffectiveDims(vol, state.useGross);
        let el = this.labelEls.get(vol.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'label-3d';
          this.labelLayer.appendChild(el);
          this.labelEls.set(vol.id, el);
        }
        el.classList.toggle('selected', state.selectedIds.includes(vol.id));
        // Strictly NO keywords in 3D view — Name & Area only!
        const areaText = dims.floors > 1
          ? `${dims.totalArea.toFixed(0)} m² (${dims.floors}F)`
          : `${dims.totalArea.toFixed(0)} m²`;
        el.innerHTML = `${this._esc(vol.ref + ' ' + vol.short)}<span class="label-3d-area">${areaText}</span>`;
      }

      for (const [id, el] of this.labelEls.entries()) {
        if (!seen.has(id)) {
          el.remove();
          this.labelEls.delete(id);
        }
      }
    }

    _updateProjectedLabels() {
      const state = this.api.getState();
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w < 4 || h < 4) return;
      const plane = this.api.getActivePlane();
      const eng = window.GROUNDWORK_ENGINE;
      const tmp = new THREE.Vector3();
      const tmpA = new THREE.Vector3();
      const tmpB = new THREE.Vector3();

      for (const vol of state.volumes) {
        const el = this.labelEls.get(vol.id);
        if (!el) continue;
        const dims = eng.getEffectiveDims(vol, state.useGross);
        const roof = eng.getRoofSpec(vol);
        const apexRise = eng.getRoofApexRise(dims, roof);
        tmp.set(vol.x, vol.zBase + dims.totalHeight + apexRise + 0.55 - this.zDatum, -vol.y);

        // Hide if clipped away by active clipping plane
        if (plane && plane.enabled && this.clipPlane.distanceToPoint(tmp) < -0.5) {
          el.style.display = 'none';
          continue;
        }

        tmp.project(this.camera);
        if (tmp.z > 1 || tmp.z < -1) {
          el.style.display = 'none';
          continue;
        }
        const sx = (tmp.x * 0.5 + 0.5) * w;
        const sy = (-tmp.y * 0.5 + 0.5) * h;
        if (sx < -40 || sx > w + 40 || sy < -20 || sy > h + 20) {
          el.style.display = 'none';
          continue;
        }
        el.style.display = 'block';
        el.style.left = sx.toFixed(1) + 'px';
        el.style.top = sy.toFixed(1) + 'px';
      }

      for (const dl of this.dimLabelEls) {
        if (!dl || !dl.el) continue;
        if (!dl.isDraft && dl.a && dl.b) {
          tmpA.copy(dl.a).project(this.camera);
          tmpB.copy(dl.b).project(this.camera);
          const sDist = Math.hypot((tmpA.x - tmpB.x) * 0.5 * w, (tmpA.y - tmpB.y) * 0.5 * h);
          if (sDist < 54) {
            dl.el.style.display = 'none';
            continue;
          }
        }
        tmp.copy(dl.pos).project(this.camera);
        if (tmp.z > 1 || tmp.z < -1) {
          dl.el.style.display = 'none';
          continue;
        }
        dl.el.style.display = 'block';
        dl.el.style.left = ((tmp.x * 0.5 + 0.5) * w).toFixed(1) + 'px';
        dl.el.style.top = ((-tmp.y * 0.5 + 0.5) * h).toFixed(1) + 'px';
      }
    }

    _animate() {
      requestAnimationFrame(() => this._animate());
      if (this.container.offsetParent === null) return; // hidden viewport
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
      this._updateProjectedLabels();
    }

    captureImageDataURL() {
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL('image/png');
    }

    _buildRoofMeshes(volId, dims, roof, boxMat, roofMat, edgeMat) {
      const eng = window.GROUNDWORK_ENGINE;
      const hw = dims.w * 0.5;
      const hd = dims.d * 0.5;
      const ov = roof.overhang || 0;
      const ehw = hw + ov;
      const ehd = hd + ov;
      const yEave = dims.totalHeight * 0.5;
      const thick = 0.16;

      const riseAt = (lx, ly) => eng.getRoofRiseAtLocal(lx, ly, dims.w, dims.d, roof);
      const pt = (lx, ly, extraY = 0) => [lx, yEave + riseAt(lx, ly) + extraY, -ly];
      const basePt = (lx, ly) => [lx, yEave, -ly];

      const pushTri = (arr, a, b, c, ox, oy, oz) => {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        if (nx * ox + ny * oy + nz * oz >= 0) {
          arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        } else {
          arr.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
        }
      };
      const pushQuad = (arr, a, b, c, d, ox, oy, oz) => {
        pushTri(arr, a, b, c, ox, oy, oz);
        pushTri(arr, a, c, d, ox, oy, oz);
      };

      const objects = [];
      const pickMeshes = [];

      // 1. Under-roof wall infill (gable ends / skillion high wall & cheeks)
      const underPos = [];
      if (roof.type === 'skillion') {
        const ring = [[-hw, -hd, 0, 1], [hw, -hd, 1, 0], [hw, hd, 0, -1], [-hw, hd, -1, 0]];
        for (let i = 0; i < 4; i++) {
          const [ax, ay, ox, oz] = ring[i];
          const [bx, by] = ring[(i + 1) % 4];
          const ha = riseAt(ax, ay), hb = riseAt(bx, by);
          if (ha > 0.005 || hb > 0.005) {
            pushQuad(underPos, basePt(ax, ay), basePt(bx, by), pt(bx, by), pt(ax, ay), ox, 0, oz);
          }
        }
        pushQuad(underPos, pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd), 0, 1, 0);
      } else if (roof.type === 'gable') {
        if (roof.dir === 0 || roof.dir === 180) {
          pushTri(underPos, basePt(-hw, -hd), basePt(-hw, hd), pt(-hw, 0), -1, 0, 0);
          pushTri(underPos, basePt(hw, -hd), basePt(hw, hd), pt(hw, 0), 1, 0, 0);
          pushQuad(underPos, pt(-hw, -hd), pt(hw, -hd), pt(hw, 0), pt(-hw, 0), 0, 1, 0);
          pushQuad(underPos, pt(-hw, 0), pt(hw, 0), pt(hw, hd), pt(-hw, hd), 0, 1, 0);
        } else {
          pushTri(underPos, basePt(-hw, -hd), basePt(hw, -hd), pt(0, -hd), 0, 0, 1);
          pushTri(underPos, basePt(-hw, hd), basePt(hw, hd), pt(0, hd), 0, 0, -1);
          pushQuad(underPos, pt(-hw, -hd), pt(0, -hd), pt(0, hd), pt(-hw, hd), 0, 1, 0);
          pushQuad(underPos, pt(0, -hd), pt(hw, -hd), pt(hw, hd), pt(0, hd), 0, 1, 0);
        }
      }

      if (underPos.length > 0) {
        const uGeom = new THREE.BufferGeometry();
        uGeom.setAttribute('position', new THREE.Float32BufferAttribute(underPos, 3));
        uGeom.computeVertexNormals();
        const uMesh = new THREE.Mesh(uGeom, boxMat);
        uMesh.castShadow = true;
        uMesh.receiveShadow = true;
        uMesh.userData.volId = volId;
        objects.push(uMesh);
        pickMeshes.push(uMesh);
        objects.push(new THREE.LineSegments(new THREE.EdgesGeometry(uGeom, 14), edgeMat));
      }

      // 2. Overhanging roof cap slab
      const capPos = [];
      const addCapQuad = (c0, c1, c2, c3) => {
        pushQuad(capPos, pt(c0[0], c0[1], thick), pt(c1[0], c1[1], thick), pt(c2[0], c2[1], thick), pt(c3[0], c3[1], thick), 0, 1, 0);
        pushQuad(capPos, pt(c0[0], c0[1], 0), pt(c1[0], c1[1], 0), pt(c2[0], c2[1], 0), pt(c3[0], c3[1], 0), 0, -1, 0);
      };
      const addCapTri = (c0, c1, c2) => {
        pushTri(capPos, pt(c0[0], c0[1], thick), pt(c1[0], c1[1], thick), pt(c2[0], c2[1], thick), 0, 1, 0);
        pushTri(capPos, pt(c0[0], c0[1], 0), pt(c1[0], c1[1], 0), pt(c2[0], c2[1], 0), 0, -1, 0);
      };
      const addFasciaSeg = (ax, ay, bx, by, ox, oz) => {
        pushQuad(capPos, pt(ax, ay, 0), pt(bx, by, 0), pt(bx, by, thick), pt(ax, ay, thick), ox, 0, oz);
      };

      if (roof.type === 'flat' || roof.type === 'skillion') {
        addCapQuad([-ehw, -ehd], [ehw, -ehd], [ehw, ehd], [-ehw, ehd]);
        addFasciaSeg(-ehw, -ehd, ehw, -ehd, 0, 1);
        addFasciaSeg(ehw, -ehd, ehw, ehd, 1, 0);
        addFasciaSeg(ehw, ehd, -ehw, ehd, 0, -1);
        addFasciaSeg(-ehw, ehd, -ehw, -ehd, -1, 0);
      } else if (roof.type === 'gable') {
        if (roof.dir === 0 || roof.dir === 180) {
          addCapQuad([-ehw, -ehd], [ehw, -ehd], [ehw, 0], [-ehw, 0]);
          addCapQuad([-ehw, 0], [ehw, 0], [ehw, ehd], [-ehw, ehd]);
          addFasciaSeg(-ehw, -ehd, ehw, -ehd, 0, 1);
          addFasciaSeg(ehw, ehd, -ehw, ehd, 0, -1);
          addFasciaSeg(ehw, -ehd, ehw, 0, 1, 0);
          addFasciaSeg(ehw, 0, ehw, ehd, 1, 0);
          addFasciaSeg(-ehw, ehd, -ehw, 0, -1, 0);
          addFasciaSeg(-ehw, 0, -ehw, -ehd, -1, 0);
        } else {
          addCapQuad([-ehw, -ehd], [0, -ehd], [0, ehd], [-ehw, ehd]);
          addCapQuad([0, -ehd], [ehw, -ehd], [ehw, ehd], [0, ehd]);
          addFasciaSeg(ehw, -ehd, ehw, ehd, 1, 0);
          addFasciaSeg(-ehw, ehd, -ehw, -ehd, -1, 0);
          addFasciaSeg(-ehw, -ehd, 0, -ehd, 0, 1);
          addFasciaSeg(0, -ehd, ehw, -ehd, 0, 1);
          addFasciaSeg(ehw, ehd, 0, ehd, 0, -1);
          addFasciaSeg(0, ehd, -ehw, ehd, 0, -1);
        }
      } else {
        // hip (note ehw - ehd === hw - hd)
        if (hw >= hd) {
          const rx = hw - hd;
          if (rx > 0.02) {
            addCapQuad([-ehw, -ehd], [ehw, -ehd], [rx, 0], [-rx, 0]);
            addCapQuad([-rx, 0], [rx, 0], [ehw, ehd], [-ehw, ehd]);
          } else {
            addCapTri([-ehw, -ehd], [ehw, -ehd], [0, 0]);
            addCapTri([-ehw, ehd], [ehw, ehd], [0, 0]);
          }
          addCapTri([-ehw, -ehd], [-ehw, ehd], [-rx, 0]);
          addCapTri([ehw, -ehd], [ehw, ehd], [rx, 0]);
        } else {
          const ry = hd - hw;
          if (ry > 0.02) {
            addCapQuad([-ehw, -ehd], [0, -ry], [0, ry], [-ehw, ehd]);
            addCapQuad([0, -ry], [ehw, -ehd], [ehw, ehd], [0, ry]);
          } else {
            addCapTri([-ehw, -ehd], [-ehw, ehd], [0, 0]);
            addCapTri([ehw, -ehd], [ehw, ehd], [0, 0]);
          }
          addCapTri([-ehw, -ehd], [ehw, -ehd], [0, -ry]);
          addCapTri([-ehw, ehd], [ehw, ehd], [0, ry]);
        }
        addFasciaSeg(-ehw, -ehd, ehw, -ehd, 0, 1);
        addFasciaSeg(ehw, -ehd, ehw, ehd, 1, 0);
        addFasciaSeg(ehw, ehd, -ehw, ehd, 0, -1);
        addFasciaSeg(-ehw, ehd, -ehw, -ehd, -1, 0);
      }

      if (capPos.length > 0) {
        const cGeom = new THREE.BufferGeometry();
        cGeom.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
        cGeom.computeVertexNormals();
        const cMesh = new THREE.Mesh(cGeom, roofMat);
        cMesh.castShadow = true;
        cMesh.receiveShadow = true;
        cMesh.userData.volId = volId;
        objects.push(cMesh);
        pickMeshes.push(cMesh);
        objects.push(new THREE.LineSegments(new THREE.EdgesGeometry(cGeom, 12), edgeMat));
      }

      return { objects, pickMeshes };
    }

    _esc(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  window.GroundworkView3D = View3D;
})();
