//
//  AppDelegate.swift
//  Arc Power
//
//  Created by Nathan Tracey on 2/22/26.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        UpdateChecker.checkForUpdatesIfPossible()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

}

private enum UpdateChecker {

    /// Lightweight updater: checks a JSON file you host and, if a newer
    /// version exists, offers to open the download page in the browser.
    static func checkForUpdatesIfPossible() {
        guard
            let infoURL = URL(string: "https://example.com/arcpower-updates.json"),
            let currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
            !currentVersion.isEmpty
        else {
            return
        }

        Task.detached(priority: .utility) {
            let request = URLRequest(
                url: infoURL,
                cachePolicy: .reloadIgnoringLocalCacheData,
                timeoutInterval: 5
            )

            guard
                let (data, response) = try? await URLSession.shared.data(for: request),
                let httpResponse = response as? HTTPURLResponse,
                httpResponse.statusCode == 200
            else {
                return
            }

            struct UpdateInfo: Decodable {
                let version: String
                let downloadURL: String
            }

            guard
                let info = try? JSONDecoder().decode(UpdateInfo.self, from: data),
                isRemoteVersionNewer(remote: info.version, current: currentVersion)
            else {
                return
            }

            let downloadURL = info.downloadURL
            let remoteVersion = info.version

            await MainActor.run {
                let alert = NSAlert()
                alert.messageText = "A new version of Arc Power is available."
                alert.informativeText = "You are using version \(currentVersion). Version \(remoteVersion) is available to download."
                alert.addButton(withTitle: "Download")
                alert.addButton(withTitle: "Later")

                let response = alert.runModal()
                if response == .alertFirstButtonReturn,
                   let url = URL(string: downloadURL) {
                    NSWorkspace.shared.open(url)
                }
            }
        }
    }

    private nonisolated static func isRemoteVersionNewer(remote: String, current: String) -> Bool {
        let remoteParts = remote.split(separator: ".").compactMap { Int($0) }
        let currentParts = current.split(separator: ".").compactMap { Int($0) }
        let maxCount = max(remoteParts.count, currentParts.count)

        for index in 0..<maxCount {
            let remoteValue = index < remoteParts.count ? remoteParts[index] : 0
            let currentValue = index < currentParts.count ? currentParts[index] : 0

            if remoteValue > currentValue { return true }
            if remoteValue < currentValue { return false }
        }

        return false
    }
}

