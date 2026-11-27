/**
 * The Sessions screen's list: the Unified list when the computer's sidebar setting asks for it, else the classic
 * project list. A switch between them mounts the other list, as it always has (each has its own key). Half folded
 * like a laptop (`components/common/foldGap.tsx`) the classic list runs across the fold, its rows continuing below
 * the fold's band; the Unified list ends above the fold, because each of its cards keeps its own swipe-open state,
 * which the copy below the band would keep separately.
 */

import type { ReactElement } from 'react';
import type { FlatListProps } from 'react-native';
import { FlatList as GestureFlatList } from 'react-native-gesture-handler';

import { useHorizontalSwipeGesture } from '../../components/common/HorizontalSwipe';
import { FoldListFrame } from '../../components/common/foldGap';
import { useLaptopFold } from '../../components/common/verticalBar/laptopFold';

export type SessionListProps<ItemT> = Omit<FlatListProps<ItemT>, 'renderScrollComponent' | 'ref'>;

export function SessionList<U, C>({
  unified,
  classic,
}: {
  /** The Unified list's props while it is on, else null. */
  unified: SessionListProps<U> | null;
  classic: SessionListProps<C>;
}): ReactElement {
  const swipePan = useHorizontalSwipeGesture();
  return (
    <FoldListFrame fold={useLaptopFold()} endAboveFold={unified !== null}>
      {unified !== null ? (
        <GestureFlatList key="unified" {...unified} requireToFail={swipePan ?? undefined} />
      ) : (
        <GestureFlatList key="classic" {...classic} requireToFail={swipePan ?? undefined} />
      )}
    </FoldListFrame>
  );
}
