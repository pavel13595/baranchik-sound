const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg'];
const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex < 0 ? '' : fileName.slice(dotIndex).toLowerCase();
}

export function isAudioFile(file: Pick<File, 'name' | 'type'>): boolean {
  const extension = getFileExtension(file.name);
  return (
    AUDIO_EXTENSIONS.indexOf(extension) >= 0 || file.type.toLowerCase().indexOf('audio/') === 0
  );
}

export function getAudioMime(file: Pick<File, 'name' | 'type'>): string {
  if (file.type.toLowerCase().indexOf('audio/') === 0) {
    return file.type;
  }
  return AUDIO_MIME_TYPES[getFileExtension(file.name)] || file.type;
}
