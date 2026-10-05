import type { ChatImageAttachment } from '../types/imageAttachment';

export const MAX_IMAGE_COUNT = 3;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1920;
const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const imageMimeType = (file: Pick<File, 'type' | 'name'>): string => {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.toLowerCase().split('.').pop();
  return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
    : extension === 'png' ? 'image/png'
    : extension === 'webp' ? 'image/webp'
    : extension === 'gif' ? 'image/gif' : '';
};

export const imageFileFromBytes = (path: string, bytes: Uint8Array): File => {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const type = imageMimeType({ name, type: '' });
  if (!type) throw new Error(`"${name}" is not a supported image. Choose PNG, JPG, WEBP, or GIF.`);
  return new File([new Uint8Array(bytes)], name, { type });
};
const createId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const readAndCompressImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      try {
        URL.revokeObjectURL(sourceUrl);
        const scale = Math.min(
          1,
          MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');

        if (!context) {
          reject(new Error(`Could not process image "${file.name}".`));
          return;
        }

        // JPEG gives gateways a broadly supported format and keeps stored turns small.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      } catch {
        reject(new Error(`Could not process image "${file.name}".`));
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error(`Could not read image "${file.name}".`));
    };

    image.src = sourceUrl;
  });

export const prepareImageAttachments = async (
  files: File[],
  currentCount: number,
): Promise<ChatImageAttachment[]> => {
  const acceptedFiles: File[] = [];
  const errors: string[] = [];
  const availableSlots = Math.max(0, MAX_IMAGE_COUNT - currentCount);

  for (const file of files) {
    if (!ACCEPTED_IMAGE_TYPES.has(imageMimeType(file))) {
      errors.push(`"${file.name}" is not a supported image. Choose PNG, JPG, WEBP, or GIF.`);
      continue;
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      errors.push(`"${file.name}" must be a non-empty image smaller than 20 MB.`);
      continue;
    }
    if (acceptedFiles.length >= availableSlots) {
      errors.push('You can attach up to 3 images per message.');
      break;
    }
    acceptedFiles.push(file);
  }

  // Validate before decoding anything; failed selection leaves existing images intact.
  if (errors.length > 0) throw new Error(errors.join(' '));
  const attachments = await Promise.all(
    acceptedFiles.map(async (file) => ({
      id: createId(),
      name: file.name,
      mimeType: 'image/jpeg',
      dataUrl: await readAndCompressImage(file),
    })),
  );

  return attachments;
};
