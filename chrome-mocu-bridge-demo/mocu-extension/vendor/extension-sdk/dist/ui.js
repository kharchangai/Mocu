import { HOST_METHODS } from "@mocu/extension-contracts";
/**
 * Chat UI APIs available to an extension command. Each prompt waits until the
 * user submits text or clicks one of its declared buttons.
 */
export class ExtensionUiApi {
    protocol;
    command;
    context;
    constructor(protocol, command, context) {
        this.protocol = protocol;
        this.command = command;
        this.context = context;
    }
    interact(options, signal) {
        return this.protocol.request(HOST_METHODS.extensionInteract, {
            command: this.command,
            context: this.context,
            ...options,
        }, null, signal);
    }
}
//# sourceMappingURL=ui.js.map