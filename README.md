# Postfino

Social-Media-Planung für Selbstständige, Teams und Agenturen — https://www.postfino.com
Postfino ist eine Anwendung der Bleibsichtbar LLC.

Çok kiracılı sosyal medya planlama SaaS'ı: kalender, fikir panosu, community kutusu, insights, ekip onayları, Instagram Reels için bağımsız kapak ve Pro paketten itibaren Public API.

## Yapı

```
apps/web       Next.js panel (:3610, varsayılan dil Almanca)
apps/api       Public API, OAuth callback, imzalı medya (:3611)
apps/worker    yayın ve webhook kuyruğu
packages/*     core, db (Drizzle), shared, config, social-adapters
landing/       postfino.com tanıtım sitesi (Next.js, :3630, ayrı bağımlılıklar)
extension/     tarayıcı eklentisi
sdks/          TypeScript ve PHP SDK
```

## Hızlı başlangıç (Windows/macOS/Linux, Docker gerekmez)

```bash
pnpm install
pnpm db:start        # gömülü PostgreSQL :54347 (ayrı terminalde açık kalır)
pnpm db:migrate
pnpm db:seed         # demo ajans + SANDBOX kanal (test hesabı bilgileri scripts/seed.ts içinde)
pnpm dev:api
pnpm dev:worker
pnpm dev:web
pnpm test            # PGlite + gerçek migration'lar; PHP SDK testi için PHP_BIN=<php yolu>
pnpm poc:reels --video reel.mp4 --cover cover.jpg   # Reels kapak denemesi (dry-run)
```

Landing:

```bash
cd landing
pnpm install --ignore-workspace
pnpm dev
```

`.env.example` dosyasını `.env` olarak kopyalayın. Meta anahtarları yoksa gerçek Instagram bağlantısı "Nicht konfiguriert" olarak görünür; Sandbox kanalı (MOCK) kullanılabilir.

## Dokümanlar
`docs/`: ARCHITECTURE, SECURITY, PLATFORM_CAPABILITIES, KANAL_BAGLANTI_KURULUMU, API_OPENAPI.yaml, DEVELOPER_PORTAL, WEBHOOK_SECURITY
