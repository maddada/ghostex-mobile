// Scratch preview for simulator screenshots of the composer (not committed). Load with the dev client:
// http://localhost:8081/src/chat/native/composer/__preview__.bundle?platform=ios&dev=true
import { useMemo, useRef, useState } from 'react';
import { AppRegistry, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ComposerModel, type ComposerModelState } from '../../rust/composer';
import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import data from './__preview-data__.json';
import { MenuSheet } from './MenuSheet';
import { ModelMenuSheet } from './ModelMenuSheet';
import { moreActionsRows } from './menus';
import { NativeComposer } from './NativeComposer';

const SCENE: string = 'queue';

const IMAGE_DRAFT = 'Compare these [Image #1](/Users/admin/.local/share/ghostex/i/1.png) and check [notes.md](/Users/admin/p/notes.md) please';

function refs(text: string) {
  const out: unknown[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, kind: /\.png$/.test(m[2]!) ? 'image' : 'file', label: m[1], path: m[2], pill: m[1] });
  }
  return out;
}

function useFakeChat(scene: string): RustChat {
  const [, force] = useState(0);
  const docRef = useRef<ChatDocument>(null as unknown as ChatDocument);
  if (docRef.current === null) {
    const doc = { ...(data.doc as unknown as ChatDocument) } as ChatDocument & Record<string, unknown>;
    doc.verboseOverride = null;
    if (scene === 'working') doc.working = true;
    if (scene === 'queue') {
      doc.working = true;
      doc.queue = {
        ...doc.queue,
        prompts: [
          { id: 'a', text: 'Then run the tests', preview: 'Then run the tests', state: 'queued', busy: false, createdAt: '', updatedAt: '' },
          { id: 'b', text: 'And update the changelog', preview: 'And update the changelog', state: 'failed', errorMessage: 'the terminal did not answer.', busy: false, createdAt: '', updatedAt: '' },
        ],
      };
    }
    if (scene === 'slash') doc.suggestions = data.slash;
    if (scene === 'files') doc.suggestions = data.files;
    if (scene === 'note') doc.note = { open: true, value: 'Next: wire the mobile composer to the queue.', saved: '', edited: false, loading: false };
    if (scene === 'incoming') doc.incomingDraft = { content: 'A draft typed on the computer.' };
    if (scene === 'context') doc.contextEditor = data.contextEditor;
    if (scene === 'images') doc.pendingAttachments = 1;
    docRef.current = doc;
  }
  const fakeDispatch = (action: { type: string; [key: string]: unknown }): void => {
    console.log('[preview] dispatch', JSON.stringify(action).slice(0, 200));
    if (action.type === 'measureComposer') {
      // The core's fit_composer_controls, for the preview only.
      const m = action.measurements as { available: number; options: number; actions: number; footerGap: number; clearance: number; actionGap: number; hasOverflowOptions: boolean; controls: { id: string; width: number }[] };
      let required = m.options + m.actions + m.footerGap + m.clearance;
      const overflowed: string[] = [];
      for (const control of m.controls) {
        if (required <= m.available) break;
        overflowed.push(control.id);
        required -= control.width + m.actionGap;
      }
      docRef.current = { ...docRef.current, composerOverflow: { overflowed, optionsOverflowed: required > m.available && m.hasOverflowOptions } };
      force((n) => n + 1);
    }
  };
  const modelRef = useRef<ComposerModel | null>(null);
  if (modelRef.current === null) {
    modelRef.current = new ComposerModel({
      dispatch: (action) => fakeDispatch(action),
      document: () => docRef.current,
      onChange: () => force((n) => n + 1),
      onSendBlocked: () => undefined,
      onFocusRequested: () => undefined,
    });
    modelRef.current.init({ clientId: 'preview', entry: { text: scene === 'images' || scene === 'queue' ? IMAGE_DRAFT : '' } }, 'preview');
  }
  const model = modelRef.current;
  const composer: ComposerModelState = model.state;
  return useMemo(
    () => ({
      state: {
        status: 'running',
        revision: 1,
        document: docRef.current,
        items: [],
        subagentItems: [],
        minimap: [],
        rowDetails: {},
        composer,
        images: {},
        error: null,
        stats: {} as never,
      },
      dispatch: (action) => fakeDispatch(action),
      measure: () => undefined,
      composer: {
        edited: (text, selection) => model.edited(text, selection),
        selected: (selection) => model.selected(selection),
        focused: () => model.focused(),
        blurred: () => model.blurred(),
        submit: (mode) => model.submit(mode),
      },
      attachFiles: async () => undefined,
      query: (name, args) => (name === 'composerReferences' ? refs(String(args[0] ?? '')) : null),
      onViewRequest: () => () => undefined,
    }),
    [composer, model, docRef.current]
  );
}

function Preview() {
  const chat = useFakeChat(SCENE);
  const doc = chat.state!.document!;
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0e0e0e' }} edges={['top']}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Text style={{ color: '#b4b8c0', fontSize: 15 }}>Composer preview: {SCENE}</Text>
          <View style={{ height: 20 }} />
        </ScrollView>
        <NativeComposer chat={chat} onHostAction={(action) => console.log('[preview] host', action)} />
        {SCENE === 'more' ? (
          <MenuSheet rows={moreActionsRows({ document: doc, verbose: false, available: () => true, serves: () => true })} onClose={() => undefined} onCommand={() => true} />
        ) : null}
        {SCENE === 'model' ? <ModelMenuSheet menu={doc.modelMenu as never} visible onClose={() => undefined} dispatch={() => undefined} /> : null}
        {SCENE === 'mode' ? <MenuSheet rows={(doc.optionMenus as { mode: never[] }).mode} onClose={() => undefined} onCommand={() => true} /> : null}
        {SCENE === 'contextMeter' ? <MenuSheet rows={[{ context: doc.contextMeter }]} onClose={() => undefined} onCommand={() => true} /> : null}
        {SCENE === 'accounts' ? <MenuSheet rows={[{ accounts: doc.accountPanel }]} onClose={() => undefined} onCommand={() => true} /> : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('main', () => Preview);
