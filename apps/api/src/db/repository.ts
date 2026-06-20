import type {
  AttemptStatus,
  CaptureFrame,
  JudgeScore,
  RunDto,
  ShaderStats,
} from '@shader-oracle/shared';
import type { Env } from '../env.js';
import { makeId } from '../util/ids.js';
import { prisma } from './prisma.js';

type RunRecord = {
  id: string;
  prompt: string;
  mode: 'body';
  model?: string;
  public: boolean;
  createdAt: Date;
  updatedAt: Date;
  attempts: AttemptRecord[];
};

type AttemptRecord = {
  id: string;
  runId: string;
  attemptNumber: number;
  fragment: string;
  mode: 'body';
  model?: string;
  status: AttemptStatus;
  compileOk?: boolean;
  compileLog?: string;
  stats?: ShaderStats;
  score?: Partial<JudgeScore>;
  critique?: string;
  createdAt: Date;
};

type CaptureRecord = {
  id: string;
  attemptId: string;
  t: number;
  dataUrl?: string;
  imageUrl?: string;
  createdAt: Date;
};

export type CreateRunInput = {
  prompt: string;
  fragment: string;
  mode: 'body';
  model: string;
};

export type CreateAttemptInput = {
  runId: string;
  fragment: string;
  mode: 'body';
  model: string;
};

export interface Repository {
  createRunWithAttempt(input: CreateRunInput): Promise<{ run: RunDto; attempt: AttemptRecord }>;
  createAttempt(input: CreateAttemptInput): Promise<AttemptRecord>;
  getRun(runId: string): Promise<RunDto | undefined>;
  getAttempt(attemptId: string): Promise<(AttemptRecord & { run: RunRecord }) | undefined>;
  listCaptures(attemptId: string): Promise<CaptureRecord[]>;
  updateCompileResult(
    attemptId: string,
    result:
      | { ok: true; compileLog: string; stats: ShaderStats }
      | { ok: false; compileLog: string },
  ): Promise<void>;
  addCaptures(attemptId: string, frames: CaptureFrame[]): Promise<void>;
  saveJudgeResult(attemptId: string, score: JudgeScore, critique: string): Promise<void>;
  publishRun(runId: string, isPublic: boolean): Promise<RunDto | undefined>;
}

function toRunDto(run: RunRecord): RunDto {
  return {
    id: run.id,
    prompt: run.prompt,
    mode: run.mode,
    model: run.model,
    public: run.public,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    attempts: run.attempts
      .slice()
      .sort((a, b) => a.attemptNumber - b.attemptNumber)
      .map((attempt) => ({
        id: attempt.id,
        runId: attempt.runId,
        attemptNumber: attempt.attemptNumber,
        fragment: attempt.fragment,
        mode: attempt.mode,
        model: attempt.model,
        status: attempt.status,
        compileOk: attempt.compileOk,
        compileLog: attempt.compileLog,
        stats: attempt.stats,
        score: attempt.score,
        critique: attempt.critique,
        createdAt: attempt.createdAt.toISOString(),
      })),
  };
}

class MemoryRepository implements Repository {
  private runs = new Map<string, RunRecord>();
  private attempts = new Map<string, AttemptRecord>();
  private captures = new Map<string, CaptureRecord[]>();

  async createRunWithAttempt(
    input: CreateRunInput,
  ): Promise<{ run: RunDto; attempt: AttemptRecord }> {
    const now = new Date();
    const run: RunRecord = {
      id: makeId('run'),
      prompt: input.prompt,
      mode: input.mode,
      model: input.model,
      public: false,
      createdAt: now,
      updatedAt: now,
      attempts: [],
    };
    const attempt: AttemptRecord = {
      id: makeId('att'),
      runId: run.id,
      attemptNumber: 1,
      fragment: input.fragment,
      mode: input.mode,
      model: input.model,
      status: 'generated',
      createdAt: now,
    };
    run.attempts.push(attempt);
    this.runs.set(run.id, run);
    this.attempts.set(attempt.id, attempt);
    return { run: toRunDto(run), attempt };
  }

