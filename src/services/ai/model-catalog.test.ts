import { describe, expect, it } from 'vitest';
import { modelSupportsImageInput, parseGatewayModels } from './model-catalog';

describe('model image capabilities', () => {
  it('reads image input modalities and rejects text-only advertised models', () => {
    const models = parseGatewayModels({ data: [
      { id: 'custom-vision', architecture: { input_modalities: ['text', 'image'] } },
      { id: 'gpt-4o', architecture: { input_modalities: ['text'] } },
    ] });
    expect(modelSupportsImageInput('custom-vision', models)).toBe(true);
    expect(modelSupportsImageInput('gpt-4o', models)).toBe(false);
  });
  it('does not confuse image generation with image input', () => {
    const models = parseGatewayModels([
      { id: 'generator', architecture: { modality: 'text->image' } },
      { id: 'reader', architecture: { modality: 'text+image->text' } },
    ]);
    expect(modelSupportsImageInput('generator', models)).toBe(false);
    expect(modelSupportsImageInput('reader', models)).toBe(true);
  });
  it('supports explicit gateway flags and parameters', () => {
    const models = parseGatewayModels([
      { id: 'one', supports_vision: true },
      { id: 'two', capabilities: { vision: true } },
      { id: 'three', supported_parameters: ['image_url'] },
      { id: 'gpt-4o', supports_images: false },
    ]);
    expect(models.filter((model) => model.supportsImages).length).toBe(3);
    expect(modelSupportsImageInput('gpt-4o', models)).toBe(false);
  });
  it.each(['openai/gpt-4o-mini', 'gpt-4.1', 'claude-sonnet-4-5', 'gemini-2.5-pro', 'qwen2.5-vl-72b-instruct'])
    ('recognizes known vision model %s when metadata is absent', (id) => {
      expect(modelSupportsImageInput(id, [{ id }])).toBe(true);
    });
  it.each(['gpt-3.5-turbo', 'gpt-4', 'o3-mini', 'o1-preview', 'gpt-4o-mini-transcribe', 'unknown-custom'])
    ('does not infer image support for %s', (id) => {
      expect(modelSupportsImageInput(id)).toBe(false);
    });
});
