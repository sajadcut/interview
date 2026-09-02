# پلتفرم جذب نیروی مبتنی بر هوش مصنوعی — سند مستر فارسی

> **وضعیت:** خط مبنای معماری برای پیاده‌سازی تأیید شده است  
> **نسخه:** 0.5.0  
> **تاریخ:** 2026-08-31  
> **هدف:** مرجع واحد و اصلی برای مرزهای محصول، معماری مهندسی، اصول UX، رفتار هوش مصنوعی، امنیت، مدل داده، معماری مصاحبه، محیط توسعه و ترتیب تحویل.
>
> این فایل ترجمه فارسی `master.md` است. در صورت اختلاف ناخواسته در واژه‌گذاری، شناسه‌ها یا جزئیات فنی، `master.md` مرجع معماری اصلی محسوب می‌شود.

---

# 0. نحوه استفاده از این سند

- `master.md` معماری پایدار محصول و فنی را تعریف می‌کند.
- `masterfa.md` ترجمه فارسی همین معماری است.
- `projectstate.md` وضعیت واقعی پیاده‌سازی، تیکت‌ها، ریسک‌ها و اعتبارسنجی‌های باقی‌مانده را تعریف می‌کند.
- `production-readiness.md` گیت‌های لازم برای اجرای ایمن مصاحبه خودکار با کاندیدای واقعی را تعریف می‌کند.
- `docs/visual-product-target.md` هدف بصری تأییدشده برای پذیرش محصول داخلی را تعریف می‌کند.
- `docs/architecture-decisions/*` تغییرات و تاریخچه تصمیم‌های معماری را ثبت می‌کند.
- `AGENTS.md` محدودیت‌های پیاده‌سازی برای انسان‌ها و عامل‌های کدنویسی را تعریف می‌کند.

هر تغییر مهم معماری باید در این سند و در `projectstate.md` بازتاب داده شود.

---

# 1. تعریف محصول

## 1.1 ستاره شمالی

ساخت یک AI Recruiter که بتواند بخش بزرگی از چرخه جذب را اجرا کند:

```text
تعریف موقعیت شغلی
→ کشف کاندیدا
→ رتبه‌بندی کاندیدا
→ ارتباط اولیه
→ غربالگری
→ زمان‌بندی
→ مصاحبه هوش مصنوعی
→ ارزیابی فنی / نقش
→ امتیازدهی مبتنی بر شواهد
→ مقایسه کاندیداها
→ فهرست نهایی
→ تصمیم انسانی
→ Talent Pool
```

محصول فقط یک ATS و فقط یک ابزار مصاحبه ویدیویی نیست. مزیت متمایزکننده، یک عامل جذب هوشمند است که می‌تواند جریان کار را تا رسیدن به یک shortlist قابل دفاع پیش ببرد، در حالی که بازبینی انسانی برای تصمیم‌های مهم استخدامی حفظ می‌شود.

## 1.2 خروجی‌های اصلی

1. کاهش کار دستی Recruiter.
2. پیدا کردن سریع‌تر کاندیداهای مرتبط.
3. استفاده مجدد از کاندیداهای داخلی و قبلی.
4. یکدست و متناسب‌سازی غربالگری و مصاحبه با هر شغل.
5. اعتبارسنجی مهارت‌های ادعاشده با استفاده از رزومه، مصاحبه و ارزیابی.
6. تولید ارزیابی‌های قابل ردیابی از کاندیدا.
7. کاهش زمان استخدام.
8. حفظ امکان بازبینی انسانی برای تصمیم‌های استخدامی مهم.
9. پشتیبانی از فارسی و انگلیسی.
10. پشتیبانی از مجوزهای سازمانی، audit، حریم خصوصی، retention و integrationها.

---

# 2. اصول غیرقابل مذاکره محصول

## 2.1 شغل‌محور، کاندیدای سراسری در سطح سازمان

یک `Job` نیازمندی‌ها، rubric، pipeline، استراتژی sourcing، قوانین screening و interview plan را تعریف می‌کند.

یک `Candidate` در سطح سازمان تعریف می‌شود و می‌تواند از طریق `Application` در چندین شغل مشارکت داشته باشد.

