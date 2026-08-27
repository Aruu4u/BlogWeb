from supabase import create_client
from config import settings

supabase = create_client(
    settings.supabase_url,
    settings.supabase_key
)