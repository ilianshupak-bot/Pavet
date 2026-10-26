# Pavet

Live public transport map for Sofia. This static site reads the [Sofia Urban Mobility Centre's public GTFS Realtime vehicle-position feed](https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions) directly in the browser. It refreshes every 30 seconds, displays only positions no older than three minutes, and clears vehicle icons if fresh data cannot be retrieved. Nearby vehicles are clustered at city scale. Bus, tram, and trolley icons each have their own color and pictogram; the small label beneath an icon is its line number.

The map also includes official stops from Sofia's static GTFS feed. Metro stations have purple metro pictograms at city scale. Bus, tram, and trolley stops appear as colored dots once you zoom in to level 15. Click any stop or station for its name and, where available, public stop code. Use **Спирки и станции** to toggle this layer. Use the transport mode toggles or enter an exact line number to filter live vehicles; the place finder searches metro stations and a few central landmarks.

The public vehicle-position feed covers buses, trams, and trolleybuses. **It does not provide live metro train positions.** Metro icons mark fixed stations, not trains. The old approximate route planner was replaced by a place finder because its straight-line routes were not valid trip directions.

## Run locally

```sh
npm ci
npm run build
npx http-server . -p 4173
```

Open `http://localhost:4173`. The generated `transport.js` and `maplibre-gl-worker.mjs` are committed so static hosting, including GitHub Pages, does not need a build step. Deploy both files beside `index.html`. `src/routes.json` maps route IDs to public line numbers and modes; `src/stops.json` contains stop names, codes, coordinates, and modes. Both are generated from the official static GTFS feed. To refresh them:

```sh
npm run update-routes
npm run build
```

The map uses MapLibre GL JS with [OpenFreeMap's Positron vector style](https://openfreemap.org/quick_start/). Attribution for OpenStreetMap, OpenMapTiles, OpenFreeMap, and the Sofia data provider is visible on the map or site. A network connection is required for map tiles and live positions. No API key or backend service is required.

## Data and limitations

- [Sofia Municipality transport data](https://www.sofia.bg/en/transport-data) describes the published feeds and their CC BY 4.0 license.
- Vehicle positions are sampled by the provider. A marker indicates the latest reported position, not a continuously tracked GPS fix.
- Stop and route labels come from the static GTFS snapshot checked into `src/stops.json` and `src/routes.json`; run `npm run update-routes` after changes to the operator's network.
- Static stops stay visible when the live vehicle feed is unavailable, while the live layer is cleared to avoid showing stale positions.
