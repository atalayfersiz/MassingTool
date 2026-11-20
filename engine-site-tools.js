/* Site Engineering Tools: Terrain Grading Pads & Retaining Walls, Parametric Ramps & Stairs,
   CAD Window/Crossing Box Selection, and D8 Rainwater Flow & Collection Analysis */
(function () {
  function eng() {
    return window.GROUNDWORK_ENGINE;
  }

  /* ============================================================
     1. CAD Window (L->R) & Crossing (R->L) Box Selection Helpers
     ============================================================ */
  function _ptXY(pt) {
    return Array.isArray(pt) ? { x: pt[0], y: pt[1] } : { x: pt.x, y: pt.y };
  }

  function rectContainsAllPoints(pts, minX, maxX, minY, maxY) {
    if (!pts || pts.length === 0) return false;
    for (const raw of pts) {
      const p = _ptXY(raw);
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) return false;
    }
    return true;
  }

  function rectIntersectsSegment(ax, ay, bx, by, minX, maxX, minY, maxY) {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const clip = (p, q) => {
      if (Math.abs(p) < 1e-9) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    return (
      clip(-dx, ax - minX) &&
      clip(dx, maxX - ax) &&
      clip(-dy, ay - minY) &&
      clip(dy, maxY - ay) &&
      t0 <= t1
    );
  }

  function rectIntersectsPolygon(pts, minX, maxX, minY, maxY) {
    if (!pts || pts.length === 0) return false;
    const norm = pts.map(_ptXY);
    for (const p of norm) {
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) return true;
    }
    const e = eng();
    const boxCorners = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY]
    ];
    for (const [bx, by] of boxCorners) {
      if (e.pointInPolygon(bx, by, norm)) return true;
    }
    for (let i = 0; i < norm.length; i++) {
      const a = norm[i];
      const b = norm[(i + 1) % norm.length];
      if (rectIntersectsSegment(a.x, a.y, b.x, b.y, minX, maxX, minY, maxY)) return true;
    }
    return false;
  }

  /* ============================================================
     2. Terrain Grading Pads (Flatten / Lift / Dig) & Retaining Walls
     ============================================================ */
  function getPolygonStats(pts) {
    if (!pts || pts.length < 3) {
      return {
        padArea: 0,
        cx: 0,
        cy: 0,
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
        wallLength: 0,
        avgOrigZ: 1975,
        minOrigZ: 1975,
        maxOrigZ: 1975
      };
    }
    const norm = pts.map(_ptXY);
    let signed2 = 0;
    let cxAcc = 0;
    let cyAcc = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let perim = 0;
    for (let i = 0; i < norm.length; i++) {
      const a = norm[i];
      const b = norm[(i + 1) % norm.length];
      const cr = a.x * b.y - b.x * a.y;
      signed2 += cr;
      cxAcc += (a.x + b.x) * cr;
      cyAcc += (a.y + b.y) * cr;
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.y > maxY) maxY = a.y;
      perim += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const area = Math.abs(signed2) * 0.5;
    let cx = 0;
    let cy = 0;
    if (Math.abs(signed2) > 1e-5) {
      cx = cxAcc / (3 * signed2);
      cy = cyAcc / (3 * signed2);
    } else {
      cx = (minX + maxX) * 0.5;
      cy = (minY + maxY) * 0.5;
    }

    const e = eng();
    const spanX = Math.max(0.5, maxX - minX);
    const spanY = Math.max(0.5, maxY - minY);
    const step = Math.max(0.5, Math.min(2.0, Math.max(spanX, spanY) / 14));
    let sumZ = 0, cnt = 0, minZ = Infinity, maxZ = -Infinity;
    for (let y = minY + step * 0.5; y <= maxY; y += step) {
      for (let x = minX + step * 0.5; x <= maxX; x += step) {
        if (!e.pointInPolygon(x, y, norm)) continue;
        const gz = e.getOriginalGroundZ(x, y);
        sumZ += gz;
        if (gz < minZ) minZ = gz;
        if (gz > maxZ) maxZ = gz;
        cnt++;
      }
    }
    if (cnt === 0) {
      const gz = e.getOriginalGroundZ(cx, cy);
      sumZ = gz; minZ = gz; maxZ = gz; cnt = 1;
    }
    return {
      padArea: area,
      cx,
      cy,
      minX,
      maxX,
      minY,
      maxY,
      wallLength: perim,
      avgOrigZ: sumZ / cnt,
      minOrigZ: minZ,
      maxOrigZ: maxZ
    };
  }

  function normalizeTerrainMod(raw) {
    const pts = Array.isArray(raw && raw.pts) ? raw.pts.map(p => ({ x: Number(_ptXY(p).x) || 0, y: Number(_ptXY(p).y) || 0 })) : [];
    const stats = getPolygonStats(pts);
    const mode = raw && raw.mode === 'offset' ? 'offset' : 'flatten';
    const targetZ = raw && Number.isFinite(Number(raw.targetZ)) ? Number(raw.targetZ) : Math.round(stats.avgOrigZ * 100) / 100;
    const deltaZ = raw && Number.isFinite(Number(raw.deltaZ)) ? Number(raw.deltaZ) : 0;
    return {
      id: (raw && raw.id) || ('pad-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5)),
      name: (raw && raw.name) || 'Terrain Pad',
      shape: raw && raw.shape === 'poly' ? 'poly' : 'rect',
      pts,
      mode,
      targetZ,
      deltaZ,
      retainingWalls: raw && raw.retainingWalls !== undefined ? !!raw.retainingWalls : true,
      wallThickness: raw && Number.isFinite(Number(raw.wallThickness)) ? Math.max(0.15, Math.min(1.5, Number(raw.wallThickness))) : 0.35,
      parapetHeight: raw && Number.isFinite(Number(raw.parapetHeight)) ? Math.max(0, Math.min(2.5, Number(raw.parapetHeight))) : 0.25,
      batterSlope: raw && Number.isFinite(Number(raw.batterSlope)) ? Math.max(0, Math.min(12, Number(raw.batterSlope))) : 0
    };
  }

  function computeTerrainModEarthwork(mod) {
    const stats = getPolygonStats(mod.pts);
    if (!mod.pts || mod.pts.length < 3) {
      return { ...stats, cutVol: 0, fillVol: 0, netVol: 0, maxCutDepth: 0, maxFillHeight: 0, maxWallHeight: 0, wallArea: 0 };
    }
    const e = eng();
    const span = Math.max(stats.maxX - stats.minX, stats.maxY - stats.minY, 1);
    const step = Math.max(0.45, Math.min(1.2, span / 22));
    const dA = step * step;

    let cutVol = 0;
    let fillVol = 0;
    let maxCutDepth = 0;
    let maxFillHeight = 0;

    for (let y = stats.minY + step * 0.5; y <= stats.maxY; y += step) {
      for (let x = stats.minX + step * 0.5; x <= stats.maxX; x += step) {
        if (!e.pointInPolygon(x, y, mod.pts)) continue;
        const origZ = e.getOriginalGroundZ(x, y);
        const modZ = mod.mode === 'offset' ? (origZ + (mod.deltaZ || 0)) : mod.targetZ;
        const diff = origZ - modZ;
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

    let maxWallHeight = 0;
    let wallArea = 0;
    if (mod.retainingWalls !== false) {
      const parapet = mod.parapetHeight || 0;
      for (let i = 0; i < mod.pts.length; i++) {
        const a = mod.pts[i];
        const b = mod.pts[(i + 1) % mod.pts.length];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (segLen < 0.05) continue;
        const nSeg = Math.max(1, Math.ceil(segLen / 0.6));
        const ds = segLen / nSeg;
        for (let k = 0; k < nSeg; k++) {
          const t = (k + 0.5) / nSeg;
          const wx = a.x + (b.x - a.x) * t;
          const wy = a.y + (b.y - a.y) * t;
          const origZ = e.getOriginalGroundZ(wx, wy);
          const modZ = mod.mode === 'offset' ? (origZ + (mod.deltaZ || 0)) : mod.targetZ;
          const hStep = Math.abs(modZ - origZ);
          if (hStep > maxWallHeight) maxWallHeight = hStep;
          if (hStep > 0.05 || parapet > 0.01) {
            wallArea += (hStep + parapet) * ds;
          }
        }
      }
    }

    return {
      ...stats,
      cutVol,
      fillVol,
      netVol: cutVol - fillVol,
      maxCutDepth,
      maxFillHeight,
      maxWallHeight,
      wallArea
    };
  }

  function _extractDiffPolysFromSamples(samples, sign) {
    const polys = [];
    let cur = null;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i];
      const da = (a.origZ - a.modZ) * sign;
      if (da > 1e-4) {
        if (!cur) {
          cur = [];
          if (i > 0) {
            const prev = samples[i - 1];
            const dp = (prev.origZ - prev.modZ) * sign;
            const denom = Math.abs(dp) + da;
            const t = denom > 1e-9 ? Math.abs(dp) / denom : 0.5;
            cur.push({ s: prev.s + (a.s - prev.s) * t, z: prev.modZ + (a.modZ - prev.modZ) * t });
          } else {
            cur.push({ s: a.s, z: a.modZ });
          }
        }
        cur.push({ s: a.s, z: a.origZ });
      } else if (cur) {
        const prev = samples[i - 1];
        const dp = (prev.origZ - prev.modZ) * sign;
        const denom = dp + Math.abs(da);
        const t = denom > 1e-9 ? dp / denom : 0.5;
        cur.push({ s: prev.s + (a.s - prev.s) * t, z: prev.modZ + (a.modZ - prev.modZ) * t });
        if (cur.length >= 3) polys.push(cur);
        cur = null;
      }
    }
    if (cur) {
      const last = samples[samples.length - 1];
      cur.push({ s: last.s, z: last.modZ });
      if (cur.length >= 3) polys.push(cur);
    }
    // Close bottom along modZ profile
    return polys.map((topPoly) => {
      const sStart = topPoly[0].s;
      const sEnd = topPoly[topPoly.length - 1].s;
      const extra = [];
      for (let i = samples.length - 1; i >= 0; i--) {
        if (samples[i].s > sStart + 1e-3 && samples[i].s < sEnd - 1e-3) {
          extra.push({ s: samples[i].s, z: samples[i].modZ });
        }
      }
      return topPoly.concat(extra);
    });
  }

  function sliceTerrainModWithPlane(mod, plane) {
    if (!mod || !mod.pts || mod.pts.length < 3 || !plane) return null;
    const e = eng();
    const basis = e.getPlaneBasis(plane);
    const localPts = mod.pts.map(p => e.worldToPlane(p.x, p.y, basis));
    const hitS = [];
    for (let i = 0; i < localPts.length; i++) {
      const a = localPts[i];
      const b = localPts[(i + 1) % localPts.length];
      if ((a.depth >= 0 && b.depth <= 0) || (a.depth <= 0 && b.depth >= 0)) {
        const denom = a.depth - b.depth;
        if (Math.abs(denom) < 1e-9) {
          if (Math.abs(a.depth) < 1e-6) hitS.push(a.s, b.s);
        } else {
          const t = a.depth / denom;
          if (t >= -1e-6 && t <= 1 + 1e-6) hitS.push(a.s + t * (b.s - a.s));
        }
      }
    }
    if (hitS.length < 2) return null;
    hitS.sort((a, b) => a - b);
    const uniq = [];
    for (const sVal of hitS) {
      if (!uniq.length || sVal - uniq[uniq.length - 1] > 1e-3) uniq.push(sVal);
    }
    const spans = [];
    const wallStations = [];
    const cutPolys = [];
    const fillPolys = [];

    for (let i = 0; i < uniq.length - 1; i++) {
      const sA = uniq[i];
      const sB = uniq[i + 1];
      if (sB - sA < 0.08) continue;
      const wpMid = e.planeToWorld((sA + sB) * 0.5, 0, basis);
      if (!e.pointInPolygon(wpMid.x, wpMid.y, mod.pts)) continue;
      spans.push({ sMin: sA, sMax: sB });
      const steps = Math.max(4, Math.min(60, Math.ceil((sB - sA) / 0.25)));
      const samples = [];
      for (let k = 0; k <= steps; k++) {
        const sv = sA + (sB - sA) * (k / steps);
        const wp = e.planeToWorld(sv, 0, basis);
        const origZ = e.getOriginalGroundZ(wp.x, wp.y);
        const modZ = mod.mode === 'offset' ? (origZ + (mod.deltaZ || 0)) : mod.targetZ;
        samples.push({ s: sv, origZ, modZ });
      }
      cutPolys.push(..._extractDiffPolysFromSamples(samples, +1));
      fillPolys.push(..._extractDiffPolysFromSamples(samples, -1));

      if (mod.retainingWalls !== false) {
        for (const ws of [sA, sB]) {
          const wp = e.planeToWorld(ws, 0, basis);
          const origZ = e.getOriginalGroundZ(wp.x, wp.y);
          const modZ = mod.mode === 'offset' ? (origZ + (mod.deltaZ || 0)) : mod.targetZ;
          const zLow = Math.min(origZ, modZ) - 0.35;
          const zHigh = Math.max(origZ, modZ) + (mod.parapetHeight || 0);
          if (zHigh - zLow > 0.2) {
            wallStations.push({ s: ws, zLow, zHigh, thickness: mod.wallThickness || 0.35 });
          }
        }
      }
    }
    if (spans.length === 0) return null;
    return { mod, spans, cutPolys, fillPolys, wallStations };
  }

  /* ============================================================
     3. Parametric Ramps & Stairs
     ============================================================ */
  function normalizeCirculation(raw) {
    const kind = raw && raw.kind === 'stair' ? 'stair' : 'ramp';
    const defWidth = kind === 'stair' ? 2.0 : 1.8;
    const defLength = kind === 'stair' ? 6.0 : 12.0;
    return {
      id: (raw && raw.id) || ((kind === 'stair' ? 'stair-' : 'ramp-') + Date.now() + '-' + Math.random().toString(36).slice(2, 5)),
      kind,
      name: (raw && raw.name) || (kind === 'stair' ? 'Exterior Stair' : 'Access Ramp'),
      x: raw && Number.isFinite(Number(raw.x)) ? Number(raw.x) : 0,
      y: raw && Number.isFinite(Number(raw.y)) ? Number(raw.y) : 0,
      length: raw && Number.isFinite(Number(raw.length)) ? Math.max(1.2, Number(raw.length)) : defLength,
      width: raw && Number.isFinite(Number(raw.width)) ? Math.max(0.9, Number(raw.width)) : defWidth,
      rot: raw && Number.isFinite(Number(raw.rot)) ? Number(raw.rot) : 0,
      autoTerrainZ: raw && raw.autoTerrainZ !== undefined ? !!raw.autoTerrainZ : true,
      zStart: raw && Number.isFinite(Number(raw.zStart)) ? Number(raw.zStart) : 1975,
      zEnd: raw && Number.isFinite(Number(raw.zEnd)) ? Number(raw.zEnd) : 1977,
      riserHeight: raw && Number.isFinite(Number(raw.riserHeight)) ? Math.max(0.10, Math.min(0.24, Number(raw.riserHeight))) : 0.165,
      treadDepth: raw && Number.isFinite(Number(raw.treadDepth)) ? Math.max(0.22, Math.min(0.55, Number(raw.treadDepth))) : 0.30,
      landingInterval: raw && Number.isFinite(Number(raw.landingInterval)) ? Math.max(0, Math.round(Number(raw.landingInterval))) : 12,
      landingLength: raw && Number.isFinite(Number(raw.landingLength)) ? Math.max(0.9, Math.min(3.5, Number(raw.landingLength))) : 1.4,
      targetSlopePct: raw && Number.isFinite(Number(raw.targetSlopePct)) ? Math.max(1, Math.min(25, Number(raw.targetSlopePct))) : 8.0,
      maxRunBeforeLanding: raw && Number.isFinite(Number(raw.maxRunBeforeLanding)) ? Math.max(0, Math.min(30, Number(raw.maxRunBeforeLanding))) : 9.0,
      slabThickness: raw && Number.isFinite(Number(raw.slabThickness)) ? Math.max(0.12, Math.min(0.8, Number(raw.slabThickness))) : 0.25,
      railing: raw && raw.railing !== undefined ? !!raw.railing : true,
      sideWalls: raw && raw.sideWalls !== undefined ? !!raw.sideWalls : true
    };
  }

  function getCirculationCorners(circ) {
    const hl = circ.length * 0.5;
    const hw = circ.width * 0.5;
    const c = Math.cos(circ.rot || 0);
    const s = Math.sin(circ.rot || 0);
    return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([u, v]) => ({
      x: circ.x + u * c - v * s,
      y: circ.y + u * s + v * c
    }));
  }

  function pointInCirculation(px, py, circ) {
    const dx = px - circ.x;
    const dy = py - circ.y;
    const c = Math.cos(circ.rot || 0);
    const s = Math.sin(circ.rot || 0);
    const u = dx * c + dy * s;
    const v = -dx * s + dy * c;
    return Math.abs(u) <= circ.length * 0.5 && Math.abs(v) <= circ.width * 0.5;
  }

  function findAdjacentSupportZ(x, y, volumes, useGross) {
    const e = eng();
    let bestZ = null;
    let bestDist = 1.25;
    for (const v of (volumes || [])) {
      const corners = e.getFootprintCorners(v, useGross);
      if (e.pointInPolygon(x, y, corners)) {
        return v.zBase;
      }
      const d = e.distPointToPolygonEdge(x, y, corners);
      if (d < bestDist) {
        bestDist = d;
        bestZ = v.zBase;
      }
    }
    return bestZ;
  }

  function computeCirculationProfile(circ, volumes, useGross) {
    const e = eng();
    const L = Math.max(1.0, circ.length || 6);
    const c = Math.cos(circ.rot || 0);
    const s = Math.sin(circ.rot || 0);
    const sx = circ.x - L * 0.5 * c;
    const sy = circ.y - L * 0.5 * s;
    const ex = circ.x + L * 0.5 * c;
    const ey = circ.y + L * 0.5 * s;

    let zStart = circ.zStart;
    let zEnd = circ.zEnd;
    if (circ.autoTerrainZ) {
      const adjS = findAdjacentSupportZ(sx, sy, volumes, useGross);
      const adjE = findAdjacentSupportZ(ex, ey, volumes, useGross);
      zStart = Math.round((adjS !== null ? adjS : e.getGroundZ(sx, sy)) * 100) / 100;
      zEnd = Math.round((adjE !== null ? adjE : e.getGroundZ(ex, ey)) * 100) / 100;
    }

    const dz = zEnd - zStart;
    const absDZ = Math.abs(dz);
    const segments = [];
    const steps = [];

    if (circ.kind === 'ramp') {
      const lLen = Math.min(L * 0.25, Math.max(0.9, circ.landingLength || 1.4));
      const maxRun = circ.maxRunBeforeLanding || 0;
      let numLandings = 0;
      if (maxRun > 1.0 && L > maxRun + lLen + 1.0) {
        numLandings = Math.max(1, Math.min(5, Math.floor((L - lLen) / maxRun)));
      }
      const totalLandingLen = numLandings * lLen;
      const effectiveRun = Math.max(0.6, L - totalLandingLen);
      const slopePct = effectiveRun > 0.01 ? (absDZ / effectiveRun) * 100 : 0;
      const ratio = absDZ > 0.01 ? effectiveRun / absDZ : Infinity;
      const numFlights = numLandings + 1;
      const flightLen = effectiveRun / numFlights;
      const flightDZ = dz / numFlights;

      let curU = -L * 0.5;
      let curZ = zStart;
      for (let f = 0; f < numFlights; f++) {
        segments.push({ u0: curU, u1: curU + flightLen, z0: curZ, z1: curZ + flightDZ, isLanding: false });
        curU += flightLen;
        curZ += flightDZ;
        if (f < numLandings) {
          segments.push({ u0: curU, u1: curU + lLen, z0: curZ, z1: curZ, isLanding: true });
          curU += lLen;
        }
      }

      const compliance = slopePct <= 5.05 ? 'Gentle (<=5%)' : (slopePct <= 8.35 ? 'Accessible (<=8.3%)' : (slopePct <= 12.1 ? 'Steep (<=12%)' : 'Too Steep (>12%)'));
      const targetPct = Math.max(1, circ.targetSlopePct || 8.0);
      const reqRun = absDZ > 0.01 ? absDZ / (targetPct / 100) : L;
      const reqLandings = maxRun > 1.0 && reqRun > maxRun ? Math.floor(reqRun / maxRun) : 0;
      const recommendedLength = Math.round((reqRun + reqLandings * lLen) * 10) / 10;

      const surfaceZAtU = (u) => {
        for (const seg of segments) {
          if (u >= seg.u0 - 1e-6 && u <= seg.u1 + 1e-6) {
            const span = seg.u1 - seg.u0;
            const t = span > 1e-6 ? Math.max(0, Math.min(1, (u - seg.u0) / span)) : 0;
            return seg.z0 + (seg.z1 - seg.z0) * t;
          }
        }
        return u <= 0 ? zStart : zEnd;
      };

      return {
        kind: 'ramp',
        zStart,
        zEnd,
        dz,
        absDZ,
        length: L,
        effectiveRun,
        slopePct,
        ratio,
        numLandings,
        compliance,
        recommendedLength,
        segments,
        steps,
        surfaceZAtU,
        minZ: Math.min(zStart, zEnd),
        maxZ: Math.max(zStart, zEnd),
        startPt: { x: sx, y: sy },
        endPt: { x: ex, y: ey }
      };
    } else {
      // Stair calculation
      const prefRiser = Math.max(0.10, circ.riserHeight || 0.165);
      const riserCount = Math.max(1, Math.round(absDZ / prefRiser));
      const actualRiser = absDZ / riserCount;
      const interval = circ.landingInterval || 0;
      const numLandings = interval >= 2 && riserCount > interval ? Math.floor((riserCount - 1) / interval) : 0;
      const lLen = numLandings > 0 ? Math.min(L * 0.35 / numLandings, Math.max(0.9, circ.landingLength || 1.4)) : 0;
      const treadRunTotal = Math.max(0.5, L - numLandings * lLen);
      const actualTread = treadRunTotal / riserCount;
      const blondel = 2 * actualRiser + actualTread;
      const blondelOk = blondel >= 0.58 && blondel <= 0.67 && actualRiser <= 0.20;
      const compliance = blondelOk ? 'Comfortable (Blondel OK)' : (actualRiser > 0.20 ? 'Riser > 20cm' : (actualTread < 0.24 ? 'Short Treads' : 'Check Proportion'));
      const recommendedLength = Math.round((riserCount * (circ.treadDepth || 0.30) + numLandings * (circ.landingLength || 1.4)) * 10) / 10;

      const stepSign = dz >= 0 ? 1 : -1;
      let curU = -L * 0.5;
      let curZ = zStart;
      for (let r = 0; r < riserCount; r++) {
        if (interval >= 2 && r > 0 && r % interval === 0) {
          steps.push({ u0: curU, u1: curU + lLen, zTop: curZ, isLanding: true });
          segments.push({ u0: curU, u1: curU + lLen, z0: curZ, z1: curZ, isLanding: true });
          curU += lLen;
        }
        const nextZ = curZ + stepSign * actualRiser;
        const treadTop = stepSign > 0 ? nextZ : curZ;
        steps.push({ u0: curU, u1: curU + actualTread, zTop: treadTop, zStartStep: curZ, zEndStep: nextZ, isLanding: false });
        segments.push({ u0: curU, u1: curU + actualTread, z0: curZ, z1: nextZ, isLanding: false });
        curU += actualTread;
        curZ = nextZ;
      }

      const surfaceZAtU = (u) => {
        for (const st of steps) {
          if (u >= st.u0 - 1e-6 && u <= st.u1 + 1e-6) return st.zTop;
        }
        return u <= 0 ? zStart : zEnd;
      };

      return {
        kind: 'stair',
        zStart,
        zEnd,
        dz,
        absDZ,
        length: L,
        riserCount,
        actualRiser,
        actualTread,
        numLandings,
        blondel,
        compliance,
        recommendedLength,
        slopePct: L > 0.01 ? (absDZ / L) * 100 : 0,
        segments,
        steps,
        surfaceZAtU,
        minZ: Math.min(zStart, zEnd),
        maxZ: Math.max(zStart, zEnd),
        startPt: { x: sx, y: sy },
        endPt: { x: ex, y: ey }
      };
    }
  }

  function computeCirculationEarthwork(circ, profile) {
    const e = eng();
    const L = Math.max(1.0, circ.length || 6);
    const W = Math.max(0.8, circ.width || 1.8);
    const nu = Math.max(6, Math.min(28, Math.ceil(L / 0.5)));
    const nv = Math.max(2, Math.min(8, Math.ceil(W / 0.5)));
    const du = L / nu;
    const dv = W / nv;
    const dA = du * dv;
    const c = Math.cos(circ.rot || 0);
    const s = Math.sin(circ.rot || 0);
    const soffitOff = circ.slabThickness || 0.25;

    let cutVol = 0, fillVol = 0, maxCutDepth = 0, maxFillHeight = 0;
    for (let iu = 0; iu < nu; iu++) {
      const lu = -L * 0.5 + (iu + 0.5) * du;
      const zSurf = profile.surfaceZAtU(lu);
      const zPad = zSurf - soffitOff * 0.4;
      for (let iv = 0; iv < nv; iv++) {
        const lv = -W * 0.5 + (iv + 0.5) * dv;
        const wx = circ.x + lu * c - lv * s;
        const wy = circ.y + lu * s + lv * c;
        const gz = e.getGroundZ(wx, wy);
        const diff = gz - zPad;
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
    return { cutVol, fillVol, netVol: cutVol - fillVol, maxCutDepth, maxFillHeight };
  }

  function sliceCirculationWithPlane(circ, profile, plane, projDepth = 18) {
    if (!circ || !profile || !plane) return null;
    const e = eng();
    const basis = e.getPlaneBasis(plane);
    const corners = getCirculationCorners(circ);
    const localPts = corners.map(p => e.worldToPlane(p.x, p.y, basis));
    const cutS = [];
    let minD = Infinity, maxD = -Infinity, minSAll = Infinity, maxSAll = -Infinity;
    for (let i = 0; i < localPts.length; i++) {
      const a = localPts[i];
      const b = localPts[(i + 1) % localPts.length];
      if (a.depth < minD) minD = a.depth;
      if (a.depth > maxD) maxD = a.depth;
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
    const isProj = !isCut && maxD > 0 && minD <= projDepth;
    if (!isCut && !isProj) return null;

    const c = Math.cos(circ.rot || 0);
    const sRot = Math.sin(circ.rot || 0);
    const toPlaneSZ = (lu, lv, zVal) => {
      const wx = circ.x + lu * c - lv * sRot;
      const wy = circ.y + lu * sRot + lv * c;
      return { s: e.worldToPlane(wx, wy, basis).s, z: zVal };
    };

    const sMin = isCut ? Math.min(...cutS) : minSAll;
    const sMax = isCut ? Math.max(...cutS) : maxSAll;
    const earth = computeCirculationEarthwork(circ, profile);

    const topPts = [];
    const bottomPts = [];
    const thick = circ.slabThickness || 0.25;
    const L = Math.max(1.0, circ.length || 6);

    if (isCut) {
      const steps = Math.max(10, Math.min(48, Math.ceil((sMax - sMin) / 0.22)));
      for (let i = 0; i <= steps; i++) {
        const sv = sMin + (sMax - sMin) * (i / steps);
        const wp = e.planeToWorld(sv, 0, basis);
        const lu = Math.max(-L * 0.5, Math.min(L * 0.5, (wp.x - circ.x) * c + (wp.y - circ.y) * sRot));
        const zTop = profile.surfaceZAtU(lu);
        topPts.push({ s: sv, z: zTop });
        bottomPts.push({ s: sv, z: zTop - thick });
      }
    } else {
      const nSample = circ.kind === 'stair' ? Math.max(12, (profile.steps ? profile.steps.length * 2 : 16)) : 12;
      for (let i = 0; i <= nSample; i++) {
        const lu = -L * 0.5 + L * (i / nSample);
        const zTop = profile.surfaceZAtU(lu);
        const pt = toPlaneSZ(lu, 0, zTop);
        topPts.push(pt);
        bottomPts.push({ s: pt.s, z: zTop - thick });
      }
    }

    return {
      circ,
      profile,
      kind: isCut ? 'cut' : 'projected',
      sMin,
      sMax,
      zMin: profile.minZ - thick,
      zMax: profile.maxZ,
      topPts,
      bottomPts,
      earth
    };
  }

  /* ============================================================
     4. Rainwater Flow & Collection Analysis (D8 + Streamlines + Harvesting)
     ============================================================ */
  function computeRainwaterAnalysis(state, opts = {}) {
    const e = eng();
    const cfg = Object.assign({ intensityMmHr: 50, durationHr: 1.0, annualMm: 1600 }, state && state.rainConfig, opts);
    const intensity = Math.max(5, Math.min(250, Number(cfg.intensityMmHr) || 50));
    const duration = Math.max(0.2, Math.min(24, Number(cfg.durationHr) || 1.0));
    const annualMm = Math.max(100, Math.min(6000, Number(cfg.annualMm) || 1600));

    const step = 2.0;
    const minX = -64, maxX = 62;
    const minY = -98, maxY = 48;
    const nx = Math.floor((maxX - minX) / step) + 1;
    const ny = Math.floor((maxY - minY) / step) + 1;
    const total = nx * ny;
    const cellArea = step * step;

    const zArr = new Float32Array(total);
    const hFlow = new Float32Array(total);
    const cArr = new Float32Array(total);
    const inSite = new Uint8Array(total);

    const volumes = (state && state.volumes) || [];
    const mods = (state && state.terrainMods) || [];
    const circs = (state && state.circulations) || [];
    const useGross = !!(state && state.useGross);

    for (let iy = 0; iy < ny; iy++) {
      const wy = minY + iy * step;
      const row = iy * nx;
      for (let ix = 0; ix < nx; ix++) {
        const wx = minX + ix * step;
        const idx = row + ix;
        const gz = e.getGroundZ(wx, wy);
        zArr[idx] = gz;
        let wallBump = 0;
        let coeff = 0.30; // natural vegetated slope
        for (const m of mods) {
          if (e.pointInPolygon(wx, wy, m.pts)) {
            coeff = Math.max(coeff, 0.72);
          } else if (m.retainingWalls !== false && e.distPointToPolygonEdge(wx, wy, m.pts) < 1.15) {
            wallBump = Math.max(wallBump, 0.35 + (m.parapetHeight || 0) * 0.4);
          }
        }
        for (const cItem of circs) {
          if (pointInCirculation(wx, wy, cItem)) coeff = Math.max(coeff, 0.78);
        }
        for (const v of volumes) {
          if (e.pointInFootprint(wx, wy, v, useGross)) {
            coeff = 0.85; // impervious building roof
            break;
          }
        }
        hFlow[idx] = gz + wallBump;
        cArr[idx] = coeff;
        inSite[idx] = e.pointInSiteBoundary(wx, wy) ? 1 : 0;
      }
    }

    // D8 flow receiver
    const down = new Int32Array(total).fill(-1);
    const offsets = [
      [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
      [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]
    ];
    for (let iy = 1; iy < ny - 1; iy++) {
      for (let ix = 1; ix < nx - 1; ix++) {
        const idx = iy * nx + ix;
        const h0 = hFlow[idx];
        let bestSlope = 0.0015;
        let bestNb = -1;
        for (const [ox, oy, df] of offsets) {
          const nb = (iy + oy) * nx + (ix + ox);
          const slope = (h0 - hFlow[nb]) / (step * df);
          if (slope > bestSlope) {
            bestSlope = slope;
            bestNb = nb;
          }
        }
        down[idx] = bestNb;
      }
    }

    // Sort descending by hFlow to accumulate upstream area & weighted runoff
    const order = new Int32Array(total);
    for (let i = 0; i < total; i++) order[i] = i;
    order.sort((a, b) => hFlow[b] - hFlow[a]);

    const accArea = new Float32Array(total);
    const accRunoff = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      if (inSite[i]) {
        accArea[i] = cellArea;
        accRunoff[i] = cellArea * cArr[i];
      }
    }
    for (let k = 0; k < total; k++) {
      const idx = order[k];
      const nb = down[idx];
      if (nb >= 0) {
        accArea[nb] += accArea[idx];
        accRunoff[nb] += accRunoff[idx];
      }
    }

    const sampleGridAcc = (wx, wy) => {
      const ix = Math.max(0, Math.min(nx - 1, Math.round((wx - minX) / step)));
      const iy = Math.max(0, Math.min(ny - 1, Math.round((wy - minY) / step)));
      return accArea[iy * nx + ix];
    };

    const sampleFlowGrad = (wx, wy) => {
      const eps = 1.2;
      const gx = (e.getGroundZ(wx + eps, wy) - e.getGroundZ(wx - eps, wy)) / (2 * eps);
      const gy = (e.getGroundZ(wx, wy + eps) - e.getGroundZ(wx, wy - eps)) / (2 * eps);
      return { dx: -gx, dy: -gy, mag: Math.hypot(gx, gy) };
    };

    // Trace downhill continuous streamlines seeded on a 9m grid across site
    const streamlines = [];
    for (let y0 = minY + 6; y0 <= maxY - 6; y0 += 9) {
      for (let x0 = minX + 6; x0 <= maxX - 6; x0 += 9) {
        if (!e.pointInSiteBoundary(x0, y0)) continue;
        const pts = [];
        let cx = x0, cy = y0;
        let maxAccSeen = sampleGridAcc(cx, cy);
        for (let sIdx = 0; sIdx < 42; sIdx++) {
          const cz = e.getGroundZ(cx, cy);
          const accHere = sampleGridAcc(cx, cy);
          if (accHere > maxAccSeen) maxAccSeen = accHere;
          pts.push({ x: cx, y: cy, z: cz, acc: accHere });
          const g = sampleFlowGrad(cx, cy);
          if (g.mag < 0.008) break;
          const stepLen = 1.6;
          const nxPt = cx + (g.dx / g.mag) * stepLen;
          const nyPt = cy + (g.dy / g.mag) * stepLen;
          if (nxPt < minX + 2 || nxPt > maxX - 2 || nyPt < minY + 2 || nyPt > maxY - 2) break;
          const nzPt = e.getGroundZ(nxPt, nyPt);
          if (nzPt > cz + 0.06) break;
          // Check retaining wall barrier
          let blocked = false;
          for (const m of mods) {
            if (m.retainingWalls !== false && m.mode === 'flatten' && e.distPointToPolygonEdge(nxPt, nyPt, m.pts) < 0.7 && nzPt > cz) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
          cx = nxPt;
          cy = nyPt;
        }
        if (pts.length >= 3) {
          streamlines.push({ pts, maxAcc: maxAccSeen });
        }
      }
    }

    // Collect candidate ponding sinks (down[i] === -1) & high-accumulation site outlets
    const candidates = [];
    for (let iy = 1; iy < ny - 1; iy++) {
      const wy = minY + iy * step;
      for (let ix = 1; ix < nx - 1; ix++) {
        const wx = minX + ix * step;
        const idx = iy * nx + ix;
        if (!inSite[idx] || accArea[idx] < 60) continue;
        const isSink = down[idx] === -1;
        const isEdgeOutlet = !isSink && (!inSite[down[idx]] || down[idx] < 0);
        if (isSink || isEdgeOutlet) {
          const score = accRunoff[idx] * (isSink ? 2.2 : 1.0);
          candidates.push({
            ix,
            iy,
            x: wx,
            y: wy,
            z: zArr[idx],
            catchmentM2: accArea[idx],
            effAreaM2: accRunoff[idx],
            isSink,
            score
          });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const collections = [];
    for (const cnd of candidates) {
      if (collections.some(col => Math.hypot(col.x - cnd.x, col.y - cnd.y) < 12)) continue;
      collections.push({
        id: 'R' + (collections.length + 1),
        x: cnd.x,
        y: cnd.y,
        z: cnd.z,
        catchmentM2: Math.round(cnd.catchmentM2),
        peakLs: Math.round(((cnd.effAreaM2 * intensity) / 3600) * 10) / 10,
        stormM3: Math.round((cnd.effAreaM2 * (intensity * duration / 1000)) * 10) / 10,
        kind: cnd.isSink ? 'Ponding Basin' : 'Site Outlet'
      });
      if (collections.length >= 4) break;
    }

    // Building & pad totals and drainage risk flags
    let roofAreaM2 = 0;
    const riskVolumes = [];
    for (const v of volumes) {
      const dims = e.getEffectiveDims(v, useGross);
      roofAreaM2 += dims.footprintArea;
      const vAcc = sampleGridAcc(v.x, v.y);
      const ix = Math.max(0, Math.min(nx - 1, Math.round((v.x - minX) / step)));
      const iy = Math.max(0, Math.min(ny - 1, Math.round((v.y - minY) / step)));
      const atSink = down[iy * nx + ix] === -1 && vAcc >= 40;
      if (vAcc >= 140 || atSink) {
        riskVolumes.push({
          id: v.id,
          ref: v.ref || v.id,
          short: v.short || v.name,
          accAreaM2: Math.round(vAcc),
          reason: atSink ? 'Local Ponding Pocket' : 'High Runoff Channel'
        });
      }
    }

    let siteAreaSampled = 0;
    let siteWeightedC = 0;
    for (let i = 0; i < total; i++) {
      if (inSite[i]) {
        siteAreaSampled += cellArea;
        siteWeightedC += cellArea * cArr[i];
      }
    }
    const roofStormM3 = roofAreaM2 * 0.85 * ((intensity * duration) / 1000);
    const roofAnnualM3 = roofAreaM2 * 0.85 * (annualMm / 1000);
    const suggestedCisternM3 = roofAreaM2 > 0 ? Math.max(10, Math.round(roofStormM3 * 1.15)) : 0;
    const peakRunoffLs = (siteWeightedC * intensity) / 3600;
    const totalStormM3 = siteWeightedC * ((intensity * duration) / 1000);

    return {
      intensityMmHr: intensity,
      durationHr: duration,
      annualMm,
      siteAreaSampled: Math.round(siteAreaSampled),
      roofAreaM2: Math.round(roofAreaM2),
      roofStormM3: Math.round(roofStormM3 * 10) / 10,
      roofAnnualM3: Math.round(roofAnnualM3),
      suggestedCisternM3,
      peakRunoffLs: Math.round(peakRunoffLs * 10) / 10,
      totalStormM3: Math.round(totalStormM3 * 10) / 10,
      streamlines,
      collections,
      riskVolumes
    };
  }

  window.GROUNDWORK_SITE_TOOLS = {
    rectContainsAllPoints,
    rectIntersectsSegment,
    rectIntersectsPolygon,
    getPolygonStats,
    normalizeTerrainMod,
    computeTerrainModEarthwork,
    sliceTerrainModWithPlane,
    normalizeCirculation,
    getCirculationCorners,
    pointInCirculation,
    findAdjacentSupportZ,
    computeCirculationProfile,
    computeCirculationEarthwork,
    sliceCirculationWithPlane,
    computeRainwaterAnalysis
  };
})();
