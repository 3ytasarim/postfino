import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { renderMailHtml, renderMailText, type MailLocale, type MailSpec } from "./mail-layout";

// Transactional mail. Without SMTP_URL the DevOutboxMailer writes .eml files and reports `delivered: false`
// so callers / UI never claim an email was sent when it was not.

export type Mail = { to: string; subject: string; text: string; html?: string };
export type SendResult = { delivered: boolean; transport: "smtp" | "outbox"; id: string };

export interface Mailer {
  readonly configured: boolean;
  send(m: Mail): Promise<SendResult>;
}

export class SmtpMailer implements Mailer {
  readonly configured = true;
  private readonly t;
  constructor(url: string, private readonly from: string) {
    this.t = nodemailer.createTransport(url);
  }
  async send(m: Mail): Promise<SendResult> {
    const info = await this.t.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    return { delivered: true, transport: "smtp", id: info.messageId };
  }
}

export class DevOutboxMailer implements Mailer {
  readonly configured = false;
  readonly sent: Mail[] = [];
  constructor(private readonly dir: string | null, private readonly from: string) {}
  async send(m: Mail): Promise<SendResult> {
    const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    this.sent.push(m);
    if (this.dir) {
      await mkdir(this.dir, { recursive: true });
      const eml = `From: ${this.from}\nTo: ${m.to}\nSubject: ${m.subject}\nContent-Type: text/plain; charset=utf-8\n\n${m.text}\n`;
      await writeFile(path.join(this.dir, `${id}.eml`), eml);
      if (m.html) await writeFile(path.join(this.dir, `${id}.html`), m.html); // open in a browser to preview the design
    }
    return { delivered: false, transport: "outbox", id };
  }
}

// ── Templates (DE default; EN/TR) ── one spec per mail → HTML (mail-layout) + plain-text alternative
type Locale = MailLocale;
type Spec = (l: Locale) => MailSpec;

