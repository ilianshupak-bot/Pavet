const fs = require('fs');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
async function main() {
const response = await fetch('https://gtfs.sofiatraffic.bg/api/v1/static');
if (!response.ok) throw new Error(`GTFS download failed: HTTP ${response.status}`);
const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
const rows = parse(zip.readAsText('routes.txt'), { columns: true, bom: true, skip_empty_lines: true });
const routes = Object.fromEntries(rows.map(row => [row.route_id, { name: row.route_short_name, type: Number(row.route_type) }]));
fs.writeFileSync('src/routes.json', JSON.stringify(routes));
console.log(`${rows.length} routes`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
