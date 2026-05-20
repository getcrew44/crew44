# Crew44 Mobile

TypeScript Expo app for pairing with a Crew44 desktop daemon over the remote
relay protocol. The app is iOS/Android focused; Expo web is not a target for
this package.

## Native Build Setup (One-Time Per Machine)

The `ios/` and `android/` directories are not committed — they are regenerated
from `app.json` via Expo's prebuild. Before the first native iOS build on a
machine you need a modern Ruby + CocoaPods.

```bash
# Ruby via rbenv (pinned by .ruby-version to 3.2.2)
brew install rbenv ruby-build
echo 'eval "$(rbenv init - zsh)"' >> ~/.zshrc && exec zsh
rbenv install 3.2.2

# Install bundler + the pinned CocoaPods from Gemfile
cd packages/mobile
gem install bundler
bundle install
```

Do not use `brew install cocoapods` — it bundles its own Ruby and breaks on
Xcode updates. Do not use `sudo gem install cocoapods` on system Ruby 2.6 —
it is end-of-life and ships incompatible native extensions.

## Native iOS Build

```bash
cd packages/mobile
npx expo prebuild --platform ios     # regenerates ios/ from app.json
cd ios
bundle exec pod install              # always via bundler, never bare `pod`
cd ..
npm run ios                          # builds + installs to simulator
```

For a physical device add `-- --device` to the last command (and sign in Xcode
the first time).

## Run On A Phone

From the repository root:

```bash
npm run mobile:start -- --lan --port 8085 --clear
```

Install Expo Go on the phone, keep the phone on the same network as the
development machine, then scan the QR printed by Expo.

Use `--tunnel` when the phone is not on the same LAN as the development
machine, or when LAN discovery is blocked by the network:

```bash
npm run mobile:start -- --tunnel --clear
```

Tunnel mode uses the package-local `@expo/ngrok` dev dependency, so Expo should
not need to install ngrok globally at startup. Keep the Metro terminal running,
open Expo Go on the iPhone, and scan the tunnel QR or enter the printed
`exp://*.exp.direct` URL. The tunnel is only for loading the development app in
Expo Go; pairing and chat traffic still require a relay URL that is reachable
from both the phone and the daemon.

## Pair With The Daemon

Pairing needs a reachable relay and a daemon that can create a pairing offer.
The relay URL must be reachable from the phone, usually with the development
machine's LAN IP:

```text
ws://<lan-ip>:8090/relay
```

The desktop Pair Mobile dialog defaults to the Crew44 relay:

```text
wss://relay.crew44.io/relay
```

The normal development flow is:

1. Start a relay:

   ```bash
   cd daemon
   go build -o ../bin/crew44-relay ./cmd/crew44-relay
   HOST=0.0.0.0 PORT=8090 ../bin/crew44-relay
   ```

2. Start the desktop app or daemon.
3. Use the desktop "Pair Mobile" action and enter the relay URL.
4. Scan the resulting pairing QR from the mobile Pair screen.

The mobile app stores the private device key in `expo-secure-store` and stores
non-secret pairing metadata in AsyncStorage.

## Verification

From the repository root:

```bash
npm run typecheck --workspace=@crew44/mobile
npm run test:mobile
npm --workspace=@crew44/mobile exec expo export -- --platform ios --output-dir /tmp/crew44-mobile-export
```

## Protocol Notes

The mobile client implements the daemon remote relay protocol directly in
TypeScript:

- `Noise_NK_25519_ChaChaPoly_BLAKE2s` for first-time pairing
- `Noise_XK_25519_ChaChaPoly_BLAKE2s` for reconnecting paired devices
- RawStd base64 encoding for public/private X25519 keys
- length-prefixed encrypted frames carrying JSON-RPC 2.0 messages

There is intentionally no plaintext local-direct fallback and no mock-data
fallback. Empty states are real daemon results, and reconnect failures surface
as reconnect or pair-again states in the app.
