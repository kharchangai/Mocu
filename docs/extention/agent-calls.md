# Calling saved user agents from an extension

Extensions can ask the Mocu host to run one of the current user's saved agents. The extension does not need to bundle or call a language model itself: the host runs the agent through Mocu's existing agent runner and returns the completed response.

## Permission

Declare the capability in the extension's `manifest.json`:

```json
{
  "permissions": ["agents.invoke"]
}
```

Without this declaration, `agents.list()` and `agents.run()` are rejected by the host. Only agents belonging to the current user's Mocu installation can be selected. An extension cannot provide a project path or override the agent's model/tools.

## Node SDK

```js
import { createExtension } from "@mocu/extension-sdk";

const extension = createExtension({
  commands: {
    async summarizeAndPlan(input) {
      const agents = await extension.agents.list();
      const structureAgent = agents.find((agent) => agent.name === "Structure");
      const planningAgent = agents.find((agent) => agent.name === "Planning");
      if (!structureAgent || !planningAgent) {
        throw new Error("Create the Structure and Planning agents first.");
      }

      const structure = await extension.agents.run({
        agentId: structureAgent.id,
        input: `Analyze this project: ${input}`,
      });
      const plan = await extension.agents.run({
        agentId: planningAgent.id,
        input: `Create a plan based on this analysis:\n${structure.text}`,
      });
      return { structure: structure.text, plan: plan.text };
    },
  },
});

extension.start();
```

The calls are awaited in sequence, so each response is available for composing the next agent's input. An extension may run any number of sequential calls supported by the host's regular command timeout.

## Python SDK

```python
from mocu_extension_sdk import create_extension

extension = create_extension()

@extension.command("summarize-and-plan")
def summarize_and_plan(input_value, context, config):
    agents = extension.agents.list()
    structure = next(agent for agent in agents if agent["name"] == "Structure")
    planning = next(agent for agent in agents if agent["name"] == "Planning")

    analysis = extension.agents.run(
        structure["id"], f"Analyze this project: {input_value}"
    )
    plan = extension.agents.run(
        planning["id"], f"Create a plan based on this analysis:\n{analysis['text']}"
    )
    return {"structure": analysis["text"], "plan": plan["text"]}

extension.run()
```

## API and behavior

- `extension.agents.list()` returns only `{ id, name, description }` for saved agents.
- `extension.agents.run({ agentId, input }, options?)` returns `{ agentId, name, text }` after completion.
- Calls are stateless agent runs: include all context needed by each agent in its input. Pass the previous result explicitly to the next call.
- Node `options` accepts `timeoutMs` and `signal`; Python accepts `timeout` and `cancel_event`. By default the agent call has no SDK-side timeout, while the containing extension command still obeys its manifest `timeoutSeconds`.
- Errors (missing permission, missing agent, empty/too-long input, or agent failure) reject/raise normally and can be caught by the extension command.
- The host executes the user agent; configured model/provider credentials stay in Mocu and are never exposed to the extension.
