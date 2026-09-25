/**
 * Shapes gxserver's flat Docs list into what the phone shows: a folder tree holding only the
 * Markdown and HTML files the viewer can open (gxserver also lists images, text and drawings inside
 * Docs folders), folders that end up empty dropped, and a short "recently changed" list.
 */

import type { DocsEntry } from './client';
import { docKindForPath, type DocKind } from './paths';

export type DocsFileNode = {
  kind: 'file';
  path: string;
  name: string;
  docKind: DocKind;
  modifiedAt: number | null;
  size: number | null;
  /** What a human is shown as the file's location (the mount's own name, never the reserved segment). */
  displayPath: string;
};

export type DocsFolderNode = {
  kind: 'directory';
  path: string;
  name: string;
  displayPath: string;
  children: DocsNode[];
  /** Files anywhere below, for the folder row's count. */
  fileCount: number;
};

export type DocsNode = DocsFileNode | DocsFolderNode;

function parentPath(path: string): string | null {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? null : path.slice(0, slash);
}

function timestamp(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Builds the tree in gxserver's order (folders first, then names), keeping only documents. */
export function buildDocsTree(entries: readonly DocsEntry[]): DocsNode[] {
  const roots: DocsNode[] = [];
  const folders = new Map<string, DocsFolderNode>();
  const attach = (node: DocsNode) => {
    const parent = parentPath(node.path);
    const folder = parent === null ? undefined : folders.get(parent);
    (folder?.children ?? roots).push(node);
  };
  for (const entry of entries) {
    const displayPath = entry.displayPath ?? entry.path;
    if (entry.kind === 'directory') {
      const folder: DocsFolderNode = {
        kind: 'directory',
        path: entry.path,
        name: entry.name,
        displayPath,
        children: [],
        fileCount: 0,
      };
      folders.set(entry.path, folder);
      attach(folder);
      continue;
    }
    const docKind = docKindForPath(entry.name);
    if (docKind === null) continue;
    attach({
      kind: 'file',
      path: entry.path,
      name: entry.name,
      docKind,
      modifiedAt: timestamp(entry.modifiedAt),
      size: entry.size,
      displayPath,
    });
  }
  return prune(roots);
}

function prune(nodes: DocsNode[]): DocsNode[] {
  const kept: DocsNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'file') {
      kept.push(node);
      continue;
    }
    node.children = prune(node.children);
    node.fileCount = node.children.reduce((count, child) => count + (child.kind === 'file' ? 1 : child.fileCount), 0);
    if (node.fileCount > 0) kept.push(node);
  }
  return kept;
}

export function flattenDocsFiles(nodes: readonly DocsNode[]): DocsFileNode[] {
  const files: DocsFileNode[] = [];
  const walk = (list: readonly DocsNode[]) => {
    for (const node of list) {
      if (node.kind === 'file') files.push(node);
      else walk(node.children);
    }
  };
  walk(nodes);
  return files;
}

export function recentDocsFiles(files: readonly DocsFileNode[], limit: number): DocsFileNode[] {
  return files
    .filter((file) => file.modifiedAt !== null)
    .sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0))
    .slice(0, limit);
}

/** Every query word must appear in the file's shown path (case-insensitive). */
export function searchDocsFiles(files: readonly DocsFileNode[], query: string): DocsFileNode[] {
  const words = query.toLowerCase().split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) return [];
  return files.filter((file) => {
    const haystack = file.displayPath.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
