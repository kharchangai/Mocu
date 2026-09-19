/*
 * Shared types for selecting MCP servers through the chat input's
 * slash-command menu.
 */
export type AvailableMcpServer = {
  id: string;
  name: string;
  description: string;
};

export type SelectedMcpServer = {
  id: string;
  name: string;
};
