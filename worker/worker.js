// Pacely · intermediari per a Polar AccessLink (Cloudflare Worker, pla gratuït).
// Guarda la clau secreta fora de l'app i reenvia només les crides que Pacely necessita.
// Secrets (wrangler secret put ...): POLAR_CLIENT_ID, POLAR_CLIENT_SECRET
// Variable normal (wrangler.toml): ALLOWED_ORIGINS = "https://usuari.github.io,http://localhost:5180"

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const ok = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': ok ? origin : allowed[0] || 'null',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    const url = new URL(req.url);

    // Diagnòstic obert: diu si les claus hi són i tenen format d'UUID, sense revelar-les
    if (url.pathname === '/health') {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const info = v => ({ set: !!(v || '').trim(), uuid: uuid.test((v || '').trim()) });
      return json({ polarId: info(env.POLAR_CLIENT_ID), polarSecret: info(env.POLAR_CLIENT_SECRET) });
    }

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!ok) return json({ error: 'Origen no permès' }, 403);

    // ---------- Polar AccessLink (gratuït) ----------
    if (url.pathname === '/polar/token' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'JSON invàlid' }, 400); }
      if (!body.code) return json({ error: 'Falta code' }, 400);
      const basic = btoa(`${(env.POLAR_CLIENT_ID || '').trim()}:${(env.POLAR_CLIENT_SECRET || '').trim()}`);
      const params = new URLSearchParams({ grant_type: 'authorization_code', code: body.code });
      if (body.redirect_uri) params.set('redirect_uri', body.redirect_uri);
      const r = await fetch('https://polarremote.com/v2/oauth2/token', {
        method: 'POST', body: params,
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.access_token) return json({ error: d.error_description || d.error || 'Polar ha rebutjat la petició' }, r.status || 400);
      // Registrar l'usuari a AccessLink (409 = ja registrat)
      const reg = await fetch('https://www.polaraccesslink.com/v3/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${d.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ 'member-id': `pacely-${d.x_user_id}` }),
      });
      if (!reg.ok && reg.status !== 409) return json({ error: `No s'ha pogut registrar l'usuari a Polar (${reg.status})` }, 502);
      return json({ access_token: d.access_token, user_id: d.x_user_id, expires_in: d.expires_in });
    }

    if (url.pathname.startsWith('/polar/api/') && req.method === 'GET') {
      const path = url.pathname.slice('/polar/api/'.length);
      if (!/^exercises(\/[\w-]+(\/(tcx|gpx))?)?$/.test(path)) return json({ error: 'Ruta no permesa' }, 404);
      const auth = req.headers.get('Authorization');
      if (!auth) return json({ error: 'Falta el token' }, 401);
      const accept = path.endsWith('/tcx') ? 'application/vnd.garmin.tcx+xml' : path.endsWith('/gpx') ? 'application/gpx+xml' : 'application/json';
      const r = await fetch(`https://www.polaraccesslink.com/v3/${path}${url.search}`, { headers: { Authorization: auth, Accept: accept } });
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || accept } });
    }

    return json({ error: 'No trobat' }, 404);
  },
};
