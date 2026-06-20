import type {
  AttemptDto,
  CompileResultRequest,
  JudgeResponse,
  RunDto,
  ShaderLengthMode,
} from '@shader-oracle/shared';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  GitFork,
  Play,
  RefreshCw,
  Share2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShaderCanvas,
  type CompileSnapshot,
  type ShaderCanvasHandle,
} from './components/ShaderCanvas';
import {
  generateShader,
  getRun,
  judgeAttempt,
  publishRun,
  repairShader,
  reportCompileResult,
  uploadCapture,
} from './lib/api';
import { SAMPLE_FRAGMENT_BODY } from './lib/shader/boilerplate';

const EMPTY_STATS = {
  width: 0,
  height: 0,
  frameTimeMs: 0,
  meanLuminance: 0,
  variance: 0,
  temporalDelta: 0,
};

const LENGTH_LIMITS: Record<ShaderLengthMode, number> = {
  classic: 4000,
  tweet: 280,
  cruelty: 180,
};

const PROMPT_EXAMPLES = [
  'Explain gradient descent visually.',
  'A solar system teaching orbital resonance.',
  'Show packet loss in a noisy network.',
  'Make recursion feel like a mirror maze.',
];

type AppMode = 'home' | 'share';

function currentRoute(): { mode: AppMode; runId?: string } {
  const match = window.location.pathname.match(/^\/r\/([^/]+)/);
  return match?.[1] ? { mode: 'share', runId: match[1] } : { mode: 'home' };
}

function latestAttempt(run?: RunDto): AttemptDto | undefined {
  if (!run || run.attempts.length === 0) return undefined;
  return run.attempts[run.attempts.length - 1];
}

function statusText(attempt?: AttemptDto): string {
  if (!attempt) return 'Draft';
  if (attempt.status === 'compile_failed') return 'Compile failed';
  if (attempt.status === 'compiled') return 'Compiled';
  if (attempt.status === 'judged') return 'Judged';
  return 'Generated';
}

