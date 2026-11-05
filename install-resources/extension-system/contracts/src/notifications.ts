export const NOTIFICATION_SHOW_METHOD = "mocu.notification.show" as const;

export interface DesktopNotificationParams {
  title?: string;
  body?: string;
  icon?: string;
  html?: string;
  css?: string;
  javascript?: string;
  sound?: string;
  position?: "top-left" | "top-center" | "top-right" | "center" | "bottom-left" | "bottom-center" | "bottom-right" | "custom";
  monitorIndex?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  durationMs?: number;
}
