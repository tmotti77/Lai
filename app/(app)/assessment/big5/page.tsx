import { AssessmentLayout } from "@/components/assessment/AssessmentLayout";
import { Big5Quiz } from "@/components/assessment/Big5Quiz";
import { he } from "@/lib/i18n/he";

export const dynamic = "force-dynamic";

export default function Big5Page() {
  return (
    <AssessmentLayout title={he.assessment.big5.title} intro={he.assessment.big5.intro}>
      <Big5Quiz />
    </AssessmentLayout>
  );
}
