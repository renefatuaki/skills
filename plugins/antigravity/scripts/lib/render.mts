// Ported from scripts/lib/render.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).

import type { AuthStatus, UsageStatus } from './agy.mts';
import type { StatusSnapshot } from './job-control.mts';
import type { BinaryStatus, EnrichedJob, Job, StoredJob } from './types.mts';

/** The review JSON the schema asks for, before the renderer checks its shape. */
export type ParsedReview = {
  parsed: unknown;
  parseError: string | null;
  rawOutput: string;
};

/** What a rendered review names about the run. */
export type ReviewMeta = {
  reviewLabel: string;
  targetLabel: string;
  notes?: string[];
};

/** What `setup` checked, and what it did and suggests. */
export type SetupReport = {
  ready: boolean;
  node: BinaryStatus;
  agy: BinaryStatus;
  auth: AuthStatus;
  usage: UsageStatus;
  reviewGateEnabled: boolean;
  actionsTaken: string[];
  nextSteps: string[];
};

type Finding = {
  severity: string;
  title: string;
  body: string;
  file: string;
  line_start: number | null;
  line_end: number | null;
  recommendation: string;
};

type ReviewData = {
  verdict: string;
  summary: string;
  findings: Finding[];
  next_steps: string[];
};

type Loose = Record<string, unknown>;

function severityRank(severity: string): number {
  switch (severity) {
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 2;
    default:
      return 3;
  }
}

function formatLineRange(finding: Finding): string {
  if (!finding.line_start) {
    return '';
  }

  if (!finding.line_end || finding.line_end === finding.line_start) {
    return `:${finding.line_start}`;
  }

  return `:${finding.line_start}-${finding.line_end}`;
}

