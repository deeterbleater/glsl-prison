import type {
  CompileResultRequest,
  GenerateResponse,
  OpenRouterModelDto,
  ReasoningEffort,
  RunDto,
} from '@shader-oracle/shared';
import {
  AlertTriangle,
  Code2,
  Copy,
  ExternalLink,
  GitFork,
  LoaderCircle,
  Send,
  Share2,
  Sparkles,
} from 'lucide-react';
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ShaderCanvas, type CompileSnapshot } from './components/ShaderCanvas';
import {
  generateShader,
  getModels,
  getRun,
  publishRun,
  repairShader,
  reportCompileResult,
} from './lib/api';

const CHAR_LIMIT = 8000;
const MAX_REPAIR_ATTEMPTS = 3;
const DEFAULT_MODEL = 'openai/gpt-5.2';

const FEATURED_MODEL_FALLBACKS: OpenRouterModelDto[] = [
  { id: 'openai/gpt-5.2', name: 'OpenAI: GPT-5.2', outputModalities: ['text'] },
  { id: 'openai/gpt-5.2-chat', name: 'OpenAI: GPT-5.2 Chat', outputModalities: ['text'] },
  { id: 'openai/gpt-5.2-codex', name: 'OpenAI: GPT-5.2-Codex', outputModalities: ['text'] },
  {
    id: 'anthropic/claude-sonnet-4.6',
    name: 'Anthropic: Claude Sonnet 4.6',
    outputModalities: ['text'],
  },
  {
    id: 'anthropic/claude-opus-4.8',
    name: 'Anthropic: Claude Opus 4.8',
    outputModalities: ['text'],
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Google: Gemini 3.1 Pro',
    outputModalities: ['text'],
  },
  {
    id: 'z-ai/glm-5.2',
    name: 'Z.ai: GLM 5.2',
    outputModalities: ['text'],
    reasoning: { supportedEfforts: ['xhigh', 'high'] },
  },
  { id: 'minimax/minimax-m3', name: 'MiniMax: MiniMax M3', outputModalities: ['text'] },
  {
    id: 'minimax/minimax-m2.7',
    name: 'MiniMax: MiniMax M2.7',
    outputModalities: ['text'],
    reasoning: { mandatory: true },
  },
  { id: 'x-ai/grok-4.3', name: 'xAI: Grok 4.3', outputModalities: ['text'] },
  { id: 'qwen/qwen3-coder-next', name: 'Qwen: Qwen3 Coder Next', outputModalities: ['text'] },
  {
    id: 'moonshotai/kimi-k2.7-code',
    name: 'MoonshotAI: Kimi K2.7 Code',
    outputModalities: ['text'],
  },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek: DeepSeek V4 Pro', outputModalities: ['text'] },
  { id: 'openrouter/fusion', name: 'OpenRouter: Fusion', outputModalities: ['text'] },
  {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere: North Mini Code (free)',
    outputModalities: ['text'],
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'NVIDIA: Nemotron 3 Ultra (free)',
    outputModalities: ['text'],
  },
];

const FEATURED_MODEL_IDS = FEATURED_MODEL_FALLBACKS.map((model) => model.id);
const EMPTY_STATS = {
  width: 0,
  height: 0,
  frameTimeMs: 0,
  meanLuminance: 0,
  variance: 0,
  temporalDelta: 0,
};

const PROMPT_EXAMPLES = [
  'A tiny moon reflecting across dark water.',
  'Explain gradient descent as a moving landscape.',
  'A neon circuit board dreaming in pulses.',
  'Show packet loss as a storm over a city grid.',
];

type AppMode = 'home' | 'share';

type UserMessage = {
  id: string;
  role: 'user';
  content: string;
};

type AssistantMessage = {
  id: string;
  role: 'assistant';
  status: 'generating' | 'compiling' | 'repairing' | 'ready' | 'failed';
  prompt: string;
  fragment?: string;
  runId?: string;
  attemptId?: string;
  model?: string;
  modelName?: string;
  compileLog?: string;
  generationFailureCount?: number;
  generationFailureLimit?: number;
  shareUrl?: string;
};

