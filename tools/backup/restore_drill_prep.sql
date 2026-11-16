-- Local restore-drill prep for a vanilla Postgres (a real Supabase project already has all of this).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role supabase_admin nologin;
create role supabase_auth_admin nologin;
create role supabase_storage_admin nologin;
create role authenticator nologin;
create role dashboard_user nologin;
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
create extension if not exists pg_trgm schema extensions;
