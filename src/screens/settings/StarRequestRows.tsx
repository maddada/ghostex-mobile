/**
 * The last rows of the Settings list: Star Ghostex on GitHub, always there, and after a star from this
 * phone, Post about Ghostex on X, from the next day until it is used. Both open the phone's own browser
 * (Linking), never the app's Web Preview, so GitHub and X find the reader signed in.
 *
 * CDXC:Growth 2026-11-14 DECISION: User (star request page, Q3094): the phone gets "a Settings row only",
 * no card; the post row follows the desktop's rule ("another day and just once"). The state is this
 * phone's own; the desktop keeps its own per computer.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';

import { StarRequestCopy } from '../../copy';
import { LinkRow } from './SettingsControls';

export const GHOSTEX_REPOSITORY_URL = 'https://github.com/maddada/Ghostex';
const STARRED_ON_KEY = 'ghostex.starRequest.starredOn';
const POST_DONE_KEY = 'ghostex.starRequest.postDone';

/** The local day, as the phone's calendar names it. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** The X compose address with the post's words and the repository. */
export function postOnXUrl(): string {
  // encodeURIComponent, not URLSearchParams: React Native's URLSearchParams is incomplete.
  const text = encodeURIComponent(StarRequestCopy.postText);
  return `https://x.com/intent/post?text=${text}&url=${encodeURIComponent(GHOSTEX_REPOSITORY_URL)}`;
}

/** Whether the post row shows: a star on an earlier day, and no post yet. */
export function postRowDue(starredOn: string | null, postDone: boolean, day: string): boolean {
  return starredOn !== null && starredOn !== day && !postDone;
}

export function StarRequestRows() {
  const [postDue, setPostDue] = useState(false);

  useEffect(() => {
    let live = true;
    void AsyncStorage.multiGet([STARRED_ON_KEY, POST_DONE_KEY])
      .then(([[, starredOn], [, postDone]]) => {
        if (live) setPostDue(postRowDue(starredOn, postDone === 'true', today()));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const star = useCallback(() => {
    void Linking.openURL(GHOSTEX_REPOSITORY_URL).catch(() => undefined);
    // The first star counts; a later tap keeps its day.
    void AsyncStorage.getItem(STARRED_ON_KEY)
      .then((starredOn) => (starredOn === null ? AsyncStorage.setItem(STARRED_ON_KEY, today()) : undefined))
      .catch(() => undefined);
  }, []);

  const post = useCallback(() => {
    void Linking.openURL(postOnXUrl()).catch(() => undefined);
    setPostDue(false);
    void AsyncStorage.setItem(POST_DONE_KEY, 'true').catch(() => undefined);
  }, []);

  return (
    <>
      <LinkRow title={StarRequestCopy.starTitle} description={StarRequestCopy.starDescription} onPress={star} />
      {postDue ? (
        <LinkRow title={StarRequestCopy.postTitle} description={StarRequestCopy.postDescription} onPress={post} />
      ) : null}
    </>
  );
}
