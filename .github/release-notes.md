Download the installer for your platform below.

- **macOS** — `.dmg`. Unsigned for now, so the first launch needs
  right-click → Open. Updates afterwards are automatic.
- **Windows** — `.exe` for a normal install, `.msi` if you prefer it.
- **Linux** — `.deb` for Debian/Ubuntu/Mint, `.rpm` for
  Fedora/openSUSE, and the `.AppImage` for everything else
  (Arch gets it through the AUR build or the AppImage directly).
  The in-app updater covers Linux when installed from the AppImage.
- **Android** — `.apk`, arm64. Sideload it; there is no store
  listing, so the phone will ask you to allow installing from this
  source. Reading and downloading work; building a volume writes it
  to the app's own storage, and the Share button on a built volume
  is how it gets anywhere else.

The `.sig`, `.tar.gz` and `latest.json` files are what the in-app
updater reads. You do not need to download them.
