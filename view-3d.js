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
      this._syncedTerrainVersion = -1;
      this._altHeld = false;
      this.boxSelectMode = false;
      this._boxDrag = null;

      this.volumeGroups = new Map();
      this.terrainModGroups = new Map();
      this.circGroups = new Map();
      this.terrainModPickers = [];
      this.circPickers = [];
      this.activeCircLiftEnd = null;
      this.circEndProxy = new THREE.Object3D();
      this.earthworkGroup = new THREE.Group();
      this.terrainCutPatchGroup = new THREE.Group();
      this.terrainModGroup = new THREE.Group();
      this.circulationGroup = new THREE.Group();
      this.snapGuideGroup = new THREE.Group();
      this.rainGroup = new THREE.Group();
      this.dimGroup = new THREE.Group();
      this.labelEls = new Map();
      this.dimLabelEls = [];

      this._setupLights();
      this._buildSiteEnvironment();
      this._buildClipFrame();
      this.scene.add(this.terrainCutPatchGroup);
      this.scene.add(this.terrainModGroup);
      this.scene.add(this.circulationGroup);
      this.scene.add(this.earthworkGroup);
      this.scene.add(this.snapGuideGroup);
      this.scene.add(this.rainGroup);
      this.scene.add(this.dimGroup);
      this.scene.add(this.circEndProxy);

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

      this._baseTerrainIndices = new Uint32Array(indices);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geom.setIndex(new THREE.Uint32BufferAttribute(this._baseTerrainIndices, 1));
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

    setBoxSelectMode(on) {
      this.boxSelectMode = !!on;
      if (this.renderer && this.renderer.domElement) {
        this.renderer.domElement.style.cursor = this.boxSelectMode ? 'crosshair' : 'default';
      }
      const boxEl = document.getElementById('marquee3dBox');
      if (boxEl && !this.boxSelectMode) boxEl.style.display = 'none';
    }

    _syncTerrainMesh() {
      const eng = window.GROUNDWORK_ENGINE;
      const ver = eng.getTerrainVersion ? eng.getTerrainVersion() : 0;
      if (this._syncedTerrainVersion === ver || !this.terrainMesh) return;
      this._syncedTerrainVersion = ver;
      const zArr = eng.getPadHeightfieldZ ? eng.getPadHeightfieldZ() : eng.getGradedHeightfieldZ();
      if (!zArr) return;
      const hf = this.site.heightfield;
      const posAttr = this.terrainMesh.geometry.attributes.position;
      const colAttr = this.terrainMesh.geometry.attributes.color;
      const posArr = posAttr.array;
      const colArr = colAttr.array;
      const zMin = this.site.meta.zMin;
      const zSpan = Math.max(1, this.site.meta.zMax - zMin);
      const nx = hf.nx;
      const ny = hf.ny;
      const total = nx * ny;
      for (let i = 0; i < total; i++) {
        const wz = zArr[i];
        posArr[i * 3 + 1] = wz - this.zDatum;
        const t = Math.max(0, Math.min(1, (wz - zMin) / zSpan));
        colArr[i * 3] = 0.76 + t * 0.14;
        colArr[i * 3 + 1] = 0.76 + t * 0.11;
        colArr[i * 3 + 2] = 0.69 + t * 0.11;
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;

      while (this.terrainCutPatchGroup.children.length) {
        const ch = this.terrainCutPatchGroup.children.pop();
        if (ch.geometry) ch.geometry.dispose();
      }

      const cutouts = eng.getActiveCircCutouts ? eng.getActiveCircCutouts() : [];
      if (cutouts.length === 0) {
        if (this._terrainIndexFiltered && this._baseTerrainIndices) {
          this.terrainMesh.geometry.setIndex(new THREE.Uint32BufferAttribute(this._baseTerrainIndices, 1));
          this._terrainIndexFiltered = false;
        }
        this.terrainMesh.geometry.computeVertexNormals();
        return;
      }

      // Skip heightfield cells overlapping any cutout AABB and rebuild exact clipped sub-triangles + trench banks
      const nCellsX = nx - 1;
      const nCellsY = ny - 1;
      const cellMarked = new Uint8Array(nCellsX * nCellsY);
      const cs = hf.cellSize;
      for (const c of cutouts) {
        const bb = c.bbox;
        if (!bb) continue;
        const ix0 = Math.max(0, Math.floor((bb.minX - 0.05 - hf.minX) / cs));
        const ix1 = Math.min(nCellsX - 1, Math.floor((bb.maxX + 0.05 - hf.minX) / cs));
        const iy0 = Math.max(0, Math.floor((bb.minY - 0.05 - hf.minY) / cs));
        const iy1 = Math.min(nCellsY - 1, Math.floor((bb.maxY + 0.05 - hf.minY) / cs));
        for (let iy = iy0; iy <= iy1; iy++) {
          const row = iy * nCellsX;
          for (let ix = ix0; ix <= ix1; ix++) {
            cellMarked[row + ix] = 1;
          }
        }
      }

      const filteredIndices = [];
      for (let iy = 0; iy < nCellsY; iy++) {
        const cRow = iy * nCellsX;
        const vRow = iy * nx;
        for (let ix = 0; ix < nCellsX; ix++) {
          if (cellMarked[cRow + ix]) continue;
          const a = vRow + ix;
          const b = a + 1;
          const c = (iy + 1) * nx + ix + 1;
          const d = (iy + 1) * nx + ix;
          filteredIndices.push(a, b, c, a, c, d);
        }
      }
      this.terrainMesh.geometry.setIndex(filteredIndices);
      this._terrainIndexFiltered = true;
      this.terrainMesh.geometry.computeVertexNormals();

      const clipHalfPlane = (poly, fn, sign) => {
        const out = [];
        const n = poly.length;
        if (n < 3) return out;
        const EPS = 1e-6;
        for (let i = 0; i < n; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % n];
          const fa = fn(a) * sign;
          const fb = fn(b) * sign;
          const inA = fa >= -EPS;
          const inB = fb >= -EPS;
          if (inA && inB) {
            out.push(b);
          } else if (inA && !inB) {
            const denom = fa - fb;
            const t = Math.max(0, Math.min(1, Math.abs(denom) > 1e-9 ? fa / denom : 0.5));
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          } else if (!inA && inB) {
            const denom = fa - fb;
            const t = Math.max(0, Math.min(1, Math.abs(denom) > 1e-9 ? fa / denom : 0.5));
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            out.push(b);
          }
        }
        const clean = [];
        for (const p of out) {
          if (!clean.length || Math.hypot(p[0] - clean[clean.length - 1][0], p[1] - clean[clean.length - 1][1]) > 1e-4) {
            clean.push(p);
          }
        }
        if (clean.length >= 2 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 1e-4) {
          clean.pop();
        }
        return clean;
      };

      const splitConvexByCutout = (poly, co) => {
        const planes = [
          (p) => co.halfL - ((p[0] - co.x) * co.cos + (p[1] - co.y) * co.sin),
          (p) => ((p[0] - co.x) * co.cos + (p[1] - co.y) * co.sin) + co.halfL,
          (p) => co.halfW - (-(p[0] - co.x) * co.sin + (p[1] - co.y) * co.cos),
          (p) => (-(p[0] - co.x) * co.sin + (p[1] - co.y) * co.cos) + co.halfW
        ];
        let rem = poly;
        const outside = [];
        for (const fn of planes) {
          const pos = clipHalfPlane(rem, fn, +1);
          const neg = clipHalfPlane(rem, fn, -1);
          if (neg.length >= 3) outside.push(neg);
          rem = pos;
          if (rem.length < 3) break;
        }
        return { inside: rem.length >= 3 ? rem : null, outside };
      };

      const patchPos = [];
      const patchCol = [];
      const pushTri = (ax, ay, az, bx, by, bz, cx3, cy3, cz3, darkFactor = 1.0) => {
        const pushVert = (vx, wz, vy) => {
          patchPos.push(vx, wz - this.zDatum, -vy);
          const t = Math.max(0, Math.min(1, (wz - zMin) / zSpan));
          patchCol.push((0.76 + t * 0.14) * darkFactor, (0.76 + t * 0.11) * darkFactor, (0.69 + t * 0.11) * darkFactor);
        };
        pushVert(ax, ay, az);
        pushVert(bx, by, bz);
        pushVert(cx3, cy3, cz3);
      };

      for (let iy = 0; iy < nCellsY; iy++) {
        const cRow = iy * nCellsX;
        for (let ix = 0; ix < nCellsX; ix++) {
          if (!cellMarked[cRow + ix]) continue;
          const x0 = hf.minX + ix * cs;
          const x1 = x0 + cs;
          const y0 = hf.minY + iy * cs;
          const y1 = y0 + cs;

          const hitIndices = [];
          for (let ci = 0; ci < cutouts.length; ci++) {
            const bb = cutouts[ci].bbox;
            if (x1 >= bb.minX - 0.05 && x0 <= bb.maxX + 0.05 && y1 >= bb.minY - 0.05 && y0 <= bb.maxY + 0.05) {
              hitIndices.push(ci);
            }
          }
          let pieces = [{ poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], ciList: [] }];
          for (const ci of hitIndices) {
            const nextPieces = [];
            for (const pc of pieces) {
              const sp = splitConvexByCutout(pc.poly, cutouts[ci]);
              for (const op of sp.outside) nextPieces.push({ poly: op, ciList: pc.ciList });
              if (sp.inside) nextPieces.push({ poly: sp.inside, ciList: [...pc.ciList, ci] });
            }
            pieces = nextPieces;
          }

          for (const pc of pieces) {
            const poly = pc.poly;
            if (poly.length < 3) continue;
            const zList = poly.map(([px, py]) => {
              let z = eng.getPadGroundZ(px, py);
              for (const ci of pc.ciList) {
                const co = cutouts[ci];
                const u = (px - co.x) * co.cos + (py - co.y) * co.sin;
                const cutZ = co.soffitZAtU(u) - 0.04;
                if (cutZ < z) z = cutZ;
              }
              return z;
            });
            const shade = pc.ciList.length > 0 ? 0.88 : 1.0;
            for (let k = 1; k < poly.length - 1; k++) {
              pushTri(
                poly[0][0], zList[0], poly[0][1],
                poly[k][0], zList[k], poly[k][1],
                poly[k + 1][0], zList[k + 1], poly[k + 1][1],
                shade
              );
            }
          }
        }
      }

      // Vertical cut-bank skirts along each excavated cutout perimeter where padZ > soffitZ
      for (const co of cutouts) {
        const hl = co.halfL;
        const hw = co.halfW;
        const nU = Math.max(4, Math.ceil(co.length / 0.5));
        const nV = Math.max(2, Math.ceil(co.width / 0.5));
        const toW = (u, v) => ({ x: co.x + u * co.cos - v * co.sin, y: co.y + u * co.sin + v * co.cos });
        const addEdgeStrip = (samples) => {
          for (let k = 0; k < samples.length - 1; k++) {
            const a = samples[k], b = samples[k + 1];
            const wa = toW(a.u, a.v), wb = toW(b.u, b.v);
            const zTopA = eng.getPadGroundZ(wa.x, wa.y);
            const zTopB = eng.getPadGroundZ(wb.x, wb.y);
            const zBotA = co.soffitZAtU(a.u) - 0.04;
            const zBotB = co.soffitZAtU(b.u) - 0.04;
            if (zTopA <= zBotA + 0.02 && zTopB <= zBotB + 0.02) continue;
            const za0 = Math.min(zTopA, zBotA), zb0 = Math.min(zTopB, zBotB);
            pushTri(wa.x, za0, wa.y, wb.x, zb0, wb.y, wb.x, zTopB, wb.y, 0.82);
            pushTri(wa.x, za0, wa.y, wb.x, zTopB, wb.y, wa.x, zTopA, wa.y, 0.82);
          }
        };
        const sSide = [], nSide = [], wEnd = [], eEnd = [];
        for (let i = 0; i <= nU; i++) {
          const u = -hl + (2 * hl) * (i / nU);
          sSide.push({ u, v: -hw });
          nSide.push({ u, v: hw });
        }
        for (let i = 0; i <= nV; i++) {
          const v = -hw + (2 * hw) * (i / nV);
          wEnd.push({ u: -hl, v });
          eEnd.push({ u: hl, v });
        }
        addEdgeStrip(sSide);
        addEdgeStrip(nSide.reverse());
        addEdgeStrip(wEnd);
        addEdgeStrip(eEnd.reverse());
      }

      if (patchPos.length > 0) {
        const pGeom = new THREE.BufferGeometry();
        pGeom.setAttribute('position', new THREE.Float32BufferAttribute(patchPos, 3));
        pGeom.setAttribute('color', new THREE.Float32BufferAttribute(patchCol, 3));
        pGeom.computeVertexNormals();
        const pMesh = new THREE.Mesh(pGeom, this.terrainMat);
        pMesh.receiveShadow = true;
        this.terrainCutPatchGroup.add(pMesh);
      }
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
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Alt') this._altHeld = true;
      });
      window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt') this._altHeld = false;
      });

      this.transform.addEventListener('dragging-changed', (e) => {
        this.orbit.enabled = !e.value;
        this.isTransforming = e.value;
        if (e.value) {
          this.api.pushUndo();
          const state = this.api.getState();
          const obj = this.transform.object;
          if (obj && obj.userData.itemKind === 'terrain') {
            const mod = (state.terrainMods || []).find(m => m.id === obj.userData.itemId);
            const siteTools = window.GROUNDWORK_SITE_TOOLS;
            const ew = mod ? siteTools.computeTerrainModEarthwork(mod) : null;
            const obb = mod ? siteTools.getTerrainModOBB(mod) : null;
            const padZ = mod ? (mod.mode === 'offset' ? (ew.avgOrigZ + (mod.deltaZ || 0)) : mod.targetZ) : 1975;
            this.transformOrig = mod ? {
              itemKind: 'terrain',
              itemId: mod.id,
              origGrpX: obj.position.x,
              origGrpPosY: obj.position.y,
              origGrpY: -obj.position.z,
              origCx: ew.cx,
              origCy: ew.cy,
              origPadZ: padZ,
              origW: obb.w,
              origD: obb.d,
              origRot: obb.rot,
              origPts: mod.pts.map(p => ({ x: p.x, y: p.y })),
              origTargetZ: mod.targetZ,
              origDeltaZ: mod.deltaZ || 0,
              mode: mod.mode
            } : null;
          } else if (obj === this.circEndProxy && this.activeCircLiftEnd) {
            const circ = (state.circulations || []).find(c => c.id === this.activeCircLiftEnd.circId);
            const prof = circ ? window.GROUNDWORK_SITE_TOOLS.computeCirculationProfile(circ, state.volumes, state.useGross) : null;
            this.transformOrig = (circ && prof) ? {
              itemKind: 'circ-end-lift',
              circId: circ.id,
              end: this.activeCircLiftEnd.end,
              origProxyY: obj.position.y,
              origZ: this.activeCircLiftEnd.end === 'start' ? prof.zStart : prof.zEnd,
              baseZ: this.activeCircLiftEnd.end === 'start' ? prof.baseStartZ : prof.baseEndZ,
              endPt: this.activeCircLiftEnd.end === 'start' ? prof.startPt : prof.endPt,
              autoTerrainZ: circ.autoTerrainZ
            } : null;
          } else if (obj && obj.userData.itemKind === 'circulation') {
            const circ = (state.circulations || []).find(c => c.id === obj.userData.itemId);
            this.transformOrig = circ ? {
              itemKind: 'circulation',
              itemId: circ.id,
              origX: circ.x,
              origY: circ.y,
              origPosY: obj.position.y,
              origZStart: circ.zStart,
              origZEnd: circ.zEnd
            } : null;
          } else {
            const primary = obj ? obj.userData.volId : null;
            const pVol = primary ? this.api.getVolume(primary) : null;
            const origins = {};
            for (const id of state.selectedIds) {
              const v = this.api.getVolume(id);
              if (v) origins[id] = { x: v.x, y: v.y, zBase: v.zBase };
            }
            this.transformOrig = pVol ? {
              itemKind: 'volume',
              primaryId: pVol.id,
              origX: pVol.x,
              origY: pVol.y,
              origZBase: pVol.zBase,
              origins
            } : null;
          }
        } else {
          this.transformOrig = null;
          this._clearSnapGuides();
          this.syncFromState();
          this.focusSelection();
        }
      });

      this.transform.addEventListener('objectChange', () => {
        if (!this.transform.object || !this.transformOrig) return;
        const grp = this.transform.object;
        const state = this.api.getState();
        const eng = window.GROUNDWORK_ENGINE;
        const siteTools = window.GROUNDWORK_SITE_TOOLS;

        if (this.transformOrig.itemKind === 'circ-end-lift') {
          const dy = grp.position.y - this.transformOrig.origProxyY;
          let newZ = this.transformOrig.origZ + dy;
          if (state.layers.snap !== false && !this._altHeld) {
            const tolZ = 0.45;
            let bestZ = null;
            let bestErr = tolZ;
            const tryTarget = (tz, xRef, yRef) => {
              const err = Math.abs(newZ - tz);
              if (err < bestErr) { bestErr = err; bestZ = { z: tz, x: xRef, y: yRef }; }
            };
            const ep = this.transformOrig.endPt;
            tryTarget(this.transformOrig.baseZ, ep.x, ep.y);
            for (const v of state.volumes) {
              const d = eng.getEffectiveDims(v, state.useGross);
              tryTarget(v.zBase, v.x, v.y);
              tryTarget(v.zBase + d.totalHeight, v.x, v.y);
            }
            for (const m of (state.terrainMods || [])) {
              const st = siteTools.getPolygonStats(m.pts);
              const pz = m.mode === 'offset' ? st.avgOrigZ + (m.deltaZ || 0) : m.targetZ;
              tryTarget(pz, st.cx, st.cy);
            }
            this._clearSnapGuides();
            if (bestZ) {
              newZ = Math.round(bestZ.z * 100) / 100;
              grp.position.y = newZ - this.zDatum;
              const mat = new THREE.LineBasicMaterial({ color: state.theme === 'dark' ? 0xe07b5f : 0xb85d43 });
              const pts = [
                this.toThree(ep.x, ep.y, newZ),
                this.toThree(bestZ.x === ep.x && bestZ.y === ep.y ? ep.x + 4 : bestZ.x, bestZ.x === ep.x && bestZ.y === ep.y ? ep.y : bestZ.y, newZ)
              ];
              this.snapGuideGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
            }
          } else {
            this._clearSnapGuides();
          }
          const lift = Math.round((newZ - this.transformOrig.baseZ) * 100) / 100;
          const patch = this.transformOrig.end === 'start'
            ? (this.transformOrig.autoTerrainZ ? { startLift: lift } : { startLift: lift, zStart: Math.round(newZ * 100) / 100 })
            : (this.transformOrig.autoTerrainZ ? { endLift: lift } : { endLift: lift, zEnd: Math.round(newZ * 100) / 100 });
          this.api.updateCirculation(this.transformOrig.circId, patch, { silentUndo: true, skip3DTransformSync: true });
          return;
        }

        if (this.transformOrig.itemKind === 'terrain') {
          let dx = grp.position.x - this.transformOrig.origGrpX;
          let dy = (-grp.position.z) - this.transformOrig.origGrpY;
          let dz = grp.position.y - this.transformOrig.origGrpPosY;
          const rawCx = this.transformOrig.origCx + dx;
          const rawCy = this.transformOrig.origCy + dy;
          let newPadZ = this.transformOrig.origPadZ + dz;

          if (state.layers.snap !== false && !this._altHeld) {
            const shiftedTmp = this.transformOrig.origPts.map(p => ({ x: p.x + dx, y: p.y + dy }));
            const avgTmp = siteTools.getPolygonStats(shiftedTmp).avgOrigZ;
            const snap = this._compute3DSnap({
              id: this.transformOrig.itemId,
              x: rawCx,
              y: rawCy,
              w: this.transformOrig.origW,
              d: this.transformOrig.origD,
              rot: this.transformOrig.origRot,
              zBase: newPadZ,
              groundRefZ: avgTmp
            }, new Set([this.transformOrig.itemId]), state, true);
            dx += snap.dxSnap;
            dy += snap.dySnap;
            newPadZ = snap.snappedZBase;
            dz = newPadZ - this.transformOrig.origPadZ;
            grp.position.set(
              this.transformOrig.origGrpX + dx,
              this.transformOrig.origGrpPosY + dz,
              -(this.transformOrig.origGrpY + dy)
            );
          } else {
            this._clearSnapGuides();
          }

          const pts = this.transformOrig.origPts.map(p => ({ x: p.x + dx, y: p.y + dy }));
          const patch = { pts };
          if (this.transformOrig.mode === 'offset') {
            const newAvgOrig = siteTools.getPolygonStats(pts).avgOrigZ;
            patch.deltaZ = Math.round((newPadZ - newAvgOrig) * 100) / 100;
          } else {
            patch.targetZ = Math.round((this.transformOrig.origTargetZ + dz) * 100) / 100;
          }
          this.api.updateTerrainMod(this.transformOrig.itemId, patch, { silentUndo: true, skip3DTransformSync: true });
          return;
        }

        if (this.transformOrig.itemKind === 'circulation') {
          const wp = this.fromThree(grp.position);
          let dx = wp.x - this.transformOrig.origX;
          let dy = wp.y - this.transformOrig.origY;
          const dz = grp.position.y - this.transformOrig.origPosY;
          const circ = (state.circulations || []).find(c => c.id === this.transformOrig.itemId);
          if (circ && state.layers.snap !== false && !this._altHeld) {
            const snap = this._compute3DSnap({
              id: circ.id,
              x: this.transformOrig.origX + dx,
              y: this.transformOrig.origY + dy,
              w: circ.length,
              d: circ.width,
              rot: circ.rot || 0,
              zBase: grp.position.y + this.zDatum
            }, new Set([circ.id]), state, false);
            dx += snap.dxSnap;
            dy += snap.dySnap;
            grp.position.x = this.transformOrig.origX + dx;
            grp.position.z = -(this.transformOrig.origY + dy);
          } else {
            this._clearSnapGuides();
          }
          const patch = { x: this.transformOrig.origX + dx, y: this.transformOrig.origY + dy };
          if (circ && !circ.autoTerrainZ) {
            patch.zStart = Math.round((this.transformOrig.origZStart + dz) * 100) / 100;
            patch.zEnd = Math.round((this.transformOrig.origZEnd + dz) * 100) / 100;
          }
          this.api.updateCirculation(this.transformOrig.itemId, patch, { silentUndo: true, skip3DTransformSync: true });
          return;
        }

        const vol = this.api.getVolume(this.transformOrig.primaryId);
        if (!vol) return;
        const dims = eng.getEffectiveDims(vol, state.useGross);
        const worldPos = this.fromThree(grp.position);
        let nx = worldPos.x;
        let ny = worldPos.y;
        let newZBase = worldPos.z - dims.totalHeight * 0.5;

        if (state.layers.snap !== false && !this._altHeld) {
          const dragIds = new Set(Object.keys(this.transformOrig.origins));
          const snap = this._compute3DSnap({
            id: vol.id,
            x: nx,
            y: ny,
            w: dims.w,
            d: dims.d,
            rot: vol.rot || 0,
            zBase: newZBase
          }, dragIds, state, true);
          nx += snap.dxSnap;
          ny += snap.dySnap;
          newZBase = snap.snappedZBase;
          grp.position.set(nx, newZBase + dims.totalHeight * 0.5 - this.zDatum, -ny);
        } else {
          this._clearSnapGuides();
        }

        const dx = nx - this.transformOrig.origX;
        const dy = ny - this.transformOrig.origY;
        const dz = newZBase - this.transformOrig.origZBase;

        const updates = [];
        for (const [id, orig] of Object.entries(this.transformOrig.origins)) {
          updates.push({
            id,
            x: orig.x + dx,
            y: orig.y + dy,
            zBase: Math.round((orig.zBase + dz) * 100) / 100
          });
        }
        this.api.updateVolumesBatch(updates, { silentUndo: true, skip3DTransformSync: true });
      });

      const dom = this.renderer.domElement;
      const boxEl = document.getElementById('marquee3dBox');

      // Capture-phase 3D Window (L->R) & Crossing (R->L) Box Selection
      dom.addEventListener('pointerdown', (e) => {
        const state = this.api.getState();
        if (
          e.button === 0 &&
          (this.boxSelectMode || e.shiftKey) &&
          !this.isTransforming &&
          !this.transform.axis &&
          state.tool === 'select'
        ) {
          this._boxDrag = {
            startX: e.clientX,
            startY: e.clientY,
            currX: e.clientX,
            currY: e.clientY,
            shiftKey: !!e.shiftKey,
            moved: false
          };
          this.pointerDownPos = { x: e.clientX, y: e.clientY, button: e.button };
          this.orbit.enabled = false;
        }
      }, { capture: true });

      dom.addEventListener('pointermove', (e) => {
        if (this._boxDrag) {
          const dist = Math.hypot(e.clientX - this._boxDrag.startX, e.clientY - this._boxDrag.startY);
          this._boxDrag.currX = e.clientX;
          this._boxDrag.currY = e.clientY;
          if (dist > 5) {
            this._boxDrag.moved = true;
            e.stopPropagation();
            if (boxEl) {
              const cr = this.container.getBoundingClientRect();
              const x1 = this._boxDrag.startX - cr.left;
              const y1 = this._boxDrag.startY - cr.top;
              const x2 = this._boxDrag.currX - cr.left;
              const y2 = this._boxDrag.currY - cr.top;
              const isWindow = x2 >= x1;
              boxEl.style.display = 'block';
              boxEl.style.left = Math.min(x1, x2) + 'px';
              boxEl.style.top = Math.min(y1, y2) + 'px';
              boxEl.style.width = Math.abs(x2 - x1) + 'px';
              boxEl.style.height = Math.abs(y2 - y1) + 'px';
              boxEl.className = 'marquee-3d-box ' + (isWindow ? 'window' : 'crossing');
              boxEl.dataset.mode = isWindow ? 'Window' : 'Crossing';
            }
          }
        }
      }, { capture: true });

      dom.addEventListener('pointerup', (e) => {
        if (!this._boxDrag) return;
        const drag = this._boxDrag;
        this._boxDrag = null;
        this.orbit.enabled = true;
        if (boxEl) boxEl.style.display = 'none';
        if (drag.moved) {
          e.stopPropagation();
          this.pointerDownPos = null;
          this._apply3DBoxSelect(drag);
        }
      }, { capture: true });

      dom.addEventListener('pointerdown', (e) => {
        this.pointerDownPos = { x: e.clientX, y: e.clientY, button: e.button };
        this._pendingOrbitFocus = (
          e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey &&
          !this.isTransforming && !this.transform.axis && !this._boxDrag &&
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

        // Raycast volumes, circulations, and terrain pads
        const rect = dom.getBoundingClientRect();
        this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointerNDC, this.camera);

        const meshes = [];
        for (const grp of this.volumeGroups.values()) {
          if (grp.userData.pickMeshes) meshes.push(...grp.userData.pickMeshes);
          else if (grp.userData.boxMesh) meshes.push(grp.userData.boxMesh);
        }
        if (this.circPickers.length) meshes.push(...this.circPickers);
        if (this.terrainModPickers.length) meshes.push(...this.terrainModPickers);

        const hits = this.raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
          const obj = hits[0].object;
          if (obj.userData.volId) {
            this.activeCircLiftEnd = null;
            const volId = obj.userData.volId;
            if (e.shiftKey) this.api.toggleSelect(volId);
            else this.api.selectVolume(volId, e.detail < 2);
            this.focusSelection({ fitDistance: e.detail >= 2 });
          } else if (obj.userData.itemKind === 'circ-end-lift') {
            this.activeCircLiftEnd = { circId: obj.userData.itemId, end: obj.userData.end };
            this.api.selectItem('circulation', obj.userData.itemId);
            this.syncFromState();
          } else if (obj.userData.itemKind === 'circulation') {
            this.activeCircLiftEnd = null;
            this.api.selectItem('circulation', obj.userData.itemId);
          } else if (obj.userData.itemKind === 'terrain') {
            this.activeCircLiftEnd = null;
            this.api.selectItem('terrain', obj.userData.itemId);
          }
        } else if (!e.shiftKey) {
          this.activeCircLiftEnd = null;
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
      this._syncTerrainMesh();

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

      // 3b. Rebuild Terrain Pads + Retaining Walls, and Parametric Ramps/Stairs
      const modTargets = this._rebuildTerrainModMeshes(state, isDark, opts);
      const circTargets = this._rebuildCirculationMeshes(state, isDark, opts);

      if (
        this.activeCircLiftEnd &&
        (!state.selectedItem || state.selectedItem.kind !== 'circulation' || state.selectedItem.id !== this.activeCircLiftEnd.circId)
      ) {
        this.activeCircLiftEnd = null;
      }

      // Attach TransformControls to primary selected volume, circulation (or endpoint lift pin), or terrain pad
      if (!this.isTransforming) {
        if (state.selectedIds.length > 0 && state.tool === 'select') {
          const targetGrp = this.volumeGroups.get(state.selectedIds[0]);
          if (targetGrp) {
            this.transform.showX = true; this.transform.showY = true; this.transform.showZ = true;
            if (this.transform.object !== targetGrp) this.transform.attach(targetGrp);
          } else {
            this.transform.detach();
          }
        } else if (state.selectedItem && state.selectedItem.kind === 'terrain' && modTargets.has(state.selectedItem.id)) {
          const tGrp = modTargets.get(state.selectedItem.id);
          if (!(opts.skip3DTransformSync && this.transform.object === tGrp)) {
            this.transform.showX = true; this.transform.showY = true; this.transform.showZ = true;
            if (this.transform.object !== tGrp) this.transform.attach(tGrp);
          }
        } else if (state.selectedItem && state.selectedItem.kind === 'circulation' && circTargets.has(state.selectedItem.id)) {
          if (this.activeCircLiftEnd && this.activeCircLiftEnd.circId === state.selectedItem.id) {
            const circ = (state.circulations || []).find(c => c.id === state.selectedItem.id);
            const prof = circ ? window.GROUNDWORK_SITE_TOOLS.computeCirculationProfile(circ, state.volumes, state.useGross) : null;
            if (prof) {
              const ep = this.activeCircLiftEnd.end === 'start' ? prof.startPt : prof.endPt;
              const ez = this.activeCircLiftEnd.end === 'start' ? prof.zStart : prof.zEnd;
              if (!(opts.skip3DTransformSync && this.transform.object === this.circEndProxy)) {
                this.circEndProxy.position.set(ep.x, ez - this.zDatum, -ep.y);
              }
              this.transform.showX = false; this.transform.showY = true; this.transform.showZ = false;
              if (this.transform.object !== this.circEndProxy) this.transform.attach(this.circEndProxy);
            }
          } else {
            const cGrp = circTargets.get(state.selectedItem.id);
            if (!(opts.skip3DTransformSync && this.transform.object === cGrp)) {
              this.transform.showX = true; this.transform.showY = true; this.transform.showZ = true;
              if (this.transform.object !== cGrp) this.transform.attach(cGrp);
            }
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

      // 4. Rebuild Cut & Fill Soil Meshes + Rainwater Overlay
      this._rebuildEarthworkMeshes(state);
      this._rebuildRainwaterMeshes(state, isDark);

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

    _clearSnapGuides() {
      if (!this.snapGuideGroup) return;
      while (this.snapGuideGroup.children.length) {
        const ch = this.snapGuideGroup.children.pop();
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) ch.material.dispose();
      }
    }

    _compute3DSnap(item, dragIds, state, snapZ) {
      const eng = window.GROUNDWORK_ENGINE;
      const siteTools = window.GROUNDWORK_SITE_TOOLS;
      const xyTol = 0.75;
      const zTol = 0.45;
      const isDark = state.theme === 'dark';

      const targets = [];
      for (const v of state.volumes) {
        if (!dragIds.has(v.id)) {
          const d = eng.getEffectiveDims(v, state.useGross);
          targets.push({ id: v.id, x: v.x, y: v.y, w: d.w, d: d.d, rot: v.rot || 0, zBase: v.zBase, zTop: v.zBase + d.totalHeight });
        }
      }
      for (const c of (state.circulations || [])) {
        if (!dragIds.has(c.id)) {
          const prof = siteTools.computeCirculationProfile(c, state.volumes, state.useGross);
          targets.push({ id: c.id, x: c.x, y: c.y, w: c.length, d: c.width, rot: c.rot || 0, zBase: prof.zStart, zTop: prof.zEnd });
        }
      }
      for (const m of (state.terrainMods || [])) {
        if (dragIds.has(m.id)) continue;
        if (m.pts && m.pts.length >= 3) {
          const obb = siteTools.getTerrainModOBB(m);
          const st = siteTools.getPolygonStats(m.pts);
          const padZ = m.mode === 'offset' ? st.avgOrigZ + (m.deltaZ || 0) : m.targetZ;
          targets.push({ id: m.id, x: obb.cx, y: obb.cy, w: obb.w, d: obb.d, rot: obb.rot, zBase: padZ, zTop: padZ });
        }
      }

      let bestU = null;
      let bestV = null;
      for (const B of targets) {
        const rotB = B.rot || 0;
        const cB = Math.cos(rotB), sB = Math.sin(rotB);
        const rx = (item.x - B.x) * cB + (item.y - B.y) * sB;
        const ry = -(item.x - B.x) * sB + (item.y - B.y) * cB;
        const rel = (item.rot || 0) - rotB;
        const ca = Math.abs(Math.cos(rel)), sa = Math.abs(Math.sin(rel));
        const hAx = (item.w * ca + item.d * sa) * 0.5;
        const hAy = (item.w * sa + item.d * ca) * 0.5;
        const hBx = B.w * 0.5, hBy = B.d * 0.5;
        if (Math.abs(rx) > hAx + hBx + 24 || Math.abs(ry) > hAy + hBy + 24) continue;

        const nearY = Math.abs(ry) <= hAy + hBy + xyTol;
        const nearX = Math.abs(rx) <= hAx + hBx + xyTol;
        const uCands = [0, -hBx + hAx, hBx - hAx];
        if (nearY) uCands.push(-(hBx + hAx), hBx + hAx);
        for (const uc of uCands) {
          const err = Math.abs(rx - uc);
          if (err < xyTol && (!bestU || err < bestU.err)) {
            bestU = { err, B, cB, sB, targetRx: uc, hBx, hBy, hAx, hAy };
          }
        }
        const vCands = [0, -hBy + hAy, hBy - hAy];
        if (nearX) vCands.push(-(hBy + hAy), hBy + hAy);
        for (const vc of vCands) {
          const err = Math.abs(ry - vc);
          if (err < xyTol && (!bestV || err < bestV.err)) {
            bestV = { err, B, cB, sB, targetRy: vc, hBx, hBy, hAx, hAy };
          }
        }
      }

      let snapX = item.x;
      let snapY = item.y;
      if (bestU && bestV) {
        const n1x = bestU.cB, n1y = bestU.sB;
        const rhs1 = bestU.B.x * n1x + bestU.B.y * n1y + bestU.targetRx;
        const n2x = -bestV.sB, n2y = bestV.cB;
        const rhs2 = bestV.B.x * n2x + bestV.B.y * n2y + bestV.targetRy;
        const det = n1x * n2y - n1y * n2x;
        if (Math.abs(det) > 0.05) {
          snapX = (rhs1 * n2y - n1y * rhs2) / det;
          snapY = (n1x * rhs2 - rhs1 * n2x) / det;
        }
      } else if (bestU) {
        const cur = (item.x - bestU.B.x) * bestU.cB + (item.y - bestU.B.y) * bestU.sB;
        const sh = bestU.targetRx - cur;
        snapX += sh * bestU.cB;
        snapY += sh * bestU.sB;
      } else if (bestV) {
        const cur = -(item.x - bestV.B.x) * bestV.sB + (item.y - bestV.B.y) * bestV.cB;
        const sh = bestV.targetRy - cur;
        snapX += sh * (-bestV.sB);
        snapY += sh * bestV.cB;
      }

      let snappedZBase = item.zBase;
      let bestZLine = null;
      if (snapZ) {
        let bestZErr = zTol;
        const gz = item.groundRefZ !== undefined ? item.groundRefZ : eng.getGroundZ(snapX, snapY);
        if (Math.abs(item.zBase - gz) < bestZErr) {
          bestZErr = Math.abs(item.zBase - gz);
          snappedZBase = Math.round(gz * 100) / 100;
          bestZLine = { x: snapX, y: snapY, z: snappedZBase };
        }
        for (const B of targets) {
          for (const tz of [B.zBase, B.zTop]) {
            const err = Math.abs(item.zBase - tz);
            if (err < bestZErr) {
              bestZErr = err;
              snappedZBase = Math.round(tz * 100) / 100;
              bestZLine = { x: B.x, y: B.y, z: snappedZBase };
            }
          }
        }
      }

      // Draw crisp 3D guide lines in snapGuideGroup
      this._clearSnapGuides();
      const guideCol = isDark ? 0xe07b5f : 0xb85d43;
      const mat = new THREE.LineBasicMaterial({ color: guideCol });
      const gy = snappedZBase - this.zDatum + 0.12;
      if (bestU) {
        const pts = [
          this.toThree(snapX - (-bestU.sB) * 14, snapY - bestU.cB * 14, snappedZBase + 0.15),
          this.toThree(snapX + (-bestU.sB) * 14, snapY + bestU.cB * 14, snappedZBase + 0.15)
        ];
        this.snapGuideGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      }
      if (bestV) {
        const pts = [
          this.toThree(snapX - bestV.cB * 14, snapY - bestV.sB * 14, snappedZBase + 0.15),
          this.toThree(snapX + bestV.cB * 14, snapY + bestV.sB * 14, snappedZBase + 0.15)
        ];
        this.snapGuideGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      }
      if (bestZLine) {
        const pts = [
          this.toThree(snapX, snapY, snappedZBase),
          this.toThree(bestZLine.x, bestZLine.y, snappedZBase),
          new THREE.Vector3(snapX, gy + 12, -snapY),
          new THREE.Vector3(snapX, gy - 4, -snapY)
        ];
        this.snapGuideGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.slice(0, 2)), mat));
      }

      return { dxSnap: snapX - item.x, dySnap: snapY - item.y, snappedZBase, hadSnap: !!(bestU || bestV || bestZLine) };
    }

    _apply3DBoxSelect(drag) {
      const cr = this.container.getBoundingClientRect();
      const x1 = drag.startX - cr.left;
      const y1 = drag.startY - cr.top;
      const x2 = drag.currX - cr.left;
      const y2 = drag.currY - cr.top;
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      const isWindow = x2 >= x1;
      if (maxX - minX < 3 && maxY - minY < 3) return;

      const state = this.api.getState();
      const eng = window.GROUNDWORK_ENGINE;
      const siteTools = window.GROUNDWORK_SITE_TOOLS;
      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
      ];
      const tmp = new THREE.Vector3();
      const hits = [];

      for (const vol of state.volumes) {
        const dims = eng.getEffectiveDims(vol, state.useGross);
        const roof = eng.getRoofSpec(vol);
        const totalH = dims.totalHeight + eng.getRoofApexRise(dims, roof);
        const hw = dims.w * 0.5, hd = dims.d * 0.5;
        const c = Math.cos(vol.rot || 0), s = Math.sin(vol.rot || 0);
        const baseCorners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
        const proj = [];
        for (const zLevel of [vol.zBase, vol.zBase + totalH]) {
          for (const [lu, lv] of baseCorners) {
            const wx = vol.x + lu * c - lv * s;
            const wy = vol.y + lu * s + lv * c;
            tmp.set(wx, zLevel - this.zDatum, -wy).project(this.camera);
            proj.push({
              sx: (tmp.x * 0.5 + 0.5) * cr.width,
              sy: (-tmp.y * 0.5 + 0.5) * cr.height,
              inFront: tmp.z >= -1 && tmp.z <= 1
            });
          }
        }
        if (isWindow) {
          const allIn = proj.every(p => p.inFront && p.sx >= minX && p.sx <= maxX && p.sy >= minY && p.sy <= maxY);
          if (allIn) hits.push(vol.id);
        } else {
          let cross = proj.some(p => p.inFront && p.sx >= minX && p.sx <= maxX && p.sy >= minY && p.sy <= maxY);
          if (!cross) {
            for (const [ia, ib] of edges) {
              const pa = proj[ia], pb = proj[ib];
              if ((pa.inFront || pb.inFront) && siteTools.rectIntersectsSegment(pa.sx, pa.sy, pb.sx, pb.sy, minX, maxX, minY, maxY)) {
                cross = true;
                break;
              }
            }
          }
          if (cross) hits.push(vol.id);
        }
      }

      if (hits.length > 0) {
        if (drag.shiftKey && !this.boxSelectMode) {
          this.api.setSelection([...new Set([...state.selectedIds, ...hits])]);
        } else {
          this.api.setSelection(hits);
        }
        this.focusSelection();
      } else if (!drag.shiftKey) {
        this.api.clearSelection();
      }
    }

    _rebuildTerrainModMeshes(state, isDark, opts = {}) {
      this.terrainModPickers = [];
      const targetMap = new Map();
      const mods = state.terrainMods || [];
      const seenIds = new Set();

      const siteTools = window.GROUNDWORK_SITE_TOOLS;
      const wallCol = isDark ? 0x6c665d : 0x7c7466;
      const wallEdgeCol = isDark ? 0xa49d91 : 0x3b3832;

      for (const mod of mods) {
        if (!mod.pts || mod.pts.length < 3) continue;
        seenIds.add(mod.id);
        const ew = siteTools.computeTerrainModEarthwork(mod);
        const isSel = !!(state.selectedItem && state.selectedItem.kind === 'terrain' && state.selectedItem.id === mod.id);
        const padZ = mod.mode === 'offset' ? (ew.avgOrigZ + (mod.deltaZ || 0)) : mod.targetZ;

        let grp = this.terrainModGroups.get(mod.id);
        if (!grp) {
          grp = new THREE.Group();
          grp.userData.itemKind = 'terrain';
          grp.userData.itemId = mod.id;
          this.terrainModGroup.add(grp);
          this.terrainModGroups.set(mod.id, grp);
        }

        while (grp.children.length) {
          const ch = grp.children.pop();
          ch.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
        }

        const isHeldByGizmo = !!(opts.skip3DTransformSync && this.transform.object === grp);
        if (!isHeldByGizmo) {
          grp.position.set(ew.cx, padZ - this.zDatum, -ew.cy);
        }
        const visualSub = new THREE.Group();
        if (isHeldByGizmo) {
          visualSub.position.set(
            ew.cx - grp.position.x,
            (padZ - this.zDatum) - grp.position.y,
            (-ew.cy) - grp.position.z
          );
        }
        grp.add(visualSub);

        // Horizontal graded surface cap relative to centroid (so Y transform moves cap cleanly)
        try {
          const shape = new THREE.Shape();
          mod.pts.forEach((p, idx) => {
            const lx = p.x - ew.cx;
            const ly = p.y - ew.cy;
            if (idx === 0) shape.moveTo(lx, ly);
            else shape.lineTo(lx, ly);
          });
          shape.closePath();
          const capGeom = new THREE.ShapeGeometry(shape);
          capGeom.rotateX(-Math.PI * 0.5);
          const capMat = new THREE.MeshStandardMaterial({
            color: isSel ? 0xb85d43 : (isDark ? 0x575249 : 0xcbc3b4),
            roughness: 0.9,
            transparent: true,
            opacity: isSel ? 0.42 : 0.25,
            side: THREE.DoubleSide,
            depthWrite: false,
            clippingPlanes: this.activeClipPlanes
          });
          const capMesh = new THREE.Mesh(capGeom, capMat);
          capMesh.position.y = 0.05;
          capMesh.userData.itemKind = 'terrain';
          capMesh.userData.itemId = mod.id;
          visualSub.add(capMesh);
          this.terrainModPickers.push(capMesh);
        } catch (_) {}

        // Single monolithic retaining wall ribbon with sharp mitered corners
        if (mod.retainingWalls !== false) {
          const wallData = siteTools.buildMonolithicRetainingWallData(mod);
          if (wallData && wallData.positions.length > 0) {
            const wallMat = new THREE.MeshStandardMaterial({
              color: isSel ? 0x9b5a46 : wallCol,
              roughness: 0.85,
              metalness: 0.04,
              side: THREE.DoubleSide,
              clippingPlanes: this.activeClipPlanes
            });
            const wallEdgeMat = new THREE.LineBasicMaterial({ color: isSel ? 0xf2eee6 : wallEdgeCol, clippingPlanes: this.activeClipPlanes });
            const wallGeom = new THREE.BufferGeometry();
            wallGeom.setAttribute('position', new THREE.Float32BufferAttribute(wallData.positions, 3));
            wallGeom.computeVertexNormals();
            const wallMesh = new THREE.Mesh(wallGeom, wallMat);
            wallMesh.castShadow = true;
            wallMesh.receiveShadow = true;
            wallMesh.userData = { itemKind: 'terrain', itemId: mod.id, part: 'retainingWall' };
            visualSub.add(wallMesh);
            this.terrainModPickers.push(wallMesh);
            visualSub.add(new THREE.LineSegments(new THREE.EdgesGeometry(wallGeom, 20), wallEdgeMat));
          }
        }

        targetMap.set(mod.id, grp);
      }

      for (const [id, grp] of this.terrainModGroups.entries()) {
        if (!seenIds.has(id)) {
          if (this.transform.object === grp) this.transform.detach();
          grp.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          this.terrainModGroup.remove(grp);
          this.terrainModGroups.delete(id);
        }
      }
      return targetMap;
    }

    _rebuildCirculationMeshes(state, isDark, opts = {}) {
      this.circPickers = [];
      const targetMap = new Map();
      const list = state.circulations || [];
      const seenIds = new Set();

      const eng = window.GROUNDWORK_ENGINE;
      const siteTools = window.GROUNDWORK_SITE_TOOLS;
      const endLiftPins = [];
      const bodyMeshes = [];

      for (const circ of list) {
        seenIds.add(circ.id);
        const prof = siteTools.computeCirculationProfile(circ, state.volumes, state.useGross);
        const isSel = !!(state.selectedItem && state.selectedItem.kind === 'circulation' && state.selectedItem.id === circ.id);
        const zMid = (prof.minZ + prof.maxZ) * 0.5;

        let grp = this.circGroups.get(circ.id);
        if (!grp) {
          grp = new THREE.Group();
          grp.userData.itemKind = 'circulation';
          grp.userData.itemId = circ.id;
          this.circulationGroup.add(grp);
          this.circGroups.set(circ.id, grp);
        }

        while (grp.children.length) {
          const ch = grp.children.pop();
          ch.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
        }

        const isHeldByGizmo = !!(opts.skip3DTransformSync && this.transform.object === grp);
        if (!isHeldByGizmo) {
          grp.position.set(circ.x, zMid - this.zDatum, -circ.y);
          grp.rotation.y = circ.rot || 0;
        }
        const visualSub = new THREE.Group();
        if (isHeldByGizmo) {
          visualSub.position.set(0, (zMid - this.zDatum) - grp.position.y, 0);
        }
        grp.add(visualSub);

        const slabCol = circ.kind === 'stair' ? (isDark ? 0x6f8796 : 0xb8c5cf) : (isDark ? 0x8f7954 : 0xd4c2a1);
        const mat = new THREE.MeshStandardMaterial({
          color: slabCol,
          roughness: 0.78,
          metalness: 0.05,
          transparent: true,
          opacity: isSel ? 0.95 : 0.88,
          side: THREE.DoubleSide,
          clippingPlanes: this.activeClipPlanes
        });
        const edgeMat = new THREE.LineBasicMaterial({
          color: isSel ? (isDark ? 0xf2eee6 : 0x11100e) : (isDark ? 0xaca496 : 0x4a453c),
          clippingPlanes: this.activeClipPlanes
        });

        const thick = circ.slabThickness || 0.25;
        const hw = circ.width * 0.5;

        if (circ.kind === 'stair' && prof.steps && prof.steps.length) {
          for (const st of prof.steps) {
            const len = Math.max(0.08, st.u1 - st.u0);
            const cu = (st.u0 + st.u1) * 0.5;
            const zBot = Math.min(st.zTop - thick, st.isLanding ? st.zTop - thick : Math.min(st.zStartStep || st.zTop, st.zEndStep || st.zTop) - thick);
            const hStep = Math.max(thick, st.zTop - zBot);
            const sg = new THREE.BoxGeometry(len + 0.01, hStep, circ.width);
            const sm = new THREE.Mesh(sg, mat);
            sm.castShadow = true;
            sm.receiveShadow = true;
            sm.position.set(cu, (zBot + hStep * 0.5) - zMid, 0);
            sm.userData.itemKind = 'circulation';
            sm.userData.itemId = circ.id;
            visualSub.add(sm);
            bodyMeshes.push(sm);
            const se = new THREE.LineSegments(new THREE.EdgesGeometry(sg, 22), edgeMat);
            se.position.copy(sm.position);
            visualSub.add(se);
          }
        } else if (prof.segments) {
          const pos = [];
          const pushQuad = (a, b, cPt, dPt) => {
            pos.push(a[0], a[1], a[2], b[0], b[1], b[2], cPt[0], cPt[1], cPt[2]);
            pos.push(a[0], a[1], a[2], cPt[0], cPt[1], cPt[2], dPt[0], dPt[1], dPt[2]);
          };
          for (const seg of prof.segments) {
            const u0 = seg.u0, u1 = seg.u1;
            const y0 = seg.z0 - zMid, y1 = seg.z1 - zMid;
            const yb0 = y0 - thick, yb1 = y1 - thick;
            pushQuad([u0, y0, hw], [u1, y1, hw], [u1, y1, -hw], [u0, y0, -hw]); // top
            pushQuad([u0, yb0, -hw], [u1, yb1, -hw], [u1, yb1, hw], [u0, yb0, hw]); // bottom
            pushQuad([u0, yb0, hw], [u1, yb1, hw], [u1, y1, hw], [u0, y0, hw]); // south cheek
            pushQuad([u1, yb1, -hw], [u0, yb0, -hw], [u0, y0, -hw], [u1, y1, -hw]); // north cheek
            pushQuad([u0, yb0, -hw], [u0, yb0, hw], [u0, y0, hw], [u0, y0, -hw]);
            pushQuad([u1, yb1, hw], [u1, yb1, -hw], [u1, y1, -hw], [u1, y1, hw]);
          }
          const rg = new THREE.BufferGeometry();
          rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          rg.computeVertexNormals();
          const rm = new THREE.Mesh(rg, mat);
          rm.castShadow = true;
          rm.receiveShadow = true;
          rm.userData.itemKind = 'circulation';
          rm.userData.itemId = circ.id;
          visualSub.add(rm);
          bodyMeshes.push(rm);
          visualSub.add(new THREE.LineSegments(new THREE.EdgesGeometry(rg, 18), edgeMat));
        }

        // Handrails (1.0m above surface)
        if (circ.railing !== false) {
          const ptsL = [], ptsR = [];
          const nR = 16;
          for (let i = 0; i <= nR; i++) {
            const u = -circ.length * 0.5 + circ.length * (i / nR);
            const yr = prof.surfaceZAtU(u) - zMid + 1.0;
            ptsL.push(new THREE.Vector3(u, yr, -hw + 0.06));
            ptsR.push(new THREE.Vector3(u, yr, hw - 0.06));
          }
          visualSub.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ptsL), edgeMat));
          visualSub.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ptsR), edgeMat));
          for (const uPost of [-circ.length * 0.5, 0, circ.length * 0.5]) {
            const yb = prof.surfaceZAtU(uPost) - zMid;
            for (const zSide of [-hw + 0.06, hw - 0.06]) {
              const pg = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(uPost, yb, zSide),
                new THREE.Vector3(uPost, yb + 1.0, zSide)
              ]);
              visualSub.add(new THREE.Line(pg, edgeMat));
            }
          }
        }

        // Side cheek retaining/support skirts sampling live pad grade at each station
        if (circ.sideWalls !== false) {
          const underMat = new THREE.MeshStandardMaterial({
            color: isDark ? 0x575249 : 0x9c9587,
            roughness: 0.9,
            side: THREE.DoubleSide,
            clippingPlanes: this.activeClipPlanes
          });
          const cRot = Math.cos(circ.rot || 0);
          const sRot = Math.sin(circ.rot || 0);
          const nStep = 12;
          for (const vSide of [-hw + 0.06, hw - 0.06]) {
            const swPos = [];
            for (let i = 0; i < nStep; i++) {
              const u0 = -circ.length * 0.5 + circ.length * (i / nStep);
              const u1 = -circ.length * 0.5 + circ.length * ((i + 1) / nStep);
              const wx0 = circ.x + u0 * cRot - (-vSide) * sRot;
              const wy0 = circ.y + u0 * sRot + (-vSide) * cRot;
              const wx1 = circ.x + u1 * cRot - (-vSide) * sRot;
              const wy1 = circ.y + u1 * sRot + (-vSide) * cRot;
              const gz0 = eng.getPadGroundZ(wx0, wy0);
              const gz1 = eng.getPadGroundZ(wx1, wy1);
              const soff0 = prof.soffitZAtU ? prof.soffitZAtU(u0) : prof.surfaceZAtU(u0) - thick;
              const soff1 = prof.soffitZAtU ? prof.soffitZAtU(u1) : prof.surfaceZAtU(u1) - thick;
              const top0 = Math.max(prof.surfaceZAtU(u0) + 0.04, gz0 > soff0 ? gz0 + 0.04 : soff0) - zMid;
              const top1 = Math.max(prof.surfaceZAtU(u1) + 0.04, gz1 > soff1 ? gz1 + 0.04 : soff1) - zMid;
              const bot0 = Math.min(gz0, soff0) - 0.25 - zMid;
              const bot1 = Math.min(gz1, soff1) - 0.25 - zMid;
              swPos.push(u0, bot0, vSide, u1, bot1, vSide, u1, top1, vSide, u0, bot0, vSide, u1, top1, vSide, u0, top0, vSide);
            }
            const sg = new THREE.BufferGeometry();
            sg.setAttribute('position', new THREE.Float32BufferAttribute(swPos, 3));
            sg.computeVertexNormals();
            visualSub.add(new THREE.Mesh(sg, underMat));
          }
        }

        // Start / End Lift pins when selected in 3D
        if (isSel) {
          for (const endInfo of [
            { key: 'start', u: -circ.length * 0.5, zVal: prof.zStart },
            { key: 'end', u: circ.length * 0.5, zVal: prof.zEnd }
          ]) {
            const isEndActive = !!(this.activeCircLiftEnd && this.activeCircLiftEnd.circId === circ.id && this.activeCircLiftEnd.end === endInfo.key);
            const pinMat = new THREE.MeshStandardMaterial({
              color: isEndActive ? 0xd96b43 : (endInfo.key === 'start' ? 0x4f7d99 : 0xc98a3b),
              roughness: 0.4,
              metalness: 0.1
            });
            const pinGeom = new THREE.ConeGeometry(0.28, 0.72, 12);
            const pinMesh = new THREE.Mesh(pinGeom, pinMat);
            const surfY = endInfo.zVal - zMid;
            pinMesh.position.set(endInfo.u, surfY + 1.35, 0);
            pinMesh.userData = { itemKind: 'circ-end-lift', itemId: circ.id, end: endInfo.key };
            visualSub.add(pinMesh);
            endLiftPins.push(pinMesh);

            const stemG = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(endInfo.u, surfY, 0),
              new THREE.Vector3(endInfo.u, surfY + 1.15, 0)
            ]);
            visualSub.add(new THREE.Line(stemG, new THREE.LineBasicMaterial({ color: isEndActive ? 0xd96b43 : 0xb85d43 })));
          }
        }

        targetMap.set(circ.id, grp);
      }

      this.circPickers.push(...endLiftPins, ...bodyMeshes);

      for (const [id, grp] of this.circGroups.entries()) {
        if (!seenIds.has(id)) {
          if (this.transform.object === grp) this.transform.detach();
          grp.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          this.circulationGroup.remove(grp);
          this.circGroups.delete(id);
        }
      }
      return targetMap;
    }

    _rebuildRainwaterMeshes(state, isDark) {
      while (this.rainGroup.children.length) {
        const ch = this.rainGroup.children.pop();
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) ch.material.dispose();
      }
      if (!state.layers.rainwater) return;
      const rain = this.api.getRainwaterAnalysis ? this.api.getRainwaterAnalysis() : null;
      if (!rain) return;

      const streamCol = isDark ? 0x69b3e7 : 0x2c76a8;
      const streamMat = new THREE.LineBasicMaterial({ color: streamCol, transparent: true, opacity: 0.85, clippingPlanes: this.activeClipPlanes });
      for (const sl of rain.streamlines) {
        if (!sl.pts || sl.pts.length < 2) continue;
        const pts3 = sl.pts.map(p => this.toThree(p.x, p.y, p.z + 0.25));
        this.rainGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts3), streamMat));
      }

      const ringMat = new THREE.MeshBasicMaterial({ color: isDark ? 0x80caff : 0x1b5f8c, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: this.activeClipPlanes });
      for (const c of rain.collections) {
        const rad = Math.max(1.8, Math.min(4.8, Math.sqrt(c.catchmentM2) * 0.14));
        const cg = new THREE.CircleGeometry(rad, 24);
        cg.rotateX(-Math.PI * 0.5);
        const cm = new THREE.Mesh(cg, ringMat);
        cm.position.set(c.x, c.z - this.zDatum + 0.3, -c.y);
        this.rainGroup.add(cm);
      }
    }

    _esc(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  window.GroundworkView3D = View3D;
})();
