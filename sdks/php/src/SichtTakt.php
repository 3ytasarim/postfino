<?php
// SichtTakt Public API v1 — PHP SDK (PHP 8.1+, ext-curl, ext-json). Single file, no Composer dependencies.
// Server-side only: never expose the API key to a browser.

declare(strict_types=1);

namespace SichtTakt;

final class ApiError extends \RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly mixed $details = null,
        public readonly ?string $requestId = null,
        public readonly ?int $retryAfter = null,
    ) {
        parent::__construct($errorCode . ': ' . $message, $status);
    }
}

final class Client
{
    private string $base;

    /**
     * @param array{baseUrl?: string, maxRetries?: int, timeout?: int} $options
     */
    public function __construct(private string $apiKey, private array $options = [])
    {
        if (!str_starts_with($apiKey, 'st_')) {
            throw new \InvalidArgumentException('SichtTakt: apiKey must start with st_live_ or st_test_');
        }
        $this->base = rtrim($options['baseUrl'] ?? 'https://api.sichttakt.de', '/');
    }

    /**
     * Low-level request. Writes get an Idempotency-Key automatically; pass your own to make retries
     * across processes safe (e.g. your CMS entry id + revision).
     *
     * @param array<string, string|null> $query
     */
    public function request(string $method, string $path, ?array $body = null, array $query = [], ?string $idempotencyKey = null, ?string $rawBody = null, ?string $rawType = null): mixed
    {
        $query = array_filter($query, static fn ($v) => $v !== null);
        $url = $this->base . $path . ($query ? '?' . http_build_query($query) : '');
        $headers = [
            'Authorization: Bearer ' . $this->apiKey,
            'Accept: application/json',
            'User-Agent: sichttakt-php/0.1.0',
        ];
        if ($method !== 'GET') {
            $headers[] = 'Idempotency-Key: ' . ($idempotencyKey ?? self::uuid());
        }
        $payload = null;
        if ($rawBody !== null) {
            $headers[] = 'Content-Type: ' . ($rawType ?? 'application/octet-stream');
            $payload = $rawBody;
        } elseif ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            $payload = json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        $max = $this->options['maxRetries'] ?? 2;
        for ($attempt = 0; ; $attempt++) {
            $respHeaders = [];
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_CUSTOMREQUEST => $method,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $this->options['timeout'] ?? 30,
                CURLOPT_HEADERFUNCTION => static function ($c, string $line) use (&$respHeaders) {
                    $p = explode(':', $line, 2);
                    if (count($p) === 2) {
                        $respHeaders[strtolower(trim($p[0]))] = trim($p[1]);
                    }
                    return strlen($line);
                },
            ]);
            if ($payload !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
            }
            $raw = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $curlErr = curl_error($ch);
            curl_close($ch);

