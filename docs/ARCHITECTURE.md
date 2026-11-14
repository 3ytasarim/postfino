# Mimari

## Monorepo (pnpm workspaces)

```
apps/
  web/      Next.js 16 + React 19: panel (Almanca varsayılan, de/en/tr), server actions
  api/      Hono: Public REST API /api/v1, OAuth callback, imzalı medya URL'leri
  worker/   Postgres kuyruk işleyici: yayın, webhook teslimi, token yenileme
  mobile/   (Sprint 6) Flutter bildirim ve manuel yayın uygulaması
packages/
  db/               Drizzle şeması (46 tablo) ve SQL migration'ları
  core/             İş kuralları: tenancy, RBAC, entitlements, posts, publisher, queue, webhooks, crypto, media
  social-adapters/  Platform adapter arayüzü, capability matrisi, Instagram (FB Login), Sandbox
  shared/           Enum'lar, hata kodları, zod API şemaları, DST güvenli saat fonksiyonları, paket varsayılanları
  config/           Doğrulanmış env
  ui/               (Sprint 2) Ortak bileşenler; şimdilik apps/web/components içinde
scripts/   dev-db (gömülü PG), seed, reels-cover-poc
examples/  cms-integration.ts: üçüncü taraf entegrasyon örneği (TypeScript)
tests/     vitest + PGlite (gerçek migration'larla)
```

## Akış: üçüncü taraf panel → yayın

```
Müşteri backend ──Bearer st_live_… + Idempotency-Key──▶ apps/api
   │  verifyApiKey → plan (public_api) → burst limit → aylık kota (429 + Retry-After)
   │  scope + workspace kontrolü → zod → createPost
   │     ├─ capability matrisi (422 CAPABILITY_NOT_SUPPORTED)
   │     ├─ medya validasyonu, API'den önce (422 MEDIA_INVALID)
   │     └─ onay gerekiyorsa PENDING_APPROVAL, gerekmiyorsa SCHEDULED + queue_items(dedup_key)
   ▼
apps/worker ── claimJobs (FOR UPDATE SKIP LOCKED + lease)
   │  stale version → skip; onay kapısı; kuyruk duraklatıldıysa → ertele
   │  koşullu UPDATE SCHEDULED→PUBLISHING (publish lock)
   │  kanal token'ı çözülür (iptal edildiyse durur) → imzalı medya URL'leri
   │  adapter.createMedia → poll → publish → permalink
   │  published_posts (unique hedef) + audit + emitEvent
   ▼
webhook_deliveries + deliver_webhook job → HMAC imzalı POST → müşteri paneli
```

## Kararlar (ADR özeti)

| # | Karar | Neden | Alternatif |
|---|---|---|---|
| 1 | **Kuyruk PostgreSQL'de** (`queue_items`, SKIP LOCKED). Spec Redis+BullMQ önerir | Tek bağımlılık. Enqueue, gönderiyle aynı transaction'da yapılabilir. Dedup unique index ile sağlanır. Hetzner'de ek servis gerekmez | Saniyede yüzlerce job gerekirse BullMQ'ya geçilir. `queue.ts` arayüzü korunur |
| 2 | Drizzle ORM | SQL'e yakın, migration dosyaları okunabilir, PGlite ile test edilebilir | Prisma |
| 3 | Public API ayrı Hono uygulaması | `api.<domain>`, bağımsız ölçeklenir, `app.request()` ile hızlı test | Next route handler |
| 4 | Instagram **Facebook Login** akışı | `cover_url` yalnızca bu akışta belgelenmiş | Instagram Login (Sprint 6'da ikinci adapter) |
| 5 | Token şifreleme AES-256-GCM + anahtar sürümü | Anahtar rotasyonu: yeni anahtar şifreler, eskiler çözer | KMS (Enterprise) |
| 6 | Yerel geliştirmede gömülü PostgreSQL 18 | Docker yok. Prod Hetzner'de PG 16+ | Neon |
| 7 | Burst rate limit süreç içinde (token bucket) | Faz 1'de tek API süreci var | Çok instance'ta Redis/PG tabanlı limiter |
| 8 | Kendi i18n katmanı (tipli sözlük) | Yeni dil eklerken eksik anahtar derlemede yakalanır | next-intl |

## Çok kiracılı izolasyon

- Her tablo `organization_id` taşır. Workspace'e ait tablolar ayrıca `workspace_id` taşır.
- Tüm servisler `authorize()` / `loadWorkspace()` kullanır. Başka tenant'ın kaydı **404** döner (varlığı sızdırılmaz).
- API anahtarı = tenant + izinli workspace listesi + scope'lar. Test anahtarları yalnızca sandbox kanallarını kullanabilir.
- Testler: `tests/public-api.test.ts` içinde "tenant A key cannot access tenant B…" (UI'daki servisler de aynı fonksiyonları kullanır).
- İleride: PostgreSQL RLS ikinci savunma hattı olarak eklenebilir (`SET app.org_id`). Sprint 2'de değerlendirilecek.

## Zaman

- `posts.scheduled_at` UTC `timestamptz` olarak, `scheduled_timezone` IANA adıyla saklanır.
- UI yerel saati `wallClockToUtc` ile çevirir. Saat ileri alındığında oluşan boşluktaki saatler reddedilir. Geri alındığında iki kez yaşanan saatlerde ilki (yaz saati) seçilir.
- Haftalık slotlar yerel saat olarak tutulur, her hafta yeniden UTC'ye çevrilir. Bu yüzden DST sonrası 09:00, yine 09:00 kalır.

## Medya

- Faz 1:
  - Yerel dosya sürücüsü kullanılır. API, `GET /media-files/*` ile HMAC imzalı ve süreli URL sunar.
  - Bağımlılıksız MP4/JPEG/PNG probe ile ilk kontrol yapılır.
  - MIME türü dosya imzasına (sniff) göre doğrulanır.
- Prod (Sprint 1 kalan + 2):
  - Hetzner Object Storage (S3, SigV4 presigned) ve multipart upload.
  - FFprobe/FFmpeg ile normalizasyon (faststart, H.264/AAC).
  - ClamAV virüs taraması. Şu an `virusScan: not_configured` olarak işaretleniyor.

## Hata yönetimi

- Hata kodları sabittir (`packages/shared/src/errors.ts`). API her zaman `{ error: { code, message, details, request_id } }` döner.
- Provider hataları retryable/final olarak sınıflanır.
  - Retryable: Meta kodları 1, 2, 4, 17, 32, 341, 613, 5xx ve 429.
- Backoff: 15 sn × 2^n, "equal jitter", üst sınır 30 dk. En fazla 6 deneme, sonra `dead` (DLQ) + `post.failed` webhook'u gönderilir.
- Çökme kurtarma: lease süresi dolan job yeniden alınır. Saklanan container `PUBLISHED` ise **tekrar yayınlanmaz**, `PUBLISH_RESULT_UNKNOWN` olarak işaretlenir.

## Ölçek ve izleme (Sprint 6 / deploy)

- PM2 ile `web`, `api` ve `worker` (2 instance) çalışır. Önde Nginx (TLS) bulunur.
- Sentry ve uptime izleme kurulacak.
- `pg_dump` ile günlük yedek alınır, Object Storage'a yüklenir ve geri yükleme testi yapılır.
