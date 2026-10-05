import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageFileFromBytes, prepareImageAttachments } from './imageAttachments';

const jpeg = 'data:image/jpeg;base64,aW1hZ2U=';
const revoke = vi.fn();
const draw = vi.fn();
const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: draw }), toDataURL: () => jpeg };

beforeEach(() => {
  vi.stubGlobal('Image', class {
    naturalWidth = 4000;
    naturalHeight = 2000;
    onload?: () => void;
    onerror?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const image = (name = 'photo.png') => new File(['image'], name, { type: 'image/png' });

describe('image attachments', () => {
  it('prepares three compressed images', async () => {
    const result = await prepareImageAttachments([image(), image(), image()], 0);
    expect(result).toHaveLength(3);
    expect(new Set(result.map((item) => item.id)).size).toBe(3);
    expect(result[0]).toMatchObject({ name: 'photo.png', mimeType: 'image/jpeg', dataUrl: jpeg });
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(960);
  });
  it('rejects a fourth image before allocating object URLs', async () => {
    await expect(prepareImageAttachments([image(), image()], 2)).rejects.toThrow('up to 3');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('rejects non-image and empty files', async () => {
    await expect(prepareImageAttachments([new File(['text'], 'doc.txt', { type: 'text/plain' })], 0))
      .rejects.toThrow('not a supported image');
    await expect(prepareImageAttachments([new File([], 'empty.png', { type: 'image/png' })], 0))
      .rejects.toThrow('non-empty');
  });
  it('converts Windows native drops to browser files with the right type', () => {
    const file = imageFileFromBytes('C:\\Photos\\test.JPG', new Uint8Array([1, 2, 3]));
    expect(file.name).toBe('test.JPG');
    expect(file.type).toBe('image/jpeg');
    expect(() => imageFileFromBytes('C:\\doc.txt', new Uint8Array([1]))).toThrow('not a supported image');
  });
  it('reports corrupt images and releases the object URL', async () => {
    vi.stubGlobal('Image', class {
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    });
    await expect(prepareImageAttachments([image()], 0)).rejects.toThrow('Could not read image');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