```text
Organization
 ├─ Jobs
 │   └─ Applications ── Candidate
 └─ Talent Pool ─────── Candidate
```

صرفاً به دلیل بررسی یک فرد برای شغلی دیگر، کاندیدای تکراری ایجاد نکنید.

## 2.2 هوش مصنوعی منبع حقیقت نیست

AI می‌تواند استخراج کند، پیشنهاد بدهد، رتبه‌بندی کند، پیش‌نویس تولید کند، خلاصه کند، معیارها را امتیازدهی کند، اقدام بعدی پیشنهاد دهد، سؤال follow-up بسازد و شواهد را بازیابی کند.

خروجی‌های AI با اثر بالا باید provenance را ذخیره کنند:

```text
provider/model
prompt/version
input references
structured output
confidence when meaningful
evidence references
created_at
review state
override/reviewer when applicable
```

## 2.3 شواهد قبل از امتیاز

```text
Observation / answer / resume claim / assessment result
→ Evidence
→ Criterion evaluation
→ Weighted score
→ Recommendation
```

امتیاز مهمی که بدون شواهد تولید شده باشد، ناقص است.

## 2.4 امتیاز نهایی قطعی و deterministic

LLMها می‌توانند ارزیابی در سطح criterion پیشنهاد دهند. امتیازهای وزن‌دار نهایی توسط کد دامنه و بر اساس rubric نسخه‌دار محاسبه می‌شوند. LLM درصد نهایی fit را از خودش تولید نمی‌کند.

## 2.5 Human-in-the-loop به‌صورت پیش‌فرض

- AI می‌تواند رد کردن کاندیدا را پیشنهاد دهد، اما قضاوت مولد به‌تنهایی نباید بدون اطلاع باعث رد شدن کاندیدا شود.
- فیلترهای سخت eligibility فقط زمانی می‌توانند خودکار شوند که صریحاً پیکربندی شده و قابل audit باشند.
- پیشنهادهای AI باید قابل بازبینی و override باشند.
- override امتیاز باید actor، دلیل، مقدار قبلی، مقدار جدید و timestamp را ثبت کند.
- تصمیم نهایی استخدام در کنترل انسان باقی می‌ماند.

## 2.6 عدم استنتاج روان‌شناختی یا بیومتریک بدون پشتوانه

از ظاهر چهره، نگاه، حرکت بدن، لهجه یا سایر سیگنال‌های ضعیف و غیرقابل دفاع، شخصیت، صداقت، وضعیت احساسی، ویژگی‌های ذهنی، اعتمادبه‌نفس یا تناسب شغلی استنتاج نکنید.

ویدیو برای تجربه مصاحبه، ضبط/بازپخش، شواهد timestampدار و در صورت مجاز بودن برای یکپارچگی session استفاده می‌شود؛ نه برای personality scoring شبه‌علمی.

## 2.7 تجربه کاندیدا یک سطح درجه‌یک محصول است

جریان‌های کاندیدا باید consent شفاف، اعلام ضبط، device check، accessibility، مراحل بعدی قابل فهم، پشتیبانی چندزبانه، بازیابی از خطا و اطلاعات حریم خصوصی داشته باشند.

## 2.8 اتوماسیون مصاحبه مرز انتشار دارد

صرفاً کار کردن یک realtime demo به این معنا نیست که یک حالت مصاحبه برای production ایمن است.

مصاحبه خودکار فقط زمانی فعال می‌شود که ترکیب مربوط به job family، زبان، rubric، نوع مصاحبه، interviewer policy، evaluator version و speech/avatar stack از `production-readiness.md` عبور کرده باشد.

هر حالت مصاحبه خودکار نیاز دارد به:

- interview plan و rubric نسخه‌دار؛
- رفتارهای مجاز و ممنوع صریح؛
- خروجی ساخت‌یافته برای هر turn؛
- evaluator مستقل؛
- امتیازدهی معیارها متصل به شواهد؛
- checkpointهای قابل بازیابی؛
- escalation برای low-confidence؛
- replay/review؛
- calibration در برابر ارزیاب‌های انسانی واجد صلاحیت؛
- SLOهای قابل اندازه‌گیری.

## 2.9 عدم وابستگی اجباری به Media SaaS به‌ازای هر مصاحبه

