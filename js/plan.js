// Generador de plans i motor d'adaptació.
// El pla es recalcula sencer a partir del perfil i dels registres, setmana a setmana,
// de manera que el que ja has fet decideix els ritmes i el volum de les setmanes següents.

import { vdotFrom, predict, zones, DIST } from './vdot.js';
import { TEMPLATES } from './templates.js';

const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const dow = d => (d.getDay() + 6) % 7; // 0 = dilluns
export const monday = d => addDays(d, -dow(d));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r05 = x => Math.round(x * 2) / 2;
const circ = (a, b) => { const d = Math.abs(a - b) % 7; return Math.min(d, 7 - d); };

const TAPER = { '5k': 1, '10k': 1, '21k': 2, '42k': 3, '50k': 3 };
const TAPER_FRAC = { 1: [0.6], 2: [0.72, 0.5], 3: [0.8, 0.62, 0.45] };
const PEAK = { '5k': [18, 30, 45], '10k': [24, 38, 56], '21k': [30, 42, 62], '42k': [40, 56, 80], '50k': [45, 62, 90] };
// Tirada llarga màxima segons distància i nivell (com Runna: un principiant de 5K no passa de 8 km)
const LONG_CAP = { '5k': [8, 10, 12], '10k': [12, 14, 16], '21k': [18, 20, 22], '42k': [30, 32, 34], '50k': [32, 34, 36] };
const LONG_STEP = { '5k': 1, '10k': 1, '21k': 1.5, '42k': 2, '50k': 2 };
// Part màxima del volum setmanal que pot ser la tirada llarga, segons els dies de córrer
const LONG_MAX_SHARE = { 2: 0.6, 3: 0.5, 4: 0.45, 5: 0.4, 6: 0.36, 7: 0.33 };
const LI = { beg: 0, int: 1, adv: 2 };
// Volum actual per defecte si no se sap: [km per setmana, tirada més llarga del darrer mes]
export const CUR_DEFAULT = { beg: [10, 4], int: [20, 7], adv: [35, 12] };
const WARM = [1, 1.5, 2], COOL = [0.5, 1, 1];

export const PHASES = {
  base: { name: 'Base', color: '--ph-base' },
  build: { name: 'Construcció', color: '--ph-build' },
  spec: { name: 'Específica', color: '--ph-spec' },
  peak: { name: 'Pic', color: '--ph-peak' },
  taper: { name: 'Posada a punt', color: '--ph-taper' },
};

function phaseLayout(pre) {
  const peak = pre >= 16 ? 2 : pre >= 8 ? 1 : 0;
  const base = Math.max(1, Math.round(pre * 0.3));
  const build = Math.max(pre >= 4 ? 1 : 0, Math.round(pre * 0.35));
  const spec = Math.max(0, pre - base - build - peak);
  const out = [];
  for (let i = 0; i < base; i++) out.push('base');
  for (let i = 0; i < build; i++) out.push('build');
  for (let i = 0; i < spec; i++) out.push('spec');
  for (let i = 0; i < peak; i++) out.push('peak');
  return out.slice(0, pre);
}

export function planFrame(profile) {
  let startMon = monday(fromIso(profile.startDate));
  const race = profile.raceDate
    ? fromIso(profile.raceDate)
    : addDays(startMon, (profile.weeks - 1) * 7 + (profile.longDay ?? Math.max(...profile.days)));
  let n = Math.round((monday(race) - startMon) / 6048e5) + 1;
  let delayed = false;
  if (n > 26) { startMon = addDays(monday(race), -25 * 7); n = 26; delayed = true; }
  n = Math.max(1, n);
  const tpl = TEMPLATES[profile.template];
  if (tpl) {
    const phases = Array.from({ length: n }, (_, w) => tpl.week(Math.min(w, tpl.weeks - 1), profile.days).phase);
    const taper = phases.filter(x => x === 'taper').length;
    return { startMon, race, n, taper, pre: n - taper, phases, delayed, template: tpl };
  }
  const taper = n <= 3 ? 1 : Math.min(TAPER[profile.distance], n - 2);
  const pre = n - taper;
  const phases = [...phaseLayout(pre), ...Array(taper).fill('taper')];
  return { startMon, race, n, taper, pre, phases, delayed };
}

