import AppKit
import ServiceManagement

/// The one menu bar icon: a section for each app, with its open row and what its own menu shows.
@MainActor
final class Hub: NSObject, NSApplicationDelegate {
    private struct App {
        let bundleID: String
        let name: String
        var running: Bool { !NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).isEmpty }
        var url: URL? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) }
    }
    private static let website = URL(string: "https://therookiegit.github.io/my-collections/")!
    private static let apps = [
        App(bundleID: "com.therookiegit.AutoReceipt", name: "AutoReceipt"),
        App(bundleID: "com.therookiegit.NewsCollections", name: "News Collections"),
        App(bundleID: "com.therookiegit.FoodCollection", name: "FoodCollection"),
    ]
    private static let answerWait: TimeInterval = 0.2

    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private var menus: [String: MenuHub.Menu] = [:]
    private var waiting: Set<String> = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        item.button?.target = self
        item.button?.action = #selector(clicked)
        item.button?.sendAction(on: [.leftMouseDown, .rightMouseDown])
        updateIcon()
        let center = DistributedNotificationCenter.default()
        center.addObserver(self, selector: #selector(told(_:)), name: MenuHub.tell, object: nil, suspensionBehavior: .deliverImmediately)
        center.postNotificationName(MenuHub.ask, object: nil, userInfo: nil, options: [.deliverImmediately])
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(appQuit(_:)), name: NSWorkspace.didTerminateApplicationNotification, object: nil)
        if !UserDefaults.standard.bool(forKey: "loginItemDefaulted") {
            UserDefaults.standard.set(true, forKey: "loginItemDefaulted")
            try? SMAppService.mainApp.register()
        }
    }

    @objc private func told(_ note: Notification) {
        guard let id = note.object as? String, let json = note.userInfo?["menu"] as? String,
              let menu = try? JSONDecoder().decode(MenuHub.Menu.self, from: Data(json.utf8)) else { return }
        menus[id] = menu
        waiting.remove(id)
        updateIcon()
    }

    @objc private func appQuit(_ note: Notification) {
        guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication, let id = app.bundleIdentifier else { return }
        menus[id] = nil
        updateIcon()
    }

    /// Shows what an app's own icon would be showing, e.g. AutoReceipt syncing or in trouble.
    private func updateIcon() {
        let status = Self.apps.compactMap { app in menus[app.bundleID].flatMap { m in m.symbol.map { ($0, m.label ?? app.name) } } }.first
        let image = NSImage(systemSymbolName: status?.0 ?? "square.stack.3d.up", accessibilityDescription: status?.1 ?? "My Collections")
        image?.isTemplate = true
        item.button?.image = image
        item.button?.toolTip = status?.1 ?? "My Collections"
    }

    /// The menu is built on click because each app's times have to be current; an app that is slow to answer shows
    /// what it said last rather than holding the menu up.
    @objc private func clicked() {
        waiting = Set(Self.apps.filter(\.running).map(\.bundleID))
        DistributedNotificationCenter.default().postNotificationName(MenuHub.ask, object: nil, userInfo: nil, options: [.deliverImmediately])
        let deadline = Date(timeIntervalSinceNow: Self.answerWait)
        while !waiting.isEmpty, Date() < deadline { RunLoop.current.run(mode: .default, before: deadline) }
        item.menu = buildMenu()
        item.button?.performClick(nil)
        item.menu = nil
    }

    /// One section per app: its open row, then everything its own menu shows.
    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        let site = action("打开我的心愿单", #selector(openWebsite))
        site.image = NSApp.applicationIconImage.flatMap(Self.small)
        menu.addItem(site)
        for app in Self.apps {
            menu.addItem(.separator())
            let open = action("打开 \(app.name)", #selector(openApp(_:)))
            open.representedObject = app.bundleID
            open.image = app.url.map { NSWorkspace.shared.icon(forFile: $0.path) }.flatMap(Self.small)
            open.isEnabled = app.url != nil
            menu.addItem(open)
            if app.running, let carried = menus[app.bundleID] { addRows(of: carried, app: app, to: menu) }
            else { menu.addItem(info("未运行")) }
        }
        menu.addItem(.separator())
        let login = action("开机时自动启动", #selector(toggleLogin))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(NSMenuItem(title: "退出 My Collections", action: #selector(NSApplication.terminate(_:)), keyEquivalent: ""))
        return menu
    }

    /// Row 0 of every app's menu is its open row, which the section already starts with. An app's own separators are
    /// left out so the only lines in the menu are the ones between sections.
    private func addRows(of carried: MenuHub.Menu, app: App, to menu: NSMenu) {
        for (index, row) in carried.rows.enumerated().dropFirst() where !row.separator {
            let entry = NSMenuItem(title: row.title, action: row.enabled ? #selector(performCarried(_:)) : nil, keyEquivalent: "")
            entry.target = self
            entry.isEnabled = row.enabled
            entry.state = row.checked ? .on : .off
            entry.representedObject = [app.bundleID, index] as [Any]
            menu.addItem(entry)
        }
    }

    private func info(_ title: String) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        entry.isEnabled = false
        return entry
    }

    private func action(_ title: String, _ selector: Selector) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: selector, keyEquivalent: "")
        entry.target = self
        return entry
    }

    private static func small(_ icon: NSImage) -> NSImage? {
        let copy = icon.copy() as? NSImage
        copy?.size = NSSize(width: 18, height: 18)
        return copy
    }

    @objc private func openWebsite() { NSWorkspace.shared.open(Self.website) }

    /// Launches the app, or brings up its window if it is already running in the background.
    @objc private func openApp(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }

    @objc private func performCarried(_ sender: NSMenuItem) {
        guard let target = sender.representedObject as? [Any], let id = target.first as? String, let index = target.last as? Int else { return }
        DistributedNotificationCenter.default().postNotificationName(MenuHub.perform, object: id, userInfo: ["index": index], options: [.deliverImmediately])
    }

    @objc private func toggleLogin() {
        if SMAppService.mainApp.status == .enabled { try? SMAppService.mainApp.unregister() }
        else {
            try? SMAppService.mainApp.register()
            if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
        }
    }
}

MainActor.assumeIsolated {
    let hub = Hub()
    NSApplication.shared.delegate = hub
    NSApplication.shared.run()
}