مسیر اصلی مصاحبه باید یک پیاده‌سازی self-hosted و تجاری‌قابل‌استفاده برای موارد زیر حفظ کند:

- WebRTC/media transport؛
- TURN/STUN؛
- VAD؛
- STT؛
- TTS؛
- رندر realtime دیجیتال‌هیومن/avatar؛
- recording/storage.

هزینه متغیر هدف برای vendorها:

```text
LLM API            در ابتدا مجاز / مورد انتظار
STT API            الزامی نیست
TTS API            الزامی نیست
Avatar API         الزامی نیست
RTC/media SaaS     الزامی نیست
```

Media به‌صورت self-hosted همچنان هزینه CPU/GPU، پهنای باند، storage، hosting، برق، TURN و عملیات دارد.

## 2.10 Interview Brain و Digital Human از هم جدا هستند

```text
Job + Resume + Rubric
        ↓
Interview Planner
        ↓
Dialogue Engine / Interview Brain
        ↓
spoken_text
        ↓
TTSProvider
        ↓
AvatarProvider
        ↓
Candidate
```

Interview Brain مالک state، استراتژی سؤال، follow-upها، پوشش شواهد، زمان‌بندی و policy است. Avatar فقط گفتار تأییدشده را ارائه می‌کند.

AI Interviewer و AI Evaluator از نظر منطقی جدا هستند. Interviewer مکالمه را بهینه می‌کند. Evaluator شواهد persistشده را در برابر rubric امتیازدهی می‌کند.

---

# 3. نقش‌های انسانی و سطح‌های محصول

| نقش | مسئولیت اصلی |
|---|---|
| Recruiter | Jobs، sourcing، outreach، screening، pipeline، بازبینی کاندیدا |
| HR Manager | Policy، تأییدها، نظارت، reporting |
| Hiring Manager | Requirements، shortlist، comparison، بازخورد نهایی |
| Interviewer | مصاحبه‌های تخصیص‌یافته، scorecardها، بازبینی شواهد |
| Organization Admin | اعضا، نقش‌ها، integrationها، privacy/settings |
| Candidate | Screening، scheduling، interview، assessment، consent |

اقدامات AI به‌صورت machine actorهای صریح در audit log نمایش داده می‌شوند.

## 3.1 اپلیکیشن داخلی شرکت

Recruiter، HR Manager، Hiring Manager، Interviewer و Admin از یک اپلیکیشن داخلی مشترک استفاده می‌کنند. navigation و actionهای در دسترس بر اساس role و permission تعیین می‌شوند.

```text
Internal App
├─ Home / Command Center
├─ Jobs
├─ Candidates
├─ Talent
├─ Interviews
├─ Inbox / Outreach
├─ Analytics
├─ Automations
├─ Integrations
└─ Settings
```

## 3.2 تجربه کاندیدا

جریان‌های candidate-facing یک سطح امنیتی و UX جدا هستند.

```text
Secure invitation / magic link / OTP
→ identity verification when required
→ consent
→ device check
→ screening / interview / assessment
→ completion
```

کاربران Candidate وارد اپلیکیشن داخلی HR نمی‌شوند.

## 3.3 AI Interviewer

AI Interviewer یک system actor است و login ندارد. این actor از طریق interview policy نسخه‌دار و provider abstractionها عمل می‌کند.

---

# 4. Workspaceهای محصول

## 4.1 Job Workspace

```text
Job
├─ Overview
├─ Candidates
├─ Sourcing
├─ Outreach
├─ Pipeline
├─ Interviews
├─ Scorecards
├─ Analytics
├─ Activity
└─ Settings
```

Sourcing باید در context خود Job قرار بگیرد و باعث انفجار top-level navigation نشود.

## 4.2 Candidate Intelligence Workspace

```text
Candidate
├─ Overview
├─ Experience
├─ Skills
├─ Job Matches
├─ Screening
├─ Interviews
├─ Assessments
├─ Communications
├─ Notes
└─ Activity
```

پروفایل کاندیدا یک intelligence workspace است، نه صرفاً نمایش‌دهنده CV.

## 4.3 زیرسیستم مصاحبه

سمت Candidate:

