import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = "https://voawgaffsnuxucsinrlg.supabase.co"; 
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvYXdnYWZmc251eHVjc2lucmxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MTUyOTYsImV4cCI6MjA5NDQ5MTI5Nn0.8Nn6CVx13hhMnR20EMTv37xrrRSa9HAYmyF_rmiyZ3I";

export const client = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("Hotel Central PMS: Configuración cargada con éxito.");