            if ($raw === false) {
                if ($attempt < $max) {
                    usleep((int) (500_000 * 2 ** $attempt));
                    continue;
                }
                throw new ApiError(0, 'NETWORK_ERROR', $curlErr);
            }
            if ($status >= 200 && $status < 300) {
                return $status === 204 || $raw === '' ? null : json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            }
            $retryAfter = isset($respHeaders['retry-after']) ? (int) $respHeaders['retry-after'] : null;
            if (($status === 429 || $status >= 500) && $attempt < $max) {
                usleep($retryAfter ? $retryAfter * 1_000_000 : (int) (500_000 * 2 ** $attempt));
                continue;
            }
            $j = json_decode((string) $raw, true) ?: [];
            $e = $j['error'] ?? [];
            throw new ApiError($status, $e['code'] ?? 'HTTP_' . $status, $e['message'] ?? 'Request failed', $e['details'] ?? null, $e['request_id'] ?? ($respHeaders['x-request-id'] ?? null), $retryAfter);
        }
    }

    // ── Resources ──
    public function workspaces(): array { return $this->request('GET', '/api/v1/workspaces'); }
    public function accounts(?string $workspaceId = null): array { return $this->request('GET', '/api/v1/accounts', null, ['workspace_id' => $workspaceId]); }
    public function connectAccount(string $workspaceId, string $platform, ?string $redirectAfter = null): array
    {
        return $this->request('POST', '/api/v1/accounts/connect', array_filter(['workspace_id' => $workspaceId, 'platform' => $platform, 'redirect_after' => $redirectAfter]));
    }

    /** Two-step upload: register the asset, then PUT the bytes. Returns the validated asset. */
    public function uploadMedia(string $workspaceId, string $filePath, string $mimeType, string $purpose = 'image'): array
    {
        $data = file_get_contents($filePath);
        if ($data === false) {
            throw new \RuntimeException("Cannot read $filePath");
        }
        $reg = $this->request('POST', '/api/v1/media/uploads', ['workspace_id' => $workspaceId, 'filename' => basename($filePath), 'mime_type' => $mimeType, 'size_bytes' => strlen($data), 'purpose' => $purpose]);
        return $this->request('PUT', '/api/v1/media/' . rawurlencode($reg['id']) . '/content', null, [], null, $data, $mimeType);
    }

    public function createPost(array $post, ?string $idempotencyKey = null): array { return $this->request('POST', '/api/v1/posts', $post, [], $idempotencyKey); }
    public function getPost(string $id): array { return $this->request('GET', '/api/v1/posts/' . rawurlencode($id)); }
    public function updatePost(string $id, array $patch): array { return $this->request('PATCH', '/api/v1/posts/' . rawurlencode($id), $patch); }
    public function approvePost(string $id, string $decision = 'approved', ?string $comment = null): array
    {
        return $this->request('POST', '/api/v1/posts/' . rawurlencode($id) . '/approve', array_filter(['decision' => $decision, 'comment' => $comment]));
    }
    public function publishPost(string $id): array { return $this->request('POST', '/api/v1/posts/' . rawurlencode($id) . '/publish', []); }
    public function cancelPost(string $id): array { return $this->request('POST', '/api/v1/posts/' . rawurlencode($id) . '/cancel', []); }
    public function reschedulePost(string $id, string $scheduledAtIso): array { return $this->request('POST', '/api/v1/posts/' . rawurlencode($id) . '/reschedule', ['scheduled_at' => $scheduledAtIso]); }
    public function calendar(string $workspaceId, string $fromIso, string $toIso): array { return $this->request('GET', '/api/v1/calendar', null, ['workspace_id' => $workspaceId, 'from' => $fromIso, 'to' => $toIso]); }
    public function postAnalytics(string $postId): array { return $this->request('GET', '/api/v1/analytics/posts/' . rawurlencode($postId)); }
    public function shortLink(string $workspaceId, string $url): array { return $this->request('POST', '/api/v1/links', ['workspace_id' => $workspaceId, 'url' => $url]); }
    public function usage(): array { return $this->request('GET', '/api/v1/usage'); }
    public function webhooks(): array { return $this->request('GET', '/api/v1/webhooks'); }
    /** @param list<string> $events */
    public function createWebhook(string $url, array $events, ?string $workspaceId = null): array
    {
        return $this->request('POST', '/api/v1/webhooks', array_filter(['url' => $url, 'events' => $events, 'workspace_id' => $workspaceId]));
    }
    public function deleteWebhook(string $id): mixed { return $this->request('DELETE', '/api/v1/webhooks/' . rawurlencode($id)); }

    private static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }
}

final class Webhook
{
    /**
     * Verifies a delivery. Use the RAW body (file_get_contents('php://input')) and the
     * SichtTakt-Signature header ($_SERVER['HTTP_SICHTTAKT_SIGNATURE']). Rejects signatures older than 5 minutes.
     */
    public static function verify(string $secret, string $rawBody, ?string $header, ?int $now = null): bool
    {
        if (!$header) {
            return false;
        }
        $parts = [];
        foreach (explode(',', $header) as $kv) {
            $p = explode('=', trim($kv), 2);
            if (count($p) === 2) {
                $parts[$p[0]] = $p[1];
            }
        }
        if (!isset($parts['t'], $parts['v1']) || !ctype_digit($parts['t'])) {
            return false;
        }
        $t = (int) $parts['t'];
        if (abs(($now ?? time()) - $t) > 300) {
            return false;
        }
        return hash_equals(hash_hmac('sha256', $t . '.' . $rawBody, $secret), $parts['v1']);
    }
}
