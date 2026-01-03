# GitHub Organization Setup Guide

This guide walks you through setting up the separate repositories in your GitHub organization `thinktableso`.

## Repository Structure

```
thinktable/
  apps/
    web/              → thinktable-app
    backend/          → thinktable-backend
  packages/
    map-engine/      → map-engine
    design-system/   → design-system
    mcp-tools/       → mcp-tools
```

## Prerequisites

1. **GitHub CLI** (recommended) or manual setup via GitHub web interface
2. **Authentication** with your GitHub account
3. **Organization access** to `thinktableso`

### Check GitHub CLI Installation

```bash
gh --version
```

If not installed:
```bash
# macOS
brew install gh

# Then authenticate
gh auth login
```

## Step 1: Create Repositories in GitHub Organization

### Option A: Using GitHub CLI (Recommended)

Run these commands from the `thinktable` directory:

```bash
# Create repositories in the organization
gh repo create thinktableso/thinktable-app --public --source=./apps/web --remote=origin --push
gh repo create thinktableso/thinktable-backend --public --source=./apps/backend --remote=origin --push
gh repo create thinktableso/map-engine --public --source=./packages/map-engine --remote=origin --push
gh repo create thinktableso/design-system --public --source=./packages/design-system --remote=origin --push
gh repo create thinktableso/mcp-tools --public --source=./packages/mcp-tools --remote=origin --push
```

### Option B: Manual Setup via GitHub Web Interface

For each repository:

1. Go to https://github.com/organizations/thinktableso/repositories/new
2. Create repository with the name:
   - `thinktable-app`
   - `thinktable-backend`
   - `map-engine`
   - `design-system`
   - `mcp-tools`
3. **Do NOT** initialize with README, .gitignore, or license (we already have these)
4. After creating, run these commands in each respective directory:

```bash
# For apps/web
cd apps/web
git remote add origin https://github.com/thinktableso/thinktable-app.git
git push -u origin main

# For apps/backend
cd apps/backend
git remote add origin https://github.com/thinktableso/thinktable-backend.git
git push -u origin main

# For packages/map-engine
cd packages/map-engine
git remote add origin https://github.com/thinktableso/map-engine.git
git push -u origin main

# For packages/design-system
cd packages/design-system
git remote add origin https://github.com/thinktableso/design-system.git
git push -u origin main

# For packages/mcp-tools
cd packages/mcp-tools
git remote add origin https://github.com/thinktableso/mcp-tools.git
git push -u origin main
```

## Step 2: Verify Setup

Check that all remotes are configured correctly:

```bash
# Check each repo's remote
cd apps/web && git remote -v
cd ../backend && git remote -v
cd ../../packages/map-engine && git remote -v
cd ../design-system && git remote -v
cd ../mcp-tools && git remote -v
```

## Step 3: Configure Repository Settings (Optional)

For each repository, you may want to configure:

1. **Branch protection rules** (Settings → Branches)
2. **Collaborators** (Settings → Collaborators)
3. **Webhooks** (Settings → Webhooks)
4. **Secrets** (Settings → Secrets and variables → Actions)

## Troubleshooting

### Authentication Issues

If you get authentication errors:

```bash
# Re-authenticate with GitHub
gh auth login

# Or use SSH instead of HTTPS
git remote set-url origin git@github.com:thinktableso/REPO_NAME.git
```

### Permission Issues

Ensure you have:
- Write access to the `thinktableso` organization
- Proper permissions to create repositories

### Repository Already Exists

If a repository already exists, you can add it as a remote:

```bash
git remote add origin https://github.com/thinktableso/REPO_NAME.git
git push -u origin main
```

## Next Steps

After setup:
1. Add `.gitignore` files to each repository
2. Set up CI/CD workflows
3. Configure package.json files for monorepo structure
4. Set up dependency management between packages

