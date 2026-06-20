import type {
  CaptureRequest,
  CompileResultRequest,
  GenerateRequest,
  GenerateResponse,
  JudgeRequest,
  JudgeResponse,
  ModelsResponse,
  PublishResponse,
  RepairRequest,
  RunResponse,
} from '@shader-oracle/shared';

function defaultApiBaseUrl(): string {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:8080';
  }

  return 'https://api.ufotoken.app';
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || defaultApiBaseUrl()).replace(/\/$/, '');

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `API request failed: ${response.status}`);
  return payload;
}

export function generateShader(request: GenerateRequest): Promise<GenerateResponse> {
  return apiRequest('/generate', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function getModels(): Promise<ModelsResponse> {
  return apiRequest('/models');
}

export function reportCompileResult(
  attemptId: string,
  request: CompileResultRequest,
): Promise<{ ok: true }> {
  return apiRequest(`/attempts/${attemptId}/compile-result`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function repairShader(attemptId: string, request: RepairRequest): Promise<GenerateResponse> {
  return apiRequest(`/attempts/${attemptId}/repair`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function uploadCapture(attemptId: string, request: CaptureRequest): Promise<{ ok: true }> {
  return apiRequest(`/attempts/${attemptId}/capture`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function judgeAttempt(attemptId: string, request: JudgeRequest): Promise<JudgeResponse> {
  return apiRequest(`/attempts/${attemptId}/judge`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function getRun(runId: string): Promise<RunResponse> {
  return apiRequest(`/runs/${runId}`);
}

export function publishRun(runId: string, isPublic: boolean): Promise<PublishResponse> {
  return apiRequest(`/runs/${runId}/publish`, {
    method: 'POST',
    body: JSON.stringify({ public: isPublic }),
  });
}
