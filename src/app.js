import * as maplibregl from 'maplibre-gl';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import routes from './routes.json';
import stopRows from './stops.json';
import stopLines from './stop-lines.json';

maplibregl.setWorkerUrl(new URL(
  `./maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`,
  document.currentScript.src
).toString());

const FEED_URL = 'https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions';
const TRIP_UPDATES_URL = 'https://gtfs.sofiatraffic.bg/api/v1/trip-updates';
const CENTER = [23.3219, 42.6977];
const MAX_AGE_SECONDS = 180;
const REFRESH_MS = 30_000;
const $ = selector => document.querySelector(selector);
const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const PLACES = [
  ['Орлов мост', 23.3375, 42.6902], ['НДК', 23.3186, 42.6868],
  ['Централна гара', 23.3203, 42.7116]
];
const metroStations = stopRows.filter(row => row[5] === 'metro');
const surfaceStops = stopRows.filter(row => row[5] !== 'metro');
const stopsById = new Map(stopRows.map(row => [row[0], row]));
for (const [, , name, lat, lng] of metroStations) {
  if (!PLACES.some(place => place[0].toLocaleLowerCase('bg-BG') === name.toLocaleLowerCase('bg-BG'))) {
    PLACES.push([name, lng, lat]);
  }
}

const modeNames = { bus: 'Автобус', tram: 'Трамвай', trolley: 'Тролей', metro: 'Метро' };
const modeColors = { bus: '#e4b91b', tram: '#e87540', trolley: '#4689bc', metro: '#634ab8' };
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: CENTER,
  zoom: 12.15,
  minZoom: 10,
  maxZoom: 18,
  attributionControl: true
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

const filters = [...document.querySelectorAll('.filter-pill input')];
let vehicles = [];
let fetching = false;
let lastSuccessfulUpdate = 0;
let stopsVisible = true;
let activePopup = null;
let activeStopId = null;
let arrivals = new Map();
let arrivalFeedUpdated = 0;
let fetchingArrivals = false;
let routePaths = null;
let routePathsPromise = null;
let selectedRouteId = null;
let selectedVariantIndex = 0;

function iconSvg(mode) {
  const colors = { bus: '#e4b91b', tram: '#e87540', trolley: '#4689bc', metro: '#634ab8' };
  const drawings = {
    bus: '<rect x="28" y="24" width="32" height="33" rx="6"/><path d="M32 30h24v12H32z"/><path d="M34 49h3m14 0h3"/><path d="M33 57v4m22-4v4"/>',
    tram: '<path d="M36 21l8-7 8 7M32 22h24"/><rect x="28" y="25" width="32" height="32" rx="6"/><path d="M33 31h22v12H33zM32 57l-4 5m28-5 4 5M34 49h3m14 0h3"/>',
    trolley: '<path d="M36 24l-6-10m18 10 8-10M28 13h31"/><rect x="28" y="25" width="32" height="32" rx="6"/><path d="M33 31h22v12H33zM34 49h3m14 0h3M33 57v4m22-4v4"/>',
    metro: '<path d="M30 31c0-7 5-11 14-11s14 4 14 11v24H30z"/><path d="M34 29h20v14H34zM34 49h4m12 0h4M34 55l-5 6m25-6 5 6"/>'
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="96" viewBox="0 0 88 96">
    <path d="M44 91 31 70h26L44 91Z" fill="${colors[mode]}" stroke="#fff" stroke-width="3"/>
    <circle cx="44" cy="40" r="34" fill="${colors[mode]}" stroke="#fff" stroke-width="4"/>
    <g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${drawings[mode]}</g>
  </svg>`;
}

async function addIcons() {
  await Promise.all(['bus', 'tram', 'trolley', 'metro'].map(async mode => {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(mode))}`;
    await image.decode();
    map.addImage(`${mode}-icon`, image, { pixelRatio: 2 });
  }));
}

function featureCollection(rows) {
  return { type: 'FeatureCollection', features: rows.map(([id, code, name, lat, lng, mode]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { id, code, name, mode }
  })) };
}

