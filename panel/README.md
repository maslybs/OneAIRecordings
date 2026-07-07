# OneAIHUB Recorder Panel

Static Cloudflare Pages panel for the recorder API.

The panel is static and reads its gateway URL from `config.js`.

Create a local deploy-only config:

```bash
cp panel/config.example.js panel/config.js
```

Then edit `panel/config.js`. It is ignored by git.

Secrets are write-only in the panel. Existing R2 keys, Google OAuth tokens and the bot API key are not returned to the browser.

Deploy:

```bash
npx wrangler pages deploy panel --project-name meet-recorder-panel
```
