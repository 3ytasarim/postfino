# SichtTakt PHP SDK

Single file, PHP 8.1+ (`ext-curl`, `ext-json`), no dependencies. Server-side only.

```php
require 'src/SichtTakt.php'; // or: composer require sichttakt/sdk

$st = new SichtTakt\Client(getenv('SICHTTAKT_API_KEY'));
$ws = $st->workspaces()['data'][0]['id'];
$account = $st->accounts($ws)['data'][0]['id'];

$img = $st->uploadMedia($ws, __DIR__ . '/herbst.jpg', 'image/jpeg');
$post = $st->createPost([
    'workspace_id' => $ws,
    'account_ids' => [$account],
    'type' => 'image',
    'caption' => 'Die Herbst-Kollektion ist da',
    'media_asset_ids' => [$img['id']],
    'scheduled_at' => '2026-11-12T10:00:00+01:00',
    'status' => 'scheduled',
], idempotencyKey: 'cms-entry-42-rev-3'); // stable key → safe retries
```

Errors throw `SichtTakt\ApiError` (`status`, `errorCode`, `details`, `requestId`, `retryAfter`).
429 / 5xx are retried (default 2×) with the same Idempotency-Key.
Reusing a key with a different body → `422 IDEMPOTENCY_KEY_REUSED`.

## Webhooks

```php
$raw = file_get_contents('php://input');
if (!SichtTakt\Webhook::verify(getenv('SICHTTAKT_WEBHOOK_SECRET'), $raw, $_SERVER['HTTP_SICHTTAKT_SIGNATURE'] ?? null)) {
    http_response_code(400); exit;
}
```

End-to-end check against a running API: `examples/e2e.php` (used by `tests/sprint5.test.ts` when `PHP_BIN` is set).