function setStopVisibility() {
  const value = stopsVisible ? 'visible' : 'none';
  if (!stopsVisible && activePopup) activePopup.remove();
  for (const layer of ['metro-icons', 'metro-labels', 'surface-stop-halos', 'surface-stops', 'surface-stop-hit']) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', value);
  }
  const button = $('#toggle-stops');
  button.setAttribute('aria-pressed', String(stopsVisible));
  button.querySelector('strong').textContent = stopsVisible ? 'Спирки и станции' : 'Покажи спирките';
  button.classList.toggle('inactive', !stopsVisible);
}

function addStopLayers() {
  map.addSource('metro-stations', { type: 'geojson', data: featureCollection(metroStations), attribution: '© Център за градска мобилност' });
  map.addSource('surface-stops', { type: 'geojson', data: featureCollection(surfaceStops), attribution: '© Център за градска мобилност' });
  map.addLayer({
    id: 'surface-stop-halos', type: 'circle', source: 'surface-stops', minzoom: 15,
    paint: { 'circle-radius': 8, 'circle-color': '#ffffff', 'circle-opacity': 0.95 }
  });
  map.addLayer({
    id: 'surface-stops', type: 'circle', source: 'surface-stops', minzoom: 15,
    paint: {
      'circle-radius': 5,
      'circle-color': ['match', ['get', 'mode'], 'tram', '#e87540', 'trolley', '#4689bc', '#e4b91b'],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 1
    }
  });
  map.addLayer({
    id: 'surface-stop-hit', type: 'circle', source: 'surface-stops', minzoom: 15,
    paint: { 'circle-radius': 13, 'circle-color': '#ffffff', 'circle-opacity': 0.01 }
  });
  map.addLayer({
    id: 'metro-icons', type: 'symbol', source: 'metro-stations', minzoom: 10,
    layout: { 'icon-image': 'metro-icon', 'icon-size': 0.9, 'icon-allow-overlap': false }
  });
  map.addLayer({
    id: 'metro-labels', type: 'symbol', source: 'metro-stations', minzoom: 14,
    layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'],
      'text-offset': [0, 2.2], 'text-anchor': 'top', 'text-max-width': 10 },
    paint: { 'text-color': '#413285', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }
  });
  setStopVisibility();
}

function addVehicleLayers() {
  map.addSource('vehicles', { type: 'geojson', data: emptyCollection(), cluster: true, clusterRadius: 52, clusterMaxZoom: 15 });
  map.addLayer({
    id: 'vehicle-clusters', type: 'circle', source: 'vehicles', filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#1f3940', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3,
      'circle-radius': ['step', ['get', 'point_count'], 20, 10, 24, 35, 28]
    }
  });
  map.addLayer({
    id: 'vehicle-cluster-count', type: 'symbol', source: 'vehicles', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11, 'text-font': ['Noto Sans Bold'] },
    paint: { 'text-color': '#ffffff' }
  });
  map.addLayer({
    id: 'vehicle-icons', type: 'symbol', source: 'vehicles', filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['concat', ['get', 'mode'], '-icon'],
      'icon-size': 1,
      'icon-allow-overlap': false,
      'text-field': ['get', 'line'], 'text-font': ['Noto Sans Bold'],
      'text-size': 11, 'text-offset': [0, 2], 'text-anchor': 'top', 'text-optional': true
    },
    paint: { 'text-color': '#173139', 'text-halo-color': '#ffffff', 'text-halo-width': 2.5 }
  });
  renderVehicles();
}

function addRouteLayers() {
  map.addSource('selected-route', { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'selected-route',
    paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.95 },
    layout: { 'line-cap': 'round', 'line-join': 'round' }
  });
  map.addLayer({
    id: 'route-path', type: 'line', source: 'selected-route',
    paint: { 'line-color': '#e87540', 'line-width': 6, 'line-opacity': 0.95 },
    layout: { 'line-cap': 'round', 'line-join': 'round' }
  });
  map.addSource('route-stops', { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'route-stops', type: 'circle', source: 'route-stops',
    paint: { 'circle-radius': 5, 'circle-color': '#ffffff',
      'circle-stroke-color': '#e87540', 'circle-stroke-width': 2.5 }
  });
}