type ChatMessage = UserMessage | AssistantMessage;

type PendingCompile = {
  messageId: string;
  prompt: string;
  runId: string;
  attemptId: string;
  fragment: string;
  model: string;
  modelName?: string;
  reasoningEffort: ReasoningEffort;
  repairCount: number;
};

function currentRoute(): { mode: AppMode; runId?: string } {
  const match = window.location.pathname.match(/^\/r\/([^/]+)/);
  return match?.[1] ? { mode: 'share', runId: match[1] } : { mode: 'home' };
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function latestAttempt(run?: RunDto) {
  if (!run || run.attempts.length === 0) return undefined;
  return run.attempts[run.attempts.length - 1];
}

function modelDisplayLabel(modelId: string | undefined, models: OpenRouterModelDto[]): string {
  if (!modelId) return 'shader model';
  const model = models.find((item) => item.id === modelId);
  if (!model?.name || model.name === modelId) return modelId;
  return `${model.name} (${modelId})`;
}

function modelPriceLabel(model?: OpenRouterModelDto): string | undefined {
  if (!model?.pricing?.prompt || !model.pricing.completion) return undefined;
  const promptPrice = Number(model.pricing.prompt) * 1_000_000;
  const completionPrice = Number(model.pricing.completion) * 1_000_000;
  if (!Number.isFinite(promptPrice) || !Number.isFinite(completionPrice)) return undefined;
  if (promptPrice === 0 && completionPrice === 0) return 'free';
  return `$${promptPrice.toFixed(2)} / $${completionPrice.toFixed(2)} per 1M`;
}

function modelShortLabel(model: OpenRouterModelDto): string {
  return model.name
    .replace(
      /^(OpenAI|Anthropic|Google|xAI|Qwen|MoonshotAI|DeepSeek|Z\.ai|MiniMax|OpenRouter|Cohere|NVIDIA):?\s*/i,
      '',
    )
    .replace(/\s*\((free|Fast)\)$/i, ' $1')
    .replace('Preview', '')
    .trim();
}

function mergeModels(primary: OpenRouterModelDto[], fallback: OpenRouterModelDto[]) {
  const byId = new Map<string, OpenRouterModelDto>();
  for (const model of [...fallback, ...primary]) byId.set(model.id, model);
  return [...byId.values()];
}

function reasoningOptions(model?: OpenRouterModelDto): ReasoningEffort[] {
  const options: ReasoningEffort[] = ['auto'];
  if (!model?.reasoning?.mandatory) options.push('none');

  for (const effort of model?.reasoning?.supportedEfforts ?? []) {
    if (!options.includes(effort)) options.push(effort);
  }

  return options;
}

function reasoningLabel(effort: ReasoningEffort): string {
  if (effort === 'none') return 'Off';
  return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

function generationFailureLabel(message: AssistantMessage): string {
  const limit = message.generationFailureLimit ?? MAX_REPAIR_ATTEMPTS;
  if (!message.generationFailureCount) return 'Generation failed.';
  return `Generation failure: ${Math.min(message.generationFailureCount, limit)}/${limit}`;
}

function generationFailureDetail(message: AssistantMessage): string {
  const detail = message.compileLog?.trim();
  if (!detail) return 'No compiler log returned.';
  if (message.generationFailureCount && /internal server error/i.test(detail)) {
    return 'The model did not return a compilable shader on this attempt.';
  }
  return detail;
}

function setAssistantMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  messageId: string,
  update: Partial<AssistantMessage>,
) {
  setMessages((messages) =>
    messages.map((message) =>
      message.id === messageId && message.role === 'assistant'
        ? { ...message, ...update }
        : message,
    ),
  );
}

function ModelSelector(props: {
  value: string;
  onChange: (value: string) => void;
  models: OpenRouterModelDto[];
  featuredModelIds: string[];
  compact?: boolean;
}) {
  const datalistId = props.compact ? 'openrouter-models-compact' : 'openrouter-models';
  const catalogId = `${datalistId}-catalog`;
  const selectedModel = props.models.find((model) => model.id === props.value);
  const selectedCatalogValue = selectedModel ? props.value : '';
  const price = modelPriceLabel(selectedModel);
  const featuredModels = props.featuredModelIds
    .map((id) => props.models.find((model) => model.id === id))
    .filter((model): model is OpenRouterModelDto => Boolean(model))
    .slice(0, props.compact ? 8 : 16);

  return (
    <div className={props.compact ? 'modelSelector compact' : 'modelSelector'}>
      <div className="modelInputRow">
        <label htmlFor={datalistId}>Model</label>
        <input
          id={datalistId}
          list={`${datalistId}-options`}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          spellCheck={false}
          placeholder="openai/gpt-5.2"
        />
        <datalist id={`${datalistId}-options`}>
          {props.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </datalist>
        {price ? <span>{price}</span> : null}
      </div>
      <div className="modelCatalogRow">
        <label htmlFor={catalogId}>Catalog</label>
        <select
          id={catalogId}
          value={selectedCatalogValue}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {!selectedModel ? <option value="">typed model: {props.value}</option> : null}
          {props.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name} - {model.id}
            </option>
          ))}
        </select>
        <span>{props.models.length} models</span>
      </div>
      <div className="modelChips">
        {featuredModels.map((model) => (
          <button
            key={model.id}
            type="button"
            className={model.id === props.value ? 'selected' : undefined}
            title={model.id}
            onClick={() => props.onChange(model.id)}
          >
            {modelShortLabel(model)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReasoningSelector(props: {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  model?: OpenRouterModelDto;
}) {
  const options = reasoningOptions(props.model);

  return (
    <div className="reasoningSelector">
      <label htmlFor="reasoning-effort">Reasoning</label>
      <select
        id="reasoning-effort"
        value={options.includes(props.value) ? props.value : 'auto'}
        onChange={(event) => props.onChange(event.target.value as ReasoningEffort)}
      >
        {options.map((effort) => (
          <option key={effort} value={effort}>
            {reasoningLabel(effort)}
          </option>
        ))}
      </select>
      {props.model?.reasoning?.mandatory ? <span>required</span> : null}
    </div>
  );
}

function ChatComposer(props: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  selectedModel: string;
  onModelChange: (value: string) => void;
  models: OpenRouterModelDto[];
  featuredModelIds: string[];
  reasoningEffort: ReasoningEffort;
  onReasoningChange: (value: ReasoningEffort) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSubmit();
  }

  return (
    <form className={props.compact ? 'composer compact' : 'composer'} onSubmit={submit}>
      <ModelSelector
        value={props.selectedModel}
        onChange={props.onModelChange}
        models={props.models}
        featuredModelIds={props.featuredModelIds}
        compact={props.compact}
      />
      <ReasoningSelector
        value={props.reasoningEffort}
        onChange={props.onReasoningChange}
        model={props.models.find((model) => model.id === props.selectedModel)}
      />
      <div className="composerInput">
        <textarea
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder="Ask for a shader..."
          rows={props.compact ? 2 : 4}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              props.onSubmit();
            }
          }}
        />
        <button
          type="submit"
          aria-label="Send prompt"
          disabled={props.disabled || !props.value.trim()}
        >
          {props.disabled ? <LoaderCircle size={19} className="spin" /> : <Send size={19} />}
        </button>
      </div>
    </form>
  );
}

function AssistantShaderMessage({
  message,
  onCopy,
  onPublish,
}: {
  message: AssistantMessage;
  onCopy: (fragment: string) => void;
  onPublish: (messageId: string, runId: string) => void;
}) {
  const modelLabel = message.modelName || message.model || 'compiled shader';

  if (message.status === 'ready' && message.fragment) {
    return (
      <article className="message assistant shaderMessage">
        <div className="shaderBubble">
          <div className="shaderMeta">
            <span className="shaderModel" title={message.model}>
              {modelLabel}
            </span>
            <div className="shaderActions">
              <button
                type="button"
                aria-label="Copy shader"
                onClick={() => onCopy(message.fragment ?? '')}
              >
                <Copy size={16} />
              </button>
              {message.runId ? (
                <button
                  type="button"
                  aria-label="Publish shader"
                  onClick={() => onPublish(message.id, message.runId ?? '')}
                >
                  <Share2 size={16} />
                </button>
              ) : null}
              {message.shareUrl ? (
                <a aria-label="Open share page" href={message.shareUrl}>
                  <ExternalLink size={16} />
                </a>
              ) : null}
            </div>
          </div>
          <ShaderCanvas fragment={message.fragment} />
          <details className="sourceDetails">
            <summary>
              <Code2 size={15} />
              GLSL source
            </summary>
            <pre>{message.fragment}</pre>
          </details>
        </div>
      </article>
    );
  }

  if (message.status === 'failed') {
    return (
      <article className="message assistant">
        <div className="statusBubble failed">
          <AlertTriangle size={18} />
          <div>
            <strong>{generationFailureLabel(message)}</strong>
            <pre>{generationFailureDetail(message)}</pre>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="message assistant">
      <div className="statusBubble">
        <LoaderCircle size={18} className="spin" />
        <span>
          {message.status === 'repairing' && message.generationFailureCount
            ? `${generationFailureLabel(message)}. Retrying shader`
            : message.status === 'repairing'
              ? 'repairing shader'
              : message.status === 'compiling'
                ? 'compiling shader'
                : 'asking the shader model'}
        </span>
      </div>
    </article>
  );
}

function HomePage() {
  const processedAttempts = useRef(new Set<string>());
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingCompile, setPendingCompile] = useState<PendingCompile>();
  const [models, setModels] = useState<OpenRouterModelDto[]>(FEATURED_MODEL_FALLBACKS);
  const [featuredModelIds, setFeaturedModelIds] = useState(FEATURED_MODEL_IDS);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const hasChatStarted = messages.length > 0;

  useEffect(() => {
    const forked = window.localStorage.getItem('shader-oracle-fork');
    if (!forked) return;
    window.localStorage.removeItem('shader-oracle-fork');
    try {
      const parsed = JSON.parse(forked) as { prompt?: string; fragment?: string; model?: string };
      if (!parsed.prompt || !parsed.fragment) return;
      if (parsed.model) setSelectedModel(parsed.model);
      setMessages([
        { id: makeId('usr'), role: 'user', content: parsed.prompt },
        {
          id: makeId('ast'),
          role: 'assistant',
          status: 'ready',
          prompt: parsed.prompt,
          fragment: parsed.fragment,
          model: parsed.model,
          modelName: parsed.model,
        },
      ]);
    } catch {
      setError('Unable to load forked shader.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    getModels()
      .then((response) => {
        if (cancelled) return;
        setModels(mergeModels(response.models, FEATURED_MODEL_FALLBACKS));
        setFeaturedModelIds(
          response.featuredModelIds?.length ? response.featuredModelIds : FEATURED_MODEL_IDS,
        );
        setSelectedModel((current) => current.trim() || response.defaultModel || DEFAULT_MODEL);
      })
      .catch(() => {
        if (cancelled) return;
        setModels(FEATURED_MODEL_FALLBACKS);
        setFeaturedModelIds(FEATURED_MODEL_IDS);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, pendingCompile]);

  useEffect(() => {
    const model = models.find((item) => item.id === selectedModel);
    if (model?.reasoning?.mandatory && reasoningEffort === 'none') {
      setReasoningEffort('auto');
    }
  }, [models, reasoningEffort, selectedModel]);

  const handleCompilerResult = useCallback(
    async (snapshot: CompileSnapshot) => {
      if (!pendingCompile || processedAttempts.current.has(pendingCompile.attemptId)) return;
      processedAttempts.current.add(pendingCompile.attemptId);

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

      await reportCompileResult(pendingCompile.attemptId, payload).catch((reportError: unknown) => {
        setError(
          reportError instanceof Error ? reportError.message : 'Unable to report compile result.',
        );
      });

      if (snapshot.ok) {
        setAssistantMessage(setMessages, pendingCompile.messageId, {
          status: 'ready',
          runId: pendingCompile.runId,
          attemptId: pendingCompile.attemptId,
          fragment: pendingCompile.fragment,
          model: pendingCompile.model,
          modelName: pendingCompile.modelName,
          compileLog: '',
          generationFailureCount: undefined,
          generationFailureLimit: undefined,
        });
        setPendingCompile(undefined);
        return;
      }

      const generationFailureCount = pendingCompile.repairCount + 1;
      const generationFailureLimit = MAX_REPAIR_ATTEMPTS;

      if (generationFailureCount >= generationFailureLimit) {
        setAssistantMessage(setMessages, pendingCompile.messageId, {
          status: 'failed',
          runId: pendingCompile.runId,
          attemptId: pendingCompile.attemptId,
          fragment: pendingCompile.fragment,
          model: pendingCompile.model,
          modelName: pendingCompile.modelName,
          compileLog: snapshot.log,
          generationFailureCount,
          generationFailureLimit,
        });
        setPendingCompile(undefined);
        return;
      }

      setAssistantMessage(setMessages, pendingCompile.messageId, {
        status: 'repairing',
        compileLog: snapshot.log,
        generationFailureCount,
        generationFailureLimit,
      });
      try {
        const repaired = await repairShader(pendingCompile.attemptId, {
          compileLog: snapshot.log,
          fragment: pendingCompile.fragment,
          reasoningEffort: pendingCompile.reasoningEffort,
        });
        setPendingCompile({
          messageId: pendingCompile.messageId,
          prompt: pendingCompile.prompt,
          runId: repaired.runId,
          attemptId: repaired.attemptId,
          fragment: repaired.fragment,
          model: repaired.model || pendingCompile.model,
          modelName: modelDisplayLabel(repaired.model || pendingCompile.model, models),
          reasoningEffort: pendingCompile.reasoningEffort,
          repairCount: generationFailureCount,
        });
      } catch {
        setAssistantMessage(setMessages, pendingCompile.messageId, {
          status: 'failed',
          compileLog:
            snapshot.log || 'The model did not return a compilable shader on this attempt.',
          generationFailureCount,
          generationFailureLimit,
        });
        setPendingCompile(undefined);
      }
    },
    [models, pendingCompile],
  );

  async function sendPrompt(promptOverride?: string) {
    const prompt = (promptOverride ?? input).trim();
    if (!prompt || busy) return;
    const model = selectedModel.trim() || DEFAULT_MODEL;
    const modelName = modelDisplayLabel(model, models);

    const userId = makeId('usr');
    const assistantId = makeId('ast');
    setInput('');
    setError(undefined);
    setBusy(true);
    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', content: prompt },
      { id: assistantId, role: 'assistant', status: 'generating', prompt, model, modelName },
    ]);

    try {
      const response: GenerateResponse = await generateShader({
        prompt,
        mode: 'fragment',
        model,
        constraints: {
          charLimit: CHAR_LIMIT,
          allowRepair: true,
          maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
          reasoningEffort,
        },
      });

      setAssistantMessage(setMessages, assistantId, {
        status: 'compiling',
        runId: response.runId,
        attemptId: response.attemptId,
        model: response.model,
        modelName: modelDisplayLabel(response.model, models),
      });
      setPendingCompile({
        messageId: assistantId,
        prompt,
        runId: response.runId,
        attemptId: response.attemptId,
        fragment: response.fragment,
        model: response.model,
        modelName: modelDisplayLabel(response.model, models),
        reasoningEffort,
        repairCount: 0,
      });
    } catch (generateError) {
      setAssistantMessage(setMessages, assistantId, {
        status: 'failed',
        compileLog:
          generateError instanceof Error ? generateError.message : 'Unable to generate shader.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyShader(fragment: string) {
    await navigator.clipboard.writeText(fragment);
  }

  async function publishMessage(messageId: string, runId: string) {
    try {
      const response = await publishRun(runId, true);
      setAssistantMessage(setMessages, messageId, { shareUrl: response.shareUrl });
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Unable to publish shader.');
    }
  }

  return (
    <main className={hasChatStarted ? 'chatApp active' : 'chatApp'}>
      <header className="chatHeader">
        <a href="/" className="brandMark">
          glsl.chat
        </a>
        <span>shader-only model output</span>
      </header>

      {!hasChatStarted ? (
        <section className="landingChat">
          <div className="landingTitle">
            <Sparkles size={26} />
            <h1>What should the shader say?</h1>
          </div>
          <ChatComposer
            value={input}
            onChange={setInput}
            onSubmit={() => void sendPrompt()}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            models={models}
            featuredModelIds={featuredModelIds}
            reasoningEffort={reasoningEffort}
            onReasoningChange={setReasoningEffort}
            disabled={busy}
          />
          <div className="promptChips">
            {PROMPT_EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => void sendPrompt(example)}>
                {example}
              </button>
            ))}
          </div>
          {error ? <div className="errorBanner">{error}</div> : null}
        </section>
      ) : (
        <section className="chatShell">
          <div className="transcript" ref={transcriptRef}>
            {messages.map((message) =>
              message.role === 'user' ? (
                <article className="message user" key={message.id}>
                  <div className="textBubble">{message.content}</div>
                </article>
              ) : (
                <AssistantShaderMessage
                  key={message.id}
                  message={message}
                  onCopy={(fragment) => void copyShader(fragment)}
                  onPublish={(messageId, runId) => void publishMessage(messageId, runId)}
                />
              ),
            )}
          </div>
          {error ? <div className="errorBanner">{error}</div> : null}
          <div className="composerDock">
            <ChatComposer
              compact
              value={input}
              onChange={setInput}
              onSubmit={() => void sendPrompt()}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              models={models}
              featuredModelIds={featuredModelIds}
              reasoningEffort={reasoningEffort}
              onReasoningChange={setReasoningEffort}
              disabled={busy || Boolean(pendingCompile)}
            />
          </div>
        </section>
      )}

      {pendingCompile ? (
        <div className="compilerStage" aria-hidden="true">
          <ShaderCanvas fragment={pendingCompile.fragment} onCompile={handleCompilerResult} />
        </div>
      ) : null}
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

  const attempt = useMemo(() => latestAttempt(run), [run]);

  if (error)
    return (
      <main className="chatApp active">
        <div className="errorBanner">{error}</div>
      </main>
    );
  if (!run || !attempt)
    return (
      <main className="chatApp active">
        <p className="loading">Loading shader...</p>
      </main>
    );

  return (
    <main className="chatApp active">
      <header className="chatHeader">
        <a href="/" className="brandMark">
          glsl.chat
        </a>
        <button
          type="button"
          className="forkButton"
          onClick={() => {
            window.localStorage.setItem(
              'shader-oracle-fork',
              JSON.stringify({
                prompt: run.prompt,
                fragment: attempt.fragment,
                model: attempt.model,
              }),
            );
            window.location.href = '/';
          }}
        >
          <GitFork size={16} />
          Fork
        </button>
      </header>

      <section className="shareTranscript">
        <article className="message user">
          <div className="textBubble">{run.prompt}</div>
        </article>
        <article className="message assistant shaderMessage">
          <div className="shaderBubble">
            <div className="shaderMeta">
              <span className="shaderModel" title={attempt.model}>
                {attempt.model || 'shared shader'}
              </span>
            </div>
            <ShaderCanvas fragment={attempt.fragment} />
            <details className="sourceDetails">
              <summary>
                <Code2 size={15} />
                GLSL source
              </summary>
              <pre>{attempt.fragment}</pre>
            </details>
          </div>
        </article>
      </section>
    </main>
  );
}

export default function App() {
  const route = currentRoute();
  return route.mode === 'share' && route.runId ? <SharePage runId={route.runId} /> : <HomePage />;
}
