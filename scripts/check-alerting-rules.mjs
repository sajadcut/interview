import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(repoRoot, "ops/monitoring/alerting-contract.v1.json");
const realtimeContractPath = path.join(repoRoot, "contracts/realtime-metrics.v1.json");
const githubRunbookPrefix = "https://github.com/sajadcut/interview/blob/main/";

function fail(message) {
  throw new Error(`Alerting contract validation failed: ${message}`);
}

function expandedRealtimeMetricNames(realtimeContract) {
  const names = new Set();
  for (const metric of realtimeContract.metrics ?? []) {
    names.add(metric.name);
    if (metric.type === "histogram") {
      names.add(`${metric.name}_bucket`);
      names.add(`${metric.name}_sum`);
      names.add(`${metric.name}_count`);
    }
  }
  return names;
}

function parseRules(yaml) {
  return yaml
    .split(/^      - alert: /m)
    .slice(1)
    .map((chunk) => {
      const newline = chunk.indexOf("\n");
      const name = chunk.slice(0, newline).trim();
      const body = chunk.slice(newline + 1);
      const expr = body.match(/^\s{8}expr: >-\n\s{10}(.+)$/m)?.[1];
      const forDuration = body.match(/^\s{8}for: (\S+)$/m)?.[1];
      const labelBlock = body.match(/^\s{8}labels:\n([\s\S]*?)^\s{8}annotations:$/m)?.[1] ?? "";
      const labels = Object.fromEntries(
        [...labelBlock.matchAll(/^\s{10}([a-z_]+): ([a-z0-9_]+)$/gm)].map((item) => [
          item[1],
          item[2],
        ]),
      );
      const summary = body.match(/^\s{10}summary: "([^"]+)"$/m)?.[1];
      const description = body.match(/^\s{10}description: "([^"]+)"$/m)?.[1];
      const runbookUrl = body.match(/^\s{10}runbook_url: "([^"]+)"$/m)?.[1];
      return { name, expr, forDuration, labels, summary, description, runbookUrl };
    });
}

function balancedExpression(expr) {
  const pairs = new Map([
    [")", "("],
    ["]", "["],
    ["}", "{"],
  ]);
  const opening = new Set(pairs.values());
  const stack = [];
  let quoted = false;
  let escaped = false;

  for (const character of expr) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (opening.has(character)) stack.push(character);
    if (pairs.has(character) && stack.pop() !== pairs.get(character)) return false;
  }

  return !quoted && stack.length === 0;
}

function validateContractShape(contract) {
  if (contract.contractVersion !== "v1") fail("contractVersion must be v1");
  if (contract.ruleFile !== "ops/monitoring/prometheus-alerts.yml") fail("unexpected ruleFile");
  if (contract.runbookFile !== "docs/operations/alerting-runbook.md") fail("unexpected runbookFile");
  if (contract.principles?.thresholdsAreProductionSloEvidence !== false) {
    fail("repository thresholds must not claim production SLO evidence");
  }
  if (contract.principles?.deliveryConfigurationIsDeploymentSpecific !== true) {
    fail("alert delivery must remain deployment-specific");
  }
  if (contract.principles?.dynamicAlertLabelsForbidden !== true) {
    fail("dynamic alert labels must remain forbidden");
  }
  if (contract.principles?.destructiveAutoRemediationForbidden !== true) {
    fail("destructive auto-remediation must remain forbidden");
  }

  const allowed = contract.allowedRuleLabels ?? [];
  if (
    allowed.length !== 3 ||
    !["severity", "component", "alert_family"].every((label) => allowed.includes(label))
  ) {
    fail("allowedRuleLabels must be exactly severity, component, alert_family");
  }

  const forbidden = new Set(contract.forbiddenRuleLabels ?? []);
  for (const label of ["organization_id", "candidate_id", "worker_id", "token"]) {
    if (!forbidden.has(label)) fail(`forbiddenRuleLabels must include ${label}`);
  }

  if (contract.routingPolicy?.warning?.routeClass !== "team-channel") {
    fail("warning routeClass must be team-channel");
  }
  if (contract.routingPolicy?.critical?.routeClass !== "pager") {
    fail("critical routeClass must be pager");
  }
}

