/* Geometric, Terrain, Earthwork Cut/Fill, and Clipping-Plane Section Engine */
(function () {
  let _activeTerrainMods = [];
  let _activeCircCutouts = [];
  let _padGradedZ = null;
  let _gradedZ = null;
  let _terrainVersion = 0;

  function getSite() {
    return window.GROUNDWORK_SITE;
  }

  function pointInPolygon(x, y, poly) {
    if (!poly || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const pi = poly[i];
      const pj = poly[j];
      const xi = Array.isArray(pi) ? pi[0] : pi.x;
      const yi = Array.isArray(pi) ? pi[1] : pi.y;
      const xj = Array.isArray(pj) ? pj[0] : pj.x;
      const yj = Array.isArray(pj) ? pj[1] : pj.y;
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function distPointToPolygonEdge(x, y, poly) {
    if (!poly || poly.length < 2) return Infinity;
    let best = Infinity;
    const p = { x, y };
    for (let i = 0; i < poly.length; i++) {
      const pa = poly[i];
      const pb = poly[(i + 1) % poly.length];
      const a = { x: Array.isArray(pa) ? pa[0] : pa.x, y: Array.isArray(pa) ? pa[1] : pa.y };
      const b = { x: Array.isArray(pb) ? pb[0] : pb.x, y: Array.isArray(pb) ? pb[1] : pb.y };
      const d = distPointToSegment(p, a, b);
      if (d < best) best = d;
    }
    return best;
  }

  function sampleHeightfieldArray(zArr, hf, x, y) {
    const fx = (x - hf.minX) / hf.cellSize;
    const fy = (y - hf.minY) / hf.cellSize;
    const ix = Math.max(0, Math.min(hf.nx - 2, Math.floor(fx)));
    const iy = Math.max(0, Math.min(hf.ny - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - ix));
    const ty = Math.max(0, Math.min(1, fy - iy));
    const row0 = iy * hf.nx;
    const row1 = (iy + 1) * hf.nx;
    const z00 = zArr[row0 + ix];
    const z10 = zArr[row0 + ix + 1];
    const z01 = zArr[row1 + ix];
    const z11 = zArr[row1 + ix + 1];
    return (z00 * (1 - tx) + z10 * tx) * (1 - ty) + (z01 * (1 - tx) + z11 * tx) * ty;
  }

  function _ensureModBBox(mod) {
    if (mod._bbox) return mod._bbox;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pt of (mod.pts || [])) {
      const px = Array.isArray(pt) ? pt[0] : pt.x;
      const py = Array.isArray(pt) ? pt[1] : pt.y;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const pad = Math.max(0, Number(mod.batterSlope) || 0) + 0.5;
    mod._bbox = { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
    return mod._bbox;
  }

  function _evalTerrainModsAt(x, y, baseZ) {
    let z = baseZ;
    for (const mod of _activeTerrainMods) {
      if (!mod || !mod.pts || mod.pts.length < 3) continue;
      const bb = _ensureModBBox(mod);
      if (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY) continue;
      const targetVal = mod.mode === 'offset' ? (z + (Number(mod.deltaZ) || 0)) : Number(mod.targetZ);
      if (!Number.isFinite(targetVal)) continue;
      if (pointInPolygon(x, y, mod.pts)) {
        z = targetVal;
      } else {
        const batter = Math.max(0, Number(mod.batterSlope) || 0);
        if (batter > 0.05) {
          const d = distPointToPolygonEdge(x, y, mod.pts);
          if (d < batter) {
            const t = d / batter;
            z = targetVal * (1 - t) + z * t;
          }
        }
      }
    }
    return z;
  }

  function getOriginalGroundZ(x, y) {
    const site = getSite();
    if (!site || !site.heightfield) return 1975.0;
    return sampleHeightfieldArray(site.heightfield.z, site.heightfield, x, y);
  }

  function getPadGroundZ(x, y) {
    const site = getSite();
    if (!site || !site.heightfield) return 1975.0;
    const hf = site.heightfield;
    const origZ = sampleHeightfieldArray(hf.z, hf, x, y);
    if (_activeTerrainMods.length === 0) return origZ;
    return _evalTerrainModsAt(x, y, origZ);
  }

  function getGroundZ(x, y) {
    let z = getPadGroundZ(x, y);
    if (_activeCircCutouts.length === 0) return z;
    for (const c of _activeCircCutouts) {
      const bb = c.bbox;
      if (bb && (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY)) continue;
      const dx = x - c.x;
      const dy = y - c.y;
      const u = dx * c.cos + dy * c.sin;
      const v = -dx * c.sin + dy * c.cos;
      if (Math.abs(u) <= c.halfL && Math.abs(v) <= c.halfW) {
        const sz = c.soffitZAtU(u);
        if (Number.isFinite(sz) && sz < z) z = sz;
      }
    }
    return z;
  }

  function _applyCutoutsToGradedZ() {
    const site = getSite();
    if (!site || !site.heightfield) {
      _gradedZ = null;
      return;
    }
    const hf = site.heightfield;
    if (_activeTerrainMods.length === 0 && _activeCircCutouts.length === 0) {
      _gradedZ = null;
      return;
    }
    if (!_gradedZ || _gradedZ.length !== hf.z.length) {
      _gradedZ = new Float32Array(hf.z.length);
    }
    _gradedZ.set(_padGradedZ && _activeTerrainMods.length > 0 ? _padGradedZ : hf.z);

    for (const c of _activeCircCutouts) {
      const bb = c.bbox;
      if (!bb) continue;
      const ix0 = Math.max(0, Math.floor((bb.minX - hf.minX) / hf.cellSize) - 1);
      const ix1 = Math.min(hf.nx - 1, Math.ceil((bb.maxX - hf.minX) / hf.cellSize) + 1);
      const iy0 = Math.max(0, Math.floor((bb.minY - hf.minY) / hf.cellSize) - 1);
      const iy1 = Math.min(hf.ny - 1, Math.ceil((bb.maxY - hf.minY) / hf.cellSize) + 1);
      for (let iy = iy0; iy <= iy1; iy++) {
        const wy = hf.minY + iy * hf.cellSize;
        const row = iy * hf.nx;
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = hf.minX + ix * hf.cellSize;
          const dx = wx - c.x;
          const dy = wy - c.y;
          const u = dx * c.cos + dy * c.sin;
          const v = -dx * c.sin + dy * c.cos;
          if (Math.abs(u) <= c.halfL && Math.abs(v) <= c.halfW) {
            const sz = c.soffitZAtU(u);
            if (Number.isFinite(sz) && sz < _gradedZ[row + ix]) {
              _gradedZ[row + ix] = sz;
            }
          }
        }
      }
    }
  }

  function setTerrainMods(mods) {
    _activeTerrainMods = Array.isArray(mods) ? mods : [];
    for (const m of _activeTerrainMods) {
      if (m) delete m._bbox;
    }
    _terrainVersion++;
    for (const k of Object.keys(_contourCache)) {
      delete _contourCache[k];
    }

    const site = getSite();
    if (!site || !site.heightfield) {
      _padGradedZ = null;
      _gradedZ = null;
      return;
    }
    const hf = site.heightfield;
    if (_activeTerrainMods.length === 0) {
      _padGradedZ = null;
      _applyCutoutsToGradedZ();
      return;
    }
    if (!_padGradedZ || _padGradedZ.length !== hf.z.length) {
      _padGradedZ = new Float32Array(hf.z.length);
    }
    _padGradedZ.set(hf.z);

    for (const mod of _activeTerrainMods) {
      if (!mod || !mod.pts || mod.pts.length < 3) continue;
      const bb = _ensureModBBox(mod);
      const ix0 = Math.max(0, Math.floor((bb.minX - hf.minX) / hf.cellSize) - 1);
      const ix1 = Math.min(hf.nx - 1, Math.ceil((bb.maxX - hf.minX) / hf.cellSize) + 1);
      const iy0 = Math.max(0, Math.floor((bb.minY - hf.minY) / hf.cellSize) - 1);
      const iy1 = Math.min(hf.ny - 1, Math.ceil((bb.maxY - hf.minY) / hf.cellSize) + 1);
      for (let iy = iy0; iy <= iy1; iy++) {
        const wy = hf.minY + iy * hf.cellSize;
        const row = iy * hf.nx;
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = hf.minX + ix * hf.cellSize;
          const curZ = _padGradedZ[row + ix];
          const targetVal = mod.mode === 'offset' ? (curZ + (Number(mod.deltaZ) || 0)) : Number(mod.targetZ);
          if (!Number.isFinite(targetVal)) continue;
          if (pointInPolygon(wx, wy, mod.pts)) {
            _padGradedZ[row + ix] = targetVal;
          } else {
            const batter = Math.max(0, Number(mod.batterSlope) || 0);
            if (batter > 0.05) {
              const d = distPointToPolygonEdge(wx, wy, mod.pts);
              if (d < batter) {
                const t = d / batter;
                _padGradedZ[row + ix] = targetVal * (1 - t) + curZ * t;
              }
            }
          }
        }
      }
    }
    _applyCutoutsToGradedZ();
  }

  function setCircCutouts(cutouts) {
    _activeCircCutouts = Array.isArray(cutouts) ? cutouts : [];
    _terrainVersion++;
    for (const k of Object.keys(_contourCache)) {
      delete _contourCache[k];
    }
    _applyCutoutsToGradedZ();
  }

  function getTerrainVersion() {
    return _terrainVersion;
  }

  function getPadHeightfieldZ() {
    const site = getSite();
    if (_padGradedZ && _activeTerrainMods.length > 0) return _padGradedZ;
    return site && site.heightfield ? site.heightfield.z : null;
  }

  function getActiveCircCutouts() {
    return _activeCircCutouts;
  }

  function getGradedHeightfieldZ() {
    const site = getSite();
    return _gradedZ || (site && site.heightfield ? site.heightfield.z : null);
  }

  function getEffectiveDims(vol, useGross) {
    const mult = (useGross && vol.ref !== 'D1' && vol.ref !== 'D10')
      ? window.GROUNDWORK_PROGRAM.GROSS_MULTIPLIER
      : 1.0;
    const lin = Math.sqrt(mult);
    const w = vol.w * lin;
    const d = vol.d * lin;
    const totalArea = vol.area * mult;
    const footprintArea = w * d;
    const floors = Math.max(1, Math.round(vol.floors || 1));
    const floorHeight = Math.max(1.0, Number(vol.floorHeight) || 3.0);
    const totalHeight = floors * floorHeight;
    return { w, d, totalArea, footprintArea, floors, floorHeight, totalHeight, grossFactor: mult };
  }

  function getFootprintCorners(vol, useGross) {
    const dims = getEffectiveDims(vol, useGross);
    const hw = dims.w * 0.5;
    const hd = dims.d * 0.5;
    const c = Math.cos(vol.rot || 0);
    const s = Math.sin(vol.rot || 0);
    const local = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd]
    ];
    return local.map(([lx, ly]) => ({
      x: vol.x + lx * c - ly * s,
      y: vol.y + lx * s + ly * c
    }));
  }

  function pointInFootprint(px, py, vol, useGross) {
    const dims = getEffectiveDims(vol, useGross);
    const dx = px - vol.x;
    const dy = py - vol.y;
    const c = Math.cos(vol.rot || 0);
    const s = Math.sin(vol.rot || 0);
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    return Math.abs(lx) <= dims.w * 0.5 && Math.abs(ly) <= dims.d * 0.5;
  }

  function minEdgeDistanceRects(volA, volB, useGross) {
    const ca = getFootprintCorners(volA, useGross);
    const cb = getFootprintCorners(volB, useGross);
    // Separating axis distance / point-to-segment minimum distance
    if (polygonsOverlap(ca, cb)) return 0;
    let minD = Infinity;
    for (const p of ca) {
      for (let i = 0; i < cb.length; i++) {
        minD = Math.min(minD, distPointToSegment(p, cb[i], cb[(i + 1) % cb.length]));
      }
    }
    for (const p of cb) {
      for (let i = 0; i < ca.length; i++) {
        minD = Math.min(minD, distPointToSegment(p, ca[i], ca[(i + 1) % ca.length]));
      }
    }
    return minD;
  }

  function distPointToSegment(p, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const lenSq = vx * vx + vy * vy;
    if (lenSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  }

  function polygonsOverlap(polyA, polyB) {
    const polys = [polyA, polyB];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const nx = -(b.y - a.y);
        const ny = b.x - a.x;
        let minA = Infinity, maxA = -Infinity;
        for (const p of polyA) {
          const proj = p.x * nx + p.y * ny;
          if (proj < minA) minA = proj;
          if (proj > maxA) maxA = proj;
        }
        let minB = Infinity, maxB = -Infinity;
        for (const p of polyB) {
          const proj = p.x * nx + p.y * ny;
          if (proj < minB) minB = proj;
          if (proj > maxB) maxB = proj;
        }
        if (maxA < minB || maxB < minA) return false;
      }
    }
    return true;
  }

  function computeEarthwork(vol, useGross, maxSamples = 20) {
    const dims = getEffectiveDims(vol, useGross);
    const w = dims.w;
    const d = dims.d;
    const nx = Math.max(6, Math.min(maxSamples, Math.ceil(w / 0.55)));
    const ny = Math.max(6, Math.min(maxSamples, Math.ceil(d / 0.55)));
    const dx = w / nx;
    const dy = d / ny;
    const dA = dx * dy;
    const c = Math.cos(vol.rot || 0);
    const s = Math.sin(vol.rot || 0);

    // Sample corners (nx+1) x (ny+1) for watertight Cut/Fill 3D prism generation
    const stride = nx + 1;
    const cornerX = new Float64Array((nx + 1) * (ny + 1));
    const cornerY = new Float64Array((nx + 1) * (ny + 1));
    const cornerGZ = new Float64Array((nx + 1) * (ny + 1));

    let minGZ = Infinity;
    let maxGZ = -Infinity;
    let sumGZ = 0;
    let cntGZ = 0;

    for (let iy = 0; iy <= ny; iy++) {
      const ly = -d * 0.5 + iy * dy;
      for (let ix = 0; ix <= nx; ix++) {
        const lx = -w * 0.5 + ix * dx;
        const wx = vol.x + lx * c - ly * s;
        const wy = vol.y + lx * s + ly * c;
        const gz = getGroundZ(wx, wy);
        const idx = iy * stride + ix;
        cornerX[idx] = wx;
        cornerY[idx] = wy;
        cornerGZ[idx] = gz;
        if (gz < minGZ) minGZ = gz;
        if (gz > maxGZ) maxGZ = gz;
        sumGZ += gz;
        cntGZ++;
      }
    }

    let cutVol = 0;
    let fillVol = 0;
    let maxCutDepth = 0;
    let maxFillHeight = 0;

    for (let iy = 0; iy < ny; iy++) {
      const ly = -d * 0.5 + (iy + 0.5) * dy;
      for (let ix = 0; ix < nx; ix++) {
        const lx = -w * 0.5 + (ix + 0.5) * dx;
        const wx = vol.x + lx * c - ly * s;
        const wy = vol.y + lx * s + ly * c;
        const gz = getGroundZ(wx, wy);
        const diff = gz - vol.zBase;
        if (diff > 0) {
          cutVol += diff * dA;
          if (diff > maxCutDepth) maxCutDepth = diff;
        } else if (diff < 0) {
          const fh = -diff;
          fillVol += fh * dA;
          if (fh > maxFillHeight) maxFillHeight = fh;
        }
      }
    }

    return {
      cutVol,
      fillVol,
      netVol: cutVol - fillVol,
      maxCutDepth,
      maxFillHeight,
      minGZ,
      maxGZ,
      avgGZ: cntGZ ? sumGZ / cntGZ : vol.zBase,
      nx,
      ny,
      w,
      d,
      zBase: vol.zBase,
      cornerX,
      cornerY,
      cornerGZ
    };
  }

  /* Section plane frame:
     effectiveAngle = angleDeg + (flipped ? 180 : 0)
     t = (cos a, sin a) -> left-to-right along section line
     n = (sin a, -cos a) -> toward viewer / clipped side
     viewDir = -n = (-sin a, cos a) -> into kept section */
  function getPlaneBasis(plane) {
    const deg = (plane.angleDeg || 0) + (plane.flipped ? 180 : 0);
    const rad = deg * Math.PI / 180;
    const tx = Math.cos(rad);
    const ty = Math.sin(rad);
    const nx = ty;
    const ny = -tx;
    return {
      cx: plane.cx || 0,
      cy: plane.cy || 0,
      tx, ty,
      nx, ny,
      vx: -nx, vy: -ny,
      rad
    };
  }

  function worldToPlane(x, y, basis) {
    const dx = x - basis.cx;
    const dy = y - basis.cy;
    const s = dx * basis.tx + dy * basis.ty;
    const depth = dx * basis.vx + dy * basis.vy; // > 0 means kept side behind cut
    return { s, depth };
  }

  function planeToWorld(s, depth, basis) {
    return {
      x: basis.cx + s * basis.tx + depth * basis.vx,
      y: basis.cy + s * basis.ty + depth * basis.vy
    };
  }

  function sliceTerrainAlongPlane(plane, halfLen = 110, step = 0.25) {
    const basis = getPlaneBasis(plane);
    const pts = [];
    for (let s = -halfLen; s <= halfLen + 1e-6; s += step) {
      const wx = basis.cx + s * basis.tx;
      const wy = basis.cy + s * basis.ty;
      pts.push({ s, x: wx, y: wy, z: getGroundZ(wx, wy) });
    }
    return { basis, pts };
  }

  function getRoofSpec(vol) {
    const validTypes = ['flat', 'skillion', 'gable', 'hip'];
    const rawType = vol && vol.roofType ? String(vol.roofType).toLowerCase() : 'flat';
    const type = validTypes.includes(rawType) ? rawType : 'flat';
    const rawAng = vol && Number.isFinite(Number(vol.roofAngle)) ? Number(vol.roofAngle) : 22;
    const angle = Math.max(5, Math.min(55, rawAng));
    const rawDir = vol && Number.isFinite(Number(vol.roofDir)) ? Number(vol.roofDir) : 0;
    const dir = ((Math.round(rawDir / 90) * 90) % 360 + 360) % 360;
    const rawOv = vol && Number.isFinite(Number(vol.roofOverhang)) ? Number(vol.roofOverhang) : 0;
    const overhang = Math.max(0, Math.min(2.5, rawOv));
    return { type, angle, dir, overhang };
  }

  function getRoofRiseAtLocal(lx, ly, w, d, roof) {
    if (!roof || roof.type === 'flat') return 0;
    const hw = w * 0.5;
    const hd = d * 0.5;
    const t = Math.tan(roof.angle * Math.PI / 180);
    if (roof.type === 'skillion') {
      if (roof.dir === 0) return (hd - ly) * t;
      if (roof.dir === 180) return (ly + hd) * t;
      if (roof.dir === 90) return (hw - lx) * t;
      return (lx + hw) * t; // 270
    }
    if (roof.type === 'gable') {
      if (roof.dir === 0 || roof.dir === 180) return (hd - Math.abs(ly)) * t;
      return (hw - Math.abs(lx)) * t;
    }
    // hip
    return Math.min(hw - Math.abs(lx), hd - Math.abs(ly)) * t;
  }

  function getRoofApexRise(dims, roof) {
    if (!roof || roof.type === 'flat') return 0;
    const t = Math.tan(roof.angle * Math.PI / 180);
    if (roof.type === 'skillion') {
      return ((roof.dir === 0 || roof.dir === 180) ? dims.d : dims.w) * t;
    }
    if (roof.type === 'gable') {
      return ((roof.dir === 0 || roof.dir === 180) ? dims.d * 0.5 : dims.w * 0.5) * t;
    }
    return Math.min(dims.w, dims.d) * 0.5 * t;
  }

  function intersectExpandedRectWithPlane(vol, wExt, dExt, basis) {
    const hw = wExt * 0.5;
    const hd = dExt * 0.5;
    const c = Math.cos(vol.rot || 0);
    const s = Math.sin(vol.rot || 0);
    const local = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const localPts = local.map(([lx, ly]) => worldToPlane(
      vol.x + lx * c - ly * s,
      vol.y + lx * s + ly * c,
      basis
    ));
    const cutS = [];
    let minDepth = Infinity, maxDepth = -Infinity;
    let minSAll = Infinity, maxSAll = -Infinity;
    for (let i = 0; i < localPts.length; i++) {
      const a = localPts[i];
      const b = localPts[(i + 1) % localPts.length];
      if (a.depth < minDepth) minDepth = a.depth;
      if (a.depth > maxDepth) maxDepth = a.depth;
      if (a.s < minSAll) minSAll = a.s;
      if (a.s > maxSAll) maxSAll = a.s;
      if ((a.depth >= 0 && b.depth <= 0) || (a.depth <= 0 && b.depth >= 0)) {
        const denom = a.depth - b.depth;
        if (Math.abs(denom) < 1e-9) {
          if (Math.abs(a.depth) < 1e-6) cutS.push(a.s, b.s);
        } else {
          const t = a.depth / denom;
          if (t >= -1e-6 && t <= 1 + 1e-6) cutS.push(a.s + t * (b.s - a.s));
        }
      }
    }
    const isCut = cutS.length >= 2 && (Math.max(...cutS) - Math.min(...cutS)) > 0.05;
    return { cutS, isCut, minDepth, maxDepth, minSAll, maxSAll };
  }

  function buildProjectedRoofSilhouette(vol, dims, roof, zEave, basis, expandOv) {
    const hw = dims.w * 0.5 + expandOv;
    const hd = dims.d * 0.5 + expandOv;
    const hwRef = dims.w * 0.5;
    const hdRef = dims.d * 0.5;
    const c = Math.cos(vol.rot || 0);
    const sRot = Math.sin(vol.rot || 0);
    const toSZ = (lx, ly) => {
      const wx = vol.x + lx * c - ly * sRot;
      const wy = vol.y + lx * sRot + ly * c;
      const lp = worldToPlane(wx, wy, basis);
      const z = zEave + getRoofRiseAtLocal(lx, ly, dims.w, dims.d, roof);
      return { s: lp.s, z };
    };

    const edges = [];
    const addPoly = (pts) => {
      for (let i = 0; i < pts.length; i++) {
        edges.push([pts[i], pts[(i + 1) % pts.length]]);
      }
    };

    const p00 = toSZ(-hw, -hd), p10 = toSZ(hw, -hd), p11 = toSZ(hw, hd), p01 = toSZ(-hw, hd);
    if (roof.type === 'flat' || roof.type === 'skillion') {
      addPoly([p00, p10, p11, p01]);
    } else if (roof.type === 'gable') {
      if (roof.dir === 0 || roof.dir === 180) {
        const rL = toSZ(-hw, 0), rR = toSZ(hw, 0);
        edges.push([p00, p10], [p10, rR], [rR, p11], [p11, p01], [p01, rL], [rL, p00], [rL, rR]);
      } else {
        const rB = toSZ(0, -hd), rT = toSZ(0, hd);
        edges.push([p00, rB], [rB, p10], [p10, p11], [p11, rT], [rT, p01], [p01, p00], [rB, rT]);
      }
    } else {
      if (hwRef >= hdRef) {
        const rx = Math.max(0, hwRef - hdRef);
        const rL = toSZ(-rx, 0), rR = toSZ(rx, 0);
        edges.push([p00, p10], [p10, p11], [p11, p01], [p01, p00], [p00, rL], [p01, rL], [p10, rR], [p11, rR], [rL, rR]);
      } else {
        const ry = Math.max(0, hdRef - hwRef);
        const rB = toSZ(0, -ry), rT = toSZ(0, ry);
        edges.push([p00, p10], [p10, p11], [p11, p01], [p01, p00], [p00, rB], [p10, rB], [p01, rT], [p11, rT], [rB, rT]);
      }
    }

    // Collect upper envelope breakpoints (all vertices + pairwise edge intersections)
    const candS = [];
    for (const [a, b] of edges) candS.push(a.s, b.s);
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      for (let j = i + 1; j < edges.length; j++) {
        const [cPt, dPt] = edges[j];
        const aMin = Math.min(a.s, b.s), aMax = Math.max(a.s, b.s);
        const cMin = Math.min(cPt.s, dPt.s), cMax = Math.max(cPt.s, dPt.s);
        if (aMax < cMin || cMax < aMin) continue;
        const dx1 = b.s - a.s, dz1 = b.z - a.z;
        const dx2 = dPt.s - cPt.s, dz2 = dPt.z - cPt.z;
        const den = dx1 * dz2 - dz1 * dx2;
        if (Math.abs(den) < 1e-8) continue;
        const t = ((cPt.s - a.s) * dz2 - (cPt.z - a.z) * dx2) / den;
        const u = ((cPt.s - a.s) * dz1 - (cPt.z - a.z) * dx1) / den;
        if (t > 1e-5 && t < 1 - 1e-5 && u > 1e-5 && u < 1 - 1e-5) {
          candS.push(a.s + t * dx1);
        }
      }
    }
    candS.sort((a, b) => a - b);
    const uniqS = [];
    for (const sv of candS) {
      if (!uniqS.length || sv - uniqS[uniqS.length - 1] > 1e-4) uniqS.push(sv);
    }

    return uniqS.map(sv => {
      let maxZ = zEave;
      for (const [a, b] of edges) {
        const lo = Math.min(a.s, b.s) - 1e-5, hi = Math.max(a.s, b.s) + 1e-5;
        if (sv >= lo && sv <= hi) {
          const span = b.s - a.s;
          const zv = Math.abs(span) < 1e-6 ? Math.max(a.z, b.z) : (a.z + ((sv - a.s) / span) * (b.z - a.z));
          if (zv > maxZ) maxZ = zv;
        }
      }
      return { s: sv, z: maxZ };
    });
  }

  function sliceVolumeWithPlane(vol, plane, useGross, projDepth = 18) {
    const basis = getPlaneBasis(plane);
    const dims = getEffectiveDims(vol, useGross);
    const roof = getRoofSpec(vol);
    const apexRise = getRoofApexRise(dims, roof);
    const wallCut = intersectExpandedRectWithPlane(vol, dims.w, dims.d, basis);

    const isCut = wallCut.isCut;
    const isProjected = !isCut && wallCut.maxDepth > 0 && wallCut.minDepth <= projDepth;

    if (!isCut && !isProjected) {
      return null;
    }

    const earth = computeEarthwork(vol, useGross, 16);
    const zBase = vol.zBase;
    const zTop = vol.zBase + dims.totalHeight;

    if (!isCut) {
      const wallRoofPts = buildProjectedRoofSilhouette(vol, dims, roof, zTop, basis, 0);
      const roofCapPts = roof.overhang > 0.01
        ? buildProjectedRoofSilhouette(vol, dims, roof, zTop, basis, roof.overhang)
        : wallRoofPts;
      const zPeak = Math.max(zTop + apexRise, ...wallRoofPts.map(p => p.z));
      const sMid = (wallCut.minSAll + wallCut.maxSAll) * 0.5;
      const midPt = wallRoofPts.reduce((best, pt) => Math.abs(pt.s - sMid) < Math.abs(best.s - sMid) ? pt : best, wallRoofPts[0]);
      return {
        vol,
        roof,
        kind: 'projected',
        sMin: wallCut.minSAll,
        sMax: wallCut.maxSAll,
        sRoofMin: roofCapPts[0].s,
        sRoofMax: roofCapPts[roofCapPts.length - 1].s,
        zBase,
        zTop,
        zPeak,
        zRoofMid: midPt ? midPt.z : zTop,
        wallRoofPts,
        roofCapPts,
        dims,
        earth,
        distBehind: Math.max(0, wallCut.minDepth),
        cutPolys: [],
        fillPolys: []
      };
    }

    const sMin = Math.min(...wallCut.cutS);
    const sMax = Math.max(...wallCut.cutS);

    // Cut roof cap span including overhang
    let sRoofMin = sMin, sRoofMax = sMax;
    if (roof.overhang > 0.01) {
      const capCut = intersectExpandedRectWithPlane(vol, dims.w + 2 * roof.overhang, dims.d + 2 * roof.overhang, basis);
      if (capCut.isCut) {
        sRoofMin = Math.min(...capCut.cutS);
        sRoofMax = Math.max(...capCut.cutS);
      }
    }

    // Parametric local coords along the cut line (depth === 0)
    const c = Math.cos(vol.rot || 0);
    const sR = Math.sin(vol.rot || 0);
    const dx0 = basis.cx - vol.x, dy0 = basis.cy - vol.y;
    const lx0 = dx0 * c + dy0 * sR;
    const ly0 = -dx0 * sR + dy0 * c;
    const dlx = basis.tx * c + basis.ty * sR;
    const dly = -basis.tx * sR + basis.ty * c;
    const hw = dims.w * 0.5, hd = dims.d * 0.5;

    const creaseBreaks = [];
    const addSolve = (a, b) => {
      if (Math.abs(a) > 1e-8) creaseBreaks.push(-b / a);
    };
    if (roof.type === 'gable') {
      if (roof.dir === 0 || roof.dir === 180) addSolve(dly, ly0);
      else addSolve(dlx, lx0);
    } else if (roof.type === 'hip') {
      const k = hw - hd;
      addSolve(dlx - dly, lx0 - ly0 - k);
      addSolve(dlx + dly, lx0 + ly0 - k);
      addSolve(dlx + dly, lx0 + ly0 + k);
      addSolve(dlx - dly, lx0 - ly0 + k);
    }

    const sampleSpan = (aS, bS) => {
      const ptsS = [aS, bS];
      for (const sb of creaseBreaks) {
        if (sb > aS + 1e-4 && sb < bS - 1e-4) ptsS.push(sb);
      }
      ptsS.sort((a, b) => a - b);
      const out = [];
      for (const sv of ptsS) {
        if (!out.length || sv - out[out.length - 1].s > 1e-4) {
          const z = zTop + getRoofRiseAtLocal(lx0 + sv * dlx, ly0 + sv * dly, dims.w, dims.d, roof);
          out.push({ s: sv, z });
        }
      }
      return out;
    };

    const wallRoofPts = sampleSpan(sMin, sMax);
    const roofCapPts = roof.overhang > 0.01 ? sampleSpan(sRoofMin, sRoofMax) : wallRoofPts;
    const sMid = (sMin + sMax) * 0.5;
    const zRoofMid = zTop + getRoofRiseAtLocal(lx0 + sMid * dlx, ly0 + sMid * dly, dims.w, dims.d, roof);
    const zPeak = Math.max(zTop, ...wallRoofPts.map(p => p.z));

    const segLen = sMax - sMin;
    const steps = Math.max(8, Math.min(80, Math.ceil(segLen / 0.15)));
    const samples = [];
    for (let i = 0; i <= steps; i++) {
      const s = sMin + segLen * (i / steps);
      const wx = basis.cx + s * basis.tx;
      const wy = basis.cy + s * basis.ty;
      samples.push({ s, gz: getGroundZ(wx, wy) });
    }

    // Build exact 2D polygons where terrain > zBase (Cut) and terrain < zBase (Fill)
    const cutPolys = extractVerticalDiffPolys(samples, zBase, +1);
    const fillPolys = extractVerticalDiffPolys(samples, zBase, -1);

    return {
      vol,
      roof,
      kind: 'cut',
      sMin,
      sMax,
      sRoofMin,
      sRoofMax,
      zBase,
      zTop,
      zPeak,
      zRoofMid,
      wallRoofPts,
      roofCapPts,
      dims,
      earth,
      distBehind: 0,
      cutPolys,
      fillPolys
    };
  }

  function extractVerticalDiffPolys(samples, zBase, sign) {
    // sign = +1 for gz > zBase (Cut), sign = -1 for gz < zBase (Fill)
    const polys = [];
    let current = null;

    for (let i = 0; i < samples.length; i++) {
      const a = samples[i];
      const da = (a.gz - zBase) * sign;

      if (da > 1e-4) {
        if (!current) {
          current = [];
          if (i > 0) {
            const prev = samples[i - 1];
            const dp = (prev.gz - zBase) * sign;
            const denom = Math.abs(dp) + da;
            const sZero = denom > 1e-9 ? prev.s + (a.s - prev.s) * (Math.abs(dp) / denom) : a.s;
            current.push({ s: sZero, z: zBase });
          } else {
            current.push({ s: a.s, z: zBase });
          }
        }
        current.push({ s: a.s, z: a.gz });
      } else if (current) {
        const prev = samples[i - 1];
        const dp = (prev.gz - zBase) * sign;
        const denom = dp + Math.abs(da);
        const sZero = denom > 1e-9 ? prev.s + (a.s - prev.s) * (dp / denom) : a.s;
        current.push({ s: sZero, z: zBase });
        if (current.length >= 3) polys.push(current);
        current = null;
      }
    }

    if (current) {
      const last = samples[samples.length - 1];
      current.push({ s: last.s, z: zBase });
      if (current.length >= 3) polys.push(current);
    }

    return polys;
  }

  function sliceContextBuilding(bldg, plane, projDepth = 20) {
    if (!bldg.fp || bldg.fp.length < 3) return null;
    const basis = getPlaneBasis(plane);
    let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
    for (const pt of bldg.fp) {
      const lp = worldToPlane(pt[0], pt[1], basis);
      if (lp.s < minS) minS = lp.s;
      if (lp.s > maxS) maxS = lp.s;
      if (lp.depth < minD) minD = lp.depth;
      if (lp.depth > maxD) maxD = lp.depth;
    }
    if (maxD < 0 || minD > projDepth) return null;
    const isCut = minD <= 0 && maxD >= 0;
    return {
      sMin: minS,
      sMax: maxS,
      minZ: bldg.minZ,
      maxZ: bldg.maxZ,
      isCut
    };
  }

  const _contourCache = {};
  function getGeneratedContours(interval = 2) {
    if (_contourCache[interval]) return _contourCache[interval];
    const site = getSite();
    if (!site || !site.heightfield) return [];
    const zArr = getGradedHeightfieldZ();
    if (!zArr) return [];
    const hf = site.heightfield;
    const zMin = Math.ceil(site.meta.zMin / interval) * interval;
    const zMax = Math.floor(site.meta.zMax / interval) * interval;
    const segs = [];

    for (let level = zMin; level <= zMax + 1e-6; level += interval) {
      const lines = [];
      for (let iy = 0; iy < hf.ny - 1; iy++) {
        const y0 = hf.minY + iy * hf.cellSize;
        const y1 = y0 + hf.cellSize;
        const r0 = iy * hf.nx;
        const r1 = (iy + 1) * hf.nx;
        for (let ix = 0; ix < hf.nx - 1; ix++) {
          const x0 = hf.minX + ix * hf.cellSize;
          const x1 = x0 + hf.cellSize;
          const z0 = zArr[r0 + ix];
          const z1 = zArr[r0 + ix + 1];
          const z2 = zArr[r1 + ix + 1];
          const z3 = zArr[r1 + ix];
          const mask = (z0 >= level ? 1 : 0) | (z1 >= level ? 2 : 0) | (z2 >= level ? 4 : 0) | (z3 >= level ? 8 : 0);
          if (mask === 0 || mask === 15) continue;

          const edgePt = (e) => {
            if (e === 0) {
              const t = (level - z0) / ((z1 - z0) || 1e-9);
              return [x0 + t * (x1 - x0), y0];
            } else if (e === 1) {
              const t = (level - z1) / ((z2 - z1) || 1e-9);
              return [x1, y0 + t * (y1 - y0)];
            } else if (e === 2) {
              const t = (level - z3) / ((z2 - z3) || 1e-9);
              return [x0 + t * (x1 - x0), y1];
            } else {
              const t = (level - z0) / ((z3 - z0) || 1e-9);
              return [x0, y0 + t * (y1 - y0)];
            }
          };

          const table = {
            1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]],
            5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]],
            9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]],
            13: [[0, 1]], 14: [[0, 3]]
          };
          const pairs = table[mask];
          if (pairs) {
            for (const [eA, eB] of pairs) {
              lines.push([edgePt(eA), edgePt(eB)]);
            }
          }
        }
      }
      segs.push({ z: Math.round(level * 100) / 100, isMajor: Math.abs(level % 5) < 1e-6, lines });
    }
    _contourCache[interval] = segs;
    return segs;
  }

  function pointInSiteBoundary(x, y) {
    const site = getSite();
    const poly = site && site.siteBoundary;
    if (!poly || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function isBuildingInsidePlot(b) {
    if (!b) return false;
    if (typeof b._insidePlot === 'boolean') return b._insidePlot;
    const fp = b.fp;
    if (!fp || fp.length === 0) {
      b._insidePlot = false;
      return false;
    }
    let sx = 0, sy = 0;
    let inside = false;
    for (const pt of fp) {
      sx += pt[0];
      sy += pt[1];
      if (pointInSiteBoundary(pt[0], pt[1])) {
        inside = true;
        break;
      }
    }
    if (!inside) {
      inside = pointInSiteBoundary(sx / fp.length, sy / fp.length);
    }
    b._insidePlot = inside;
    return inside;
  }

  window.GROUNDWORK_ENGINE = {
    getGroundZ,
    getPadGroundZ,
    getOriginalGroundZ,
    setTerrainMods,
    setCircCutouts,
    getTerrainVersion,
    getPadHeightfieldZ,
    getActiveCircCutouts,
    getGradedHeightfieldZ,
    getEffectiveDims,
    getRoofSpec,
    getRoofRiseAtLocal,
    getRoofApexRise,
    getFootprintCorners,
    pointInFootprint,
    pointInPolygon,
    distPointToPolygonEdge,
    distPointToSegment,
    polygonsOverlap,
    pointInSiteBoundary,
    isBuildingInsidePlot,
    minEdgeDistanceRects,
    computeEarthwork,
    getPlaneBasis,
    worldToPlane,
    planeToWorld,
    sliceTerrainAlongPlane,
    sliceVolumeWithPlane,
    sliceContextBuilding,
    getGeneratedContours
  };
})();
