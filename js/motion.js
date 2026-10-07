// Animacions de Pacely. Segueix la skill "pacely-animacions": equilibrat (subtil al dia a dia,
// vistós als moments especials), només transform/opacity, i res si l'usuari demana menys moviment.

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const BOUNCE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const TABS = ['avui', 'pla', 'forca', 'historial', 'perfil'];
const DETAIL = new Set(['s', 'e', 'run', 'ritmes', 'ajust', 'entrenos']);
let lastRoute = null;
const seenNums = new Map();
const seenRings = new Set();

// Direcció del canvi de pantalla: lateral entre pestanyes i en entrar/sortir d'un detall
function direction(from, to) {
  if (!from || from.startsWith('ob') !== to.startsWith('ob')) return { x: 0, y: 10 };
  if (from.startsWith('ob') && to.startsWith('ob')) return { x: +to.slice(2) >= +from.slice(2) ? 16 : -16, y: 0 };
  const [fr] = from.split('/'), [tr] = to.split('/');
  if (DETAIL.has(tr) && !DETAIL.has(fr)) return { x: 16, y: 0 };
  if (DETAIL.has(fr) && !DETAIL.has(tr)) return { x: -16, y: 0 };
  const a = TABS.indexOf(fr), b = TABS.indexOf(tr);
  if (a >= 0 && b >= 0) return { x: b > a ? 12 : -12, y: 0 };
  return { x: 0, y: 10 };
}

// Cridar després de cada render. route = identificador de la pantalla (p. ex. "avui", "s/2026-10-08-int", "ob2")
let pressed = null;
// Recorda el botó que s'acaba de tocar per fer-li el "pop" després de redibuixar
export function notePress(el) {
  const a = el?.dataset?.a;
  const attr = (name, val) => (val !== undefined ? `[data-${name}="${CSS.escape(val)}"]` : '');
  pressed = a ? `[data-a="${CSS.escape(a)}"]${attr('v', el.dataset.v)}${attr('k', el.dataset.k)}${attr('id', el.dataset.id)}` : null;
}

export function afterRender(route, root) {
  const changed = route !== lastRoute;
  const dir = direction(lastRoute, route);
  lastRoute = route;
  root.classList.toggle('still', !changed);
  const screen = root.firstElementChild;
  // Comptadors i anells sempre anoten el valor actual; si l'app no es veu, no animen res
  countUp(root);
  rings(root);
  if (document.hidden) { pressed = null; return; }
  if (changed && screen) enterScreen(screen, dir);
  if (!changed && pressed && !reduced()) {
    root.querySelector(pressed)?.animate([{ transform: 'scale(0.94)' }, { transform: 'scale(1)' }], { duration: 260, easing: BOUNCE });
  }
  pressed = null;
  if (changed) growBars(root);
}

