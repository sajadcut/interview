# Internal access-control contract

The API permission guard remains the security authority. The Web role matrix only removes unavailable navigation/actions and provides an early access-denied experience; it must never replace server-side authorization.

Canonical tenant roles:

| Role | Primary scope |
| --- | --- |
| ORGANIZATION_ADMIN | Organization administration and all tenant capabilities |
| HR_MANAGER | Policy, oversight, privacy, analytics, interview assignment/review and decision support |
| RECRUITER | Jobs, sourcing, talent, outreach, screening, scheduling and interview operations |
| HIRING_MANAGER | Candidate/job review, evaluation, analytics and human decision submission |
| INTERVIEWER | Assigned interviews, evidence/scorecard evaluation and assessment review |

`PLATFORM_ADMIN` is platform-scoped and is not accepted by organization-user assignment APIs. `CANDIDATE` is a separate candidate-facing identity surface and is never a tenant membership role.

Sensitive administrative permissions such as `organization.manage_users` and `integration.manage` are intentionally not granted to HR_MANAGER. All consequential decision endpoints remain permission-gated and auditable.
