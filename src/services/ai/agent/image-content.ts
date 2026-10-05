import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import type { ChatImageAttachment } from '../../../chat/types/imageAttachment';
import { listGatewayModels, modelSupportsImageInput } from '../model-catalog';
import { getTextContent } from './helpers';

type ImageHumanContent = Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
>;

export const buildHumanMessageWithImages = (
  text: string,
  attachments: ChatImageAttachment[],
): HumanMessage => {
  if (attachments.length === 0) {
    return new HumanMessage(text);
  }

  const content: ImageHumanContent = [];
  if (text.trim()) {
    content.push({ type: 'text', text });
  }

  for (const attachment of attachments) {
    content.push({
      type: 'image_url',
      image_url: { url: attachment.dataUrl },
    });
  }

  return new HumanMessage({ content });
};

const getImageBlocks = (message?: BaseMessage): ImageHumanContent =>
  message?.getType() === 'human' && Array.isArray(message.content)
    ? message.content.filter((block) => block.type === 'image_url') as ImageHumanContent
    : [];

export const hasImageInput = (message?: BaseMessage): boolean =>
  getImageBlocks(message).length > 0;

/** Text stays separate for memory/routing; image-only requests still have a goal. */
export const getImageRequestText = (message?: BaseMessage): string => {
  if (message?.getType() !== 'human') return '';
  return getTextContent(message.content).trim() ||
    (hasImageInput(message) ? 'Describe the attached images.' : '');
};

/** Rebuilding a prompt (including a final tool summary) must not lose its images. */
export const buildHumanMessageFromRequest = (
  text: string,
  source?: BaseMessage,
): HumanMessage => {
  const images = getImageBlocks(source);
  return images.length
    ? new HumanMessage({ content: [{ type: 'text', text }, ...images] })
    : new HumanMessage(text);
};

export const assertImageModelSupport = async (
  modelId: string,
  message?: BaseMessage,
): Promise<void> => {
  if (!hasImageInput(message)) return;
  let models: Awaited<ReturnType<typeof listGatewayModels>> = [];
  try {
    models = await listGatewayModels();
  } catch {
    // OpenAI-compatible model lists often omit capabilities or are unavailable.
    // Known vision families can still be used; unknown models fail explicitly.
  }
  if (!modelSupportsImageInput(modelId, models)) {
    throw new Error(`Model "${modelId}" does not support image input or its capability is unknown. Choose a vision-capable model or remove the attached images.`);
  }
};