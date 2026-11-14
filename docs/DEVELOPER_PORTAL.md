# Entwicklerportal / Developer Portal (Entwurf)

> Herkese açık portal: `/developers` (DE varsayılan; EN/TR arayüz dili ile). Spesifikasyon: `GET {API_URL}/api/v1/openapi.yaml`. Postman: `GET {API_URL}/postman.json`. Durum: `/status`.

## Schnellstart (DE)

1. **Schlüssel erstellen.** *API & Webhooks → Neuen Schlüssel erstellen*. Scopes und Marke wählen. Der Schlüssel wird **nur einmal** angezeigt. Ausschließlich serverseitig verwenden.
2. **Test vs. Live.** `st_test_…`-Schlüssel arbeiten nur mit Sandbox-Kanälen. Dort wird nichts wirklich veröffentlicht.
3. **Konto verbinden.** `POST /api/v1/accounts/connect` liefert eine `authorization_url`. Leite den Endnutzer dorthin weiter, er stimmt beim Netzwerk zu (offizielles OAuth). Danach kommt das Webhook-Ereignis `account.connected`.
4. **Medien hochladen.**
   ```bash
   curl -X POST $API/api/v1/media/uploads -H "Authorization: Bearer $KEY" -H "Idempotency-Key: $(uuidgen)" \
     -H "content-type: application/json" -d '{"workspace_id":"…","filename":"reel.mp4","mime_type":"video/mp4","size_bytes":12345678,"purpose":"video"}'
   curl -X PUT $API/api/v1/media/<id>/content -H "Authorization: Bearer $KEY" -H "content-type: video/mp4" --data-binary @reel.mp4
   ```
   Für das Cover dasselbe mit `purpose: cover` und `image/jpeg`.
5. **Reel planen.**
   ```bash
   curl -X POST $API/api/v1/posts -H "Authorization: Bearer $KEY" -H "Idempotency-Key: order-4711-reel" -H "content-type: application/json" \
     -d '{"workspace_id":"…","account_ids":["…"],"type":"reel","caption":"Unser neuer Cocktail ist da!","video_asset_id":"…","cover_asset_id":"…","scheduled_at":"2026-11-12T10:00:00+01:00","status":"scheduled"}'
   ```
   Antwort `202` bedeutet: geplant. Den Status erhältst du per Webhook oder `GET /api/v1/posts/{id}`.
6. **Webhooks prüfen.** Siehe `WEBHOOK_SECURITY.md` (HMAC-SHA256, 5 Minuten Toleranz, Deduplizierung per Event-Id).

## Fehler
`{ "error": { "code", "message", "details", "request_id" } }`. Wichtige Codes:

| Code | Bedeutung |
|---|---|
| `CAPABILITY_NOT_SUPPORTED` (422) | Das Netzwerk unterstützt die Funktion nicht. `details.alternatives` nennt Alternativen. |
| `MEDIA_INVALID` (422) | Datei erfüllt die Vorgaben nicht. `details.issues` listet die Probleme. |
| `APPROVAL_REQUIRED` (409) | Der Beitrag braucht erst eine Freigabe. |
| `QUOTA_EXCEEDED` / `RATE_LIMITED` (429) | `Retry-After` beachten. |
| `PLAN_FEATURE_UNAVAILABLE` (403) | Die Funktion ist im Tarif nicht enthalten. |

## Beispiele
- TypeScript, Ende-zu-Ende inklusive Webhook-Empfänger: `examples/cms-integration.ts`
- TypeScript SDK: `sdks/typescript` (ohne Abhängigkeiten, Retries mit gleichem Idempotency-Key, `verifyWebhook`)
- PHP SDK: `sdks/php/src/SichtTakt.php` (PHP 8.1+, `SichtTakt\Client`, `SichtTakt\Webhook::verify`), Beispiel `sdks/php/examples/e2e.php`
- Kurzlinks: `POST /api/v1/links` (`posts:write`) liefert `short_url` auf der eigenen Domain

Hinweis: Wird ein Idempotency-Key mit anderem Body wiederverwendet, antwortet die API mit `422 IDEMPOTENCY_KEY_REUSED`.
