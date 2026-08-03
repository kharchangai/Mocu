import { createMemory } from "./services/ai/tools/memory/createMemory";

export async function runTest(): Promise<void> {
//   /*
//    * این تست کل پایپ‌لاین واقعی createMemory را اجرا می‌کند:
//    *
//    * 1. enrichAtomicMemory
//    * 2. findSimilarMemories
//    * 3. analyzeMemoryRelationships
//    * 4. ساخت لینک‌های معتبر
//    * 5. evolveNeighborContext
//    * 6. مدیریت و حذف Duplicateها
//    * 7. ذخیره فایل حافظه جدید در AppData/memory
//    *
//    * هشدار:
//    * این یک تست صرفاً نمایشی نیست و واقعاً فایل‌های حافظه را تغییر می‌دهد.
//    * اگر Duplicate پیدا شود، ممکن است حافظه قدیمی حذف و ارجاع‌های آن
//    * به حافظه جدید منتقل شوند.
//    */
//   const input =
//     "کاربر می‌خواهد هفته آینده معماری حافظه بلندمدت را بازطراحی کند تا با مدل ارزان‌تر درست کار کند.";

//   const totalStartedAt = performance.now();
//   let groupOpened = false;

//   try {
//     console.group("[createMemory full pipeline test]");
//     groupOpened = true;

//     console.log("[test] ورودی:");
//     console.log(input);

//     console.warn(
//       [
//         "[test] توجه:",
//         "این تست پایپ‌لاین واقعی را اجرا می‌کند،",
//         "فایل حافظه جدید می‌سازد",
//         "و در صورت تشخیص Duplicate ممکن است فایل‌های قبلی را تغییر دهد یا حذف کند.",
//       ].join(" "),
//     );

//     console.log(
//       "[test] شروع اجرای کامل createMemory...",
//     );

//     /*
//      * فقط همین تابع اجرا می‌شود.
//      * تمام مراحل داخلی پایپ‌لاین توسط createMemory مدیریت می‌شوند.
//      */
//     const result = await createMemory(input);

//     const totalMs = Math.round(
//       performance.now() - totalStartedAt,
//     );

//     console.log(
//       `[test] اجرای createMemory با موفقیت تمام شد: ${totalMs}ms`,
//     );

//     // ─────────────────────────────────────────────────────────────
//     // خلاصه نتیجه کل پایپ‌لاین
//     // ─────────────────────────────────────────────────────────────
//     console.log("[test] خلاصه نتیجه:");

//     console.table({
//       memoryId: result.memory.id,
//       memoryType: result.memory.type,
//       similarMemoriesCount:
//         result.similarMemoriesCount,
//       relationshipAnalysesCount:
//         result.relationshipAnalyses.length,
//       finalLinksCount:
//         result.memory.links.length,
//       embeddingDimensions:
//         result.memory.embedding?.length ?? 0,
//       savedFilePath: result.filePath,
//       totalMs,
//     });

//     // ─────────────────────────────────────────────────────────────
//     // بررسی فایل ذخیره‌شده
//     // ─────────────────────────────────────────────────────────────
//     if (result.filePath) {
//       console.log(
//         `[test] فایل حافظه ذخیره شد: ${result.filePath}`,
//       );
//     } else {
//       console.error(
//         "[test] createMemory مسیر فایل ذخیره‌شده را برنگرداند.",
//       );
//     }

//     // ─────────────────────────────────────────────────────────────
//     // نمایش خروجی حافظه enrichشده و نهایی
//     // ─────────────────────────────────────────────────────────────
//     console.log("[test] خلاصه حافظه نهایی:");

//     console.table({
//       id: result.memory.id,
//       type: result.memory.type,
//       contentLength:
//         result.memory.content?.length ?? 0,
//       contextLength:
//         result.memory.context?.length ?? 0,
//       keyCount: Array.isArray(result.memory.key)
//         ? result.memory.key.length
//         : 0,
//       tagCount: Array.isArray(result.memory.tags)
//         ? result.memory.tags.length
//         : 0,
//       embeddingDimensions:
//         result.memory.embedding?.length ?? 0,
//       finalLinksCount:
//         result.memory.links.length,
//     });

//     // ─────────────────────────────────────────────────────────────
//     // نمایش تحلیل رابطه‌ها
//     // ─────────────────────────────────────────────────────────────
//     printRelationshipAnalyses(
//       result.relationshipAnalyses,
//     );

//     // ─────────────────────────────────────────────────────────────
//     // نمایش لینک‌های نهایی
//     //
//     // این لینک‌ها خروجی نهایی evolveNeighborContext هستند.
//     // لینک‌های DUPLICATE نباید در این آرایه باقی مانده باشند.
//     // ─────────────────────────────────────────────────────────────
//     printFinalLinks(result.memory.links);

//     // ─────────────────────────────────────────────────────────────
//     // بررسی‌های ساده صحت خروجی
//     // ─────────────────────────────────────────────────────────────
//     const validationErrors: string[] = [];

//     if (!result.memory.id?.trim()) {
//       validationErrors.push(
//         "حافظه نهایی id معتبر ندارد.",
//       );
//     }

//     if (!result.memory.content?.trim()) {
//       validationErrors.push(
//         "حافظه نهایی content معتبر ندارد.",
//       );
//     }

//     if (
//       !Array.isArray(result.memory.embedding) ||
//       result.memory.embedding.length === 0
//     ) {
//       validationErrors.push(
//         "حافظه نهایی embedding معتبر ندارد.",
//       );
//     }

//     if (!Array.isArray(result.memory.links)) {
//       validationErrors.push(
//         "فیلد links حافظه نهایی آرایه نیست.",
//       );
//     }

//     if (!result.filePath?.trim()) {
//       validationErrors.push(
//         "مسیر فایل ذخیره‌شده معتبر نیست.",
//       );
//     }

//     const remainingDuplicateLinks =
//       result.memory.links.filter(
//         (link) =>
//           link.relationship === "DUPLICATE",
//       );

//     if (remainingDuplicateLinks.length > 0) {
//       validationErrors.push(
//         `${remainingDuplicateLinks.length} لینک DUPLICATE در لینک‌های نهایی باقی مانده است.`,
//       );
//     }

//     if (validationErrors.length > 0) {
//       console.error(
//         "[test] پایپ‌لاین اجرا شد، اما خروجی مشکلات زیر را دارد:",
//       );

//       console.table(
//         validationErrors.map((message, index) => ({
//           index: index + 1,
//           message,
//         })),
//       );
//     } else {
//       console.log(
//         "[test] بررسی اولیه خروجی موفق بود.",
//       );
//     }

//     // ─────────────────────────────────────────────────────────────
//     // تخمین ساختاری فراخوانی‌های AI
//     // ─────────────────────────────────────────────────────────────
//     printCostEstimate(
//       result.similarMemoriesCount,
//       result.relationshipAnalyses,
//     );

//     // ─────────────────────────────────────────────────────────────
//     // خروجی کامل برای بررسی دقیق
//     // ─────────────────────────────────────────────────────────────
//     console.log("[test] خروجی کامل createMemory:");

//     console.log(
//       JSON.stringify(result, null, 2),
//     );

//     if (validationErrors.length === 0) {
//       console.log(
//         `[test] کل پایپ‌لاین با موفقیت تمام شد. زمان کل: ${totalMs}ms`,
//       );
//     } else {
//       console.warn(
//         `[test] کل پایپ‌لاین اجرا شد، اما ${validationErrors.length} مشکل در خروجی پیدا شد. زمان کل: ${totalMs}ms`,
//       );
//     }
//   } catch (error: unknown) {
//     const totalMs = Math.round(
//       performance.now() - totalStartedAt,
//     );

//     console.error(
//       `[test] اجرای createMemory ناموفق بود. زمان: ${totalMs}ms`,
//     );

//     if (isAbortError(error)) {
//       console.warn(
//         "[test] اجرای پایپ‌لاین لغو شد.",
//       );

//       return;
//     }

//     if (error instanceof Error) {
//       console.error(
//         "[test] نام خطا:",
//         error.name,
//       );

//       console.error(
//         "[test] پیام خطا:",
//         error.message,
//       );

//       console.error(
//         "[test] Stack:",
//         error.stack,
//       );
//     } else {
//       console.error(
//         "[test] خطای ناشناخته:",
//         error,
//       );
//     }
//   } finally {
//     if (groupOpened) {
//       console.groupEnd();
//     }
//   }
// }

// /**
//  * تحلیل‌های رابطه را پیش از تبدیل‌شدن به لینک نمایش می‌دهد.
//  */
// function printRelationshipAnalyses(
//   relationshipAnalyses: Awaited<
//     ReturnType<typeof createMemory>
//   >["relationshipAnalyses"],
// ): void {
//   if (relationshipAnalyses.length === 0) {
//     console.warn(
//       [
//         "[test] هیچ relationship analysisی تولید نشد.",
//         "احتمالاً هیچ حافظه مشابهی پیدا نشده است.",
//       ].join(" "),
//     );

//     return;
//   }

//   console.log(
//     "[test] خلاصه relationshipAnalyses:",
//   );

//   console.table(
//     relationshipAnalyses.map((item) => ({
//       targetFileName: item.targetFileName,
//       targetMemoryId: item.targetMemoryId,
//       similarity: roundNumber(
//         item.similarity,
//         4,
//       ),
//       relationship:
//         item.analysis.relationship,
//       confidence: roundNumber(
//         item.analysis.confidence,
//         3,
//       ),
//       shouldCreateLink:
//         item.analysis.relationship !==
//           "UNRELATED" &&
//         item.analysis.confidence >= 0.5,
//     })),
//   );

//   const relationshipCounts =
//     relationshipAnalyses.reduce<
//       Record<string, number>
//     >((counts, item) => {
//       const relationship =
//         item.analysis.relationship;

//       counts[relationship] =
//         (counts[relationship] ?? 0) + 1;

//       return counts;
//     }, {});

//   console.log(
//     "[test] تعداد هر نوع relationship:",
//   );

//   console.table(relationshipCounts);
// }

// /**
//  * لینک‌های نهایی حافظه را پس از اجرای evolveNeighborContext نمایش می‌دهد.
//  */
// function printFinalLinks(
//   links: Awaited<
//     ReturnType<typeof createMemory>
//   >["memory"]["links"],
// ): void {
//   if (links.length === 0) {
//     console.warn(
//       "[test] حافظه جدید هیچ لینک نهایی ندارد.",
//     );

//     return;
//   }

//   console.log(
//     "[test] لینک‌های نهایی حافظه:",
//   );

//   console.table(
//     links.map((link) => ({
//       targetId: link.targetId,
//       targetFileName: link.targetFileName,
//       relationship: link.relationship,
//       similarity: roundNumber(
//         link.similarity,
//         4,
//       ),
//       confidence: roundNumber(
//         link.confidence,
//         3,
//       ),
//       createdAt: link.createdAt,
//     })),
//   );

//   const linkCounts = links.reduce<
//     Record<string, number>
//   >((counts, link) => {
//     counts[link.relationship] =
//       (counts[link.relationship] ?? 0) + 1;

//     return counts;
//   }, {});

//   console.log(
//     "[test] تعداد هر نوع لینک نهایی:",
//   );

//   console.table(linkCounts);
// }

// /**
//  * تخمین ساختاری تعداد فراخوانی‌های احتمالی AI.
//  *
//  * این تابع مبلغ واقعی را محاسبه نمی‌کند، چون createMemory اطلاعات usage
//  * و tokenهای مصرف‌شده را برنمی‌گرداند.
//  */
// function printCostEstimate(
//   similarMemoriesCount: number,
//   relationshipAnalyses: Awaited<
//     ReturnType<typeof createMemory>
//   >["relationshipAnalyses"],
// ): void {
//   const localDuplicateCount =
//     relationshipAnalyses.filter(
//       (item) =>
//         item.analysis.relationship ===
//           "DUPLICATE" &&
//         item.analysis.confidence === 1,
//     ).length;

//   const estimatedRelationshipLlmCalls =
//     Math.max(
//       0,
//       similarMemoriesCount -
//         localDuplicateCount,
//     );

//   console.log(
//     "[test] تخمین ساختاری فراخوانی‌های AI:",
//   );

//   console.table({
//     enrichAtomicMemoryCalls: 1,
//     findSimilarMemoriesLlmCalls: 0,
//     relationshipCandidates:
//       similarMemoriesCount,
//     localDuplicateAnalyses:
//       localDuplicateCount,
//     estimatedCheapRelationshipLlmCalls:
//       estimatedRelationshipLlmCalls,

//     /*
//      * بعد از حذف evolveComplementNeighbors،
//      * برای تکامل همسایه‌های COMPLEMENTS دیگر
//      * هیچ درخواست LLM اجرا نمی‌شود.
//      */
//     evolveComplementNeighborLlmCalls: 0,
//     evolveComplementNeighborEmbeddingCalls: 0,
//   });

//   console.info(
//     [
//       "[test] نکته هزینه:",
//       "این اعداد فقط تخمین ساختاری هستند.",
//       "برای محاسبه هزینه واقعی باید usage مدل‌ها و embedding provider در لایه ارائه‌دهنده ثبت شود.",
//     ].join(" "),
//   );
}

function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

function roundNumber(
  value: number,
  digits: number,
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}