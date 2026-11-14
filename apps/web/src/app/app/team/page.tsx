import { UsersRound } from "lucide-react";
import { listMembers, authorize, getEntitlements, ROLE_RANK } from "@sichttakt/core";
import { ROLES } from "@sichttakt/shared";
import { PageHeader, Empty } from "@/components/ui";
import { SecretForm } from "@/components/secret-forms";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import { inviteMemberAction, changeRoleAction, removeMemberAction } from "../actions";

export const metadata = { title: "Team" };

const GRANTABLE = ROLES.filter((r) => r !== "SUPER_ADMIN");

export default async function TeamPage() {
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  authorize(ctx.actor, null, "members.manage");
  const [members, ent] = await Promise.all([listMembers(ctx.svc.db, ctx.actor), getEntitlements(ctx.svc.db, ctx.organization.id)]);
  const myRank = ctx.actor.kind === "user" && ctx.actor.isSuperAdmin ? 100 : ctx.actor.kind === "user" && ctx.actor.orgRole ? ROLE_RANK[ctx.actor.orgRole] : 0;
  const grantable = GRANTABLE.filter((r) => ROLE_RANK[r] <= myRank);
  const wsName = new Map(ctx.workspaces.map((w) => [w.id, w.name]));
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" });

  return (
    <>
      <PageHeader title={t.team.title} subtitle={t.team.subtitle} actions={<span className="chip bg-surface-2 text-ink-2">{members.length} / {ent.limits.users ?? "∞"}</span>} />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <section className="card overflow-x-auto">
          {members.length === 0 ? (
            <div className="p-6">
              <Empty icon={UsersRound} title={t.common.none} />
            </div>
          ) : (
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line bg-surface-2/60 text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-5 py-3">{t.auth.name}</th>
                  <th className="px-5 py-3">{t.team.role}</th>
                  <th className="px-5 py-3">{t.team.scope}</th>
                  <th className="px-5 py-3">
                    <span className="sr-only">{t.common.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.map((m) => {
                  const manageable = ROLE_RANK[m.role] <= myRank;
                  return (
                    <tr key={m.id}>
                      <td className="px-5 py-3">
                        <p className="font-semibold">{m.name ?? m.email}</p>
                        <p className="text-xs text-ink-3">
                          {m.email}
                          {m.pending && <span className={`chip ml-2 ${m.expired ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>{m.expired ? t.team.expired : `${t.team.pending} · ${m.invitedAt ? df.format(m.invitedAt) : ""}`}</span>}
                          {m.twoFactor && <span className="chip ml-2 bg-ok-soft text-ok">2FA</span>}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        {manageable ? (
                          <form action={changeRoleAction} className="flex gap-1.5">
                            <input type="hidden" name="membershipId" value={m.id} />
                            <select name="role" defaultValue={m.role} className="input !min-h-[36px] !py-1 text-xs" aria-label={t.team.role}>
                              {grantable.map((r) => (
                                <option key={r}>{r}</option>
                              ))}
                            </select>
                            <button className="btn btn-ghost !min-h-[36px] !px-2.5 text-xs">{t.common.save}</button>
                          </form>
                        ) : (
                          <span className="font-mono text-xs">{m.role}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-ink-2">{m.workspaceId ? wsName.get(m.workspaceId) : t.team.allWorkspaces}</td>
                      <td className="px-5 py-3 text-right">
                        {manageable && (
                          <form action={removeMemberAction}>
                            <input type="hidden" name="membershipId" value={m.id} />
                            <button className="btn btn-danger !min-h-[34px] text-xs">{t.team.remove}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <section className="card h-fit p-6">
          <h2 className="mb-4 text-lg font-bold">{t.team.invite}</h2>
          <SecretForm action={inviteMemberAction} submit={t.team.invite} secretNote={t.team.notDelivered} className="space-y-4" submitClassName="btn btn-primary">
            <div>
              <label className="label" htmlFor="iemail">
                {t.auth.email}
              </label>
              <input id="iemail" name="email" type="email" required className="input" autoComplete="off" />
            </div>
            <div>
              <label className="label" htmlFor="irole">
                {t.team.role}
              </label>
              <select id="irole" name="role" defaultValue="EDITOR" className="input">
                {grantable.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="iscope">
                {t.team.scope}
              </label>
              <select id="iscope" name="workspaceId" className="input">
                <option value="">{t.team.allWorkspaces}</option>
                {ctx.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-ink-3">AGENCY_OWNER/ADMIN: {t.team.allWorkspaces} · CLIENT_REVIEWER: eine Marke</p>
            </div>
          </SecretForm>
          {!ctx.svc.mailer.configured && <p className="mt-4 text-xs text-warn">SMTP: {t.common.notConfigured}</p>}
        </section>
      </div>
    </>
  );
}
