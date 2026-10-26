const fs = require('fs');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');

const STATIC_URL = 'https://gtfs.sofiatraffic.bg/api/v1/static';
const round = number => Number(Number(number).toFixed(5));
const timeMinutes = value => {
  const parts = value?.split(':').map(Number);
  return parts?.length === 3 && parts.every(Number.isFinite)
    ? parts[0] * 60 + parts[1] + parts[2] / 60 : null;
};

// Keep the static site light while following the operator's actual shape.
function simplify(points, tolerance = 0.00012) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    const [ax, ay] = points[start];
    const [bx, by] = points[end];
    const dx = (bx - ax) * 0.74;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    let farthest = -1;
    let maxDistance2 = tolerance * tolerance;
    for (let index = start + 1; index < end; index++) {
      const px = (points[index][0] - ax) * 0.74;
      const py = points[index][1] - ay;
      const fraction = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0;
      const distance2 = (px - fraction * dx) ** 2 + (py - fraction * dy) ** 2;
      if (distance2 > maxDistance2) { maxDistance2 = distance2; farthest = index; }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

async function main() {
  const response = await fetch(STATIC_URL);
  if (!response.ok) throw new Error(`GTFS download failed: HTTP ${response.status}`);
  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  const readCsv = name => parse(zip.readAsText(name), { columns: true, bom: true, skip_empty_lines: true });

  const routeRows = readCsv('routes.txt');
  const routes = Object.fromEntries(routeRows.map(row => [
    row.route_id, { name: row.route_short_name, type: Number(row.route_type) }
  ]));
  fs.writeFileSync('src/routes.json', JSON.stringify(routes));

  const stopRows = readCsv('stops.txt');
  const parentStations = new Map(stopRows.filter(row => row.parent_station)
    .map(row => [row.stop_id, row.parent_station]));
  const stops = stopRows.flatMap(row => {
    const lat = Number(row.stop_lat);
    const lng = Number(row.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !row.stop_name) return [];
    let mode;
    if (row.location_type === '1') mode = 'metro';
    else if (row.location_type === '0' && row.stop_id.startsWith('TM')) mode = 'tram';
    else if (row.location_type === '0' && row.stop_id.startsWith('TB')) mode = 'trolley';
    else if (row.location_type === '0' && row.stop_id.startsWith('A')) mode = 'bus';
    else return [];
    return [[row.stop_id, row.stop_code, row.stop_name,
      Number(lat.toFixed(6)), Number(lng.toFixed(6)), mode]];
  });
  fs.writeFileSync('src/stops.json', JSON.stringify(stops));

  const tripRows = readCsv('trips.txt');
  const trips = new Map(tripRows.map(row => [row.trip_id, row]));
  const stopLines = new Map();
  const variants = new Map();
  const representatives = new Map();
  for (const trip of tripRows) {
    const key = `${trip.route_id}|${trip.shape_id}`;
    if (!representatives.has(key)) representatives.set(key, trip);
  }
  const representativeIds = new Set([...representatives.values()].map(trip => trip.trip_id));
  const representativeStops = new Map();
  for (const row of readCsv('stop_times.txt')) {
    const trip = trips.get(row.trip_id);
    if (!trip) continue;
    const stopId = parentStations.get(row.stop_id) || row.stop_id;
    if (!stopLines.has(stopId)) stopLines.set(stopId, new Set());
    stopLines.get(stopId).add(trip.route_id);
    if (representativeIds.has(row.trip_id)) {
      if (!representativeStops.has(row.trip_id)) representativeStops.set(row.trip_id, []);
      representativeStops.get(row.trip_id).push([
        Number(row.stop_sequence), stopId, timeMinutes(row.departure_time || row.arrival_time)
      ]);
    }
  }
  fs.writeFileSync('src/stop-lines.json', JSON.stringify(Object.fromEntries(
    [...stopLines].map(([id, lines]) => [id, [...lines].sort((a, b) =>
      (routes[a]?.name || a).localeCompare(routes[b]?.name || b, 'bg', { numeric: true }))])
  )));

  const usedShapes = new Set([...representatives.values()].map(trip => trip.shape_id));
  const shapePoints = new Map();
  for (const row of readCsv('shapes.txt')) {
    if (!usedShapes.has(row.shape_id)) continue;
    if (!shapePoints.has(row.shape_id)) shapePoints.set(row.shape_id, []);
    shapePoints.get(row.shape_id).push([Number(row.shape_pt_sequence), round(row.shape_pt_lon), round(row.shape_pt_lat)]);
  }
  for (const trip of representatives.values()) {
    const points = (shapePoints.get(trip.shape_id) || []).sort((a, b) => a[0] - b[0])
      .map(([, lng, lat]) => [lng, lat]);
    const path = simplify(points);
    if (path.length < 2) continue;
    const timedStops = (representativeStops.get(trip.trip_id) || []).sort((a, b) => a[0] - b[0]);
    const stopIds = timedStops.map(([, id]) => id);
    const times = timedStops.map(([, , minutes]) => minutes === null ? null : Math.round(minutes * 10) / 10);
    if (!variants.has(trip.route_id)) variants.set(trip.route_id, []);
    variants.get(trip.route_id).push({
      id: trip.shape_id, headsign: trip.trip_headsign || '', path, stops: stopIds, times
    });
  }
  fs.writeFileSync('route-paths.json', JSON.stringify(Object.fromEntries(variants)));
  console.log(`${routeRows.length} routes, ${stops.length} stops, ${representatives.size} path variants`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
