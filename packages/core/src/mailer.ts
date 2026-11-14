import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

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
    }
    return { delivered: false, transport: "outbox", id };
  }
}

// ── Templates (DE default; EN/TR) ──
type Locale = "de" | "en" | "tr";
const T = {
  invite: {
    de: (org: string, link: string) => ({ subject: `Einladung zu ${org} auf Postfino`, text: `Hallo,\n\nDu wurdest eingeladen, im Team „${org}“ auf Postfino mitzuarbeiten.\n\nEinladung annehmen: ${link}\n\nDer Link ist 7 Tage gültig.\n\n— Postfino by Bleibsichtbar LLC` }),
    en: (org: string, link: string) => ({ subject: `Invitation to ${org} on Postfino`, text: `Hi,\n\nYou were invited to join "${org}" on Postfino.\n\nAccept: ${link}\n\nThe link is valid for 7 days.\n\n— Postfino by Bleibsichtbar LLC` }),
    tr: (org: string, link: string) => ({ subject: `Postfino'da ${org} daveti`, text: `Merhaba,\n\nPostfino'da "${org}" ekibine davet edildin.\n\nDaveti kabul et: ${link}\n\nBağlantı 7 gün geçerlidir.\n\n— Postfino by Bleibsichtbar LLC` }),
  },
  reset: {
    de: (link: string) => ({ subject: "Passwort zurücksetzen", text: `Hallo,\n\nüber diesen Link kannst du ein neues Passwort festlegen (1 Stunde gültig):\n${link}\n\nFalls du das nicht angefordert hast, ignoriere diese E-Mail.` }),
    en: (link: string) => ({ subject: "Reset your password", text: `Hi,\n\nset a new password with this link (valid for 1 hour):\n${link}\n\nIf you did not request this, ignore this email.` }),
    tr: (link: string) => ({ subject: "Şifre sıfırlama", text: `Merhaba,\n\nyeni şifreni bu bağlantıyla belirleyebilirsin (1 saat geçerli):\n${link}\n\nBu isteği sen yapmadıysan e-postayı yok say.` }),
  },
  signupCode: {
    de: (code: string) => ({ subject: `${code} ist dein Bestätigungscode`, text: `Willkommen bei Postfino!\n\nDein Bestätigungscode:\n\n    ${code}\n\nGib ihn auf der Seite ein, um deine E-Mail-Adresse zu bestätigen. Der Code ist 10 Minuten gültig.\nGib ihn nicht weiter – wir fragen nie danach. Warst du das nicht? Dann ignoriere diese E-Mail.\n\n— Postfino by Bleibsichtbar LLC` }),
    en: (code: string) => ({ subject: `${code} is your verification code`, text: `Welcome to Postfino!\n\nYour verification code:\n\n    ${code}\n\nEnter it on the page to confirm your email address. The code is valid for 10 minutes.\nNever share it – we will never ask for it. Not you? Ignore this email.\n\n— Postfino by Bleibsichtbar LLC` }),
    tr: (code: string) => ({ subject: `Doğrulama kodun: ${code}`, text: `Postfino'ya hoş geldin!\n\nDoğrulama kodun:\n\n    ${code}\n\nE-posta adresini doğrulamak için sayfaya gir. Kod 10 dakika geçerlidir.\nKimseyle paylaşma – biz asla istemeyiz. Bu sen değilsen e-postayı yok say.\n\n— Postfino by Bleibsichtbar LLC` }),
  },
  loginCode: {
    de: (code: string, provider: string) => ({ subject: `${code} ist dein Anmeldecode`, text: `Hallo,\n\ndu meldest dich gerade mit ${provider} bei Postfino an. Dein Bestätigungscode:\n\n    ${code}\n\nDer Code ist 10 Minuten gültig. Gib ihn nicht weiter – wir fragen nie danach.\nWarst du das nicht? Dann ignoriere diese E-Mail; ohne den Code ist keine Anmeldung möglich.\n\n— Postfino by Bleibsichtbar LLC` }),
    en: (code: string, provider: string) => ({ subject: `${code} is your sign-in code`, text: `Hi,\n\nyou are signing in to Postfino with ${provider}. Your verification code:\n\n    ${code}\n\nThe code is valid for 10 minutes. Never share it – we will never ask for it.\nNot you? Ignore this email; nobody can sign in without the code.\n\n— Postfino by Bleibsichtbar LLC` }),
    tr: (code: string, provider: string) => ({ subject: `Giriş kodun: ${code}`, text: `Merhaba,\n\nPostfino'ya ${provider} ile giriş yapıyorsun. Doğrulama kodun:\n\n    ${code}\n\nKod 10 dakika geçerlidir. Kimseyle paylaşma – biz asla istemeyiz.\nBu sen değilsen e-postayı yok say; kod olmadan giriş yapılamaz.\n\n— Postfino by Bleibsichtbar LLC` }),
  },
  verify: {
    de: (link: string) => ({ subject: "E-Mail-Adresse bestätigen", text: `Willkommen bei Postfino!\n\nBitte bestätige deine E-Mail-Adresse:\n${link}` }),
    en: (link: string) => ({ subject: "Confirm your email address", text: `Welcome to Postfino!\n\nPlease confirm your email address:\n${link}` }),
    tr: (link: string) => ({ subject: "E-posta adresini doğrula", text: `Postfino'ya hoş geldin!\n\nLütfen e-posta adresini doğrula:\n${link}` }),
  },
};
const loc = (l: string): Locale => (l === "en" || l === "tr" ? l : "de");
export const mailTemplates = {
  invite: (l: string, org: string, link: string) => T.invite[loc(l)](org, link),
  reset: (l: string, link: string) => T.reset[loc(l)](link),
  signupCode: (l: string, code: string) => T.signupCode[loc(l)](code),
  loginCode: (l: string, code: string, provider: string) => T.loginCode[loc(l)](code, provider),
  verify: (l: string, link: string) => T.verify[loc(l)](link),
};
