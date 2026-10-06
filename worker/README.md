# Connectar Gambada amb el rellotge (Polar Flow)

Polar Flow → Gambada, amb l'API gratuïta Polar AccessLink. Gambada llegeix les curses i les registra a la sessió del pla.

Una sola vegada, uns 15 minuts, tot gratuït.

## 1. Crear el client de Polar AccessLink

1. Entra a <https://admin.polaraccesslink.com> amb el teu compte de Polar Flow.
2. Prem **Create client** i omple el nom de l'app (Gambada), un correu i una descripció curta.
3. A **Redirect URL** posa l'adreça exacta de Gambada (la que surt a Perfil → Rellotge → Configuració). Per provar en local: `http://localhost:5180/`.
4. Apunta el **Client ID** i el **Client Secret**.

## 2. Publicar el Worker a Cloudflare

1. Crea un compte gratuït a <https://dash.cloudflare.com/sign-up>.
2. Des d'aquesta carpeta (`gambada/worker`):

```bash
npx wrangler login
```

```bash
npx wrangler secret put POLAR_CLIENT_ID
```

```bash
npx wrangler secret put POLAR_CLIENT_SECRET
```

3. A `wrangler.toml`, posa a `ALLOWED_ORIGINS` l'adreça de Gambada (p. ex. `https://usuari.github.io`).
4. Publica:

```bash
npx wrangler deploy
```

Et donarà una adreça com `https://gambada-connect.usuari.workers.dev`.

## 3. Configurar Gambada

**Perfil → Rellotge → Configuració de la connexió**: enganxa el Client ID de Polar i l'adreça del Worker, desa i prem **Connectar amb Polar Flow**.

Polar només comparteix les curses pujades després de connectar (dels últims 30 dies).

## Strava (opcional)

Des de juny de 2026 Strava demana subscripció per crear una app. Si en tens, afegeix també `STRAVA_CLIENT_ID` i `STRAVA_CLIENT_SECRET` al Worker i el Client ID de Strava a la configuració.
