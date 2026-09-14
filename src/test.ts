import { runMemoryPipeline } from "./chat/project/memory/memory-retrieval/memoryPipeline";

/**
 * The project ROOT folder. The storage layer appends
 * ".mocu/storage/memoryx.db" and ".mocu/storage/memory-graph.db"
 * itself, so this must NOT include the .mocu/storage part.
 */
// const PROJECT_PATH = "E:\\test\\ptest";

// const TEST_USER_MESSAGE =
//   "ببین چیزی که من رو خیلی داره اذیت مکینه اینه که من میخوام یک سیستم بسازم که خیلی ارزون باشه که همه بتونن استفاده کنن چون اوپن سورس هست ولی بتونه به اندازه یا بهتر از مدل های گرون کار کنه. \nایده ایی که دارم اینه که مدل های ارزون الان خیلی بهتر شدن و خیلی کار ها رو متونن انجام بدم ولی مشکلی که دارن بخواتر اینکه چون پارامتر های کمتری دارن پس خیلی چیز ها رو کمتر از مدل های گرون میدونن مثلا مدل ارزون میشه کد باگ یک کد رو بگه ولی نیاز داره که کانتکس درست بحش بدم ولی مدل بزرگ این مشکل رو نداره. ولی مدل های بزرگ خیلی گرونن و درنهایت هم انطور که باید کار نمیکنن.\nمن فکر میکنم که اگر ابزار مناسب رو به مدل ارزون بدم کانکس اپدیت و دریت هم بهش بدم احتمالا بتونه به اندازه یا بهتر از مدل بزرگ کار کنه.\nولی این چیزه که داره اذیتم میکنه اینه که متما نیستم واقعا شدنی باشه.";

export async function runTest(): Promise<void> {
  // console.log("=== memory pipeline: start ===");

  // const result = await runMemoryPipeline(
  //   TEST_USER_MESSAGE,
  //   PROJECT_PATH,
  // );

  // console.log("=== pipeline result ===");

  // console.log("entity database:", result.entityDatabasePath);

  // console.log(
  //   `entities (${result.entities.length}):`,
  //   result.entities,
  // );

  // const graphResult = result.graphResult;

  // if (!graphResult) {
  //   console.log("graph result: null");
  // } else {
  //   console.log(
  //     `graph search: found ${graphResult.foundCount}/${graphResult.matches.length} entity/ies, ${graphResult.totalMentionCount} mention(s)`,
  //   );

  //   for (const match of graphResult.matches) {
  //     if (!match.found) {
  //       console.log(
  //         `❌ "${match.query}" — not found in graph database`,
  //       );

  //       continue;
  //     }

  //     console.log(
  //       `✅ "${match.normalized}" [${match.entityType}] — ${match.mentionCount} mention(s)`,
  //     );
  //   }

  //   console.log("=== ranked graph turns ===");

  //   for (const rankedTurn of graphResult.rankedTurns) {
  //     if (rankedTurn.isNeighbor) {
  //       console.log(
  //         `   ↳ [neighbor ${rankedTurn.neighborDirection} of ${rankedTurn.neighborOfTurnId}, similarity: ${rankedTurn.neighborSimilarity?.toFixed(3)}] turn ${rankedTurn.turnId}`,
  //       );

  //       continue;
  //     }

  //     const score = rankedTurn.score;

  //     console.log(
  //       `   ★ [primary] turn ${rankedTurn.turnId} — entity: ${score?.entityScore.toFixed(3)}, similarity: ${score?.similarityScore.toFixed(3)}, final: ${score?.finalScore.toFixed(3)} (${score?.matchedEntityCount}/${score?.totalQueryEntityCount} entity/ies)`,
  //     );
  //   }
  // }

  // console.log("=== returned memory (memoryContext) ===");
  // console.log(
  //   result.memoryContext
  //     ? result.memoryContext
  //     : "(empty — no related memory found)",
  // );
}

// NOTE: do NOT auto-run here. This module is imported by src/App.tsx,
// which already calls runTest() from a useEffect.
// If you need a standalone run, call `runTest()` explicitly from a console.