export function stepsKm(steps) {
  let km = 0;
  for (const s of steps) {
    if (s.k === 'rep') km += s.n * s.km + (s.n - 1) * ((s.recKm || 0) + (s.rec || 0) / 60 * 0.15);
    else if (s.k === 'fart') km += s.n * 0.38;
    else if (s.k === 'hill') km += s.n * 0.3;
    else if (s.k === 'walk') km += s.sec / 720;
    else if (s.k === 'rw') km += s.n * (s.run / 420 + s.walk / 720);
    else if (s.k === 'time') km += s.sec / 420;
    else if (s.k === 'strides') km += s.n * 0.15;
    else km += s.km || 0;
  }
  return Math.round(km * 10) / 10;
}

function mk(type, title, steps, note) {
  return { type, title, steps, km: stepsKm(steps), note: note || '' };
}

// ---------- Sessions ----------

function intervalSession(c) {
  const { phase, deload, vol, dist, level, wInPhase, warm, cool } = c;
  const beg = level === 'beg';
  if (deload && (phase === 'base' || phase === 'build')) {
    const n = beg ? 6 : 8;
    return mk('hills', `Pujades ${n} × 45 s`, [
      { k: 'warm', km: warm, z: 'E' },
      { k: 'hill', n, sec: 45, label: `${n} × 45 s pujant fort, baixada trotant` },
      { k: 'cool', km: cool, z: 'E' },
    ], 'Busca una pujada del 4–6 %. Força i tècnica sense castigar les cames.');
  }
  if (phase === 'base' && beg) {
    const n = clamp(Math.round(vol / 2), 5, 10);
    return mk('fartlek', `Fartlek ${n} × 1 min`, [
      { k: 'warm', km: warm, z: 'E' },
      { k: 'fart', n, label: `${n} × (1 min ràpid / 1 min suau)`, z: 'I' },
      { k: 'cool', km: cool, z: 'E' },
    ], 'El tram ràpid ha de ser alegre però controlat.');
  }
  const short = dist === '5k' || dist === '10k';
  const lists = {
    base: [0.4, 0.6, 0.4],
    build: [0.8, 1.0, 0.6],
    spec: short ? [1.0, 1.2, 0.8] : [1.0, 1.6, 1.2],
    peak: [0.4, 1.0],
    taper: [0.4, 0.8],
  };
  const list = lists[phase];
  const rep = list[wInPhase % list.length];
  let work = clamp(vol * (short ? 0.16 : 0.14), beg ? 1.6 : 2.4, 8);
  if (phase === 'taper') work *= 0.6;
  if (deload) work *= 0.7;
  const n = clamp(Math.round(work / rep), 3, 16);
  const z = rep >= 1.6 ? 'T' : rep <= 0.4 && short ? 'R' : 'I';
  const rec = rep <= 0.4 ? 75 : rep <= 0.8 ? 105 : 135;
  const repTxt = rep < 1 ? `${rep * 1000} m` : `${String(rep).replace('.', ',')} km`;
  return mk('int', `Sèries ${n} × ${repTxt}`, [
    { k: 'warm', km: warm, z: 'E', ...(beg ? {} : { strides: 4 }) },
    { k: 'rep', n, km: rep, z, rec },
    { k: 'cool', km: cool, z: 'E' },
  ], 'Recuperació trotant suau. Si l\'última repetició és clarament més lenta, para una abans.');
}

