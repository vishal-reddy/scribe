# Deep Dive: Multi-App Collective Storage Quota

Scribe implements the collective quota contract defined across all Kecker Office applications (`scribe`, `pointless`, `base`, `ovrwhlm`).

## Quota Contract Specifications

- **Limit**: Exactly 50,000,000 bytes (50 MB).
- **Scope**: Cumulative sum of user data stored across:
  - Scribe: Document text, revision history, attachments
  - Pointless: Presentation slide decks and asset files
  - Base: Spreadsheets, sheets, cell tables, formula matrices
  - Ovrwhlm: Eisenhower matrix tasks, subtasks, projects, voice notes
- **Identity Canonicalization**: Kinde user subject identifiers (`kp_...`) and canonical user emails are cross-referenced to prevent quota evasion via alternate identity tokens.
- **Write-Gating**: Gated on `POST /api/documents`, `PUT /api/documents/:id`, and MCP tool mutation calls.
