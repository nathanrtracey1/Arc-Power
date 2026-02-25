//
//  SafariWebExtensionHandler.swift
//  Arcify Safari Extension
//
//  Native host required by Safari to load the web extension. Safari loads this
//  handler, which then runs the JavaScript (background.js, content.js, etc.).
//

import SafariServices
import os.log
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

/// Native host entry point for the Arcify Safari Web Extension.
/// Safari delivers `browser.runtime.sendNativeMessage` traffic here.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    /// Handles a single native-message request from the web extension.
    /// - Parameter context: The extension context containing the incoming message.
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        os_log(.default, "Received message from browser.runtime.sendNativeMessage: %@ (profile: %@)", String(describing: message), profile?.uuidString ?? "none")

        // If the web extension sends { command: "show-menu" } we present a native
        // NSMenu that mirrors the toolbar popover actions (Copy Link, Duplicate, Pin, etc.).
        var responsePayload: [String: Any] = ["echo": message ?? NSNull()]
        if let dict = message as? [String: Any],
           let command = dict["command"] as? String,
           command == "show-menu" {
            let ctx = dict["context"] as? [String: Any]
#if os(macOS)
            responsePayload["supportedNativeMenu"] = true
            let selected = showCommandMenuAndWait(context: ctx)
            responsePayload["selected"] = selected ?? NSNull()
            if let url = ctx?["url"] as? String, selected == "copy-link" {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(url, forType: .string)
            }
#else
            // iOS: no NSMenu. Tell the web UI to fall back to the HTML menu.
            responsePayload["supportedNativeMenu"] = false
            responsePayload["selected"] = NSNull()
#endif
        }

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: responsePayload]
        } else {
            response.userInfo = ["message": responsePayload]
        }

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    /// Builds and displays a native macOS menu with the same items that appear
    /// in the extension’s command popover.
#if os(macOS)
    private func showCommandMenuAndWait(context: [String: Any]?) -> String? {
        let target = MenuActionTarget()
        let menu = NSMenu()

        func add(_ title: String, actionId: String) {
            let item = NSMenuItem(title: title, action: #selector(MenuActionTarget.itemClicked(_:)), keyEquivalent: "")
            item.target = target
            item.representedObject = actionId
            menu.addItem(item)
        }

        func addHeader(_ title: String) {
            let header = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            header.isEnabled = false
            menu.addItem(header)
        }

        func addSeparatorIfNeeded() {
            if menu.items.last?.isSeparatorItem == true { return }
            if menu.items.isEmpty { return }
            menu.addItem(.separator())
        }

        let type = (context?["type"] as? String) ?? "tab"

        switch type {
        case "tab":
            let url = context?["url"] as? String
            let tabId = context?["tabId"] as? Int
            let pinned = (context?["pinned"] as? Bool) ?? false
            let inFav = (context?["inFav"] as? Bool) ?? false
            let inFolder = context?["inFolder"] as? String

            if url != nil { add("Copy Link", actionId: "copy-link") }
            if tabId != nil { add("Duplicate", actionId: "duplicate") }
            add(pinned ? "Remove Pin" : "Pin", actionId: "pin")
            add(inFav ? "Remove from Favorites" : "Add to Favorites", actionId: "toggle-fav")
            if tabId != nil { add("Rename Tab", actionId: "rename-tab") }
            if tabId != nil { add("Edit URL", actionId: "edit-url") }
            if inFolder != nil { add("Remove from folder", actionId: "remove-from-folder") }

            if let folderNames = context?["folderNames"] as? [String], !folderNames.isEmpty || inFolder == nil {
                addSeparatorIfNeeded()
                addHeader("MOVE TO")

                add("New folder…", actionId: "move-to-new-folder")

                for folderName in folderNames {
                    if folderName == inFolder { continue }
                    let b64 = Data(folderName.utf8).base64EncodedString()
                    add(folderName, actionId: "move-to-folder-b64:\(b64)")
                }
            }

        case "folder":
            add("Rename folder", actionId: "folder-rename")
            add("Remove folder", actionId: "folder-remove")

        case "space":
            add("Edit space", actionId: "space-edit")
            let canRemove = (context?["canRemove"] as? Bool) ?? false
            if canRemove { add("Remove space", actionId: "space-remove") }

        case "favorite":
            add("Remove from Favorites", actionId: "favorite-remove")

        default:
            break
        }

        let location = NSEvent.mouseLocation
        menu.popUp(positioning: nil, at: location, in: nil)
        return target.selectedActionId
    }
#endif
}

#if os(macOS)
private final class MenuActionTarget: NSObject {
    var selectedActionId: String?

    @objc func itemClicked(_ sender: NSMenuItem) {
        selectedActionId = sender.representedObject as? String
    }
}
#endif
