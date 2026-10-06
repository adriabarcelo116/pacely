# Connectar Pacely amb el rellotge (Polar Flow)

Polar Flow → Pacely, amb l'API gratuïta Polar AccessLink. Pacely llegeix les curses i les registra a la sessió del pla.

Una sola vegada, uns 15 minuts, tot gratuït.

## 1. Crear el client de Polar AccessLink

1. Entra a <https://admin.polaraccesslink.com> amb el teu compte de Polar Flow.
2. Prem **Create client** i omple el nom de l'app (Pacely), un correu i una descripció curta.
3. A **Redirect URL** posa l'adreça exacta de Pacely (la que surt a Perfil → Rellotge → Configuració). Per provar en local: `http://localhost:5180/`.
4. Apunta el **Client ID** i el **Client Secret**.

## 2. Publicar el Worker a Cloudflare

1. Crea un compte gratuït a <https://dash.cloudflare.com/sign-up>.
2. Des d'aquesta carpeta (`pacely/worker`):

```bash
npx wrangler login
```

```bash
npx wrangler secret put POLAR_CLIENT_ID
```

```bash
npx wrangler secret put POLAR_CLIENT_SECRET
```

3. A `wrangler.toml`, posa a `ALLOWED_ORIGINS` l'adreça de Pacely (p. ex. `https://usuari.github.io`).
4. Publica:

```bash
npx wrangler deploy
```

Et donarà una adreça com `https://pacely-connect.usuari.workers.dev`.

## 3. Configurar Pacely

**Perfil → Rellotge → Configuració de la connexió**: enganxa el Client ID de Polar i l'adreça del Worker, desa i prem **Connectar amb Polar Flow**.

Polar només comparteix les curses pujades després de connectar (dels últims 30 dies).

Per comprovar el Worker, obre `https://<el-teu-worker>/health` al navegador: diu si les dues claus hi són, sense mostrar-les.
