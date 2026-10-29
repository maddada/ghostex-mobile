//
//  GhostexRootViewController.swift
//  GhostexNative
//
//  The app's root view controller, supplied to Expo through its public `ExpoReactDelegateHandler`
//  (`createRootViewController()`; registered in expo-module.config.json, no swizzling).
//
//  Built with the iOS 27.1 SDK, the iPhone Duo's status items stand in a vertical column and UIKit lays
//  vertical bars beside it when the system's vertical-bar behavior is automatic (the default of a plain
//  view controller). The app wants the status items in one horizontal row along the top in every pose, with
//  its own header beside them, so this controller answers `.disabled`: the root's answer is the one the
//  window follows from the first frame, before any JS runs. Controllers presented over it (React Native's
//  Modal, alerts) keep the default and would take over while shown; Expo's `StatusBar.setVerticalBarBehaviorIOS`
//  (index.ts, expo-status-bar's own override) covers those once JS has started.
//  Before iOS 27.1, or built with an older SDK, this is a plain view controller.
//

import ExpoModulesCore
import UIKit

final class GhostexRootViewController: UIViewController {
    #if canImport(UIKit, _version: 9127.0.85)
    @available(iOS 27.1, *)
    override var preferredVerticalBarBehavior: UIVerticalBarBehavior { .disabled }
    #endif
}

/// Hands `GhostexRootViewController` to Expo as the root view controller.
public class GhostexReactDelegateHandler: ExpoReactDelegateHandler {
    public override func createRootViewController() -> UIViewController? {
        GhostexRootViewController()
    }
}
