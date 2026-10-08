// =========================================================================
// SUPABASE CLIENT
// This is the ONLY place Supabase is configured. Every other file imports
// `sb` from here.
// =========================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// -------------------------------------------------------------------------
// 🔑 ADD YOUR SUPABASE CREDENTIALS HERE
// Find these in your Supabase project: Settings → API
// -------------------------------------------------------------------------
const SUPABASE_URL = 'https://yzrraplauoxbzlbwumer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6cnJhcGxhdW94YnpsYnd1bWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNDE5MzAsImV4cCI6MjEwMzkxNzkzMH0.H0mxOl51qcfXuej0ftLeZLk_P45_y8W4z_tZzJdJ63c';
// -------------------------------------------------------------------------

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
