import { createMapLabels } from './map-labels.js';
import { decodeAtlas, countryAt, prepareRegionLookup, regionAt, pointInRing, findInteriorPoint, reconcileAdministrativeHit } from './geo-lookup.js';
import { MAP_ZOOM, detailLevel, placeName } from './place-names.js';
import { composeEarthSurface } from './earth-texture.js';

// A dependency-free static website. Three.js and world borders are bundled locally,
// with public CDNs as optional fallback sources.
const THREE_SOURCES = [
  './assets/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js',
  'https://unpkg.com/three@0.165.0/build/three.module.js',
];
const ATLAS_SOURCES = [
  './assets/countries-50m.json',
  './assets/countries-110m.json',
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
];

const $ = (id) => document.getElementById(id);
const stage = $('globeStage');
const canvas = $('globeCanvas');
const labelsCanvas = $('labelsCanvas');
const loader = $('globeLoader');
const rad = Math.PI / 180;
const RADIUS = 2.13;
const MIN_DISTANCE = 2.75;
const MAX_DISTANCE = 10.5;
const DEFAULT_VIEW = { longitude: 103, latitude: 22, distance: 7.5 };

const UI = {
  zh: {
    heroFirst: '在指尖', heroSecond: '漫游地球',
    heroDescription: '从浩瀚宇宙，遇见熟悉的蓝色星球。探索世界各国和省州级行政区划。',
    explore: '开始探索', reset: '重置视角', countriesCount: '国家 / 地区', freeExplore: '自由探索',
    immersive: '沉浸视角', exploring: '正在探索', searchHint: '国家 / 地区和省州级两级；部分区划仅有位置参考或近似边界',
    currentLevel: '当前层级', labels: '地名标注', mapView: '地图视图',
    oceans: '海洋', countries: '国家', provinces: '省州',
    borders: '国界', grid: '经纬网', rotate: '自动旋转', language: '显示语言',
    dragHint: '拖动旋转', zoomHint: '滚轮缩放', clickHint: '点击查看国家或省州',
    levelCountry: '国家', levelProvince: '省州',
    searchPlaceholder: '搜索国家 / 省州', searchEmpty: '没有匹配的国家或省州',
    wholeWorld: '整个世界', selectPrompt: '点击地球，选择国家或地区',
    currentLocation: '当前位置', latitude: '纬度', longitude: '经度', tooltipRegion: '区域',
  },
  en: {
    heroFirst: 'Discover', heroSecond: 'Earth',
    heroDescription: 'Explore the blue planet: countries and their first-level administrative divisions.',
    explore: 'Explore', reset: 'Reset view', countriesCount: 'Countries / Areas', freeExplore: '360° Explorer',
    immersive: '3D Globe', exploring: 'Exploring', searchHint: 'Countries / first-level divisions only; some boundaries are approximate or unavailable',
    currentLevel: 'Map layer', labels: 'Names', mapView: 'Map view',
    oceans: 'Oceans', countries: 'Countries', provinces: 'Provinces',
    borders: 'Borders', grid: 'Grid', rotate: 'Auto rotate', language: 'Language',
    dragHint: 'Drag to rotate', zoomHint: 'Scroll to zoom', clickHint: 'Click countries or provinces',
    levelCountry: 'Countries', levelProvince: 'Provinces',
    searchPlaceholder: 'Search countries / provinces', searchEmpty: 'No matching country or province',
    wholeWorld: 'The whole world', selectPrompt: 'Click the globe to explore a place',
    currentLocation: 'Current location', latitude: 'Latitude', longitude: 'Longitude', tooltipRegion: 'Region',
  },
};
const translate = (language, key) => UI[language][key] || key;

async function loadThree() {
  let lastError;
  for (const source of THREE_SOURCES) {
    try { return await import(source); }
    catch (error) { lastError = error; }
  }
  throw new Error(`Three.js 加载失败：${lastError?.message || '网络不可用'}`);
}

async function loadAtlas() {
  let lastError;
  for (const source of ATLAS_SOURCES) {
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const atlas = await response.json();
      if (atlas.type !== 'Topology' || !atlas.objects?.countries) throw new Error('地图格式不正确');
      return atlas;
    } catch (error) { lastError = error; }
  }
  throw new Error(`国家边界数据不可用：${lastError?.message || '网络不可用'}`);
}

