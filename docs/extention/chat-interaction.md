# User Interaction in Mocu Chat

Extensions can pause a running command, display creator-defined buttons in the
chat, and optionally route the chat composer text directly to the extension.
The input and button result is returned to that command; it is not submitted as
a new request to the main agent. After the extension finishes, its command
result returns to the agent normally.

## Enable the capability

Mark the command `interactive: true` in `manifest.json`. Interactive commands
should normally use `timeoutSeconds: 0`, since a person may take longer than
the default 900-second command timeout to reply.

```json
{
  "commands": [
    {
      "id": "guided-task",
      "title": "Guided task",
      "description": "Runs a task with user choices.",
      "interactive": true,
      "timeoutSeconds": 0
    }
  ]
}
```

## Node SDK

The SDK adds `context.mocu.ui.interact()` to each command's `context` object.
Each call displays one interaction card and resolves when the user clicks a
button or submits text. Call it again to ask another question or show the next
set of controls. Node extensions can pass an `AbortSignal` as the second
argument; aborting it closes the card if the extension's background work
finishes first.

```js
import { createExtension } from "@mocu/extension-sdk";

const extension = createExtension({
  commands: {
    async "guided-task"(input, context) {
      const choice = await context.mocu.ui.interact({
        title: "Choose how to continue",
        message: "This response is delivered to the extension only.",
        input: true,
        inputPlaceholder: "Add instructions…",
        buttons: [
          { id: "continue", label: "Continue", variant: "primary" },
          { id: "restart", label: "Start over" },
          { id: "cancel", label: "Cancel", variant: "danger" },
        ],
      });

      if (choice.actionId === "cancel") return { cancelled: true };
      if (choice.actionId === "restart") return { restarted: true };
      return { action: choice.actionId, userInput: choice.input ?? "" };
    },
  },
});

extension.start();
```

The returned value is `{ actionId, input? }`. Text submitted through the
composer uses the action id `__input__`; a clicked button returns that button's
`id`. Button identifiers should be unique within a prompt. Mocu displays up to
eight buttons. Button semantics are extension-defined: for example, a `cancel`
button only cancels work when the command handles that result and exits or
updates its own task. A `restart` button can reset extension state and then
continue the command.

For live controls during ongoing work, race the interaction against the
background work. Node extensions pass an `AbortSignal`; Python extensions pass
a `threading.Event` as `cancel_event`. When work finishes, cancel the
interaction to dismiss the card; when the user responds, handle the returned
input/button and continue, steer, or stop the work as appropriate. The extension remains responsible for acting
on the returned button/input; Mocu does not terminate an extension process for
a creator-defined action.

## Python SDK

```python
from mocu_extension_sdk import create_extension

extension = create_extension()

@extension.command("guided-task")
def guided_task(input_value, context, config):
    choice = context["mocu"]["ui"].interact(
        title="Choose how to continue",
        message="Your reply is sent to this extension, not the main agent.",
        input=True,
        input_placeholder="Add instructions…",
        buttons=[
            {"id": "continue", "label": "Continue", "variant": "primary"},
            {"id": "restart", "label": "Start over"},
            {"id": "cancel", "label": "Cancel", "variant": "danger"},
        ],
    )
    if choice["actionId"] == "cancel":
        return {"cancelled": True}
    return {"action": choice["actionId"], "userInput": choice.get("input", "")}

extension.run()
```

Pass a `threading.Event` through the optional `cancel_event=` argument when a
Python extension is racing this prompt against background work. Setting the
event dismisses the interaction card.

## Behavior and limits

- The interaction is associated with the chat that started the extension tool.
  Switching chats does not redirect the user's response to a different run.
- While a prompt is active, the chat composer is enabled only when the
  extension set `input: true`. Submitting that text answers the extension
  prompt instead of invoking the agent.
- Buttons are defined by the extension for each prompt, so creators can offer
  cancel, stop, restart, approval, or any other action. The extension decides
  what each action does; Mocu does not kill the extension process for a
  creator-defined button.
- A prompt needs either `input: true` or at least one button. Button labels and
  messages are displayed as text; no extension-provided HTML is rendered.
- The command must declare `interactive: true`; requests from commands without
  the capability are rejected by the host.

See [manifest-reference.md](manifest-reference.md), [node-sdk.md](node-sdk.md),
and [python-sdk.md](python-sdk.md) for the related command and SDK details.
