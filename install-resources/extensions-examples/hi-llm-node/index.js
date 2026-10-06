import { createExtension } from "@mocu/extension-sdk";

const extension = createExtension({
  commands: {
    async hi() {
      const result = await extension.llm.generate({
        prompt: "hi",
        systemPrompt: "You are a friendly, concise assistant. Reply briefly.",
      });
      return result.text;
    },

    async agentPipeline(input) {
      const agents = await extension.agents.list();
      const structure = agents.find((agent) => agent.name === "Structure");
      const planning = agents.find((agent) => agent.name === "Planning");
      if (!structure || !planning) {
        throw new Error('Create saved agents named "Structure" and "Planning" first.');
      }

      const analysis = await extension.agents.run({
        agentId: structure.id,
        input: `Analyze this project or request:\n${JSON.stringify(input)}`,
      });
      const plan = await extension.agents.run({
        agentId: planning.id,
        input: `Create an actionable plan using this analysis:\n${analysis.text}`,
      });
      return { analysis: analysis.text, plan: plan.text };
    },
  },
});

extension.start();