  async createAttempt(input: CreateAttemptInput): Promise<AttemptRecord> {
    const run = this.runs.get(input.runId);
    if (!run) throw new Error('Run not found');
    const attempt: AttemptRecord = {
      id: makeId('att'),
      runId: run.id,
      attemptNumber: run.attempts.length + 1,
      fragment: input.fragment,
      mode: input.mode,
      model: input.model,
      status: 'generated',
      createdAt: new Date(),
    };
    run.attempts.push(attempt);
    run.updatedAt = new Date();
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  async getRun(runId: string): Promise<RunDto | undefined> {
    const run = this.runs.get(runId);
    return run ? toRunDto(run) : undefined;
  }

  async getAttempt(attemptId: string): Promise<(AttemptRecord & { run: RunRecord }) | undefined> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return undefined;
    const run = this.runs.get(attempt.runId);
    return run ? { ...attempt, run } : undefined;
  }

  async listCaptures(attemptId: string): Promise<CaptureRecord[]> {
    return this.captures.get(attemptId) ?? [];
  }

  async updateCompileResult(
    attemptId: string,
    result:
      | { ok: true; compileLog: string; stats: ShaderStats }
      | { ok: false; compileLog: string },
  ): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;
    attempt.compileOk = result.ok;
    attempt.compileLog = result.compileLog;
    attempt.status = result.ok ? 'compiled' : 'compile_failed';
    if (result.ok) attempt.stats = result.stats;
    const run = this.runs.get(attempt.runId);
    if (run) run.updatedAt = new Date();
  }

  async addCaptures(attemptId: string, frames: CaptureFrame[]): Promise<void> {
    const records = frames.map((frame) => ({
      id: makeId('cap'),
      attemptId,
      t: frame.t,
      dataUrl: frame.dataUrl,
      createdAt: new Date(),
    }));
    this.captures.set(attemptId, records);
  }

  async saveJudgeResult(attemptId: string, score: JudgeScore, critique: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;
    attempt.score = score;
    attempt.critique = critique;
    attempt.status = 'judged';
  }

  async publishRun(runId: string, isPublic: boolean): Promise<RunDto | undefined> {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    run.public = isPublic;
    run.updatedAt = new Date();
    return toRunDto(run);
  }
}

class PrismaRepository implements Repository {
  async createRunWithAttempt(
    input: CreateRunInput,
  ): Promise<{ run: RunDto; attempt: AttemptRecord }> {
    const runId = makeId('run');
    const attemptId = makeId('att');
    const run = await prisma.run.create({
      data: {
        id: runId,
        prompt: input.prompt,
        mode: input.mode,
        model: input.model,
        attempts: {
          create: {
            id: attemptId,
            attemptNumber: 1,
            fragment: input.fragment,
            mode: input.mode,
            model: input.model,
            status: 'generated',
          },
        },
      },
      include: { attempts: true },
    });
    const dto = toRunDto({
      ...run,
      mode: 'body',
      model: run.model ?? undefined,
      attempts: run.attempts.map((attempt) => ({
        ...attempt,
        mode: 'body',
        model: attempt.model ?? undefined,
        status: attempt.status as AttemptStatus,
        compileOk: attempt.compileOk ?? undefined,
        compileLog: attempt.compileLog ?? undefined,
        stats: attempt.statsJson as ShaderStats | undefined,
        score: attempt.scoreJson as Partial<JudgeScore> | undefined,
        critique: attempt.critique ?? undefined,
      })),
    });
    const attempt = dto.attempts[0];
    if (!attempt) throw new Error('Attempt creation failed');
    return {
      run: dto,
      attempt: {
        ...attempt,
        createdAt: new Date(attempt.createdAt),
      },
    };
  }

  async createAttempt(input: CreateAttemptInput): Promise<AttemptRecord> {
    const attemptCount = await prisma.attempt.count({ where: { runId: input.runId } });
    const attempt = await prisma.attempt.create({
      data: {
        id: makeId('att'),
        runId: input.runId,
        attemptNumber: attemptCount + 1,
        fragment: input.fragment,
        mode: input.mode,
        model: input.model,
        status: 'generated',
      },
    });
    return {
      id: attempt.id,
      runId: attempt.runId,
      attemptNumber: attempt.attemptNumber,
      fragment: attempt.fragment,
      mode: 'body',
      model: attempt.model ?? undefined,
      status: 'generated',
      createdAt: attempt.createdAt,
    };
  }

