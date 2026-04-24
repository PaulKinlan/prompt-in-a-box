# weekly-review-prompt

Schedule-driven. Fridays 17:00-17:59, once per week, writes a pre-filled weekly review template to OPFS, opens a new tab, and notifies.

- **Trigger:** alarm (Friday + time gate)
- **Required permissions:** `tabs`, `history`, `notifications`
- **Writes:** `OPFS://reviews/YYYY-MM-DD.md`
