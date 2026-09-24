/**
 * The phone's attachment sources for the composer's paperclip: the photo library, the camera and
 * the Files picker, the same pickers the terminal's attach flow uses
 * (`src/components/terminal/uploads.ts`). Picked files go to the host's `attachFiles`, which
 * uploads them and has the core insert their reference pills.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

export type AttachSource = 'library' | 'camera' | 'files';

export type PickedFile = { uri: string; name?: string };

function imageName(asset: ImagePicker.ImagePickerAsset, index: number): string | undefined {
  if (typeof asset.fileName === 'string' && asset.fileName.trim().length > 0) return asset.fileName;
  const fromUri = asset.uri.split('?')[0]?.split('/').pop()?.trim() ?? '';
  if (fromUri.length > 0) return fromUri;
  const subtype = asset.mimeType?.startsWith('image/') === true ? asset.mimeType.slice('image/'.length) : 'jpg';
  return `image-${index + 1}.${subtype === 'jpeg' ? 'jpg' : subtype}`;
}

/** Opens one picker; resolves the picked files, or `[]` when the user cancelled. */
export async function pickAttachments(source: AttachSource): Promise<PickedFile[]> {
  if (source === 'files') {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return [];
    return result.assets.map((asset) => ({ uri: asset.uri, name: asset.name }));
  }
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Ghostex needs camera access to take a photo. Turn it on in Settings.');
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
    ...(source === 'library' ? { allowsMultipleSelection: true, selectionLimit: 10 } : {}),
  };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return [];
  return (result.assets ?? []).map((asset, index) => {
    const name = imageName(asset, index);
    return name !== undefined ? { uri: asset.uri, name } : { uri: asset.uri };
  });
}
