import { describe, expect, it } from 'vitest';
import { getAudioMime, isAudioFile } from './files';

function mockFile(name: string, type: string): Pick<File, 'name' | 'type'> {
  return { name, type };
}

describe('isAudioFile', () => {
  it('accepts an mp3 file with an empty MIME type', () => {
    expect(isAudioFile(mockFile('song.mp3', ''))).toBe(true);
  });

  it('accepts m4a files with the x-m4a MIME type', () => {
    expect(isAudioFile(mockFile('song.m4a', 'audio/x-m4a'))).toBe(true);
  });

  it('rejects text files', () => {
    expect(isAudioFile(mockFile('notes.txt', 'text/plain'))).toBe(false);
  });

  it('accepts files without an extension when their MIME type is audio', () => {
    expect(isAudioFile(mockFile('recording', 'audio/mpeg'))).toBe(true);
  });

  it('accepts uppercase extensions', () => {
    expect(isAudioFile(mockFile('TRACK.MP3', ''))).toBe(true);
  });

  it('infers MIME types from supported extensions when the file type is empty', () => {
    expect(getAudioMime(mockFile('song.mp3', ''))).toBe('audio/mpeg');
    expect(getAudioMime(mockFile('song.m4a', ''))).toBe('audio/mp4');
    expect(getAudioMime(mockFile('song.wav', ''))).toBe('audio/wav');
  });

  it('uses an inferred MIME type for audio extensions with a non-audio file type', () => {
    expect(getAudioMime(mockFile('TRACK.MP3', 'application/octet-stream'))).toBe('audio/mpeg');
  });
});
