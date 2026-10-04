// Perceptual audit glue (P3b): evaluate a backend-produced perceptual model
// against the figure brief (profile, recreation policy), the design plan
// (render contexts), and the resolved publication rules, then merge the
// resulting findings into an audit result before ledger attribution runs.
//
// Degrades to { applied: false, reason } on any failure; never throws. The
// evaluation core stays pure in perceptual-qa.mjs; this module owns the
// filesystem and resolver wiring.
import { readFigureBrief } from "./figure-truth.mjs";
import { readFigurePlan } from "./figure-plan.mjs";
import { resolveFigureRules } from "./publication-compliance.mjs";
import { evaluatePerceptualQa } from "./perceptual-qa.mjs";

function trimmedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function summarizePublisherSpec(resolved) {
  return {
    applied: true,
    publisher: resolved.context.publisher,
    profile: resolved.context.profile,
    layers: resolved.layers,
    freshness: resolved.freshness,
    unknowns: resolved.unknowns,
    warnings: resolved.warnings,
    runtime_statement: resolved.runtime_statement,
  };
}

function summarizeModel(model) {
  const elements = Array.isArray(model?.elements) ? model.elements : [];
  const pictures = elements
    .filter((element) => element && element.kind === "picture")
    .slice(0, 20)
    .map((element) => ({
      name: String(element.name ?? "unnamed"),
      ...(Number.isFinite(element.pixel_width) ? { pixel_width: element.pixel_width } : {}),
      ...(Number.isFinite(element.pixel_height) ? { pixel_height: element.pixel_height } : {}),
      ...(Number.isFinite(element.placed_width_pt) ? { placed_width_pt: element.placed_width_pt } : {}),
      ...(Number.isFinite(element.placed_height_pt) ? { placed_height_pt: element.placed_height_pt } : {}),
    }));
  return { elements: elements.length, pictures };
}

export async function applyPerceptualQa(auditValue, { artifactPath = null, briefPath = null, publisher = null, rasterClass = null } = {}) {
  if (!auditValue || typeof auditValue !== "object") {
    return { applied: false, reason: "the audit result is not an object." };
  }
  const model = auditValue.perceptual_model;
  if (!model || typeof model !== "object") {
    const skipped = { applied: false, reason: "the backend did not provide a perceptual model." };
    auditValue.perceptual_qa = skipped;
    return skipped;
  }
  // The model can be large; the audit output keeps a compact summary and the
  // evaluation result instead of the full element list.
  const modelSummary = summarizeModel(model);
  delete auditValue.perceptual_model;
  const normalizedPublisher = trimmedString(publisher);
  const normalizedRasterClass = trimmedString(rasterClass);
  const warnings = [];
  try {
    let brief = null;
    let briefApplied = null;
    if (trimmedString(artifactPath) || trimmedString(briefPath)) {
      try {
        const read = await readFigureBrief({ artifactPath, briefPath });
        if (read.exists) {
          brief = read.document;
          briefApplied = { path: read.resolved_path, revision: read.revision };
        }
      } catch (error) {
        warnings.push(`the figure brief could not be read: ${error.message}`);
      }
    }
    let plan = null;
    try {
      const read = await readFigurePlan({ artifactPath, briefPath });
      if (read.exists) plan = read.document;
    } catch (error) {
      warnings.push(`the design plan could not be read: ${error.message}`);
    }
    const profile = trimmedString(brief?.profile);
    const styleId = trimmedString(brief?.style_id);
    const figureKind = trimmedString(plan?.figure_kind);
    const contexts = Array.isArray(plan?.render_contexts) ? plan.render_contexts : [];
    let rules = {};
    let publisherSpec = null;
    if (profile) {
      try {
        const resolved = resolveFigureRules({ profile, figureKind, publisher: normalizedPublisher, styleId });
        rules = resolved.resolved;
        if (normalizedPublisher) publisherSpec = summarizePublisherSpec(resolved);
      } catch (error) {
        warnings.push(`rule resolution failed: ${error.message}`);
        try {
          const fallback = resolveFigureRules({ profile, figureKind, styleId });
          rules = fallback.resolved;
        } catch {
          // No profile defaults available; context-independent checks still run.
        }
        if (normalizedPublisher) {
          publisherSpec = { applied: false, publisher: normalizedPublisher, reason: error.message };
        }
      }
    } else if (normalizedPublisher) {
      publisherSpec = { applied: false, publisher: normalizedPublisher, reason: "no profile is available; write a figure brief first." };
    }
    const evaluation = evaluatePerceptualQa({
      model,
      contexts,
      rules,
      policy: trimmedString(brief?.recreation_policy) ?? "unspecified",
      options: { raster_class: normalizedRasterClass },
    });
    const mapped = evaluation.findings.map((finding) => ({
      severity: finding.severity,
      category: finding.category,
      shape_name: finding.objects[0] ?? "figure",
      message: finding.evidence,
      correction: finding.correction,
      acceptance: finding.acceptance,
      ...(finding.context ? { context: finding.context } : {}),
      ...(finding.rule_token ? { rule_token: finding.rule_token } : {}),
    }));
    if (mapped.length > 0) {
      auditValue.findings = Array.isArray(auditValue.findings) ? [...auditValue.findings, ...mapped] : mapped;
      const hard = auditValue.findings.filter((finding) => finding?.severity === "hard").length;
      auditValue.hard_failure_count = hard;
      auditValue.warning_count = auditValue.findings.length - hard;
      auditValue.passed_deterministic_gate = hard === 0;
    }
    const summary = {
      applied: true,
      model_schema: evaluation.model_schema,
      model: modelSummary,
      policy: evaluation.policy,
      brief_applied: briefApplied,
      plan_applied: plan ? { figure_kind: figureKind, render_contexts: contexts.length } : null,
      contexts: evaluation.contexts,
      invalid_contexts: evaluation.invalid_contexts,
      counts: evaluation.counts,
      findings_added: mapped.length,
      warnings,
      ...(evaluation.error ? { error: evaluation.error } : {}),
    };
    auditValue.perceptual_qa = summary;
    if (publisherSpec) auditValue.publisher_spec = publisherSpec;
    return summary;
  } catch (error) {
    const summary = { applied: false, reason: `perceptual evaluation failed: ${error.message}` };
    auditValue.perceptual_qa = summary;
    return summary;
  }
}
