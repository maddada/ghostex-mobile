/**
 * "Fall back to Easy Connect?": asked once per Tailscale or SSH computer, the first time this phone connects to
 * one that can offer it (src/machines/easyConnectFallbackAsk.ts). Two answers drawn alike, neither suggested;
 * put away without an answer, it asks again next launch. Mounting it registers the ask with the chat link.
 */

import { EasyConnectFallbackCopy } from '../../copy';
import {
  answerFallbackAsk,
  dismissFallbackAsk,
  useEasyConnectFallbackAsk,
} from '../../machines/easyConnectFallbackAsk';
import { machineDisplayLabel, useMachinesStore } from '../../machines/store';
import ConfirmDialog from '../common/ConfirmDialog';

export default function EasyConnectFallbackAsk() {
  const asking = useEasyConnectFallbackAsk((state) => state.asking);
  const machines = useMachinesStore((state) => state.machines);
  // One computer at a time, in the order they connected; one removed meanwhile is skipped.
  const machine = asking
    .map((id) => machines.find((record) => record.id === id))
    .find((record) => record !== undefined);
  if (machine === undefined) return null;
  const name = machineDisplayLabel(machine);
  return (
    <ConfirmDialog
      visible
      title={EasyConnectFallbackCopy.askTitle}
      body={EasyConnectFallbackCopy.askBody(name)}
      confirmLabel={EasyConnectFallbackCopy.yes}
      cancelLabel={EasyConnectFallbackCopy.no}
      equalButtons
      onConfirm={() => answerFallbackAsk(machine.id, true)}
      onCancel={() => answerFallbackAsk(machine.id, false)}
      onDismiss={() => dismissFallbackAsk(machine.id)}
    />
  );
}
