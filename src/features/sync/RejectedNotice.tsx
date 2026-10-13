import { useSession } from '../../shared/api/session';
import * as vi from '../../shared/i18n/vi/sync';
import { dismissCorruptNotice, dismissRejected, useQueueCorrupted, useRejectedActions } from '../../shared/storage/pendingActions';
import { Dialog } from '../../shared/ui/Dialog';

/**
 * Tells the signed-in user about records that were sent later and refused (one at a time, oldest first), and once
 * about a stored queue that could not be read. Dismissing a notice forgets that entry. Mount it once.
 */
export function RejectedNotice() {
  const { userId } = useSession();
  const [rejection] = useRejectedActions(userId);
  const corrupted = useQueueCorrupted(userId);
  if (!userId) return null;
  if (rejection) {
    const dismiss = () => {
      dismissRejected(userId, rejection.id);
    };
    return (
      <Dialog
        key={rejection.id}
        title={vi.rejectedTitle}
        body={vi.rejectionText(rejection.code)}
        note={vi.recordLabel(rejection.path)}
        primary={{ label: vi.understood, onPress: dismiss }}
        onDismiss={dismiss}
      />
    );
  }
  if (!corrupted) return null;
  const dismiss = () => dismissCorruptNotice(userId);
  return <Dialog title={vi.corruptTitle} body={vi.corruptBody} primary={{ label: vi.understood, onPress: dismiss }} onDismiss={dismiss} />;
}
