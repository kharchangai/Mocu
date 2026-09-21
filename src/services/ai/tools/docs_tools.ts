import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  createDocFromText,
  updateDocFromText,
  updateDocFields,
  deleteDoc,
  listDocs,
} from "../../../chat/docs";

/**
 * Knowledge doc tools.
 *
 * Lets the agents manage the user's saved searchable knowledge documents
 * (the global docs folder: BaseDirectory.AppData/docs). The created docs
 * power BM25 + Jev section retrieval, which runs automatically before the
 * agent answers, so saving good docs directly improves future answers.
 */

const DOC_TOOL_RESULT_LIMIT = 2_000;

function truncateResult(text: string): string {
  return text.length > DOC_TOOL_RESULT_LIMIT
    ? `${text.slice(0, DOC_TOOL_RESULT_LIMIT).trimEnd()}…`
    : text;
}

export const createDocTool = tool(
  async ({ text }) => {
    console.log("[Docs Tool] Creating knowledge doc from text.");

    try {
      const doc = await createDocFromText(text);

      return [
        `Knowledge document created and saved as "${doc.file}".`,
        `Name: ${doc.name}`,
        `Description: ${doc.description}`,
        `Keywords: ${doc.keywords.join(", ")}`,
      ].join("\n");
    } catch (error) {
      console.error("[Docs Tool] Failed to create doc:", error);

      return `Error: The document could not be created. Details: ${error}`;
    }
  },
  {
    name: "create_knowledge_doc",
    description:
      "Turns text into a complete, searchable knowledge document (title, description, keywords, full explanation) and saves it in the user's global docs folder. " +
      "Use when the user says something worth remembering as knowledge, e.g. 'remember this', 'save this as a doc', or when they share an idea, plan, or reference worth keeping. " +
      "Pass the user's text as-is; the tool asks an LLM to structure it.",
    schema: z.object({
      text: z
        .string()
        .describe("The raw text to turn into a knowledge document"),
    }),
  },
);

export const updateDocTool = tool(
  async ({ fileName, text, description, keywords }) => {
    console.log(`[Docs Tool] Updating knowledge doc: "${fileName}".`);

    try {
      if (text && text.trim()) {
        // Full regeneration from new text (keeps the same file).
        const doc = await updateDocFromText(fileName, text);

        return [
          `Knowledge document "${doc.file}" updated.`,
          `Name: ${doc.name}`,
          `Description: ${doc.description}`,
        ].join("\n");
      }

      // Partial field edit.
      if (!description?.trim() && !(keywords && keywords.length > 0)) {
        return "Error: Provide either new text, or a description and/or keywords to update.";
      }

      const doc = await updateDocFields(fileName, {
        description,
        keywords,
      });

      return [
        `Knowledge document "${doc.file}" updated.`,
        `Name: ${doc.name}`,
        `Description: ${doc.description}`,
        `Keywords: ${doc.keywords.join(", ")}`,
      ].join("\n");
    } catch (error) {
      console.error("[Docs Tool] Failed to update doc:", error);

      return `Error: The document could not be updated. Details: ${error}`;
    }
  },
  {
    name: "update_knowledge_doc",
    description:
      "Updates an existing knowledge document by file name. Either pass new text (the tool regenerates the document and merges the new information) or pass a description/keywords to edit metadata only.",
    schema: z.object({
      fileName: z
        .string()
        .describe("Exact file name of the doc, e.g. 'my-idea.md' (from list_knowledge_docs)"),
      text: z
        .string()
        .optional()
        .describe("New text to merge into the document; omit to only edit metadata"),
      description: z
        .string()
        .optional()
        .describe("New one/two-sentence description; omit to keep the current one"),
      keywords: z
        .array(z.string())
        .optional()
        .describe("New keyword list; omit to keep current keywords"),
    }),
  },
);

export const deleteDocTool = tool(
  async ({ fileName }) => {
    console.log(`[Docs Tool] Deleting knowledge doc: "${fileName}".`);

    try {
      await deleteDoc(fileName);

      return `Knowledge document "${fileName}" deleted.`;
    } catch (error) {
      console.error("[Docs Tool] Failed to delete doc:", error);

      return `Error: The document could not be deleted. Details: ${error}`;
    }
  },
  {
    name: "delete_knowledge_doc",
    description:
      "Deletes a saved knowledge document by its exact file name. Only delete when the user clearly asks to remove it.",
    schema: z.object({
      fileName: z
        .string()
        .describe("Exact file name of the doc, e.g. 'my-idea.md'"),
    }),
  },
);

export const listDocsTool = tool(
  async () => {
    console.log("[Docs Tool] Listing knowledge docs.");

    try {
      const docs = await listDocs();

      if (docs.length === 0) {
        return "No knowledge documents are saved yet.";
      }

      return truncateResult(
        docs
          .map(
            (doc) =>
              `- ${doc.file} | ${doc.name} | ${doc.description} | keywords: ${doc.keywords.join(", ")}`,
          )
          .join("\n"),
      );
    } catch (error) {
      console.error("[Docs Tool] Failed to list docs:", error);

      return `Error: The documents could not be listed. Details: ${error}`;
    }
  },
  {
    name: "list_knowledge_docs",
    description:
      "Lists all saved knowledge documents with their file names, titles, descriptions and keywords. Call this first before updating or deleting a doc when you do not know the exact file name.",
    schema: z.object({}),
  },
);

export const docTools = [
  createDocTool,
  updateDocTool,
  deleteDocTool,
  listDocsTool,
] as const;
