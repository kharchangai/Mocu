import { analyzeFeedback } from "./services/ai/tools/personalMemory/memory/analyzeMemoryContext";

type FeedbackTestCase = {
  name: string;
  input: {
    user_request: string;
    agent_response: string;
    user_feedback: string;
  };
};

const testCases: FeedbackTestCase[] = [
  {
    name: "Clear persistent preference",
    input: {
      user_request: "این مقاله علمی رو برای من ترجمه کن.",
      agent_response:
        "ترجمه مقاله انجام شد. متن ترجمه‌شده شامل مقدمه، روش تحقیق و نتایج است.",
      user_feedback:
        "برای ترجمه‌های علمی، نکات مهم و ادعاهای علمی را نمی‌خواهم در اینترنت جستجو کنی و خودت جواب بده.",
    },
  },
];

function printSeparator(): void {
  console.log("\n==================================================");
}

export async function runTest(): Promise<void> {
  console.log(
    `Starting feedback memory analysis test with ${testCases.length} case(s)...`,
  );

  let passedTests = 0;
  let failedTests = 0;

  for (const [index, testCase] of testCases.entries()) {
    printSeparator();
    console.log(`Test ${index + 1}/${testCases.length}: ${testCase.name}`);
    console.log("==================================================");

    try {
      console.log("\nInput:");
      console.log(JSON.stringify(testCase.input, null, 2));

      console.log("\nStep 1: Analyzing feedback and creating memory...");

      const memory = await analyzeFeedback(testCase.input);

      console.log("\nCreated feedback memory:");
      console.log(
        JSON.stringify(
          {
            id: memory.id,
            state: memory.state,
            problem_category: memory.problem_category,
            task_type: memory.task_type,
            scope: memory.scope,
            scope_description: memory.scope_description,
            created_at: memory.created_at,
            activated_at: memory.activated_at,
            embedding_text: memory.embedding_text,
            embedding_dimensions: memory.combined_embedding.length,
            embedding_metadata: memory.embedding_metadata,
            source_interaction: memory.source_interaction,
          },
          null,
          2,
        ),
      );

      if (!memory.id.trim()) {
        throw new Error("The created memory does not contain an ID.");
      }

      if (memory.state !== "active") {
        throw new Error(
          `Expected memory state to be "active", received "${memory.state}".`,
        );
      }

      if (!memory.problem_category.trim()) {
        throw new Error(
          "The created memory does not contain problem_category.",
        );
      }

      if (!memory.task_type.trim()) {
        throw new Error("The created memory does not contain task_type.");
      }

      if (!memory.scope.trim()) {
        throw new Error("The created memory does not contain scope.");
      }

      if (!memory.scope_description.trim()) {
        throw new Error(
          "The created memory does not contain scope_description.",
        );
      }

      if (!memory.embedding_text.trim()) {
        throw new Error("The created memory does not contain embedding_text.");
      }

      if (
        !Array.isArray(memory.combined_embedding) ||
        memory.combined_embedding.length === 0
      ) {
        throw new Error(
          "The created memory does not contain a valid combined_embedding.",
        );
      }

      if (
        memory.source_interaction.user_request !==
          testCase.input.user_request ||
        memory.source_interaction.agent_response !==
          testCase.input.agent_response ||
        memory.source_interaction.user_feedback !==
          testCase.input.user_feedback
      ) {
        throw new Error(
          "The source_interaction data does not match the test input.",
        );
      }

      console.log(`\nTest passed: ${testCase.name}`);
      passedTests += 1;
    } catch (error) {
      failedTests += 1;

      console.error(`\nTest failed: ${testCase.name}`);

      if (error instanceof Error) {
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      } else {
        console.error("Unknown error:", error);
      }
    }
  }

  printSeparator();
  console.log("Test summary");
  console.log("==================================================");
  console.log(`Total: ${testCases.length}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log("Feedback memory analysis test completed.");

  if (failedTests > 0) {
    throw new Error(`${failedTests} feedback memory test(s) failed.`);
  }
}