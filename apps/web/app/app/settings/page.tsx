import { DemoNotice, Panel, Pill, SectionHeader } from "../../../components/product/recruiting-ui";

const retention = [
  ["Candidate profile", "730 days", "Enabled"],
  ["Interview recordings", "180 days", "Enabled"],
  ["Transcripts / evidence", "365 days", "Enabled"],
  ["Audit events", "1095 days", "Enabled"],
] as const;

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-.03em] text-slate-950">Organization settings</h1>
          <p className="mt-1 text-[11px] text-slate-500">Access, privacy, retention, AI policy and interview release governance.</p>
        </div>
        <DemoNotice />
      </div>

      <div className="grid gap-3 xl:grid-cols-[.85fr_1.15fr]">
        <Panel>
          <SectionHeader title="Access & roles" subtitle="Internal users share one application; permissions determine available actions." />
          <div className="space-y-3 p-5 pt-4 text-[11px]">
            {[
              ["Recruiter", "Jobs, sourcing, outreach, screening, pipeline"],
              ["HR Manager", "Policy, approvals, oversight, reporting"],
              ["Hiring Manager", "Requirements, shortlist, final feedback"],
              ["Interviewer", "Assigned interviews, evidence and scorecards"],
              ["Organization Admin", "Members, roles, integrations and privacy"],
            ].map(([role, scope]) => (
              <div key={role} className="flex items-start justify-between gap-4 rounded-[10px] border border-slate-100 p-3">
                <div><div className="font-semibold text-slate-800">{role}</div><div className="mt-1 text-[10px] leading-5 text-slate-500">{scope}</div></div>
                <Pill tone="slate">RBAC</Pill>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="AI decision policy" subtitle="High-impact output is reviewable, evidence-linked and overridable." />
          <div className="grid gap-3 p-5 pt-4 md:grid-cols-2">
            {[
              ["Evidence before score", "Required", "green"],
              ["Deterministic final weighting", "Required", "green"],
              ["Generative silent rejection", "Blocked", "red"],
              ["Face / emotion suitability inference", "Blocked", "red"],
              ["Human override history", "Required", "green"],
              ["AI execution provenance", "Required", "green"],
            ].map(([label, state, tone]) => (
              <div key={label} className="rounded-[10px] border border-slate-100 p-3">
                <div className="text-[10px] font-medium text-slate-500">{label}</div>
                <div className="mt-2"><Pill tone={tone as "green" | "red"}>{state}</Pill></div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader title="Retention policies" subtitle="Development fixture values; actual policies persist through the privacy API and support legal-hold rules." />
        <div className="overflow-x-auto p-5 pt-4">
          <table className="w-full min-w-[640px] text-left text-[11px]">
            <thead className="border-b border-slate-100 text-[10px] uppercase tracking-[.05em] text-slate-400">
              <tr><th className="pb-3">Data class</th><th className="pb-3">Retention</th><th className="pb-3">Status</th><th className="pb-3">Deletion behavior</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {retention.map(([entity, days, status]) => (
                <tr key={entity}><td className="py-3.5 font-semibold text-slate-800">{entity}</td><td className="py-3.5 text-slate-600">{days}</td><td className="py-3.5"><Pill tone="green">{status}</Pill></td><td className="py-3.5 text-slate-500">Review legal hold → execute deletion → audit</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel>
          <SectionHeader title="Autonomous interview release" subtitle="Approval is scoped to a release unit, never to the AI interviewer globally." />
          <div className="p-5 pt-4">
            <div className="flex items-center justify-between rounded-[10px] border border-amber-100 bg-amber-50/50 p-4">
              <div><div className="text-[11px] font-semibold text-slate-900">Backend / Persian / Technical Screen</div><div className="mt-1 text-[10px] text-slate-500">interviewer-policy-v1 · evaluator-v1 · speech/avatar dev stack</div></div>
              <Pill tone="amber">DEV_ONLY</Pill>
            </div>
            <p className="mt-3 text-[10px] leading-5 text-slate-500">Real-candidate autonomous interviews remain blocked until production-readiness calibration, reliability, privacy and approval gates pass.</p>
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Candidate privacy requests" subtitle="Deletion and consent requests enter review; approval does not silently destroy data." />
          <div className="space-y-3 p-5 pt-4">
            {["Access request → pending review", "Deletion request → approved pending execution", "Consent withdrawal → evidence-preserving policy review"].map((item, index) => (
              <div key={item} className="flex items-center gap-3 text-[11px] text-slate-700"><span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-50 text-[10px] font-semibold text-indigo-600">{index + 1}</span>{item}</div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
