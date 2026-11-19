import { describe, it, expect } from "vitest";
import { mailTemplates } from "@sichttakt/core";

describe("transactional mail templates", () => {
  it("every template has subject, plain text and branded HTML in all languages", () => {
    for (const l of ["de", "en", "tr"]) {
      const mails = [
        mailTemplates.signupCode(l, "482916"),
        mailTemplates.loginCode(l, "730154", "Google"),
        mailTemplates.reset(l, "https://www.postfino.com/reset/t"),
        mailTemplates.verify(l, "https://www.postfino.com/verify/t"),
        mailTemplates.invite(l, "Studio Nord", "https://www.postfino.com/invite/t"),
        mailTemplates.approvalPending(l, "Neuer Beitrag", "https://www.postfino.com/app/posts/1"),
        mailTemplates.accountDeleted(l),
      ];
      for (const m of mails) {
        expect(m.subject.length).toBeGreaterThan(3);
        expect(m.text.length).toBeGreaterThan(20);
        expect(m.html).toContain("<!doctype html>");
        expect(m.html).toContain(`lang="${l}"`);
        expect(m.html).toContain("/email/mascots.png");
      }
    }
  });

  it("codes and links appear in both parts; user input is escaped", () => {
    const code = mailTemplates.signupCode("de", "482916");
    expect(/\b(\d{6})\b/.exec(code.text)?.[1]).toBe("482916");
    expect(code.html).toContain("482916");
    const inv = mailTemplates.invite("de", `<script>alert("x")</script>`, "https://www.postfino.com/invite/t?a=1&b=2");
    expect(inv.html).not.toContain("<script>alert");
    expect(inv.html).toContain("&lt;script&gt;");
    expect(inv.html).toContain("https://www.postfino.com/invite/t?a=1&amp;b=2");
    expect(inv.text).toContain("https://www.postfino.com/invite/t?a=1&b=2");
  });
});
