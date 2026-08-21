/*
 * Shared types for selecting installed extensions through the chat
 * input's slash-command menu.
 */
export type AvailableExtensionCommand = {
  id: string;
  title: string;
  description?: string;
};

export type AvailableExtension = {
  id: string;
  name: string;
  description: string;
  /*
   * Absolute path to the installed extension directory. It is kept so
   * the agent can run the extension command later.
   */
  path: string;
  commands: AvailableExtensionCommand[];
};

export type SelectedExtension = {
  id: string;
  name: string;
  path: string;
};
