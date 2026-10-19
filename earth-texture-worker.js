// Renders the earth surface texture off the main thread.
//
// It reuses the exact surface algorithm from earth-texture.js and returns an
// ImageBitmap, so the main thread only has to wrap it in a THREE texture.
import { EARTH_TEXTURE_HEIGHT, EARTH_TEXTURE_WIDTH, composeEarthSurface } from './earth-texture.js';

self.onmessage = (event) => {
  const { countries } = event.data;
  try {
    const surface = composeEarthSurface((width, height) => new OffscreenCanvas(width, height), countries);
    // WebGL ignores UNPACK_FLIP_Y_WEBGL for ImageBitmap sources, so bake the
    // vertical flip here and let the main thread upload with flipY = false.
    const flipped = new OffscreenCanvas(EARTH_TEXTURE_WIDTH, EARTH_TEXTURE_HEIGHT);
    const context = flipped.getContext('2d');
    context.translate(0, EARTH_TEXTURE_HEIGHT);
    context.scale(1, -1);
    context.drawImage(surface, 0, 0);
    const bitmap = flipped.transferToImageBitmap();
    self.postMessage({ bitmap }, [bitmap]);
  } catch (error) {
    self.postMessage({ error: error && error.message ? error.message : String(error) });
  }
};
