(() => {
  "use strict";

  const button = document.getElementById("ask-ai-toggle");
  const panel = document.getElementById("ask-ai-panel");
  const closeButton = document.getElementById("ask-ai-close");
  const form = document.getElementById("ask-ai-form");
  const input = document.getElementById("ask-ai-input");
  const sendButton = document.getElementById("ask-ai-send");
  const messages = document.getElementById("ask-ai-messages");
  if (!button || !panel || !closeButton || !form || !input || !sendButton || !messages) return;

  let pending = false;

  function appendMessage(role, text, isError = false) {
    messages.querySelector(".ask-ai-empty")?.remove();
    const message = document.createElement("div");
    message.className = `ask-ai-message ask-ai-message-${role}${isError ? " ask-ai-message-error" : ""}`;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
    return message;
  }

  function attachAudio(message, audioData, mimeType, spokenText) {
    const binary = atob(audioData);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const audioUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType || "audio/mpeg" }));
    const player = new Audio(audioUrl);
    player.addEventListener("ended", () => URL.revokeObjectURL(audioUrl), { once: true });
    player.addEventListener("error", () => URL.revokeObjectURL(audioUrl), { once: true });

    const controls = document.createElement("div");
    controls.className = "ask-ai-audio-controls";
    const replay = document.createElement("button");
    replay.type = "button";
    replay.className = "ask-ai-replay";
    replay.textContent = `▶ Play pronunciation${spokenText ? `: ${spokenText}` : ""}`;
    replay.addEventListener("click", () => {
      player.currentTime = 0;
      void player.play().catch(() => {});
    });
    controls.appendChild(replay);
    message.appendChild(controls);
    void player.play().catch(() => {});
  }

  function setOpen(open) {
    panel.classList.toggle("hidden", !open);
    button.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
  }

  function activeScreenContext() {
    const practice = document.body.classList.contains("practice-mode");
    const context = { screen: practice ? "Focused practice" : "Conversation", activeMode: practice ? "practice" : "conversation" };
    const title = document.getElementById("conv-title")?.textContent?.trim();
    if (title) context.conversationTitle = title;
    const topic = document.getElementById("conversation-topic")?.value?.trim();
    if (topic) context.conversationTopic = topic;
    const challenge = document.getElementById("custom-practice-topic")?.value?.trim();
    if (challenge) context.practiceChallenge = challenge;
    const transcript = document.getElementById("transcript");
    if (transcript && !transcript.closest(".hidden")) {
      context.recentConversation = Array.from(transcript.querySelectorAll(":scope > .msg")).slice(-12).map((item) => ({
        speaker: item.classList.contains("user") ? "Learner" : "Coach",
        text: item.querySelector(".msg-text")?.textContent?.trim() || "",
      })).filter((item) => item.text);
    }
    const lastTurn = document.getElementById("you-said")?.textContent?.trim();
    if (lastTurn && !["Nothing recorded yet.", "No speech recorded yet.", "—"].includes(lastTurn)) context.lastLearnerTurn = lastTurn;
    const tip = document.getElementById("grammar")?.textContent?.trim();
    if (tip) context.currentGrammarTip = tip;
    return context;
  }
  function isAudioRequest(question) {
    return /\b(?:pronounc(?:e|ed|iation)|pronunciation)\b/i.test(question)
      || /\b(?:hear|listen to|say|speak|read|play)\b.{0,60}\b(?:aloud|out loud|pronunciation|pronounce|word|phrase|it|this|that)\b/i.test(question)
      || /\b(?:can|could|would)\s+you\s+(?:say|speak|read)\b/i.test(question)
      || /\bhow\s+(?:do|would|can)\s+you\s+say\b/i.test(question);
  }
  async function submitQuestion(event) {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || pending || typeof window.mocu?.extension?.execute !== "function") return;

    pending = true;
    input.value = "";
    input.disabled = true;
    sendButton.disabled = true;
    appendMessage("user", question);
    const answerMessage = appendMessage("assistant", "Thinking…");
    try {
      const audioRequest = isAudioRequest(question);
      const result = await window.mocu.extension.execute("ask-ai", {
        question,
        context: activeScreenContext(),
        tts: audioRequest,
        spokenText: question,
      }, { timeoutMs: 180_000 });
      const answer = typeof result === "string" ? result : result && typeof result.text === "string" ? result.text : "";
      if (!answer.trim() && !audioRequest) throw new Error("Ask AI returned no answer.");
      if (answer.trim()) answerMessage.textContent = answer.trim();
      if (audioRequest && result && typeof result.audio === "string" && result.audio) {
        attachAudio(answerMessage, result.audio, result.mimeType, result.spokenText);
      }
    } catch (error) {
      answerMessage.classList.add("ask-ai-message-error");
      answerMessage.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      pending = false;
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  button.addEventListener("click", () => setOpen(panel.classList.contains("hidden")));
  closeButton.addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", (event) => void submitQuestion(event));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.classList.contains("hidden")) {
      setOpen(false);
      button.focus();
    }
  });
})();
