// import { findRelevantSection } from "./chat/docs";

export async function runTest(): Promise<void> {
  // let text = "خوب ببین من میخوام برای مکو یک اکستنشن بسازم برای کار با فایل و این طور چیز ها و میخوام دید بهتری از کاری که میخوام انجام بدم پیدا کنم که بهتر بتونم کار رو انجام بدم و چیزی که میخوام رو بسازم برای همین میخوام تو بهم کمک کنی کاری که من میخوام بکنم اینه که یک تابع برای جستوجو فایل داشته باشم که از bm25 استفاده کنه و اون استادی که میتونه مربوط باشه رو پیدا کنه و بعد از jev مدل استفاده کنه که از هر صند اون قیکت های که با bm25 پیدا شده مثلا پرارگراف که کلمات کلید توش هست یا هر چیز دیگه رو پیدا کنه از jev استفاده کنه که ببینه ایا واقعان مربوط هست یا نه اگر اره بعد دوباره از jev استقاده کنه اون  پرارگراف های مربوط پیدا کنه یا نمیدونم بسته به این که کاربر چه نیازی داره کل داکیمت رو یا پرارگراف یا یک صفحه خاص رو عددش رو برگردونه تا مدل زبانی خیلی توکن مصرف نکنه این هنوز یک قستش هست ولی میخوام فعلا برای همین قسمت دید بهتری پیدا کنم تو بهم کمک کن."
  // const result = await findRelevantSection(text);
  //  if (result?.best) {
  //    console.log(result.doc.name, "→", result.best.title);
  //    console.log(result.best.content);   // the actual related part of the doc
  //    for (const r of result.ranking) {
  //      console.log(r.probability.toFixed(2), r.section.title);
  //    }
  //  }

//   const text = `
// Favicon for typesafe
// TypeSafe: Jev Latest
// Latest
// Jev 1.13
// ~typesafe/jev-latest


// Compare
// This model always redirects to the latest model in the Jev family.


// Favicon for typesafe
// TypeSafe: Jev Latest
// Compare
// Quick Start
// Drop-in code to call this model. OpenRouter's API is OpenAI-compatible — most SDKs work by just swapping the base URL. The only thing that changes between models is the model slug below.

// 1
// Get your API key
// Create an API key from your OpenRouter dashboard and set it as an environment variable:

// Create API Key

// Copy
// export OPENROUTER_API_KEY=sk-or-v1-...
// 2
// Make your first request
// Use ~typesafe/jev-latest with the OpenRouter API:

// This model does not generate text. It answers typed questions about a state (a string, object, or array) through the Decisions API and returns calibrated probabilities: a yes/no probability (noul), a pick from options you define (choice), or a position on an ordered rubric (score). Your code owns the workflow and acts on the answers, so use it for routing, ranking, verification, and other structured decisions rather than chat. Learn how to build with System One.

// In the examples below, the OpenRouter-specific headers are optional. Setting them allows your app to appear on the OpenRouter leaderboards.

// TypeScript SDK
// Python
// TypeScript (fetch)
// cURL

// Copy
// curl https://openrouter.ai/api/alpha/decisions \-H "Content-Type: application/json" \-H "Authorization: Bearer $OPENROUTER_API_KEY" \-d '{
//     "model": "~typesafe/jev-latest",
//     "state": "Help! My payouts have been failing for 3 days.",
//     "questions": {
//       "is_urgent": {
//         "type": "noul",
//         "instructions": "Does this message convey urgency?",
//         "criteria": {
//           "true": "Explicitly time-sensitive",
//           "false": "No urgency expressed"
//         }
//       },
//       "department": {
//         "type": "choice",
//         "instructions": "Which team should handle this?",
//         "criteria": {
//           "billing": "Payments, invoicing, refunds",
//           "technical": "Bugs, outages, integrations",
//           "sales": "Pricing, upgrades, new accounts"
//         }
//       },
//       "frustration": {
//         "type": "score",
//         "instructions": "How frustrated is the customer?",
//         "criteria": ["Calm", "Frustrated", "Very angry"]
//       }
//     }
//   }'
// Using third-party SDKs
// For information about using third-party SDKs and frameworks with OpenRouter, please see our frameworks documentation.

// Endpoint
// OpenRouter normalizes requests and responses across providers for this endpoint.

// POST
// https://openrouter.ai/api/alpha/decisions
// Authorization
// Bearer $OPENROUTER_API_KEY
// Content-Type
// application/json
// HTTP-Referer
// optional — your site URL, for rankings
// X-Title
// optional — your site name, for rankings
// Model
// ~typesafe/jev-latest
// Frequently asked questions
// What is Jev Latest?
// How much does Jev Latest cost?
//   `;

//   const doc = await createDocFromText(text);
//   console.log(`Saved: ${doc.file}\nKeywords: ${doc.keywords.join(", ")}`);
}