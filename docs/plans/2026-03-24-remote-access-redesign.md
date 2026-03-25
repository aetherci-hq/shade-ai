# Remote Access Panel Redesign

## Overview

Replace the three plain form fields (Host, Port, Auth Token) in the Config panel with a dedicated **Access** panel that functions as a security control center. The panel communicates uncompromised security through visual state, deliberate interaction patterns, real-time connection monitoring, and an instant kill switch.

## Panel States

Three distinct visual states, immediately obvious at a glance:

### Locked (host is `127.0.0.1`)
- Entire panel rendered in muted, desaturated grays
- Large lock icon centered above the slide track
- All text low-contrast (`text-c-muted` or dimmer)
- Panel border nearly invisible (`border-c-border`)
- Slide track reads "SLIDE TO ARM" in faint uppercase
- Feel: a sealed vault door — inert, dormant, safe

### Armed (host is `0.0.0.0`, auth token set, listening)
- Panel border shifts to solid amber (`border-c-amber`) with pulsing glow animation
- Lock icon transitions to unlocked
- Status line: "REMOTE ACCESS ACTIVE" in amber
- Slide track replaced by connection monitor and kill switch
- Faint amber radial gradient on background
- Feel: this is open, pay attention

### Armed + Connections (remote clients connected)
- Border escalates to crimson (`border-c-red`) with stronger glow
- Client list populates with IPs, durations, per-client disconnect buttons
- Kill switch becomes the most prominent element
- Feel: active threat surface, stay vigilant

## Slide-to-Arm Interaction

The centerpiece of the Locked state. Centered vertically with generous whitespace.

**Track:** Horizontal rectangle (~320px wide), dark recessed background with inset shadow. Sharp corners. Faint centered text: "SLIDE TO ARM" in `text-c-muted`.

**Handle:** Square knob (~44px) at left edge with lock icon. Only element with visual weight in locked state.

**Drag behavior:**
- Amber gradient fills behind handle as it moves right
- "SLIDE TO ARM" fades, replaced by "ARMING..." at ~60%
- Handle transitions from gray to amber
- Release before ~90% threshold: handle snaps back with spring animation (cancelled)
- Reach the end: track flashes amber, server call fires

**On completion:** `PUT /api/config` sets host to `0.0.0.0` + auto-generates token if needed. Brief "ACTIVATING..." status while awaiting server response, then transition to Armed state.

**Pre-flight check:** If no auth token is configured, an inline section appears above the track: "Set an auth token to enable remote access" with a token input and generate button. Slide track stays disabled (lower opacity, handle won't move) until token exists.

## Connection Monitor

Replaces the slide track once armed.

**Status header:** "LISTENING ON 0.0.0.0:3700" in amber with breathing dot. Encryption badge showing "WSS ENCRYPTED" or "WS UNENCRYPTED" based on connection protocol.

**Client list:** Compact rows showing:
- IP address (e.g., `192.168.1.42`)
- Live-updating connection duration (e.g., `4m 32s`)
- Per-client `x` disconnect button

Local connections (127.0.0.1) excluded — only remote clients shown. Empty state: "No remote connections" in muted text. New connections animate in with `fade-in`. Border escalates to crimson when clients are present.

**Kill Switch:** Full-width button below client list. Crimson border, "KILL SWITCH" in uppercase. Single click immediately:
1. Disconnects all remote WebSocket clients
2. Flips host to `127.0.0.1` in config, persists to yaml
3. Transitions panel to Locked state

No confirmation modal — instant response is the point. Hover fills with crimson background.

**Per-client disconnect:** The `x` button on each row boots that single client without affecting others or changing the armed state.

## Server-Side Changes

### New endpoint: `GET /api/access/status`
```json
{
  "armed": true,
  "host": "0.0.0.0",
  "port": 3700,
  "authToken": true,
  "clients": [
    { "id": "abc123", "ip": "192.168.1.42", "connectedAt": 1711300000000, "userAgent": "Mozilla/5.0..." }
  ]
}
```

### New endpoint: `POST /api/access/kill`
Full lockdown. Closes all remote WebSocket connections, updates config to `host: 127.0.0.1`, persists to yaml. Returns `{ ok: true }`.

### New endpoint: `POST /api/access/disconnect/:id`
Boots single remote client by ID. Returns `{ ok: true }`.

### WebSocket client tracking
Swap `clients` from `Set<WebSocket>` to `Map<WebSocket, ClientMeta>` where `ClientMeta` holds `id`, `ip`, `connectedAt`, `userAgent` extracted from upgrade request headers.

### New events
- `access:client_connected` — `{ id, ip, connectedAt }`
- `access:client_disconnected` — `{ id, ip, reason: 'closed' | 'kicked' | 'killed' }`

Broadcast via existing WebSocket infrastructure.

## Nav Integration

**Position:** After Tools, before Config in `NAV_ITEMS`.

**Icon:** `Shield` from lucide-react, state-aware:
- Locked: `text-c-muted` (default inactive style)
- Armed, no connections: `text-c-amber` always (persistent warning)
- Armed + connections: `text-c-red` always, with `breathe` animation

The nav icon acts as a passive security indicator across the entire dashboard.

**View type:** Add `'access'` to the `View` union.

**Shell prop:** `accessState: 'locked' | 'armed' | 'connected'` passed from App, derived from access status. Used solely for nav icon styling.

## Component Structure

**App.tsx:** Fetches `/api/access/status` on mount, listens for `access:client_connected` / `access:client_disconnected` events, derives `accessState`, passes to Shell and AccessPanel.

**AccessPanel** (`panels/AccessPanel.tsx`): Single file. Props:
- `accessStatus` — full status object
- `onArm` — fires `PUT /api/config`
- `onKill` — fires `POST /api/access/kill`
- `onDisconnect` — fires `POST /api/access/disconnect/:id`
- `onTokenChange` — for pre-flight token input

**SlideToArm:** Sub-component within AccessPanel. Drag logic via `onPointerDown`/`onPointerMove`/`onPointerUp`. `useState` for handle position (0-1 float), `useRef` for active drag flag. CSS `transform: translateX(...)` for 60fps movement. No libraries.

**Client list:** Maps over clients array. Shared `setInterval` (1s) for duration timers.

## Config Panel Cleanup

Remove the "Remote Access" section (Host, Port, Auth Token fields) from ConfigPanel. Port stays in Config under a minimal "Server" section since it's operational, not security. Host and Auth Token are now controlled exclusively through the Access panel.
