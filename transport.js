'use strict';


/* =========================================================
   PAVET ROUTING ENGINE
========================================================= */


/*
  Демонстрационни координати.

  По-късно този масив може да бъде заменен
  с реални GTFS данни за София.
*/

const PLACES = [

  {
    name: 'Сердика',
    lat: 42.6977,
    lng: 23.3228,
    station: 'metro'
  },

  {
    name: 'НДК',
    lat: 42.6868,
    lng: 23.3186,
    station: 'metro'
  },

  {
    name: 'Софийски университет',
    lat: 42.6935,
    lng: 23.3351,
    station: 'metro'
  },

  {
    name: 'Централна гара',
    lat: 42.7116,
    lng: 23.3203,
    station: 'metro'
  },

  {
    name: 'Летище София',
    lat: 42.6950,
    lng: 23.4080,
    station: 'metro'
  },

  {
    name: 'Бизнес парк',
    lat: 42.6244,
    lng: 23.3752,
    station: 'metro'
  },

  {
    name: 'Орлов мост',
    lat: 42.6902,
    lng: 23.3375,
    station: 'bus'
  },

  {
    name: 'Витоша (метростанция)',
    lat: 42.6591,
    lng: 23.3155,
    station: 'metro'
  },

  {
    name: 'Люлин',
    lat: 42.7147,
    lng: 23.2566,
    station: 'metro'
  },

  {
    name: 'Младост 1',
    lat: 42.6536,
    lng: 23.3756,
    station: 'metro'
  }

];


/* =========================================================
   DOM
========================================================= */

const form =
  document.querySelector('#planirane');

const fromInput =
  document.querySelector('#from');

const toInput =
  document.querySelector('#to');

const message =
  document.querySelector('#form-message');

const caption =
  document.querySelector('#map-caption');

const mapElement =
  document.querySelector('#map');

const swapButton =
  document.querySelector('#swap');

const locationButton =
  document.querySelector('#use-location');

const locationStatus =
  document.querySelector('#location-status');

const transportCheckboxes =
  [...document.querySelectorAll('.transport-checkbox')];

const selectedTransportCount =
  document.querySelector('#selected-transport-count');

const publicTransportPreference =
  document.querySelector('#prefer-public-transport');


/* =========================================================
   STATE
========================================================= */

let map = null;

let routeLayer = null;

let userLocation = null;


/* =========================================================
   NORMALIZATION
========================================================= */

const norm = value =>
  String(value)
    .trim()
    .toLocaleLowerCase('bg-BG');


function findPlace(value) {

  return PLACES.find(
    place =>
      norm(place.name) === norm(value)
  );

}


/* =========================================================
   MESSAGE
========================================================= */

function setMessage(
  text,
  type = ''
) {

  message.textContent = text;

  message.className =
    `form-message ${type}`.trim();

}


/* =========================================================
   TRANSPORT SELECTION
========================================================= */

function getSelectedTransport() {

  return transportCheckboxes
    .filter(input => input.checked)
    .map(input => input.value);

}


function updateTransportCounter() {

  const selected =
    getSelectedTransport();

  const count =
    selected.length;

  selectedTransportCount.textContent =
    `${count} ${count === 1 ? 'избран' : 'избрани'}`;

}


transportCheckboxes.forEach(
  checkbox => {

    checkbox.addEventListener(
      'change',
      updateTransportCounter
    );

  }
);


updateTransportCounter();


/* =========================================================
   MAP
========================================================= */

function initializeMap() {

  if (typeof window.L === 'undefined') {

    mapElement.innerHTML =
      `
      <div class="map-placeholder">
        Картата не можа да се зареди.
        Провери интернет връзката.
      </div>
      `;

    return;
  }


  mapElement.innerHTML = '';


  map = L.map(
    mapElement,
    {
      scrollWheelZoom: false
    }
  ).setView(
    [42.6977, 23.3219],
    12
  );


  L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {

      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',

      maxZoom: 19

    }
  ).addTo(map);


  L.circleMarker(
    [42.6977, 23.3228],
    {

      radius: 7,

      color: '#fff',

      weight: 3,

      fillColor: '#f2ba28',

      fillOpacity: 1

    }
  )
    .addTo(map)
    .bindPopup(
      'Център на София · Сердика'
    );

}


/* =========================================================
   MAP PINS
========================================================= */

function makePin(
  letter,
  isEnd = false
) {

  return L.divIcon({

    className: 'map-pin',

    html:
      `
      <span
        class="pin-shape${isEnd ? ' pin-end' : ''}"
      >
        ${letter}
      </span>
      `,

    iconSize: [26, 26],

    iconAnchor: [13, 13]

  });

}


/* =========================================================
   DISTANCE
========================================================= */

