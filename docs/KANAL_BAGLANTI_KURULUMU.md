# Sosyal medya bağlantıları — kurulum rehberi

Bleibsichtbar Puffer her ağa **resmî OAuth girişiyle** bağlanır. Kod tarafı hazır; her ağ için bir
**geliştirici uygulaması** açıp anahtarlarını kök `.env` dosyasına yazmak gerekiyor. Anahtar olmayan ağ
"bağlanamaz" görünür, sahte başarı gösterilmez.

## 0. Önce karar: herkese açık HTTPS adres

Bazı ağlar yönlendirme adresi (redirect URI) olarak **yalnızca HTTPS** kabul eder (Meta/Threads, TikTok,
Pinterest). Instagram ayrıca paylaşılacak videoyu **herkese açık bir URL'den** kendisi indirir.

| Seçenek | Ne gerekir |
|---|---|
| A) Hetzner'da test alt alanı (ör. `puffer.bleibsichtbar.de` + `api.puffer.bleibsichtbar.de`) | DNS kaydı + deploy onayı |
| B) Geçici Cloudflare Tunnel (ücretsiz) | Yerel bilgisayar açıkken çalışır; deploy onayı gerekmez ama uygulama internete açılır |

Yerelde bile çalışanlar: **Google (YouTube, Business), LinkedIn, X, Bluesky, Mastodon** — `http://localhost` kabul ediyorlar.

**Yönlendirme adresi (her ağa aynısı yazılır):**

- Yerel: `http://localhost:3611/oauth/callback`
- Canlı: `https://<API-alan-adı>/oauth/callback`  (`.env` → `API_URL`)

---

## 1. Meta — Instagram (Business/Creator) + Facebook Sayfası

Uygulama: **Bleibsichtbar Puffer** (tür: İşletme), kullanım senaryoları **Manage messaging & content on Instagram**
ve **Manage everything on your Page**. Kod iki giriş yöntemini de destekler:

**A) Instagram API with Unified Login (önerilen; 2026 sonundan beri yeni uygulamalarda tek seçenek) — META_CONFIG_ID ile**
Kaynak: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
- Müşteri tek bir Meta penceresinde **Instagram ile** ya da Facebook ile devam eder; **Facebook Sayfası gerekmez**.
- Token, müşterinin **işletme portföyüne** ait bir *system-user* token'ıdır (SUAT) — çok kiracılı kullanım için doğru tür.
- Uygulamanın sahibi bir işletme portföyü olmalı (yoksa "Unified login" sekmesi görünmez).
1. Use cases → Instagram API → **API setup with Unified login** → **Create new configuration** → şablondan oluştur.
2. Facebook Login for Business → **Configurations** → bu yapılandırma → **Edit**:
   `business_management` ve `instagram_manage_insights` ekle (Unified sekmesindeki düzenleyici `business_management`'ı
   sunmuyor; eksik olursa Meta hiç Instagram hesabı döndürmüyor). Reklam varlığı/izinleri kaldırılabiliyorsa kaldır.
3. Aynı sayfada **Register a new redirect URL** → yönlendirme adresi.
4. **Configuration ID** → `META_CONFIG_ID=...`
5. Test: test eden kişinin uygulamada rolü olmalı ve müşteri işletmesinde tam yetkisi olmalı. Rolü olmayan müşteriler için
   App Review (Advanced Access) + işletme doğrulaması + Live mod gerekir.

**B) Facebook login (eski ama çalışıyor) — META_CONFIG_ID boş bırakılır**
API setup with Facebook login → *Add required content permissions*, ayrıca "Permissions and features" sayfasından
`instagram_manage_comments` ve `instagram_manage_insights`. Redirect URI: Facebook Login for Business → Settings.

