// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ComicsReaderKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "ComicsReaderKit", targets: ["ComicsReaderKit"]),
    ],
    targets: [
        .target(name: "ComicsReaderKit"),
        .testTarget(name: "ComicsReaderKitTests", dependencies: ["ComicsReaderKit"]),
    ]
)
