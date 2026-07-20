package com.termux.view;

/**
 * Ghostex-owned helper living in the {@code com.termux.view} package so the vendored
 * {@link TerminalView} can stay byte-for-byte identical to upstream while the Expo module
 * reaches the package-private scroll state.
 */
public final class GhostexTerminalViewBridge {

    private GhostexTerminalViewBridge() {
    }

    /** Scroll the terminal view back to the live bottom row of the emulator screen. */
    public static void scrollToBottom(TerminalView view) {
        if (view == null || view.mEmulator == null) return;
        if (view.mTopRow != 0) {
            view.mTopRow = 0;
            view.invalidate();
        }
    }
}