function lineLabel(routeId) {
  const route = routes[routeId];
  return `${modeNames[category(routeId)] || 'Линия'} ${route?.name || routeId}`;
}

function arrivalLabel(time) {
  if (!time) return 'Няма час на живо';
  const minutes = Math.max(0, Math.ceil((time - Date.now() / 1000) / 60));
  return `${new Intl.DateTimeFormat('bg-BG', { hour: '2-digit', minute: '2-digit' }).format(new Date(time * 1000))} · ${minutes} мин`;
}

function stopPopupHtml(stopId) {
  const row = stopsById.get(stopId);
  if (!row) return '';
  const [, code, name, , , mode] = row;
  const lines = stopLines[stopId] || [];
  const times = arrivals.get(stopId) || [];
  const upcoming = new Map();
  for (const arrival of times) {
    if (!upcoming.has(arrival.routeId)) upcoming.set(arrival.routeId, arrival.time);
  }
  const sortedLines = [...lines].sort((a, b) =>
    (upcoming.get(a) || Infinity) - (upcoming.get(b) || Infinity) ||
    lineLabel(a).localeCompare(lineLabel(b), 'bg', { numeric: true }));
  const subtitle = mode === 'metro' ? 'Метростанция' : `Спирка${code ? ` · № ${escapeHtml(code)}` : ''}`;
  const footnote = mode === 'metro'
    ? 'Официалният поток не публикува часове за метро. Натисни линия за маршрута.'
    : `${arrivalFeedUpdated ? `Часове от официалния поток към ${escapeHtml(formatTime(arrivalFeedUpdated))}.` : 'В момента няма актуални часове от официалния поток.'} Натисни линия за маршрута.`;
  return `<div class="stop-popup"><div class="popup-kicker">${subtitle}</div>
    <strong class="stop-popup-title">${escapeHtml(name)}</strong>
    <div class="popup-section-title">Линии и следващо пристигане</div>
    <div class="stop-lines">${sortedLines.length ? sortedLines.map(routeId => {
      const routeMode = category(routeId) || 'metro';
      const time = upcoming.get(routeId);
      return `<button type="button" class="stop-line" data-route-id="${escapeHtml(routeId)}" title="Покажи маршрута на ${escapeHtml(lineLabel(routeId))}">
        <span class="line-badge ${routeMode}">${escapeHtml(routes[routeId]?.name || routeId)}</span>
        <span class="line-kind">${escapeHtml(modeNames[routeMode])}</span>
        <span class="line-time${time ? ' available' : ''}">${escapeHtml(arrivalLabel(time))}</span><span class="line-arrow" aria-hidden="true">↗</span>
      </button>`;
    }).join('') : '<p class="popup-empty">За тази спирка няма публикувани линии в текущия GTFS график.</p>'}</div>
    <div class="popup-footnote">${footnote}</div></div>`;
}

function bindPopupRoutes() {
  activePopup?.getElement()?.querySelectorAll('[data-route-id]').forEach(button => {
    button.addEventListener('click', () => showRoute(button.dataset.routeId, activeStopId));
  });
}

function popupAt(lngLat, html, stopId = null) {
  activePopup?.remove();
  activeStopId = stopId;
  activePopup = new maplibregl.Popup({ offset: 18, closeButton: true, maxWidth: '345px' })
    .setLngLat(lngLat).setHTML(html).addTo(map);
  activePopup.on('close', () => { if (activePopup?.isOpen() === false) activeStopId = null; });
  bindPopupRoutes();
}

function updateStopPopup() {
  if (!activeStopId || !activePopup?.isOpen()) return;
  activePopup.setHTML(stopPopupHtml(activeStopId));
  bindPopupRoutes();
}

