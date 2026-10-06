import { createExtension } from "@mocu/extension-sdk";

const extension = createExtension({
  commands: {
    async analyzeAndPlan(input) {
      const agents = await extension.agents.list();
      const analysisAgent = agents.find((agent) => agent.name === "Structure");
      const planningAgent = agents.find((agent) => agent.name === "Planning");
      if (!analysisAgent || !planningAgent) {
        throw new Error('The user needs saved agents named "Structure" and "Planning".');
      }

      const analysis = await extension.agents.run({
        agentId: analysisAgent.id,
        input: `Analyze the supplied project/task:\n${JSON.stringify(input)}`,
      });
      const plan = await extension.agents.run({
        agentId: planningAgent.id,
        input: `Create a plan from this analysis:\n${analysis.text}`,
      });
      return { analysis: analysis.text, plan: plan.text };
    },
  },
});

extension.start();
