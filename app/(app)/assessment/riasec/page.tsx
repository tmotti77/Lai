import { AssessmentLayout } from "@/components/assessment/AssessmentLayout";
import { RIASECQuiz } from "@/components/assessment/RIASECQuiz";
import { he } from "@/lib/i18n/he";

export const dynamic = "force-dynamic";

export default function RiasecPage() {
  return (
    <AssessmentLayout title={he.assessment.riasec.title} intro={he.assessment.riasec.intro}>
      <RIASECQuiz />
    </AssessmentLayout>
  );
}
