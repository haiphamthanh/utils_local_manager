# Learning Hub Integration Plan

## Goal

Create a local workspace at `http://127.0.0.1:7070/` that hosts:

- `JLPT Daily` -> `http://127.0.0.1:3000/`
- `Roadmap Words` -> `http://127.0.0.1:8000/`

## Recommended UX

Use a tab-first layout with:

- A compact health overview for both apps
- Two top-level tabs only
- A large embedded content area
- A split-view toggle for side-by-side study
- Fast actions: refresh current app, open original app

This is better than a heavy sidebar because the user task is content consumption, not deep navigation.

## Architecture

### Phase 1: Shell app

Current prototype in this repo:

- Runs on `127.0.0.1:7070`
- Embeds both apps with `iframe`
- Stores the last active tab in `localStorage`
- Supports split view and basic health checks

### Phase 2: Validate iframe compatibility

Check whether either app blocks embedding through:

- `X-Frame-Options`
- `Content-Security-Policy: frame-ancestors`

If either app blocks framing, direct embed is not enough.

### Phase 3: Reverse-proxy path strategy

If needed, move to:

- `/apps/jlpt` -> `127.0.0.1:3000`
- `/apps/roadmap` -> `127.0.0.1:8000`

Benefits:

- One local entrypoint
- Cleaner bookmarks
- Easier future expansion
- Better control over auth/cookies/navigation if apps are adjusted for proxied base paths

### Phase 4: Deep integration

Only do this if you want the parent shell and child apps to coordinate:

- Add a shared event contract with `window.postMessage`
- Let child apps expose events like lesson completed, next word, streak updated
- Show cross-app progress in the Learning Hub header

## UX roadmap

### Version 1

- Tab switching
- Split view
- Health status
- Open original app
- Refresh current app

### Version 2

- Focus mode
- Keyboard shortcuts
- Session restore
- Daily study checklist

### Version 3

- Cross-app progress widgets
- Unified notifications
- Search across both tools

## Technical risks

1. Some local apps cannot be framed because of browser security headers.
2. Reverse proxy alone may not fix apps that assume they run at `/`.
3. WebSocket-heavy apps may need explicit proxy support later.

## Next practical step

Run the shell, test both embeds, then decide whether to keep direct `iframe` mode or upgrade to proxy mode.
