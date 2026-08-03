import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Shrinks a photo before it goes up the wire.
 *
 * A modern phone camera produces 3–5 MB per shot. Sent as-is, a chat photo
 * took about a minute to appear on the other side — the thread showed a black
 * rectangle for that whole time, which reads as a broken image rather than a
 * slow one. Nothing in this app is ever viewed larger than a phone screen, so
 * the extra pixels buy nothing and cost the wait.
 *
 * 1600px on the long edge keeps a nameplate or a serial number readable when
 * the viewer zooms — that is what these photos are FOR — while landing around
 * 200–400 KB.
 */
const MAX_EDGE = 1600;
const QUALITY = 0.75;

export interface PickedImage {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  width?: number;
  height?: number;
}

export async function shrinkForUpload(image: PickedImage): Promise<PickedImage> {
  try {
    const longest = Math.max(image.width ?? 0, image.height ?? 0);

    // Already small: re-encoding would only lose quality for nothing.
    if (longest > 0 && longest <= MAX_EDGE) return image;

    const landscape = (image.width ?? 0) >= (image.height ?? 0);
    const resize = landscape ? { width: MAX_EDGE } : { height: MAX_EDGE };

    const result = await ImageManipulator.manipulateAsync(
      image.uri,
      [{ resize }],
      { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG }
    );

    return {
      uri: result.uri,
      fileName: image.fileName ?? 'photo.jpg',
      mimeType: 'image/jpeg',
      width: result.width,
      height: result.height,
    };
  } catch {
    // Never block a send on this. A slow upload beats a lost message, and the
    // server accepts the original size anyway.
    return image;
  }
}