async function getRoutePaths() {
  if (routePaths) return routePaths;
  if (!routePathsPromise) {
    routePathsPromise = fetch('route-paths.json').then(response => {
      if (!response.ok) throw new Error(`Route paths: HTTP ${response.status}`);
      return response.json();
    }).then(data => { routePaths = data; return data; })
      .catch(error => { routePathsPromise = null; throw error; });
  }
  return routePathsPromise;
}

function drawSelectedRoute() {
  const variants = routePaths?.[selectedRouteId] || [];
  const variant = variants[selectedVariantIndex];
  if (!variant || !map.getSource('selected-route')) return;
  const mode = category(selectedRouteId) || 'metro';
  const color = modeColors[mode];
  map.setPaintProperty('route-path', 'line-color', color);
  map.setPaintProperty('route-stops', 'circle-stroke-color', color);
  map.getSource('selected-route').setData({ type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'LineString', coordinates: variant.path }, properties: {}
  }] });
  const stops = variant.stops.map(id => stopsById.get(id)).filter(Boolean);
  map.getSource('route-stops').setData({ type: 'FeatureCollection', features: stops.map(row => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [row[4], row[3]] },
    properties: { id: row[0], name: row[2] }
  })) });
  const bounds = variant.path.reduce((box, point) => box.extend(point), new maplibregl.LngLatBounds(variant.path[0], variant.path[0]));
  map.fitBounds(bounds, { padding: 65, maxZoom: 15.5, duration: 650 });
  const card = $('#route-result');
  card.hidden = false;
  card.innerHTML = `<div class="route-result-top"><span class="line-badge ${mode}">${escapeHtml(routes[selectedRouteId]?.name || selectedRouteId)}</span>
    <div><strong>${escapeHtml(lineLabel(selectedRouteId))}</strong><small>${stops.length} спирки по този вариант</small></div>
    <button type="button" id="close-route" aria-label="Затвори маршрута">×</button></div>
    <label for="route-variant">Посока и вариант</label>
    <select id="route-variant">${variants.map((item, index) => `<option value="${index}"${index === selectedVariantIndex ? ' selected' : ''}>${escapeHtml(item.headsign || 'Маршрут')} ${variants.filter(other => other.headsign === item.headsign).length > 1 ? `· ${index + 1}` : ''}</option>`).join('')}</select>
    <p class="route-endpoints">${escapeHtml(stops[0]?.[2] || 'Начало')} <span>→</span> ${escapeHtml(stops.at(-1)?.[2] || 'Край')}</p>
    <p class="route-disclaimer">Маршрут от публикувания GTFS график. Временни промени може да не са отразени.</p>`;
  $('#route-variant').addEventListener('change', event => {
    selectedVariantIndex = Number(event.target.value);
    drawSelectedRoute();
  });
  $('#close-route').addEventListener('click', clearRoute);
  $('#line-filter').value = lineLabel(selectedRouteId);
  $('#clear-line').hidden = false;
  renderVehicles();
  if (window.innerWidth <= 760) $('#live-map').scrollIntoView({ behavior: 'smooth' });
}

async function showRoute(routeId, preferredStopId = null) {
  if (!routes[routeId]) return;
  const message = $('#line-message');
  message.textContent = 'Зареждаме маршрута…';
  message.classList.remove('error');
  try {
    const paths = await getRoutePaths();
    const variants = paths[routeId] || [];
    if (!variants.length) {
      message.textContent = 'Няма публикуван маршрут за тази линия в текущия GTFS график.';
      message.classList.add('error');
      return;
    }
    selectedRouteId = routeId;
    selectedVariantIndex = variants.reduce((best, variant, index) => {
      const score = variant.stops.length + (preferredStopId && variant.stops.includes(preferredStopId) ? 10000 : 0);
      const bestVariant = variants[best];
      const bestScore = bestVariant.stops.length + (preferredStopId && bestVariant.stops.includes(preferredStopId) ? 10000 : 0);
      return score > bestScore ? index : best;
    }, 0);
    message.textContent = 'Маршрутът е показан на картата.';
    activePopup?.remove();
    drawSelectedRoute();
  } catch (error) {
    console.warn('Pavet route paths:', error);
    message.textContent = 'Маршрутът не можа да се зареди. Опитай отново.';
    message.classList.add('error');
  }
}