```text
Invite
→ Consent
→ Device Check
→ Introduction
→ AI Interview
→ Technical task when applicable
→ Completion
→ Feedback
```

سمت internal review:

```text
Interview Plan
Rubric
Question Strategy
Session
Transcript
Evidence
Scorecard
Key Moments
Decision Support
```

---

# 5. معماری فنی

## 5.1 سبک معماری

کار را با modular monolith به‌علاوه workerهای تخصصی شروع کنید.

```text
apps/web                Next.js / React / TypeScript
apps/api                NestJS modular monolith
services/ai-worker      AI/evaluation workloads when needed
services/media-worker   realtime speech/avatar/media workloads when needed
packages/*              shared UI/types/validation/config/db/api-client
```

از ابتدا سراغ microservice نروید.

## 5.2 محیط توسعه — LOCAL NATIVE BASELINE

توسعه فعلی laptop-first و local-native است. Docker برای توسعه روزمره الزامی نیست.

```text
Laptop
└─ VS Code
   ├─ Node.js 25.9.x
   ├─ npm 11.6.x
   ├─ Git
   ├─ PostgreSQL installed locally
   ├─ Python installed locally when AI/media work begins
   ├─ Redis installed locally only when a feature actually requires it
   ├─ pgvector installed when candidate semantic matching begins
   └─ project processes started directly from terminals/tasks
```

دستورهای development باید بدون Docker Desktop، Docker Compose، Kubernetes یا MinIO کار کنند.

### اصول توسعه محلی

1. نصب مستقیم ابزارهای موردنیاز developer روی laptop ترجیح داده شود.
2. در مرحله فعلی صرفاً برای راحتی Docker اضافه نشود.
3. local service فقط زمانی اضافه شود که milestone جاری واقعاً به آن نیاز دارد.
4. interfaceهای سرویس مستقل از deployment نگه داشته شوند.
5. سادگی توسعه نباید فرض‌های مخصوص laptop را وارد domain code کند.

### چیدمان موردنظر processهای محلی

```text
VS Code
├─ Terminal: npm run dev:web      → Next.js
├─ Terminal: npm run dev:api      → TypeScript watch + Node/Nest runtime
├─ PostgreSQL local service
├─ Redis local service            → only when needed
├─ Python ai-worker               → when needed
└─ Python media-worker            → when interview work begins
```

VS Code ترجیح داده می‌شود، اما repository باید terminal-first باقی بماند و به رفتار اختصاصی یک editor proprietary وابسته نباشد.

## 5.3 Package manager و monorepo

قرارداد فعال monorepo جاوااسکریپت:

```text
Node.js          >=25.9.0 <26
npm              >=11.6.2 <12
npm workspaces   root package.json
Turborepo        task orchestration
package-lock.json canonical lockfile
```

با npm 11.6.x از dependency protocol نوع `workspace:*` استفاده نکنید. workspaceهای داخلی از rangeهای semver استاندارد که با نسخه local workspace تطابق دارند استفاده می‌کنند.

`pnpm-workspace.yaml` و `pnpm-lock.yaml` بخشی از معماری فعال نیستند.

## 5.4 npm registry و reproducibility وابستگی‌ها

dependency resolution از public npm registry استفاده می‌کند:

```text
https://registry.npmjs.org/
```

`.npmrc` ریشه repository، HTTPS، strict engine checks و retry/timeout محدود را enforce می‌کند. `package-lock.json` گراف canonical وابستگی‌هاست و باید commit شود. CI با lockfile commitشده `npm ci` اجرا می‌کند؛ در quality gate نباید lockfile را حذف یا دوباره تولید کند. تغییر dependency نیازمند update صریح lockfile و سپس اجرای quality gate کامل است.

Scarf installation analytics در root package غیرفعال است.

## 5.5 NestJS 12 روی Node 25

NestJS 12 همچنان framework اپلیکیشن backend است.

workstation فعال Node 25 به Nest CLI/schematics وابسته نیست، چون خط فعلی Angular-devkit آن‌ها Node 25 را exclude می‌کند. این یک محدودیت tooling است، نه دلیلی برای جایگزین کردن runtime NestJS.