**Her iki yöntemde:** App settings → Basic →
```
META_APP_ID=...
META_APP_SECRET=...
```
**3ytasarim testi:** uygulama Development modunda kalabilir; Instagram hesabı Profesyonel olmalı, bir Facebook
Sayfasına bağlı olmalı ve giriş yapan Facebook hesabı uygulamada Admin/Tester olmalı. Herkese açık kullanım için:
işletme doğrulaması + App Review (ideal olarak uygulama Bleibsichtbar LLC işletme hesabına taşınır).
Video için: `MEDIA_PUBLIC_BASE_URL=https://...` (Meta'nın indirebileceği adres).

## 2. Threads

1. Aynı Meta geliştirici hesabında **yeni uygulama** → kullanım senaryosu **Access the Threads API**.
2. Redirect: yönlendirme adresi (HTTPS şart).
3. ```
   THREADS_APP_ID=...
   THREADS_APP_SECRET=...
   ```
4. Tester olarak kendi Threads hesabını ekle (Threads uygulamasından daveti kabul et).

## 3. LinkedIn (profil + şirket sayfası)

1. https://www.linkedin.com/developers/apps → **Create app** (bir LinkedIn şirket sayfasıyla ilişkilendirilir).
2. Products: **Sign In with LinkedIn using OpenID Connect** + **Share on LinkedIn** (anında onay).
3. Auth → **Authorized redirect URLs**: yönlendirme adresi.
4. ```
   LINKEDIN_CLIENT_ID=...
   LINKEDIN_CLIENT_SECRET=...
   ```
5. Şirket sayfasına paylaşım için ek ürün: **Community Management API** (başvuru + onay gerekir).

## 4. TikTok

1. https://developers.tiktok.com → **Manage apps → Connect an app**.
2. Products: **Login Kit** + **Content Posting API** (Direct Post açık).
3. Redirect URI (HTTPS) + alan adı doğrulaması.
4. ```
   TIKTOK_CLIENT_KEY=...
   TIKTOK_CLIENT_SECRET=...
   ```
5. TikTok denetimi (audit) bitene kadar paylaşımlar **yalnızca "Sadece ben"** görünür; bu kısıtı uygulama dürüstçe gösterir.

## 5. Google — YouTube + Google Business Profile

1. https://console.cloud.google.com → yeni proje.
2. APIs & Services → **YouTube Data API v3** etkinleştir.
   Business Profile için: **My Business** API'leri (Google'a erişim başvurusu gerekir).
3. **OAuth consent screen**: External, *Testing* modu, kendi Google hesabını **Test user** ekle.
4. Credentials → **OAuth client ID** → Web application → redirect URI ekle.
5. ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
6. Not: Google denetiminden geçmemiş projelerden yüklenen YouTube videoları **gizli** kalır.
   (Bu Google projesi ileride "Google ile giriş" için de kullanılabilir.)

## 6. X (Twitter)

1. https://developer.x.com → Project + App.
2. **User authentication settings** → OAuth 2.0, tür **Web App**, callback = yönlendirme adresi.
3. ```
   X_CLIENT_ID=...
   X_CLIENT_SECRET=...
   ```
4. **Ücret uyarısı:** Free katmanı çok sınırlı (aylık az sayıda paylaşım). Basic ve üstü **ücretli** —
   seçmeden önce bana onay ver.

## 7. Pinterest

1. https://developers.pinterest.com → **My apps → Connect app** (Pinterest işletme hesabı gerekir).
2. Redirect URI (HTTPS).
3. ```
   PINTEREST_APP_ID=...
   PINTEREST_APP_SECRET=...
   ```
4. Başta **Trial access** verilir (sınırlı); tam erişim için **Standard access** başvurusu.

## 8. Bluesky ve Mastodon — hazır ✅

Geliştirici uygulaması gerekmiyor; `.env` içinde açıldı:
```
BLUESKY_ENABLED=true
MASTODON_ENABLED=true
```
- Bluesky: kullanıcı kendi **App Password**'ünü girer (Ayarlar → Privacy and security → App passwords).
- Mastodon: kullanıcı sunucusunu yazar (ör. `mastodon.social`), uygulama o sunucuya kendini otomatik kaydeder.

## 9. Sadece hatırlatma ile çalışanlar

Instagram kişisel hesap, Facebook grupları ve Substack'in resmî paylaşım API'si yok. Bu kanallar
"Nur Erinnerung" modunda çalışır: zamanı gelince bildirim gelir, paylaşımı kullanıcı kendisi yapar.

---

## Anahtarları verdikten sonra

1. Değerleri kök `.env` dosyasına yaz (bu dosya git'e girmez) veya bana güvenli şekilde ilet.
2. Sunucuları yeniden başlatırım; bağlantı penceresinde ilgili ağ etkin görünür.
3. Bağlantıyı test ederiz. **Canlı paylaşım** her zaman ayrıca onayınla yapılır.
