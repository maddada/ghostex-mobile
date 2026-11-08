/**
 * Approvals (GitHub #495): the requests waiting on a computer for its owner (an agent asking to
 * turn on Easy Connect, connect a computer, answer another session's prompt…). Approve signs the
 * request with this phone's approver key after Face ID / the fingerprint / the screen lock; Deny
 * needs no prompt. The list refreshes while the screen is open.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SetupButton } from '../components/onboarding/SetupPrimitives';
import { ApprovalsCopy } from '../copy';
import { machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import type { ApprovalRequest } from '../security/approvalPayload';
import { approveRequest, denyRequest, listApprovals } from '../security/approvals';
import { hasApproverKey } from '../security/approverKey';
import { useAppearance, type Appearance } from '../theme/useAppearance';

type Props = NativeStackScreenProps<RootStackParamList, 'Approvals'>;

const REFRESH_MS = 3_000;

export default function ApprovalsScreen({ navigation, route }: Props) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const { machineId } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((record) => record.id === machineId) ?? null);
  const computer = machine === null ? machineId : machineDisplayLabel(machine);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: ApprovalsCopy.title(computer) });
  }, [navigation, computer]);

  const refresh = useCallback(async () => {
    if (machine === null) return;
    try {
      setRequests(await listApprovals(machine));
      setError(null);
    } catch (failure) {
      setError(`${ApprovalsCopy.loadFailed}: ${(failure as Error).message}`);
    }
  }, [machine]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const decide = async (request: ApprovalRequest, approve: boolean) => {
    if (machine === null) return;
    setBusy(request.id);
    setNotice(null);
    try {
      if (approve) {
        await approveRequest(machine, request, () => setNotice(ApprovalsCopy.waitingForComputer));
      } else {
        await denyRequest(machine, request.id);
      }
      setNotice(null);
    } catch (failure) {
      setNotice(`${approve ? ApprovalsCopy.notApproved : ApprovalsCopy.couldNotDeny}: ${(failure as Error).message}`);
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {!hasApproverKey() ? <Text style={styles.notice}>{ApprovalsCopy.updateApp}</Text> : null}
        {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}
        {error !== null ? <Text style={styles.notice}>{error}</Text> : null}
        {requests.length === 0 && error === null ? <Text style={styles.empty}>{ApprovalsCopy.empty}</Text> : null}
        {requests.map((request) => (
          <View key={request.id} style={styles.card}>
            <Text style={styles.summary}>{request.summary}</Text>
            <Text style={styles.meta}>{ApprovalsCopy.askedBy(request.requestedBy.label || request.requestedBy.kind)}</Text>
            {request.detail ? <Text style={styles.meta}>{request.detail}</Text> : null}
            <View style={styles.buttons}>
              <SetupButton
                small
                variant="primary"
                label={ApprovalsCopy.approve}
                busy={busy === request.id}
                disabled={busy !== null || !hasApproverKey()}
                onPress={() => void decide(request, true)}
              />
              <SetupButton
                small
                label={ApprovalsCopy.deny}
                disabled={busy !== null}
                onPress={() => void decide(request, false)}
              />
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: appearance.background },
    content: { padding: 16, gap: 12 },
    card: { borderRadius: 12, padding: 14, gap: 6, backgroundColor: appearance.card },
    summary: { fontSize: 16, fontWeight: '600', color: appearance.foreground },
    meta: { fontSize: 13, color: appearance.muted },
    buttons: { flexDirection: 'row', gap: 8, marginTop: 6 },
    empty: { fontSize: 15, color: appearance.muted, textAlign: 'center', marginTop: 32 },
    notice: { fontSize: 14, color: appearance.foreground },
  });
