import React from 'react'

// Recaps/Lives browsing reuses the existing archive tables (runs, lives,
// recaps). v1 ships a stub that links to the data; richer browse is follow-up.
export default function Archive() {
  return (
    <div className="text-sm text-zinc-500">
      <p>Archive (recaps, lives, digests) — preserved in the database.</p>
      <p className="mt-2 text-zinc-600">Browse UI is a follow-up; data is migrated and queryable.</p>
    </div>
  )
}
