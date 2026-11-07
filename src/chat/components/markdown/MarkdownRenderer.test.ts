import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownRenderer } from "./MarkdownRenderer";
import { registerJavaScriptDemo } from "../../services/javascriptDemoRegistry";

const renderMarkdown = (content: string): string =>
  renderToStaticMarkup(createElement(MarkdownRenderer, { content }));

describe("MarkdownRenderer math", () => {
  it("renders inline dollar-delimited formulas as KaTeX", () => {
    const html = renderMarkdown("Energy: $E = mc^2$");

    expect(html).toContain('class="katex"');
    expect(html).toContain("mc");
    expect(html).not.toContain("$E = mc^2$");
  });

  it("renders display formulas as KaTeX", () => {
    const html = renderMarkdown("$$\n\\frac{a}{b}\n$$");

    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="katex"');
    expect(html).toContain("<mfrac>");
  });

  it("keeps math-like text inside code blocks as code", () => {
    const html = renderMarkdown("```text\n$E = mc^2$\n```");

    expect(html).toContain("$E = mc^2$");
    expect(html).not.toContain('class="katex"');
  });
});


describe("MarkdownRenderer interactive JavaScript demos", () => {
  it("renders explicitly registered demos in a script-only sandboxed iframe", () => {
    const id = registerJavaScriptDemo({
      title: "Slope calculator",
      javascript: "root.textContent = 'slope';",
      css: "#root { color: blue; }",
      height: 380,
    });
    const html = renderMarkdown(`![Interactive JavaScript demo](mocu-interactive-js:${id})`);

    expect(html).toContain('title="Interactive JavaScript"');
    expect(html).not.toContain('Slope calculator');
    expect(html).toContain('sandbox="allow-scripts allow-forms"');
    expect(html).not.toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).toContain("connect-src &#x27;none&#x27;");
    expect(html).toContain("form-action &#x27;self&#x27;");
    expect(html).toContain("root.textContent = &#x27;slope&#x27;");
  });

  it("renders a saved-demo reference in mocu-js without exposing source code", () => {
    const id = registerJavaScriptDemo({
      title: "Ignored custom title",
      javascript: "root.textContent = 'hello';",
      css: "",
      height: 360,
    });
    const html = renderMarkdown(`\`\`\`mocu-js\nmocu-interactive-js:${id}\n\`\`\``);

    expect(html).toContain('title="Interactive JavaScript"');
    expect(html).toContain('Interactive JavaScript</span>');
    expect(html).not.toContain('Ignored custom title');
    expect(html).toContain('sandbox="allow-scripts allow-forms"');
    expect(html).toContain("root.textContent = &#x27;hello&#x27;");
    expect(html).not.toContain('class="mocu-markdown__code-block"');
    expect(html).not.toContain("<pre");
  });

  it("does not execute ordinary JavaScript code fences", () => {
    const html = renderMarkdown("```javascript\nroot.textContent = 'not executed';\n```");

    expect(html).toContain("not executed");
    expect(html).not.toContain("<iframe");
  });
});