function clearRoute() {
  selectedRouteId = null;
  $('#route-result').hidden = true;
  $('#route-result').innerHTML = '';
  $('#line-filter').value = '';
  $('#line-message').textContent = 'Избери линия, за да видиш маршрута ѝ.';
  $('#line-message').classList.remove('error');
  $('#clear-line').hidden = true;
  map.getSource('selected-route')?.setData(emptyCollection());
  map.getSource('route-stops')?.setData(emptyCollection());
  renderVehicles();
}

function wireMapClicks() {
  map.on('click', 'vehicle-clusters', event => {
    const feature = map.queryRenderedFeatures(event.point, { layers: ['vehicle-clusters'] })[0];
    if (!feature) return;
    map.getSource('vehicles').getClusterExpansionZoom(feature.properties.cluster_id)
      .then(zoom => map.easeTo({ center: feature.geometry.coordinates, zoom: Math.min(zoom, 17) }));
  });
  map.on('click', 'vehicle-icons', event => {
    const feature = event.features?.[0];
    if (!feature) return;
    const { mode, line, timestamp, routeId } = feature.properties;
    popupAt(feature.geometry.coordinates,
      `<strong>${modeNames[mode]} ${escapeHtml(line)}</strong><br><span>Позиция към ${escapeHtml(formatTime(Number(timestamp)))}</span><br><button type="button" class="popup-route-button" data-route-id="${escapeHtml(routeId)}">Покажи маршрута ↗</button>`);
  });
  for (const layer of ['metro-icons', 'surface-stop-hit']) {
    map.on('click', layer, event => {
      const feature = event.features?.[0];
      if (!feature) return;
      const { id } = feature.properties;
      popupAt(feature.geometry.coordinates, stopPopupHtml(id), id);
    });
  }
  map.on('click', 'route-stops', event => {
    const feature = event.features?.[0];
    if (feature) popupAt(feature.geometry.coordinates, stopPopupHtml(feature.properties.id), feature.properties.id);
  });
  for (const layer of ['vehicle-clusters', 'vehicle-icons', 'metro-icons', 'surface-stop-hit', 'route-stops']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }
}

function preferLocalMapNames() {
  for (const layer of map.getStyle().layers) {
    const field = layer.layout?.['text-field'];
    if (layer.type !== 'symbol' || !field ||
      !/name:nonlatin|name_en/.test(JSON.stringify(field))) continue;
    map.setLayoutProperty(layer.id, 'text-field', [
      'coalesce', ['get', 'name:nonlatin'], ['get', 'name'], ['get', 'name:latin']
    ]);
  }
}

map.on('load', async () => {
  try {
    preferLocalMapNames();
    await addIcons();
    addStopLayers();
    addRouteLayers();
    addVehicleLayers();
    wireMapClicks();
  } catch (error) {
    console.error('Map layers could not load:', error);
    $('#data-message').textContent = 'Слоевете на картата не можаха да се заредят.';
  }
});

function category(routeId) {
  const type = routes[routeId]?.type;
  if (type === 1 || /^M\d/.test(routeId)) return 'metro';
  if (type === 0 || routeId.startsWith('TM')) return 'tram';
  if (type === 11 || routeId.startsWith('TB')) return 'trolley';
  if (type === 3 || routeId.startsWith('A')) return 'bus';
  return null;
}

function displayName(vehicle) {
  return routes[vehicle.routeId]?.name || vehicle.routeId.replace(/^(TM|TB|A)/, '') || '—';
}

