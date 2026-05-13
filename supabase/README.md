# supabase/

DB schema lives here as **timestamped migration files** (Supabase CLI convention) plus a `seed.sql` for local-only bootstrap data.

```
supabase/
├── config.toml                 # Supabase CLI project config (linked to lcayzfqmemitlbjugbsq)
├── migrations/                 # Versioned migrations applied in timestamp order
│   ├── 20260513070000_message_count_trigger.sql
│   ├── 20260513070500_goal_streak_trigger.sql
│   ├── 20260513071000_schema_tightening.sql
│   ├── 20260513071500_commitment_failure_enums.sql
│   ├── 20260513072000_privacy_levels_remap.sql
│   ├── 20260513072500_memory_source_type.sql
│   ├── 20260513073000_permission_tiers.sql
│   ├── 20260513073500_conflicts.sql
│   ├── 20260513074000_approval_rules.sql
│   ├── 20260513074500_conversation_archival.sql
│   ├── 20260513075000_delete_user_completely.sql
│   ├── 20260513075500_ai_disclosure.sql
│   ├── 20260513076000_voice_notes.sql
│   ├── 20260513076500_reminder_followup_columns.sql
│   └── 20260513077000_onboarded_at.sql
├── seed.sql                    # Local-only bootstrap (profile + settings + private space)
├── schema.sql                  # Original snapshot from project bootstrap (LEGACY; do not edit)
└── README.md                   # This file
```

## Initial setup (one-time per developer)

```bash
brew install supabase/tap/supabase   # or curl -fsSL https://supabase.com/install.sh | sh

supabase link --project-ref lcayzfqmemitlbjugbsq
# Prompts for the DB password (Supabase dashboard → Project Settings → Database).
```

## Daily workflow

```bash
# Add a new migration:
supabase migration new <short_name>
# Creates supabase/migrations/<timestamp>_<short_name>.sql. Edit it.

# Apply locally (assumes a local Supabase stack via `supabase start`):
supabase db reset             # destructive; rebuilds from migrations + seed
# Or apply only the new migration without reset:
supabase migration up

# Push to the remote project (production):
supabase db push

# Detect drift between local migrations and remote schema:
supabase db diff
```

## Migrations that were applied via Composio (during this build session)

Every migration under `migrations/20260513*` was applied to the remote project (`lcayzfqmemitlbjugbsq`) via Composio's `SUPABASE_APPLY_A_MIGRATION` / `SUPABASE_BETA_RUN_SQL_QUERY` tools. The migration history table on the remote already reflects them. If you set up a fresh local stack via `supabase db reset`, the same migrations replay in order; `seed.sql` populates the bootstrap rows.

## schema.sql (legacy)

The original snapshot — kept for human reading and as documentation. **Do not edit it for schema changes**; write a new migration instead.
