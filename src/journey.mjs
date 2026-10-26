const METERS_PER_LATITUDE = 111_200;
const METERS_PER_LONGITUDE = 82_200;
const WALK_METERS_PER_MINUTE = 75;
const MAX_TRANSFERS = 2;

export function distanceMeters(a, b) {
  return Math.hypot((a[0] - b[0]) * METERS_PER_LONGITUDE,
    (a[1] - b[1]) * METERS_PER_LATITUDE);
}

class MinHeap {
  items = [];
  push(value) {
    const items = this.items;
    items.push(value);
    let index = items.length - 1;
    while (index) {
      const parent = (index - 1) >> 1;
      if (items[parent].cost <= value.cost) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = value;
  }
  pop() {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (!items.length) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= items.length) break;
      const right = left + 1;
      const child = right < items.length && items[right].cost < items[left].cost ? right : left;
      if (items[child].cost >= last.cost) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return first;
  }
  get length() { return this.items.length; }
}

function mode(routeId, routes) {
  const type = routes[routeId]?.type;
  return type === 0 ? 'tram' : type === 1 ? 'metro' : type === 11 ? 'trolley' : 'bus';
}

function estimatedRideMinutes(variant, index, from, to, routeMode) {
  const scheduled = variant.times?.[index + 1] - variant.times?.[index];
  if (Number.isFinite(scheduled) && scheduled >= 0.5 && scheduled <= 20) return scheduled;
  const speed = routeMode === 'metro' ? 475 : routeMode === 'tram' ? 290 : 340;
  return Math.max(0.8, distanceMeters(from, to) / speed);
}

export function buildJourneyNetwork(routePaths, stopRows, routes) {
  const stopById = new Map(stopRows.map(row => [row[0], {
    id: row[0], name: row[2], point: [row[4], row[3]], mode: row[5]
  }]));
  const edges = new Map();
  const addEdge = (id, edge) => {
    if (!edges.has(id)) edges.set(id, []);
    edges.get(id).push(edge);
  };
  for (const [routeId, variants] of Object.entries(routePaths)) {
    const routeMode = mode(routeId, routes);
    variants.forEach((variant, variantIndex) => {
      const variantId = `${routeId}:${variantIndex}`;
      for (let index = 0; index < variant.stops.length - 1; index++) {
        const fromId = variant.stops[index];
        const toId = variant.stops[index + 1];
        const from = stopById.get(fromId);
        const to = stopById.get(toId);
        if (!from || !to || fromId === toId) continue;
        addEdge(fromId, {
          type: 'ride', fromId, toId, routeId, variantIndex, variantId,
          mode: routeMode, startIndex: index, endIndex: index + 1,
          minutes: estimatedRideMinutes(variant, index, from.point, to.point, routeMode)
        });
      }
    });
  }

  const activeStops = [...edges.keys()].map(id => stopById.get(id));
  const cellSize = 0.0022;
  const cellKey = (x, y) => `${x}:${y}`;
  const cells = new Map();
  for (const stop of activeStops) {
    const x = Math.floor(stop.point[0] / cellSize);
    const y = Math.floor(stop.point[1] / cellSize);
    const key = cellKey(x, y);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(stop);
  }
  for (const stop of activeStops) {
    const x = Math.floor(stop.point[0] / cellSize);
    const y = Math.floor(stop.point[1] / cellSize);
    const nearby = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const other of cells.get(cellKey(x + dx, y + dy)) || []) {
        if (other.id === stop.id) continue;
        const meters = distanceMeters(stop.point, other.point);
        if (meters <= (stop.mode === 'metro' || other.mode === 'metro' ? 260 : 190)) {
          nearby.push({ other, meters });
        }
      }
    }
    nearby.sort((a, b) => a.meters - b.meters);
    for (const { other, meters } of nearby.slice(0, 10)) {
      addEdge(stop.id, { type: 'walk', fromId: stop.id, toId: other.id,
        minutes: Math.max(0.5, meters / WALK_METERS_PER_MINUTE) });
    }
  }
  return { stopById, activeStops, edges, routePaths };
}

function candidateStops(network, place) {
  return network.activeStops.map(stop => ({
    id: stop.id, meters: distanceMeters(place.point, stop.point)
  })).filter(candidate => candidate.meters <= 900)
    .sort((a, b) => a.meters - b.meters).slice(0, 24);
}

function projectPoint(path, point, minimumPosition) {
  let best = null;
  for (let index = 0; index < path.length - 1; index++) {
    const a = path[index], b = path[index + 1];
    const dx = (b[0] - a[0]) * METERS_PER_LONGITUDE;
    const dy = (b[1] - a[1]) * METERS_PER_LATITUDE;
    const px = (point[0] - a[0]) * METERS_PER_LONGITUDE;
    const py = (point[1] - a[1]) * METERS_PER_LATITUDE;
    const fraction = dx * dx + dy * dy ? Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy))) : 0;
    const position = index + fraction;
    if (position + 0.05 < minimumPosition) continue;
    const snapped = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
    const error = distanceMeters(point, snapped);
    if (!best || error < best.error) best = { position, snapped, error };
  }
  return best;
}

function segmentGeometry(variant, startIndex, endIndex, stopById) {
  const path = variant.path;
  let minimum = 0;
  let start = null, end = null;
  for (let index = 0; index <= endIndex; index++) {
    const stop = stopById.get(variant.stops[index]);
    if (!stop) continue;
    const projection = projectPoint(path, stop.point, minimum);
    if (!projection) continue;
    minimum = projection.position;
    if (index === startIndex) start = projection;
    if (index === endIndex) end = projection;
  }
  if (!start || !end || end.position <= start.position) {
    return variant.stops.slice(startIndex, endIndex + 1)
      .map(id => stopById.get(id)?.point).filter(Boolean);
  }
  const points = [start.snapped];
  for (let index = Math.floor(start.position) + 1; index <= Math.floor(end.position); index++) {
    if (path[index]) points.push(path[index]);
  }
  points.push(end.snapped);
  return points;
}

