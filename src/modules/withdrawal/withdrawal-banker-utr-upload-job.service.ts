import { Queue, Worker, type JobsOptions } from "bullmq";
import { Types } from "mongoose";
import { env } from "../../config/env";
import { getRedisQueueClient } from "../../shared/cache/redis";
import { AppError } from "../../shared/errors/AppError";
import { logger } from "../../shared/logger";
import { createAuditLog } from "../audit/audit.service";
import { commitBankerUtrUploadRows } from "./withdrawal-banker-utr-upload.service";
import {
  closeWithdrawalBankerUtrUploadEventStream,
  emitWithdrawalBankerUtrUploadEvent,
} from "./withdrawal-banker-utr-upload-events";
import {
  WithdrawalBankerUtrUploadJobModel,
  type WithdrawalBankerUtrUploadJobDocument,
  type WithdrawalBankerUtrUploadJobErrorItem,
  type WithdrawalBankerUtrUploadJobInputRow,
} from "./withdrawal-banker-utr-upload-job.model";

const QUEUE_NAME = "withdrawal-banker-utr-upload-jobs";
const WORKER_ID = `pid-${process.pid}`;
const LOCK_STALE_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_ERROR_SAMPLE = 200;

let fallbackWorkerStarted = false;
let fallbackTimer: NodeJS.Timeout | null = null;
let queue: Queue<{ jobId: string }> | null = null;
let redisWorker: Worker<{ jobId: string }> | null = null;

type JobLean = Pick<
  WithdrawalBankerUtrUploadJobDocument,
  | "_id"
  | "status"
  | "createdBy"
  | "createdAt"
  | "startedAt"
  | "finishedAt"
  | "failureReason"
  | "progress"
  | "errorSample"
  | "errorRows"
>;

export type WithdrawalBankerUtrUploadJobStatusDto = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  failureReason?: string;
  progress: {
    totalRows: number;
    processedRows: number;
    successRows: number;
    failedRows: number;
    skippedRows: number;
  };
  errorSample: WithdrawalBankerUtrUploadJobErrorItem[];
  errorCsvAvailable: boolean;
};

function statusDtoFromLean(job: JobLean | null, errorRowsCount = 0) {
  if (!job) return null;
  return {
    id: job._id.toString(),
    status: job.status,
    createdBy: String(job.createdBy),
    createdAt: new Date(job.createdAt).toISOString(),
    startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : undefined,
    failureReason: job.failureReason,
    progress: {
      totalRows: job.progress.totalRows,
      processedRows: job.progress.processedRows,
      successRows: job.progress.successRows,
      failedRows: job.progress.failedRows,
      skippedRows: job.progress.skippedRows ?? 0,
    },
    errorSample: job.errorSample ?? [],
    errorCsvAvailable: errorRowsCount > 0 || (job.errorRows?.length ?? 0) > 0,
  } satisfies WithdrawalBankerUtrUploadJobStatusDto;
}

function getQueue(): Queue<{ jobId: string }> | null {
  if (!env.redisUrl) return null;
  if (!queue) {
    const connection = getRedisQueueClient();
    if (!connection) return null;
    queue = new Queue<{ jobId: string }>(QUEUE_NAME, { connection });
  }
  return queue;
}

async function enqueueJob(jobId: string): Promise<void> {
  const q = getQueue();
  if (!q) return;
  const opts: JobsOptions = {
    jobId: `withdrawal-banker-utr-upload-${jobId}`,
    removeOnComplete: 1000,
    removeOnFail: 2000,
    attempts: 5,
    backoff: { type: "exponential", delay: 1000 },
  };
  await q.add("process", { jobId }, opts);
}

