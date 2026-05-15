# Mobile Pairing

This document describes the development pairing path for the Expo mobile app.
The protocol uses the existing Go daemon remote relay implementation; no daemon
RPC schema changes are required.

## Components

```text
Expo mobile app
  -> ws://<relay-host>:<relay-port>/relay
  -> Go relay
  -> Go daemon remote manager
  -> daemon JSON-RPC methods
```

The phone only needs to reach the relay. The daemon can stay bound to localhost
as long as it can open its outbound relay control/data WebSocket connections.

## Start A Development Relay

Build and run the relay from the repository root:

```bash
cd daemon
go build -o ../bin/crew44-relay ./cmd/crew44-relay
HOST=0.0.0.0 PORT=8090 ../bin/crew44-relay
```

Use the development machine's LAN IP in the relay URL shown to the daemon and
mobile app:

```text
ws://<lan-ip>:8090/relay
```

The desktop Pair Mobile dialog defaults to the Mindive Labs relay:

```text
wss://relay.mindivelabs.com/relay
```

The HTTP health endpoint for that relay is:

```text
https://relay.mindivelabs.com/health
```

Do not use `localhost` in the relay URL for a physical phone; that would point
at the phone itself.

## Use Expo Go Outside The LAN

When the iPhone is not on the same LAN as the development machine, start Expo
with tunnel mode from the repository root:

```bash
npm run mobile:start -- --tunnel --clear
```

Expo tunnel mode uses ngrok to publish the Metro development server. Keep the
terminal session running, open Expo Go on the iPhone, and scan the printed QR or
enter the printed `exp://*.exp.direct` URL.

This only makes the Expo development app reachable. The remote pairing and chat
connection still uses the relay URL from the pairing QR, so use a relay that is
also reachable outside the LAN, such as:

```text
wss://relay.mindivelabs.com/relay
```

## Generate A Pairing QR

The preferred path is the desktop UI:

1. Open the desktop app.
2. Choose "Pair Mobile".
3. Enter the relay URL.
4. Scan the rendered QR from the mobile Pair screen.

For a temporary CLI-only pairing flow, start a local daemon without auth on a
development port:

```bash
CREW44_DAEMON_HOST=127.0.0.1 CREW44_DAEMON_PORT=18080 ./bin/crew44-daemon
```

Then call `remote.pairing.create` over the daemon WebSocket RPC:

```bash
node -e "
const WebSocket = require('ws');
const qrcode = require('qrcode-terminal');
const relayUrl = process.env.RELAY_URL;
if (!relayUrl) throw new Error('RELAY_URL is required');
const ws = new WebSocket('ws://127.0.0.1:18080/rpc', 'crew44.rpc.v1');
const id = 'pair-' + Date.now();
ws.on('open', () => ws.send(JSON.stringify({
  jsonrpc: '2.0',
  id,
  method: 'remote.pairing.create',
  params: { relay_url: relayUrl }
})));
ws.on('message', data => {
  const msg = JSON.parse(data.toString());
  if (msg.id !== id) return;
  if (msg.error) throw new Error(JSON.stringify(msg.error));
  console.log(msg.result.qr_text);
  qrcode.generate(msg.result.qr_text, { small: true });
  ws.close();
});
"
```

Example invocation:

```bash
RELAY_URL=ws://<lan-ip>:8090/relay node -e "<script above>"
```

Pairing offers expire quickly. Generate a new QR when the app reports an
expired offer.

## Troubleshooting

- If Expo Go opens but pairing cannot connect, verify the phone can reach the
  relay host and port.
- If the relay URL uses `localhost`, replace it with the development machine's
  LAN IP or a routable tunnel URL.
- If the mobile app shows an invalid hook call during development, clear the
  Metro cache and confirm the workspace resolves a single React version:

  ```bash
  npm ls react --parseable --all
  npm run mobile:start -- --lan --clear
  ```

- If the daemon has auth enabled, the CLI helper above will need the
  `crew44.bearer.<token>` WebSocket subprotocol. The desktop UI already uses
  the authenticated renderer RPC client.