function makeLegs(network, links, origin, destination) {
  const legs = [];
  for (const edge of links) {
    const fromPoint = edge.fromId ? network.stopById.get(edge.fromId)?.point : origin.point;
    const toPoint = edge.toId ? network.stopById.get(edge.toId)?.point : destination.point;
    if (edge.type === 'walk') {
      const previous = legs.at(-1);
      if (previous?.type === 'walk') {
        previous.toId = edge.toId || null;
        previous.toName = edge.toId ? network.stopById.get(edge.toId)?.name : destination.name;
        previous.points.push(toPoint);
        previous.minutes += edge.minutes;
      } else {
        legs.push({ type: 'walk', fromId: edge.fromId || null, toId: edge.toId || null,
          fromName: edge.fromId ? network.stopById.get(edge.fromId)?.name : origin.name,
          toName: edge.toId ? network.stopById.get(edge.toId)?.name : destination.name,
          points: [fromPoint, toPoint], minutes: edge.minutes });
      }
      continue;
    }
    const previous = legs.at(-1);
    if (previous?.type === 'ride' && previous.variantId === edge.variantId) {
      previous.toId = edge.toId;
      previous.toName = network.stopById.get(edge.toId)?.name;
      previous.endIndex = edge.endIndex;
      previous.stopCount++;
      previous.minutes += edge.minutes;
    } else {
      legs.push({ type: 'ride', routeId: edge.routeId, variantIndex: edge.variantIndex,
        variantId: edge.variantId, mode: edge.mode, fromId: edge.fromId, toId: edge.toId,
        fromName: network.stopById.get(edge.fromId)?.name,
        toName: network.stopById.get(edge.toId)?.name,
        startIndex: edge.startIndex, endIndex: edge.endIndex, stopCount: 1,
        minutes: edge.minutes });
    }
  }
  for (const leg of legs) {
    if (leg.type !== 'ride') continue;
    const variant = network.routePaths[leg.routeId][leg.variantIndex];
    leg.headsign = variant.headsign;
    leg.points = segmentGeometry(variant, leg.startIndex, leg.endIndex, network.stopById);
  }
  return legs;
}

export function findJourney(network, origin, destination) {
  const start = candidateStops(network, origin);
  const finish = candidateStops(network, destination);
  if (!start.length || !finish.length) return null;
  const finishCosts = new Map(finish.map(item => [item.id, item.meters / WALK_METERS_PER_MINUTE]));
  const heap = new MinHeap();
  const best = new Map();
  const previous = new Map();
  const stateKey = state => `${state.stopId}|${state.variantId}|${state.boarded ? 1 : 0}|${state.transfers}`;
  for (const item of start) {
    const state = { stopId: item.id, variantId: '-', boarded: false, transfers: 0,
      cost: item.meters / WALK_METERS_PER_MINUTE };
    const key = stateKey(state);
    best.set(key, state.cost);
    previous.set(key, { key: null, edge: { type: 'walk', fromId: null, toId: item.id, minutes: state.cost } });
    heap.push({ ...state, key });
  }
  let winner = null;
  let winnerCost = Infinity;
  const directDistance = distanceMeters(origin.point, destination.point);
  if (directDistance <= 1400) winnerCost = directDistance / WALK_METERS_PER_MINUTE;
  while (heap.length) {
    const state = heap.pop();
    if (state.cost !== best.get(state.key)) continue;
    if (state.cost >= winnerCost) break;
    const finalWalk = finishCosts.get(state.stopId);
    if (finalWalk !== undefined && state.cost + finalWalk < winnerCost) {
      winner = state;
      winnerCost = state.cost + finalWalk;
    }
    for (const edge of network.edges.get(state.stopId) || []) {
      const continuing = edge.type === 'ride' && state.variantId === edge.variantId;
      const transfers = edge.type === 'ride' && !continuing && state.boarded
        ? state.transfers + 1 : state.transfers;
      if (transfers > MAX_TRANSFERS) continue;
      const boarding = edge.type === 'ride' && !continuing ? (state.boarded ? 5 : 3.5) : 0;
      const next = {
        stopId: edge.toId,
        variantId: edge.type === 'ride' ? edge.variantId : '-',
        boarded: state.boarded || edge.type === 'ride', transfers,
        cost: state.cost + edge.minutes + boarding
      };
      if (next.cost >= winnerCost) continue;
      const key = stateKey(next);
      if (next.cost >= (best.get(key) ?? Infinity)) continue;
      best.set(key, next.cost);
      previous.set(key, { key: state.key, edge });
      heap.push({ ...next, key });
    }
  }
  if (!winner) {
    if (directDistance <= 1400) return { minutes: winnerCost, transfers: 0,
      legs: [{ type: 'walk', fromName: origin.name, toName: destination.name,
        points: [origin.point, destination.point], minutes: winnerCost }] };
    return null;
  }
  const links = [{ type: 'walk', fromId: winner.stopId, toId: null,
    minutes: finishCosts.get(winner.stopId) }];
  let key = winner.key;
  while (key) {
    const item = previous.get(key);
    links.push(item.edge);
    key = item.key;
  }
  links.reverse();
  return { minutes: winnerCost, transfers: winner.transfers,
    legs: makeLegs(network, links, origin, destination) };
}
