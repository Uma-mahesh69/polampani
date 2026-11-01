// Leaflet helpers (Leaflet is self-hosted under /vendor/leaflet).
import { esc } from './core.js';

export const VIZAG = [17.75, 83.1];
const maps = new Set();

export function createMap(el, { center = VIZAG, zoom = 11, interactive = true } = {}) {
  if (!window.L || !el) return null;
  const map = L.map(el, {
    scrollWheelZoom: false,
    zoomControl: interactive,
    dragging: interactive,
    tap: interactive,
    attributionControl: true,
  }).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap',
  }).addTo(map);
  map.attributionControl.setPrefix(false);
  maps.add(map);
  map.on('unload', () => maps.delete(map));
  // Leaflet needs a size recalculation when its container appears after layout.
  setTimeout(() => map.invalidateSize(), 60);
  return map;
}

export function destroyMaps() {
  for (const m of [...maps]) {
    try { m.remove(); } catch { /* already removed */ }
  }
  maps.clear();
}

export function pin(kind, label = '') {
  return L.divIcon({
    className: '',
    html: `<div class="pin pin-${kind}"><span>${esc(label)}</span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -36],
  });
}

export function dot(color = '#1F6B43') {
  return { radius: 6, weight: 2, color: '#fff', fillColor: color, fillOpacity: 0.95 };
}

export function fit(map, points, pad = 40) {
  if (!map || !points.length) return;
  if (points.length === 1) { map.setView(points[0], 13); return; }
  map.fitBounds(L.latLngBounds(points), { padding: [pad, pad], maxZoom: 14 });
}
