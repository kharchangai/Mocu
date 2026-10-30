import { ImageGenerationProgress } from './ImageGenerationProgress';

export function VideoGenerationProgress({ active }: { active: boolean }) {
  return <ImageGenerationProgress active={active} label="Creating video" />;
}
