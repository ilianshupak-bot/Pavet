// Photon is queried only when a submitted place is absent from the local stop list.
// Keep the search inside Sofia's transport service area so a same-named place
// elsewhere in Bulgaria cannot silently become the destination.
const SOFIA_BBOX = [23.13, 42.57, 23.58, 42.83];

export function isInServiceArea(point) {
  return Array.isArray(point) && point.length >= 2 &&
    point.slice(0, 2).every(Number.isFinite) &&
    point[0] >= SOFIA_BBOX[0] && point[0] <= SOFIA_BBOX[2] &&
    point[1] >= SOFIA_BBOX[1] && point[1] <= SOFIA_BBOX[3];
}

export function photonSearchUrl(query) {
  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({
    q: query.trim(),
    lat: '42.6977',
    lon: '23.3219',
    bbox: SOFIA_BBOX.join(','),
    lang: 'default',
    limit: '5'
  }).toString();
  return url.toString();
}

export function placeFromPhoton(feature) {
  const point = feature?.geometry?.coordinates;
  if (!isInServiceArea(point)) return null;
  const info = feature.properties || {};
  const address = [info.street, info.housenumber].filter(Boolean).join(' ');
  const title = info.name || address;
  if (!title) return null;
  const locality = info.district || info.city || info.county;
  const details = [info.name && address !== info.name ? address : '', locality]
    .filter(Boolean).join(', ');
  return { name: details ? `${title} · ${details}` : title, point: point.slice(0, 2) };
}
