const fs = require('fs');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');

const STATIC_URL = 'https://gtfs.sofiatraffic.bg/api/v1/static';

async function main() {
  const response = await fetch(STATIC_URL);
  if (!response.ok) throw new Error(`GTFS download failed: HTTP ${response.status}`);

  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  const readCsv = name => parse(zip.readAsText(name), {
    columns: true, bom: true, skip_empty_lines: true
  });

  const routeRows = readCsv('routes.txt');
  const routes = Object.fromEntries(routeRows.map(row => [
    row.route_id, { name: row.route_short_name, type: Number(row.route_type) }
  ]));
  fs.writeFileSync('src/routes.json', JSON.stringify(routes));

  const stops = readCsv('stops.txt').flatMap(row => {
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
  console.log(`${routeRows.length} routes, ${stops.length} stops and stations`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