function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateReviewResultShape(data: unknown): string | null {
  if (!isObject(data)) {
    return 'Expected a top-level JSON object.';
  }

  if (typeof data.verdict !== 'string' || !data.verdict.trim()) {
    return 'Missing string `verdict`.';
  }

  if (typeof data.summary !== 'string' || !data.summary.trim()) {
    return 'Missing string `summary`.';
  }

  if (!Array.isArray(data.findings)) {
    return 'Missing array `findings`.';
  }

  if (!Array.isArray(data.next_steps)) {
    return 'Missing array `next_steps`.';
  }

  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeReviewFinding(finding: unknown, index: number): Finding {
  const source: Loose = isObject(finding) ? finding : {};
  const start = source.line_start;
  const end = source.line_end;
  const lineStart =
    Number.isInteger(start) && Number(start) > 0 ? Number(start) : null;

  const lineEnd =
    Number.isInteger(end) &&
    Number(end) > 0 &&
    (!lineStart || Number(end) >= lineStart)
      ? Number(end)
      : lineStart;

  return {
    severity: text(source.severity) || 'low',
    title: text(source.title) || `Finding ${index + 1}`,
    body: text(source.body) || 'No details provided.',
    file: text(source.file) || 'unknown',
    line_start: lineStart,
    line_end: lineEnd,
    recommendation: text(source.recommendation),
  };
}

function normalizeReviewResultData(data: Loose): ReviewData {
  return {
    verdict: text(data.verdict),
    summary: text(data.summary),
    findings: (data.findings as unknown[]).map(normalizeReviewFinding),
    next_steps: (data.next_steps as unknown[])
      .filter(step => text(step) !== '')
      .map(text),
  };
}

function isStructuredReviewStoredResult(storedJob: StoredJob | null): boolean {
  const result = storedJob?.result;

  return (
    isObject(result) &&
    (Object.hasOwn(result, 'result') || Object.hasOwn(result, 'parseError'))
  );
}

function formatJobLine(job: Job): string {
  const parts = [job.id, `${job.status || 'unknown'}`];

  if (job.kindLabel) {
    parts.push(job.kindLabel);
  }

  if (job.title) {
    parts.push(job.title);
  }

  return parts.join(' | ');
}

function escapeMarkdownCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function formatResumeCommand(conversationId: string | null | undefined) {
  return conversationId ? `agy --conversation ${conversationId}` : null;
}

function appendActiveJobsTable(lines: string[], jobs: EnrichedJob[]): void {
  lines.push('Active jobs:');
  lines.push(
    '| Job | Kind | Status | Phase | Elapsed | Antigravity Conversation ID | Summary | Actions |',
  );

  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');

  for (const job of jobs) {
    const actions = [`/antigravity:status ${job.id}`];

    if (job.status === 'queued' || job.status === 'running') {
      actions.push(`/antigravity:cancel ${job.id}`);
    }

    lines.push(
      `| ${escapeMarkdownCell(job.id)} | ${escapeMarkdownCell(job.kindLabel)} | ${escapeMarkdownCell(job.status)} | ${escapeMarkdownCell(job.phase ?? '')} | ${escapeMarkdownCell(job.elapsed ?? '')} | ${escapeMarkdownCell(job.conversationId ?? '')} | ${escapeMarkdownCell(job.summary ?? '')} | ${actions.map(action => `\`${action}\``).join('<br>')} |`,
    );
  }
}

/** Which lines of a job the status report shows. */
type DetailOptions = {
  showElapsed?: boolean;
  showDuration?: boolean;
  showLog?: boolean;
  showCancelHint?: boolean;
  showResultHint?: boolean;
  showReviewHint?: boolean;
};

function pushJobDetails(
  lines: string[],
  job: EnrichedJob,
  options: DetailOptions = {},
): void {
  const isActive = job.status === 'queued' || job.status === 'running';

  lines.push(`- ${formatJobLine(job)}`);

  if (job.summary) {
    lines.push(`  Summary: ${job.summary}`);
  }

  if (job.phase) {
    lines.push(`  Phase: ${job.phase}`);
  }

  if (options.showElapsed && job.elapsed) {
    lines.push(`  Elapsed: ${job.elapsed}`);
  }

  if (options.showDuration && job.duration) {
    lines.push(`  Duration: ${job.duration}`);
  }

  if (job.conversationId) {
    lines.push(`  Antigravity conversation ID: ${job.conversationId}`);
    lines.push(
      `  Resume in Antigravity: ${formatResumeCommand(job.conversationId)}`,
    );
  }

  if (job.logFile && options.showLog) {
    lines.push(`  Log: ${job.logFile}`);
  }

  if (isActive && options.showCancelHint) {
    lines.push(`  Cancel: /antigravity:cancel ${job.id}`);
  }

  if (!isActive && options.showResultHint) {
    lines.push(`  Result: /antigravity:result ${job.id}`);
  }

  if (
    !isActive &&
    job.jobClass === 'task' &&
    job.write &&
    options.showReviewHint
  ) {
    lines.push('  Review changes: /antigravity:review --wait');
    lines.push('  Stricter review: /antigravity:adversarial-review --wait');
  }

  if (job.progressPreview.length > 0) {
    lines.push('  Progress:');

    for (const line of job.progressPreview) {
      lines.push(`    ${line}`);
    }
  }
}

/** Lists the notes of a run, such as the permissions it was denied, under a heading. */
function appendNotesSection(
  lines: string[],
  notes: string[] | undefined,
): void {
  if (!notes || notes.length === 0) {
    return;
  }

  lines.push('', 'Notes:');

  for (const note of notes) {
    lines.push(`- ${note}`);
  }
}

function formatUsage(usage: UsageStatus): string[] {
  if (!usage.available) {
    return [`- usage: unavailable (${usage.detail})`];
  }

  return usage.groups.flatMap(group => {
    const buckets = (group.buckets ?? [])
      .filter(bucket => typeof bucket.remaining_fraction === 'number')
      .map(bucket => {
        const percent = Math.round((bucket.remaining_fraction ?? 0) * 100);
        const resets = bucket.reset_time ? `, resets ${bucket.reset_time}` : '';

        return `${bucket.window ?? 'current'} ${percent}% left${resets}`;
      });

    return [
      `- usage, ${group.name}: ${buckets.join('; ') || 'no limit reported'}`,
    ];
  });
}

export function renderSetupReport(report: SetupReport): string {
  const lines = [
    '# Antigravity Setup',
    '',
    `Status: ${report.ready ? 'ready' : 'needs attention'}`,
    '',
    'Checks:',
    `- node: ${report.node.detail}`,
    `- agy: ${report.agy.detail}`,
    `- auth: ${report.auth.detail}`,
  ];

  if (report.auth.models.length > 0) {
    lines.push(`- models: ${report.auth.models.join(', ')}`);
  }

  lines.push(...formatUsage(report.usage));
  lines.push(
    `- review gate: ${report.reviewGateEnabled ? 'enabled' : 'disabled'}`,
    '',
  );

  if (report.actionsTaken.length > 0) {
    lines.push('Actions taken:');

    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }

    lines.push('');
  }

  if (report.nextSteps.length > 0) {
    lines.push('Next steps:');

    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function appendRawOutput(lines: string[], parsedResult: ParsedReview): void {
  if (parsedResult.rawOutput) {
    lines.push(
      '',
      'Raw final message:',
      '',
      '```text',
      parsedResult.rawOutput,
      '```',
    );
  }
}

