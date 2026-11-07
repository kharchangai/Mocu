import {
  isValidElement,
  memo,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { defaultUrlTransform } from "react-markdown";
import type { GeneratedChatImage } from "../../types/generatedImage";
import type { GeneratedChatAudio } from "../../types/generatedAudio";
import type { GeneratedChatVideo } from "../../types/generatedVideo";
import { GeneratedAudioPlayer } from "../GeneratedAudioPlayer";
import { GeneratedImageCard } from "../GeneratedImageMessage";
import { GeneratedVideoCard } from "../GeneratedVideoMessage";

import { getTextDirection } from "../textDirection";
import { getJavaScriptDemo, loadJavaScriptDemo } from "../../services/javascriptDemoRegistry";
import "katex/dist/katex.min.css";
import "./MarkdownRenderer.css";

export type MarkdownDirection =
  | "auto"
  | "ltr"
  | "rtl";

export type MarkdownRendererProps = {
  content: string;
  className?: string;
  direction?: MarkdownDirection;
  generatedImages?: GeneratedChatImage[];
  generatedAudio?: GeneratedChatAudio[];
  generatedVideos?: GeneratedChatVideo[];
  projectPath?: string;
};

type CodeElementProps = {
  className?: string;
  children?: ReactNode;
};

type CopyButtonProps = {
  text: string;
};

const LANGUAGE_NAMES: Record<string, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  cs: "C#",
  css: "CSS",
  dockerfile: "Dockerfile",
  go: "Go",
  html: "HTML",
  java: "Java",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  markdown: "Markdown",
  md: "Markdown",
  php: "PHP",
  plaintext: "Plain text",
  powershell: "PowerShell",
  ps1: "PowerShell",
  python: "Python",
  py: "Python",
  rust: "Rust",
  sh: "Shell",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  text: "Plain text",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
};

function normalizeCodeText(
  value: ReactNode,
): string {
  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map(normalizeCodeText)
      .join("");
  }

  if (
    isValidElement<CodeElementProps>(value)
  ) {
    return normalizeCodeText(
      value.props.children,
    );
  }

  return "";
}

function getCodeLanguage(
  className?: string,
): string {
  const match = /language-([\w#+.-]+)/i.exec(
    className ?? "",
  );

  return match?.[1]?.toLowerCase() ?? "text";
}

function formatLanguageName(
  language: string,
): string {
  return (
    LANGUAGE_NAMES[language.toLowerCase()] ??
    language
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2"
      />

      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function CopyButton({
  text,
}: CopyButtonProps) {
  const [isCopied, setIsCopied] =
    useState(false);

  const timeoutRef =
    useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(
          timeoutRef.current,
        );
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        text.replace(/\n$/, ""),
      );

      setIsCopied(true);

      if (timeoutRef.current !== null) {
        window.clearTimeout(
          timeoutRef.current,
        );
      }

      timeoutRef.current =
        window.setTimeout(() => {
          setIsCopied(false);
          timeoutRef.current = null;
        }, 1600);
    } catch (error: unknown) {
      console.error(
        "Failed to copy the code block:",
        error,
      );
    }
  };

  return (
    <button
      type="button"
      className="mocu-markdown__copy-button"
      onClick={handleCopy}
      aria-label={
        isCopied
          ? "Code copied"
          : "Copy code"
      }
      title={
        isCopied
          ? "Copied"
          : "Copy code"
      }
    >
      {isCopied ? (
        <CheckIcon />
      ) : (
        <CopyIcon />
      )}

      <span>
        {isCopied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

function InteractiveJavaScriptDemo({
  id,
  projectPath = "",
}: {
  id: string;
  projectPath?: string;
}) {
  const [demo, setDemo] = useState(() => getJavaScriptDemo(id));
  const [isLoading, setIsLoading] = useState(() => !getJavaScriptDemo(id));
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const cached = getJavaScriptDemo(id);
    setDemo(cached);
    setIsLoading(!cached);
    void loadJavaScriptDemo(id, projectPath).then((saved) => {
      if (!active) return;
      if (saved) setDemo(saved);
      setIsLoading(false);
    });
    return () => { active = false; };
  }, [id, projectPath, loadAttempt]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!demo) return;

    const timeout = window.setTimeout(() => {
      if (!iframeRef.current) return;
      iframeRef.current.srcdoc = "<!doctype html><html><body style='font-family:system-ui,sans-serif;padding:12px;color:#b42318'>Preview stopped: JavaScript exceeded the 8-second startup limit.</body></html>";
    }, 8000);

    const handleMessage = (event: MessageEvent) => {
      if (
        event.source !== iframeRef.current?.contentWindow ||
        event.data?.type !== "mocu-demo-ready"
      ) return;
      window.clearTimeout(timeout);
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
    };
  }, [demo, id]);

  if (isLoading && !demo) {
    return (
      <span className="mocu-markdown__javascript-demo-unavailable" role="status" aria-live="polite">
        Loading saved interactive preview...
      </span>
    );
  }

  if (!demo) {
    return (
      <span className="mocu-markdown__javascript-demo-unavailable" role="status" aria-live="polite">
        <span>Preview data could not be found or loaded. The reference may be invalid, its saved file may be missing, or this chat may be open in a different project folder.</span>
        <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          Try loading again
        </button>
        <span>If it still cannot be loaded, ask the agent to create the preview again.</span>
      </span>
    );
  }

  const escapeScriptEnd = (value: string) =>
    value.replace(/<\/script/gi, "<\\/script");
  const escapeStyleEnd = (value: string) =>
    value.replace(/<\/style/gi, "<\\/style");
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'self'; base-uri 'none'; navigate-to 'none'"><style>html,body{margin:0;padding:0;font-family:system-ui,sans-serif}body{padding:12px;box-sizing:border-box;color:#222}#root{min-height:40px}${escapeStyleEnd(demo.css)}</style></head><body><div id="root"></div><script>(()=>{const root=document.getElementById('root');try{const render=(root)=>{${escapeScriptEnd(demo.javascript)}\n};render(root)}catch(e){root.textContent='Demo error: '+(e&&e.message?e.message:String(e));root.style.color='#b42318'}})();parent.postMessage({type:'mocu-demo-ready'},'*');<\/script></body></html>`;

  return (
    <span className="mocu-markdown__javascript-demo" aria-label="Interactive JavaScript">
      <span className="mocu-markdown__javascript-demo-header">Interactive JavaScript</span>
      <iframe
        ref={iframeRef}
        title="Interactive JavaScript"
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        loading="lazy"
        height={demo.height}
        srcDoc={srcDoc}
      />
    </span>
  );
}

