// Gravació de curses amb el GPS del mòbil, amb sessió guiada i avisos de veu.
// Un navegador només rep posicions amb la pantalla encesa: per això demanem el "wake lock".

import { fmtPace } from './vdot.js';

const SAVE_KEY = 'pacely:run';
const MAX_ACC = 30;        // m: descartem posicions menys precises
const MAX_SPEED = 9;       // m/s: salts impossibles corrent
const MIN_STEP = 3;        // m: per sota és soroll si estem quiets

const ZNAME = { E: 'fàcil', M: 'ritme marató', T: 'tempo', I: 'sèries', R: 'velocitat', RP: 'ritme objectiu' };

// ---------- Trams de la sessió ----------
export function buildSegments(session, zones) {
  if (!session) return [{ label: 'Cursa lliure', kind: 'open', target: Infinity, zone: null, pace: null, work: false }];
  const segs = [];
  const add = (label, kind, target, zone, work = false) => segs.push({ label, kind, target, zone, pace: zone && zones[zone] ? zones[zone] : null, work });
  const km = x => String(Math.round(x * 10) / 10).replace('.', ',');
  for (const st of session.steps) {
    if (st.k === 'warm') {
      add(`Escalfament ${km(st.km)} km`, 'dist', st.km * 1000, 'E');
      if (st.strides) for (let i = 0; i < st.strides; i++) { add(`Progressiu ${i + 1} de ${st.strides}`, 'time', 20, null, true); add('Trota suau', 'time', 40, null); }
    } else if (st.k === 'cool') add(`Tornada a la calma ${km(st.km)} km`, 'dist', st.km * 1000, 'E');
    else if (st.k === 'run') {
      if (st.z === 'TEST') add(`${km(st.km)} km a fons`, 'dist', st.km * 1000, null, true);
      else add(`${km(st.km)} km a ${ZNAME[st.z] || 'ritme'}`, 'dist', st.km * 1000, st.z, st.z !== 'E');
    } else if (st.k === 'rep') {
      for (let i = 0; i < st.n; i++) {
        const d = st.km < 1 ? `${Math.round(st.km * 1000)} m` : `${km(st.km)} km`;
        add(`${d} a ${ZNAME[st.z]} · ${i + 1} de ${st.n}`, 'dist', st.km * 1000, st.z, true);
        if (i < st.n - 1) {
          if (st.rec) add(`Recuperació ${st.rec} s`, 'time', st.rec, null);
          else if (st.recKm) add(`${km(st.recKm)} km suau`, 'dist', st.recKm * 1000, 'E');
        }
      }
    } else if (st.k === 'fart') {
      for (let i = 0; i < st.n; i++) { add(`Ràpid · ${i + 1} de ${st.n}`, 'time', 60, 'I', true); if (i < st.n - 1) add('Suau', 'time', 60, null); }
    } else if (st.k === 'hill') {
      for (let i = 0; i < st.n; i++) { add(`Pujada forta · ${i + 1} de ${st.n}`, 'time', st.sec, null, true); if (i < st.n - 1) add('Baixa trotant', 'time', 90, null); }
    } else if (st.k === 'strides') {
      for (let i = 0; i < st.n; i++) { add(`Recta ràpida ${i + 1} de ${st.n}`, 'time', 20, null, true); add('Trota suau', 'time', 40, null); }
    }
  }
  segs.push({ label: 'Sessió acabada · continua si vols', kind: 'open', target: Infinity, zone: null, pace: null, work: false });
  return segs;
}

