function normalizeText(value) {
  return String(value || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function decisionIsYes(answer) {
  if (answer === true) return true;
  if (typeof answer === "number") return answer >= 0.6;
  if (typeof answer === "string") return /^(true|yes|relevant|match|related)$/i.test(answer.trim());
  if (!answer || typeof answer !== "object") return false;
  if (typeof answer.true === "number" || typeof answer.false === "number") {
    return Number(answer.true || 0) >= 0.6 && Number(answer.true || 0) > Number(answer.false || 0);
  }
  if (typeof answer.probability === "number") return answer.probability >= 0.6;
  if (typeof answer.confidence === "number" && typeof answer.relevant === "boolean") return answer.relevant && answer.confidence >= 0.6;
  for (const key of ["answer", "value", "result", "choice", "label", "decision", "relevant", "match", "noul"]) {
    if (key in answer) return decisionIsYes(answer[key]);
  }
  return false;
}

function answerFor(result, key) {
  if (!result || typeof result !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(result, key)) return result[key];
  for (const container of [result.answers, result.decisions, result.results, result.output]) {
    if (container && typeof container === "object" && Object.prototype.hasOwnProperty.call(container, key)) return container[key];
  }
  if (typeof result.true === "number" || typeof result.false === "number") return result;
  return null;
}
async function askInBatches(extension, state, items, makeQuestion) {
  const matches = [];
  for (let start = 0; start < items.length; start += 32) {
    const batch = items.slice(start, start + 32);
    const questions = Object.fromEntries(batch.map((item, index) => [`q${index}`, makeQuestion(item)]));
    const batchState = typeof state === "function" ? state(batch) : state;
    const result = await extension.decision.ask({ state: batchState, questions });
    batch.forEach((item, index) => {
      if (decisionIsYes(answerFor(result, `q${index}`))) matches.push(item);
    });
  }
  return matches;
}

export async function matchTopics(extension, input) {
  const topics = Array.isArray(input?.topics) ? input.topics
    .filter((topic) => topic && typeof topic.name === "string" && topic.name.trim())
    .map((topic, index) => ({ id: `t${index}`, name: topic.name.trim(), notes: typeof topic.notes === "string" ? topic.notes.trim() : "" })) : [];
  const paragraphs = Array.isArray(input?.paragraphs) ? input.paragraphs.filter((text) => typeof text === "string" && text.trim()) : [];
  if (!topics.length || !paragraphs.length) return { matches: [] };

  const title = typeof input.title === "string" ? input.title : "";
  const text = typeof input.text === "string" ? input.text : "";
  const topicState = { title, article: text, topics: topics.map(({ id, name, notes }) => ({ id, name, notes })) };
  const relevantTopics = await askInBatches(extension, topicState, topics, (topic) => ({
    type: "noul",
    instructions: "Judge only whether this story contains substantive, non-incidental information relevant to the user's topic. Do not count a passing mention or a shared generic word as relevant.",
    criteria: { true: `The story substantively discusses the topic: ${topic.name}. User's notes: ${topic.notes || "none"}`, false: `The story does not substantively discuss the topic: ${topic.name}; it is absent or only incidentally mentioned.` },
  }));

  const matches = [];
  for (const topic of relevantTopics) {
    const found = await askInBatches(
      extension,
      (batch) => ({ topic: { name: topic.name, notes: topic.notes }, paragraphs: batch.map(({ text, index }) => ({ index, text })) }),
      paragraphs.map((text, index) => ({ text, index })),
      () => ({
        type: "noul",
        instructions: "Evaluate every paragraph in state and judge if any substantively discusses the user's topic. Ignore incidental mentions and generic shared words.",
        criteria: {
          true: `At least one of the numbered paragraphs substantively discusses ${topic.name}. User notes: ${topic.notes || "none"}.`,
          false: `None of the numbered paragraphs substantively discusses ${topic.name}. User notes: ${topic.notes || "none"}.`,
        },
      }),
    );
    if (found.length) matches.push({ name: topic.name, paragraphIndices: found.map((item) => item.index) });
  }
  return { matches };
}

