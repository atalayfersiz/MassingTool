/* Geometric, Terrain, Earthwork Cut/Fill, and Clipping-Plane Section Engine */
(function () {
  function getSite() {
    return window.GROUNDWORK_SITE;
  }

  function getGroundZ(x, y) {
    const site = getSite();
    if (!site || !site.heightfield) return 1975.0;
    const hf = site.heightfield;
    const fx = (x - hf.minX) / hf.cellSize;
    const fy = (y - hf.minY) / hf.cellSize;
    const ix = Math.max(0, Math.min(hf.nx - 2, Math.floor(fx)));
    const iy = Math.max(0, Math.min(hf.ny - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - ix));
    const ty = Math.max(0, Math.min(1, fy - iy));
    const z = hf.z;
    const row0 = iy * hf.nx;
    const row1 = (iy + 1) * hf.nx;
    const z00 = z[row0 + ix];
    const z10 = z[row0 + ix + 1];
    const z01 = z[row1 + ix];
    const z11 = z[row1 + ix + 1];
    return (z00 * (1 - tx) + z10 * tx) * (1 - ty) + (z01 * (1 - tx) + z11 * tx) * ty;
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

  function sliceVolumeWithPlane(vol, plane, useGross, projDepth = 18) {
    const basis = getPlaneBasis(plane);
    const corners = getFootprintCorners(vol, useGross);
    const dims = getEffectiveDims(vol, useGross);
    const localPts = corners.map(p => worldToPlane(p.x, p.y, basis));

    // Intersect edges with depth === 0 (cut plane)
    const cutS = [];
    let minDepth = Infinity;
    let maxDepth = -Infinity;
    let minSAll = Infinity;
    let maxSAll = -Infinity;

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
          if (Math.abs(a.depth) < 1e-6) {
            cutS.push(a.s, b.s);
          }
        } else {
          const t = a.depth / denom;
          if (t >= -1e-6 && t <= 1 + 1e-6) {
            cutS.push(a.s + t * (b.s - a.s));
          }
        }
      }
    }

    const isCut = cutS.length >= 2 && (Math.max(...cutS) - Math.min(...cutS)) > 0.05;
    const isProjected = !isCut && maxDepth > 0 && minDepth <= projDepth;

    if (!isCut && !isProjected) {
      return null;
    }

    const earth = computeEarthwork(vol, useGross, 16);
    const zBase = vol.zBase;
    const zTop = vol.zBase + dims.totalHeight;

    if (!isCut) {
      return {
        vol,
        kind: 'projected',
        sMin: minSAll,
        sMax: maxSAll,
        zBase,
        zTop,
        dims,
        earth,
        distBehind: Math.max(0, minDepth),
        cutPolys: [],
        fillPolys: []
      };
    }

    const sMin = Math.min(...cutS);
    const sMax = Math.max(...cutS);
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
      kind: 'cut',
      sMin,
      sMax,
      zBase,
      zTop,
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
          const z0 = hf.z[r0 + ix];
          const z1 = hf.z[r0 + ix + 1];
          const z2 = hf.z[r1 + ix + 1];
          const z3 = hf.z[r1 + ix];
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
    getEffectiveDims,
    getFootprintCorners,
    pointInFootprint,
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
