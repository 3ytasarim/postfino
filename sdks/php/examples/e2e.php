<?php
// End-to-end check of the PHP SDK against a running SichtTakt API (used by tests/sprint5.test.ts).
// Env: ST_BASE, ST_KEY, ST_WS (workspace id), ST_CH (sandbox account id), ST_IMG (path to a JPEG).
// Prints one JSON object with the results; exits 1 on unexpected errors.

declare(strict_types=1);

require __DIR__ . '/../src/SichtTakt.php';

use SichtTakt\Client;
use SichtTakt\ApiError;
use SichtTakt\Webhook;

$out = [];
try {
    $st = new Client(getenv('ST_KEY'), ['baseUrl' => getenv('ST_BASE'), 'maxRetries' => 0]);
    $ws = getenv('ST_WS');

    $out['workspaces'] = count($st->workspaces()['data']);
    $out['accounts'] = count($st->accounts($ws)['data']);

    $asset = $st->uploadMedia($ws, getenv('ST_IMG'), 'image/jpeg');
    $out['asset_status'] = $asset['status'];

    $key = 'cms-entry-42-rev-1';
    $post = ['workspace_id' => $ws, 'account_ids' => [getenv('ST_CH')], 'type' => 'image', 'caption' => 'Grüße aus dem PHP-SDK', 'media_asset_ids' => [$asset['id']], 'status' => 'draft'];
    $p1 = $st->createPost($post, $key);
    $p2 = $st->createPost($post, $key); // same key + same body → same post
    $out['post_status'] = $p1['status'];
    $out['idempotent_same_id'] = $p1['id'] === $p2['id'];

    try {
        $st->createPost(['caption' => 'x'] + $post, $key); // same key, different body → 422 IDEMPOTENCY_KEY_REUSED
        $out['idem_conflict'] = null;
    } catch (ApiError $e) {
        $out['idem_conflict'] = $e->status;
    }

    $out['fetched_caption'] = $st->getPost($p1['id'])['caption'];
    $link = $st->shortLink($ws, 'https://shop.example.de/herbst?utm_source=instagram');
    $out['short_url'] = $link['short_url'];

    try {
        $st->createPost(['workspace_id' => $ws, 'account_ids' => [], 'type' => 'image']);
        $out['validation_error'] = null;
    } catch (ApiError $e) {
        $out['validation_error'] = [$e->status, $e->errorCode, $e->requestId !== null];
    }

    $secret = 'whsec_test';
    $body = '{"event":"post.published"}';
    $t = time();
    $sig = 't=' . $t . ',v1=' . hash_hmac('sha256', $t . '.' . $body, $secret);
    $out['webhook_valid'] = Webhook::verify($secret, $body, $sig);
    $out['webhook_tampered'] = Webhook::verify($secret, $body . ' ', $sig);
    $out['webhook_stale'] = Webhook::verify($secret, $body, $sig, $t + 301);

    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (\Throwable $e) {
    fwrite(STDERR, get_class($e) . ': ' . $e->getMessage() . "\n");
    echo json_encode($out + ['fatal' => $e->getMessage()]);
    exit(1);
}