export function renderReviewResult(
  parsedResult: ParsedReview,
  meta: ReviewMeta,
): string {
  if (!parsedResult.parsed) {
    const lines = [
      `# Antigravity ${meta.reviewLabel}`,
      '',
      'Antigravity did not return valid structured JSON.',
      '',
      `- Parse error: ${parsedResult.parseError}`,
    ];

    appendRawOutput(lines, parsedResult);
    appendNotesSection(lines, meta.notes);

    return `${lines.join('\n').trimEnd()}\n`;
  }

  const validationError = validateReviewResultShape(parsedResult.parsed);

  if (validationError) {
    const lines = [
      `# Antigravity ${meta.reviewLabel}`,
      '',
      `Target: ${meta.targetLabel}`,
      'Antigravity returned JSON with an unexpected review shape.',
      '',
      `- Validation error: ${validationError}`,
    ];

    appendRawOutput(lines, parsedResult);
    appendNotesSection(lines, meta.notes);

    return `${lines.join('\n').trimEnd()}\n`;
  }

  const data = normalizeReviewResultData(parsedResult.parsed as Loose);

  const findings = [...data.findings].sort(
    (left, right) => severityRank(left.severity) - severityRank(right.severity),
  );

  const lines = [
    `# Antigravity ${meta.reviewLabel}`,
    '',
    `Target: ${meta.targetLabel}`,
    `Verdict: ${data.verdict}`,
    '',
    data.summary,
    '',
  ];

  if (findings.length === 0) {
    lines.push('No material findings.');
  } else {
    lines.push('Findings:');

    for (const finding of findings) {
      lines.push(
        `- [${finding.severity}] ${finding.title} (${finding.file}${formatLineRange(finding)})`,
      );

      lines.push(`  ${finding.body}`);

      if (finding.recommendation) {
        lines.push(`  Recommendation: ${finding.recommendation}`);
      }
    }
  }

  if (data.next_steps.length > 0) {
    lines.push('', 'Next steps:');

    for (const step of data.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  appendNotesSection(lines, meta.notes);

  return `${lines.join('\n').trimEnd()}\n`;
}

/** Renders a review that did not run to the end, with the failure the run reported. */
export function renderReviewFailure(failure: string, meta: ReviewMeta): string {
  const lines = [
    `# Antigravity ${meta.reviewLabel}`,
    '',
    `Target: ${meta.targetLabel}`,
    '',
    'Antigravity review failed.',
    '',
    '```text',
    failure,
    '```',
  ];

  appendNotesSection(lines, meta.notes);

  return `${lines.join('\n').trimEnd()}\n`;
}

/** Renders the answer of a task, or the failure when it gave none. */
export function renderTaskResult(parsedResult: {
  rawOutput?: string;
  failureMessage?: string;
  notes?: string[];
}): string {
  const rawOutput =
    typeof parsedResult.rawOutput === 'string' ? parsedResult.rawOutput : '';

  if (rawOutput) {
    const lines = [
      rawOutput.endsWith('\n') ? rawOutput.slice(0, -1) : rawOutput,
    ];

    appendNotesSection(lines, parsedResult.notes);

    return `${lines.join('\n')}\n`;
  }

  const message =
    String(parsedResult.failureMessage ?? '').trim() ||
    'Antigravity did not return a final message.';

  const lines = [message];

  appendNotesSection(lines, parsedResult.notes);

  return `${lines.join('\n')}\n`;
}

export function renderStatusReport(report: StatusSnapshot): string {
  const lines = [
    '# Antigravity Status',
    '',
    `Review gate: ${report.config.stopReviewGate ? 'enabled' : 'disabled'}`,
    '',
  ];

  if (report.running.length > 0) {
    appendActiveJobsTable(lines, report.running);
    lines.push('');
    lines.push('Live details:');

    for (const job of report.running) {
      pushJobDetails(lines, job, { showElapsed: true, showLog: true });
    }

    lines.push('');
  }

  if (report.latestFinished) {
    lines.push('Latest finished:');
    pushJobDetails(lines, report.latestFinished, {
      showDuration: true,
      showLog: report.latestFinished.status === 'failed',
    });

    lines.push('');
  }

  if (report.recent.length > 0) {
    lines.push('Recent jobs:');

    for (const job of report.recent) {
      pushJobDetails(lines, job, {
        showDuration: true,
        showLog: job.status === 'failed',
      });
    }

    lines.push('');
  } else if (report.running.length === 0 && !report.latestFinished) {
    lines.push('No jobs recorded yet.', '');
  }

  if (report.needsReview) {
    lines.push('The stop-time review gate is enabled.');
    lines.push(
      'Ending the session will trigger a fresh Antigravity adversarial review and block if it finds issues.',
    );
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderJobStatusReport(job: EnrichedJob): string {
  const isActive = job.status === 'queued' || job.status === 'running';
  const lines = ['# Antigravity Job Status', ''];

  pushJobDetails(lines, job, {
    showElapsed: isActive,
    showDuration: !isActive,
    showLog: true,
    showCancelHint: true,
    showResultHint: true,
    showReviewHint: true,
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

function withConversationFooter(
  output: string,
  conversationId: string | null,
): string {
  const body = output.endsWith('\n') ? output : `${output}\n`;

  if (!conversationId) {
    return body;
  }

  return `${body}\nAntigravity conversation ID: ${conversationId}\nResume in Antigravity: ${formatResumeCommand(conversationId)}\n`;
}

export function renderStoredJobResult(
  job: Job,
  storedJob: StoredJob | null,
): string {
  const conversationId =
    storedJob?.conversationId ?? job.conversationId ?? null;

  if (isStructuredReviewStoredResult(storedJob) && storedJob?.rendered) {
    return withConversationFooter(storedJob.rendered, conversationId);
  }

  const result = isObject(storedJob?.result) ? storedJob.result : {};
  const antigravity = isObject(result.antigravity) ? result.antigravity : {};

  const rawOutput =
    (typeof result.rawOutput === 'string' && result.rawOutput) ||
    (typeof antigravity.stdout === 'string' && antigravity.stdout) ||
    '';

  if (storedJob?.rendered) {
    return withConversationFooter(storedJob.rendered, conversationId);
  }

  if (rawOutput) {
    return withConversationFooter(rawOutput, conversationId);
  }

  const lines = [
    `# ${job.title ?? 'Antigravity Result'}`,
    '',
    `Job: ${job.id}`,
    `Status: ${job.status}`,
  ];

  if (conversationId) {
    lines.push(`Antigravity conversation ID: ${conversationId}`);
    lines.push(`Resume in Antigravity: ${formatResumeCommand(conversationId)}`);
  }

  if (job.summary) {
    lines.push(`Summary: ${job.summary}`);
  }

  if (job.errorMessage) {
    lines.push('', job.errorMessage);
  } else if (storedJob?.errorMessage) {
    lines.push('', storedJob.errorMessage);
  } else {
    lines.push('', 'No captured result payload was stored for this job.');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderCancelReport(job: Job): string {
  const lines = ['# Antigravity Cancel', '', `Cancelled ${job.id}.`, ''];

  if (job.title) {
    lines.push(`- Title: ${job.title}`);
  }

  if (job.summary) {
    lines.push(`- Summary: ${job.summary}`);
  }

  lines.push('- Check `/antigravity:status` for the updated queue.');

  return `${lines.join('\n').trimEnd()}\n`;
}
