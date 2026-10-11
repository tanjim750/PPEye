import { supabase } from '@/services/supabase/client';

export function fromTable(table: string) {
  return supabase.from(table);
}
