# Migration: Add flashcard tag button with study set dropdown and tag boxes
# Date: 2025-12-24
# Description: Added UI functionality for flashcards to tag them to study sets
#              No database schema changes required as this uses existing:
#              - messages.metadata.studySetIds (JSONB array)
#              - profiles.metadata.studySets (JSONB array)

## Changes

### UI Features Added
- Tag button (Plus icon) positioned to the right of flashcard karot in both collapsed and expanded states
- Dropdown menu showing:
  - "New set" button at the top (creates new study set and tags flashcard)
  - List of existing study sets (tags flashcard to selected set)
- Tag boxes component displaying study set names as badges when flashcard is tagged
- Real-time updates when flashcards are tagged to study sets

### Implementation Details
- Created reusable `TagButton` component for both collapsed and expanded states
- Created `TagBoxes` component to display tagged study sets
- Uses existing `messages.metadata.studySetIds` JSONB field to store study set IDs
- Uses existing `profiles.metadata.studySets` JSONB field to store study set definitions
- Implements Supabase Realtime subscription for live tag updates

### No Schema Changes
This feature uses existing database schema:
- `messages.metadata` (JSONB) - Already supports `studySetIds` array
- `profiles.metadata` (JSONB) - Already supports `studySets` array

No SQL migration needed - this is a UI feature that uses existing schema.





