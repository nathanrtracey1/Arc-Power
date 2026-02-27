#!/usr/bin/env swift
//
// Applies the gradient from Arc Power.icon/icon.json to the icon image
// and writes the AppIcon set. Run from the Arc Power project directory.
// Usage: swift apply-icon-gradient.swift
//

import AppKit
import Foundation

// Gradient from icon.json: automatic-gradient extended-srgb:1,0.55294,0.15686,1
// Orientation: start (0.5, 0), stop (0.5, 0.7) → vertical
let topColor = NSColor(red: 1, green: 0.55, blue: 0.16, alpha: 1)
let bottomColor = NSColor(red: 0.85, green: 0.35, blue: 0.08, alpha: 1)

let scriptDir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
let iconPath = scriptDir.appendingPathComponent("Assets.xcassets/AppIcon.appiconset")
let sourceIconURL = URL(fileURLWithPath: "/Users/nathantracey/Documents/Extensions/Arc Power.icon/Assets/icon.001 2.png")

guard let sourceImage = NSImage(contentsOf: sourceIconURL) else {
    fputs("Could not load source icon at \(sourceIconURL.path)\n", stderr)
    exit(1)
}

let size = 1024
let rect = NSRect(x: 0, y: 0, width: size, height: size)

let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()

// Draw vertical gradient background (matches icon.json orientation)
let gradient = NSGradient(colors: [topColor, bottomColor])!
gradient.draw(in: rect, angle: 90)

// Draw the icon on top (transparent areas show the gradient)
sourceImage.draw(in: rect, from: NSRect(origin: .zero, size: sourceImage.size), operation: .sourceOver, fraction: 1)

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff) else {
    fputs("Failed to get bitmap from image\n", stderr)
    exit(1)
}

let pngData = rep.representation(using: .png, properties: [:])
let out1024 = iconPath.appendingPathComponent("icon_1024.png")
do {
    try pngData?.write(to: out1024)
} catch {
    fputs("Failed to write icon_1024.png: \(error)\n", stderr)
    exit(1)
}

// Regenerate other sizes with sips
let sizes = [16, 32, 64, 128, 256, 512]
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
process.arguments = ["bash", "-c", "cd \"\(iconPath.path)\" && for s in \(sizes.map { String($0) }.joined(separator: " ")); do sips -z $s $s icon_1024.png --out icon_$s.png; done"]
try? process.run()
process.waitUntilExit()
print("App icon set updated with gradient (icon.json). Sizes: 16, 32, 64, 128, 256, 512, 1024.")