function status(kind, title, detail) {
  const el = $('#live-status');
  el.className = `live-status ${kind}`;
  el.querySelector('strong').textContent = title;
  el.querySelector('small').textContent = detail;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('bg-BG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .format(new Date(timestamp * 1000));
}

function readVehicles(feed) {
  const now = Date.now() / 1000;
  return feed.entity.flatMap(entity => {
    const item = entity.vehicle;
    const routeId = item?.trip?.routeId || '';
    const mode = category(routeId);
    const lat = Number(item?.position?.latitude);
    const lng = Number(item?.position?.longitude);
    const timestamp = Number(item?.timestamp || feed.header?.timestamp || 0);
    if (!mode || !Number.isFinite(lat) || !Number.isFinite(lng) || !timestamp ||
      now - timestamp > MAX_AGE_SECONDS || timestamp > now + 60 ||
      lat < 42.4 || lat > 43 || lng < 23 || lng > 23.8) return [];
    return [{ id: String(item.vehicle?.id || entity.id), routeId, lat, lng, timestamp, mode }];
  });
}

function readArrivals(feed) {
  const now = Date.now() / 1000;
  const feedTime = Number(feed.header?.timestamp || 0);
  if (!feedTime || Math.abs(now - feedTime) > MAX_AGE_SECONDS) throw new Error('Stale trip updates');
  const next = new Map();
  for (const entity of feed.entity) {
    const update = entity.tripUpdate;
    const routeId = update?.trip?.routeId;
    if (!routeId || !routes[routeId]) continue;
    const updateTime = Number(update.timestamp || feedTime);
    if (Math.abs(now - updateTime) > MAX_AGE_SECONDS) continue;
    for (const stop of update.stopTimeUpdate || []) {
      const time = Number(stop.arrival?.time || stop.departure?.time || 0);
      if (!time || time < now - 30 || time > now + 90 * 60 || !stop.stopId) continue;
      if (!next.has(stop.stopId)) next.set(stop.stopId, []);
      next.get(stop.stopId).push({ routeId, time });
    }
  }
  for (const entries of next.values()) entries.sort((a, b) => a.time - b.time);
  return { next, feedTime };
}

async function refreshArrivals() {
  if (fetchingArrivals || document.hidden) return;
  fetchingArrivals = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(TRIP_UPDATES_URL, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage
      .decode(new Uint8Array(await response.arrayBuffer()));
    const result = readArrivals(feed);
    arrivals = result.next;
    arrivalFeedUpdated = result.feedTime;
  } catch (error) {
    arrivals = new Map();
    arrivalFeedUpdated = 0;
    console.warn('Pavet trip updates:', error);
  } finally {
    clearTimeout(timeout);
    fetchingArrivals = false;
    updateStopPopup();
  }
}

function renderVehicles() {
  const chosen = new Set(filters.filter(filter => filter.checked).map(filter => filter.value));
  const visible = vehicles.filter(vehicle => chosen.has(vehicle.mode) &&
    (!selectedRouteId || vehicle.routeId === selectedRouteId));
  const features = visible.map(vehicle => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [vehicle.lng, vehicle.lat] },
    properties: { id: vehicle.id, mode: vehicle.mode, line: displayName(vehicle), routeId: vehicle.routeId, timestamp: vehicle.timestamp }
  }));
  map.getSource('vehicles')?.setData({ type: 'FeatureCollection', features });
  $('#vehicle-count').textContent = `${visible.length} превозни средства`;
  for (const mode of ['bus', 'tram', 'trolley']) {
    $(`#${mode}-count`).textContent = visible.filter(vehicle => vehicle.mode === mode).length;
  }
  $('#clear-line').hidden = !$('#line-filter').value && !selectedRouteId;
}

async function refresh() {
  if (fetching || document.hidden) return;
  fetching = true;
  $('#refresh').disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(FEED_URL, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage
      .decode(new Uint8Array(await response.arrayBuffer()));
    const next = readVehicles(feed);
    if (!next.length) throw new Error('No fresh positions');
    vehicles = next;
    lastSuccessfulUpdate = Date.now();
    const newest = Math.max(...next.map(vehicle => vehicle.timestamp));
    status('live', 'Позиции на живо', `Последна позиция ${formatTime(newest)}`);
    $('#data-message').textContent = `Официални позиции към ${formatTime(newest)} · Обновяване на 30 сек.`;
    renderVehicles();
  } catch (error) {
    vehicles = [];
    renderVehicles();
    status('error', 'Няма актуални позиции', 'Опитай отново след малко');
    $('#data-message').textContent = 'Връзката с официалния поток е прекъсната или данните са остарели.';
    console.warn('Pavet live feed:', error);
  } finally {
    clearTimeout(timeout);
    fetching = false;
    $('#refresh').disabled = false;
  }
}