function CodeBlock({
  children,
  projectPath = "",
  ...props
}: HTMLAttributes<HTMLPreElement> & { projectPath?: string }) {
  const codeElement = Array.isArray(children)
    ? children.find((child) =>
        isValidElement<CodeElementProps>(
          child,
        ),
      )
    : children;

  const codeClassName =
    isValidElement<CodeElementProps>(
      codeElement,
    )
      ? codeElement.props.className
      : undefined;

  const language =
    getCodeLanguage(codeClassName);

  const codeText =
    normalizeCodeText(codeElement);

  if (codeClassName?.split(/\s+/).includes("language-mocu-js")) {
    const reference = codeText.trim().match(/^mocu-interactive-js:([A-Za-z0-9-]+)$/)?.[1];
    return reference
      ? <InteractiveJavaScriptDemo id={reference} projectPath={projectPath} />
      : <span className="mocu-markdown__javascript-demo-unavailable" role="status">Invalid mocu-js reference. Use the saved demo reference returned by the JavaScript demo tool.</span>;
  }

  return (
    <div className="mocu-markdown__code-block">
      <div className="mocu-markdown__code-header">
        <span className="mocu-markdown__code-language">
          {formatLanguageName(language)}
        </span>

        <CopyButton text={codeText} />
      </div>

      <pre {...props}>{children}</pre>
    </div>
  );
}

function MarkdownRendererImpl({
  content,
  className = "",
  direction = "auto",
  generatedImages = [],
  generatedAudio = [],
  generatedVideos = [],
  projectPath = "",
}: MarkdownRendererProps) {
  if (!content || !content.trim()) {
    return null;
  }

  const resolvedDirection =
    direction === "auto"
      ? getTextDirection(content)
      : direction;

  const rootClassName = [
    "mocu-markdown",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClassName}
      dir={resolvedDirection}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false }],
          [
            rehypeHighlight,
            {
              detect: true,
              ignoreMissing: true,
            },
          ],
        ]}
        urlTransform={(url) => url.startsWith("mocu-generated-image:") || url.startsWith("mocu-generated-audio:") || url.startsWith("mocu-generated-video:") || url.startsWith("mocu-interactive-js:") ? url : defaultUrlTransform(url)}
        components={{
          pre: (props) => <CodeBlock {...props} projectPath={projectPath} />,

          table: ({
            children,
            ...props
          }) => (
            <div className="mocu-markdown__table-wrapper">
              <table {...props}>
                {children}
              </table>
            </div>
          ),

          a: ({ children, href, ...props }) => {
            const audioId = href?.startsWith("mocu-generated-audio:")
              ? href.slice("mocu-generated-audio:".length)
              : "";
            const audio = audioId ? generatedAudio.find((item) => item.id === audioId) : undefined;
            if (audio) {
              return (
                <span className="generated-audio-inline">
                  <span>{children}</span>
                  <GeneratedAudioPlayer audio={audio} />
                </span>
              );
            }
            return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          },

          img: ({
            src,
            alt,
            ...props
          }) => {
            const interactiveDemoId = src?.startsWith("mocu-interactive-js:")
              ? src.slice("mocu-interactive-js:".length)
              : "";
            if (interactiveDemoId) {
              return <InteractiveJavaScriptDemo id={interactiveDemoId} projectPath={projectPath} />;
            }
            const generatedVideoId = src?.startsWith("mocu-generated-video:") ? src.slice("mocu-generated-video:".length) : "";
            const generatedVideo = generatedVideoId ? generatedVideos.find((video) => video.id === generatedVideoId) : undefined;
            if (generatedVideo) return <GeneratedVideoCard video={generatedVideo} />;
            const generatedImageId = src?.startsWith("mocu-generated-image:")
              ? src.slice("mocu-generated-image:".length)
              : "";
            const generatedImage = generatedImageId
              ? generatedImages.find((image) => image.id === generatedImageId)
              : undefined;
            if (generatedImage) return <GeneratedImageCard image={generatedImage} />;
            return <img {...props} src={src} alt={alt ?? ""} loading="lazy" />;
          },
        }}
      >
        {content.trim()}
      </ReactMarkdown>
    </div>
  );
}

/*
 * Memoized: parsing markdown with syntax highlighting is expensive, and
 * while the user is typing in the composer every parent render would
 * otherwise re-parse every message in the conversation. With memo the
 * parse is skipped whenever `content` (and the other props) did not
 * change.
 */
export const MarkdownRenderer = memo(MarkdownRendererImpl);

export default MarkdownRenderer;