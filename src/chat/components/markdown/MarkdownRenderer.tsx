import {
  isValidElement,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import "./MarkdownRenderer.css";

export type MarkdownDirection =
  | "auto"
  | "ltr"
  | "rtl";

export type MarkdownRendererProps = {
  content: string;
  className?: string;
  direction?: MarkdownDirection;
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

function CodeBlock({
  children,
  ...props
}: HTMLAttributes<HTMLPreElement>) {
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

export function MarkdownRenderer({
  content,
  className = "",
  direction = "auto",
}: MarkdownRendererProps) {
  if (!content || !content.trim()) {
    return null;
  }

  const rootClassName = [
    "mocu-markdown",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClassName}
      dir={direction}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [
            rehypeHighlight,
            {
              detect: true,
              ignoreMissing: true,
            },
          ],
        ]}
        components={{
          pre: CodeBlock,

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

          a: ({
            children,
            href,
            ...props
          }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),

          img: ({
            src,
            alt,
            ...props
          }) => (
            <img
              {...props}
              src={src}
              alt={alt ?? ""}
              loading="lazy"
            />
          ),
        }}
      >
        {content.trim()}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;