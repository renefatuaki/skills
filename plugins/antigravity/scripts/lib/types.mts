// Types shared by the companion scripts.

/** The lifecycle of a tracked job, from the queue to one of the three ends. */
export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** A review job runs the review prompts, a task job runs a free prompt. */
export type JobClass = 'task' | 'review';

/** What a background worker needs to run a task again from the job file. */
export type TaskRequest = {
  cwd: string;
  model: string | null;
  effort: string | null;
  prompt: string;
  write: boolean;
  resumeLast: boolean;
  timeoutMinutes: number | null;
  jobId: string | null;
};

/** A job record of state.json, which every field except the id may lack until the job reaches it. */
export type Job = {
  id: string;
  status?: JobStatus;
  kind?: string;
  kindLabel?: string;
  title?: string;
  summary?: string;
  jobClass?: JobClass;
  workspaceRoot?: string;
  write?: boolean;
  sessionId?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  phase?: string;
  pid?: number | null;
  agyPid?: number | null;
  conversationId?: string | null;
  logFile?: string | null;
  errorMessage?: string;
  request?: TaskRequest;
};

/** The job file of a finished job, which adds the payload and the rendered text to the record. */
export type StoredJob = Job & {
  result?: unknown;
  rendered?: string;
};

/** A job with the fields the status report derives from the log and the clock. */
export type EnrichedJob = Job & {
  progressPreview: string[];
  elapsed: string | null;
  duration: string | null;
};

/** The persisted companion state of one workspace. */
export type State = {
  version: number;
  config: { stopReviewGate: boolean };
  jobs: Job[];
};

/** A step of a run, which the reporter writes to stderr and the log and the updater stores on the job. */
export type ProgressEvent = {
  message?: string;
  phase?: string;
  conversationId?: string;
  stderrMessage?: string;
  logTitle?: string;
  logBody?: string;
};

/** The callback a run reports its steps to. */
export type ProgressReporter = (event: ProgressEvent | string) => void;

/** What a runner hands back to the tracker after one job. */
export type Execution = {
  exitStatus: number;
  conversationId: string | null;
  payload: unknown;
  rendered: string;
  summary: string;
};

/** A checked binary, with the first line of its version or the reason it is not usable. */
export type BinaryStatus = {
  available: boolean;
  detail: string;
};
