create or replace function public.increment_conversation_counters(
  p_conversation_id uuid,
  p_input_tokens int,
  p_output_tokens int
)
returns void
language plpgsql
security definer
as $$
begin
  update public.conversations
  set
    message_count = message_count + 1,
    total_input_tokens = total_input_tokens + coalesce(p_input_tokens, 0),
    total_output_tokens = total_output_tokens + coalesce(p_output_tokens, 0),
    updated_at = now()
  where id = p_conversation_id;
end;
$$;
