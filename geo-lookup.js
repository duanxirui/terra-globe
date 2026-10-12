// Convert TopoJSON to regular lon/lat polygons, keeping the source coordinates
// intact for rendering. Country and province hit testing share this geometry.
export function decodeAtlas(topology) {
  const { scale, translate } = topology.transform;
  const cache = new Array(topology.arcs.length);
  const usage = new Uint16Array(topology.arcs.length);

  const arc = (index) => {
    const actual = index < 0 ? ~index : index;
    if (!cache[actual]) {
      let x = 0, y = 0;
      cache[actual] = topology.arcs[actual].map(([dx, dy]) => {
        x += dx; y += dy;
        return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
      });
    }
    return index < 0 ? cache[actual].slice().reverse() : cache[actual];
  };

  const stitch = (indices) => {
    const result = [];
    indices.forEach((index, number) => {
      const points = arc(index);
      result.push(...(number === 0 ? points : points.slice(1)));
    });
    return result;
  };

  const visitIndices = (value, fn) => {
    if (typeof value === 'number') fn(value);
    else if (Array.isArray(value)) value.forEach((child) => visitIndices(child, fn));
  };

  const countries = topology.objects.countries.geometries
    .filter((geometry) => geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')
    .map((geometry) => {
      visitIndices(geometry.arcs, (index) => usage[index < 0 ? ~index : index]++);
      const polygonArcs = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
      return {
        id: String(geometry.id ?? ''),
        englishName: geometry.properties?.name || 'Unknown region',
        polygons: polygonArcs.map((rings) => rings.map(stitch)),
      };
    });

  return { countries, arcs: cache, usage, getArc: arc };
}

// A point on Earth has infinitely many equivalent longitude representations
// (e.g. -179° and 181°). Keep adjacent polygon vertices in a *continuous*
// longitude range before ray casting. Shifting each vertex independently near
// the query longitude creates giant false edges: Mexico then overlaps India.
// Cache the unwrapped shape since picking runs on every pointer movement.
const unwrappedRings = new WeakMap();

function prepareRing(ring) {
  const existing = unwrappedRings.get(ring);
  if (existing) return existing;

  const xs = new Float64Array(ring.length);
  let x = ring[0][0];
  let west = x, east = x, south = Infinity, north = -Infinity;
  xs[0] = x;

  for (let i = 0; i < ring.length; i++) {
    if (i > 0) {
      let delta = ring[i][0] - ring[i - 1][0];
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      x += delta;
      xs[i] = x;
      west = Math.min(west, x);
      east = Math.max(east, x);
    }
    south = Math.min(south, ring[i][1]);
    north = Math.max(north, ring[i][1]);
  }

  const prepared = { xs, west, east, south, north, middle: (west + east) / 2 };
  unwrappedRings.set(ring, prepared);
  return prepared;
}

export function pointInRing(lon, lat, ring) {
  if (!ring || ring.length < 3) return false;
  const prepared = prepareRing(ring);
  if (lat < prepared.south || lat > prepared.north) return false;

  // Move the *query*, never individual vertices, to the longitude band in
  // which this complete ring was unwrapped. No artificial 360° polygon edges.
  const x = lon + 360 * Math.round((prepared.middle - lon) / 360);
  if (x < prepared.west || x > prepared.east) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ay = ring[i][1], by = ring[j][1];
    if ((ay > lat) !== (by > lat)
      && x < (prepared.xs[j] - prepared.xs[i]) * (lat - ay) / (by - ay) + prepared.xs[i]) {
      inside = !inside;
    }
  }
  return inside;
}

export function countryAt(countries, lon, lat) {
  let result = null;
  let smallestArea = Infinity;
  for (const country of countries) {
    for (const polygon of country.polygons) {
      if (pointInRing(lon, lat, polygon[0])
        && !polygon.slice(1).some((hole) => pointInRing(lon, lat, hole))) {
        // At 1:50m scale a tiny country may overlap the simplified polygon of
        // its neighbour. Prefer the smaller containing polygon (e.g. Vatican).
        const area = ringArea(polygon[0]);
        if (area < smallestArea) { smallestArea = area; result = country; }
      }
    }
  }
  return result;
}

const cachedAreas = new WeakMap();
function ringArea(ring) {
  if (cachedAreas.has(ring)) return cachedAreas.get(ring);
  const { xs } = prepareRing(ring);
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += xs[j] * ring[i][1] - xs[i] * ring[j][1];
  }
  area = Math.abs(area) / 2;
  cachedAreas.set(ring, area);
  return area;
}

function insidePolygon(polygon, lon, lat) {
  return Boolean(polygon[0]?.length > 2 && pointInRing(lon, lat, polygon[0])
    && !polygon.slice(1).some((hole) => pointInRing(lon, lat, hole)));
}