function expectedRules(contract) {
  const expected = new Map();
  const categories = new Set();

  for (const [family, definition] of Object.entries(contract.families ?? {})) {
    categories.add(definition.category);
    for (const severity of ["warning", "critical"]) {
      const name = definition[severity];
      if (!name) fail(`family ${family} is missing ${severity} alert`);
      if (expected.has(name)) fail(`contract duplicates alert ${name}`);
      expected.set(name, {
        name,
        category: definition.category,
        component: definition.component,
        family,
        severity,
        runbookAnchor: definition.runbookAnchor,
      });
    }
  }

  for (const alert of contract.singleAlerts ?? []) {
    categories.add(alert.category);
    if (expected.has(alert.name)) fail(`contract duplicates alert ${alert.name}`);
    expected.set(alert.name, alert);
  }

  for (const category of contract.requiredCategories ?? []) {
    if (!categories.has(category)) fail(`required category ${category} has no contracted alert`);
  }

  return expected;
}

async function main() {
  const [contractRaw, realtimeRaw] = await Promise.all([
    readFile(contractPath, "utf8"),
    readFile(realtimeContractPath, "utf8"),
  ]);
  const contract = JSON.parse(contractRaw);
  const realtimeContract = JSON.parse(realtimeRaw);
  validateContractShape(contract);

  const rulePath = path.join(repoRoot, contract.ruleFile);
  const runbookPath = path.join(repoRoot, contract.runbookFile);
  const [yaml, runbook] = await Promise.all([
    readFile(rulePath, "utf8"),
    readFile(runbookPath, "utf8"),
  ]);

  const expected = expectedRules(contract);
  const rules = parseRules(yaml);
  if (rules.length !== expected.size) {
    fail(`expected ${expected.size} rules, parsed ${rules.length}`);
  }

  const seen = new Set();
  const realtimeNames = expandedRealtimeMetricNames(realtimeContract);
  const allowedRuleLabels = new Set(contract.allowedRuleLabels);
  const forbiddenRuleLabels = new Set(contract.forbiddenRuleLabels);

  for (const rule of rules) {
    if (seen.has(rule.name)) fail(`duplicate rule ${rule.name}`);
    seen.add(rule.name);

    const expectedRule = expected.get(rule.name);
    if (!expectedRule) fail(`uncontracted rule ${rule.name}`);

    if (!rule.expr || !balancedExpression(rule.expr)) {
      fail(`${rule.name} has a missing or unbalanced expression`);
    }
    if (!/^[1-9]\d*(s|m|h)$/.test(rule.forDuration ?? "")) {
      fail(`${rule.name} must define a positive for duration`);
    }
    if (!rule.summary || !rule.description || !rule.runbookUrl) {
      fail(`${rule.name} must define summary, description, and runbook_url`);
    }

    const labelKeys = Object.keys(rule.labels);
    for (const key of labelKeys) {
      if (!allowedRuleLabels.has(key)) fail(`${rule.name} has unapproved rule label ${key}`);
      if (forbiddenRuleLabels.has(key)) fail(`${rule.name} has forbidden rule label ${key}`);
    }
    if (labelKeys.length !== allowedRuleLabels.size) {
      fail(`${rule.name} must define exactly severity, component, alert_family labels`);
    }
    if (rule.labels.severity !== expectedRule.severity) {
      fail(`${rule.name} severity does not match contract`);
    }
    if (rule.labels.component !== expectedRule.component) {
      fail(`${rule.name} component does not match contract`);
    }
    if (rule.labels.alert_family !== expectedRule.family) {
      fail(`${rule.name} alert_family does not match contract`);
    }

    const expectedRunbookUrl =
      `${githubRunbookPrefix}${contract.runbookFile}#${expectedRule.runbookAnchor}`;
    if (rule.runbookUrl !== expectedRunbookUrl) {
      fail(`${rule.name} runbook_url does not match contract`);
    }
    if (!runbook.includes(`<a id="${expectedRule.runbookAnchor}"></a>`)) {
      fail(`${rule.name} runbook anchor ${expectedRule.runbookAnchor} is missing`);
    }

    const realtimeMetrics = rule.expr.match(/interview_realtime_[a-z0-9_]+/g) ?? [];
    for (const metric of realtimeMetrics) {
      if (!realtimeNames.has(metric)) {
        fail(`${rule.name} references realtime metric outside realtime contract: ${metric}`);
      }
    }
  }

  for (const name of expected.keys()) {
    if (!seen.has(name)) fail(`contracted rule ${name} is missing`);
  }

  console.log(
    `✓ ${rules.length} Prometheus alert rules satisfy alerting contract ${contract.contractVersion}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
