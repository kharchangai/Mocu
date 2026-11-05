import { invoke } from '@tauri-apps/api/core';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export type DesktopNotificationInput = {
  title?: string;
  body?: string;
  icon?: string;
  html?: string;
  css?: string;
  javascript?: string;
  sound?: string;
  position?: 'top-left' | 'top-center' | 'top-right' | 'center' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'custom';
  monitorIndex?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  durationMs?: number;
};

export async function showDesktopNotification(input: DesktopNotificationInput): Promise<string> {
  return invoke<string>('show_desktop_notification', { input });
}

export const desktopNotificationTool = tool(
  async (input) => {
    const id = await showDesktopNotification(input);
    return `Desktop notification displayed successfully (id: ${id}).`;
  },
  {
    name: 'desktop_notification',
    description: 'Displays a customizable desktop notification in a separate always-on-top Mocu window, even while Mocu is minimized. Supports title/body/icon, custom HTML/CSS/JavaScript (sandboxed), audio data URL, standard positions or absolute desktop coordinates, monitor selection, size, and duration. Icon-only notifications can be as small as 32x32 pixels (48x48 by default). Coordinates are physical desktop pixels; icon/sound must be data URLs.',
    schema: z.object({
      title: z.string().max(1000).optional(),
      body: z.string().max(5000).optional(),
      icon: z.string().max(1_500_000).optional().describe('Image data URL (data:image/...).'),
      html: z.string().max(100_000).optional().describe('Optional custom notification markup, rendered in an isolated sandboxed iframe.'),
      css: z.string().max(100_000).optional(),
      javascript: z.string().max(100_000).optional().describe('Optional custom JavaScript, executed only inside the isolated sandboxed notification iframe.'),
      sound: z.string().max(12_000_000).optional().describe('Optional audio data URL (data:audio/...).'),
      position: z.enum(['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right', 'custom']).optional(),
      monitorIndex: z.number().int().min(0).optional().describe('Zero-based display index; defaults to primary.'),
      x: z.number().int().optional().describe('Physical desktop X coordinate; required for custom position.'),
      y: z.number().int().optional().describe('Physical desktop Y coordinate; required for custom position.'),
      width: z.number().int().min(0).max(900).optional().describe('Requested width in pixels. Icon-only notifications can be as small as 32px; other notifications have a 250px minimum.'),
      height: z.number().int().min(0).max(700).optional().describe('Requested height in pixels. Icon-only notifications can be as small as 32px; other notifications have a 120px minimum.'),
      durationMs: z.number().int().min(0).max(86_400_000).optional().describe('Auto-dismiss delay; 0 keeps the notification open until dismissed.'),
    }),
  },
);
