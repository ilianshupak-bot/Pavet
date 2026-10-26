# Pavet

Live public transport map for Sofia. This static site reads the [Sofia Urban Mobility Centre's public GTFS Realtime vehicle-position feed](https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions) directly in the browser. It refreshes every 30 seconds, displays only positions no older than three minutes, and clears markers if fresh data cannot be retrieved. Nearby vehicles are clustered at city scale. Use the mode toggles or an exact line number to filter the map.

The public vehicle-position feed covers buses, trams, and trolleybuses. **It does not provide live metro train positions.** Metro stations can be located in the place finder, but no metro train is displayed or simulated. The old approximate route planner has been replaced by a place finder because its straight-line routes were not valid trip directions.

## Run locally

```sh
npm ci
npm run build
npx http-server . -p 4173
```

Open `http://localhost:4173`. The generated `transport.js` is committed so static hosting, including GitHub Pages, does not need a build step. `src/routes.json` maps route IDs to public line numbers and modes using the official static GTFS feed. To refresh that mapping:

```sh
npm run update-routes
npm run build
```

The map uses OpenStreetMap tiles through Leaflet. The site shows attribution for both OpenStreetMap and the Sofia data provider. A network connection is required for tiles and live positions. No API key or backend service is required.

## Data and limitations

- [Sofia Municipality transport data](https://www.sofia.bg/en/transport-data) describes the published feeds and their CC BY 4.0 license.
- Vehicle positions are sampled by the provider. A marker indicates the latest reported position, not a continuously tracked GPS fix.
- Route labels come from the static GTFS snapshot checked into `src/routes.json`; run `npm run update-routes` after changes to the operator's route list.
