import { buildMemoryQuery } from "./chat/project/memory/memory-retrieval/memoryQuery";

export async function runTest(): Promise<void> {
  const userMessage =
    "من قبلا یک کد داشتم که پینگ رو میگفت کدوم بهرته این یا اون؟";

  console.log("User message:", userMessage);

  try {
    const query = await buildMemoryQuery(userMessage);

    console.log(
      "Semantic query:",
      query.semanticQuery,
    );
    console.log("Keywords:", query.keywords);
    console.log(
      "Entities:",
      JSON.stringify(query.entities, null, 2),
    );
    console.log(
      "Temporal constraints:",
      JSON.stringify(
        query.temporalConstraints,
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      "buildMemoryQuery failed:",
      error,
    );
  }
}
