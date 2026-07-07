# OneAIHUB Recorder Panel

Static Cloudflare Pages UI for controlling the recorder through a protected Cloudflare Worker gateway.

Before login the page shows only the password form. After login it loads service status, recording controls, scheduler actions, calendar settings, R2 settings and logs.

## Runtime config

The panel reads its API gateway URL from `panel/config.js`:

```bash
cp panel/config.example.js panel/config.js
```

Edit `panel/config.js` locally for deployment. This file is ignored by git and must not be committed.

Commit-safe example file:

```txt
panel/config.example.js
```

## Security model

Browser requests go to the Worker gateway, not directly to the recorder server.

```txt
browser -> Cloudflare Worker session -> recorder API token/base path -> recorder server
```

Worker secrets/bindings expected in Cloudflare:

```txt
PANEL_PASSWORD
SESSION_SECRET
BOT_API_BASE
BOT_API_KEY
ALLOWED_ORIGINS
```

The panel never receives the recorder API token. R2 keys and Google OAuth credentials are write-only from the UI and are not returned back to the browser.

## Deploy

Deploy the static panel directory to Cloudflare Pages:

```bash
npx wrangler pages deploy panel --project-name meet-recorder-panel
```

The Worker gateway is deployed separately from `workers/meet-recorder-panel-gateway.js` and must use Cloudflare secrets/bindings, not hardcoded values.