function tempoSession(c) {
  const { phase, deload, vol, dist, level, warm, cool } = c;
  if (phase === 'base' && level === 'beg') {
    const km = r05(clamp(vol * 0.25, 3, 6));
    const fast = r05(km / 3);
    return mk('tempo', `Progressiu ${String(km).replace('.', ',')} km`, [
      { k: 'run', km: km - fast, z: 'E' },
      { k: 'run', km: fast, z: 'M', label: 'acaba a ritme sostingut' },
    ], 'Comença molt suau i acaba fort però sense patir.');
  }
  const long = dist === '42k' || dist === '50k';
  if (long && (phase === 'spec' || phase === 'peak') && !deload) {
    const km = r05(clamp(vol * 0.2, 6, 16));
    return mk('tempo', `Ritme marató ${String(km).replace('.', ',')} km`, [
      { k: 'warm', km: warm, z: 'E' },
      { k: 'run', km, z: 'M' },
      { k: 'cool', km: cool, z: 'E' },
    ], 'Practica el ritme i l\'avituallament de cursa.');
  }
  let work = r05(clamp(vol * 0.16, level === 'beg' ? 2 : 3, long ? 12 : 9));
  if (deload) work = r05(work * 0.6);
  if (phase === 'taper') work = r05(Math.max(2, work * 0.6));
  let steps, title;
  if (deload || phase === 'spec' || phase === 'taper') {
    steps = [{ k: 'run', km: work, z: 'T' }];
    title = `Tempo ${String(work).replace('.', ',')} km continus`;
  } else {
    const n = phase === 'build' && work >= 4.5 ? 3 : 2;
    const each = r05(work / n);
    steps = [{ k: 'rep', n, km: each, z: 'T', rec: phase === 'peak' ? 60 : phase === 'build' ? 90 : 120 }];
    title = `Tempo ${n} × ${String(each).replace('.', ',')} km`;
  }
  return mk('tempo', title, [{ k: 'warm', km: warm, z: 'E' }, ...steps, { k: 'cool', km: cool, z: 'E' }],
    'Ritme constant de principi a final. Has d\'acabar amb sensació de control.');
}

function longSession(c) {
  const { phase, deload, dist, longKm, level } = c;
  const km = Math.round(clamp(longKm, 3, LONG_CAP[dist][LI[level]]));
  const rpZone = dist === '42k' || dist === '50k' ? 'M' : 'RP';
  const short = dist === '5k' || dist === '10k';
  // Els principiants fan la tirada llarga sempre suau; i si és curta, no té sentit afegir-hi ritme
  if (phase === 'base' || deload || level === 'beg' || km < 6) {
    return mk('long', `Tirada llarga ${km} km`, [{ k: 'run', km, z: 'E' }],
      deload ? 'Setmana de descàrrega: tot suau.' : 'A ritme conversacional. L\'objectiu és temps de peus.');
  }
  if (phase === 'build' || short) {
    const fast = short ? (km >= 8 ? 2 : 1) : Math.max(2, Math.round(km * 0.2));
    return mk('long', `Tirada llarga ${km} km (${fast} finals a ritme)`, [
      { k: 'run', km: km - fast, z: 'E' },
      { k: 'run', km: fast, z: short ? 'M' : rpZone },
    ], 'Acabar ràpid amb les cames cansades és el que més s\'assembla a la cursa.');
  }
  if (phase === 'taper') {
    const fast = Math.min(4, Math.round(km * 0.3));
    return mk('long', `Tirada ${km} km (${fast} a ritme)`, [
      { k: 'run', km: km - fast, z: 'E' }, { k: 'run', km: fast, z: rpZone },
    ], 'Baixem volum però mantenim el ritme de cursa.');
  }
  // específica i pic
  const share = dist === '50k' ? 0.35 : dist === '42k' ? 0.5 : 0.45;
  const blocks = km >= 16 ? 3 : 2;
  const each = Math.max(2, Math.round((km * share) / blocks));
  const easy = Math.max(2, km - blocks * each - (blocks - 1));
  const first = Math.ceil(easy * 0.6);
  return mk('long', `Tirada llarga ${km} km amb ${blocks} × ${each} a ritme`, [
    { k: 'run', km: first, z: 'E' },
    { k: 'rep', n: blocks, km: each, z: rpZone, recKm: 1 },
    { k: 'run', km: easy - first, z: 'E' },
  ], dist === '50k' ? 'Assaja menjar i beure cada 30–40 min.' : 'Practica els gels i el ritme objectiu.');
}

function easySession(km, strides) {
  km = Math.round(clamp(km, 3, 14));
  const steps = [{ k: 'run', km, z: 'E' }];
  if (strides) steps.push({ k: 'strides', n: 4, label: '4 rectes de 100 m ràpides' });
  return mk('easy', `Rodatge ${km} km${strides ? ' + rectes' : ''}`, steps, 'Suau de debò. Si dubtes, més lent.');
}

function testSession(distM, c) {
  const k = distM / 1000;
  return Object.assign(mk('test', `Test ${k}K a fons`, [
    { k: 'warm', km: c.warm, z: 'E', ...(c.level === 'beg' ? {} : { strides: 4 }) },
    { k: 'run', km: k, z: 'TEST', label: `${k} km a fons en pla` },
    { k: 'cool', km: c.cool, z: 'E' },
  ], 'Registra el temps exacte: els ritmes de les setmanes següents es recalcularan.'), { distM });
}

