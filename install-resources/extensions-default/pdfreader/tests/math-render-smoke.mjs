import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../ui/reader.js", import.meta.url), "utf8");
const start = source.indexOf("function renderMath(");
const end = source.indexOf("function renderMarkdown(", start);
assert.ok(start >= 0 && end > start, "reader includes the inline math renderer");

class MathNode {
  constructor(name, text = "") {
    this.localName = name;
    this.text = text;
    this.children = [];
    this.attributes = {};
  }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  get textContent() { return this.text + this.children.map((node) => node.textContent).join(""); }
  set textContent(value) { this.text = String(value); this.children = []; }
}
const document = {
  createElementNS(_namespace, name) { return new MathNode(name); },
  createElement(name) { return new MathNode(name); },
  createTextNode(text) { return new MathNode("#text", text); },
};
const context = vm.createContext({ document });
vm.runInContext(`${source.slice(start, end)}\nglobalThis.mathTest = { renderMath, appendMarkdownInline };`, context);
const { renderMath, appendMarkdownInline } = context.mathTest;
const tuple = renderMath("(S, q, t_q, a)");
assert.equal(tuple.attributes.display, "inline");
assert.equal(tuple.attributes.dir, "ltr");
assert.equal(tuple.textContent, "(S,q,tq,a)");
assert.equal(tuple.children[0].children.filter((node) => node.localName === "msub").length, 1, "subscripts become real MathML subscript nodes");

const condition = renderMath("t_q > t_N");
assert.equal(condition.children[0].children.filter((node) => node.localName === "msub").length, 2);
assert.equal(condition.textContent, "tq>tN");

const display = renderMath("\\frac{x^2}{\\sqrt{y}}", true);
assert.equal(display.attributes.display, "block");
assert.equal(display.children[0].children[0].localName, "mfrac", "fractions are represented as MathML fractions");
assert.equal(display.textContent, "x2y");

const markdownParent = new MathNode("p");
appendMarkdownInline(markdownParent, "Then \\(t_q > t_N\\), or $x^2$.");
const mathNodes = markdownParent.children.filter((node) => node.localName === "math");
assert.equal(mathNodes.length, 2, "both TeX delimiters and single-dollar delimiters render math");
assert.equal(mathNodes[0].children[0].children.filter((node) => node.localName === "msub").length, 2);
assert.equal(mathNodes[1].children[0].children[0].localName, "msup");

const block = new MathNode("div");
appendMarkdownInline(block, "\\[\\alpha + \\beta\\]");
assert.equal(block.children[0].localName, "math");
assert.equal(block.children[0].attributes.display, "block", "bracket delimiters render display math");
assert.equal(block.children[0].textContent, "α+β");

console.log("PDF Reader MathML smoke test passed: inline and display TeX, subscripts, superscripts, Greek letters, and fractions.");
