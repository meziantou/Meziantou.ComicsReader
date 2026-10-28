# Comics Reader for iPad

Native iPad client (SwiftUI) for the Comics Reader server. It provides the same features as the web reader:

- Library with the reading list, "Up Next" recommendations, and the catalog (search and One Shot / Series filters), pull to refresh
- Reader with swipe navigation, pinch to zoom, fullscreen (swipe up/down, double tap), page number input, keyboard shortcuts (arrows, Page Up/Down, Escape, F), and the "Mark as completed" screen
- Offline reading: download books, automatic download on Wi-Fi, progress queued while offline and synchronized when the server is reachable again
- Settings: server URL, access token (stored in the keychain), auto-download, large fullscreen progress bar, catalog refresh, cache management

## Project structure

- `ComicsReaderKit/`: Swift package with the platform-independent logic (API client, offline store, synchronization, recommendations) and its tests
- `ComicsReader/`: SwiftUI application
- `project.yml`: [XcodeGen](https://github.com/yonaskolb/XcodeGen) definition of `ComicsReader.xcodeproj`

## Build and test

Open `ComicsReader.xcodeproj` in Xcode 26 or later, select your development team, and run the `ComicsReader` scheme on an iPad or an iPad simulator.

From the command line:

```bash
# Run the unit tests of the shared logic
cd ComicsReaderKit && swift test

# Build the app for the simulator
xcodebuild build -project ComicsReader.xcodeproj -scheme ComicsReader -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
```

After adding or removing files, or editing `project.yml`, regenerate the Xcode project with `xcodegen generate`.

## Deploy to a device

`deploy.sh` builds the app, installs it on the connected iPad, and launches it. It uses the only connected physical device and the first development team signed in to Xcode:

```bash
./deploy.sh
```

Options: `--device <udid>` when several devices are connected, `--team <team id>` (or the `DEVELOPMENT_TEAM` environment variable), `--configuration Release`, and `--no-launch`.

The device must be paired with this Mac and have Developer Mode enabled. The first time, iOS blocks the launch until you trust the developer in Settings > General > VPN & Device Management. With a free Personal Team, the app expires after 7 days; run the script again to reinstall it.