async function loadNamesAndRegions() {
  const response = await fetch('./assets/map-labels-admin1-current.json');
  if (!response.ok) throw new Error(`省州区划数据加载失败：HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.countries) || !Array.isArray(data.regions)) throw new Error('地名与行政区划数据格式错误');
  // The offline build already excludes historical counties and districts and
  // applies modern province names. Never load the mixed source in the UI.
  for (const region of data.regions) {
    region.regionClass = 'administrative';
    region.dataWarning = region.dataWarning || '';
  }
  return data;
}

function setLoading(title, detail, failed = false) {
  $('loaderTitle').textContent = title;
  $('loaderDetail').textContent = detail;
  if (failed) loader.querySelector('.loader-ring').style.animationPlayState = 'paused';
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function normalizeLongitude(value) { return ((value + 180) % 360 + 360) % 360 - 180; }
function formatLatitude(value) { return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? 'N' : 'S'}`; }
function formatLongitude(value) { return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? 'E' : 'W'}`; }

function countryName(country, language = 'zh') { return placeName(country, language, 'country'); }

let chineseRegionNames = null;
try { chineseRegionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' }); }
catch { /* use the map's original label when locale data is unavailable */ }
let englishRegionNames = null;
try { englishRegionNames = new Intl.DisplayNames(['en'], { type: 'region' }); }
catch { /* source data provides a readable fallback */ }

function administrativeParentName(region, fallbackCountry = null, language = 'zh') {
  if (!region) return countryName(fallbackCountry, language);
  if (region.country === 'TW') return language === 'en' ? 'Taiwan, China' : '中国台湾';
  if (region.country === 'HK') return language === 'en' ? 'Hong Kong, China' : '中国香港';
  if (region.country === 'MO') return language === 'en' ? 'Macao, China' : '中国澳门';
  const code = region.country;
  const regionNames = language === 'en' ? englishRegionNames : chineseRegionNames;
  if (regionNames && /^[A-Z]{2}$/.test(code || '')) {
    const localized = regionNames.of(code);
    if (localized && localized !== code) return localized;
  }
  return region.countryName || countryName(fallbackCountry, language);
}

function administrativeDescription(region, country = null, language = 'zh') {
  const parentName = administrativeParentName(region, country, language);
  if (region.pointOnly) return language === 'en'
    ? `${parentName} · Province/state (reference point only; current boundaries unavailable)`
    : `${parentName} · 省州级行政区（仅参考位置，暂无可靠新边界）`;
  if (language === 'en') {
    if (region.dataWarning) return `${parentName} · ${region.dataWarning}`;
    if (region.boundaryNote) return `${parentName} · ${region.boundaryIncomplete
      ? 'Boundary incomplete (historic source polygons missing)' : 'Merged former province polygons (approximate boundary)'}`;
    if (region.labelVerified === false) return `${parentName} · Approximate location (simplified border)`;
    return `${parentName} · Province / state or equivalent division`;
  }
  if (region.dataWarning) return `${parentName} · ${region.dataWarning}`;
  if (region.boundaryNote) return `${parentName} · ${region.boundaryNote}`;
  if (region.labelVerified === false) return `${parentName} · 位置参考（边界精度不足）`;
  return `${parentName} · 省、州或同等级行政区`;
}

function createCountryParentLookup(countries, regions) {
  const votes = new Map();
  for (const region of regions) {
    if (!/^[A-Z]{2}$/.test(region.country || '') || region.labelVerified === false) continue;
    const found = countryAt(countries, region.lon, region.lat);
    if (!found) continue;
    if (!votes.has(region.country)) votes.set(region.country, new Map());
    const group = votes.get(region.country);
    group.set(found, (group.get(found) || 0) + 1);
  }
  const lookup = new Map();
  for (const [iso2, group] of votes) {
    const sorted = [...group.entries()].sort((a, b) => b[1] - a[1]);
    const count = sorted.reduce((sum, [, value]) => sum + value, 0);
    if (sorted[0] && count >= 2 && sorted[0][1] / count >= .65) lookup.set(iso2, sorted[0][0]);
  }
  // A matching source country name is stronger evidence than a majority of
  // points, especially for enclaves or tiny islands absent from the atlas.
  for (const region of regions) {
    if (!/^[A-Z]{2}$/.test(region.country || '')) continue;
    const exact = countries.find(country => country.englishName.toLowerCase() === region.countryName?.toLowerCase());
    if (exact) lookup.set(region.country, exact);
  }
  return lookup;
}

function containsCoordinates(polygons, lon, lat) {
  return polygons.some(polygon => polygon[0]?.length >= 4
    && pointInRing(lon, lat, polygon[0])
    && !polygon.slice(1).some(hole => pointInRing(lon, lat, hole)));
}

function verifyLabelAnchors(atlasCountries, data) {
  const byCode = new Map(atlasCountries.map(country => [country.id.padStart(3, '0'), country]));
  const byName = new Map(atlasCountries.map(country => [country.englishName.toLowerCase(), country]));
  for (const label of data.countries) {
    const expected = byCode.get(label.code) || byName.get(label.english.toLowerCase());
    if (!expected) { label.labelVerified = false; continue; }
    if (!containsCoordinates(expected.polygons, label.lon, label.lat)) {
      const point = findInteriorPoint(expected.polygons, label.lon, label.lat);
      if (point && containsCoordinates(expected.polygons, ...point)) [label.lon, label.lat] = point;
    }
    label.labelVerified = containsCoordinates(expected.polygons, label.lon, label.lat);
  }
  for (const region of data.regions) {
    // A deliberately point-only reference label has no polygon to validate.
    // Keep its geographical marker visible without pretending it has borders.
    if (region.pointOnly) {
      region.labelVerified = Number.isFinite(region.lon) && Number.isFinite(region.lat)
        && Math.abs(region.lon) <= 180 && Math.abs(region.lat) <= 90;
      continue;
    }
    // The bundled asset already records failed geometry repair attempts; avoid
    // repeating expensive grid sampling for these tiny regions on every load.
    if (region.labelVerified === false) continue;
    if (!region.polygons?.length) { region.labelVerified = false; continue; }
    if (!containsCoordinates(region.polygons, region.lon, region.lat)) {
      const point = findInteriorPoint(region.polygons, region.lon, region.lat);
      if (point && containsCoordinates(region.polygons, ...point)) [region.lon, region.lat] = point;
    }
    region.labelVerified = containsCoordinates(region.polygons, region.lon, region.lat);
  }
}

function enrichCountryNames(atlasCountries, names) {
  const byCode = new Map(names.filter((item) => item.code !== '-99').map((item) => [item.code, item]));
  const byEnglish = new Map(names.map((item) => [item.english.toLowerCase(), item]));
  for (const country of atlasCountries) {
    const info = byCode.get(country.id.padStart(3, '0')) || byEnglish.get(country.englishName.toLowerCase());
    country.displayName = info?.name || country.englishName;
  }
}

// The per-pixel composition is CPU heavy, so it runs in a worker when the
// browser supports OffscreenCanvas. Otherwise the same algorithm runs inline.
function supportsOffscreenWorker() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
    && typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
}

function renderEarthTextureInWorker(countries) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker('./earth-texture-worker.js', { type: 'module' }); }
    catch (error) { reject(error); return; }
    worker.addEventListener('message', (event) => {
      worker.terminate();
      if (event.data?.error) reject(new Error(event.data.error));
      else resolve(event.data.bitmap);
    });
    worker.addEventListener('error', (event) => {
      worker.terminate();
      reject(new Error(event.message || '纹理生成的 Worker 初始化失败'));
    });
    worker.postMessage({ countries: countries.map((country) => ({ polygons: country.polygons })) });
  });
}

function earthTextureFromSource(THREE, renderer, source, flipY = true) {
  const texture = new THREE.Texture(source);
  texture.flipY = flipY;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

function makeEarthTextureOnMainThread(THREE, countries, renderer) {
  const canvas = composeEarthSurface((width, height) => {
    const element = document.createElement('canvas');
    element.width = width; element.height = height;
    return element;
  }, countries);
  return earthTextureFromSource(THREE, renderer, canvas);
}

async function makeEarthTexture(THREE, countries, renderer) {
  if (supportsOffscreenWorker()) {
    try {
      const bitmap = await renderEarthTextureInWorker(countries);
      // The worker bakes the vertical flip, so this texture uploads unflipped.
      return earthTextureFromSource(THREE, renderer, bitmap, false);
    } catch { /* fall through to the inline path */ }
  }
  return makeEarthTextureOnMainThread(THREE, countries, renderer);
}

function makeCloudTexture(THREE) {
  const cvs = document.createElement('canvas');
  cvs.width = 1024; cvs.height = 512;
  const ctx = cvs.getContext('2d');
  // Repeatable cloud clusters with elongated, translucent strokes.
  let seed = 713;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 350; i++) {
    const x = random() * cvs.width, y = random() * cvs.height;
    const size = 12 + random() * 47;
    const fade = .025 + random() * .05;
    ctx.fillStyle = `rgba(222, 250, 245, ${fade})`;
    ctx.beginPath();
    ctx.ellipse(x, y, size * (1.5 + random()), size * .23, random() * .4 - .2, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(cvs);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function positionOnSphere(lon, lat, radius = RADIUS) {
  const lonRad = lon * rad, latRad = lat * rad;
  const horizontal = Math.cos(latRad) * radius;
  return [horizontal * Math.cos(lonRad), Math.sin(latRad) * radius, -horizontal * Math.sin(lonRad)];
}

function appendArcSegments(target, points, radius) {
  for (let i = 1; i < points.length; i++) {
    let [aLon, aLat] = points[i - 1];
    let [bLon, bLat] = points[i];
    if (bLon - aLon > 180) bLon -= 360;
    else if (bLon - aLon < -180) bLon += 360;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bLon - aLon), Math.abs(bLat - aLat)) / 2.8));
    let previous = positionOnSphere(aLon, aLat, radius);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const next = positionOnSphere(aLon + (bLon - aLon) * t, aLat + (bLat - aLat) * t, radius);
      target.push(...previous, ...next);
      previous = next;
    }
  }
}

function makeLineSegments(THREE, positions, color, opacity) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  return new THREE.LineSegments(geometry, material);
}

function buildBorders(THREE, atlas) {
  const coast = [], political = [];
  for (let i = 0; i < atlas.usage.length; i++) {
    if (!atlas.usage[i]) continue;
    appendArcSegments(atlas.usage[i] > 1 ? political : coast, atlas.getArc(i), RADIUS + .012);
  }
  const group = new THREE.Group();
  group.add(makeLineSegments(THREE, coast, 0x5de4c2, .52));
  group.add(makeLineSegments(THREE, political, 0x8cf0d5, .69));
  return group;
}

function buildAdminBorders(THREE, regions) {
  const segments = [];
  for (const region of regions) {
    if (region.outlineSegments) {
      for (const pair of region.outlineSegments) appendArcSegments(segments, pair, RADIUS + .024);
    } else {
      for (const polygon of region.polygons) {
        for (const ring of polygon) appendArcSegments(segments, ring, RADIUS + .024);
      }
    }
  }
  return makeLineSegments(THREE, segments, 0x87cdd3, .25);
}

function buildGrid(THREE) {
  const result = [];
  const gridRadius = RADIUS + .016;
  for (let lat = -75; lat <= 75; lat += 15) {
    for (let lon = -180; lon < 180; lon += 3) {
      result.push(...positionOnSphere(lon, lat, gridRadius), ...positionOnSphere(lon + 3, lat, gridRadius));
    }
  }
  for (let lon = -180; lon < 180; lon += 15) {
    for (let lat = -90; lat < 90; lat += 3) {
      result.push(...positionOnSphere(lon, lat, gridRadius), ...positionOnSphere(lon, lat + 3, gridRadius));
    }
  }
  return makeLineSegments(THREE, result, 0x79cdd9, .15);
}

function makeStars(THREE) {
  let seed = 4271;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const positions = [];
  for (let i = 0; i < 1400; i++) {
    const theta = random() * Math.PI * 2;
    const z = random() * 2 - 1;
    const distance = 11 + random() * 29;
    const xy = Math.sqrt(1 - z * z);
    positions.push(distance * xy * Math.cos(theta), distance * z, distance * xy * Math.sin(theta));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xb7dce7, size: .021, transparent: true, opacity: .62, sizeAttenuation: true, depthWrite: false }));
}

function makeAtmosphere(THREE) {
  const shader = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vEye;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vEye = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vEye;
      void main() {
        float edge = 1.0 - abs(dot(normalize(vNormal), normalize(vEye)));
        float intensity = pow(edge, 3.2);
        gl_FragColor = vec4(0.16, 0.70, 0.90, intensity * 0.64);
      }
    `,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.12, 96, 64), shader);
}