export async function createWithdrawalBankerUtrUploadJob(input: {
  rows: WithdrawalBankerUtrUploadJobInputRow[];
  actorId: string;
  requestId?: string;
}) {
  const actorOid = new Types.ObjectId(input.actorId);
  const rows = input.rows.filter(
    (r) =>
      Types.ObjectId.isValid(r.withdrawalId) &&
      r.utr.trim().length >= 4 &&
      Types.ObjectId.isValid(r.payoutBankId),
  );
  if (rows.length === 0) {
    throw new AppError("validation_error", "At least one valid row is required", 400);
  }
  if (rows.length > 10_000) {
    throw new AppError("validation_error", "Maximum 10000 rows allowed per job", 400);
  }

  const job = await WithdrawalBankerUtrUploadJobModel.create({
    status: "queued",
    createdBy: actorOid,
    rows,
    progress: {
      totalRows: rows.length,
      processedRows: 0,
      successRows: 0,
      failedRows: 0,
      skippedRows: 0,
    },
  });

  await createAuditLog({
    actorId: input.actorId,
    action: "withdrawal.banker_utr_upload_job.create",
    entity: "withdrawal_banker_utr_upload_job",
    entityId: job._id.toString(),
    newValue: { status: "queued", totalRows: rows.length },
    requestId: input.requestId,
  });

  try {
    await enqueueJob(job._id.toString());
  } catch (error) {
    logger.warn(
      { err: error, jobId: job._id.toString() },
      "Unable to enqueue banker UTR upload in redis queue",
    );
  }

  return { jobId: job._id.toString(), status: job.status };
}

export async function getWithdrawalBankerUtrUploadJobStatus(jobId: string, actorId: string) {
  if (!Types.ObjectId.isValid(jobId)) {
    throw new AppError("validation_error", "Invalid job id", 400);
  }
  const job = await WithdrawalBankerUtrUploadJobModel.findById(jobId).lean();
  if (!job) {
    throw new AppError("not_found", "UTR upload job not found", 404);
  }
  if (String(job.createdBy) !== actorId) {
    throw new AppError("auth_error", "You do not have access to this UTR upload job", 403);
  }
  return statusDtoFromLean(job as unknown as JobLean, job.errorRows?.length ?? 0);
}

export async function getWithdrawalBankerUtrUploadJobErrorCsv(jobId: string, actorId: string) {
  if (!Types.ObjectId.isValid(jobId)) {
    throw new AppError("validation_error", "Invalid job id", 400);
  }
  const job = await WithdrawalBankerUtrUploadJobModel.findById(jobId).lean();
  if (!job) {
    throw new AppError("not_found", "UTR upload job not found", 404);
  }
  if (String(job.createdBy) !== actorId) {
    throw new AppError("auth_error", "You do not have access to this UTR upload job", 403);
  }
  if (!job.errorRows?.length) {
    throw new AppError("not_found", "No row-level errors found for this job", 404);
  }
  const header = "Withdrawal ID,Error";
  const lines = job.errorRows.map((e) => `${JSON.stringify(e.withdrawalId)},${JSON.stringify(e.error)}`);
  return {
    fileName: `withdrawal-banker-utr-upload-errors-${jobId}.csv`,
    csv: `${header}\n${lines.join("\n")}\n`,
  };
}