const options = $('#places');
for (const [name] of PLACES.sort((a, b) => a[0].localeCompare(b[0], 'bg'))) {
  const option = document.createElement('option');
  option.value = name;
  options.appendChild(option);
}

$('#place-form').addEventListener('submit', event => {
  event.preventDefault();
  const query = $('#place-input').value.trim().toLocaleLowerCase('bg-BG');
  const place = PLACES.find(([name]) => name.toLocaleLowerCase('bg-BG') === query);
  const message = $('#place-message');
  if (!place) {
    message.textContent = 'Избери място от предложенията.';
    message.classList.add('error');
    return;
  }
  message.classList.remove('error');
  message.textContent = `${place[0]} е показано на картата.`;
  map.flyTo({ center: [place[1], place[2]], zoom: 15.3, essential: true });
  const station = metroStations.find(row => row[2].toLocaleLowerCase('bg-BG') === query);
  popupAt([place[1], place[2]], station ? stopPopupHtml(station[0]) : `<strong>${escapeHtml(place[0])}</strong>`, station?.[0]);
  if (window.innerWidth <= 760) $('#live-map').scrollIntoView({ behavior: 'smooth' });
});

filters.forEach(filter => filter.addEventListener('change', renderVehicles));
const lineOptions = $('#line-options');
for (const routeId of Object.keys(routes).sort((a, b) => lineLabel(a).localeCompare(lineLabel(b), 'bg', { numeric: true }))) {
  const option = document.createElement('option');
  option.value = lineLabel(routeId);
  lineOptions.appendChild(option);
}
$('#line-search').addEventListener('submit', event => {
  event.preventDefault();
  const query = $('#line-filter').value.trim().toLocaleLowerCase('bg-BG');
  const choices = $('#line-choices');
  choices.replaceChildren();
  const matching = Object.keys(routes).filter(id =>
    routes[id].name.toLocaleLowerCase('bg-BG') === query || lineLabel(id).toLocaleLowerCase('bg-BG') === query);
  if (matching.length === 1) { showRoute(matching[0]); return; }
  const message = $('#line-message');
  if (!matching.length) {
    message.textContent = 'Няма линия с този номер. Избери от предложенията.';
    message.classList.add('error');
    return;
  }
  message.textContent = 'Намерени са няколко линии. Избери вид транспорт:';
  message.classList.remove('error');
  for (const id of matching) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'line-choice';
    button.textContent = lineLabel(id);
    button.addEventListener('click', () => { choices.replaceChildren(); showRoute(id); });
    choices.appendChild(button);
  }
});
$('#line-filter').addEventListener('input', () => { $('#clear-line').hidden = !$('#line-filter').value && !selectedRouteId; });
$('#clear-line').addEventListener('click', () => { clearRoute(); $('#line-choices').replaceChildren(); $('#line-filter').focus(); });
$('#toggle-stops').addEventListener('click', () => { stopsVisible = !stopsVisible; setStopVisibility(); });
$('#reset-view').addEventListener('click', () => map.flyTo({ center: CENTER, zoom: 12.15, essential: true }));
$('#refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastSuccessfulUpdate > REFRESH_MS) { refresh(); refreshArrivals(); }
});
setInterval(refresh, REFRESH_MS);
setInterval(refreshArrivals, REFRESH_MS);
setInterval(() => {
  if (!document.hidden && lastSuccessfulUpdate && Date.now() - lastSuccessfulUpdate > MAX_AGE_SECONDS * 1000) {
    vehicles = [];
    renderVehicles();
    status('error', 'Няма актуални позиции', 'Опитай отново след малко');
  }
}, 10_000);
refresh();
refreshArrivals();
