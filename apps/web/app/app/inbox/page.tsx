import { Icon } from "../../../components/product/icon";
import { Panel, PersonAvatar, Pill, SectionHeader, ToolbarButton } from "../../../components/product/recruiting-ui";

const threads = [
  ["Ali Rahimi", "Can you clarify the remote-work policy?", "Needs approval", "2m", 0],
  ["Reza Akbari", "Thanks — what are the next interview steps?", "New reply", "18m", 2],
  ["Sara Mohammadi", "No response after follow-up 2", "Sequence", "4h", 1],
  ["Mohsen Karimi", "Available next Tuesday afternoon.", "Scheduling", "Yesterday", 3],
] as const;

export default function InboxPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="mb-2 text-[10px] font-medium text-indigo-600">Candidate engagement</div><h1 className="text-[26px] font-semibold tracking-tight">Inbox / Outreach</h1><p className="mt-1 text-[12px] text-slate-500">Candidate conversations, approval queues and knowledge-grounded AI drafting.</p></div>
        <div className="flex gap-2"><ToolbarButton icon="filter">Rules</ToolbarButton><ToolbarButton primary icon="message">New outreach</ToolbarButton></div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[.82fr_1.18fr]">
        <Panel>
          <SectionHeader title="Conversations" action={<Pill tone="violet">8 unread</Pill>} />
          <div className="space-y-1 p-3 pt-4">
            {threads.map(([name, preview, state, time, tone], index) => (
              <button key={name} className={`flex w-full items-start gap-3 rounded-[11px] p-3 text-left transition ${index === 0 ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                <PersonAvatar name={name} size={34} tone={tone} />
                <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold text-slate-900">{name}</span><span className="text-[9px] text-slate-400">{time}</span></span><span className="mt-1 block truncate text-[10px] text-slate-500">{preview}</span><span className="mt-2 block"><Pill tone={state === "Needs approval" ? "amber" : state === "New reply" ? "green" : "blue"}>{state}</Pill></span></span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between border-b border-slate-100 p-5"><div className="flex items-center gap-3"><PersonAvatar name="Ali Rahimi" size={36} /><div><div className="text-[12px] font-semibold">Ali Rahimi</div><div className="mt-0.5 text-[9px] text-slate-400">Senior Backend Engineer · Email</div></div></div><ToolbarButton icon="more">Actions</ToolbarButton></div>
          <div className="space-y-4 p-5">
            <div className="max-w-[78%] rounded-[12px] rounded-bl-[4px] bg-slate-100 p-4 text-[11px] leading-5 text-slate-700">Can you clarify whether the team is fully remote or if there are office days in Tehran?</div>
            <div className="ms-auto max-w-[86%] rounded-[12px] rounded-br-[4px] border border-indigo-100 bg-indigo-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold text-indigo-700"><Icon name="sparkles" size={13} /> AI draft · not sent</div>
              <p className="text-[11px] leading-5 text-slate-700">The role follows the approved hybrid policy: remote work is supported, with team office days defined by the hiring team.</p>
              <div className="mt-3 rounded-[9px] border border-indigo-100 bg-white/70 p-3 text-[9px] text-slate-500"><strong className="text-slate-700">Grounding:</strong> Remote & Hybrid Policy v4 · Senior Backend Engineer job policy</div>
              <div className="mt-4 flex flex-wrap gap-2"><button className="rounded-[9px] bg-indigo-600 px-3 py-2 text-[10px] font-semibold text-white">Approve & send</button><button className="rounded-[9px] border border-slate-200 bg-white px-3 py-2 text-[10px] font-semibold text-slate-600">Edit draft</button><button className="rounded-[9px] px-3 py-2 text-[10px] font-semibold text-slate-500">Reject draft</button></div>
            </div>
          </div>
          <div className="border-t border-slate-100 p-4"><div className="flex items-center gap-2 rounded-[11px] border border-slate-200 bg-slate-50 px-3 py-2"><input className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" placeholder="Reply to candidate..." /><button className="grid h-8 w-8 place-items-center rounded-[9px] bg-indigo-600 text-white"><Icon name="arrow" size={14} /></button></div><div className="mt-2 text-[9px] text-slate-400">Candidate-facing facts must remain grounded in approved knowledge. Auto-send requires explicit organization policy.</div></div>
        </Panel>
      </div>
    </div>
  );
}
