# Graybox social lobby

Gray-box multiplayer prototype for the [project brief](babylon_multiplayer_lobby_brief.md). Visitors share one room through Supabase Realtime, with local movement and interpolated remote avatars.

## Run

Use Node.js 22.22+ (or a newer supported release). The LiveKit SDK's `machina` dependency requires Node 22.22; the build also passes on this workspace's older Node 22.20, but upgrading avoids its engine warning.

```sh
npm ci
npm run dev
```

Open the printed localhost URL. Enter a display name, then use WASD to walk relative to the camera, drag to orbit, and scroll to zoom. Reset position restores the spawn and camera. Desktop keyboard and mouse are the target for this stage.

Hold **Shift** while moving to run, and press **Space** to jump. Walking is 3.5 m/s, running is 6.5 m/s. Movement accelerates and brakes smoothly, with reduced steering in the air. Jumps reach roughly 1.2 m above takeoff and can land on the benches and table. Each press triggers one jump; holding Space does not repeat. A short jump buffer and coyote time make edge and landing timing more forgiving. Losing window focus clears movement input. Reset also clears momentum.

Characters use Babylon primitive geometry with procedural idle, walk, run and airborne poses. No GLB files, model downloads, or external animation assets are required. Running/grounded state travels with movement packets so remote characters use matching poses.

## LiveKit voice and video

Set `VITE_MEDIA_PROVIDER=livekit` in `.env.local` and restart Vite. Enter the lobby, then click **Join voice** to listen and receive webcam discs. Both camera and microphone stay off until enabled separately. **Leave voice** disconnects all media and stops capture while movement/chat continue. **Enable sound** appears when the browser blocks audio playback. Speaking participants have green outlines. Media joins only on request, avoiding participant-minute usage for visitors who only walk/chat.

### Token function deployment

1. Enable **Anonymous Sign-Ins** in Supabase Authentication. The client creates a guest session only when joining media; no login screen is added.
2. Store `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in **Edge Functions → Secrets**. The URL must start with `wss://`.
3. Run `npm run prepare:livekit` after changing the handler. In Supabase **Edge Functions → Deploy a new function → Via Editor**, name the function **livekit-token**. Replace the template with the full contents of [supabase/livekit-token-dashboard.ts](supabase/livekit-token-dashboard.ts), then deploy.
4. For this function only, disable **Verify JWT with legacy secret**. The handler independently verifies each guest JWT through Supabase Auth's `/auth/v1/user`, including projects using asymmetric signing keys.
5. Before GitHub Pages publication, add `LOBBY_ALLOWED_ORIGINS` to the function secrets with the frontend origin, such as `https://your-name.github.io` (without the repository path). Separate multiple origins with commas. Development ports 5173 and 4173–4177 on localhost/127.0.0.1 are already allowed.

Alternatively, after authenticating the CLI with `npx supabase login`:

```sh
npx supabase functions deploy livekit-token --project-ref ciwuzdqgrjiuamleuftt --no-verify-jwt
```

The server validates guest identity and bounded input, then signs a ten-minute token for **lobby-001** with camera/microphone and subscription permissions. Data publishing and metadata updates are disabled. Identity combines the verified guest and avatar session IDs, keeping tabs distinct. Basic throttling is in-memory per function instance, not distributed abuse protection. Anonymous Auth users count toward Supabase quotas and may need periodic cleanup. This remains a friendly public demo, not an authoritative identity system.

The token endpoint defaults to `${VITE_SUPABASE_URL}/functions/v1/livekit-token`; optionally override `VITE_LIVEKIT_TOKEN_URL`. Never put server secrets in `VITE_*` variables. The unrestricted LiveKit development token server is not used. Stay on LiveKit's free Build plan and monitor its participant-minute and bandwidth caps.

### Webcam discs and legacy mode

Click **Turn camera on** to share video separately from microphone audio. Other participants must join media to receive LiveKit video. Your own preview is mirrored. Turning the camera off, leaving voice, or leaving the lobby stops camera capture. Overlays face the viewer and follow interpolated avatars; like name labels, they are HTML overlays rather than depth-occluded scene geometry.