function calculateDistance(
  a,
  b
) {

  const R = 6371;

  const lat1 =
    a.lat * Math.PI / 180;

  const lat2 =
    b.lat * Math.PI / 180;

  const dLat =
    (b.lat - a.lat) *
    Math.PI / 180;

  const dLng =
    (b.lng - a.lng) *
    Math.PI / 180;


  const x =
    Math.sin(dLat / 2) *
    Math.sin(dLat / 2) +
    Math.cos(lat1) *
    Math.cos(lat2) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);


  const c =
    2 *
    Math.atan2(
      Math.sqrt(x),
      Math.sqrt(1 - x)
    );


  return R * c;

}


/* =========================================================
   WALKING SEGMENT
========================================================= */

function createWalkingSegment(
  from,
  to
) {

  return {

    type: 'walk',

    from,

    to,

    distance:
      calculateDistance(from, to),

    duration:
      Math.max(
        2,
        Math.round(
          calculateDistance(from, to) *
          12
        )
      )

  };

}


/* =========================================================
   PUBLIC TRANSPORT SEGMENT
========================================================= */

function createTransportSegment(
  type,
  from,
  to
) {

  const distance =
    calculateDistance(
      from,
      to
    );


  const speeds = {

    metro: 32,

    bus: 22,

    tram: 19,

    trolley: 20

  };


  const speed =
    speeds[type] || 20;


  return {

    type,

    from,

    to,

    distance,

    duration:
      Math.max(
        3,
        Math.round(
          distance / speed * 60
        ) + 4
      )

  };

}


/* =========================================================
   FIND NEAREST PLACE
========================================================= */

function findNearestPlace(
  coordinates
) {

  let nearest = null;

  let nearestDistance =
    Infinity;


  for (const place of PLACES) {

    const distance =
      calculateDistance(
        coordinates,
        place
      );


    if (
      distance <
      nearestDistance
    ) {

      nearestDistance =
        distance;

      nearest =
        place;

    }

  }


  return nearest;

}


/* =========================================================
   ROUTE ENGINE
========================================================= */

/*
  Това е демонстрационен routing engine.

  Логиката е:

  1. Ако потребителят иска само пеша:
       Start -> End

  2. Ако е включено "Предпочитай градски транспорт":
       Start -> nearest transport point
       -> public transport
       -> nearest point to destination
       -> End

  3. Ако е избран конкретен транспорт:
       използваме него.

  Следващата стъпка е този engine да бъде заменен
  с реален GTFS/маршрутен алгоритъм.
*/

function buildRoute(
  start,
  end,
  selectedTransport,
  preferPublic
) {

  const publicTypes =
    selectedTransport.filter(
      type =>
        [
          'metro',
          'bus',
          'tram',
          'trolley'
        ].includes(type)
    );


  const walkingAllowed =
    selectedTransport.includes('walk');


  /* ---------------------------------------------
     ONLY WALK
  --------------------------------------------- */

  if (
    publicTypes.length === 0 &&
    walkingAllowed
  ) {

    return [
      createWalkingSegment(
        start,
        end
      )
    ];

  }


  /* ---------------------------------------------
     NO TRANSPORT
  --------------------------------------------- */

  if (
    publicTypes.length === 0
  ) {

    return [];

  }


  /*
    Намираме най-близката транспортна точка
    до началната и крайната позиция.
  */

  const startTransport =
    findNearestPlace(start);

  const endTransport =
    findNearestPlace(end);


  /*
    Ако е разрешено ходенето,
    използваме walking segments.
  */

  const route = [];


  if (
    walkingAllowed &&
    calculateDistance(
      start,
      startTransport
    ) > 0.05
  ) {

    route.push(
      createWalkingSegment(
        start,
        startTransport
      )
    );

  }


  /*
    Избираме предпочитания транспорт.

    При включено "предпочитай градски транспорт"
    метро има приоритет.
  */

  let selectedType =
    publicTypes[0];


  if (
    preferPublic &&
    publicTypes.includes('metro')
  ) {

    selectedType =
      'metro';

  }


  /*
    Създаваме транспортния сегмент.
  */

  route.push(
    createTransportSegment(
      selectedType,
      startTransport,
      endTransport
    )
  );


  /*
    Последният пешеходен сегмент.
  */

  if (
    walkingAllowed &&
    calculateDistance(
      endTransport,
      end
    ) > 0.05
  ) {

    route.push(
      createWalkingSegment(
        endTransport,
        end
      )
    );

  }


  return route;

}


/* =========================================================
   ROUTE COLORS
========================================================= */

function getRouteColor(
  type
) {

  const colors = {

    walk: '#4d9b7e',

    metro: '#3276bd',

    bus: '#31915f',

    tram: '#d17a2e',

    trolley: '#8d65aa'

  };


  return colors[type] ||
    '#e3a917';

}


/* =========================================================
   ROUTE LABELS
========================================================= */

