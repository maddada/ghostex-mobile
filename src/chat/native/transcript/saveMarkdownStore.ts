/**
 * The Markdown a reply's Save to md handed the core (`markdownSaveOpen`). The core keeps it to
 * write the file and does not put it in the document, so the dialog's Share reads it from here.
 */

import { create } from 'zustand';

export const useSaveMarkdownSource = create<{ markdown: string | null }>(() => ({ markdown: null }));

export function rememberSaveMarkdown(markdown: string): void {
  useSaveMarkdownSource.setState({ markdown });
}
