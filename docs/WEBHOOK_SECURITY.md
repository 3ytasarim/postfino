# Webhook Güvenliği

## Teslimat
`POST <url>`, `content-type: application/json`. Gövde:
```json
{ "id": "evt-uuid", "type": "post.published", "created_at": "2026-11-12T09:00:03Z",
  "organization_id": "…", "workspace_id": "…", "data": { "post_id": "…", "account_id": "…", "external_post_id": "…", "permalink": "…", "sandbox": false } }
```
Başlıklar:
- `SichtTakt-Event`: olay tipi
- `SichtTakt-Event-Id`: tekrarları ayıklamak için olay ID'si
- `SichtTakt-Signature: t=<unix>,v1=<hex>`

## İmza
`v1 = HMAC_SHA256(secret, "<t>.<ham gövde>")`. Secret `whsec_…` formatındadır ve oluşturulurken **yalnızca bir kez** gösterilir. Sunucuda AES-GCM ile şifreli saklanır.

Alıcı tarafında yapılacaklar:
1. İmzayı ham gövde üzerinden hesapla (JSON'u yeniden serialize etme).
2. Timing-safe karşılaştırma kullan.
3. |şimdi − t| > 300 sn ise reddet (replay koruması).
4. `SichtTakt-Event-Id` değerini kaydet; aynı ID tekrar gelirse işleme.

Örnek alıcı (TypeScript): `examples/cms-integration.ts`. PHP:
```php
[$t, $v1] = (function($h){ parse_str(str_replace(',', '&', $h), $p); return [$p['t'] ?? 0, $p['v1'] ?? '']; })($_SERVER['HTTP_SICHTTAKT_SIGNATURE'] ?? '');
$body = file_get_contents('php://input');
$ok = abs(time() - (int)$t) <= 300 && hash_equals(hash_hmac('sha256', "$t.$body", getenv('SICHTTAKT_WEBHOOK_SECRET')), $v1);
http_response_code($ok ? 200 : 400);
```

## Retry ve DLQ
- 2xx = teslim edildi.
  - 408, 429, 5xx ve ağ hatası → tekrar denenir: üstel backoff + jitter, en fazla 8 deneme.
  - Diğer 4xx kalıcı hata sayılır.
- 8 deneme dolunca job `dead` olur. `webhook_deliveries` tablosunda durum, son HTTP kodu ve deneme sayısı tutulur ve UI'da "Zustellungen" altında görünür.
- Manuel yeniden gönderim (`replayDeadJob`) çekirdekte hazır. UI'ı Sprint 2'de.
- Yönlendirmeler takip edilmez (`redirect: manual`). Zaman aşımı 10 sn.

## SSRF
Prod'da URL `https://` olmalı. DNS çözümlemesinden sonra private, loopback, link-local, CGNAT ve 169.254.169.254 gibi adresler reddedilir (`net-guard.ts`). `http://localhost` yalnızca geliştirmede kabul edilir.

## Test kapsamı
`tests/unit.test.ts`: imza, kurcalama, yanlış secret, 301 sn eski zaman damgası, private IP'ler. `tests/public-api.test.ts`: olay üretimi. Ayrıca gerçek HTTP ile `examples/cms-integration.ts` çalıştırıldı ve 3 olayın imzası geçerli çıktı.