```text
TypeScript compiler
→ dist/
→ Node.js 25
→ NestJS application runtime
```

development watch بدون `@nestjs/cli` پیاده‌سازی می‌شود.

تا زمانی که سازگاری Node 25 آن‌ها صریحاً اعتبارسنجی نشده، `@nestjs/cli` یا `@nestjs/schematics` را دوباره وارد نکنید.

## 5.6 Portability برای production/deployment

Docker/containerization رد نشده؛ فقط به تعویق افتاده است.

کارهای future deployment می‌توانند Dockerfileها، container registry، production process orchestration، GPU worker containerها یا cloud deployment definitionها را اضافه کنند. این موارد prerequisite فعلی workstation نیستند.

## 5.7 Core stack

```text
Runtime              Node.js 25.9.x
Package manager      npm 11.6.x + npm workspaces
Task orchestration   Turborepo
Frontend             Next.js 16.3 line + React 19 + TypeScript
Styling              Tailwind CSS
UI primitives        source-owned shadcn-like internal design system
Server state         TanStack Query
Tables               TanStack Table when domain tables mature
Forms                React Hook Form + Zod when form slices land
Small client state   Zustand only where justified
Backend              NestJS 12 modular monolith
AI/media workers     Python where advantageous
Database             PostgreSQL 18.x, local during development
ORM                  Drizzle ORM
Vector               pgvector when matching requires it
Cache/ephemeral      Redis only when requirements justify it
Workflow             Temporal when long-running workflows require it
Object storage       StorageProvider; local filesystem in development
Realtime media       LiveKit OSS self-hosted when interview work begins
TURN                 coturn
VAD                  Silero VAD baseline
STT                  whisper.cpp baseline; Persian benchmark required
TTS                  self-hosted provider interface; VITS-family benchmark
Avatar               self-hosted AvatarProvider; MuseTalk benchmark baseline
Observability        OpenTelemetry + structured logs; Sentry-compatible tracking later
CI/CD                GitHub Actions
IDE                  VS Code preferred
```

---

# 6. معماری Storage

Business moduleها نباید مستقیماً به MinIO، AWS S3 یا local filesystem وابسته باشند.

```text
StorageProvider
├─ put(file, metadata)
├─ get(key)
├─ delete(key)
├─ exists(key)
└─ createReadReference(key)
```

پیاده‌سازی فعلی توسعه:

```text
LocalFilesystemStorageAdapter
→ .local-data/storage/
```

Production در آینده از `S3StorageAdapter` یا `S3CompatibleStorageAdapter` استفاده می‌کند. MinIO infrastructure اختیاری آینده است و requirement توسعه فعلی نیست.

---

# 7. ماژول‌های bounded backend

ماژول‌های bounded اولیه NestJS شامل موارد زیر هستند:

```text
auth
organizations
memberships
permissions
jobs
rubrics
candidates
resumes
applications
matching
sourcing
outreach
knowledge-base
screening
scheduling
interviews
assessments
scoring
shortlists
talent-pool
analytics
notifications
integrations
audit
privacy
ai
```

Business moduleها باید capability interfaceها را فراخوانی کنند. domain code نباید مستقیماً به vendor خاص AI، storage، STT، TTS، avatar، media یا infrastructure قفل شود.

---

# 8. ساختار Repository

```text
interview/
├─ apps/
│  ├─ web/
│  └─ api/
├─ services/               specialized workers when milestones require them
│  ├─ ai-worker/
│  └─ media-worker/
├─ packages/
│  ├─ ui/
│  ├─ db/
│  ├─ types/
│  ├─ validation/
│  ├─ config/
│  └─ api-client/
├─ infra/                  future deployment assets
├─ docs/
│  ├─ architecture-decisions/
│  └─ visual-product-target.md
├─ master.md
├─ projectstate.md
├─ production-readiness.md
├─ AGENTS.md
├─ package.json
├─ package-lock.json        generated/committed after validated npm install
└─ turbo.json
```

---

# 9. مدل داده اصلی

entityهای اصلی:

```text
Organization
User
Membership
Role
Permission
Department
Job
JobRequirement
Rubric
RubricCriterion
RubricVersion
Candidate
CandidateIdentity
CandidateExperience
CandidateEducation
CandidateSkill
Resume
ResumeDocument
Application
Pipeline
PipelineStage
PipelineTransition
Evidence
CandidateCriterionEvaluation
Scorecard
ScoreOverride
AIExecution
SourcingRun
DiscoveredCandidate
Conversation
Message
ScreeningSession
InterviewPlan
InterviewSession
InterviewTurn
InterviewQuestion
CandidateAnswer
InterviewTranscriptSegment
InterviewEvidence
InterviewEvaluation
InterviewRecording
Assessment
AssessmentSession
AssessmentResult
Shortlist
TalentPool
Activity
AuditEvent
ConsentRecord
RetentionPolicy
Integration
Notification
RecruitmentEvent
```

`Application` رابطه Candidate ↔ Job است و state چرخه حیات مخصوص همان شغل را مالک است. هویت Candidate در سطح سازمان global باقی می‌ماند.

---

# 10. Resume ingestion و Matching

```text
Upload
→ StorageProvider
→ text extraction
→ structured parsing
→ experience/skills extraction
→ chunks
→ embeddings when enabled
→ evidence candidates
→ candidate profile update
```

Candidate matching نباید صرفاً cosine similarity تبدیل‌شده به درصد باشد.

Match scoring باید سیگنال‌های صریح دامنه مانند must-have skillها، تجربه مرتبط، seniority، context relevance، verified skillها، screening، assessment و interview evidence را ترکیب کند.

Vector search یک retrieval signal است، نه final business score.

---

# 11. معماری Evidence و Scoring

Evidence یک موجودیت درجه‌یک است و در صورت امکان باید به source material و timestampها deep-link داشته باشد.

```text
Rubric Version
    ↓
Criterion Evaluations + Evidence
    ↓
Deterministic ScoreEngine
    ↓
Overall Score
    ↓
Recommendation
    ↓
Human Review / Override
```

هر override باید مقدار قبلی، مقدار جدید، actor، دلیل و timestamp را ثبت کند.

---

# 12. معماری Sourcing

تمام sourcing بر پایه adapter است:

```text
CandidateSourceAdapter
├─ InternalTalentPoolAdapter
├─ ATSAdapter
├─ ApprovedJobBoardAdapter
└─ ApprovedExternalSourceAdapter
```

ابتدا internal talent pool جست‌وجو می‌شود. query expansion می‌تواند شامل synonymهای title/skill باشد. full-text و semantic retrieval می‌توانند ترکیب شوند، اما retrieval similarity final candidate score نیست.

scraping مخفی یا تأییدنشده platformها را وابستگی اصلی سیستم نکنید. دسترسی LinkedIn، در صورت وجود، باید integration قانونی/مجاز باشد و scraping فرض نشود.

identity resolution/deduplication از strong identifierها به‌علاوه supporting signalها استفاده می‌کند؛ mergeهای مبهم نیازمند human review هستند.

---

# 13. Outreach و مکالمه با Candidate

پاسخ‌های candidate-facing درباره حقوق، remote policy، benefits، process و اطلاعات مشابه باید بر knowledge تأییدشده شرکت/شغل متکی باشند.

```text
Candidate question
→ intent
→ approved knowledge retrieval
→ draft response
→ policy validation
→ human approval or configured auto-send
```

---

# 14. Workflow orchestration

Temporal برای workflowهای واقعاً long-running شامل wait، retry، callback و human signal در نظر گرفته شده است. در foundation اولیه الزامی نیست.

workflowهای چندروزه recruiting را به شکل زنجیره‌های cron شکننده و boolean flagها مدل نکنید.

---

# 15. معماری AI Interview

## 15.1 Core media/dialogue loop

```text
Candidate WebRTC
→ LiveKit OSS
→ Silero VAD
→ local STT
→ transcript
→ Interview Brain
→ LLMProvider
→ structured turn
→ local TTS
→ AvatarProvider
→ LiveKit audio/video
→ Candidate
```

در صورت نیاز، coturn سرویس TURN/STUN را فراهم می‌کند.

## 15.2 Interview plan و state

Plan از Job، Rubric، Seniority، Resume/Candidate history، interview template، time budget و organization policy مشتق می‌شود.