function setToggle(button, active) {
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-pressed', String(active));
}

async function start() {
  setLoading('正在连接 3D 引擎', 'INITIALIZING WEBGL...');
  const THREE = await loadThree();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.38;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 120);
  camera.position.z = DEFAULT_VIEW.distance;
  const globe = new THREE.Group();
  globe.rotation.order = 'XYZ';
  scene.add(globe);
  const mapLabels = createMapLabels({ THREE, canvas: labelsCanvas, stage, camera, globe, radius: RADIUS, positionOnSphere });
  scene.add(makeStars(THREE));
  scene.add(makeAtmosphere(THREE));
  scene.add(new THREE.AmbientLight(0x80b3c8, 1.25));
  const sunlight = new THREE.DirectionalLight(0xe4ffff, 3.0);
  sunlight.position.set(6, 3, 8);
  scene.add(sunlight);
  const rimLight = new THREE.DirectionalLight(0x227fba, .9);
  rimLight.position.set(-5, -2, -6);
  scene.add(rimLight);

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 96, 64),
    new THREE.MeshPhongMaterial({ color: 0xb4f2e8, specular: 0x274f5d, shininess: 19, emissive: 0x071725, emissiveIntensity: .47 }),
  );
  globe.add(earth);
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS + .008, 64, 48),
    new THREE.MeshBasicMaterial({ map: makeCloudTexture(THREE), transparent: true, opacity: .4, depthWrite: false }),
  );
  globe.add(clouds);

  const borders = new THREE.Group();
  globe.add(borders);
  const adminBorders = new THREE.Group();
  globe.add(adminBorders);
  const grid = buildGrid(THREE);
  grid.visible = false;
  globe.add(grid);
  const selectionLine = makeLineSegments(THREE, [], 0xb3ffdb, .98);
  globe.add(selectionLine);
  const hoverLine = makeLineSegments(THREE, [], 0xa3fff2, .55);
  globe.add(hoverLine);
  const adminSelectionLine = makeLineSegments(THREE, [], 0xe3ff9d, .95);
  globe.add(adminSelectionLine);

  const state = {
    yaw: -(DEFAULT_VIEW.longitude + 90) * rad,
    pitch: DEFAULT_VIEW.latitude * rad,
    targetYaw: -(DEFAULT_VIEW.longitude + 90) * rad,
    targetPitch: DEFAULT_VIEW.latitude * rad,
    distance: DEFAULT_VIEW.distance,
    targetDistance: DEFAULT_VIEW.distance,
    rotate: true, borderVisible: true, gridVisible: false, adminVisible: true,
    oceanNames: true, countryNames: true, language: 'zh',
    dragging: false, down: null, hover: null, selected: null, selectedRegion: null,
    selection: null, searchChosen: null, refreshSearch: null, lastDetailLevel: null,
    countries: [], regions: [], parentByIso: new Map(), lastHover: 0, atlas: null, ready: false,
  };
  globe.rotation.y = state.yaw;
  globe.rotation.x = state.pitch;

  const mouse = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const tooltip = $('globeTooltip');
  const tooltipName = $('tooltipName');
  const tooltipCoords = $('tooltipCoords');

  function resize() {
    const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    mapLabels.resize();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  resize();

  function borderForCountry(country, line, opacity = 1) {
    line.geometry.dispose();
    const points = [];
    if (country) {
      if (country.outlineSegments) {
        for (const pair of country.outlineSegments) appendArcSegments(points, pair, RADIUS + .028);
      } else {
        for (const polygon of country.polygons) {
          for (const ring of polygon) appendArcSegments(points, ring, RADIUS + .028);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    line.geometry = geometry;
    line.material.opacity = opacity;
  }

  function updateCoordinates(lon, lat) {
    $('latitudeValue').textContent = formatLatitude(lat);
    $('longitudeValue').textContent = formatLongitude(lon);
  }

  function refreshSelectedText() {
    const language = state.language;
    const selection = state.selection;
    if (!selection) {
      $('regionName').textContent = translate(language, 'wholeWorld');
      $('regionDetail').textContent = translate(language, 'selectPrompt');
      return;
    }
    const { country, administrative } = selection;
    if (administrative) {
      $('regionName').textContent = placeName(administrative, language, 'region');
      $('regionDetail').textContent = administrativeDescription(administrative, country, language);
    } else if (country) {
      const name = countryName(country, language);
      const kind = country.id === '158' ? (language === 'en' ? 'Area' : '地区') :
        (language === 'en' ? 'Country / area' : '国家 / 地区');
      const approximate = language === 'en' ? 'Approximate location (border unavailable)' : '位置参考（底图无边界）';
      $('regionName').textContent = name;
      $('regionDetail').textContent = `${name} · ${country.approximate ? approximate : kind}`;
    } else {
      $('regionName').textContent = language === 'en' ? 'Ocean' : '海洋';
      $('regionDetail').textContent = language === 'en' ? 'Blue planet · Ocean waters' : '蓝色星球的广阔海域';
    }
  }

  function updateDetailIndicator() {
    const level = detailLevel(state.distance);
    if (level !== state.lastDetailLevel || state.language !== state.lastDetailLanguage) {
      state.lastDetailLevel = level;
      state.lastDetailLanguage = state.language;
      $('detailLevelLabel').textContent = translate(state.language,
        level === 'country' ? 'levelCountry' : 'levelProvince');
    }
  }

  function setLanguage(language) {
    const previousLanguage = state.language;
    state.language = language;
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.title = language === 'en' ? 'TERRA — Explore the 3D Earth' : 'TERRA — 交互式地球探索';
    document.querySelectorAll('[data-ui]').forEach(element => {
      element.textContent = translate(language, element.dataset.ui);
    });
    $('placeSearch').placeholder = translate(language, 'searchPlaceholder');
    $('placeSearch').setAttribute('aria-label', translate(language, 'searchPlaceholder'));
    $('statsRow').setAttribute('aria-label', language === 'en' ? 'Globe exploration statistics' : '地球探索参数');
    stage.setAttribute('aria-label', language === 'en'
      ? '3D globe: rotate, zoom and select countries or provinces'
      : '可以拖拽旋转、滚轮缩放并选择国家或省州的三维地球');
    $('zoomControls').setAttribute('aria-label', language === 'en' ? 'Globe zoom controls' : '地球缩放操作');
    $('controlDock').setAttribute('aria-label', language === 'en' ? 'Globe display settings' : '地球显示设置');
    const buttonLabels = [
      ['fullscreenButton', '切换全屏', 'Toggle fullscreen'],
      ['zoomIn', '放大', 'Zoom in'],
      ['zoomOut', '缩小', 'Zoom out'],
      ['centerButton', '复位视角', 'Reset globe view'],
    ];
    for (const [id, zh, en] of buttonLabels) {
      const label = language === 'en' ? en : zh;
      $(id).setAttribute('aria-label', label);
      $(id).setAttribute('title', label);
    }
    canvas.setAttribute('aria-label', language === 'en'
      ? 'Interactive globe: drag to rotate, scroll to zoom, select countries or provinces'
      : '互动地球：拖拽旋转，滚轮缩放，点击国家或省州');
    for (const [code, buttonId] of [['zh', 'langZh'], ['en', 'langEn']]) {
      const button = $(buttonId);
      button.classList.toggle('is-active', code === language);
      button.setAttribute('aria-pressed', String(code === language));
    }
    if (state.searchChosen) {
      const selected = state.searchChosen;
      const input = $('placeSearch');
      if (input.value === placeName(selected, previousLanguage, selected.kind)) {
        input.value = placeName(selected, language, selected.kind);
      }
    }
    state.refreshSearch?.();
    refreshSelectedText();
    updateDetailIndicator();
    tooltip.hidden = true;
  }

  function selectRegion(country, lon, lat, administrative = null) {
    state.selected = country;
    state.selectedRegion = administrative;
    state.selection = { country, administrative, lon, lat };
    refreshSelectedText();
    updateCoordinates(lon, lat);
    borderForCountry(country, selectionLine);
    borderForCountry(administrative, adminSelectionLine);
  }

  function pick(clientX, clientY) {
    if (!state.ready) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    mouse.set(x * 2 - 1, 1 - y * 2);
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObject(earth, false)[0];
    if (!hit) return null;
    const local = earth.worldToLocal(hit.point.clone()).normalize();
    const lat = Math.asin(clamp(local.y, -1, 1)) / rad;
    const lon = normalizeLongitude(Math.atan2(-local.z, local.x) / rad);
    const hitX = clientX - rect.left, hitY = clientY - rect.top;
    const regionLabel = state.adminVisible && state.distance <= MAP_ZOOM.provinces
      ? mapLabels.regionLabelAt(hitX, hitY) : null;
    const placeLon = regionLabel?.lon ?? lon;
    const placeLat = regionLabel?.lat ?? lat;
    const foundCountry = (regionLabel && state.parentByIso.get(regionLabel.country))
      || countryAt(state.countries, placeLon, placeLat);
    const foundRegion = regionLabel || (state.adminVisible && state.distance <= MAP_ZOOM.provinces
      ? regionAt(state.regions, placeLon, placeLat) : null);
    const { country, administrative } = reconcileAdministrativeHit(foundCountry, foundRegion, state.parentByIso);
    return { lon: placeLon, lat: placeLat, country, administrative,
      x: hitX, y: hitY };
  }

  function showHover(event) {
    if (state.dragging || !state.ready) return;
    const current = performance.now();
    if (current - state.lastHover < 55) return;
    state.lastHover = current;
    const hit = pick(event.clientX, event.clientY);
    if (!hit) {
      tooltip.hidden = true;
      if (state.hover) { state.hover = null; borderForCountry(null, hoverLine); }
      return;
    }
    const language = state.language;
    tooltipName.textContent = hit.administrative
      ? `${placeName(hit.administrative, language)} · ${administrativeParentName(hit.administrative, hit.country, language)}${hit.administrative.dataWarning
          ? (language === 'en' ? ' (historical)' : '（旧版区划）') : ''}`
      : countryName(hit.country, language);
    tooltipCoords.textContent = `${formatLatitude(hit.lat)}  /  ${formatLongitude(hit.lon)}`;
    tooltip.style.left = `${clamp(hit.x, 10, stage.clientWidth - 185)}px`;
    tooltip.style.top = `${clamp(hit.y, 66, stage.clientHeight - 62)}px`;
    tooltip.hidden = false;
    if (state.hover !== hit.country) {
      state.hover = hit.country;
      borderForCountry(hit.country, hoverLine);
    }
  }

  function flyTo(longitude, latitude, distance = 6.9) {
    const wanted = -(longitude + 90) * rad;
    const turns = Math.round((state.targetYaw - wanted) / (2 * Math.PI));
    state.targetYaw = wanted + turns * Math.PI * 2;
    state.targetPitch = clamp(latitude * rad, -1.47, 1.47);
    state.targetDistance = clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
  }

  function resetView() {
    flyTo(DEFAULT_VIEW.longitude, DEFAULT_VIEW.latitude, DEFAULT_VIEW.distance);
    state.rotate = true;
    setToggle($('rotateToggle'), true);
    state.selected = null;
    state.selectedRegion = null;
    state.selection = null;
    state.searchChosen = null;
    borderForCountry(null, selectionLine);
    borderForCountry(null, adminSelectionLine);
    $('placeSearch').value = '';
    state.closeSearch?.();
    refreshSelectedText();
  }

  function setupPlaceSearch(data) {
    const input = $('placeSearch');
    const list = $('searchResults');
    const container = $('mapSearch');
    const places = [
      ...data.countries.map((item) => ({ ...item, kind: 'country', source: item })),
      ...data.regions.map((item) => ({ ...item, kind: 'region', source: item })),
    ];
    const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
    for (const item of places) {
      item.searchZh = normalize(placeName(item, 'zh', item.kind));
      item.searchEnglish = normalize(placeName(item, 'en', item.kind));
      item.searchNative = normalize(item.native || item.english || '');
      item.searchCode = normalize(item.code || '');
    }
    let matches = [], activeIndex = 0;

    function closeResults() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }

    function choose(item) {
      const country = item.kind === 'country'
        ? state.countries.find(entry => item.code !== '-99' && entry.id.padStart(3, '0') === item.code)
          || state.countries.find(entry => entry.englishName === item.english)
          || countryAt(state.countries, item.lon, item.lat)
          || { id: item.code, englishName: item.english, displayName: item.name, polygons: [], approximate: true }
        : state.parentByIso.get(item.country) || countryAt(state.countries, item.lon, item.lat);
      const administrative = item.kind === 'region' ? item.source : null;
      state.rotate = false;
      setToggle($('rotateToggle'), false);
      flyTo(item.lon, item.lat, administrative ? 5.1 : 7.05);
      selectRegion(country, item.lon, item.lat, administrative);
      input.value = placeName(item, state.language, item.kind);
      state.searchChosen = item;
      closeResults();
      input.blur();
    }

    function updateActive() {
      [...list.querySelectorAll('.search-option')].forEach((button, index) => {
        button.classList.toggle('is-current', index === activeIndex);
        button.setAttribute('aria-selected', String(index === activeIndex));
      });
    }

    function updateResults() {
      const query = normalize(input.value.trim());
      list.replaceChildren();
      if (!query) { closeResults(); return; }
      // Retain the best twelve results while scanning. Sorting every match to
      // a short query such as "a" would stall the UI on a large dataset.
      const best = [];
      function sortBest(a, b) {
        const category = kind => kind === 'country' ? 0 : 1;
        return a.score - b.score || category(a.item.kind) - category(b.item.kind)
          || (a.item.rank || 0) - (b.item.rank || 0);
      }
      for (const item of places) {
        // Avoid allocating arrays and callbacks on every search keystroke.
        const zh = item.searchZh, en = item.searchEnglish;
        const native = item.searchNative, code = item.searchCode;
        const score = zh === query || en === query || native === query || code === query ? 0
          : zh.startsWith(query) || en.startsWith(query) || native.startsWith(query) || code.startsWith(query) ? 1
            : zh.includes(query) || en.includes(query) || native.includes(query) || code.includes(query) ? 2 : 3;
        if (score === 3) continue;
        const found = { item, score };
        if (best.length === 12 && sortBest(found, best[best.length - 1]) >= 0) continue;
        let position = best.findIndex(entry => sortBest(found, entry) < 0);
        if (position === -1) position = best.length;
        best.splice(position, 0, found);
        if (best.length > 12) best.pop();
      }
      matches = best.map(entry => entry.item);
      activeIndex = 0;

      if (matches.length === 0) {
        const message = document.createElement('div');
        message.className = 'search-empty';
        message.textContent = translate(state.language, 'searchEmpty');
        list.append(message);
      }
      for (const [index, item] of matches.entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'search-option';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(index === 0));

        const name = document.createElement('span');
        name.className = 'search-option-label';
        name.textContent = placeName(item, state.language, item.kind);
        const detail = document.createElement('span');
        detail.className = 'search-option-type';
        if (item.kind === 'country') {
          detail.textContent = item.code === '158'
            ? (state.language === 'en' ? 'Area' : '地区')
            : (state.language === 'en' ? 'Country / Area' : '国家 / 地区');
        } else {
          const category = item.pointOnly
            ? (state.language === 'en' ? 'Province / state · location only' : '省州级 · 仅位置参考')
            : item.boundaryIncomplete
              ? (state.language === 'en' ? 'Province / state · incomplete boundary' : '省州级 · 边界不完整')
            : item.dataWarning
            ? (state.language === 'en' ? 'Historical province boundary' : '旧版省州区划')
            : (state.language === 'en' ? 'Province / state' : '省州级行政区');
          detail.textContent = `${administrativeParentName(item, null, state.language)} · ${category}`;
        }
        button.append(name, detail);
        button.addEventListener('click', () => choose(item));
        list.append(button);
      }
      updateActive();
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('input', () => { state.searchChosen = null; updateResults(); });
    input.addEventListener('focus', updateResults);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { closeResults(); input.blur(); return; }
      if (!matches.length || list.hidden) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        updateActive();
        list.querySelectorAll('.search-option')[activeIndex]?.scrollIntoView({ block: 'nearest' });
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        choose(matches[activeIndex]);
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!container.contains(event.target)) closeResults();
    });
    state.refreshSearch = () => { if (!list.hidden) updateResults(); };
    state.closeSearch = closeResults;
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    state.dragging = true;
    state.down = { x: event.clientX, y: event.clientY, moved: false, lastX: event.clientX, lastY: event.clientY };
    tooltip.hidden = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (state.dragging && state.down) {
      const dx = event.clientX - state.down.lastX;
      const dy = event.clientY - state.down.lastY;
      if (Math.abs(event.clientX - state.down.x) + Math.abs(event.clientY - state.down.y) > 5) state.down.moved = true;
      if (state.down.moved) {
        state.targetYaw += dx * .006;
        state.targetPitch = clamp(state.targetPitch + dy * .004, -1.47, 1.47);
      }
      state.down.lastX = event.clientX;
      state.down.lastY = event.clientY;
    } else showHover(event);
  });
  canvas.addEventListener('pointerup', (event) => {
    const clicked = state.down && !state.down.moved;
    state.dragging = false;
    state.down = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (clicked) {
      const hit = pick(event.clientX, event.clientY);
      if (hit) {
        selectRegion(hit.country, hit.lon, hit.lat, hit.administrative);
        state.rotate = false;
        setToggle($('rotateToggle'), false);
      }
    }
    showHover(event);
  });
  canvas.addEventListener('pointercancel', () => { state.dragging = false; state.down = null; tooltip.hidden = true; });
  canvas.addEventListener('pointerleave', () => { tooltip.hidden = true; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.targetDistance = clamp(state.targetDistance + event.deltaY * .006, MIN_DISTANCE, MAX_DISTANCE);
    tooltip.hidden = true;
  }, { passive: false });

  $('zoomIn').addEventListener('click', () => { state.targetDistance = clamp(state.targetDistance - .8, MIN_DISTANCE, MAX_DISTANCE); });
  $('zoomOut').addEventListener('click', () => { state.targetDistance = clamp(state.targetDistance + .8, MIN_DISTANCE, MAX_DISTANCE); });
  $('centerButton').addEventListener('click', resetView);
  $('resetButton').addEventListener('click', resetView);
  $('exploreButton').addEventListener('click', () => {
    const places = [[10, 48], [-73, 39], [138, 36], [21, -4], [102, 27], [-61, -11], [77, 23], [16, 60]];
    const place = places[Math.floor(Math.random() * places.length)];
    flyTo(place[0], place[1], 6.3);
  });
  $('borderToggle').addEventListener('click', () => {
    state.borderVisible = !state.borderVisible;
    borders.visible = state.borderVisible;
    selectionLine.visible = state.borderVisible;
    hoverLine.visible = state.borderVisible;
    setToggle($('borderToggle'), state.borderVisible);
  });
  $('oceanToggle').addEventListener('click', () => {
    state.oceanNames = !state.oceanNames;
    setToggle($('oceanToggle'), state.oceanNames);
  });
  $('countryToggle').addEventListener('click', () => {
    state.countryNames = !state.countryNames;
    setToggle($('countryToggle'), state.countryNames);
  });
  $('adminToggle').addEventListener('click', () => {
    state.adminVisible = !state.adminVisible;
    setToggle($('adminToggle'), state.adminVisible);
    adminSelectionLine.visible = state.adminVisible;
  });
  $('langZh').addEventListener('click', () => setLanguage('zh'));
  $('langEn').addEventListener('click', () => setLanguage('en'));
  $('gridToggle').addEventListener('click', () => {
    state.gridVisible = !state.gridVisible;
    grid.visible = state.gridVisible;
    setToggle($('gridToggle'), state.gridVisible);
  });
  $('rotateToggle').addEventListener('click', () => {
    state.rotate = !state.rotate;
    setToggle($('rotateToggle'), state.rotate);
  });
  $('fullscreenButton').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* browsers can disallow fullscreen in embedded previews */ }
  });

  setLanguage('zh');

  let previousTime = performance.now();
  let lastLabelFrame = 0;
  function render(time) {
    const dt = Math.min((time - previousTime) / 1000, .05);
    previousTime = time;
    if (state.rotate && !state.dragging) state.targetYaw += dt * .035;
    const mix = 1 - Math.exp(-dt * 6.5);
    state.yaw += (state.targetYaw - state.yaw) * mix;
    state.pitch += (state.targetPitch - state.pitch) * mix;
    state.distance += (state.targetDistance - state.distance) * mix;
    globe.rotation.y = state.yaw;
    globe.rotation.x = state.pitch;
    camera.position.z = state.distance;
    adminBorders.visible = state.adminVisible && state.distance <= MAP_ZOOM.provinces;
    if (adminBorders.children[0]) adminBorders.children[0].material.opacity = clamp((MAP_ZOOM.provinces + .5 - state.distance) * .22, .15, .48);
    clouds.rotation.y += dt * .002;
    renderer.render(scene, camera);
    if (time - lastLabelFrame > 65) {
      lastLabelFrame = time;
      updateDetailIndicator();
      mapLabels.draw({ distance: state.distance, language: state.language,
        oceanNames: state.oceanNames, countryNames: state.countryNames,
        regionNames: state.adminVisible,
        selectedCountry: state.selected, selectedRegion: state.selectedRegion });
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  setLoading('正在绘制国家边界', 'BUILDING COUNTRY BORDERS...');
  try {
    const [topology, labelData] = await Promise.all([loadAtlas(), loadNamesAndRegions()]);
    const atlas = decodeAtlas(topology);
    enrichCountryNames(atlas.countries, labelData.countries);
    verifyLabelAnchors(atlas.countries, labelData);
    prepareRegionLookup(labelData.regions);
    state.atlas = atlas;
    state.countries = atlas.countries;
    state.regions = labelData.regions;
    state.parentByIso = createCountryParentLookup(state.countries, state.regions);
    $('countryCount').textContent = String(atlas.countries.length);
    setLoading('正在绘制行政区划', 'BUILDING PROVINCE BORDERS...');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    adminBorders.add(buildAdminBorders(THREE, state.regions));
    setLoading('正在生成地表纹理', 'GENERATING SURFACE TEXTURE...');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    earth.material.map = await makeEarthTexture(THREE, atlas.countries, renderer);
    earth.material.needsUpdate = true;
    borders.add(buildBorders(THREE, atlas));
    mapLabels.setData(labelData);
    setupPlaceSearch(labelData);
    state.ready = true;
    loader.hidden = true;
  } catch (error) {
    console.error(error);
    setLoading('边界数据加载失败', '请检查网络连接并刷新页面', true);
  }
}

start().catch((error) => {
  console.error(error);
  setLoading('3D 地球启动失败', '请使用支持 WebGL 的浏览器，并检查网络', true);
});
