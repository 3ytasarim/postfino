// HTML layout for every transactional mail (sign-up code, sign-in code, reset, verify, invite, approvals, deletion).
// Built for real mail clients: tables + inline styles (Gmail strips <style> in some views), bulletproof button,
// 600px column, PNG images (Outlook has no WebP), solid colour fallbacks for gradients, dark-mode overrides for
// Apple Mail / iOS / Outlook.com. Images are served by the public website (landing/public/email).

export const MAIL_ASSET_BASE = (process.env.MAIL_ASSET_BASE_URL ?? "https://www.postfino.com/email").replace(/\/$/, "");
const SITE = "https://www.postfino.com";

export type MailLocale = "de" | "en" | "tr";
export type MailTone = "cobalt" | "mint" | "violet" | "rose";

export type MailSpec = {
  subject: string;
  preheader: string;
  eyebrow: string;
  title: string;
  paragraphs: string[];
  code?: string;
  codeHint?: string;
  button?: { label: string; url: string };
  note?: string;
  tone?: MailTone;
  /** Smaller, quieter hero (e.g. the account-deleted mail). */
  calm?: boolean;
};

const TONES: Record<MailTone, { fg: string; bg: string }> = {
  cobalt: { fg: "#0047ab", bg: "#e4edff" },
  mint: { fg: "#0b7a60", bg: "#dcf7ef" },
  violet: { fg: "#5b3fd6", bg: "#ece7ff" },
  rose: { fg: "#b4234a", bg: "#ffe4ec" },
};

const FOOTER: Record<MailLocale, { team: string; why: string; privacy: string; imprint: string; help: string; product: string }> = {
  de: { team: "Dein Postfino-Team", why: "Du erhältst diese E-Mail, weil sie zu deinem Postfino-Konto gehört.", privacy: "Datenschutz", imprint: "Impressum", help: "Hilfe", product: "Postfino – eine Anwendung der Bleibsichtbar LLC" },
  en: { team: "Your Postfino team", why: "You are receiving this email because it relates to your Postfino account.", privacy: "Privacy", imprint: "Imprint", help: "Help", product: "Postfino – an application by Bleibsichtbar LLC" },
  tr: { team: "Postfino ekibin", why: "Bu e-postayı Postfino hesabınla ilgili olduğu için alıyorsun.", privacy: "Gizlilik", imprint: "Künye", help: "Yardım", product: "Postfino – Bleibsichtbar LLC uygulaması" },
};

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FONT = "'Inter','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "'Space Grotesk','Inter','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif";
const MONO = "'SF Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";

