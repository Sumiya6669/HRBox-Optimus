import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly in dev, but do not crash the whole bundle in prod preview builds.
  console.error(
    '[Optimus KZ] Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Скопируйте .env.example в .env.local и заполните значения из панели Supabase.'
  );
}

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'public-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'optimus-kz-auth',
  },
  // Своих заголовков здесь быть не должно: supabase-js добавляет их ко ВСЕМ
  // запросам, включая вызовы Edge Functions. Нестандартный заголовок обязан быть
  // перечислен в Access-Control-Allow-Headers функции, иначе браузер режет
  // запрос на preflight — так вызов accept-invite падал с ошибкой CORS,
  // не доходя до сервера.
});

export default supabase;
