// Consistent map place names and zoom tiers for the overlay and UI.
// Natural Earth abbreviates many English labels for cartographic space.
// Expand those abbreviations for readable labels/search while retaining the
// original names and IDs for polygon matching.
const fullEnglishCountryNames = new Map([
  ['Marshall Is.', 'Marshall Islands'],
  ['N. Mariana Is.', 'Northern Mariana Islands'],
  ['U.S. Virgin Is.', 'United States Virgin Islands'],
  ['S. Geo. and the Is.', 'South Georgia and the South Sandwich Islands'],
  ['Br. Indian Ocean Ter.', 'British Indian Ocean Territory'],
  ['Pitcairn Is.', 'Pitcairn Islands'],
  ['Falkland Is.', 'Falkland Islands'],
  ['Cayman Is.', 'Cayman Islands'],
  ['British Virgin Is.', 'British Virgin Islands'],
  ['Turks and Caicos Is.', 'Turks and Caicos Islands'],
  ['Solomon Is.', 'Solomon Islands'],
  ['St. Vin. and Gren.', 'Saint Vincent and the Grenadines'],
  ['Cook Is.', 'Cook Islands'],
  ['Wallis and Futuna Is.', 'Wallis and Futuna Islands'],
  ['Dominican Rep.', 'Dominican Republic'],
  ['Faeroe Is.', 'Faroe Islands'],
  ['Central African Rep.', 'Central African Republic'],
  ['Bosnia and Herz.', 'Bosnia and Herzegovina'],
  ['Indian Ocean Ter.', 'Australian Indian Ocean Territories'],
  ['Heard I. and McDonald Is.', 'Heard Island and McDonald Islands'],
  ['Ashmore and Cartier Is.', 'Ashmore and Cartier Islands'],
  ['Antigua and Barb.', 'Antigua and Barbuda'],
]);
export function placeName(place, language = 'zh', kind = 'region') {
  if (!place) return language === 'en' ? 'Ocean' : '海洋';
  const english = place.englishName || place.english || place.displayName || place.name;
  if (kind === 'country') {
    if (place.code === '158' || place.id === '158' || english === 'Taiwan') {
      return language === 'en' ? 'Taiwan, China' : '中国台湾';
    }
    if (english === 'Hong Kong' || english === 'Hong Kong S.A.R.') {
      return language === 'en' ? 'Hong Kong, China' : '中国香港';
    }
    if (english === 'Macao' || english === 'Macau') {
      return language === 'en' ? 'Macao, China' : '中国澳门';
    }
  }
  if (language === 'en') return (kind === 'country' ? fullEnglishCountryNames.get(english) : null)
    || english || place.name || '';
  if (kind === 'country' && english === 'Indian Ocean Ter.') return '澳属印度洋领地';
  return place.name || place.displayName || english || '';
}

export const MAP_ZOOM = Object.freeze({ provinces: 6.35 });

export function detailLevel(distance) {
  return distance > MAP_ZOOM.provinces ? 'country' : 'province';
}