function getTransportLabel(
  type
) {

  const labels = {

    walk: '🚶 Пеша',

    metro: 'Ⓜ Метро',

    bus: '🚌 Автобус',

    tram: '🚋 Трамвай',

    trolley: '⚡ Тролей'

  };


  return labels[type] ||
    type;

}


/* =========================================================
   DRAW ROUTE
========================================================= */

function drawRoute(
  start,
  end,
  route
) {

  if (!map) {

    setMessage(
      'Картата не е достъпна. Провери интернет връзката.',
      'error'
    );

    return;

  }


  if (routeLayer) {

    map.removeLayer(
      routeLayer
    );

  }


  const layers = [];

  const allPoints = [];


  /*
    START MARKER
  */

  const startPoint =
    [start.lat, start.lng];

  const endPoint =
    [end.lat, end.lng];


  layers.push(

    L.marker(
      startPoint,
      {
        icon:
          makePin('A')
      }
    )
      .bindPopup(
        `Начало: ${start.name}`
      )

  );


  layers.push(

    L.marker(
      endPoint,
      {
        icon:
          makePin(
            'Б',
            true
          )
      }
    )
      .bindPopup(
        `Край: ${end.name}`
      )

  );


  allPoints.push(
    startPoint
  );

  allPoints.push(
    endPoint
  );


  /*
    ROUTE SEGMENTS
  */

  route.forEach(
    segment => {

      const from = [
        segment.from.lat,
        segment.from.lng
      ];

      const to = [
        segment.to.lat,
        segment.to.lng
      ];


      allPoints.push(
        from,
        to
      );


      const color =
        getRouteColor(
          segment.type
        );


      const dash =
        segment.type === 'walk'
          ? '5 8'
          : null;


      layers.push(

        L.polyline(
          [
            from,
            to
          ],
          {

            color,

            weight:
              segment.type === 'walk'
                ? 4
                : 6,

            opacity: .92,

            dashArray:
              dash

          }
        )

      );

    }
  );


  routeLayer =
    L.featureGroup(
      layers
    )
      .addTo(map);


  /*
    FIT MAP
  */

  const bounds =
    L.latLngBounds(
      allPoints
    );


  map.fitBounds(
    bounds.pad(.25),
    {
      maxZoom: 14,
      animate: true
    }
  );


  /*
    CAPTION
  */

  caption.textContent =
    `${start.name} → ${end.name}`;


  /*
    MESSAGE
  */

  const totalDuration =
    route.reduce(
      (sum, segment) =>
        sum + segment.duration,
      0
    );


  const routeNames =
    route.map(
      segment =>
        getTransportLabel(
          segment.type
        )
    );


  setMessage(
    `Маршрутът е приблизително ${totalDuration} мин. · ${routeNames.join(' → ')}`,
    'success'
  );


  /*
    ROUTE INFO CARD
  */

  createRouteInfo(
    start,
    end,
    route,
    totalDuration
  );

}


/* =========================================================
   ROUTE INFO CARD
========================================================= */

function createRouteInfo(
  start,
  end,
  route,
  totalDuration
) {

  const existing =
    document.querySelector(
      '.route-result'
    );


  if (existing) {
    existing.remove();
  }


  const result =
    document.createElement(
      'div'
    );


  result.className =
    'route-result';


  const steps =
    route
      .map(
        segment => {

          const label =
            getTransportLabel(
              segment.type
            );

          return `
            <span class="route-step">
              <strong>${label}</strong>
              ${Math.round(segment.duration)} мин.
            </span>
          `;

        }
      )
      .join('');


  result.innerHTML = `

    <div class="route-result-header">

      <span class="route-result-title">
        ${start.name} → ${end.name}
      </span>

      <span class="route-result-time">
        ~${totalDuration} мин.
      </span>

    </div>

    <div class="route-result-steps">
      ${steps}
    </div>

  `;


  const mapShell =
    document.querySelector(
      '.map-shell'
    );


  mapShell.appendChild(
    result
  );

}


/* =========================================================
   CURRENT LOCATION
========================================================= */

