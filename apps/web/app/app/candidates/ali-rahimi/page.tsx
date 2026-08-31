import Link from "next/link";
import { Icon } from "../../../../components/product/icon";
import {
  DemoNotice,
  Panel,
  PersonAvatar,
  Pill,
  ProgressRing,
  ScoreBar,
  SectionHeader,
  SkillChip,
  ToolbarButton,
} from "../../../../components/product/recruiting-ui";

const tabs = [
  ["Overview", "/app/candidates/ali-rahimi"],
  ["Experience", "#experience"],
  ["Skills", "#skills"],
  ["Job Matches", "#job-matches"],
  ["Screening", "#screening"],
  ["Interviews", "/app/interviews/ali-rahimi"],
  ["Assessments", "/app/candidates/ali-rahimi/assessments"],
  ["Communications", "#communications"],
  ["Notes", "#notes"],
  ["Activity", "#activity"],
] as const;

export default function CandidateDetail() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <PersonAvatar name="Ali Rahimi" size={48} />
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-[23px] font-semibold tracking-tight">Ali Rahimi</h1><Pill tone="green">91% pre-interview match</Pill><DemoNotice /></div>
            <div className="mt-1 text-[11px] text-slate-500">Senior Backend Engineer @ Digikala · Tehran, Iran</div>
            <div className="mt-2 flex flex-wrap gap-3 text-[9px] text-slate-400"><span>LinkedIn identity · unverified</span><span>ali.rahimi@email.com</span><span>+98 912 345 6789</span></div>
          </div>
        </div>
        <div className="flex gap-2">
          <ToolbarButton disabled title="Candidate note persistence is not wired to this development page yet">Add Note</ToolbarButton>
          <ToolbarButton href="/app/jobs/senior-backend-engineer/candidates">Add to Job</ToolbarButton>
          <ToolbarButton icon="more" disabled title="Additional candidate actions are not wired yet">More</ToolbarButton>
        </div>
      </div>

      <nav className="flex gap-6 overflow-x-auto border-b border-slate-200 text-[11px]">
        {tabs.map(([label, href]) => (
          <Link key={label} href={href} className={`whitespace-nowrap pb-3 font-medium ${label === "Overview" ? "border-b-2 border-indigo-600 text-indigo-600" : "text-slate-500 hover:text-slate-800"}`}>{label}</Link>
        ))}
      </nav>

      <div className="grid gap-3 xl:grid-cols-[.8fr_1.1fr_.9fr]">
        <Panel>
          <SectionHeader title="Match summary" subtitle="Pre-interview match · retrieval/domain signals, not a hiring score" />
          <div className="flex flex-col items-center p-5 pt-3">
            <ProgressRing value={91} label="Job match" tone="#10b981" />
            <p className="mt-4 text-center text-[10px] leading-5 text-slate-500">Strong role/skills relevance from resume and sourcing evidence. Interview and assessment evidence remain separate.</p>
            <div className="mt-4 flex w-full justify-between text-[9px]"><span className="text-slate-400">Evidence state</span><Pill tone="blue">Resume + source</Pill></div>
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Evidence-backed strengths" />
          <div className="grid gap-2 p-5 pt-3 text-[10px]">
            {["Strong .NET and C# delivery history", "Microservices architecture experience", "Kubernetes and containerization evidence", "Production problem-solving examples"].map((item) => (
              <div key={item} className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Icon name="check" size={10} /></span>{item}</div>
            ))}
          </div>
          <div className="border-t border-slate-100 p-5"><div className="text-[11px] font-semibold">Evidence gaps / risks</div><div className="mt-3 flex items-center gap-2 text-[10px] text-slate-600"><span className="grid h-5 w-5 place-items-center rounded-full bg-amber-50 text-amber-700">!</span>People-management depth remains unverified</div></div>
        </Panel>

        <Panel>
          <SectionHeader title="AI recommendation" subtitle="Decision support · recruiter approval required" />
          <div className="p-5 pt-3">
            <div className="text-[9px] text-slate-400">Recommended next step</div>
            <div className="mt-2 text-[17px] font-semibold">Proceed to Technical Interview</div>
            <div className="mt-4 flex items-center justify-between"><span className="text-[9px] text-slate-400">Evidence confidence</span><Pill tone="green">High</Pill></div>
            <p className="mt-4 text-[10px] leading-5 text-slate-500">Validate production debugging, system design and leadership evidence before any final recommendation.</p>
            <Link href="/app/interviews/ali-rahimi" className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-[10px] border border-indigo-200 text-[10px] font-semibold text-indigo-600 transition hover:bg-indigo-50">Review interview evidence</Link>
          </div>
        </Panel>
      </div>

      <div id="experience" className="sr-only" aria-hidden="true">Experience anchor</div>
      <div id="skills" className="grid gap-3 xl:grid-cols-[1.2fr_.8fr]">
        <Panel>
          <SectionHeader title="Skills intelligence" subtitle="Verified/unverified state remains visible instead of silently inferring expertise." />
          <div className="grid gap-5 p-5 pt-3 md:grid-cols-2">
            <div><div className="mb-3 text-[9px] font-semibold text-slate-400">Verified / evidenced</div><div className="flex flex-wrap gap-2">{[".NET", "C#", "SQL", "Kubernetes", "Azure"].map((item) => <SkillChip key={item} verified>{item}</SkillChip>)}</div></div>
            <div><div className="mb-3 text-[9px] font-semibold text-slate-400">Needs validation</div><div className="flex flex-wrap gap-2">{["Redis", "Leadership", "System Design"].map((item) => <SkillChip key={item}>{item}</SkillChip>)}</div></div>
          </div>
          <div className="space-y-2 border-t border-slate-100 p-5"><ScoreBar label="Backend engineering" value={94} /><ScoreBar label="Cloud / DevOps" value={86} tone="indigo" /><ScoreBar label="System design" value={89} /></div>
        </Panel>

        <div id="activity">
          <Panel>
            <SectionHeader title="Recent activity" />
            <div className="space-y-4 p-5 pt-3">
              {[["AI interview completed", "Today, 10:30 AM"], ["Technical assessment completed", "Yesterday"], ["Screening completed", "2 days ago"], ["Replied to outreach email", "3 days ago"], ["Added to pipeline", "5 days ago"]].map(([item, time], index) => (
                <div key={item} className="flex gap-3"><div className="grid h-7 w-7 place-items-center rounded-full bg-indigo-50 text-indigo-600"><Icon name={index === 0 ? "interviews" : index === 1 ? "target" : index === 2 ? "check" : "message"} size={12} /></div><div><div className="text-[10px] font-medium">{item}</div><div className="mt-0.5 text-[9px] text-slate-400">{time}</div></div></div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div id="screening" className="grid gap-3 xl:grid-cols-3">
        <Panel><SectionHeader title="Screening" /><div className="space-y-2 p-5 pt-3 text-[10px]"><div className="flex justify-between"><span>Work authorization</span><Pill tone="green">Pass</Pill></div><div className="flex justify-between"><span>Relevant experience</span><Pill tone="green">Pass</Pill></div><div className="flex justify-between"><span>Human review</span><Pill tone="blue">Completed</Pill></div></div></Panel>
        <div id="job-matches"><Panel><SectionHeader title="Job matches" /><div className="p-5 pt-3"><div className="text-[12px] font-semibold">Senior Backend Engineer</div><div className="mt-1 text-[10px] text-slate-500">Active application · Interview stage</div><div className="mt-3"><Pill tone="green">91% pre-interview match</Pill></div></div></Panel></div>
        <Panel><SectionHeader title="Assessment evidence" /><div className="p-5 pt-3"><div className="text-[12px] font-semibold">Backend production exercise</div><div className="mt-1 text-[10px] text-slate-500">29 / 32 tests · isolated runner</div><Link href="/app/candidates/ali-rahimi/assessments" className="mt-3 inline-block text-[10px] font-semibold text-indigo-600">Open assessment evidence →</Link></div></Panel>
      </div>

      <div id="communications" className="sr-only" aria-hidden="true">Communications anchor</div>
      <div id="notes" className="sr-only" aria-hidden="true">Notes anchor</div>
    </div>
  );
}
