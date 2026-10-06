// Importació d'activitats: Polar Flow (AccessLink), Strava i fitxers GPX/TCX, sempre via el Worker.
// Cada activitat de córrer es casa amb la sessió del pla del mateix dia (o del dia abans/després si estava pendent).

import { CONFIG } from './config.js';
import { iso, fromIso, addDays } from './plan.js';

export function connCfg(state) {
  const s = state.settings || {};
  return {
    polarId: (s.polarClientId || CONFIG.polarClientId || '').trim(),
    stravaId: (s.stravaClientId || CONFIG.stravaClientId || '').trim(),
    worker: (s.worker || s.stravaWorker || CONFIG.worker || '').trim().replace(/\/$/, ''),
  };
}

const redirectUri = () => location.origin + location.pathname;

export function authUrl(state, provider) {
  const c = connCfg(state);
  if (provider === 'polar') {
    const p = new URLSearchParams({ response_type: 'code', client_id: c.polarId, redirect_uri: redirectUri(), scope: 'accesslink.read_all', state: 'pacely-polar' });
    return `https://flow.polar.com/oauth2/authorization?${p}`;
  }
  const p = new URLSearchParams({ client_id: c.stravaId, response_type: 'code', redirect_uri: redirectUri(), approval_prompt: 'auto', scope: 'read,activity:read_all', state: 'pacely-strava' });
  return `https://www.strava.com/oauth/authorize?${p}`;
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

// Torna { provider, result } o null si la pàgina no ve d'una autorització
export async function handleRedirect(state) {
  const p = new URLSearchParams(location.search);
  const st = p.get('state');
  if (st !== 'pacely-polar' && st !== 'pacely-strava') return null;
  const provider = st.split('-')[1];
  const keep = new URLSearchParams(location.search);
  ['state', 'code', 'scope', 'error'].forEach(k => keep.delete(k));
  history.replaceState(null, '', location.pathname + (keep.toString() ? `?${keep}` : '') + '#perfil');
  if (p.get('error') || !p.get('code')) return { provider, result: 'denied' };
  const { worker } = connCfg(state);
  if (provider === 'polar') {
    const d = await post(`${worker}/polar/token`, { code: p.get('code'), redirect_uri: redirectUri() });
    state.polar = { access: d.access_token, userId: d.user_id, lastSync: 0, connectedAt: Date.now() };
  } else {
    if (!(p.get('scope') || '').includes('activity:read')) return { provider, result: 'noscope' };
    const d = await post(`${worker}/token`, { code: p.get('code') });
    state.strava = { access: d.access_token, refresh: d.refresh_token, expires: d.expires_at, athlete: d.athlete?.firstname || '', lastSync: 0 };
  }
  return { provider, result: 'connected' };
}

async function get(state, provider, path, asText) {
  const { worker } = connCfg(state);
  let tok, url;
  if (provider === 'polar') { tok = state.polar.access; url = `${worker}/polar/api/${path}`; }
  else { tok = await stravaToken(state); url = `${worker}/api/${path}`; }
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  const name = provider === 'polar' ? 'Polar' : 'Strava';
  if (r.status === 401 || r.status === 403) throw new Error(`${name} ha retirat el permís. Torna a connectar.`);
  if (r.status === 429) throw new Error(`${name} limita les peticions. Prova-ho d'aquí a 15 minuts.`);
  if (r.status === 204 || r.status === 404) return asText ? '' : [];
  if (!r.ok) throw new Error(`${name} ha respost amb error ${r.status}`);
  return asText ? r.text() : r.json();
}

async function stravaToken(state) {
  const s = state.strava;
  if (s.expires - 120 > Date.now() / 1000) return s.access;
  const d = await post(`${connCfg(state).worker}/token`, { refresh_token: s.refresh });
  Object.assign(s, { access: d.access_token, refresh: d.refresh_token, expires: d.expires_at });
  return s.access;
}

// "PT1H2M3.5S" → segons
const isoDur = s => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(s || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };

// Descarrega curses noves. Torna el nombre d'activitats noves.
export async function syncProvider(state, provider, sinceIso) {
  state.activities ||= {};
  let added = 0;
  const put = a => { if (!state.activities[a.key]) added++; state.activities[a.key] = { ...state.activities[a.key], ...a }; };
  if (provider === 'polar') {
    // AccessLink dona les sessions dels últims 30 dies pujades després de connectar
    const list = await get(state, 'polar', 'exercises');
    for (const e of Array.isArray(list) ? list : []) {
      const sport = `${e.sport || ''} ${e.detailed_sport_info || ''}`.toUpperCase();
      if (!sport.includes('RUN')) continue;
      const date = (e.start_time || '').slice(0, 10);
      if (!date || date < sinceIso) continue;
      put({ key: `polar:${e.id}`, source: 'polar', extId: e.id, name: (e.detailed_sport_info || 'Running').replace(/_/g, ' ').toLowerCase(),
        date, km: Math.round((e.distance || 0) / 10) / 100, sec: Math.round(isoDur(e.duration)), elapsed: Math.round(isoDur(e.duration)),
        hr: e.heart_rate?.average || null });
    }
    state.polar.lastSync = Date.now();
  } else {
    const after = Math.floor(fromIso(sinceIso).getTime() / 1000) - 86400;
    for (let page = 1; page <= 10; page++) {
      const list = await get(state, 'strava', `athlete/activities?after=${after}&per_page=100&page=${page}`);
      for (const a of list) {
        if (!['Run', 'TrailRun', 'VirtualRun'].includes(a.sport_type || a.type)) continue;
        put({ key: `strava:${a.id}`, source: 'strava', extId: a.id, name: a.name, date: a.start_date_local.slice(0, 10),
          km: Math.round(a.distance / 10) / 100, sec: a.moving_time, elapsed: a.elapsed_time,
          hr: a.average_heartrate ? Math.round(a.average_heartrate) : null });
      }
      if (list.length < 100) break;
    }
    state.strava.lastSync = Date.now();
  }
  return added;
}

// Millor temps en una distància (per als tests), sense comptar l'escalfament
export async function fetchBestEffort(state, act, distM) {
  act.best ||= {};
  if (act.best[distM] !== undefined) return act.best[distM];
  let best = null;
  if (act.source === 'strava' && state.strava) {
    const d = await get(state, 'strava', `activities/${act.extId}`);
    const name = distM === 5000 ? '5K' : distM === 10000 ? '10K' : null;
    best = (d.best_efforts || []).find(b => b.name === name)?.elapsed_time || null;
  } else if (act.source === 'polar' && state.polar) {
    const tcx = await get(state, 'polar', `exercises/${act.extId}/tcx`, true);
    if (tcx) best = bestFromPoints(trackPoints(tcx), distM);
  } else if (act.points) best = bestFromPoints(act.points, distM);
  act.best[distM] = best ? Math.round(best) : null;
  return act.best[distM];
}

// ---------- Fitxers i recorreguts ----------
const NS = (el, tag) => [...el.getElementsByTagNameNS('*', tag)];
const num = el => (el ? parseFloat(el.textContent) : NaN);

function haversine(a, b) {
  const R = 6371000, toR = x => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const parseXml = text => new DOMParser().parseFromString(text, 'application/xml');

// Punts [temps relatiu (s), distància acumulada (m)] d'un TCX o GPX
export function trackPoints(textOrXml) {
  const xml = typeof textOrXml === 'string' ? parseXml(textOrXml) : textOrXml;
  const root = xml.documentElement?.localName;
  const out = [];
  if (root === 'TrainingCenterDatabase') {
    for (const tp of NS(xml, 'Trackpoint')) {
      const t = NS(tp, 'Time')[0]?.textContent, d = num(NS(tp, 'DistanceMeters')[0]);
      if (t && isFinite(d)) out.push([Date.parse(t) / 1000, d]);
    }
  } else if (root === 'gpx') {
    let prev = null, acc = 0;
    for (const p of NS(xml, 'trkpt')) {
      const pt = { lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon') };
      const t = NS(p, 'time')[0]?.textContent;
      if (!t) continue;
      if (prev) acc += haversine(prev, pt);
      prev = pt;
      out.push([Date.parse(t) / 1000, acc]);
    }
  }
  const t0 = out[0]?.[0] || 0;
  return out.map(([t, d]) => [t - t0, d]);
}

export function bestFromPoints(pts, distM) {
  if (!pts?.length || pts.at(-1)[1] < distM * 0.98) return null;
  let best = Infinity, i = 0;
  for (let j = 1; j < pts.length; j++) {
    while (i + 1 < j && pts[j][1] - pts[i + 1][1] >= distM) i++;
    const dd = pts[j][1] - pts[i][1];
    if (dd >= distM) best = Math.min(best, (pts[j][0] - pts[i][0]) * (distM / dd));
  }
  return isFinite(best) ? best : null;
}

export function parseActivityFile(text, fileName) {
  const xml = parseXml(text);
  if (xml.getElementsByTagName('parsererror').length) throw new Error(`${fileName}: no és un fitxer GPX o TCX vàlid.`);
  const root = xml.documentElement.localName;
  let start, km, sec, hr = null;
  if (root === 'TrainingCenterDatabase') {
    const laps = NS(xml, 'Lap');
    if (!laps.length) throw new Error(`${fileName}: el TCX no té voltes.`);
    start = laps[0].getAttribute('StartTime');
    sec = laps.reduce((a, l) => a + (num(NS(l, 'TotalTimeSeconds')[0]) || 0), 0);
    km = laps.reduce((a, l) => a + (num(NS(l, 'DistanceMeters')[0]) || 0), 0) / 1000;
    const hrs = laps.map(l => [num(NS(NS(l, 'AverageHeartRateBpm')[0] || l, 'Value')[0]), num(NS(l, 'TotalTimeSeconds')[0])]).filter(([h]) => h > 0);
    if (hrs.length) hr = Math.round(hrs.reduce((a, [h, t]) => a + h * t, 0) / hrs.reduce((a, [, t]) => a + t, 0));
  } else if (root === 'gpx') {
    const pts = NS(xml, 'trkpt').map(p => ({ lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'), t: NS(p, 'time')[0]?.textContent, hr: num(NS(p, 'hr')[0]) }));
    if (pts.length < 2) throw new Error(`${fileName}: el GPX no té recorregut.`);
    let m = 0;
    for (let i = 1; i < pts.length; i++) m += haversine(pts[i - 1], pts[i]);
    km = m / 1000;
    start = pts[0].t;
    sec = pts.at(-1).t && start ? (new Date(pts.at(-1).t) - new Date(start)) / 1000 : 0;
    const h = pts.map(p => p.hr).filter(x => x > 0);
    if (h.length) hr = Math.round(h.reduce((a, b) => a + b, 0) / h.length);
  } else throw new Error(`${fileName}: format no reconegut. Fes servir GPX o TCX.`);
  if (!start) throw new Error(`${fileName}: no té data d'inici.`);
  // Reduïm els punts (un cada ~5 s) per poder calcular el millor 5K/10K sense ocupar massa espai
  const pts = trackPoints(xml);
  const slim = pts.filter((p, i) => i === 0 || i === pts.length - 1 || p[0] - (pts[i - 1]?.[0] ?? 0) >= 5 || i % 5 === 0).map(([t, d]) => [Math.round(t), Math.round(d)]);
  return { key: `file:${start}`, source: 'file', extId: start, name: fileName.replace(/\.(gpx|tcx)$/i, ''), date: iso(new Date(start)),
    km: Math.round(km * 100) / 100, sec: Math.round(sec), elapsed: Math.round(sec), hr, points: slim };
}

// ---------- Casar activitats amb el pla ----------
// Crea registres per a les sessions sense registre manual. Torna la llista de sessions casades.
export function matchActivities(state, sessions) {
  const runs = sessions.filter(s => s.km);
  const byDate = {};
  for (const s of runs) (byDate[s.date] ||= []).push(s);
  const acts = Object.values(state.activities || {}).sort((a, b) => a.date.localeCompare(b.date) || b.km - a.km);
  const taken = new Set(Object.values(state.logs).filter(l => l.actKey).map(l => l.actKey));
  const actDates = new Set(acts.filter(x => !x.ignored).map(x => x.date));
  const matched = [];
  for (const a of acts) {
    if (taken.has(a.key) || a.ignored) continue;
    const free = s => !state.logs[s.id];
    const sameDay = (byDate[a.date] || []).filter(free);
    const near = [-1, 1].flatMap(o => (byDate[iso(addDays(fromIso(a.date), o))] || [])
      .filter(s => free(s) && !actDates.has(s.date) && Math.abs(a.km - s.km) / s.km < 0.3));
    const s = sameDay.sort((x, y) => Math.abs(x.km - a.km) - Math.abs(y.km - a.km))[0] || near[0];
    if (!s) continue;
    const isRace = s.type === 'race' && Math.abs(a.km * 1000 - s.distM) / s.distM < 0.04;
    state.logs[s.id] = {
      id: s.id, date: s.date, type: s.type, title: s.title, status: 'done', km: a.km,
      sec: s.type === 'test' ? null : isRace ? a.elapsed : a.sec, actSec: a.sec,
      rpe: null, notes: '', distM: s.distM || null, targetKm: s.km, hr: a.hr,
      source: a.source, actKey: a.key, actName: a.name, needsRpe: true, needsTime: s.type === 'test',
      savedAt: new Date().toISOString(),
    };
    taken.add(a.key);
    matched.push(s);
  }
  return matched;
}
