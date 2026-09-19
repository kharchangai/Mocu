import { getJevDecision } from "./services/ai/tools/decision/Jev_model";

// const MEMORY_QUESTION = {
//   type: "choice" as const,
//   instructions:
//     "Determine which conversation history the user needs. Classify retrieval, not storage. If the request depends on past content but its age is unclear, choose short.",
//   criteria: {
//     none: "No conversation history is needed.",
//     short: "Needs information from the last few messages, or past content of unspecified age.",
//     long: "Needs information from much earlier messages or previous conversations.",
//     both: "Needs information from both recent messages and much older history.",
//   },
// };

export async function runTest(): Promise<void> {
  // const result = await getJevDecision({
  //   state:
  //     "کد پیاتونی که برای پیدا کردن پینگ داده بودی رو دوباره بده",
  //   questions: {
  //     memory: MEMORY_QUESTION,
  //   },
  // });

  // console.dir(result, { depth: null });
}