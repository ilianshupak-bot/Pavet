
'use strict';

// Демонстрационни координати на места в София
const PLACES = [
  { name: 'Сердика', lat: 42.6977, lng: 23.3228 },
  { name: 'НДК', lat: 42.6868, lng: 23.3186 },
  { name: 'Софийски университет', lat: 42.6935, lng: 23.3351 },
  { name: 'Централна гара', lat: 42.7116, lng: 23.3203 },
  { name: 'Летище София', lat: 42.6950, lng: 23.4080 },
  { name: 'Бизнес парк', lat: 42.6244, lng: 23.3752 },
  { name: 'Орлов мост', lat: 42.6902, lng: 23.3375 },
  { name: 'Витоша (метростанция)', lat: 42.6591, lng: 23.3155 },
  { name: 'Люлин', lat: 42.7147, lng: 23.2566 },
  { name: 'Младост 1', lat: 42.6536, lng: 23.3756 },
];

// HTML елементи
const form = document.querySelector('#planirane');
const fromInput = document.querySelector('#from');
const toInput = document.querySelector('#to');
const message = document.querySelector('#form-message');
const caption = document.querySelector('#map-caption');
const mapElement = document.querySelector('#map');

let map;
let routeLayer;

// Намиране на избрано място
const norm = value => value.trim().toLocaleLowerCase('bg-BG');

const findPlace = value =>
  PLACES.find(place => norm(place.name) === norm(value));

// Показване на съобщения
function setMessage(text, type = '') {
  message.textContent = text;
  message.className = `form-message ${type}`.trim();
}

// Създаване на маркер върху картата
function makePin(letter, isEnd = false) {
  return L.divIcon({
    className: 'map-pin',
    html: `<span class="pin-shape${isEnd ? ' pin-end' : ''}">${letter}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Зареждане на картата
function initializeMap() {
  if (typeof window.L === 'undefined') {
    mapElement.innerHTML =
      '<div class="map-placeholder">Картата не можа да се зареди. Провери интернет връзката.</div>';
    return;
  }

  mapElement.innerHTML = '';

  map = L.map(mapElement, {
    scrollWheelZoom: false
  }).setView([42.6977, 23.3219], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    maxZoom: 19,
  }).addTo(map);

  L.circleMarker([42.6977, 23.3228], {
    radius: 7,
    color: '#fff',
    weight: 3,
    fillColor: '#f2ba28',
    fillOpacity: 1,
  }).addTo(map).bindPopup('Център на София · Сердика');
}

// Визуализация между две избрани точки
function drawPreview(start, end) {
  if (!map) {
    setMessage(
      'Картата не е достъпна. Необходима е интернет връзка за външната карта.',
      'error'
    );
    return;
  }

  // Премахване на предишната линия
  if (routeLayer) {
    map.removeLayer(routeLayer);
  }

  const startPoint = [start.lat, start.lng];
  const endPoint = [end.lat, end.lng];

  // Демонстрационна права линия, не транспортен маршрут
  routeLayer = L.featureGroup([
    L.polyline([startPoint, endPoint], {
      color: '#e3a917',
      weight: 4,
      dashArray: '6 9',
      opacity: .95
    }),

    L.marker(startPoint, {
      icon: makePin('A')
    }).bindPopup(`Начало: ${start.name}`),

    L.marker(endPoint, {
      icon: makePin('Б', true)
    }).bindPopup(`Край: ${end.name}`),

  ]).addTo(map);

  // Приближаване на картата
  map.fitBounds(routeLayer.getBounds().pad(.35), {
    maxZoom: 14,
    animate: true
  });

  caption.textContent = `${start.name} → ${end.name}`;

  setMessage(
    'Показана е ориентировъчна права линия между точките, а не маршрут с градски транспорт.',
    'success'
  );
}

// Натискане на бутона "Покажи на картата"
form.addEventListener('submit', event => {
  event.preventDefault();

  const start = findPlace(fromInput.value);
  const end = findPlace(toInput.value);

  if (!start || !end) {
    setMessage(
      'Избери начална и крайна точка от предложенията в полетата.',
      'error'
    );

    (!start ? fromInput : toInput).focus();
    return;
  }

  if (start.name === end.name) {
    setMessage(
      'Началната и крайната точка трябва да са различни.',
      'error'
    );

    toInput.focus();
    return;
  }

  drawPreview(start, end);
});

// Размяна на начална и крайна точка
document.querySelector('#swap').addEventListener('click', () => {
  [fromInput.value, toInput.value] = [
    toInput.value,
    fromInput.value
  ];

  setMessage(
    'Точките са разменени. Натисни „Покажи на картата“.'
  );
});

// Бутони с примерни маршрути
document.querySelectorAll('.quick-card').forEach(button => {
  button.addEventListener('click', () => {
    fromInput.value = button.dataset.from;
    toInput.value = button.dataset.to;

    form.requestSubmit();

    form.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'center'
    });
  });
});

// Стартиране на картата
initializeMap();