function IconButton(props: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  tone?: 'primary' | 'plain';
}) {
  return (
    <button
      className={props.tone === 'primary' ? 'iconButton primary' : 'iconButton'}
      type="button"
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

function HomePage() {
  const canvasRef = useRef<ShaderCanvasHandle | null>(null);
  const reportedAttempts = useRef(new Set<string>());
  const [prompt, setPrompt] = useState(PROMPT_EXAMPLES[0] ?? '');
  const [lengthMode, setLengthMode] = useState<ShaderLengthMode>('classic');
  const [fragment, setFragment] = useState(SAMPLE_FRAGMENT_BODY);
  const [run, setRun] = useState<RunDto>();
  const [currentAttemptId, setCurrentAttemptId] = useState<string>();
  const [compile, setCompile] = useState<CompileSnapshot>({ ok: true, log: '' });
  const [judge, setJudge] = useState<JudgeResponse>();
  const [shareUrl, setShareUrl] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const attempt = useMemo(() => latestAttempt(run), [run]);
  const charLimit = LENGTH_LIMITS[lengthMode];

  useEffect(() => {
    const forked = window.localStorage.getItem('shader-oracle-fork');
    if (!forked) return;
    window.localStorage.removeItem('shader-oracle-fork');
    try {
      const parsed = JSON.parse(forked) as { prompt?: string; fragment?: string };
      if (parsed.prompt) setPrompt(parsed.prompt);
      if (parsed.fragment) setFragment(parsed.fragment);
    } catch {
      // Ignore malformed local fork payloads.
    }
  }, []);

  const refreshRun = useCallback(async (runId: string) => {
    setRun(await getRun(runId));
  }, []);

  const handleCompile = useCallback(
    async (snapshot: CompileSnapshot) => {
      setCompile(snapshot);
      if (!currentAttemptId || reportedAttempts.current.has(currentAttemptId)) return;
      reportedAttempts.current.add(currentAttemptId);

      const payload: CompileResultRequest = snapshot.ok
        ? {
            ok: true,
            compileLog: snapshot.log,
            stats: snapshot.stats ?? EMPTY_STATS,
          }
        : {
            ok: false,
            compileLog: snapshot.log,
          };

      try {
        await reportCompileResult(currentAttemptId, payload);
        if (run?.id) await refreshRun(run.id);
      } catch (apiError) {
        setError(apiError instanceof Error ? apiError.message : 'Unable to report compile result');
      }
    },
    [currentAttemptId, refreshRun, run?.id],
  );

  async function act<T>(label: string, action: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(undefined);
    try {
      return await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Unable to ${label}`);
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }

  async function onGenerate() {
    const response = await act('generate', () =>
      generateShader({
        prompt,
        mode: 'body',
        model: 'default',
        constraints: { charLimit, allowRepair: true, maxRepairAttempts: 3 },
      }),
    );
    if (!response) return;
    setCurrentAttemptId(response.attemptId);
    setFragment(response.fragment);
    setJudge(undefined);
    setShareUrl(undefined);
    await refreshRun(response.runId);
  }

  async function onRepair() {
    if (!currentAttemptId) return;
    const response = await act('repair', () =>
      repairShader(currentAttemptId, {
        compileLog: compile.log,
        fragment,
      }),
    );
    if (!response) return;
    setCurrentAttemptId(response.attemptId);
    setFragment(response.fragment);
    setJudge(undefined);
    if (run?.id) await refreshRun(run.id);
  }

  async function onJudge() {
    if (!currentAttemptId || !canvasRef.current) return;
    const frames = await act(
      'capture',
      () => canvasRef.current?.captureFrames() ?? Promise.resolve([]),
    );
    if (!frames || frames.length === 0) return;
    await act('upload capture', () => uploadCapture(currentAttemptId, { frames }));
    const result = await act('judge', () =>
      judgeAttempt(currentAttemptId, { judgeModel: 'default' }),
    );
    if (!result) return;
    setJudge(result);
    if (run?.id) await refreshRun(run.id);
  }

  async function onPublish() {
    if (!run?.id) return;
    const response = await act('publish', () => publishRun(run.id, true));
    if (response) setShareUrl(response.shareUrl);
  }

  return (
    <main className="appFrame">
      <section className="workbench">
        <div className="leftPane">
          <div className="topBar">
            <div>
              <p className="eyebrow">Shader Oracle</p>
              <h1>Prompt in. Fragment shader out.</h1>
            </div>
            <span className={compile.ok ? 'status good' : 'status bad'}>{statusText(attempt)}</span>
          </div>

          <label className="fieldLabel" htmlFor="prompt">
            Prompt
          </label>
          <textarea
            id="prompt"
            className="promptInput"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
          />

          <div className="exampleRow">
            {PROMPT_EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => setPrompt(example)}>
                {example}
              </button>
            ))}
          </div>

          <div className="toolbar">
            <div className="segmented" aria-label="Shader length mode">
              {(['classic', 'tweet', 'cruelty'] as ShaderLengthMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={lengthMode === mode ? 'active' : ''}
                  onClick={() => setLengthMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="toolbarActions">
              <IconButton
                title="Copy shader"
                onClick={() => void navigator.clipboard.writeText(fragment)}
              >
                <Copy size={18} />
              </IconButton>
              <IconButton
                title="Generate shader"
                onClick={() => void onGenerate()}
                disabled={Boolean(busy)}
                tone="primary"
              >
                {busy === 'generate' ? (
                  <RefreshCw size={18} className="spin" />
                ) : (
                  <Sparkles size={18} />
                )}
              </IconButton>
            </div>
          </div>

          <label className="fieldLabel" htmlFor="shader">
            Shader body{' '}
            <span>
              {fragment.length}/{charLimit}
            </span>
          </label>
          <textarea
            id="shader"
            className="shaderEditor"
            spellCheck={false}
            value={fragment}
            maxLength={charLimit}
            onChange={(event) => setFragment(event.target.value)}
          />

          <div className="actionRail">
            <button type="button" onClick={() => void onGenerate()} disabled={Boolean(busy)}>
              <Play size={17} />
              Generate
            </button>
            <button
              type="button"
              onClick={() => void onRepair()}
              disabled={compile.ok || !currentAttemptId || Boolean(busy)}
            >
              <Wand2 size={17} />
              Repair
            </button>
            <button
              type="button"
              onClick={() => void onJudge()}
              disabled={!compile.ok || !currentAttemptId || Boolean(busy)}
            >
              <CheckCircle2 size={17} />
              Judge
            </button>
            <button
              type="button"
              onClick={() => void onPublish()}
              disabled={!run?.id || Boolean(busy)}
            >
              <Share2 size={17} />
              Publish
            </button>
          </div>
        </div>

        <div className="rightPane">
          <ShaderCanvas ref={canvasRef} fragment={fragment} onCompile={handleCompile} />
          <div className="diagnostics">
            <div>
              <h2>Compile Log</h2>
              <pre>{compile.ok ? 'OK' : compile.log}</pre>
            </div>
            <div>
              <h2>Attempt History</h2>
              <div className="attemptList">
                {run?.attempts.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === currentAttemptId ? 'active' : ''}
                    onClick={() => {
                      setCurrentAttemptId(item.id);
                      setFragment(item.fragment);
                    }}
                  >
                    <span>#{item.attemptNumber}</span>
                    <span>{item.status}</span>
                  </button>
                )) ?? <p>No saved attempts yet.</p>}
              </div>
            </div>
            <div>
              <h2>Judge</h2>
              {(judge ?? attempt?.score) ? (
                <div className="scoreGrid">
                  <strong>{judge?.score.overall ?? attempt?.score?.overall ?? '-'}/10</strong>
                  <p>{judge?.critique ?? attempt?.critique}</p>
                </div>
              ) : (
                <p>Compile a shader, capture frames, then judge.</p>
              )}
            </div>
          </div>
          {shareUrl ? (
            <a className="shareLink" href={shareUrl}>
              <ExternalLink size={16} />
              {shareUrl}
            </a>
          ) : null}
          {error ? <div className="errorBanner">{error}</div> : null}
        </div>
      </section>
    </main>
  );
}

function SharePage({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    getRun(runId)
      .then(setRun)
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load run');
      });
  }, [runId]);

  const attempt = latestAttempt(run);

  if (error)
    return (
      <main className="appFrame">
        <div className="errorBanner">{error}</div>
      </main>
    );
  if (!run || !attempt)
    return (
      <main className="appFrame">
        <p className="loading">Loading shader...</p>
      </main>
    );

  return (
    <main className="appFrame shareFrame">
      <section className="shareHeader">
        <div>
          <p className="eyebrow">Shared Shader</p>
          <h1>{run.prompt}</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem(
              'shader-oracle-fork',
              JSON.stringify({ prompt: run.prompt, fragment: attempt.fragment }),
            );
            window.location.href = '/';
          }}
        >
          <GitFork size={17} />
          Fork
        </button>
      </section>

      <section className="shareGrid">
        <ShaderCanvas fragment={attempt.fragment} />
        <div className="sourcePanel">
          <h2>Shader Body</h2>
          <pre>{attempt.fragment}</pre>
          {attempt.score ? (
            <div className="scoreGrid">
              <strong>{attempt.score.overall ?? '-'}/10</strong>
              <p>{attempt.critique}</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const route = currentRoute();
  return route.mode === 'share' && route.runId ? <SharePage runId={route.runId} /> : <HomePage />;
}
