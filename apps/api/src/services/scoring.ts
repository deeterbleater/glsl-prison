import type { JudgeScore, ShaderStats } from '@shader-oracle/shared';

export function clampScore(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 5;
  return Math.max(1, Math.min(10, Math.round(numeric)));
}

export function normalizeJudgeScore(raw: Partial<JudgeScore>): JudgeScore {
  return {
    overall: clampScore(raw.overall),
    promptFit: clampScore(raw.promptFit),
    visualClarity: clampScore(raw.visualClarity),
    shaderIdiom: clampScore(raw.shaderIdiom),
    originality: clampScore(raw.originality),
    technicalQuality: clampScore(raw.technicalQuality),
  };
}

export function localScoreFromStats(stats?: ShaderStats): JudgeScore {
  if (!stats) {
    return {
      overall: 5,
      promptFit: 5,
      visualClarity: 5,
      shaderIdiom: 6,
      originality: 5,
      technicalQuality: 5,
    };
  }

  const contrast = Math.min(10, Math.max(1, Math.round(3 + stats.variance * 18)));
  const motion = Math.min(10, Math.max(1, Math.round(4 + stats.temporalDelta * 12)));
  const technicalQuality = stats.frameTimeMs < 16 ? 8 : stats.frameTimeMs < 33 ? 6 : 4;
  const visualClarity = Math.round((contrast + technicalQuality) / 2);

  return {
    overall: Math.round((visualClarity + motion + technicalQuality) / 3),
    promptFit: 6,
    visualClarity,
    shaderIdiom: 7,
    originality: motion,
    technicalQuality,
  };
}