Setting `VITE_MEDIA_PROVIDER=peer` (or omitting the variable) retains the earlier video-only peer-to-peer implementation. In that mode, Supabase relays SDP/ICE signaling and Google's public STUN service helps direct connections; no TURN relay is configured by default. `VITE_WEBRTC_ICE_SERVERS` accepts optional browser-visible ICE server JSON with short-lived credentials. This legacy mode has no microphone support. HTTPS or localhost is required for camera/microphone access in either mode.

References: [MDN perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation), [WebRTC protocols and TURN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols).

## Room chat

Chat is available after joining, in the bottom-right panel. Press **Enter** while the room canvas is focused to start typing; **Enter** sends and **Esc** returns to movement. Focusing the input stops held movement, and chat keystrokes never trigger WASD or jumping. Collapse the panel to see unread incoming message counts.

The north-wall display mirrors the latest six messages using a Babylon `DynamicTexture`. Each message shows its author and up to two wrapped lines, with an ellipsis for longer previews. The HTML chat retains the full text. The texture redraws only on a message or session reset; leaving/rejoining clears it. Each client draws the messages received during its own visit, so late joiners start with the empty screen rather than historical conversation.

Messages use the existing Supabase Realtime channel, with no additional paid service, tables, or database setup. Names and messages are rendered as plain text, limited to 300 message characters and one outgoing message per second. Incoming duplicates and excessive bursts are ignored. Sending is disabled while disconnected; drafts survive reconnects and failed sends. Up to 100 messages are retained locally for the current visit. There is no stored history, replay for late joiners, or delivery guarantee during connection interruptions. Leaving clears the panel. The public-demo identity and access limitations described above also apply to chat.

## Supabase configuration

Copy `.env.example` to `.env.local` and fill in your project's URL and **publishable** key. Restart Vite after changing environment values. Without these values, the app runs as a local movement preview.

In Supabase's Realtime settings, enable the Realtime service and **Allow public access to channels**. This prototype explicitly uses one public channel, `lobby-001`; no tables, database schema, Data API, or sign-in are required. Presence carries session identity, while Broadcast carries movement at up to 10 Hz, final stop updates, and occasional stationary heartbeats. A snapshot exchange initializes stationary players for late joins. Supabase handles transport retries; the client re-tracks identity and refreshes states after reconnecting.

These environment values are public browser configuration and become part of the static build. Never put a database password, secret key, or service-role key in `VITE_*` variables. Public channels are intended for a friendly prototype: participants can impersonate names and send messages. Client validation and rate limits do not provide authoritative access control. Review Supabase usage quotas and channel access before a public launch.

When building in GitHub Actions, provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as build-step environment variables from repository Actions variables. `.env.local` is ignored and stays on your machine.

## Check and build

```sh
npm run build
npm run typecheck:edge
npm run test:token
npx playwright install chromium
npm test
npm run test:multiplayer
npm run test:webcam
npm run test:chat
npm run test:livekit-setup
```

The browser check starts its own production preview on port 4174 under `/lobby/`, then checks joining, safe name rendering, movement, camera orbit/zoom, diagonal speed, collisions, reset, and clearing held keys on blur. It needs a Chromium-capable environment.

The multiplayer check uses port 4175 and your configured live Supabase project. It uses two isolated browser contexts to check duplicate names, stationary late joins, independent movement, departure and rejoining. Build with the Supabase configuration before running it. Tests briefly join the same public prototype room as other visitors.

The webcam check uses port 4176 and simulated devices. It supports both media providers; LiveKit mode requires the deployed token function and checks received audio after explicit unmute, plus capture release on mute. The setup test uses the same port separately and verifies real anonymous guest auth with a simulated missing token endpoint. Neither accesses real devices or proves cross-network connectivity. Token tests verify real JWT signatures, limited grants, expiry, input rejection and throttling against a mocked Auth verifier.