  async getRun(runId: string): Promise<RunDto | undefined> {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      include: { attempts: true },
    });
    if (!run) return undefined;
    return toRunDto({
      ...run,
      mode: 'body',
      model: run.model ?? undefined,
      attempts: run.attempts.map((attempt) => ({
        id: attempt.id,
        runId: attempt.runId,
        attemptNumber: attempt.attemptNumber,
        fragment: attempt.fragment,
        mode: 'body',
        model: attempt.model ?? undefined,
        status: attempt.status as AttemptStatus,
        compileOk: attempt.compileOk ?? undefined,
        compileLog: attempt.compileLog ?? undefined,
        stats: attempt.statsJson as ShaderStats | undefined,
        score: attempt.scoreJson as Partial<JudgeScore> | undefined,
        critique: attempt.critique ?? undefined,
        createdAt: attempt.createdAt,
      })),
    });
  }

  async getAttempt(attemptId: string): Promise<(AttemptRecord & { run: RunRecord }) | undefined> {
    const attempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { run: { include: { attempts: true } } },
    });
    if (!attempt) return undefined;
    const run: RunRecord = {
      ...attempt.run,
      mode: 'body',
      model: attempt.run.model ?? undefined,
      attempts: attempt.run.attempts.map((item) => ({
        id: item.id,
        runId: item.runId,
        attemptNumber: item.attemptNumber,
        fragment: item.fragment,
        mode: 'body',
        model: item.model ?? undefined,
        status: item.status as AttemptStatus,
        compileOk: item.compileOk ?? undefined,
        compileLog: item.compileLog ?? undefined,
        stats: item.statsJson as ShaderStats | undefined,
        score: item.scoreJson as Partial<JudgeScore> | undefined,
        critique: item.critique ?? undefined,
        createdAt: item.createdAt,
      })),
    };
    return {
      id: attempt.id,
      runId: attempt.runId,
      attemptNumber: attempt.attemptNumber,
      fragment: attempt.fragment,
      mode: 'body',
      model: attempt.model ?? undefined,
      status: attempt.status as AttemptStatus,
      compileOk: attempt.compileOk ?? undefined,
      compileLog: attempt.compileLog ?? undefined,
      stats: attempt.statsJson as ShaderStats | undefined,
      score: attempt.scoreJson as Partial<JudgeScore> | undefined,
      critique: attempt.critique ?? undefined,
      createdAt: attempt.createdAt,
      run,
    };
  }

  async listCaptures(attemptId: string): Promise<CaptureRecord[]> {
    const captures = await prisma.capture.findMany({ where: { attemptId }, orderBy: { t: 'asc' } });
    return captures.map((capture) => ({
      id: capture.id,
      attemptId: capture.attemptId,
      t: capture.t,
      dataUrl: capture.dataUrl ?? undefined,
      imageUrl: capture.imageUrl ?? undefined,
      createdAt: capture.createdAt,
    }));
  }

  async updateCompileResult(
    attemptId: string,
    result:
      | { ok: true; compileLog: string; stats: ShaderStats }
      | { ok: false; compileLog: string },
  ): Promise<void> {
    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        compileOk: result.ok,
        compileLog: result.compileLog,
        statsJson: result.ok ? result.stats : undefined,
        status: result.ok ? 'compiled' : 'compile_failed',
      },
    });
  }

  async addCaptures(attemptId: string, frames: CaptureFrame[]): Promise<void> {
    await prisma.$transaction([
      prisma.capture.deleteMany({ where: { attemptId } }),
      prisma.capture.createMany({
        data: frames.map((frame) => ({
          id: makeId('cap'),
          attemptId,
          t: frame.t,
          dataUrl: frame.dataUrl,
        })),
      }),
    ]);
  }

  async saveJudgeResult(attemptId: string, score: JudgeScore, critique: string): Promise<void> {
    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        scoreJson: score,
        critique,
        status: 'judged',
      },
    });
  }

  async publishRun(runId: string, isPublic: boolean): Promise<RunDto | undefined> {
    await prisma.run.update({
      where: { id: runId },
      data: { public: isPublic },
    });
    return this.getRun(runId);
  }
}

export function createRepository(env: Env): Repository {
  return env.databaseUrl ? new PrismaRepository() : new MemoryRepository();
}
