// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "pipeline-graph-check",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(path: "../../../../../luma"),
    ],
    targets: [
        .executableTarget(
            name: "PipelineGraphCheck",
            dependencies: [.product(name: "LumaCore", package: "luma")],
            path: "Sources/PipelineGraphCheck",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
