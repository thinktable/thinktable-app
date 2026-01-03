# Environment Variables Setup Guide

## File Locations

Each app/service that needs environment variables has a `.env.local.example` template file:

```
thinktable/
  apps/
    web/
      .env.local.example     ← Template (committed to git)
      .env.local              ← Your actual values (gitignored)
    backend/
      .env.local.example     ← Template (committed to git)
      .env.local              ← Your actual values (gitignored)
  legacy/
    .env.local.example        ← Template (committed to git)
    .env.local                ← Your actual values (gitignored)
```

## Setup Instructions

### For Each App:

1. Copy the example file:
   ```bash
   cd apps/web
   cp .env.local.example .env.local
   ```

2. Edit `.env.local` with your actual credentials:
   - Supabase keys from your dashboard
   - OpenAI API key
   - Stripe keys
   - etc.

3. Never commit `.env.local` to git (it's in .gitignore)

### Supabase Project

**All apps share the same Supabase project** - see `SUPABASE_ARCHITECTURE.md` for details.

- Same project URL and keys for `web` and `backend`
- Frontend uses `NEXT_PUBLIC_SUPABASE_*` (browser-safe)
- Backend uses `SUPABASE_*` (server-side, can use service role)

### Packages

Packages (`map-engine`, `design-system`, `mcp-tools`) don't need `.env.local` files:
- They're libraries, not applications
- Apps pass configuration/dependencies to them
- Keeps packages framework-agnostic

## Recovery

If you lose your `.env.local` file, just copy from `.env.local.example`:
```bash
cp .env.local.example .env.local
# Then fill in your actual values
```

