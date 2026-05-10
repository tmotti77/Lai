import { AssessmentLayout } from "@/components/assessment/AssessmentLayout";
import { ValuesPicker } from "@/components/assessment/ValuesPicker";
import { he } from "@/lib/i18n/he";

export const dynamic = "force-dynamic";

export default function ValuesPage() {
  return (
    <AssessmentLayout
      title={he.assessment.values.title}
      intro={he.assessment.hub.valuesPageIntro}
    >
      <ValuesPicker />
    </AssessmentLayout>
  );
}
