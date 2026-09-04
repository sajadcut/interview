import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(repoRoot, "ops/monitoring/alerting-contract.v1.json");
const realtimeContractPath = path.join(repoRoot, "contracts/realtime-metrics.v1.json");
const githubRunbookPrefix = "https://github.com/sajadcut/interview/blob/main/";

function fail(message) {
  throw new Error(`Alerting contract validation failed: ${message}`);
}

function yamlString(value) {
  return JSON.stringify(value);
}

function render(contract) {
  const lines = [
    "# Generated from ops/monitoring/alerting-contract.v1.json.",
    "# Run `npm run alerting:generate` after editing the contract.",
    "groups:",
    "  - name: interview-platform",
    "    rules:",
  ];

  for (const alert of contract.alerts) {
    const runbookUrl = `${githubRunbookPrefix}${contract.runbookFile}#${alert.runbookAnchor}`;
    lines.push(
      `      - alert: ${alert.name}`,
      "        expr: >-",
      `          ${alert.expr}`,
      `        for: ${alert.for}`,
      "        labels:",
      `          severity: ${alert.severity}`,
      `          component: ${alert.component}`,
      `          alert_family: ${alert.family}`,
      "        annotations:",
      `          summary: ${yamlString(alert.summary)}`,
      `          description: ${yamlString(alert.description)}`,
      `          runbook_url: ${yamlString(runbookUrl)}`,
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
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

function validate(contract, realtimeContract, runbook) {
  if (contract.contractVersion !== "v1") {
    fail(`expected contractVersion v1, received ${String(contract.contractVersion)}`);
  }
  if (contract.ruleFile !== "ops/monitoring/prometheus-alerts.yml") {
    fail("ruleFile must remain ops/monitoring/prometheus-alerts.yml");
  }
  if (contract.runbookFile !== "docs/operations/alerting-runbook.md") {
    fail("runbookFile must remain docs/operations/alerting-runbook.md");
  }
  if (contract.principles?.thresholdsAreProductionSloEvidence !== false) {
    fail("repository alert thresholds must not claim production SLO evidence");
  }
  if (contract.principles?.deliveryConfigurationIsDeploymentSpecific !== true) {
    fail("alert delivery must remain explicitly deployment-specific");
  }
  if (contract.principles?.dynamicAlertLabelsForbidden !== true) {
    fail("dynamic alert labels must remain forbidden");
  }
  if (contract.principles?.destructiveAutoRemediationForbidden !== true) {
    fail("destructive automatic remediation must remain forbidden");
  }

  const hardAllowedRuleLabels = new Set(["severity", "component", "alert_family"]);
  const contractAllowedRuleLabels = new Set(contract.allowedRuleLabels ?? []);
  if (
    contractAllowedRuleLabels.size !== hardAllowedRuleLabels.size ||
    [...hardAllowedRuleLabels].some((label) => !contractAllowedRuleLabels.has(label))
  ) {
    fail("allowedRuleLabels must be exactly severity, component, alert_family");
  }

  const hardForbiddenFragments = [
    "organization",
    "candidate",
    "application",
    "session_id",
    "room_",
    "_sid",
    "participant",
    "track",
    "job_id",
    "worker_id",
    "token",
    "email",
    "user_id",
    "request_id",
  ];
  const declaredForbidden = (contract.forbiddenRuleLabels ?? []).join(" ").toLowerCase();
  for (const fragment of ["candidate_id", "organization_id", "token", "worker_id"]) {
    if (!declaredForbidden.includes(fragment)) {
      fail(`forbiddenRuleLabels must include ${fragment}`);
    }
  }

  const alerts = contract.alerts ?? [];
  if (!Array.isArray(alerts) || alerts.length === 0) {
    fail("alerts must be a non-empty array");
  }

  const names = new Set();
  const categories = new Set();
  const byName = new Map();
  const realtimeNames = expandedRealtimeMetricNames(realtimeContract);

  for (const alert of alerts) {
    if (!/^Interview[A-Za-z0-9]+$/.test(alert.name ?? "")) {
      fail(`invalid alert name ${String(alert.name)}`);
    }
    if (names.has(alert.name)) {
      fail(`duplicate alert name ${alert.name}`);
    }
    names.add(alert.name);
    byName.set(alert.name, alert);
    categories.add(alert.category);

    if (!["warning", "critical"].includes(alert.severity)) {
      fail(`${alert.name} has invalid severity ${String(alert.severity)}`);
    }
    if (!/^[a-z][a-z0-9_]*$/.test(alert.component ?? "")) {
      fail(`${alert.name} has invalid component ${String(alert.component)}`);
    }
    if (!/^[a-z][a-z0-9_]*$/.test(alert.family ?? "")) {
      fail(`${alert.name} has invalid family ${String(alert.family)}`);
    }
    if (!/^[1-9]\d*(s|m|h)$/.test(alert.for ?? "")) {
      fail(`${alert.name} must define a positive for duration`);
    }
    if (!alert.expr || typeof alert.expr !== "string") {
      fail(`${alert.name} must define expr`);
    }
    if (!alert.summary || !alert.description) {
      fail(`${alert.name} must define summary and description`);
    }
    if (!/^[a-z0-9-]+$/.test(alert.runbookAnchor ?? "")) {
      fail(`${alert.name} has invalid runbookAnchor`);
    }
    if (!runbook.includes(`<a id="${alert.runbookAnchor}"></a>`)) {
      fail(`${alert.name} runbook anchor ${alert.runbookAnchor} is missing`);
    }

    const metrics = alert.metrics ?? [];
    if (!Array.isArray(metrics) || metrics.length === 0) {
      fail(`${alert.name} must declare referenced metrics`);
    }
    for (const metric of metrics) {
      if (!/^interview_[a-z0-9_]+$/.test(metric)) {
        fail(`${alert.name} has invalid metric name ${String(metric)}`);
      }
      if (!alert.expr.includes(metric)) {
        fail(`${alert.name} declares metric ${metric} but expr does not reference it`);
      }
      if (metric.startsWith("interview_realtime_") && !realtimeNames.has(metric)) {
        fail(`${alert.name} references realtime metric outside the realtime contract: ${metric}`);
      }
    }

    const staticFields = `${alert.component} ${alert.family}`.toLowerCase();
    for (const fragment of hardForbiddenFragments) {
      if (staticFields.includes(fragment)) {
        fail(`${alert.name} contains forbidden identifying fragment ${fragment} in static labels`);
      }
    }
  }

  for (const category of contract.requiredCategories ?? []) {
    if (!categories.has(category)) {
      fail(`required category ${category} has no alert`);
    }
  }

  for (const pair of contract.thresholdPairs ?? []) {
    const warning = byName.get(pair.warning);
    const critical = byName.get(pair.critical);
    if (!warning || !critical) {
      fail(`threshold pair ${pair.warning}/${pair.critical} is incomplete`);
    }
    if (warning.severity !== "warning" || critical.severity !== "critical") {
      fail(`threshold pair ${pair.warning}/${pair.critical} has invalid severities`);
    }
    if (
      warning.family !== critical.family ||
      warning.component !== critical.component ||
      warning.category !== critical.category
    ) {
      fail(`threshold pair ${pair.warning}/${pair.critical} must share family/component/category`);
    }
  }

  if (contract.routingPolicy?.warning?.routeClass !== "team-channel") {
    fail("warning routing policy must target the team-channel class");
  }
  if (contract.routingPolicy?.critical?.routeClass !== "pager") {
    fail("critical routing policy must target the pager class");
  }

  return alerts.length;
}

async function main() {
  const [contractRaw, realtimeRaw] = await Promise.all([
    readFile(contractPath, "utf8"),
    readFile(realtimeContractPath, "utf8"),
  ]);
  const contract = JSON.parse(contractRaw);
  const realtimeContract = JSON.parse(realtimeRaw);
  const runbookPath = path.join(repoRoot, contract.runbookFile);
  const rulePath = path.join(repoRoot, contract.ruleFile);
  const runbook = await readFile(runbookPath, "utf8");

  const count = validate(contract, realtimeContract, runbook);
  const expected = render(contract);

  if (process.argv.includes("--write")) {
    await writeFile(rulePath, expected, "utf8");
    console.log(`✓ generated ${count} Prometheus alert rules from alerting contract v1`);
    return;
  }

  const current = (await readFile(rulePath, "utf8")).replaceAll("\r\n", "\n");
  if (current !== expected) {
    fail("prometheus-alerts.yml is out of sync; run `npm run alerting:generate` and commit the result");
  }

  console.log(`✓ ${count} Prometheus alert rules match alerting contract v1`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
