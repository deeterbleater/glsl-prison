export type ShaderMode = 'body';

export type ShaderLengthMode = 'classic' | 'tweet' | 'cruelty';

export const SHADER_LENGTH_LIMITS: Record<ShaderLengthMode, number> = {
  classic: 4000,
  tweet: 280,
  cruelty: 180,
};
