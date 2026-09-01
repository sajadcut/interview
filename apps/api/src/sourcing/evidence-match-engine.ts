export interface MatchRequirement {
  id: string;
  name: string;
  description?: string;
  weight: number;
  requirementType: "must_have" | "nice_to_have";
}

export interface MatchCandidateEvidence {
  label: string;
  verificationState?: string;
  sourceReference?: string;
}

export interface MatchExperienceEvidence {
  title: string;
  description?: string;
  sourceReference?: string;
}

export interface RequirementMatchComponent {
  requirementId: string;
  requirementName: string;
  requirementType: "must_have" | "nice_to_have";
  weight: number;
  coverage: number;
  matchedConcepts: string[];
  evidenceReferences: string[];
  evidenceBacked: boolean;
}

export interface EvidenceMatchResult {
  score: number;
  algorithmVersion: "evidence-concept-v1";
  components: RequirementMatchComponent[];
  missingMustHaveRequirementIds: string[];
  notice: string;
}

const aliases: Record<string, string> = {
  "c#": "csharp",
  csharp: "csharp",
  ".net": "dotnet",
  dotnet: "dotnet",
  k8s: "kubernetes",
  kubernetes: "kubernetes",
  postgres: "postgresql",
  postgresql: "postgresql",
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  microservice: "microservices",
  microservices: "microservices",
  redis: "redis",
  kafka: "kafka",
  azure: "azure",
  aws: "aws",
  gcp: "gcp",
};

function normalizeToken(token: string): string {
  const lowered = token.toLowerCase().trim();
  return aliases[lowered] ?? lowered;
}

function concepts(value: string): Set<string> {
  const raw = value
    .toLowerCase()
    .replace(/\.net/g, " dotnet ")
    .replace(/c#/g, " csharp ")
    .split(/[^a-z0-9+#.]+/g)
    .map(normalizeToken)
    .filter((token) => token.length >= 2);
  return new Set(raw);
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateEvidenceConceptMatch(input: {
  requirements: MatchRequirement[];
  skills: MatchCandidateEvidence[];
  experiences: MatchExperienceEvidence[];
}): EvidenceMatchResult {
  if (input.requirements.length === 0) {
    return {
      score: 0,
      algorithmVersion: "evidence-concept-v1",
      components: [],
      missingMustHaveRequirementIds: [],
      notice: "No job requirements are available; this retrieval signal is not a hiring score.",
    };
  }

  const evidenceItems = [
    ...input.skills
      .filter((skill) => skill.verificationState === "verified" || Boolean(skill.sourceReference))
      .map((skill) => ({
        text: skill.label,
        sourceReference: skill.sourceReference ?? `verified-skill:${skill.label}`,
      })),
    ...input.experiences
      .filter((experience) => Boolean(experience.sourceReference))
      .map((experience) => ({
        text: `${experience.title} ${experience.description ?? ""}`,
        sourceReference: experience.sourceReference!,
      })),
  ];

  const components: RequirementMatchComponent[] = input.requirements.map((requirement) => {
    const requirementConcepts = concepts(`${requirement.name} ${requirement.description ?? ""}`);
    const matchedConcepts = new Set<string>();
    const evidenceReferences = new Set<string>();

    for (const item of evidenceItems) {
      const itemConcepts = concepts(item.text);
      let matched = false;
      for (const concept of requirementConcepts) {
        if (itemConcepts.has(concept)) {
          matchedConcepts.add(concept);
          matched = true;
        }
      }
      if (matched) evidenceReferences.add(item.sourceReference);
    }

    const coverage =
      requirementConcepts.size === 0 ? 0 : matchedConcepts.size / requirementConcepts.size;
    return {
      requirementId: requirement.id,
      requirementName: requirement.name,
      requirementType: requirement.requirementType,
      weight: requirement.weight,
      coverage: roundTwo(Math.min(1, coverage)),
      matchedConcepts: [...matchedConcepts].sort(),
      evidenceReferences: [...evidenceReferences],
      evidenceBacked: evidenceReferences.size > 0,
    };
  });

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const weightedCoverage = components.reduce(
    (sum, component) => sum + component.coverage * component.weight,
    0,
  );
  const score = totalWeight > 0 ? roundTwo((weightedCoverage / totalWeight) * 100) : 0;
  const missingMustHaveRequirementIds = components
    .filter(
      (component) =>
        component.requirementType === "must_have" &&
        (!component.evidenceBacked || component.coverage < 0.5),
    )
    .map((component) => component.requirementId);

  return {
    score,
    algorithmVersion: "evidence-concept-v1",
    components,
    missingMustHaveRequirementIds,
    notice:
      "This is an evidence-backed pre-interview matching/retrieval signal. It is not a hiring score and must not be used as the sole rejection decision.",
  };
}
