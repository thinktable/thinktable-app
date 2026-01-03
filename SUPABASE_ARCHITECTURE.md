# Supabase Project Architecture

## Should All Repos Use the Same Supabase Project?

**Yes, all apps should use the same Supabase project.** Here's why:

### Recommended: Shared Supabase Project

```
thinktable/
  apps/
    web/              → Same Supabase project (thinktable-app)
    backend/          → Same Supabase project (thinktable-app)
  packages/
    map-engine/       → No Supabase config (library)
    design-system/    → No Supabase config (library)
    mcp-tools/        → No Supabase config (library)
```

### Benefits of Shared Project:

1. **Unified Data Model**: Single source of truth for all data
2. **Simplified Auth**: Users authenticate once, access all services
3. **Real-time Sync**: Changes in one app reflect in others immediately
4. **Cost Efficiency**: One database, one project to manage
5. **Easier Development**: No need to sync data between projects
6. **Consistent RLS Policies**: Security rules apply across all apps

### When to Use Separate Projects:

Only consider separate Supabase projects if:
- **Multi-tenant SaaS**: Each tenant needs isolated data
- **Different Environments**: Production vs staging vs development
- **Completely Separate Products**: Unrelated applications
- **Regulatory Requirements**: Data must be physically separated

### Current Setup:

All apps (`web`, `backend`) use the same Supabase project:
- **Project URL**: `https://mbwefpatkvhxnuwdzalx.supabase.co`
- **Project ID**: `mbwefpatkvhxnuwdzalx`

### Environment Variables:

- **Frontend (`apps/web`)**: Uses `NEXT_PUBLIC_SUPABASE_*` (exposed to browser)
- **Backend (`apps/backend`)**: Uses `SUPABASE_*` (server-side only, can use service role key)

### Packages:

Packages (`map-engine`, `design-system`, `mcp-tools`) don't need Supabase configs:
- They're libraries consumed by apps
- Apps pass Supabase clients as dependencies
- Keeps packages framework-agnostic

