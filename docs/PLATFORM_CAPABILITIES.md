# Platform Capability Matrisi

**Sürüm:** `2026-11-08` (`CAPABILITY_MATRIX_VERSION`)
**Kod kaynağı:** `packages/social-adapters/src/capabilities.ts`

Çalışırken geçerli durum şu sırayla belirlenir:
1. `channel_capabilities` tablosunda o kanal için satır varsa o kullanılır.
2. Yoksa aynı tabloda platform için satır varsa o kullanılır.
3. Yoksa koddaki varsayılan kullanılır.

## Durum tanımları

| Durum | Anlamı | Otomatik yayın? |
|---|---|---|
| `supported` | Resmî API'de var ve SichtTakt'ta doğrulandı | ✅ |
| `requires_app_review` | Resmî API'de var. Üçüncü taraf hesaplar için Meta/LinkedIn vb. inceleme gerekir. Test hesaplarında çalışır | ✅ (izinler varsa) |
| `requires_manual_notification` | API desteklemiyor. Kullanıcıya hatırlatma gider, paylaşımı kendisi yapar | ❌ yalnızca `notification` |
| `unverified` | Dokümanda var ya da belirsiz, ama canlı doğrulanmadı | ❌ yalnızca `notification` (kapak için `video_frame` da önerilir) |
| `unsupported` | Mümkün değil | ❌ 422 `CAPABILITY_NOT_SUPPORTED` |

## Özet (ayrıntılar kod dosyasında, kaynak linkleriyle)

| Platform | Yayın tipleri | Reels kapağı | Insights | Yorumlar | Adapter |
|---|---|---|---|---|---|
| Instagram Business/Creator (FB Login) | image, carousel, reel, story: `requires_app_review`; text: `unsupported` | `unverified` (PoC bekliyor) | `requires_app_review` | `requires_app_review` | **Var** (reel, image, carousel, story, ilk yorum) |
| Instagram Personal | tümü `requires_manual_notification` | manuel | unsupported | unsupported | Yok (yalnızca bildirim) |
| Facebook Pages | text/image/video, ilk yorum: `requires_app_review`; reel/story/carousel: `unverified` | — | `requires_app_review` | `requires_app_review` | **Var** (feed/photos/videos) |
| Facebook Groups | `requires_manual_notification` | — | unsupported | unsupported | Bildirim |
| LinkedIn Pages | `requires_app_review` (Community Management API) | — | review | review | **Var** (Sprint 6, canlı test yok) |
| LinkedIn Profile | `unverified` | — | unsupported | — | **Var** (Sprint 6, canlı test yok) |
| TikTok | video: `requires_app_review` (audit yoksa yalnızca private) | — | unverified | unverified | **Var** (Sprint 6, canlı test yok) |
| YouTube Shorts | `unverified` (quota 1600 birim/upload) | — | unverified | unverified | **Var** (Sprint 6, canlı test yok) |
| X | `unverified` (**ücretli API kademesi**) | — | unverified | unverified | **Var** (Sprint 6, canlı test yok) |
| Threads, Pinterest, Bluesky, Mastodon | `unverified` | — | unverified | unverified | **Var** (Sprint 6, canlı test yok) |
| Google Business Profile | `requires_app_review` (erişim başvurusu) | — | unverified | unverified | **Var** (Sprint 6, canlı test yok) |
| Substack Notes | `unsupported` (resmî API yok) → bildirim | — | — | — | Bildirim |
| Start Page | `supported` (kendi ürünümüz) | — | `supported` (kendi istatistik) | — | Sprint 5 |
| Sandbox (MOCK) | tümü `supported`, ağa istek atmaz | ✓ | — | — | **Var** |

## Instagram Reels limitleri (validasyon kodunda)

| | Değer |
|---|---|
| Video | MP4/MOV, H.264/HEVC, AAC, 3 sn–15 dk, ≤ 300 MB, genişlik ≤ 1920, 23–60 fps, moov atom başta |
| Kapak | JPEG, ≤ 8 MB, 9:16 önerilir (değilse uyarı verilir, engellenmez) |
| Caption | ≤ 2200 karakter, ≤ 30 hashtag |
| Collaborator | ≤ 3; trial reels ile birlikte kullanılamaz |

## Güncelleme kuralı

Her platform dokümanı değiştiğinde:
1. `CAPABILITY_MATRIX_VERSION` artırılır.
2. Kod ve bu dosya güncellenir.
3. Adapter sözleşme testleri çalıştırılır.

Canlı doğrulama, `verified_at` alanı dolu bir DB satırıyla kayda geçer.
