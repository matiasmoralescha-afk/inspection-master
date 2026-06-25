import { createClient } from '@supabase/supabase-js'

// Browser-side Supabase client (used for Realtime subscriptions in Client Components)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
)