حداقل این موارد track شوند:

```text
current criterion
asked questions
evidence found/missing
criterion confidence
remaining time
resume claim under validation
contradiction signals
candidate intent
session/reconnect state
```

candidate intentهای پشتیبانی‌شده شامل ANSWER، CLARIFICATION_REQUEST، SKIP_REQUEST، INTERRUPTION، SILENCE/TIMEOUT، RECONNECT، CANDIDATE_QUESTION و POLICY_REFUSAL هستند.

سؤال‌ها از یک controlled state graph پیروی می‌کنند، نه یک فهرست ثابت و نه chat بدون محدودیت.

## 15.3 قرارداد structured turn

یک turn می‌تواند شبیه این باشد:

```json
{
  "action": "probe",
  "criterion": "kubernetes",
  "objective": "production_debugging",
  "spoken_text": "یه نمونه از مشکلی که در production با Kubernetes داشتی برام تعریف می‌کنی؟",
  "expected_evidence": ["logs", "events", "metrics", "root cause"]
}
```

فقط `spoken_text` تأییدشده به TTS/avatar می‌رسد.

## 15.4 Interviewer در برابر Evaluator

```text
AI Interviewer
→ manages dialogue and evidence collection

AI Evaluator
→ independently evaluates finalized evidence against rubric
```

برای production evaluation، prompt/trace/roleهای جداگانه الزامی هستند.

## 15.5 Digital human

Avatar فقط لایه presentation است و هیچ‌وقت مالک interview intelligence نیست.

assetهای actor که به‌صورت حرفه‌ای ضبط شده‌اند باید حقوق تجاری صریح likeness/voice داشته باشند. هدف، تعامل حرفه‌ای و محترمانه digital-human است؛ نه فریب کاندیدا برای اینکه تصور کند با انسان واقعی صحبت می‌کند.

ویدیو/صدای Candidate می‌تواند در صورت مجاز بودن، شواهد job-relevant دارای timestamp و signalهای session-integrity ایجاد کند، اما نباید برای استنتاج emotion، honesty، personality، confidence یا suitability بدون پشتوانه استفاده شود.

---

# 16. Assessments

معماری coding assessment:

```text
Question
→ Web editor
→ Submission
→ isolated runner
→ tests
→ structured result
→ evidence analysis
→ rubric evaluation
```

کد Candidate هرگز نباید مستقیماً داخل core API process اجرا شود.

---

# 17. Analytics

Analytics اولیه می‌تواند از PostgreSQL استفاده کند. فقط بعد از اینکه حجم اندازه‌گیری‌شده نیاز را ثابت کرد، analytics store جداگانه معرفی کنید.

metricهای اصلی شامل pipeline conversion، stage duration، time-to-hire، source quality، outreach response، interview completion، human/AI calibration، low-confidence rate و false-rejection analysis هستند.

---

# 18. Security، Privacy و Governance

نیازمندی‌های foundation:

- organization/tenant isolation؛
- RBAC و permissionهای صریح؛
- audit log برای actionهای مهم؛
- candidate consent record؛
- اعلام video/audio recording؛
- retention/deletion قابل پیکربندی؛
- دسترسی امن به storage؛
- AI execution provenance؛
- تاریخچه human override؛
- عدم biometric/personality scoring بدون پشتوانه.

secret management در production نباید به فایل‌های `.env` commitشده متکی باشد. فایل‌های local `.env` برای توسعه روی laptop مجاز هستند و باید توسط Git ignore شوند.

---

# 19. اصول Frontend و Design System

UI نباید تبدیل به یک generic admin template یا grid کارت‌های KPI شود.

از reusable primitiveها به‌علاوه componentهای product-aware استفاده کنید. patternهای enterprise مانند data table، saved filter/view، split view، side panel، sticky action، inline editing، bulk action، comparison، timeline، pipeline/kanban، command menu، keyboard shortcut و evidence drill-down را ترجیح دهید.

Dashboard یک Command Center است، نه گالری metricهای تزئینی.

پیشنهادهای AI باید در صورت معنادار بودن provenance/evidence/confidence را نمایش دهند و human approval، override و undo را حفظ کنند.

