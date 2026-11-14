/**
 * Connect two of this phone's computers to each other, so each can open the other's chats and terminals.
 *
 * CDXC:RemotePairing 2026-11-14 DECISION:
 * User, on the Easy Connect page (Q5: "let a phone paired with both computers link them to each other", and "make this
 * require an are you sure?"): after the person confirms on the phone, the phone runs, for each direction, what the
 * desktop's Connect both ways runs. It asks the first computer for its code (`remotePairingCode` with `openTunnel`,
 * which answers a paired phone), hands it to the second (`connectBackToComputer`, where this phone's own sign-in
 * proves who asks), approves the second computer's request on the first with this phone's usual Approve (Face ID when
 * that computer asks for it), and waits until the second has added the first. A computer from before this answers the
 * route as unknown, and the phone says to update Ghostex there. JavaScript only, so it ships over the air.
 * SEE-ALSO: server/src/remote_access/connect_back.rs in the Ghostex repo (the computers' side).
 */

import { chatMachineLink } from '../chat/rust/machine-link';
import { approveRequest, listApprovals } from '../security/approvals';
import type { MachineConnectionTarget } from './credentials';

const ASK_TIMEOUT_MS = 20_000;
/** `connectBackToComputer` opens a tunnel to the other computer and waits up to 30 s for it. */
const START_TIMEOUT_MS = 60_000;
/** One status ask may wait on the other computer's administrator prompt. */
const STATUS_TIMEOUT_MS = 200_000;
const POLL_MS = 1000;
/** How long the second computer's request may take to show on the first. */
const REQUEST_WAIT_MS = 45_000;
/** How long the second computer may take to finish once approved. */
const FINISH_WAIT_MS = 200_000;

export type LinkComputer = MachineConnectionTarget & { name: string };

/** Where linking stands: which computer is being added to which, and the step. */
export type LinkProgress = {
  /** The computer being added. */
  added: string;
  /** The computer it is added to. */
  to: string;
  step: 'asking' | 'approving' | 'adding';
};

class LinkError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

async function call(
  machine: MachineConnectionTarget,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
) {
  const link = chatMachineLink(machine);
  await link.route();
  const answer = await link.rpc(method, params, timeoutMs);
  if (answer.error !== null) throw new LinkError(answer.error.message, answer.error.code ?? null);
  return answer.result;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** A route an older Ghostex doesn't have ("No gxserver endpoint for POST …", `notFound`). */
function unknownRoute(error: unknown): boolean {
  if (!(error instanceof LinkError)) return false;
  return error.code === 'notFound' || /no gxserver endpoint|not found/i.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `host`'s one-time code, as `connectBackToComputer` takes it. */
async function codeOf(host: LinkComputer): Promise<Record<string, unknown>> {
  const answer = record(await call(host, 'remotePairingCode', { openTunnel: true }, ASK_TIMEOUT_MS));
  const code = record(record(answer?.easyConnect)?.code);
  const fields = {
    address: text(code?.address),
    port: typeof code?.port === 'number' ? code.port : null,
    secret: text(code?.secret),
    name: text(code?.name) ?? host.name,
    user: text(code?.user),
    sshPort: typeof code?.sshPort === 'number' ? code.sshPort : 22,
  };
  if (fields.address === null || fields.port === null || fields.user === null) {
    throw new LinkError(`Easy Connect is off on ${host.name}. Turn it on there, then try again.`);
  }
  if (fields.secret === null) {
    throw new LinkError(`${host.name} didn't give this phone a code. Update Ghostex there, then try again.`);
  }
  return fields;
}

/** Adds `host` to `joiner`'s computers: `joiner` pairs with `host`, approved here on `host`. */
async function addOneWay(host: LinkComputer, joiner: LinkComputer, onProgress: (progress: LinkProgress) => void) {
  const progress = (step: LinkProgress['step']) => onProgress({ added: host.name, to: joiner.name, step });
  progress('asking');
  const code = await codeOf(host);
  let started: Record<string, unknown> | null;
  try {
    started = record(await call(joiner, 'connectBackToComputer', code, START_TIMEOUT_MS));
  } catch (error) {
    if (unknownRoute(error)) throw new LinkError(`Update Ghostex on ${joiner.name} first, then try again.`);
    throw error;
  }
  const pendingId = text(started?.pendingId);
  if (pendingId === null) throw new LinkError(`${joiner.name} sent an answer this phone can't read. Try again.`);

  progress('approving');
  const asked = Date.now();
  for (;;) {
    const request = (await listApprovals(host)).find((candidate) => candidate.target === pendingId);
    if (request !== undefined) {
      await approveRequest(host, request);
      break;
    }
    if (Date.now() - asked > REQUEST_WAIT_MS) {
      throw new LinkError(`${joiner.name}'s request didn't reach ${host.name}. Check both are online, then try again.`);
    }
    await sleep(POLL_MS);
  }

  progress('adding');
  const approved = Date.now();
  for (;;) {
    const status = record(await call(joiner, 'computerPairingStatus', { pendingId }, STATUS_TIMEOUT_MS));
    const state = text(status?.status);
    if (state === 'approved') {
      if (status?.machineAdded !== true) throw new LinkError(`Open Ghostex on ${joiner.name}, then try again.`);
      // An older host didn't keep the joiner's key: the joiner can only sign in there with a password.
      if (status?.sshKeyInstalled !== true) {
        throw new LinkError(
          `${joiner.name} added ${host.name}, but ${host.name} runs an older Ghostex. Update Ghostex there, or enter its password on ${joiner.name}.`,
        );
      }
      return;
    }
    if (state === 'denied') throw new LinkError(`${host.name} turned ${joiner.name} away. Try again.`);
    if (state !== 'pending' || Date.now() - approved > FINISH_WAIT_MS) {
      throw new LinkError(`${joiner.name} didn't finish in time. Try again.`);
    }
    await sleep(POLL_MS);
  }
}

/** Connects `first` and `second` both ways; throws with a plain sentence when a step fails. */
export async function linkComputers(
  first: LinkComputer,
  second: LinkComputer,
  onProgress: (progress: LinkProgress) => void,
): Promise<void> {
  await addOneWay(first, second, onProgress);
  await addOneWay(second, first, onProgress);
}
