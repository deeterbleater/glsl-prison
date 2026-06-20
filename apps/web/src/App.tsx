import type { CompileResultRequest, GenerateResponse, RunDto } from '@shader-oracle/shared';
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
import { generateShader, getRun, publishRun, repairShader, reportCompileResult } from './lib/api';

const CHAR_LIMIT = 4000;
const MAX_REPAIR_ATTEMPTS = 3;

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
  compileLog?: string;
  shareUrl?: string;
};

type ChatMessage = UserMessage | AssistantMessage;

type PendingCompile = {
  messageId: string;
  prompt: string;
  runId: string;
  attemptId: string;
  fragment: string;
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

function ChatComposer(props: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSubmit();
  }

  return (
    <form className={props.compact ? 'composer compact' : 'composer'} onSubmit={submit}>
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
  if (message.status === 'ready' && message.fragment) {
    return (
      <article className="message assistant shaderMessage">
        <div className="shaderBubble">
          <div className="shaderMeta">
            <span>compiled shader</span>
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
              GLSL body
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
            <strong>Shader failed to compile.</strong>
            <pre>{message.compileLog || 'No compiler log returned.'}</pre>
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
          {message.status === 'repairing'
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const hasChatStarted = messages.length > 0;

  useEffect(() => {
    const forked = window.localStorage.getItem('shader-oracle-fork');
    if (!forked) return;
    window.localStorage.removeItem('shader-oracle-fork');
    try {
      const parsed = JSON.parse(forked) as { prompt?: string; fragment?: string };
      if (!parsed.prompt || !parsed.fragment) return;
      setMessages([
        { id: makeId('usr'), role: 'user', content: parsed.prompt },
        {
          id: makeId('ast'),
          role: 'assistant',
          status: 'ready',
          prompt: parsed.prompt,
          fragment: parsed.fragment,
        },
      ]);
    } catch {
      setError('Unable to load forked shader.');
    }
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, pendingCompile]);

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
          compileLog: '',
        });
        setPendingCompile(undefined);
        return;
      }

      if (pendingCompile.repairCount >= MAX_REPAIR_ATTEMPTS) {
        setAssistantMessage(setMessages, pendingCompile.messageId, {
          status: 'failed',
          runId: pendingCompile.runId,
          attemptId: pendingCompile.attemptId,
          fragment: pendingCompile.fragment,
          compileLog: snapshot.log,
        });
        setPendingCompile(undefined);
        return;
      }

      setAssistantMessage(setMessages, pendingCompile.messageId, { status: 'repairing' });
      try {
        const repaired = await repairShader(pendingCompile.attemptId, {
          compileLog: snapshot.log,
          fragment: pendingCompile.fragment,
        });
        setPendingCompile({
          messageId: pendingCompile.messageId,
          prompt: pendingCompile.prompt,
          runId: repaired.runId,
          attemptId: repaired.attemptId,
          fragment: repaired.fragment,
          repairCount: pendingCompile.repairCount + 1,
        });
      } catch (repairError) {
        setAssistantMessage(setMessages, pendingCompile.messageId, {
          status: 'failed',
          compileLog:
            repairError instanceof Error ? repairError.message : 'Unable to repair shader.',
        });
        setPendingCompile(undefined);
      }
    },
    [pendingCompile],
  );

  async function sendPrompt(promptOverride?: string) {
    const prompt = (promptOverride ?? input).trim();
    if (!prompt || busy) return;

    const userId = makeId('usr');
    const assistantId = makeId('ast');
    setInput('');
    setError(undefined);
    setBusy(true);
    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', content: prompt },
      { id: assistantId, role: 'assistant', status: 'generating', prompt },
    ]);

    try {
      const response: GenerateResponse = await generateShader({
        prompt,
        mode: 'body',
        model: 'default',
        constraints: {
          charLimit: CHAR_LIMIT,
          allowRepair: true,
          maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
        },
      });

      setAssistantMessage(setMessages, assistantId, {
        status: 'compiling',
        runId: response.runId,
        attemptId: response.attemptId,
      });
      setPendingCompile({
        messageId: assistantId,
        prompt,
        runId: response.runId,
        attemptId: response.attemptId,
        fragment: response.fragment,
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
              JSON.stringify({ prompt: run.prompt, fragment: attempt.fragment }),
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
              <span>shared shader</span>
            </div>
            <ShaderCanvas fragment={attempt.fragment} />
            <details className="sourceDetails">
              <summary>
                <Code2 size={15} />
                GLSL body
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
