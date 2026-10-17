// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StudyCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "StudyCore", targets: ["StudyCore"])],
    targets: [
        .target(name: "StudyCore", path: "SomaticCity/Core"),
        .testTarget(name: "StudyCoreTests", dependencies: ["StudyCore"], path: "Tests")
    ]
)