function enterScreen(screen, dir) {
  if (reduced()) { screen.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 }); return; }
  const kids = [...screen.children].slice(0, 7);
  kids.forEach((el, i) => {
    el.animate(
      [{ opacity: 0, transform: `translate(${dir.x}px, ${dir.y + (dir.x ? 0 : 4)}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 280, delay: Math.min(i, 6) * 35, easing: EASE_OUT, fill: 'backwards' },
    );
  });
}

// ---------- Números que compten fins al valor ----------
const FMT = {
  int: v => String(Math.round(v)),
  km: v => String(Math.round(v * 10) / 10).replace('.', ','),
  time: v => {
    const s = Math.round(v), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  },
  pct: v => `${Math.round(v)} %`,
};

function countUp(root) {
  for (const el of root.querySelectorAll('[data-num]')) {
    const target = +el.dataset.num, fmt = FMT[el.dataset.fmt] || FMT.int, key = el.dataset.key || el.dataset.fmt;
    const from = seenNums.has(key) ? seenNums.get(key) : 0;
    seenNums.set(key, target);
    if (reduced() || document.hidden || from === target || !isFinite(target)) continue;
    const t0 = performance.now(), dur = 750;
    const final = el.textContent;
    // Garantia: si el navegador atura les animacions (pestanya amagada), el valor final hi és igualment
    setTimeout(() => { if (el.isConnected) el.textContent = final; }, dur + 300);
    const step = now => {
      if (!el.isConnected) return;
      const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3;
      el.textContent = p < 1 ? fmt(from + (target - from) * e) : final;
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = fmt(from);
    requestAnimationFrame(step);
  }
}

// ---------- Anells de progrés (estil Apple Fitness) ----------
function rings(root) {
  for (const svg of root.querySelectorAll('svg.ring')) {
    const prog = svg.querySelector('.ring-p');
    if (!prog) continue;
    const key = svg.dataset.key || 'ring';
    const end = parseFloat(prog.style.strokeDashoffset); // pot venir com "65" o "65px"
    if (!isFinite(end)) continue;
    const seenKey = `${key}:${end}`;
    if (seenRings.has(seenKey)) continue;
    seenRings.add(seenKey);
    if (reduced() || document.hidden) continue;
    prog.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: end }], { duration: 900, easing: EASE_OUT, delay: 120, fill: 'backwards' });
  }
}

// ---------- Barres que creixen des de la base ----------
function growBars(root) {
  if (reduced()) return;
  const groups = [root.querySelectorAll('svg.chart rect.bar'), root.querySelectorAll('.phases .bars i')];
  for (const list of groups) {
    [...list].forEach((el, i) => {
      el.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
        { duration: 600, delay: Math.min(i * 18, 380), easing: EASE_OUT, fill: 'backwards' });
    });
  }
}

// ---------- Moments especials ----------
// Sessió desada: cercle + check que es dibuixa, amb un petit "pop". No bloqueja res.
export function celebrateDone(label = 'Fet!') {
  const el = document.createElement('div');
  el.className = 'done-pop';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 52 52"><circle class="dp-c" cx="26" cy="26" r="23" pathLength="100"/><path class="dp-k" d="M15 27 l7 7 l15 -16" pathLength="100"/></svg><span>${label}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200); // garantia si l'app passa a segon pla
  if (reduced()) {
    el.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 1 }, { opacity: 0 }], { duration: 900 }).onfinish = () => el.remove();
    return;
  }
  el.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(0.6)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }],
    { duration: 380, easing: BOUNCE, fill: 'forwards' });
  el.querySelector('.dp-c').animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 420, easing: EASE_OUT, fill: 'forwards' });
  el.querySelector('.dp-k').animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 300, delay: 300, easing: EASE_OUT, fill: 'forwards' });
  setTimeout(() => {
    el.animate([{ opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }, { opacity: 0, transform: 'translate(-50%, -50%) scale(0.92)' }],
      { duration: 220, easing: EASE_OUT, fill: 'forwards' }).onfinish = () => el.remove();
  }, 1050);
}

// Rècord o assoliment: confeti curt amb els colors de l'app (1,3 s)
export function confetti() {
  // Un sol confeti alhora (un rècord pot donar també un assoliment al mateix moment)
  if (reduced() || document.hidden || document.querySelector('canvas.confetti')) return;
  const cs = getComputedStyle(document.documentElement);
  const colors = ['--accent', '--sun', '--ok', '--z-I', '--z-T'].map(v => cs.getPropertyValue(v).trim()).filter(Boolean);
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  document.body.appendChild(c);
  setTimeout(() => c.remove(), 2500);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: 90 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = 7 + Math.random() * 9;
    return { x: innerWidth / 2, y: innerHeight * 0.42, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 5, h: 3 + Math.random() * 4, col: colors[(Math.random() * colors.length) | 0] };
  });
  const t0 = performance.now(), dur = 1300;
  const frame = now => {
    const p = (now - t0) / dur;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const q of parts) {
      q.vy += 0.35; q.vx *= 0.99; q.x += q.vx; q.y += q.vy; q.r += q.vr;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, p - 0.6) / 0.4);
      ctx.translate(q.x, q.y); ctx.rotate(q.r); ctx.fillStyle = q.col; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); ctx.restore();
    }
    if (p < 1) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}

// Entrada i sortida dels avisos
export function animateToast(t) {
  if (reduced()) return;
  t.animate([{ opacity: 0, transform: 'translate(-50%, 14px) scale(0.96)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }], { duration: 260, easing: BOUNCE });
}
export function removeToast(t) {
  if (reduced() || !t.isConnected) { t.remove(); return; }
  t.animate([{ opacity: 1, transform: 'translate(-50%, 0)' }, { opacity: 0, transform: 'translate(-50%, 8px)' }], { duration: 180, easing: EASE_OUT, fill: 'forwards' }).onfinish = () => t.remove();
  setTimeout(() => t.remove(), 600);
}