function useCurrentLocation() {

  if (
    !navigator.geolocation
  ) {

    locationStatus.textContent =
      'Твоят браузър не поддържа геолокация.';

    setMessage(
      'Геолокацията не се поддържа от този браузър.',
      'error'
    );

    return;

  }


  locationButton.disabled =
    true;


  locationStatus.textContent =
    'Определяме местоположението…';


  navigator.geolocation.getCurrentPosition(

    position => {

      userLocation = {

        name: 'Текущото ми местоположение',

        lat:
          position.coords.latitude,

        lng:
          position.coords.longitude

      };


      /*
        Не поставяме координатите
        директно в input-а.

        Използваме специално име,
        което routing engine разпознава.
      */

      fromInput.value =
        'Текущото ми местоположение';


      locationStatus.textContent =
        'Местоположението е намерено ✓';


      locationButton.disabled =
        false;


      setMessage(
        'Текущото ти местоположение е зададено като начална точка.',
        'success'
      );


      /*
        Показваме GPS позицията на картата.
      */

      if (map) {

        if (
          window.currentLocationMarker
        ) {

          map.removeLayer(
            window.currentLocationMarker
          );

        }


        window.currentLocationMarker =
          L.circleMarker(
            [
              userLocation.lat,
              userLocation.lng
            ],
            {

              radius: 8,

              color: '#fff',

              weight: 3,

              fillColor: '#267fdf',

              fillOpacity: 1

            }
          )
            .addTo(map)
            .bindPopup(
              'Текущото ти местоположение'
            );


        map.setView(
          [
            userLocation.lat,
            userLocation.lng
          ],
          14
        );

      }

    },

    error => {

      locationButton.disabled =
        false;


      const errors = {

        1:
          'Разрешението за местоположение е отказано.',

        2:
          'Местоположението не може да бъде определено.',

        3:
          'Изчакването за местоположение изтече.'

      };


      const errorMessage =
        errors[error.code] ||
        'Възникна грешка при геолокацията.';


      locationStatus.textContent =
        errorMessage;


      setMessage(
        errorMessage,
        'error'
      );

    },

    {

      enableHighAccuracy: true,

      timeout: 10000,

      maximumAge: 60000

    }

  );

}


locationButton.addEventListener(
  'click',
  useCurrentLocation
);


/* =========================================================
   SUBMIT
========================================================= */

form.addEventListener(
  'submit',
  event => {

    event.preventDefault();


    let start =
      findPlace(
        fromInput.value
      );


    const end =
      findPlace(
        toInput.value
      );


    /*
      Ако началната точка е GPS.
    */

    if (
      norm(fromInput.value) ===
      norm('Текущото ми местоположение')
    ) {

      if (!userLocation) {

        setMessage(
          'Първо използвай бутона за текущото местоположение.',
          'error'
        );

        return;

      }


      start =
        userLocation;

    }


    /*
      Проверка
    */

    if (!start || !end) {

      setMessage(
        'Избери начална и крайна точка от предложенията или използвай текущото си местоположение.',
        'error'
      );


      if (!start) {

        fromInput.focus();

      } else {

        toInput.focus();

      }


      return;

    }


    /*
      Не позволяваме еднакви точки.
    */

    if (
      start.name === end.name
    ) {

      setMessage(
        'Началната и крайната точка трябва да са различни.',
        'error'
      );

      toInput.focus();

      return;

    }


    /*
      Транспорт
    */

    const selectedTransport =
      getSelectedTransport();


    if (
      selectedTransport.length === 0
    ) {

      setMessage(
        'Избери поне един начин на придвижване.',
        'error'
      );

      return;

    }


    /*
      Preference
    */

    const preferPublic =
      publicTransportPreference.checked;


    /*
      Създаваме маршрута
    */

    const route =
      buildRoute(
        start,
        end,
        selectedTransport,
        preferPublic
      );


    if (
      route.length === 0
    ) {

      setMessage(
        'Не може да бъде изграден маршрут с избраните видове транспорт.',
        'error'
      );

      return;

    }


    /*
      Рисуваме маршрута
    */

    drawRoute(
      start,
      end,
      route
    );

  }
);


/* =========================================================
   SWAP
========================================================= */

swapButton.addEventListener(
  'click',
  () => {

    const oldFrom =
      fromInput.value;

    fromInput.value =
      toInput.value;

    toInput.value =
      oldFrom;


    /*
      Ако потребителят размени
      GPS началната точка,
      тя вече няма да бъде GPS,
      освен ако не я избере отново.
    */

    setMessage(
      'Точките са разменени. Натисни „Покажи маршрута“.'
    );

  }
);


/* =========================================================
   QUICK ROUTES
========================================================= */

document
  .querySelectorAll('.quick-card')
  .forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          fromInput.value =
            button.dataset.from;

          toInput.value =
            button.dataset.to;


          /*
            Автоматично включваме
            метро + пеша за
            бързите маршрути.
          */

          transportCheckboxes
            .forEach(
              checkbox => {

                checkbox.checked =
                  ['walk', 'metro']
                    .includes(
                      checkbox.value
                    );

              }
            );


          updateTransportCounter();


          form.requestSubmit();


          form.scrollIntoView({

            behavior:
              window.matchMedia(
                '(prefers-reduced-motion: reduce)'
              ).matches
                ? 'auto'
                : 'smooth',

            block: 'center'

          });

        }
      );

    }
  );


/* =========================================================
   INITIALIZE
========================================================= */

initializeMap();

updateTransportCounter();