// ---------- "No em trobo al 100%" ----------
// Cada ajust: { kind: 'tired' | 'sick' | 'busy' | 'break', from, to } (dates ISO, inclusives)
export const ADJUST_INFO = {
  tired: { name: 'Estic cansat', help: 'Les sessions dures passen a rodatges suaus i la tirada llarga s\'escurça un 20 %.' },
  sick: { name: 'Estic malalt o lesionat', help: 'Treu totes les sessions d\'aquests dies. Després, 3 dies només suaus.' },
  busy: { name: 'Setmana complicada', help: 'Et quedes amb la tirada llarga i la sessió de qualitat més important. Fora rodatges i força.' },
  break: { name: 'Torno d\'una aturada', help: 'Una setmana per tornar-hi: tot suau i un 30 % menys de quilòmetres.' },
  holiday: { name: 'Vacances o pausa', help: 'Tria els dies. Pots no córrer gens o fer només rodatges suaus. A la tornada, uns dies tranquils per reprendre.' },
};
const QUALITY = ['int', 'tempo', 'fartlek', 'hills', 'test'];

function softened(s, frac, why) {
  const km = Math.max(3, Math.round(s.km * frac));
  return { ...s, type: 'easy', title: `Rodatge suau ${km} km`, steps: [{ k: 'run', km, z: 'E' }], km, adjusted: why, original: s.title,
    note: `Abans: ${s.title}. ${why}` };
}
function shortened(s, frac, why) {
  const steps = s.steps.map(st => (st.k === 'run' && st.z === 'E' ? { ...st, km: Math.max(2, Math.round(st.km * frac * 2) / 2) } : st));
  const x = { ...s, steps, adjusted: why, original: s.title };
  x.km = stepsKm(steps);
  if (s.type === 'long') x.title = s.title.replace(/^Tirada llarga [\d,]+ km/, `Tirada llarga ${String(Math.round(x.km)).replace('.', ',')} km`);
  x.note = `Escurçada per: ${why.toLowerCase()} ${s.note || ''}`.trim();
  return x;
}

export function applyAdjustments(sessions, adjusts, logs) {
  if (!adjusts.length) return sessions;
  const out = [];
  for (const s of sessions) {
    if (logs[s.id] || s.type === 'race') { out.push(s); continue; }
    let x = s, drop = false;
    for (const a of adjusts) {
      const inRange = x.date >= a.from && x.date <= a.to;
      const longGap = a.kind === 'holiday' && !a.easyOnly && (fromIso(a.to) - fromIso(a.from)) / 864e5 >= 4;
      const after = (a.kind === 'sick' || longGap) && x.date > a.to && x.date <= iso(addDays(fromIso(a.to), a.kind === 'sick' ? 3 : 4));
      const why = ADJUST_INFO[a.kind].name;
      if (after && QUALITY.includes(x.type)) x = softened(x, 0.7, a.kind === 'sick' ? 'Tornes d\'estar malalt: avui només suau.' : 'Tornes de vacances: primer uns dies suaus.');
      if (!inRange) continue;
      if (a.kind === 'sick') { drop = true; break; }
      if (a.kind === 'holiday') {
        if (!a.easyOnly || !x.km) { drop = true; break; }
        if (QUALITY.includes(x.type)) x = softened(x, 0.7, 'Vacances: només rodatges suaus.');
        else x = shortened(x, 0.7, why);
      }
      if (a.kind === 'tired' || a.kind === 'break') {
        const frac = a.kind === 'break' ? 0.7 : 0.8;
        if (QUALITY.includes(x.type)) x = softened(x, frac, `${why}: avui toca suau.`);
        else if (x.km) x = shortened(x, frac, why);
      }
      if (a.kind === 'busy') {
        if (x.type === 'easy' || x.type === 'strength' || x.type === 'mobility') { drop = true; break; }
        if (x.type === 'tempo' || x.type === 'fartlek' || x.type === 'hills') {
          // ens quedem només amb les sèries (o el test); el tempo passa a rodatge curt
          x = softened(x, 0.6, 'Setmana complicada: una sessió curta i fàcil.');
        }
      }
    }
    if (!drop) out.push(x);
  }
  return out;
}

