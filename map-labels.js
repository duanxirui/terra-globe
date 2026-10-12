// A 2D text overlay anchored to the visible side of the 3D Earth.
import { detailLevel, placeName } from './place-names.js';

const OCEANS = [
  { name: '太平洋', english: 'PACIFIC OCEAN', anchors: [[-150, 13], [158, 12], [-150, -30], [173, -33]] },
  { name: '大西洋', english: 'ATLANTIC OCEAN', anchors: [[-35, 15], [-35, -29], [-33, 42]] },
  { name: '印度洋', english: 'INDIAN OCEAN', anchors: [[74, -22], [91, -35]] },
  { name: '北冰洋', english: 'ARCTIC OCEAN', anchors: [[30, 82], [-150, 82]] },
  { name: '南大洋', english: 'SOUTHERN OCEAN', anchors: [[15, -67], [105, -68], [-100, -67]] },
];

export function createMapLabels({ THREE, canvas, stage, camera, globe, radius, positionOnSphere }) {
  const context = canvas.getContext('2d');
  let width = 1, height = 1, pixels = 1;
  let countries = [], regions = [], visibleRegionLabels = [];

  function makeAnchor(longitude, latitude) {
    return new THREE.Vector3(...positionOnSphere(longitude, latitude, radius + .047));
  }
  const oceans = OCEANS.map((ocean) => ({ ...ocean, points: ocean.anchors.map(([lon, lat]) => makeAnchor(lon, lat)) }));

  function setData(data) {
    // Tiny islands such as Tuvalu are absent from the 1:50m border atlas but
    // still have useful geographic label coordinates.
    countries = data.countries.map((country) => ({
      ...country,
      point: makeAnchor(country.lon, country.lat),
    }));
    regions = data.regions.filter(region => region.labelVerified !== false).map((region) => ({
      ...region,
      source: region,
      point: makeAnchor(region.lon, region.lat),
    }));
  }

  function resize() {
    width = Math.max(1, stage.clientWidth);
    height = Math.max(1, stage.clientHeight);
    pixels = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixels);
    canvas.height = Math.round(height * pixels);
    context.setTransform(pixels, 0, 0, pixels, 0, 0);
  }

  function project(localPoint) {
    const world = localPoint.clone().applyMatrix4(globe.matrixWorld);
    // The camera is on the positive Z axis. This geometric horizon test is
    // essential: HTML labels would otherwise show through the back of Earth.
    if (world.z * camera.position.z < radius * radius + .12) return null;
    world.project(camera);
    if (world.z > 1 || world.z < -1) return null;
    const x = (world.x + 1) * .5 * width;
    const y = (1 - world.y) * .5 * height;
    if (x < 17 || x > width - 17 || y < 19 || y > height - 19) return null;
    return { x, y };
  }

  function fontFor(label, language) {
    if (label.kind === 'ocean') return { size: language === 'en' ? 15 : 17, weight: '600', family: "'Space Grotesk','Microsoft YaHei',sans-serif", lineHeight: 28 };
    if (label.kind === 'region') return { size: label.highlighted ? 12 : 10, weight: '500', family: "'DM Sans','Microsoft YaHei',sans-serif", lineHeight: 17 };
    return { size: label.highlighted ? 14 : label.rank <= 3 ? 12 : 11, weight: '600', family: "'DM Sans','Microsoft YaHei',sans-serif", lineHeight: 19 };
  }

  function draw({ distance, language = 'zh', oceanNames = true, countryNames = true, regionNames = true,
    selectedCountry = null, selectedRegion = null }) {
    context.clearRect(0, 0, width, height);
    visibleRegionLabels = [];
    if (!countries.length) return;

    const candidates = [];
    const level = detailLevel(distance);
    const regionMode = level !== 'country';
    const countryRank = level === 'country' ? (distance > 8 ? 4 : 7) : 5;
    const selectedCountryName = selectedCountry?.englishName || selectedCountry?.english;

    if (oceanNames && level === 'country') {
      for (const ocean of oceans) {
        const visible = ocean.points.map(project).filter(Boolean)
          .sort((a, b) => (a.x - width / 2) ** 2 + (a.y - height / 2) ** 2 - ((b.x - width / 2) ** 2 + (b.y - height / 2) ** 2));
        if (visible.length) candidates.push({ ...visible[0], kind: 'ocean', text: placeName(ocean, language), priority: 2 });
      }
    }

    if (countryNames) {
      for (const country of countries) {
        const highlighted = country.english === selectedCountryName;
        if (country.rank > countryRank && !highlighted) continue;
        const screen = project(country.point);
        if (!screen) continue;
        candidates.push({ ...screen, kind: 'country', text: placeName(country, language, 'country'),
          highlighted, rank: country.rank,
          priority: highlighted ? 0 : 1.5 + country.rank * .25 });
      }
    }

    if (regionNames && (regionMode || selectedRegion)) {
      const maxRank = distance < 5.1 ? 11 : distance < 5.8 ? 7 : 4;
      for (const region of regions) {
        const highlighted = region.source === selectedRegion;
        if (!regionMode && !highlighted) continue;
        if (region.rank > maxRank && !highlighted) continue;
        const screen = project(region.point);
        if (!screen) continue;
        // Long official names are shown in full in the info card / search list.
        const label = placeName(region, language, 'region');
        const shortName = label.length > 19 ? `${label.slice(0, 18)}…` : label;
        candidates.push({ ...screen, kind: 'region', text: shortName, rank: region.rank, source: region.source,
          highlighted,
          // Show an explicit visual hint when the administrative polygons are historical.
          ...(region.dataWarning ? { text: `${shortName}${language === 'en' ? ' ·old' : '·旧'}` } : {}),
          priority: highlighted ? -.5 : 4 + region.rank * .2 });
      }
    }

    candidates.sort((a, b) => a.priority - b.priority);
    const placed = [];
    let regionCount = 0, countryCount = 0;

    for (const label of candidates) {
      if (label.kind === 'region' && regionCount >= (distance < 5 ? 80 : 48)) continue;
      if (label.kind === 'country' && countryCount >= 85) continue;
      const typography = fontFor(label, language);
      context.font = `${typography.weight} ${typography.size}px ${typography.family}`;
      const nameWidth = context.measureText(label.text).width;
      const boxWidth = nameWidth + 15;
      const boxHeight = typography.lineHeight + 4;
      const box = { left: label.x - boxWidth / 2, right: label.x + boxWidth / 2,
        top: label.y - boxHeight / 2, bottom: label.y + boxHeight / 2 };
      if (box.left < 6 || box.right > width - 6 || box.top < 7 || box.bottom > height - 7) continue;
      if (!label.highlighted && placed.some((other) => box.left < other.right + 5 && box.right + 5 > other.left && box.top < other.bottom + 5 && box.bottom + 5 > other.top)) continue;
      placed.push(box);

      context.save();
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      context.font = `${typography.weight} ${typography.size}px ${typography.family}`;
      context.lineWidth = label.kind === 'ocean' ? 5 : 3;
      context.strokeStyle = 'rgba(2, 15, 24, .93)';
      context.fillStyle = label.kind === 'ocean' ? '#8acfee' : label.kind === 'region' ? '#b2d3cb' : '#e6fff2';
      context.globalAlpha = label.kind === 'region' ? .85 : .97;
      context.strokeText(label.text, label.x, label.y);
      context.fillText(label.text, label.x, label.y);
      if (label.kind === 'region') {
        visibleRegionLabels.push({ box, region: label.source });
      }
      context.restore();
      if (label.kind === 'country') countryCount++;
      if (label.kind === 'region') regionCount++;
    }
  }

  // Point-only province labels have no polygon for map hit testing. Their
  // actual visible label remains selectable even without outline geometry.
  function regionLabelAt(x, y) {
    for (const item of visibleRegionLabels) {
      if (x >= item.box.left - 3 && x <= item.box.right + 3
          && y >= item.box.top - 3 && y <= item.box.bottom + 3) return item.region;
    }
    return null;
  }

  resize();
  return { setData, resize, draw, regionLabelAt };
}
