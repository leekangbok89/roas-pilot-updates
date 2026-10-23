# Cafe24 OAuth HTTPS callback deployment (ROAS Pilot v2.8.42)

The ROAS Pilot Node.js server remains local on http://127.0.0.1:3000.
Cafe24 requires a real, app-controlled HTTPS domain for the App URL and Redirect URI.
Do **not** use localhost/127.0.0.1 or another unrelated service's URL.

1. In your Cloudflare account, create a Worker using integrations/cafe24/oauth-callback-worker.mjs.
2. Configure a controlled HTTPS hostname for it. The worker must actually serve this app's OAuth callback.
3. Enter the worker's HTTPS base URL as Cafe24 App URL, and the same host with /cafe24/callback as Redirect URI.
4. In Cafe24 app scopes retain mall.read_order, save app settings, then complete the administrator authorization.
5. In local ROAS Pilot > Settings > Cafe24 API enter the mall ID, client ID, secret, and the identical Redirect URI. Save encrypted.
6. Press OAuth start. After approving, the HTTPS callback page displays code and state. Copy both into the local ROAS Pilot fields immediately (authorization code expires in about a minute), then click Complete.
7. Test read-only orders API. Tokens are encrypted for the current Windows user in .roas-private/cafe24-oauth.dpapi.
8. The v2.8.42 milestone implements OAuth and order API permission checking only. Daily order history collection and all-store incremental revenue modeling are not yet enabled.

This callback is deliberately stateless and does not store client secrets/tokens. Do not enable request URL logging on the callback domain because the OAuth code appears in the query string.