const S = {
  signupCode: (code: string): Spec => (l) =>
    ({
      de: { subject: `${code} ist dein Bestätigungscode`, preheader: "Willkommen bei Postfino – bestätige deine E-Mail-Adresse.", eyebrow: "Willkommen", title: "Schön, dass du da bist!", paragraphs: ["Die ganze Crew freut sich schon auf deine ersten Beiträge. Bestätige kurz deine E-Mail-Adresse mit diesem Code:"], code, codeHint: "Code zum Kopieren:", note: "Der Code ist 10 Minuten gültig. Gib ihn nicht weiter – wir fragen nie danach. Warst du das nicht? Dann ignoriere diese E-Mail.", tone: "cobalt" as const },
      en: { subject: `${code} is your verification code`, preheader: "Welcome to Postfino – confirm your email address.", eyebrow: "Welcome", title: "Great to have you here!", paragraphs: ["The whole crew can't wait for your first posts. Quickly confirm your email address with this code:"], code, codeHint: "Code to copy:", note: "The code is valid for 10 minutes. Never share it – we will never ask for it. Not you? Ignore this email.", tone: "cobalt" as const },
      tr: { subject: `Doğrulama kodun: ${code}`, preheader: "Postfino'ya hoş geldin – e-posta adresini doğrula.", eyebrow: "Hoş geldin", title: "Aramıza hoş geldin!", paragraphs: ["Tüm ekip ilk gönderilerini bekliyor. E-posta adresini bu kodla hızlıca doğrula:"], code, codeHint: "Kopyalamak için kod:", note: "Kod 10 dakika geçerlidir. Kimseyle paylaşma – biz asla istemeyiz. Bu sen değilsen e-postayı yok say.", tone: "cobalt" as const },
    })[l],
  loginCode: (code: string, provider: string): Spec => (l) =>
    ({
      de: { subject: `${code} ist dein Anmeldecode`, preheader: `Anmeldung mit ${provider} bestätigen.`, eyebrow: "Anmeldung", title: "Fast geschafft!", paragraphs: [`Du meldest dich gerade mit ${provider} bei Postfino an. Gib diesen Code ein, um die Anmeldung abzuschließen:`], code, codeHint: "Code zum Kopieren:", note: "Der Code ist 10 Minuten gültig. Warst du das nicht? Dann ignoriere diese E-Mail – ohne den Code ist keine Anmeldung möglich.", tone: "violet" as const },
      en: { subject: `${code} is your sign-in code`, preheader: `Confirm your sign-in with ${provider}.`, eyebrow: "Sign-in", title: "Almost there!", paragraphs: [`You are signing in to Postfino with ${provider}. Enter this code to finish signing in:`], code, codeHint: "Code to copy:", note: "The code is valid for 10 minutes. Not you? Ignore this email – nobody can sign in without the code.", tone: "violet" as const },
      tr: { subject: `Giriş kodun: ${code}`, preheader: `${provider} ile girişini onayla.`, eyebrow: "Giriş", title: "Az kaldı!", paragraphs: [`Postfino'ya ${provider} ile giriş yapıyorsun. Girişi tamamlamak için bu kodu gir:`], code, codeHint: "Kopyalamak için kod:", note: "Kod 10 dakika geçerlidir. Bu sen değilsen e-postayı yok say – kod olmadan giriş yapılamaz.", tone: "violet" as const },
    })[l],
  reset: (link: string): Spec => (l) =>
    ({
      de: { subject: "Passwort zurücksetzen", preheader: "Lege in einer Minute ein neues Passwort fest.", eyebrow: "Passwort", title: "Neues Passwort? Kein Problem.", paragraphs: ["Über den Button legst du ein neues Passwort für dein Postfino-Konto fest."], button: { label: "Neues Passwort festlegen", url: link }, note: "Der Link ist 1 Stunde gültig. Falls du das nicht angefordert hast, ignoriere diese E-Mail – dein Passwort bleibt unverändert.", tone: "rose" as const },
      en: { subject: "Reset your password", preheader: "Set a new password in a minute.", eyebrow: "Password", title: "New password? No problem.", paragraphs: ["Use the button to set a new password for your Postfino account."], button: { label: "Set new password", url: link }, note: "The link is valid for 1 hour. If you did not request this, ignore this email – your password stays unchanged.", tone: "rose" as const },
      tr: { subject: "Şifre sıfırlama", preheader: "Bir dakikada yeni şifreni belirle.", eyebrow: "Şifre", title: "Yeni şifre mi? Sorun değil.", paragraphs: ["Postfino hesabın için yeni şifreni butondan belirleyebilirsin."], button: { label: "Yeni şifre belirle", url: link }, note: "Bağlantı 1 saat geçerlidir. Bu isteği sen yapmadıysan e-postayı yok say – şifren değişmez.", tone: "rose" as const },
    })[l],
  verify: (link: string): Spec => (l) =>
    ({
      de: { subject: "E-Mail-Adresse bestätigen", preheader: "Ein Klick, und dein Konto ist startklar.", eyebrow: "Bestätigung", title: "Ein Klick noch!", paragraphs: ["Bitte bestätige deine E-Mail-Adresse, damit wir dich über Freigaben, Veröffentlichungen und Sicherheit informieren können."], button: { label: "E-Mail bestätigen", url: link }, tone: "mint" as const },
      en: { subject: "Confirm your email address", preheader: "One click and your account is ready.", eyebrow: "Confirmation", title: "Just one click!", paragraphs: ["Please confirm your email address so we can keep you posted about approvals, publishing and security."], button: { label: "Confirm email", url: link }, tone: "mint" as const },
      tr: { subject: "E-posta adresini doğrula", preheader: "Tek tık, hesabın hazır.", eyebrow: "Doğrulama", title: "Tek bir tık kaldı!", paragraphs: ["Onaylar, yayınlar ve güvenlik hakkında seni bilgilendirebilmemiz için e-posta adresini doğrula."], button: { label: "E-postayı doğrula", url: link }, tone: "mint" as const },
    })[l],
  invite: (org: string, link: string): Spec => (l) =>
    ({
      de: { subject: `Einladung zu ${org} auf Postfino`, preheader: `Das Team „${org}“ möchte mit dir planen und veröffentlichen.`, eyebrow: "Einladung", title: `Du bist im Team „${org}“ eingeladen`, paragraphs: ["Plane, prüfe und veröffentliche Beiträge gemeinsam – für alle Kanäle an einem Ort. Die Crew wartet schon auf dich."], button: { label: "Einladung annehmen", url: link }, note: "Der Link ist 7 Tage gültig.", tone: "mint" as const },
      en: { subject: `Invitation to ${org} on Postfino`, preheader: `The team "${org}" wants to plan and publish with you.`, eyebrow: "Invitation", title: `You're invited to "${org}"`, paragraphs: ["Plan, review and publish together – every channel in one place. The crew is already waiting for you."], button: { label: "Accept invitation", url: link }, note: "The link is valid for 7 days.", tone: "mint" as const },
      tr: { subject: `Postfino'da ${org} daveti`, preheader: `"${org}" ekibi seninle planlamak ve yayınlamak istiyor.`, eyebrow: "Davet", title: `"${org}" ekibine davetlisin`, paragraphs: ["Gönderileri birlikte planla, onayla ve yayınla – tüm kanallar tek yerde. Ekip seni bekliyor."], button: { label: "Daveti kabul et", url: link }, note: "Bağlantı 7 gün geçerlidir.", tone: "mint" as const },
    })[l],
  approvalPending: (caption: string, link: string): Spec => (l) =>
    ({
      de: { subject: "Freigabe ausstehend – Postfino", preheader: "Ein Beitrag wartet auf dein OK.", eyebrow: "Freigabe", title: "Ein Beitrag wartet auf dein OK", paragraphs: [`„${caption}“`, "Sieh ihn dir an und gib ihn frei oder hinterlasse Feedback."], button: { label: "Beitrag ansehen", url: link }, tone: "violet" as const },
      en: { subject: "Approval pending – Postfino", preheader: "A post is waiting for your OK.", eyebrow: "Approval", title: "A post is waiting for your OK", paragraphs: [`"${caption}"`, "Take a look and approve it or leave feedback."], button: { label: "View post", url: link }, tone: "violet" as const },
      tr: { subject: "Onay bekliyor – Postfino", preheader: "Bir gönderi onayını bekliyor.", eyebrow: "Onay", title: "Bir gönderi onayını bekliyor", paragraphs: [`"${caption}"`, "Göz at, onayla ya da geri bildirim bırak."], button: { label: "Gönderiyi gör", url: link }, tone: "violet" as const },
    })[l],
  accountDeleted: (): Spec => (l) =>
    ({
      de: { subject: "Dein Postfino-Konto wurde gelöscht", preheader: "Bestätigung der Kontolöschung.", eyebrow: "Konto gelöscht", title: "Schade, dass du gehst", paragraphs: ["Dein Postfino-Konto wurde auf deinen Wunsch gelöscht. Verbundene Social-Media-Konten wurden getrennt und ihre Zugriffsschlüssel vernichtet; Teams, in denen du das einzige Mitglied warst, wurden mit allen Inhalten und Medien entfernt.", "Du bist jederzeit wieder willkommen."], note: "Warst du das nicht? Antworte bitte sofort auf diese E-Mail.", tone: "rose" as const, calm: true },
      en: { subject: "Your Postfino account was deleted", preheader: "Confirmation of your account deletion.", eyebrow: "Account deleted", title: "Sorry to see you go", paragraphs: ["Your Postfino account was deleted at your request. Connected social accounts were disconnected and their access tokens destroyed; teams in which you were the only member were removed with all content and media.", "You are welcome back any time."], note: "Not you? Please reply to this email right away.", tone: "rose" as const, calm: true },
      tr: { subject: "Postfino hesabın silindi", preheader: "Hesap silme onayı.", eyebrow: "Hesap silindi", title: "Gitmene üzüldük", paragraphs: ["Postfino hesabın isteğin üzerine silindi. Bağlı sosyal medya hesapları ayrıldı ve erişim anahtarları yok edildi; tek üyesi olduğun ekipler tüm içerik ve medyalarıyla kaldırıldı.", "Her zaman yeniden bekleriz."], note: "Bunu sen yapmadıysan lütfen hemen bu e-postayı yanıtla.", tone: "rose" as const, calm: true },
    })[l],
};

const loc = (l: string): Locale => (l === "en" || l === "tr" ? l : "de");
const build = (l: string, spec: Spec) => {
  const lang = loc(l);
  const m = spec(lang);
  return { subject: m.subject, text: renderMailText(lang, m), html: renderMailHtml(lang, m) };
};
export const mailTemplates = {
  invite: (l: string, org: string, link: string) => build(l, S.invite(org, link)),
  reset: (l: string, link: string) => build(l, S.reset(link)),
  signupCode: (l: string, code: string) => build(l, S.signupCode(code)),
  loginCode: (l: string, code: string, provider: string) => build(l, S.loginCode(code, provider)),
  verify: (l: string, link: string) => build(l, S.verify(link)),
  approvalPending: (l: string, caption: string, link: string) => build(l, S.approvalPending(caption, link)),
  accountDeleted: (l: string) => build(l, S.accountDeleted()),
};