The chat check uses port 4177 and two isolated sessions to verify two-way messaging, safe text rendering, unread counts, keyboard isolation, preserved drafts across reconnects, rate limiting, narrow layout and cleanup on leave.

It also checks matching wall-texture content on both clients, six-message eviction, wrapping of long unbroken text, and that the canvas stays unchanged between messages. Screenshots are written to `test-results/chat.png` and `test-results/chat-screen-texture.png`.

`dist/` contains static assets. Vite uses a relative base so the build also works at a GitHub Pages repository subpath. To publish, upload `dist/` as the GitHub Pages artifact using GitHub Actions (repository Settings → Pages → Source: GitHub Actions), or serve its contents from your existing Pages branch. No backend or secrets are needed for stage 1.

### Deploy from the gh-pages branch

```sh
npm run deploy
npm run pages:configure
```

`deploy` builds with your local `.env.local`, then publishes only `dist/` to the origin remote's `gh-pages` branch, including `.nojekyll`. It preserves the source checkout and updates the deployment branch without force-pushing. Local environment files, source code and server functions are not copied into the deployment branch. Public Vite settings are intentionally embedded into the browser build; LiveKit secrets remain only in Supabase.

`pages:configure` reuses Git's configured GitHub credential helper, without writing credentials to the project, to select **Deploy from a branch → gh-pages → / (root)**. If the credential lacks Pages administration permission, select those settings manually in [the repository's Pages settings](https://github.com/eldinor/lobby/settings/pages).

The site URL is **https://eldinor.github.io/lobby/**. Set the Supabase `LOBBY_ALLOWED_ORIGINS` secret to `https://eldinor.github.io` so voice/video token requests from this origin are accepted. Repeat `npm run deploy` after frontend changes; Pages configuration is only needed once.

`npm run test:published` runs the two-session webcam/voice checks against the public site using simulated devices. It uses real Supabase/LiveKit connections and briefly consumes their free-plan allowances.

## Manual acceptance

- Join with a name; verify the label follows the avatar.
- Walk in all four directions and diagonally. Drag the view, then confirm W follows the new camera direction.
- Walk into benches and walls; confirm the avatar stops or slides instead of passing through.
- Hold Shift and compare walking/running; confirm diagonals do not increase speed.
- Jump in place and while running; land on the floor and benches, then walk off and fall naturally. Hold Space through landing to confirm it does not repeat.
- Zoom in and out; orbit near the room edges and check the camera view.
- Hold a movement key and switch windows; return and confirm movement has stopped.
- Reset position; resize the browser; check controls and labels remain usable.
- Open two independent browsers/tabs with the same display name: confirm two distinct avatars and participant entries.
- Move one player, stop, then join with the other: confirm the stopped player appears at the correct position.
- Move both players independently; verify each sees the other's smooth motion and final resting position.
- Jump while the other browser watches; confirm the remote avatar rises and lands at the same height.
- Verify the primitive limbs animate for idle, walk, run and airborne movement in both sessions.
- Enable cameras separately in two browsers, move and jump, then disable one camera and leave. Verify discs follow players and camera capture stops. Test actual devices across different networks separately from the simulated-camera test.
- Send chat in both directions, including angle brackets and emoji. Collapse chat to check unread messages; type WASD and Space to confirm the avatar stays still. Reconnect with an unsent draft and confirm it remains available.
- Click Leave, rejoin, then close a tab abruptly: verify no ghost avatars remain. Stale avatars time out after 20 seconds without state updates; Presence normally removes departures sooner.
- Disconnect a browser's network, move locally, then reconnect: verify the status recovers and both browsers receive current positions. Background tab throttling can delay presence or state updates.

## Stages

1. **Complete:** gray-box 20 × 20 m room, primitive avatar, name entry, camera, movement and solid furniture.
2. **Implemented:** Supabase Presence/Broadcast, distinct session IDs, late-join snapshots, remote interpolation and disconnect/reconnect handling.
3. **Next:** visual polish after multiplayer acceptance. Chat, seating and voice remain outside milestone one.
