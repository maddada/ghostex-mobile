/**
 * Exported pages on the phone (server/src/visual_pages/exported.rs): Export on a page card or the page sheet hands
 * the page's exported file, which the chat core read over the chat's own link (`exportPage`, gx-chat-core
 * `questions/page_export.rs`), to the iPhone's share sheet, or on Android saves it in a folder the person picks;
 * Import answers on a page card picks the `.json` an exported page gave and hands its text to the chat core's import
 * (`importPageAnswers`, `questions/page_import.rs`), which also takes the same text pasted into the chat box and sent.
 *
 * CDXC:SessionChat 2026-11-13 WHY:
 * Over-the-air only (user decision on gx-chat-core `questions/page_export.rs`): the iPhone shares through the app's
 * own `GhostexNative.shareFile` (as Files' Share… does, `files/shareSheet.ts`), and Android, which has no file share
 * module without a new dependency, writes the file through the system's folder picker (expo-file-system's
 * `Directory.pickDirectoryAsync`), so the person chooses Downloads or anywhere else. The picker for the answers is
 * expo-document-picker, already in the app.
 */

import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { GhostexNative } from '../../../../modules/ghostex-native/src';

/** The exported answers are at most this long (the core refuses longer). */
const ANSWERS_MAX_BYTES = 256 * 1024;
const EXPORT_FOLDER = 'page-export';

/** What `pageExported` carries. */
export type ExportedPageFile = { title: string; fileName: string; html: string };

export function readExportedPage(params: unknown): ExportedPageFile | null {
  const fields = (typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>;
  const html = typeof fields.html === 'string' ? fields.html : '';
  if (html.length === 0) return null;
  const title = typeof fields.title === 'string' && fields.title.length > 0 ? fields.title : 'Ghostex page';
  const named = typeof fields.fileName === 'string' ? fields.fileName.replace(/[\\/:*?"<>|]/gu, ' ').trim() : '';
  return { title, fileName: named.length > 0 ? named : 'ghostex-page.html', html };
}

/**
 * Shares (iPhone) or saves (Android) the exported page. Answers the notice to show once it is done, or `null` when
 * the person backed out.
 */
export async function shareExportedPage(page: ExportedPageFile): Promise<string | null> {
  if (Platform.OS === 'android') {
    let folder: Directory;
    try {
      folder = await Directory.pickDirectoryAsync();
    } catch {
      // The folder picker was closed without a choice.
      return null;
    }
    const file = folder.createFile(page.fileName, 'text/html');
    file.write(page.html);
    return `Saved ${page.fileName}. Send it to anyone; they open it in a browser and export their answers.`;
  }
  const root = new Directory(Paths.cache, EXPORT_FOLDER);
  if (root.exists) root.delete();
  root.create({ intermediates: true });
  const file = new File(root, page.fileName);
  file.create();
  file.write(page.html);
  try {
    // Settles once the share sheet is over, shared or cancelled.
    await GhostexNative.shareFile(file.uri);
  } finally {
    if (root.exists) root.delete();
  }
  return null;
}

/** Picks a `.json` file and answers its text, or `null` when nothing was picked or it is too large to be answers. */
export async function pickExportedAnswers(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain', '*/*'],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (asset === undefined) return null;
  const file = new File(asset.uri);
  if (file.size > ANSWERS_MAX_BYTES) throw new Error('This file is too large to be the answers of an exported page.');
  return await file.text();
}
