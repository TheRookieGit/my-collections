// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "MyCollections",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "MyCollections", path: "Sources/MyCollections"),
    ]
)
