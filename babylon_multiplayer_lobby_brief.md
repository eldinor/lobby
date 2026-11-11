# Babylon.js Multiplayer Social Lobby – Coding Agent Brief

## Goal
Build a small, browser-based **multiplayer 3D social lobby** using Babylon.js and TypeScript. Several users should open the same URL, see one another's avatars, and walk around together in real time.

**Primary constraint:** Keep this demo simple. The app must deploy as **static files on GitHub Pages**. Do not introduce Colyseus, a custom Node.js game server, or unnecessary frameworks.

## Agreed stack
- **Babylon.js** – scene rendering, third-person camera, basic avatar controllers.
- **TypeScript** – client application.
- **GitHub Pages** – static deployment.
- **Supabase Realtime** – player presence and synchronization; text chat later.
- **WebRTC** – optional voice chat in a later phase, *not part of the first milestone*. WebRTC may require signaling and STUN/TURN connectivity.

Supabase project is being created. The coding agent should obtain configuration through environment/build-time configuration, not hardcode credentials. Browser use of the Supabase **publishable/anon key** is acceptable with appropriate policies. **Never expose** the database password, service-role key, or other secret keys.

## First milestone – two users see each other
1. Load one compact 3D lobby in a browser.
2. Allow the visitor to enter a display name (and optionally select an avatar color).
3. Spawn a simple avatar with a visible name label.
4. Move the **local** avatar using WASD, with a third-person follow/orbit camera.
5. When the same URL is opened in another browser/tab, both users see each other's avatars.
6. Smoothly interpolate **remote** avatars between received position/rotation updates.
7. Remove remote avatars when users disconnect or their presence times out.
8. Verify the built app works from a GitHub Pages subpath, not only at domain root.

**Definition of done:** Two distinct browser sessions can join, move independently, see each other moving smoothly, and leave without ghost avatars. No additional features are needed for milestone one.

## Scene concept
- One small, lightweight, stylized room, roughly 20 × 20 meters.
- Central open meeting area, entrance/spawn points, a lounge/seating area, and a wall display or interaction area.
- Simple low-poly geometry and shared materials. Favor a clean, functional prototype over elaborate art.
- No complex physics, combat, inventory, progression, authentication flow, or multiple rooms.
- Start with primitive or lightweight avatar models. Proper rigged GLB characters and animations may be considered later.

## Controls and player experience
- **WASD** – movement relative to the camera's horizontal facing direction.
- **Mouse/pointer** – orbit camera around avatar.
- **Mouse wheel** – adjust camera distance within limits.
- Avatar faces its direction of travel, with smooth rotation.
- Camera should avoid passing through walls where feasible, without creating an elaborate camera system.
- On arrival, show other participants and their display names promptly.
- Use lightweight HTML/CSS overlays for name entry, HUD, chat and interaction prompts rather than embedding all UI in the 3D world.

## Multiplayer design
- Use **one Supabase Realtime channel / one lobby** for the initial demonstration.
- **Presence** is for participant membership and identity (session ID, name, avatar color), not high-frequency movement.
- **Broadcast** can carry throttled player position, rotation, and movement state updates. Start with approximately **10 updates/second per moving player** and adjust based on actual behavior, limits and usage.
- Each browser owns its local camera and immediate local movement. Remote avatars are interpolated for smoothness.
- Use distinct **ephemeral session IDs** so two tabs with the same display name remain different players.
- Ignore self-echoes, handle late joins and disconnects, and avoid stale updates by using sequence numbers or timestamps where appropriate.
- On joining, newcomers must learn existing player states (e.g. initial state broadcasts / snapshot response) rather than waiting indefinitely for other users to move.
- Treat the system as a **friendly demo**, not a cheat-resistant authoritative multiplayer game. Validate/sanitize displayed user-controlled text and limit message sizes/frequency.
- Use Supabase channel access appropriate for a public prototype. Never assume that a public publishable key alone provides abuse protection; review policies and usage limits before public launch.

## Future features – explicitly after milestone one
### Phase 2 – social basics
- Room-wide text chat.
- Online user count.
- Simple avatar color variations.
- Wave emote and optional speech bubbles.

### Phase 3 – shared interactions
- Sit/stand at a few designated chairs.
- Shared wall display with a few predefined pages.
- Coordinate shared choices to avoid two users occupying the same seat. A purely client/realtime demo requires conflict resolution; stronger server-side enforcement would require additional backend logic.

### Phase 4 – voice (optional)
- Direct browser-to-browser **WebRTC audio**, with Supabase used for signaling if suitable.
- Proximity-based volume via Web Audio API and avatar positions.
- Explicit microphone permission, muted by default, visible speaking/mute indicators.
- STUN and potentially TURN are required for reliable operation across networks; GitHub Pages alone cannot provide them. At 5–10 participants, peer-to-peer voice may be bandwidth-intensive, so test before committing to this approach.
- **Do not implement voice in the first milestone.**

## Design boundaries
- Target approximately **5–10 simultaneous participants** in one lobby, initially validate with two.
- Browser renders 3D locally; Supabase only synchronizes relevant state.
- No database schema required for the first iteration if Presence/Broadcast is sufficient.
- No Colyseus, Socket.IO server, dedicated VPS, or LiveKit Cloud for the first prototype.
- Avoid overengineering, premature abstractions, a complex asset pipeline, and backend infrastructure not needed to prove the core experience.

## Deliverables for the coding agent
1. A minimal TypeScript Babylon.js project that produces static deployable assets.
2. Straightforward Supabase Realtime integration, configured using public project URL and publishable/anon key.
3. A brief README covering local development, Supabase setup, and GitHub Pages deployment.
4. A manual test checklist for two browsers/tabs: join, move, name labels, late join, disconnect/reconnect.

## Key priority
**Make two avatars meet in the same 3D room first.** Add chat, seating, shared screens and voice only after that works reliably.
