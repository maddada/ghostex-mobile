/**
 * Generic action sheet: the app's dialog sheet (`HostedDialogSheet`) with a title/subtitle header and a scrollable
 * list of choice rows (label + optional detail line, destructive tint, disabled state, radio mark), the same rows
 * `showAlert()` draws for three or more choices. Half folded like a laptop it starts below the fold and its list
 * scrolls inside.
 */

import { HostedDialogSheet } from './dialog/AlertHost';
import { DialogMessage, DialogRow, DialogRows, DialogTitle } from './dialog/DialogParts';

export type ActionSheetItem = {
  key: string;
  label: string;
  /** Muted description line under the label. */
  detail?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Set on every row of a sheet that picks one choice: the row is a radio button, on when true. */
  selected?: boolean;
  onPress: () => void;
};

export type ActionSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  items: ActionSheetItem[];
  onClose: () => void;
};

export default function ActionSheet({ visible, title, subtitle, items, onClose }: ActionSheetProps) {
  return (
    <HostedDialogSheet visible={visible} onDismiss={onClose} accessibilityLabel={title}>
      <DialogTitle>{title}</DialogTitle>
      {subtitle !== undefined && subtitle.length > 0 ? <DialogMessage>{subtitle}</DialogMessage> : null}
      <DialogRows>
        {items.map((item) => (
          <DialogRow
            key={item.key}
            label={item.label}
            {...(item.detail !== undefined ? { detail: item.detail } : {})}
            destructive={item.destructive === true}
            disabled={item.disabled === true}
            {...(item.selected !== undefined ? { selected: item.selected } : {})}
            onPress={item.onPress}
          />
        ))}
      </DialogRows>
    </HostedDialogSheet>
  );
}
