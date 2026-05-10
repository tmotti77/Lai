import { AssessmentLayout } from "@/components/assessment/AssessmentLayout";
import { ValuesPicker } from "@/components/assessment/ValuesPicker";
import { he } from "@/lib/i18n/he";

export const dynamic = "force-dynamic";

export default function ValuesPage() {
  return (
    <AssessmentLayout
      title={he.assessment.values.title}
      intro="בחר את 5 הערכים שהכי חשובים לך, ואז דרג את 3 העליונים."
    >
      <ValuesPicker />
    </AssessmentLayout>
  );
}