// ---------- Utilitats ----------
function haversine(a, b) {
  const R = 6371000, r = x => (x * Math.PI) / 180;
  const dLat = r(b[1] - a[1]), dLon = r(b[2] - a[2]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let voice = null;
function pickVoice() {
  const vs = window.speechSynthesis?.getVoices() || [];
  voice = vs.find(v => v.lang?.toLowerCase().startsWith('ca')) || vs.find(v => v.lang?.toLowerCase().startsWith('es')) || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

export const paceWords = sec => {
  if (!isFinite(sec)) return '';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m} minuts ${s}` : `${m} minuts`;
};

// ---------- Gravadora ----------
export class Recorder {
  constructor({ sessionId = null, segments, title, onUpdate, onEvent }) {
    Object.assign(this, { sessionId, segments, title, onUpdate, onEvent });
    this.s = { sessionId, title, startedAt: null, pts: [], dist: 0, moving: 0, paused: false, seg: 0, segD: 0, segT: 0, kmSaid: 0, lastAlert: 0, muted: false, hrSum: 0, hrN: 0, hrMax: 0, hrs: [] };
    this.watch = null; this.timer = null; this.lock = null; this.lastTick = 0; this.acc = null; this.lastFix = 0;
    this.hr = null; // font de pulsacions (HeartRate), opcional
  }

  static restore(opts) {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!saved?.startedAt) return null;
      const r = new Recorder({ ...opts, sessionId: saved.sessionId, title: saved.title });
      saved.pts = (saved.pts || []).map(p => { const q = p.slice(0, 3); if (p[3]) q.gap = true; return q; });
      // el temps amb l'app tancada no compta: queda en pausa fins que l'usuari continua
      saved.paused = true;
      saved.hrs ||= []; saved.hrSum ||= 0; saved.hrN ||= 0; saved.hrMax ||= 0;
      if (saved.pts.length) saved.pts[saved.pts.length - 1].gap = true;
      r.s = saved;
      return r;
    } catch { return null; }
  }
  static pending() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s?.startedAt ? s : null; } catch { return null; } }
  static discard() { try { localStorage.removeItem(SAVE_KEY); } catch {} }

  get segment() { return this.segments[Math.min(this.s.seg, this.segments.length - 1)]; }
  get elapsed() { return this.s.moving / 1000; }

  // Abans de començar: busca senyal per mostrar la precisió
  warmup() {
    if (!('geolocation' in navigator)) { this.onEvent?.('error', 'Aquest navegador no té GPS.'); return; }
    if (this.watch !== null) return;
    this.watch = navigator.geolocation.watchPosition(p => this.onPos(p), e => this.onErr(e), { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }

  async start() {
    this.warmup();
    if (!this.s.startedAt) { this.s.startedAt = Date.now(); this.say(this.segIntro()); }
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), 1000);
    await this.keepAwake();
    document.addEventListener('visibilitychange', this.onVis = () => { if (document.visibilityState === 'visible') this.keepAwake(); });
    this.persist();
  }

  async keepAwake() {
    try { if ('wakeLock' in navigator && !this.lock) { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } }
    catch { /* el sistema pot negar-ho (bateria baixa) */ }
  }

  onErr(e) {
    const msg = e.code === 1 ? 'Has denegat el permís de localització. Activa\'l a la configuració del navegador per a aquesta web.'
      : e.code === 3 ? 'Encara no hi ha senyal de GPS. Surt a l\'exterior i espera uns segons.' : 'No es pot obtenir la posició.';
    this.onEvent?.(e.code === 1 ? 'error' : 'warn', msg);
  }

  onPos(p) {
    const { latitude: lat, longitude: lon, accuracy } = p.coords;
    this.acc = accuracy; this.lastFix = Date.now();
    if (!this.s.startedAt || this.s.paused || accuracy > MAX_ACC) { this.onUpdate?.(); return; }
    const pt = [p.timestamp, lat, lon];
    const last = this.s.pts[this.s.pts.length - 1];
    if (last && !last.gap) {
      const d = haversine(last, pt), dt = (pt[0] - last[0]) / 1000;
      if (dt <= 0) return;
      if (d / dt > MAX_SPEED) {
        // Salt impossible: si fa poc, és soroll; si fa estona que no hi havia senyal, tornem a agafar referència sense sumar-lo
        if (dt < 20) return;
      } else {
        if (d < MIN_STEP && dt < 15) return;
        this.s.dist += d;
      }
    }
    this.s.pts.push(pt);
    this.onUpdate?.();
  }

  tick() {
    const now = Date.now();
    if (!this.s.paused) this.s.moving += now - this.lastTick;
    this.lastTick = now;
    if (!this.s.paused) this.checkSegment();
    if (!this.s.paused && this.s.startedAt && this.hr?.fresh) {
      const b = this.hr.bpm;
      this.s.hrSum += b; this.s.hrN++; this.s.hrMax = Math.max(this.s.hrMax || 0, b);
      const t = Math.round(this.elapsed);
      if (!this.s.hrs.length || t - this.s.hrs[this.s.hrs.length - 1][0] >= 5) this.s.hrs.push([t, b]);
    }
    this.checkKm(); this.checkPace();
    if (now % 10000 < 1000) this.persist();
    this.onUpdate?.();
  }

  segProgress() {
    const sg = this.segment;
    if (sg.kind === 'dist') return { done: this.s.dist - this.s.segD, left: sg.target - (this.s.dist - this.s.segD) };
    if (sg.kind === 'time') return { done: this.elapsed - this.s.segT, left: sg.target - (this.elapsed - this.s.segT) };
    return { done: this.s.dist - this.s.segD, left: Infinity };
  }

  checkSegment() {
    const sg = this.segment;
    if (sg.kind === 'open') return;
    const { left } = this.segProgress();
    if (sg.kind === 'time' && left <= 3 && left > 2) this.say('3, 2, 1');
    if (left <= 0) this.next();
  }

  next() {
    if (this.s.seg >= this.segments.length - 1) return;
    this.s.seg++; this.s.segD = this.s.dist; this.s.segT = this.elapsed;
    this.say(this.segIntro()); this.persist(); this.onUpdate?.();
  }

  segIntro() {
    const sg = this.segment;
    let t = sg.label.replace(/·/g, ',');
    if (sg.pace) t += `. Ritme entre ${paceWords(sg.pace[0])} i ${paceWords(sg.pace[1])}`;
    return t;
  }

  // Ritme dels últims ~30 s
  currentPace() {
    const pts = this.s.pts;
    if (pts.length < 2 || this.s.paused) return NaN;
    const end = pts[pts.length - 1];
    if (Date.now() - end[0] > 15000) return NaN;
    let d = 0, i = pts.length - 1;
    while (i > 0 && end[0] - pts[i - 1][0] <= 30000) { d += haversine(pts[i - 1], pts[i]); i--; }
    const dt = (end[0] - pts[i][0]) / 1000;
    return d > 20 && dt > 5 ? dt / (d / 1000) : NaN;
  }
  avgPace() { return this.s.dist > 50 ? this.elapsed / (this.s.dist / 1000) : NaN; }

  checkKm() {
    const k = Math.floor(this.s.dist / 1000);
    if (k > this.s.kmSaid) {
      this.s.kmSaid = k;
      this.say(`Quilòmetre ${k}. Ritme mitjà ${paceWords(this.avgPace())}.${this.hr?.fresh ? ` Pulsacions ${this.hr.bpm}.` : ''}`);
    }
  }

  checkPace() {
    const sg = this.segment;
    if (!sg.pace || this.s.paused || Date.now() - this.s.lastAlert < 45000) return;
    if (this.segProgress().done < (sg.kind === 'dist' ? 150 : 20)) return;
    const p = this.currentPace();
    if (!isFinite(p)) return;
    if (p < sg.pace[0] - 8) { this.say('Massa ràpid. Afluixa.'); this.s.lastAlert = Date.now(); }
    else if (p > sg.pace[1] + 8) { this.say(sg.zone === 'E' ? 'Una mica més viu.' : 'Accelera una mica.'); this.s.lastAlert = Date.now(); }
  }

  pause() { this.s.paused = true; const l = this.s.pts[this.s.pts.length - 1]; if (l) l.gap = true; this.say('Pausa.'); this.persist(); this.onUpdate?.(); }
  resume() { this.s.paused = false; this.lastTick = Date.now(); this.say('Continuem.'); this.persist(); this.onUpdate?.(); }
  toggleMute() { this.s.muted = !this.s.muted; if (this.s.muted) speechSynthesis?.cancel(); this.persist(); this.onUpdate?.(); }

  say(text) {
    if (this.s.muted || !window.speechSynthesis || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'ca-ES';
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  persist() { try { const s = { ...this.s, pts: this.s.pts.map(p => (p.gap ? [...p, 1] : p)) }; localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {} }

  stop() {
    if (this.watch !== null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    clearInterval(this.timer); this.timer = null;
    this.lock?.release().catch(() => {}); this.lock = null;
    if (this.onVis) document.removeEventListener('visibilitychange', this.onVis);
  }

  // Resultat final en el format d'activitat de Pacely
  finish() {
    this.stop();
    const pts = this.s.pts;
    const t0 = pts[0]?.[0] || this.s.startedAt;
    let acc = 0;
    const rel = pts.map((p, i) => { if (i && !pts[i - 1].gap) acc += haversine(pts[i - 1], p); return [Math.round((p[0] - t0) / 1000), Math.round(acc)]; });
    const slim = rel.filter((p, i) => i === 0 || i === rel.length - 1 || i % 3 === 0);
    const track = pts.filter((p, i) => i === 0 || i === pts.length - 1 || i % 3 === 0).map(p => [+p[1].toFixed(5), +p[2].toFixed(5), Math.round(p[0] / 1000)]);
    const start = new Date(this.s.startedAt);
    const pad = n => String(n).padStart(2, '0');
    const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    Recorder.discard();
    return {
      key: `gps:${this.s.startedAt}`, source: 'gps', extId: this.s.startedAt, name: this.title || 'Cursa amb GPS', date,
      start: start.toISOString(), km: Math.round(this.s.dist / 10) / 100, sec: Math.round(this.elapsed), elapsed: Math.round((Date.now() - this.s.startedAt) / 1000),
      hr: this.s.hrN ? Math.round(this.s.hrSum / this.s.hrN) : null, hrMax: this.s.hrMax || null, hrs: this.s.hrs || [],
      points: slim, track, sessionId: this.sessionId,
    };
  }
}

export function toGpx(act) {
  const pts = (act.track || []).map(([lat, lon, t]) => `<trkpt lat="${lat}" lon="${lon}"><time>${new Date(t * 1000).toISOString()}</time></trkpt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pacely" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${(act.name || 'Cursa').replace(/[<&]/g, '')}</name><type>running</type><trkseg>${pts}</trkseg></trk></gpx>`;
}

export { fmtPace };
