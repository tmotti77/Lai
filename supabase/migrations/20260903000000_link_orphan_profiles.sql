-- Migration: Link orphan career_profile rows to user's latest conversation
-- 
-- ROOT CAUSE (proven in production):
-- Anonymous users who uploaded CVs have skills stored in career_profile rows with conversation_id = NULL.
-- The recommendations loader filtered by conversation_id, so it missed these orphan rows.
-- Result: matching ran with empty profile → market-only "account-executive-saas" wildcard.
-- 
-- This migration links existing orphan rows to the user's latest conversation,
-- so the profile loader (now fixed to merge conversation + user-level rows) sees all data.
-- 
-- Safe: Only updates rows where conversation_id IS NULL AND the user has at least one conversation.
-- Idempotent: Re-running has no effect (no NULL rows remain after first run).

UPDATE career_profile cp
SET conversation_id = (
  SELECT id 
  FROM conversations c 
  WHERE c.user_id = cp.user_id 
  ORDER BY c.updated_at DESC 
  LIMIT 1
)
WHERE cp.conversation_id IS NULL
  AND EXISTS (
    SELECT 1 
    FROM conversations c 
    WHERE c.user_id = cp.user_id
  );