پذیرش UI محصول داخلی در `docs/visual-product-target.md` تعریف شده و به screenshot از اپلیکیشن اجرایی نیاز دارد، نه mock image تولیدشده.

آمادگی RTL/LTR requirement پایه است. فارسی و انگلیسی هر دو باید پشتیبانی شوند.

---

# 20. قراردادهای API

Baseline:

```text
REST
OpenAPI
versioned endpoint conventions
typed API client
Zod/shared validation where appropriate
structured errors
correlation/request ID
tenant context
authorization at service boundary
```

recordهای database را مستقیماً به‌عنوان API contract کنترل‌نشده expose نکنید.

---

# 21. استراتژی Testing

حداقل لایه‌ها:

```text
unit tests
service/domain tests
authorization tests
tenant-isolation tests
API integration tests
critical browser flows
AI contract/evaluation tests
interview reliability tests
```

برای رفتار AI، fixtureهای deterministic و evaluation datasetها مهم‌تر از snapshot گرفتن از prose هستند. تست مصاحبه فارسی باید گفتار فنی mixed Persian-English را شامل شود.

---

# 22. استراتژی Local developer setup

## 22.1 موارد موردنیاز در ابتدا

```text
VS Code
Git
Node.js 25.9.x
npm 11.6.x
PostgreSQL
Internet access to registry.npmjs.org
```

## 22.2 مواردی که هنگام نیاز milestone نصب می‌شوند

```text
Python
Redis
pgvector
FFmpeg
whisper.cpp toolchain
LiveKit server
coturn
TTS runtime
Avatar/GPU dependencies
Temporal
```

## 22.3 مواردی که برای توسعه فعلی لازم نیستند

```text
Docker Desktop
Docker Compose
Kubernetes
MinIO
cloud deployment account
hosted STT/TTS/avatar services
```

---

# 23. ترتیب Delivery

```text
M0 Foundation
→ M1 Job → Candidate → Evidence vertical slice
→ M2 Sourcing + Talent
→ M3 Outreach + Screening + Scheduling
→ M4 AI Interview
→ M5 Assessments
→ M6 Analytics + Enterprise hardening
```

M0 شامل monorepo، web shell، API shell، PostgreSQL محلی، Drizzle، organization/user/membership، RBAC، audit، Local Filesystem StorageProvider، AI provider interfaceها، foundation مربوط به Design System، typed API client و CI است.

Redis، MinIO، Docker، Temporal و realtime media صرفاً برای کامل کردن foundation اولیه الزامی نیستند.

---

# 24. خلاصه تصمیم‌های معماری

تصمیم‌های قفل‌شده:

```text
Modular monolith first
Candidate organization-global; Application job-specific
PostgreSQL primary system of record
Drizzle ORM
Evidence first
Deterministic final scoring
Human review for consequential decisions
Provider abstractions
pgvector before external vector DB
REST + OpenAPI first
Approved sourcing adapters
Audit from foundation
No unsupported biometric/personality inference
Candidate-facing and internal surfaces separated
Controlled Interview Brain
Interviewer/Evaluator separation
Avatar presentation-only
No mandatory per-minute media SaaS
Self-hosted interview media path
Laptop-first local-native development
Node.js 25.9.x + npm 11.6.x
npm workspaces + Turborepo
Public npm registry + deterministic committed package-lock.json
package-lock.json canonical JavaScript lockfile
NestJS runtime without Node-25-incompatible CLI/schematics
VS Code preferred development IDE
No Docker requirement during current implementation phase
Local filesystem storage during development
MinIO/S3 deferred behind StorageProvider
```

---

# 25. سیاست Change

هر پیشنهاد آینده که یکی از تصمیم‌های قفل‌شده را تغییر می‌دهد باید موارد زیر را مستند کند:

1. مسئله؛
2. تغییر پیشنهادی؛
3. گزینه‌های جایگزین بررسی‌شده؛
4. اثر migration؛
5. اثر security/privacy؛
6. اثر هزینه؛
7. اینکه آیا `projectstate.md` یا `production-readiness.md` نیز باید تغییر کند یا خیر.

هدف این نیست که تصمیم‌ها برای همیشه ثابت بمانند. هدف این است که از architecture drift ناخواسته جلوگیری شود.
