// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "scene-view-check",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(path: "../../../../../luma"),
    ],
    targets: [
        .executableTarget(
            name: "SceneViewCheck",
            dependencies: [.product(name: "LumaCore", package: "luma")],
            path: "Sources/SceneViewCheck",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
