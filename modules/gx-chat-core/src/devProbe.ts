/**
 * Development-only proof that the native chat core runs in this build: boots one core the way the
 * phone host will (start, boot read, subscribed, one synthetic snapshot frame), drains a frame and
 * logs the timings plus a shape summary under the `[gx-chat-core]` tag. No chat text is logged,
 * and the transcript is synthetic. `index.ts` at the app root runs it once under `__DEV__`.
 */
import { createChatCore, chatCoreVersion, isChatCoreAvailable } from './index';

function syntheticSnapshot(count: number): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [];
  const base = 1_789_990_000_000;
  for (let index = 0; index < count; index += 1) {
    const turn = Math.floor(index / 4);
    const common = {
      source: 'transcript',
      timestamp: base + index * 1000,
      turnId: `t${turn}`,
      byteOffset: index * 100,
    };
    switch (index % 4) {
      case 0:
        messages.push({ ...common, id: `u${index}`, role: 'user', blocks: [{ type: 'text', text: `Please look at step ${turn} of the build and fix the failing check.` }] });
        break;
      case 1:
        messages.push({ ...common, id: `c${index}`, role: 'assistant', blocks: [{ type: 'tool-call', name: 'Bash', input: { command: `cargo test -p step${turn}`, description: 'Run the tests' } }] });
        break;
      case 2:
        messages.push({ ...common, id: `r${index}`, role: 'tool', blocks: [{ type: 'tool-result', output: 'running 12 tests\ntest result: ok. 12 passed; 0 failed' }] });
        break;
      default:
        messages.push({ ...common, id: `a${index}`, role: 'assistant', blocks: [{ type: 'text', text: `## Step ${turn}\n\nThe check failed because the **fixture** was stale. I updated \`src/lib.rs\`:\n\n\`\`\`rust\nfn step() -> u32 { ${turn} }\n\`\`\`\n\n- tests pass\n- lint is clean` }] });
    }
  }
  return {
    type: 'sessionChatSnapshot', projectId: 'p', sessionId: 's', epoch: 1, seq: 1, protocolVersion: 1,
    serverId: 'probe', messages, hasMore: false, beforeOffset: 0, status: 'ready', agent: 'claude',
  };
}

export function runChatCoreProbe(messageCount = 300): void {
  const tag = '[gx-chat-core]';
  if (!isChatCoreAvailable()) {
    console.log(`${tag} native chat core not in this build (run packages/gx-chat-mobile/build.sh)`);
    return;
  }
  try {
    const context = () => JSON.stringify({ nowMs: Date.now(), utcOffsetMinutes: -new Date().getTimezoneOffset() });
    const snapshotEvent = JSON.stringify({ type: 'frame', frame: syntheticSnapshot(messageCount) });
    for (let run = 0; run < 3; run += 1) {
      const t0 = performance.now();
      const core = createChatCore();
      const t1 = performance.now();
      const startEffects = JSON.parse(
        core.handle(JSON.stringify({ type: 'start', config: { clientId: 'probe', projectId: 'p', sessionId: 's' } }), context()),
      ) as { type: string }[];
      core.handle(JSON.stringify({ type: 'composerBootRead', read: { sessionKey: 'p:s', clientId: 'probe' } }), context());
      core.handle(JSON.stringify({ type: 'connection', update: 'subscribed' }), context());
      const t2 = performance.now();
      const effects = JSON.parse(core.handle(snapshotEvent, context())) as { type: string }[];
      const t3 = performance.now();
      const frameJson = core.frame(null);
      const t4 = performance.now();
      const frame = JSON.parse(frameJson) as {
        revision: number;
        snapshot?: { status?: string };
        itemsSplice?: { items: unknown[] };
      };
      const t5 = performance.now();
      console.log(
        `${tag} run ${run} (${chatCoreVersion()}, ${messageCount} messages, ${snapshotEvent.length} bytes in): ` +
          `create ${(t1 - t0).toFixed(2)}ms, boot ${(t2 - t1).toFixed(2)}ms [${startEffects.map((e) => e.type).join(',')}], ` +
          `handle snapshot ${(t3 - t2).toFixed(2)}ms [${effects.map((e) => e.type).join(',')}], ` +
          `frame ${(t4 - t3).toFixed(2)}ms (${frameJson.length} bytes), JSON.parse ${(t5 - t4).toFixed(2)}ms, ` +
          `revision ${frame.revision}, status ${frame.snapshot?.status}, items ${frame.itemsSplice?.items.length}, ` +
          `nextWakeMs ${core.nextWakeMs()}`,
      );
      core.dispose();
    }
    // A malformed event must come back as a typed error, never a native crash.
    const core = createChatCore();
    try {
      core.handle('{"type":"notAnEvent"}', JSON.stringify({ nowMs: Date.now() }));
      console.log(`${tag} error path: no error raised (unexpected)`);
    } catch (error) {
      console.log(`${tag} error path: ${(error as { code?: string }).code ?? 'uncoded'}`);
    } finally {
      core.dispose();
    }
  } catch (error) {
    console.log(`${tag} probe failed: ${String(error)}`);
  }
}