function codeBlock(code: string, hint?: string) {
  const cells = [...code]
    .map(
      (d) =>
        `<td class="pf-digit" align="center" valign="middle" width="48" height="60" style="width:48px;height:60px;background:#f2f6ff;border:1px solid #d5e0f7;border-radius:14px;font-family:${MONO};font-size:30px;line-height:60px;font-weight:700;color:#0b1020;">${esc(d)}</td><td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0;"><tr>${cells}</tr></table>
<p class="pf-muted" style="margin:14px 0 0;text-align:center;font-family:${FONT};font-size:13px;line-height:20px;color:#5f677c;">${hint ? `${esc(hint)} ` : ""}<span style="font-family:${MONO};font-weight:700;color:#0b1020;letter-spacing:2px;" class="pf-strong">${esc(code)}</span></p>`;
}

function button(label: string, url: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0;"><tr><td align="center" bgcolor="#0047ab" style="border-radius:999px;background:#0047ab;background-image:linear-gradient(135deg,#0047ab 0%,#1d5bd8 60%,#4f6bff 100%);box-shadow:0 10px 24px rgba(0,71,171,0.28);">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(url)}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="50%" stroke="f" fillcolor="#0047ab"><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${esc(label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${esc(url)}" target="_blank" style="display:inline-block;padding:16px 34px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(label)}&nbsp;&rarr;</a><!--<![endif]-->
</td></tr></table>
<p class="pf-muted" style="margin:18px 0 0;text-align:center;font-family:${FONT};font-size:12px;line-height:18px;color:#8a93ad;word-break:break-all;">${esc(url)}</p>`;
}

export function renderMailHtml(locale: MailLocale, m: MailSpec) {
  const f = FOOTER[locale];
  const tone = TONES[m.tone ?? "cobalt"];
  const paras = m.paragraphs.map((p) => `<p class="pf-text" style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:26px;color:#3c4458;">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const heroImg = m.calm ? 360 : 520;
  return `<!doctype html>
<html lang="${locale}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(m.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
<style>
  body{margin:0!important;padding:0!important;width:100%!important;}
  a{color:#0047ab;}
  @media (max-width:620px){
    .pf-wrap{padding:12px 8px!important;}
    .pf-pad{padding-left:24px!important;padding-right:24px!important;}
    .pf-title{font-size:26px!important;line-height:32px!important;}
    .pf-digit{width:40px!important;height:52px!important;font-size:24px!important;line-height:52px!important;}
    .pf-hero-img{width:100%!important;height:auto!important;}
  }
  @media (prefers-color-scheme:dark){
    .pf-bg{background:#060a19!important;}
    .pf-card{background:#0f1529!important;border-color:#1f2a48!important;}
    .pf-hero{background:#121b36!important;background-image:linear-gradient(160deg,#16224a 0%,#1d1840 55%,#0f2a2a 100%)!important;}
    .pf-title,.pf-strong{color:#eef2ff!important;}
    .pf-text{color:#b3bdd6!important;}
    .pf-muted{color:#8a93ad!important;}
    .pf-digit{background:#17213f!important;border-color:#2a3760!important;color:#eef2ff!important;}
    .pf-note{background:#141d38!important;border-color:#24305a!important;color:#b3bdd6!important;}
    .pf-rule{border-color:#1f2a48!important;}
  }
  [data-ogsc] .pf-bg{background:#060a19!important;}
  [data-ogsc] .pf-card{background:#0f1529!important;}
  [data-ogsc] .pf-title{color:#eef2ff!important;}
  [data-ogsc] .pf-text{color:#b3bdd6!important;}
</style>
</head>
<body class="pf-bg" style="margin:0;padding:0;background:#eef2fb;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#eef2fb;">${esc(m.preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pf-bg" style="background:#eef2fb;">
<tr><td align="center" class="pf-wrap" style="padding:32px 16px;">
  <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pf-card" style="max-width:600px;background:#ffffff;border:1px solid #e3e9f6;border-radius:28px;overflow:hidden;box-shadow:0 24px 60px rgba(11,16,32,0.08);">
    <tr><td class="pf-hero" style="background:#eaf1ff;background-image:linear-gradient(160deg,#e6efff 0%,#f1ebff 55%,#e3f9f1 100%);padding:24px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="left" valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td bgcolor="#ffffff" style="background:#ffffff;border-radius:12px;padding:6px;line-height:0;box-shadow:0 4px 12px rgba(11,16,32,0.08);"><a href="${SITE}" target="_blank"><img src="${MAIL_ASSET_BASE}/logo.png" width="28" height="28" alt="Postfino" style="display:block;border:0;width:28px;height:28px;"></a></td>
            <td style="padding-left:10px;font-family:${DISPLAY};font-size:20px;font-weight:700;letter-spacing:-0.3px;color:#0b1020;" class="pf-strong">Postfino</td>
          </tr></table>
        </td>
        <td align="right" valign="middle"><span style="display:inline-block;padding:7px 14px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-family:${FONT};font-size:12px;line-height:14px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${esc(m.eyebrow)}</span></td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding-top:${m.calm ? 12 : 18}px;line-height:0;">
        <img class="pf-hero-img" src="${MAIL_ASSET_BASE}/mascots.png" width="${heroImg}" alt="" style="display:block;border:0;width:${heroImg}px;max-width:100%;height:auto;margin:0 auto;">
      </td></tr></table>
    </td></tr>
    <tr><td class="pf-pad" style="padding:36px 48px 8px;">
      <h1 class="pf-title" style="margin:0 0 16px;font-family:${DISPLAY};font-size:30px;line-height:36px;font-weight:700;letter-spacing:-0.6px;color:#0b1020;">${esc(m.title)}</h1>
      ${paras}
      ${m.code ? codeBlock(m.code, m.codeHint) : ""}
      ${m.button ? button(m.button.label, m.button.url) : ""}
      ${m.note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td class="pf-note" style="background:#f6f8fc;border:1px solid #e3e9f6;border-radius:16px;padding:14px 16px;font-family:${FONT};font-size:13px;line-height:20px;color:#5f677c;">&#128274;&nbsp; ${esc(m.note)}</td></tr></table>` : ""}
    </td></tr>
    <tr><td class="pf-pad" style="padding:20px 48px 36px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pf-rule" style="border-top:1px solid #e3e9f6;padding-top:22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle" style="font-family:${FONT};font-size:15px;line-height:22px;font-weight:600;color:#0b1020;" class="pf-strong">${esc(f.team)}</td>
          <td align="right" valign="middle" style="line-height:0;white-space:nowrap;">
            <img src="${MAIL_ASSET_BASE}/chat.png" width="30" height="30" alt="" style="display:inline-block;border:0;width:30px;height:30px;">
            <img src="${MAIL_ASSET_BASE}/heart.png" width="30" height="30" alt="" style="display:inline-block;border:0;width:30px;height:30px;margin-left:4px;">
            <img src="${MAIL_ASSET_BASE}/share.png" width="30" height="30" alt="" style="display:inline-block;border:0;width:30px;height:30px;margin-left:4px;">
          </td>
        </tr></table>
      </td></tr></table>
    </td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;"><tr><td align="center" style="padding:22px 24px 8px;font-family:${FONT};font-size:12px;line-height:19px;color:#8a93ad;" class="pf-muted">
    ${esc(f.why)}<br>
    <a href="${SITE}/datenschutz" style="color:#5f677c;text-decoration:underline;">${esc(f.privacy)}</a> &nbsp;·&nbsp; <a href="${SITE}/impressum" style="color:#5f677c;text-decoration:underline;">${esc(f.imprint)}</a> &nbsp;·&nbsp; <a href="mailto:info@postfino.com" style="color:#5f677c;text-decoration:underline;">${esc(f.help)}</a><br>
    ${esc(f.product)}
  </td></tr></table>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/** Plain-text alternative built from the same spec (multipart: clients without HTML, spam filters, previews). */
export function renderMailText(locale: MailLocale, m: MailSpec) {
  const f = FOOTER[locale];
  const parts = [m.title, "", ...m.paragraphs.flatMap((p) => [p, ""])];
  if (m.code) parts.push(`    ${m.code}`, "");
  if (m.button) parts.push(`${m.button.label}: ${m.button.url}`, "");
  if (m.note) parts.push(m.note, "");
  parts.push(`— ${f.team}`, f.product);
  return parts.join("\n");
}
