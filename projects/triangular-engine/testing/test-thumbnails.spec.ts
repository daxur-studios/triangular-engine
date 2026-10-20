import { encodeThumbnailUploads, keepThumbnails, MAX_CASE_THUMBNAILS, MAX_RUN_THUMBNAIL_BYTES, MAX_THUMBNAIL_BYTES } from './test-thumbnails';

const image = (bytes: number, type = 'image/webp') => new Blob([new Uint8Array(bytes)], { type });

describe('test thumbnails', () => {
  it('keeps small images and says why it dropped the rest', () => {
    const kept = keepThumbnails([image(10), image(MAX_THUMBNAIL_BYTES + 1), image(0), image(20)]);
    expect(kept.images.map((blob) => blob.size)).toEqual([10, 20]);
    expect(kept.bytes).toBe(30);
    expect(kept.notes.length).toBe(2);
    expect(kept.notes[0]).toContain('over 64 KB');
  });

  it('stops at the case and run limits', () => {
    expect(keepThumbnails(Array.from({ length: MAX_CASE_THUMBNAILS + 1 }, () => image(5))).images.length).toBe(MAX_CASE_THUMBNAILS);
    const nearlyFull = MAX_RUN_THUMBNAIL_BYTES - 15;
    const kept = keepThumbnails([image(10), image(10)], nearlyFull);
    expect(kept.images.length).toBe(1);
    expect(kept.notes[0]).toContain('used up');
  });

  it('encodes the bytes as base64 with the case, repetition and index the receiver names the file by', async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 255, 0, 1]);
    const [upload] = await encodeThumbnailUploads([{ scenarioId: 'orbit', repetition: 2, images: [new Blob([bytes], { type: 'image/webp' })] }]);
    expect(upload).toEqual({ case: 'orbit', repetition: 2, index: 0, type: 'image/webp', data: btoa(String.fromCharCode(...bytes)) });
  });
});
