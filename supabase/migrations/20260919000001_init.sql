-- Phase 0: shared enums. Business tables are added in later phases.

create type public.app_role as enum ('ADMIN', 'STAFF', 'PART_TIMER');
