# Pavet

Live public transport map for Sofia. This static site reads the [Sofia Urban Mobility Centre's public GTFS Realtime vehicle-position feed](https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions) directly in the browser. It refreshes every 30 seconds, displays only positions no older than three minutes, and clears vehicle icons if fresh data cannot be retrieved. Nearby vehicles are clustered at city scale. Bus, tram, and trolley icons each have their own color and pictogram; the small label beneath an icon is its line number.

The map also includes official stops from Sofia's static GTFS feed. Metro stations have purple metro pictograms at city scale. Bus, tram, and trolley stops appear as colored dots once you zoom in to level 15. Click a stop to see the lines serving it and the next published arrival for each line. Arrival times come from the [official GTFS Realtime trip-updates feed](https://gtfs.sofiatraffic.bg/api/v1/trip-updates), refresh every 30 seconds, and disappear if the feed becomes stale. Click a line in that popup to draw its path. Use **Спирки и станции** to toggle the stops layer.

Search for a line number (for example `94`) or a mode and number (for example `Трамвай 5`) to show its route. If more than one mode shares a number, choose one from the results. The route card lets you switch directions and published variants. The highlighted line and its stop markers come from the operator's GTFS shapes and stop times. While a route is selected, live vehicle markers are filtered to that line. The place finder searches metro stations and a few central landmarks.

The public vehicle-position and trip-update feeds cover buses, trams, and trolleybuses. **They do not provide live metro train positions or metro arrival times.** Metro icons mark fixed stations, not trains. Metro line paths are available from the static GTFS data. The old approximate route planner was replaced by a place finder because its straight-line routes were not valid trip directions.

## Run locally

```sh
npm ci
npm run build
npx http-server . -p 4173
```

Open `http://localhost:4173`. The generated `transport.js`, `maplibre-gl-worker.mjs`, and `route-paths.json` are committed so static hosting, including GitHub Pages, does not need a build step. Deploy these beside `index.html`. `src/routes.json` maps route IDs to public line numbers and modes; `src/stops.json` contains stop names, codes, coordinates, and modes; `src/stop-lines.json` maps stops to routes. These and `route-paths.json` are generated from the official static GTFS feed. To refresh them:

```sh
npm run update-routes
npm run build
```

The map uses MapLibre GL JS with [OpenFreeMap's Positron vector style](https://openfreemap.org/quick_start/). Attribution for OpenStreetMap, OpenMapTiles, OpenFreeMap, and the Sofia data provider is visible on the map or site. A network connection is required for map tiles and live positions. No API key or backend service is required.

## Data and limitations

- [Sofia Municipality transport data](https://www.sofia.bg/en/transport-data) describes the published feeds and their CC BY 4.0 license.
- Vehicle positions are sampled by the provider. A marker indicates the latest reported position, not a continuously tracked GPS fix.
- Stop-to-line listings and route geometry come from the static GTFS snapshot checked into the repository; run `npm run update-routes` after changes to the operator's network. Temporary diversions may differ from the published shapes.
- Arrival times are only shown for future stop updates in a feed no older than three minutes. A blank time means there is no current prediction for that line at that stop; it is not a claim that no vehicle will arrive.
- Static stops stay visible when the live vehicle feed is unavailable, while the live layer is cleared to avoid showing stale positions.
