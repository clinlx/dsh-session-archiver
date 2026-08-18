# Changelog

## 0.2.0

- Adds a dedicated scheduled-deletion tab.
- Archives and marks opened, non-running sessions for deletion at the next DSH startup.
- Keeps failed scheduled deletions archived and marked for automatic retry.
- Cancelling a scheduled deletion keeps the session archived.
- Removes stale marks automatically when a session is no longer archived.

## 0.1.0

- Initial GitHub-installable release.
- Adds the session management button and archive management dialog.
- Adds static web UI plus host-only per-session handlers.
- Keeps deletion conservative for live or running sessions.
