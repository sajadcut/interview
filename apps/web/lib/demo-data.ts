export type DemoCandidate = {
  id: string; name: string; role: string; company: string; experience: string; match: number; stage: string; source: string; owner: string; updated: string; tone: number; skills: string[];
};

export const candidates: DemoCandidate[] = [
  { id:"ali-rahimi", name:"Ali Rahimi", role:"Backend Lead", company:"Digikala", experience:"7 yrs", match:91, stage:"Interview", source:"AI Search", owner:"Sara", updated:"1h ago", tone:0, skills:[".NET","Azure","SQL"] },
  { id:"sara-mohammadi", name:"Sara Mohammadi", role:"Senior Developer", company:"Snapp", experience:"6 yrs", match:88, stage:"Screening", source:"Talent Pool", owner:"Amir", updated:"3h ago", tone:1, skills:[".NET","K8s","SQL"] },
  { id:"reza-akbari", name:"Reza Akbari", role:"Software Engineer", company:"Tapsi", experience:"5 yrs", match:85, stage:"Screening", source:"Job Board", owner:"Sara", updated:"1d ago", tone:2, skills:["C#","SQL","Docker"] },
  { id:"mohsen-karimi", name:"Mohsen Karimi", role:"Backend Developer", company:"Cafe Bazaar", experience:"4 yrs", match:82, stage:"Sourced", source:"Referral", owner:"Amir", updated:"2d ago", tone:3, skills:[".NET","SQL","AWS"] },
  { id:"mina-hashemi", name:"Mina Hashemi", role:"Backend Developer", company:"Alibaba", experience:"3 yrs", match:78, stage:"Sourced", source:"AI Search", owner:"Sara", updated:"2d ago", tone:4, skills:["C#","Azure","Redis"] },
  { id:"arash-mehdizadeh", name:"Arash Mehdizadeh", role:"Backend Developer", company:"Bama", experience:"4 yrs", match:74, stage:"New", source:"Talent Pool", owner:"Amir", updated:"3d ago", tone:1, skills:[".NET","Docker","SQL"] },
];

export const attentionItems = [
  ["6 candidates waiting for review","Backend Engineer · Scored","violet"],
  ["2 interviews completed","Waiting for your feedback","blue"],
  ["3 outreach replies need approval","From LinkedIn · High priority","green"],
  ["Backend Lead sourcing is under target","Only 32% of target this week","amber"],
] as const;

export const aiActivity = [
  ["83 candidates discovered","+23% vs last week"],
  ["21 candidates evaluated","+15% vs last week"],
  ["9 outreach messages sent","+8% vs last week"],
  ["4 interviews completed","+33% vs last week"],
] as const;

export const recommendedActions = [
  ["Review top 5 Backend candidates","High match · Updated 1h ago"],
  ["Expand sourcing criteria","Increase reach by ~20%"],
  ["Follow up with 3 candidates","No response in 5+ days"],
] as const;

export const jobTabs: Array<[string,string]> = [
  ["Overview","/app/jobs/senior-backend-engineer"],
  ["Candidates","/app/jobs/senior-backend-engineer/candidates"],
  ["Sourcing","/app/jobs/senior-backend-engineer/sourcing"],
  ["Outreach","/app/jobs/senior-backend-engineer/outreach"],
  ["Pipeline","/app/jobs/senior-backend-engineer/pipeline"],
  ["Interviews","/app/jobs/senior-backend-engineer/interviews"],
  ["Scorecards","/app/jobs/senior-backend-engineer/scorecards"],
  ["Analytics","/app/jobs/senior-backend-engineer#analytics"],
  ["Activity","/app/jobs/senior-backend-engineer#activity"],
  ["Settings","/app/jobs/senior-backend-engineer#settings"],
];
