# History watch-status filter

Requires the Watch Ledger build with the user-filter update.

From ~/streamystats-dev, extract watch-ledger-in-progress-update.zip directly
into the current directory, then run bash install-ledger.sh --install.
This archive contains paths relative to the repository, not a parent folder.

In Watch Ledger > History, choose Watch status > In progress to review
unfinished episodes and movies for the selected user. All watches and Completed
are also available. Search, media type, and date filters still apply.

The filter uses the current completion of each whole watch. It excludes a
completed watch's earlier incomplete playback days from the In progress view.
Calendar, recap, and headline totals retain their existing behavior.

Open a watch's arrow menu, check Completed watch, then Save corrections.
The corrected watch disappears from In progress. Reset corrections to undo.
Raw playback sessions remain intact. This update only changes the UI.

Validation: Next.js production compilation and TypeScript check passed.
No database migration is needed. Live browser verification remains on the server.
