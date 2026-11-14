# Güvenlik

## Uygulananlar (Faz 1)

| Konu | Uygulama | Test |
|---|---|---|
| Şifreler | scrypt (N=2^15, r=8, p=1), NFKC; en az 10 karakter, harf ve rakam zorunlu | ✓ |
| Oturum | 32 bayt rastgele token, HttpOnly + SameSite=Lax + Secure (prod) cookie. DB'de yalnızca sha256 tutulur. 14 gün geçerli | — |
| Brute force | 8 hatalı denemeden sonra 15 dk kilit. Hata mesajı tek tip (hangi e-postaların kayıtlı olduğu anlaşılamaz) | — |
| 2FA | TOTP (RFC 6238, ±1 adım tolerans). Secret şifreli saklanır | ✓ |
| OAuth token'ları | AES-256-GCM, anahtar sürümlü (`ENCRYPTION_KEYS="v2:…,v1:…"`). Frontend'e ve API yanıtlarına hiç gönderilmez. Loglarda gizlenir | ✓ |
| Kanal koparma | Token anında silinir (`revoked`), bekleyen hedefler iptal edilir, worker yayını reddeder | ✓ |
| API anahtarları | `st_<env>_<id>_<secret>`. Yalnızca sha256 saklanır, timing-safe karşılaştırma yapılır. Bir kez gösterilir. Scope, workspace, son kullanma, iptal ve rotate destekli | ✓ |
| Idempotency | Yazma isteklerinde zorunlu. Aynı anahtar + farklı gövde → 422. 24 saat saklanır | ✓ |
| Tenant izolasyonu | Servis katmanında; başka tenant'ın kaydı 404 döner | ✓ |
| Rate limit | Anahtar başına dakikalık burst + aylık kota (429 + Retry-After) | ✓ |
| Webhook | HMAC-SHA256, zaman damgası, event-id ile replay koruması, retry/backoff, DLQ | ✓ |
| SSRF | Webhook URL'leri DNS ile çözülür; private, loopback, link-local, CGNAT ve metadata adresleri reddedilir (prod) | ✓ |
| Medya | MIME dosya imzasıyla doğrulanır, boyut sınırı uygulanır. Bucket özel; dışarıya yalnızca HMAC imzalı, süreli URL verilir | ✓ |
| HTTP başlıkları | Web: X-Frame-Options DENY, nosniff, HSTS, Referrer-Policy, Permissions-Policy. API: nosniff, no-store | — |
| CSRF | Server actions için Next.js'in origin kontrolü. Upload route'u ayrıca Origin = Host kontrolü yapar | — |
| Audit | Giriş, başarısız giriş, kanal, anahtar, webhook, gönderi ve onay olayları | ✓ |
| Sırlar | `.env` git'e girmez. Prod'da `ENCRYPTION_KEYS` ve `SESSION_SECRET` zorunlu (yoksa başlatma hata verir) | ✓ |

## Açık maddeler

- [ ] CSP (nonce tabanlı). Next 16 ile `proxy.ts` üzerinden.
- [ ] Giriş uç noktası için IP tabanlı rate limit (Nginx `limit_req` + uygulama).
- [ ] Enterprise için IP allowlist (`api_keys.ip_allowlist` alanı var, kontrol yok).
- [x] ClamAV INSTREAM (yapılandırılınca hata olursa reddeder) ve S3 SigV4 presigned URL'ler. Gerçek sunucuda test bekliyor.
- [x] Ekip: yetki yükseltme koruması, son owner koruması, çıkarılan üyenin oturumlarının iptali. Davet linki tek kullanımlık, 7 gün geçerli.
- [x] Login `next` parametresi yalnızca site içi göreli yolları kabul eder (open redirect yok). Davet e-postası URL'de taşınmaz.
- [x] Tek çağrılı yayın (Facebook) için çift yayın koruması: ağ hatasında sonuç `PUBLISH_RESULT_UNKNOWN` olur, tekrar gönderilmez.
- [x] Seçenek B (kapağı videoya ekleme) yalnızca açık onayla çalışır; orijinal asset değişmez, audit kaydı tutulur.
- [x] RSS ve webhook hedefleri SSRF korumalı; ZIP import'ta path traversal, zip-bomb, entry ve boyut limitleri var.
- [x] Müşteri portalı: token yalnızca sha256 olarak saklanır, 14 gün geçerli, tek versiyona bağlı ve tek kullanımlık; `noindex` ve `no-referrer`; IP throttle.
- [x] Start Page: herkese açık sayfa yalnızca değişmez snapshot'ı gösterir; tıklama hedefleri snapshot'tan çözülür (query string'den asla değil → açık yönlendirme yok), yalnızca http(s)/mailto. Medya rotası yalnızca snapshot'taki hazır asset'leri, `CSP default-src 'none'` ve nosniff ile sunar.
- [x] Link istatistikleri: IP ve çerez saklanmaz; yalnızca cihaz sınıfı ve referrer host. Botlar ve prefetch sayılmaz.
- [x] Kısa linkler: rastgele base62 kod (reddetmeli örnekleme), yalnızca http(s) hedef, kiracı dışı devre dışı bırakma 404.
- [x] Entegrasyon sırları (Bitly token) AES-GCM keyring ile şifreli; token kaydetmeden önce sağlayıcıda doğrulanır. Unsplash görsel indirmesi SSRF korumalı, 20 MB sınırı.
- [x] Durum sayfası kiracı verisi ve worker hostname'i göstermez. SDK indirme rotası sabit allowlist kullanır (yol parametresi dosya sistemine gitmez).
- [x] Kanal OAuth: PKCE (S256, 15 dk, tek kullanımlık state); refresh token AES-GCM ile şifreli; Bluesky uygulama şifresi yalnızca bir kez kullanılır, saklanmaz/loglanmaz (testli); Mastodon instance adresi SSRF kontrolünden geçer; instance istemci sırrı şifreli.
- [x] Mobil API: web ile aynı oturum tablosu (2FA, çıkış, "her yerden çık" geçerli), IP başına 10 giriş / 10 dk; CORS yalnızca MOBILE_WEB_ORIGINS ile (web derlemesi için).
- [x] Stripe webhook: imza (HMAC-SHA256, 5 dk), olay kimliği tekil → tekrar oynatma etkisiz; bilinmeyen müşteri hiçbir organizasyona uygulanmaz.
- [x] Platform admin yalnızca super admin; sayfa diğerleri için 404; her değişiklik audit'li.
- [x] Tarayıcı eklentisi: yalnızca contextMenus/activeTab/storage izni, host izni yok, kimlik bilgisi saklamaz, yalnızca http(s) URL'ler iletilir.
- [x] AI: kaynak içerik data olarak işaretlenir, sistem prompt'u talimatları reddeder, `</source>` enjeksiyonu temizlenir; çıktı otomatik yayınlanmaz.
- [ ] `npm audit` / Dependabot, CI'da Lighthouse ve güvenlik taraması.
- [ ] PostgreSQL RLS (ikinci savunma hattı).
- [ ] Anahtar rotasyonu sırasında token'ları yeni anahtarla yeniden şifreleyen betik.
- [ ] OWASP Top 10 incelemesi ve harici pentest (canlıya çıkmadan önce).
- [ ] E-posta doğrulamasını zorunlu kılma politikası (ör. API anahtarı oluşturmadan önce). Altyapı hazır.
