# ROAS Pilot working instructions

## User-authorized releases

The owner explicitly authorized automatic deployment of requested ROAS Pilot updates on 2026-10-29. This supersedes older instructions against GitHub/external update distribution. After implementing and validating an authorized update, publish it through the existing GitHub release and manifest workflow without asking again for routine deployment confirmation.

Before publishing, inspect the current remote main and preserve concurrent work. Use a unique increasing package/server version, keep generated runtime bundles current, run relevant tests, and verify both the successful release and updated manifest. Never force-overwrite remote work.

Preserve the existing updater backup and rollback behavior. Never publish runtime credentials, .env files, user records, or .roas-data contents. User data stays outside managed program updates. Report the release version and any remaining installation limitation accurately; do not claim the owner's laptop was updated without evidence.