async function claimQueuedJob(jobId?: string) {
  const staleTime = new Date(Date.now() - LOCK_STALE_MS);
  const now = new Date();
  return WithdrawalBankerUtrUploadJobModel.findOneAndUpdate(
    {
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      status: "queued",
      $or: [{ lock: { $exists: false } }, { "lock.heartbeatAt": { $lt: staleTime } }],
    },
    {
      $set: {
        status: "processing",
        startedAt: now,
        lock: { lockedBy: WORKER_ID, lockedAt: now, heartbeatAt: now },
      },
    },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
}

async function emitCurrentProgress(jobId: string) {
  const fresh = await WithdrawalBankerUtrUploadJobModel.findById(jobId).lean();
  if (!fresh) return;
  emitWithdrawalBankerUtrUploadEvent({
    jobId,
    status: fresh.status,
    totalRows: fresh.progress.totalRows,
    processedRows: fresh.progress.processedRows,
    successRows: fresh.progress.successRows,
    failedRows: fresh.progress.failedRows,
    skippedRows: fresh.progress.skippedRows ?? 0,
    message: fresh.failureReason,
  });
}

async function processSingleJob(jobId: string) {
  const job = await WithdrawalBankerUtrUploadJobModel.findById(jobId);
  if (!job) return;

  try {
    const totalRows = job.rows.length;
    await WithdrawalBankerUtrUploadJobModel.updateOne(
      { _id: job._id },
      {
        $set: {
          "progress.totalRows": totalRows,
          "progress.processedRows": 0,
          "progress.successRows": 0,
          "progress.failedRows": 0,
          "progress.skippedRows": 0,
        },
      },
    );
    await emitCurrentProgress(jobId);

    const result = await commitBankerUtrUploadRows(job.rows, job.createdBy.toString(), undefined, {
      onProgress: async (progress) => {
        await WithdrawalBankerUtrUploadJobModel.updateOne(
          { _id: job._id },
          {
            $set: {
              "progress.totalRows": progress.totalRows,
              "progress.processedRows": progress.processedRows,
              "progress.successRows": progress.successRows,
              "progress.failedRows": progress.failedRows,
              "progress.skippedRows": progress.skippedRows,
              "lock.heartbeatAt": new Date(),
            },
          },
        );
        emitWithdrawalBankerUtrUploadEvent({
          jobId,
          status: "processing",
          totalRows: progress.totalRows,
          processedRows: progress.processedRows,
          successRows: progress.successRows,
          failedRows: progress.failedRows,
          skippedRows: progress.skippedRows,
        });
      },
    });

    const isFailed = result.approved === 0 && result.failed.length > 0 && result.skipped === 0;
    await WithdrawalBankerUtrUploadJobModel.updateOne(
      { _id: job._id },
      {
        $set: {
          status: isFailed ? "failed" : "completed",
          finishedAt: new Date(),
          failureReason: isFailed ? "All rows failed during UTR upload settlement" : undefined,
          "progress.totalRows": totalRows,
          "progress.processedRows": totalRows,
          "progress.successRows": result.approved,
          "progress.failedRows": result.failed.length,
          "progress.skippedRows": result.skipped,
          errorRows: result.failed,
          errorSample: result.failed.slice(0, MAX_ERROR_SAMPLE),
          rows: [],
        },
        $unset: { lock: 1 },
      },
    );

    await createAuditLog({
      actorId: job.createdBy.toString(),
      action: isFailed
        ? "withdrawal.banker_utr_upload_job.failed"
        : "withdrawal.banker_utr_upload_job.complete",
      entity: "withdrawal_banker_utr_upload_job",
      entityId: jobId,
      newValue: {
        totalRows,
        approved: result.approved,
        skipped: result.skipped,
        failed: result.failed.length,
      },
    });
    await emitCurrentProgress(jobId);
    closeWithdrawalBankerUtrUploadEventStream(jobId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UTR upload processing failed";
    await WithdrawalBankerUtrUploadJobModel.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "failed",
          finishedAt: new Date(),
          failureReason: message,
          rows: [],
        },
        $unset: { lock: 1 },
      },
    );
    await createAuditLog({
      actorId: job.createdBy.toString(),
      action: "withdrawal.banker_utr_upload_job.failed",
      entity: "withdrawal_banker_utr_upload_job",
      entityId: jobId,
      newValue: { message },
    });
    await emitCurrentProgress(jobId);
    closeWithdrawalBankerUtrUploadEventStream(jobId);
    logger.error({ err, jobId }, "Withdrawal banker UTR upload job failed");
  }
}

async function workerTick() {
  if (env.redisUrl) return;
  const claimed = await claimQueuedJob();
  if (!claimed) return;
  await processSingleJob(claimed._id.toString());
}

export function startWithdrawalBankerUtrUploadWorker() {
  if (env.redisUrl && !redisWorker) {
    const connection = getRedisQueueClient();
    if (connection) {
      redisWorker = new Worker<{ jobId: string }>(
        QUEUE_NAME,
        async (job) => {
          const claimed = await claimQueuedJob(job.data.jobId);
          if (!claimed) return;
          await processSingleJob(claimed._id.toString());
        },
        { connection, concurrency: 2 },
      );
      redisWorker.on("failed", (job, err) => {
        logger.error({ queue: QUEUE_NAME, jobId: job?.id, err }, "Banker UTR upload queue job failed");
      });
    }
  }

  if (fallbackWorkerStarted) return;
  fallbackWorkerStarted = true;
  fallbackTimer = setInterval(() => {
    void workerTick().catch((error) => {
      logger.error({ err: error }, "Banker UTR upload fallback worker tick failed");
    });
  }, POLL_INTERVAL_MS);
  void workerTick().catch((error) => {
    logger.error({ err: error }, "Banker UTR upload fallback worker startup run failed");
  });
}

export async function stopWithdrawalBankerUtrUploadWorker() {
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
  fallbackWorkerStarted = false;
  await redisWorker?.close();
  redisWorker = null;
  await queue?.close();
  queue = null;
}
