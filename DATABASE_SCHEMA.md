# Database Schema - Thinkable SaaS

## Overview

The database is structured similar to ChatGPT SaaS business model with:
- User profiles and authentication
- Subscription management (Stripe)
- Usage tracking for rate limiting
- Conversations and messages
- Vector embeddings for semantic search

## Tables

### `profiles`
Extends `auth.users` with additional user information.
- `id` (UUID, FK to auth.users) - Primary key
- `email` - User email
- `full_name` - User's full name
- `avatar_url` - Profile picture URL
- `subscription_tier` - 'free', 'pro', or 'enterprise'
- `stripe_customer_id` - Stripe customer ID
- `stripe_subscription_id` - Stripe subscription ID
- `created_at`, `updated_at` - Timestamps

### `subscriptions`
Stripe subscription management.
- `id` (UUID) - Primary key
- `user_id` (UUID, FK to auth.users) - User reference
- `stripe_subscription_id` - Stripe subscription ID (unique)
- `stripe_customer_id` - Stripe customer ID
- `status` - 'active', 'canceled', 'past_due', 'unpaid', 'trialing', 'incomplete'
- `plan` - Subscription plan name
- `current_period_start`, `current_period_end` - Billing period
- `cancel_at_period_end` - Whether to cancel at period end

### `usage`
Daily usage tracking for rate limiting and billing.
- `id` (UUID) - Primary key
- `user_id` (UUID, FK to auth.users) - User reference
- `date` (DATE) - Usage date
- `messages_sent` - Number of messages sent
- `tokens_used` - Total tokens consumed
- `api_calls` - Number of API calls made
- Unique constraint on (user_id, date)

### `conversations`
User conversations/threads.
- `id` (UUID) - Primary key
- `user_id` (UUID, FK to auth.users) - User reference
- `title` - Conversation title
- `parent_id` (UUID, FK to conversations) - For hierarchical conversations
- `metadata` (JSONB) - Additional metadata
- `created_at`, `updated_at` - Timestamps

### `messages`
Messages within conversations.
- `id` (UUID) - Primary key
- `conversation_id` (UUID, FK to conversations) - Conversation reference
- `user_id` (UUID, FK to auth.users) - User reference
- `role` - 'user', 'assistant', or 'system'
- `content` - Message content
- `tokens` - Token count for this message
- `metadata` (JSONB) - Additional metadata
- `created_at` - Timestamp

### `embeddings`
Vector embeddings for semantic search.
- `id` (UUID) - Primary key
- `user_id` (UUID, FK to auth.users) - User reference
- `message_id` (UUID, FK to messages) - Message reference
- `conversation_id` (UUID, FK to conversations) - Conversation reference
- `content` - Original content text
- `embedding` (vector(1536)) - OpenAI ada-002 embedding vector
- `created_at` - Timestamp

## Cascade Deletes

All foreign keys use `ON DELETE CASCADE`, so when a user is deleted:
1. Their profile is deleted
2. Their subscription is deleted
3. Their usage records are deleted
4. Their conversations are deleted
5. Their messages are deleted
6. Their embeddings are deleted

This ensures complete data cleanup when accounts are deleted.

## Row Level Security (RLS)

All tables have RLS enabled with policies ensuring:
- Users can only view/modify their own data
- Users can create their own records
- Users can delete their own records

## Automatic Functions

### `handle_new_user()`
Automatically creates a profile when a new user signs up.

### `handle_updated_at()`
Automatically updates the `updated_at` timestamp on updates.

## Indexes

- User ID indexes on all tables for fast lookups
- Date indexes on usage table
- Parent ID index on conversations for hierarchical queries
- HNSW vector index on embeddings for fast similarity search

## Account Deletion

When a user deletes their account:
1. The delete account API route uses Supabase admin API
2. Deletes the auth user via `adminClient.auth.admin.deleteUser()`
3. All related data is automatically deleted via CASCADE constraints
4. User is signed out and redirected to home

If deletion fails due to storage ownership, the system attempts to clean up storage objects first, then retries deletion.

