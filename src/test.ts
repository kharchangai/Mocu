// import { classifyPersonalMemories } from "./chat/project/memory/personal-memory/classifyPersonalMemories";
// import { createProjectPersonalMemoryEntries } from "./chat/project/memory/personal-memory/createPersonalMemoryEntries";

// const PERSONAL_MEMORY_TEST_MESSAGES = [
//   {
//     name: "No personal memory",
//     message: "What is the capital of Japan?",
//   },
//   {
//     name: "One personal memory",
//     message: "I prefer concise answers.",
//   },
//   {
//     name: "Multiple personal memories",
//     message:
//       "I live in Tehran. I prefer concise answers. For this project, use TypeScript.",
//   },
// ] as const;

/** Runs classification and entry preparation examples, printing results and basic checks. */
export async function runTest(): Promise<void> {
  // console.group("[personal memory pipeline test]");

  // try {
  //   for (const testCase of PERSONAL_MEMORY_TEST_MESSAGES) {
  //     console.group(testCase.name);
  //     console.log("Input message:", testCase.message);

  //     try {
  //       const classification = await classifyPersonalMemories(testCase.message);
  //       console.log("Classification result:", classification);

  //       try {
  //         // Empty classifications return [] without calling the generation or embedding models.
  //         const entries = await createProjectPersonalMemoryEntries(classification);
  //         const checks = {
  //           entryCountMatchesClassifiedMemories:
  //             entries.length === classification.memories.length,
  //           allEntriesAreProjectScoped: entries.every(
  //             (entry) => entry.storageScope === "project",
  //           ),
  //           allEntriesHavePromptsAndSearchText: entries.every(
  //             (entry) => Boolean(entry.prompt.trim() && entry.searchText.trim()),
  //           ),
  //           allEntriesHaveNonEmptyFiniteEmbeddings: entries.every(
  //             (entry) =>
  //               entry.embedding.length > 0 &&
  //               entry.embedding.every(Number.isFinite),
  //           ),
  //         };

  //         console.log("Prepared personal-memory entries:", entries);
  //         console.log("Entry validation checks:", checks);
  //         console.log(
  //           "Entries JSON:\n" + JSON.stringify(entries, null, 2),
  //         );

  //         if (Object.values(checks).some((passed) => !passed)) {
  //           console.error("One or more personal-memory entry checks failed.");
  //         } else {
  //           console.log("Personal-memory entry checks passed.");
  //         }
  //       } catch (error) {
  //         console.error("createProjectPersonalMemoryEntries failed:", error);
  //       }
  //     } catch (error) {
  //       console.error("classifyPersonalMemories failed:", error);
  //     } finally {
  //       console.groupEnd();
  //     }
  //   }
  // } finally {
  //   console.groupEnd();
  // }
}