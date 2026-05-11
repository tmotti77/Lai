import { AssessmentLayout } from "@/components/assessment/AssessmentLayout";
import { ConstraintsForm } from "@/components/assessment/ConstraintsForm";
import { he } from "@/lib/i18n/he";

export const dynamic = "force-dynamic";

export default function ConstraintsPage() {
  return (
    <AssessmentLayout
      title={he.assessment.constraints.title}
      intro={he.assessment.constraints.intro}
    >
      <ConstraintsForm />
    </AssessmentLayout>
  );
}
