// Surface texture composition shared by the main thread and the texture worker.
//
// Both the main-thread fallback and the worker call `composeEarthSurface` with
// their own canvas factory, so the land mask, per-pixel shading and coastal
// stroke are produced by exactly the same code and parameters on either path.

export const EARTH_TEXTURE_WIDTH = 1536;
export const EARTH_TEXTURE_HEIGHT = 768;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function traceRing(ctx, ring, width, height, offset = 0) {
  if (ring.length < 3) return;
  let previousLon = ring[0][0];
  let unwrappedLon = previousLon;
  ctx.moveTo((unwrappedLon + 180) / 360 * width + offset * width, (90 - ring[0][1]) / 180 * height);
  for (let i = 1; i < ring.length; i++) {
    let delta = ring[i][0] - previousLon;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    unwrappedLon += delta;
    ctx.lineTo((unwrappedLon + 180) / 360 * width + offset * width, (90 - ring[i][1]) / 180 * height);
    previousLon = ring[i][0];
  }
  ctx.closePath();
}

// `createCanvas(width, height)` must return an HTMLCanvasElement or an
// OffscreenCanvas. `countries` only needs a `polygons` array on each entry.
export function composeEarthSurface(createCanvas, countries) {
  const width = EARTH_TEXTURE_WIDTH, height = EARTH_TEXTURE_HEIGHT;
  const mask = createCanvas(width, height).getContext('2d', { willReadFrequently: true });
  mask.fillStyle = 'white';
  for (const country of countries) {
    for (const polygon of country.polygons) {
      for (const offset of [-1, 0, 1]) {
        mask.beginPath();
        polygon.forEach((ring) => traceRing(mask, ring, width, height, offset));
        mask.fill('evenodd');
      }
    }
  }
  const coverage = mask.getImageData(0, 0, width, height).data;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    const latitude = 90 - 180 * y / height;
    const polar = Math.abs(latitude) / 90;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const wave = Math.sin(x * .017 + Math.sin(y * .022) * 3) * Math.cos(y * .031 - x * .007);
      const fine = Math.sin(x * .115 + y * .081) * Math.sin(y * .097 - x * .047);
      const relief = wave * 5.2 + fine * 2.6;
      const snow = clamp((polar - .72) * 2.9, 0, 1);

      if (coverage[i + 3] > 100) {
        const arid = clamp((Math.abs(latitude) - 12) / 21, 0, 1) * clamp((48 - Math.abs(latitude)) / 17, 0, 1);
        pixels.data[i] = 29 + arid * 34 + snow * 148 + relief * 1.6;
        pixels.data[i + 1] = 84 + arid * 20 + snow * 123 + relief * 2.3;
        pixels.data[i + 2] = 78 - arid * 7 + snow * 119 + relief * 1.8;
      } else {
        pixels.data[i] = 7 + snow * 33 + relief * .45;
        pixels.data[i + 1] = 33 + snow * 46 + relief * 1.5;
        pixels.data[i + 2] = 57 + snow * 53 + relief * 2.3;
      }
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);

  // A second coastal stroke subtly separates land from shallow water.
  ctx.save();
  ctx.lineWidth = .7;
  ctx.strokeStyle = 'rgba(120, 214, 180, .34)';
  for (const country of countries) {
    for (const polygon of country.polygons) {
      for (const offset of [-1, 0, 1]) {
        ctx.beginPath();
        polygon.forEach((ring) => traceRing(ctx, ring, width, height, offset));
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  return canvas;
}