// ---------- Generació completa ----------

export function buildPlan(state, todayIso) {
  const p = state.profile;
  const logs = state.logs || {};
  const frame = planFrame(p);
  const D = DIST[p.distance];
  const li = LI[p.level];
  const days = [...p.days].sort((a, b) => a - b);
  const daysN = days.length;
  // Com Runna: el punt de partida és el que ja corres (km per setmana i tirada més llarga),
  // i el volum puja a poc a poc a partir d'aquí, amb un sostre segons distància, nivell i dies.
  const [defKm, defLong] = CUR_DEFAULT[p.level] || CUR_DEFAULT.int;
  const curKm = clamp(Number.isFinite(p.curKm) ? p.curKm : defKm, 0, 200);
  const curLong = clamp(Number.isFinite(p.curLong) ? p.curLong : defLong, 0, 45);
  const startVol = Math.max(daysN * 3, curKm);
  const growth = Math.min(2.2, 1 + 0.1 * Math.max(1, frame.pre - 1));
  const peakVol = clamp(Math.min(PEAK[p.distance][li], daysN * [10, 13, 16][li]), startVol, startVol * growth);
  const longCap = LONG_CAP[p.distance][li];
  let longNow = clamp(Math.round(curLong), 3, longCap), longPeak = longNow;
  const warm = WARM[li], cool = COOL[li];
  const nQuality = daysN === 2 || p.level === 'beg' ? 1 : 2;
  const others = days.filter(d => d !== p.longDay);
  const byFar = [...others].sort((a, b) => circ(b, p.longDay) - circ(a, p.longDay) || a - b);
  const startIso = p.startDate;

  // Resultats: marca inicial + curses manuals + tests registrats
  const results = [{ date: '0000-00-00', distM: p.base.distM, sec: p.base.sec, src: 'inicial' }];
  for (const r of p.results || []) results.push({ ...r, src: 'cursa' });
  for (const l of Object.values(logs)) {
    if (l.type === 'test' && l.status === 'done' && l.sec && l.distM) results.push({ date: l.date, distM: l.distM, sec: l.sec, src: 'test' });
  }
  results.sort((a, b) => a.date.localeCompare(b.date));

  let vdot = vdotFrom(results[0].distM, results[0].sec);
  let ri = 1, factorNext = 1;
  const events = [];
  const vdotHist = [];
  const weeks = [];
  let progIdx = 0, testCount = 0, pi = 0;
  const paceAdj = [...(p.paceAdj || [])].sort((a, b) => a.date.localeCompare(b.date));
  const DIFF = { '-1': [0.85, -0.6], 0: [1, 0], 1: [1.12, 0.4] }[p.difficulty || 0];

  for (let w = 0; w < frame.n; w++) {
    const wStart = addDays(frame.startMon, w * 7);
    const wStartIso = iso(wStart);
    const wEndIso = iso(addDays(wStart, 6));
    while (ri < results.length && results[ri].date < wStartIso) {
      const r = results[ri++];
      const nv = vdotFrom(r.distM, r.sec);
      if (r.date >= startIso || r.src !== 'inicial') {
        const label = r.src === 'test' ? `Test ${r.distM / 1000}K` : `Cursa ${Math.round(r.distM / 100) / 10} km`;
        events.push({ date: r.date, week: w, kind: nv >= vdot ? 'up' : 'down',
          text: `${label}: forma ${nv.toFixed(1)} (abans ${vdot.toFixed(1)}). Ritmes recalculats.` });
      }
      vdot = nv;
    }
    const tw = frame.template ? frame.template.week(Math.min(w, frame.template.weeks - 1), p.days) : null;
    while (pi < paceAdj.length && paceAdj[pi].date <= wEndIso) {
      const a = paceAdj[pi++];
      vdot += a.delta;
      events.push({ date: a.date, week: w, kind: a.delta > 0 ? 'up' : 'down', text: a.delta > 0 ? 'Has acceptat ritmes més ràpids.' : 'Has acceptat ritmes més suaus.' });
    }
    const phase = frame.phases[w];
    const deload = tw ? tw.deload : w < frame.pre && (w + 1) % 4 === 0 && w !== frame.pre - 1;
    const isRaceWeek = w === frame.n - 1;
    const wInPhase = frame.phases.slice(0, w).filter(x => x === phase).length;

    let vol;
    if (phase === 'taper') vol = peakVol * TAPER_FRAC[frame.taper][w - frame.pre];
    else {
      vol = startVol + (peakVol - startVol) * Math.min(1, progIdx / Math.max(1, frame.pre - 2));
      if (deload) vol *= 0.75; else progIdx++;
    }
    const factor = factorNext;
    vol *= factor * DIFF[0];

    const racePace = p.goalSec ? p.goalSec / (D.m / 1000) : predict(vdot, D.m) / (D.m / 1000);
    const z = zones(vdot + DIFF[1], racePace);
    vdotHist.push({ week: w, date: wStartIso, vdot });

    const ctx = { phase, deload, vol, dist: p.distance, level: p.level, daysN, wInPhase, warm, cool };
    const sessions = [];
    const add = (dayIdx, s) => {
      const date = iso(addDays(wStart, dayIdx));
      // Identificador únic encara que hi hagi dues sessions del mateix tipus el mateix dia
      let id = `${date}-${s.type}`;
      for (let n = 2; sessions.some(x => x.id === id); n++) id = `${date}-${s.type}-${n}`;
      sessions.push({ ...s, date, id });
    };

    if (tw) {
      // Pla preparat: sessions fixes. Si la setmana anterior ha anat malament, retallem els trams suaus.
      for (const [d, s] of tw.items) {
        if (!s.steps.length) { add(d, s); continue; }
        const scale = factor * DIFF[0];
        const cut = scale !== 1 && s.type !== 'race' && s.type !== 'test';
        const steps = cut ? s.steps.map(st => (st.k === 'run' && st.z === 'E' ? { ...st, km: Math.max(2, Math.round(st.km * scale * 2) / 2) }
          : st.k === 'time' ? { ...st, sec: Math.round((st.sec * scale) / 60) * 60, label: `${Math.round((st.sec * scale) / 60)} min a ritme suau` } : st)) : s.steps;
        const x = Object.assign(mk(s.type, s.title, steps, s.note), s.distM ? { distM: s.distM } : {});
        if (cut && s.type === 'long') x.title = x.title.replace(/^Tirada llarga [\d,]+ km/, `Tirada llarga ${String(x.km).replace('.', ',')} km`);
        if (cut && s.type === 'easy' && /^Córrer \d+ min/.test(s.title)) x.title = s.title.replace(/\d+ min/, `${Math.round((steps.find(st => st.k === 'time')?.sec || 0) / 60)} min`);
        if (cut && factor < 1 && x.km < stepsKm(s.steps)) {
          if (s.type === 'long') x.title = x.title.replace(/^Tirada llarga [\d,]+ km/, `Tirada llarga ${String(x.km).replace('.', ',')} km`);
          x.note = `Retallada a ${String(x.km).replace('.', ',')} km per com va anar la setmana anterior. ${s.note}`.trim();
        }
        add(d, x);
      }
    } else if (isRaceWeek) {
      const raceDow = dow(frame.race);
      const before = days.filter(d => d < raceDow - 1);
      const pre = before.slice(-2);
      const short = p.distance === '5k' || p.distance === '10k';
      pre.forEach((d, i) => {
        if (i === 0 && pre.length === 2) {
          add(d, mk('easy', 'Activació amb ritme de cursa', short ? [
            { k: 'run', km: 1.5, z: 'E' }, { k: 'rep', n: 4, km: 0.2, z: 'RP', rec: 60 }, { k: 'run', km: 1, z: 'E' },
          ] : [
            { k: 'run', km: 3, z: 'E' }, { k: 'rep', n: 3, km: 1, z: p.distance === '42k' || p.distance === '50k' ? 'M' : 'RP', recKm: 0.5 }, { k: 'run', km: 2, z: 'E' },
          ], 'Recordatori del ritme, sense cansar-te.'));
        } else add(d, easySession(short ? 3 : 5, p.level !== 'beg'));
      });
      add(raceDow, Object.assign(mk('race', p.raceName || D.long, [{ k: 'run', km: Math.round(D.m / 100) / 10, z: 'RP', label: 'Cursa' }],
        'Surt uns segons més lent del ritme objectiu els primers quilòmetres.'), { distM: D.m }));
    } else {
      const testHere = deload && (phase === 'base' || phase === 'build') && w > 0;
      const testDist = p.distance === '5k' || p.distance === '10k' || testCount % 2 === 0 ? 5000 : 10000;
      if (testHere) testCount++;
      // Principiants i plans de 2 dies: una sola sessió de qualitat (alterna sèries i tempo); la resta, suau.
      const quality = [];
      quality.push([byFar[0], testHere ? testSession(testDist, ctx) : nQuality === 2 ? tempoSession(ctx) : w % 2 === 0 ? intervalSession(ctx) : tempoSession(ctx)]);
      if (nQuality === 2) quality.push([byFar[1], intervalSession(ctx)]);
      const qKm = quality.reduce((a, [, s]) => a + s.km, 0);
      const easyDays = byFar.slice(quality.length);
      // La tirada llarga parteix de la més llarga que ja fas i creix com a molt un esglaó per setmana
      let longKm;
      if (phase === 'taper') longKm = longPeak * (TAPER_FRAC[frame.taper][w - frame.pre] ?? 0.6);
      else if (deload) longKm = longNow * 0.7;
      else { longKm = longNow; longPeak = Math.max(longPeak, longNow); longNow = Math.min(longCap, longNow + LONG_STEP[p.distance]); }
      longKm = Math.min(longKm, Math.max(3, vol * (LONG_MAX_SHARE[daysN] || 0.33)));
      const L = longSession({ ...ctx, longKm });
      add(p.longDay, L);
      quality.forEach(([d, s]) => add(d, s));
      const rest = vol - L.km - qKm;
      easyDays.forEach((d, i) => add(d, easySession(rest / easyDays.length, i === 0 && p.level !== 'beg')));
    }

    // Força i mobilitat (el pla preparat ja les porta)
    if (!tw) {
    const runDaysThisWeek = new Set(sessions.map(s => dow(fromIso(s.date))));
    const lastDay = isRaceWeek ? dow(frame.race) : 7;
    let nStr = p.strength;
    if (deload) nStr = Math.min(nStr, 1);
    if (phase === 'taper') nStr = isRaceWeek ? 0 : Math.min(nStr, 1);
    const free = [0, 1, 2, 3, 4, 5, 6].filter(d => !runDaysThisWeek.has(d) && d < lastDay);
    const avoid = new Set([(p.longDay + 6) % 7]);
    const pref = [(p.longDay + 1) % 7, ...free.sort((a, b) => circ(b, p.longDay) - circ(a, p.longDay))]
      .filter((d, i, arr) => free.includes(d) && arr.indexOf(d) === i);
    const ordered = [...pref.filter(d => !avoid.has(d)), ...pref.filter(d => avoid.has(d))];
    const rot = phase === 'base' ? ['A', 'B'] : ['A', 'B', 'C'];
    const used = [];
    for (let i = 0; i < nStr; i++) {
      const r = rot[i % rot.length];
      const d = ordered[i] ?? byFar[i] ?? p.longDay;
      used.push(d);
      add(d, { type: 'strength', title: r === 'A' ? 'Força A · cames' : r === 'B' ? 'Força B · core' : 'Força C · potència', routine: r, steps: [], km: 0, note: ordered[i] === undefined ? 'Després de córrer, el mateix dia.' : '' });
    }
    if (p.mobility && !isRaceWeek) {
      const d = ordered.find(x => !used.includes(x)) ?? p.longDay;
      add(d, { type: 'mobility', title: 'Mobilitat · 15 min', routine: 'M', steps: [], km: 0, note: d === p.longDay ? 'Just després de la tirada llarga.' : '' });
    }
    }

    // Ioga i estiraments als dies lliures
    if (p.yoga && !isRaceWeek) {
      const busy = new Set(sessions.map(s => dow(fromIso(s.date))));
      const freeY = [4, 0, 2, 6, 1, 3, 5].filter(d => !busy.has(d));
      for (let i = 0; i < p.yoga; i++) {
        const d = freeY[i] ?? p.longDay ?? 6;
        add(d, { type: 'yoga', title: i === 0 ? 'Ioga per a corredors' : 'Estiraments i estabilitat', routine: i === 0 ? 'Y' : 'S', steps: [], km: 0, note: freeY[i] === undefined ? 'Després de córrer, el mateix dia.' : '' });
      }
    }

    // Moure sessions (l'usuari pot canviar el dia dins la setmana)
    for (const s of sessions) {
      const to = state.moves?.[s.id];
      if (to && to >= wStartIso && to <= wEndIso) { s.movedFrom = s.date; s.date = to; }
    }
    const adjusted = applyAdjustments(sessions, state.adjust || [], logs);
    const visible = adjusted.filter(s => s.date >= startIso).sort((a, b) => a.date.localeCompare(b.date) || (a.km ? -1 : 1));

    const runKm = visible.filter(s => s.km).reduce((a, s) => a + s.km, 0);
    weeks.push({ idx: w, start: wStartIso, end: wEndIso, phase, deload, isRaceWeek, vol: Math.round(runKm), vdot, zones: z, racePace, factor, sessions: visible, note: tw?.note || '' });

    // ---- Adaptació a partir del que has registrat aquesta setmana ----
    const runs = visible.filter(s => s.km);
    const L = runs.map(s => logs[s.id]).filter(Boolean);
    const complete = wEndIso < todayIso || (runs.length && runs.every(s => logs[s.id]));
    factorNext = 1;
    if (complete && L.length) {
      const skipped = L.filter(l => l.status === 'skipped').length;
      const q = runs.filter(s => ['int', 'tempo', 'fartlek', 'hills'].includes(s.type));
      const qLogs = q.map(s => logs[s.id]).filter(Boolean);
      const hard = qLogs.filter(l => l.status !== 'skipped' && l.rpe >= 9).length;
      const easyLogs = L.filter(l => (l.type === 'easy' || l.type === 'long') && l.status !== 'skipped' && l.rpe);
      const easyAvg = easyLogs.length ? easyLogs.reduce((a, l) => a + l.rpe, 0) / easyLogs.length : 0;
      const longSkipped = runs.some(s => s.type === 'long' && logs[s.id]?.status === 'skipped');
      // Els canvis de ritme ara els proposa "Estat dels ritmes" i els acceptes tu; aquí només ajustem el volum.
      if (skipped >= 2 || (longSkipped && runs.length <= 3)) {
        factorNext = 0.85;
        events.push({ date: wEndIso, week: w + 1, kind: 'down', text: `Setmana ${w + 1}: t'has saltat ${skipped} ${skipped === 1 ? 'sessió' : 'sessions'}. La setmana ${w + 2} baixa un 15 % de volum per tornar-hi amb calma.` });
      } else if (hard >= 2 || easyAvg >= 7.5) {
        factorNext = 0.9;
        events.push({ date: wEndIso, week: w + 1, kind: 'down', text: `Setmana ${w + 2}: −10 % de volum per fatiga (${hard >= 2 ? `${hard} sessions amb esforç ≥ 9` : 'els rodatges suaus et costen massa'}).` });
      }
    }
  }

  const current = weeks.find(w => w.start <= todayIso && w.end >= todayIso) || (todayIso < weeks[0].start ? weeks[0] : weeks[weeks.length - 1]);
  // aplica resultats posteriors a l'última setmana generada (p. ex. un test d'aquesta setmana)
  let vdotNow = current.vdot;
  for (const r of results.slice(1)) if (r.date >= current.start && r.date <= todayIso) vdotNow = vdotFrom(r.distM, r.sec);

  return { frame, weeks, events: events.sort((a, b) => b.date.localeCompare(a.date)), vdotHist, current, vdotNow, dist: D, peakVol };
}

export function estSeconds(session, zonesObj) {
  const pace = z => { const r = zonesObj[z] || zonesObj.E; return (r[0] + r[1]) / 2; };
  let s = 0;
  for (const st of session.steps) {
    if (st.k === 'rep') s += st.n * st.km * pace(st.z) + (st.n - 1) * ((st.rec || 0) + (st.recKm || 0) * pace('E'));
    else if (st.k === 'fart') s += st.n * 120;
    else if (st.k === 'hill') s += st.n * (st.sec + 90);
    else if (st.k === 'strides') s += st.n * 60;
    else if (st.k === 'walk' || st.k === 'time') s += st.sec;
    else if (st.k === 'rw') s += st.n * (st.run + st.walk);
    else s += (st.km || 0) * pace(st.z === 'TEST' ? 'I' : st.z);
    if (st.strides) s += st.strides * 60;
  }
  return s;
}