// Find a label point that really lies in its own country/province. Source label
// anchors can be in a bay, between islands, or outside a simplified outline.
// Used only while preparing data, never on each animation frame.
export function findInteriorPoint(polygons, preferredLon, preferredLat) {
  if (polygons.some(polygon => insidePolygon(polygon, preferredLon, preferredLat))) {
    return [preferredLon, preferredLat];
  }
  const toLon = x => ((x + 180) % 360 + 360) % 360 - 180;
  const degrees = Math.PI / 180;
  let best = null;
  let bestScore = Infinity;
  const tryPoint = (polygon, x, lat) => {
    const lon = toLon(x);
    if (!insidePolygon(polygon, lon, lat)) return;
    const a = Math.sin(lat * degrees) * Math.sin(preferredLat * degrees)
      + Math.cos(lat * degrees) * Math.cos(preferredLat * degrees)
      * Math.cos((lon - preferredLon) * degrees);
    const score = 1 - Math.max(-1, Math.min(1, a));
    if (score < bestScore) { bestScore = score; best = [lon, lat]; }
  };

  for (const polygon of polygons) {
    const ring = polygon[0];
    if (!ring || ring.length < 4) continue;
    const { xs, west, east, south, north, middle } = prepareRing(ring);
    const width = east - west, height = north - south;
    if (width <= 0 || height <= 0) continue;
    const prefX = preferredLon + 360 * Math.round((middle - preferredLon) / 360);
    const bound = (value, min, max) => Math.max(min, Math.min(max, value));
    tryPoint(polygon, bound(prefX, west, east), bound(preferredLat, south, north));

    // Polygon centroid and uniformly spaced interior candidates work well for
    // landmasses; the edge samples help with narrow coastal provinces.
    let crossSum = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = xs[j] * ring[i][1] - xs[i] * ring[j][1];
      crossSum += cross;
      cx += (xs[j] + xs[i]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
    cx = Math.abs(crossSum) > 1e-10 ? cx / (3 * crossSum) : middle;
    cy = Math.abs(crossSum) > 1e-10 ? cy / (3 * crossSum) : (south + north) / 2;
    tryPoint(polygon, cx, cy);
    tryPoint(polygon, middle, (south + north) / 2);

    for (let row = 0; row < 19; row++) {
      for (let col = 0; col < 19; col++) {
        tryPoint(polygon, west + width * (col + .5) / 19, south + height * (row + .5) / 19);
      }
    }
    const stride = Math.max(1, Math.floor((ring.length - 1) / 400));
    for (let i = 0; i + 1 < ring.length; i += stride) {
      const midX = (xs[i] + xs[i + 1]) / 2;
      const midY = (ring[i][1] + ring[i + 1][1]) / 2;
      for (const factor of [.025, .1, .3]) {
        tryPoint(polygon, midX + (cx - midX) * factor, midY + (cy - midY) * factor);
      }
    }
  }
  // Very small administrative polygons can be only a few metres wide after
  // simplification. Rounding to 5 decimals can move the label back outside.
  return best?.map(value => Number(value.toFixed(10))) || null;
}

export function prepareRegionLookup(regions) {
  for (const region of regions) {
    region.bounds = region.polygons.map((polygon) => {
      const outer = polygon[0] || [];
      // A Fiji / Aleutian polygon can cross ±180°. Reuse the continuous
      // longitude band from pointInRing instead of rejecting valid seam hits.
      return outer.length >= 3 ? prepareRing(outer) : null;
    });
  }
}

export function regionAt(regions, lon, lat) {
  let best = null;
  let smallestArea = Infinity;
  for (const region of regions) {
    for (let index = 0; index < region.polygons.length; index++) {
      const bounds = region.bounds[index];
      if (!bounds || lat < bounds.south || lat > bounds.north) continue;
      const shiftedLongitude = lon + 360 * Math.round((bounds.middle - lon) / 360);
      if (shiftedLongitude < bounds.west || shiftedLongitude > bounds.east) continue;
      const polygon = region.polygons[index];
      if (pointInRing(lon, lat, polygon[0])
        && !polygon.slice(1).some((hole) => pointInRing(lon, lat, hole))) {
        const area = ringArea(polygon[0]);
        if (area < smallestArea) { smallestArea = area; best = region; }
      }
    }
  }
  return best;
}

// Two datasets have different coastline/border resolutions. A handful of
// verified enclave/tiny border districts are swallowed by the 1:50m atlas.
// Resolve those using the region's known parent, but reject other unexpected
// cross-country admin hits rather than assigning an arbitrary foreign region.
const SMALL_BORDER_ENCLAVES = new Set(['ES-CE', 'ES-ML', 'SM-02', 'SI-161', 'SI-195', 'SI-143']);
export function reconcileAdministrativeHit(country, administrative, parentByIso) {
  const expectedParent = administrative && parentByIso.get(administrative.country);
  if (!administrative || !country || !expectedParent || expectedParent === country) {
    return { country, administrative };
  }
  if (SMALL_BORDER_ENCLAVES.has(administrative.code)) {
    return { country: expectedParent, administrative };
  }
  return { country, administrative: null };
}
