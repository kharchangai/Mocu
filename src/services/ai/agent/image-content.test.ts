import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

vi.mock('../model-catalog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../model-catalog')>(),
  listGatewayModels: vi.fn(),
}));
import { listGatewayModels } from '../model-catalog';
import {
  assertImageModelSupport, buildHumanMessageFromRequest,
  buildHumanMessageWithImages, getImageRequestText, hasImageInput,
} from './image-content';

const attachments = Array.from({ length: 3 }, (_, index) => ({
  id: String(index), name: `image-${index}.jpg`, mimeType: 'image/jpeg',
  dataUrl: `data:image/jpeg;base64,aW1hZ2U${index}`,
}));

beforeEach(() => { vi.mocked(listGatewayModels).mockResolvedValue([]); });

describe('multimodal user messages', () => {
  it('keeps text-only requests unchanged', () => {
    const message = buildHumanMessageWithImages('hello', []);
    expect(message.content).toBe('hello');
    expect(hasImageInput(message)).toBe(false);
  });
  it('sends text and all three images in one human message', () => {
    const message = buildHumanMessageWithImages('Compare these', attachments);
    expect(message.content).toEqual([
      { type: 'text', text: 'Compare these' },
      ...attachments.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
    ]);
    expect(getImageRequestText(message)).toBe('Compare these');
  });
  it('supports image-only messages without leaking base64 into memory text', () => {
    const message = buildHumanMessageWithImages('', attachments);
    expect(getImageRequestText(message)).toBe('Describe the attached images.');
    expect(hasImageInput(message)).toBe(true);
    expect(getImageRequestText(new AIMessage('answer'))).toBe('');
  });
  it('preserves images when agents rebuild initial and final-summary prompts', () => {
    const message = buildHumanMessageWithImages('original', attachments);
    const rebuilt = buildHumanMessageFromRequest('tool summary', message);
    expect(rebuilt.content).toEqual([
      { type: 'text', text: 'tool summary' },
      ...(message.content as unknown[]).slice(1),
    ]);
    expect(message.content).not.toEqual(rebuilt.content);
  });
  it('rejects image requests for non-vision models', async () => {
    await expect(assertImageModelSupport('gpt-3.5-turbo', buildHumanMessageWithImages('hi', attachments)))
      .rejects.toThrow('does not support image input');
  });
  it('honors advertised vision support for custom model names', async () => {
    vi.mocked(listGatewayModels).mockResolvedValue([{ id: 'custom-vision', supportsImages: true }]);
    await expect(assertImageModelSupport('custom-vision', buildHumanMessageWithImages('', attachments)))
      .resolves.toBeUndefined();
  });
  it('uses known model capability if the model endpoint is unavailable', async () => {
    vi.mocked(listGatewayModels).mockRejectedValue(new Error('offline'));
    await expect(assertImageModelSupport('gpt-4o', buildHumanMessageWithImages('', attachments)))
      .resolves.toBeUndefined();
  });
  it('does not fetch capabilities on text-only requests', async () => {
    vi.mocked(listGatewayModels).mockClear();
    await assertImageModelSupport('anything', new HumanMessage('text'));
    expect(listGatewayModels).not.toHaveBeenCalled();
  });
});
