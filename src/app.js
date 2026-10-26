import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import routes from './routes.json';

const FEED_URL = 'https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions';
const CENTER = [42.6977, 23.3219];
const MAX_AGE_SECONDS = 180;
const REFRESH_MS = 30_000;
const PLACES = [
  ['Сердика', 42.6977, 23.3228], ['НДК', 42.6868, 23.3186],
  ['Софийски университет', 42.6935, 23.3351], ['Централна гара', 42.7116, 23.3203],
  ['Летище София', 42.695, 23.408], ['Бизнес парк', 42.6244, 23.3752],
  ['Орлов мост', 42.6902, 23.3375], ['Витоша (метростанция)', 42.6591, 23.3155],
  ['Люлин', 42.7147, 23.2566], ['Младост 1', 42.6536, 23.3756]
];

const $ = selector => document.querySelector(selector);
const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView(CENTER, 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);
const vehicleLayer = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 45,
  disableClusteringAtZoom: 16,
  iconCreateFunction: cluster => L.divIcon({
    html: `<span>${cluster.getChildCount()}</span>`,
    className: 'vehicle-cluster',
    iconSize: [36, 36], iconAnchor: [18, 18]
  })
}).addTo(map);
const placeLayer = L.layerGroup().addTo(map);
const filters = [...document.querySelectorAll('.filter-pill input')];
let vehicles = [];
let fetching = false;
let lastSuccessfulUpdate = 0;

function category(routeId) {
  const type = routes[routeId]?.type;
  if (type === 0 || routeId.startsWith('TM')) return 'tram';
  if (type === 11 || routeId.startsWith('TB')) return 'trolley';
  if (type === 3 || routeId.startsWith('A')) return 'bus';
  return null;
}

function displayName(vehicle) {
  return routes[vehicle.routeId]?.name || vehicle.routeId.replace(/^(TM|TB|A)/, '') || '—';
}

function safe(text) {
  return String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function status(kind, title, detail) {
  const el = $('#live-status');
  el.className = `live-status ${kind}`;
  el.querySelector('strong').textContent = title;
  el.querySelector('small').textContent = detail;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('bg-BG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp * 1000));
}

function readVehicles(feed) {
  const now = Date.now() / 1000;
  return feed.entity.flatMap(entity => {
    const item = entity.vehicle;
    const routeId = item?.trip?.routeId || '';
    const type = category(routeId);
    const lat = Number(item?.position?.latitude);
    const lng = Number(item?.position?.longitude);
    const timestamp = Number(item?.timestamp || feed.header?.timestamp || 0);
    if (!type || !Number.isFinite(lat) || !Number.isFinite(lng) || !timestamp ||
      now - timestamp > MAX_AGE_SECONDS || timestamp > now + 60 ||
      lat < 42.4 || lat > 43 || lng < 23 || lng > 23.8) return [];
    return [{ id: String(item.vehicle?.id || entity.id), routeId, lat, lng, timestamp, type }];
  });
}

function makeIcon(vehicle) {
  return L.divIcon({
    className: `vehicle-icon ${vehicle.type}`,
    html: `<span>${safe(displayName(vehicle))}</span>`,
    iconSize: [34, 30], iconAnchor: [17, 15]
  });
}

function render() {
  vehicleLayer.clearLayers();
  const chosen = new Set(filters.filter(filter => filter.checked).map(filter => filter.value));
  const line = $('#line-filter').value.trim().toLocaleLowerCase('bg-BG');
  const visible = vehicles.filter(vehicle => chosen.has(vehicle.type) &&
    (!line || displayName(vehicle).toLocaleLowerCase('bg-BG') === line));
  const labels = { bus: 'Автобус', tram: 'Трамвай', trolley: 'Тролей' };
  for (const vehicle of visible) {
    const popup = `<div class="popup-title">${labels[vehicle.type]} ${safe(displayName(vehicle))}</div>` +
      `<div class="popup-meta">Позиция към ${safe(formatTime(vehicle.timestamp))}<br>Данни: Център за градска мобилност</div>`;
    L.marker([vehicle.lat, vehicle.lng], { icon: makeIcon(vehicle), title: `${labels[vehicle.type]} ${displayName(vehicle)}` })
      .bindPopup(popup).addTo(vehicleLayer);
  }
  $('#vehicle-count').textContent = `${visible.length} превозни средства`;
  for (const type of ['bus', 'tram', 'trolley']) {
    $(`#${type}-count`).textContent = visible.filter(vehicle => vehicle.type === type).length;
  }
  $('#clear-line').hidden = !$('#line-filter').value;
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
    const bytes = new Uint8Array(await response.arrayBuffer());
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
    const next = readVehicles(feed);
    if (!next.length) throw new Error('No fresh positions');
    vehicles = next;
    lastSuccessfulUpdate = Date.now();
    const newest = Math.max(...next.map(vehicle => vehicle.timestamp));
    status('live', 'Позиции на живо', `Последна позиция ${formatTime(newest)}`);
    $('#data-message').textContent = `Официални позиции към ${formatTime(newest)} · Обновяване на 30 сек.`;
    render();
  } catch (error) {
    vehicles = [];
    vehicleLayer.clearLayers();
    render();
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
for (const [name] of PLACES) {
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
  placeLayer.clearLayers();
  L.marker([place[1], place[2]], {
    icon: L.divIcon({ className: 'place-marker', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] })
  }).bindPopup(safe(place[0])).addTo(placeLayer).openPopup();
  map.setView([place[1], place[2]], 15, { animate: true });
  if (window.innerWidth <= 760) $('#live-map').scrollIntoView({ behavior: 'smooth' });
});

filters.forEach(filter => filter.addEventListener('change', render));
$('#line-filter').addEventListener('input', render);
$('#clear-line').addEventListener('click', () => { $('#line-filter').value = ''; render(); $('#line-filter').focus(); });
$('#reset-view').addEventListener('click', () => { placeLayer.clearLayers(); map.setView(CENTER, 12, { animate: true }); });
$('#refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastSuccessfulUpdate > REFRESH_MS) refresh();
});
setInterval(refresh, REFRESH_MS);
setInterval(() => {
  if (!document.hidden && lastSuccessfulUpdate && Date.now() - lastSuccessfulUpdate > MAX_AGE_SECONDS * 1000) {
    vehicles = [];
    render();
    status('error', 'Няма актуални позиции', 'Опитай отново след малко');
  }
}, 10_000);
refresh();
