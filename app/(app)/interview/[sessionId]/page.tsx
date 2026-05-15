import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getInterviewSession, loadInterviewMessages } from "@/lib/db/interview";
import { InterviewChat } from "@/components/interview/InterviewChat";
import { WrapUpScreen } from "@/components/interview/WrapUpScreen";

export const dynamic = "force-dynamic";

export default async function InterviewSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);

  const session = await getInterviewSession(sessionId);
  if (!session) notFound();
  if (session.user_id !== userId) redirect("/interview");

  const messages = await loadInterviewMessages(session.id);

  if (session.completed_at) {
    return (
      <div dir="rtl" className="mx-auto max-w-3xl space-y-6 p-6">
        <WrapUpScreen session={session} messages={messages} />
      </div>
    );
  }

  return <InterviewChat session={session} initialMessages={messages} />;
}
