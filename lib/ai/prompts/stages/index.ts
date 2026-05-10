import type { Stage } from "@/lib/ai/stages";
import { ONBOARDING_PROMPT } from "./onboarding";
import { INTERESTS_PROMPT } from "./interests";
import { SKILLS_PROMPT } from "./skills";
import { VALUES_PROMPT } from "./values";
import { CONSTRAINTS_PROMPT } from "./constraints";
import { WRAP_PROMPT } from "./wrap";

export const STAGE_PROMPTS: Record<Stage, string> = {
  onboarding: ONBOARDING_PROMPT,
  interests: INTERESTS_PROMPT,
  skills: SKILLS_PROMPT,
  values: VALUES_PROMPT,
  constraints: CONSTRAINTS_PROMPT,
  wrap: WRAP_PROMPT,
  complete:
    "השלב הסתיים. אל תיזום שאלות חדשות. אם המשתמש כותב משהו, השב בקצרה והפנה אותו לשלב הבא של ההמלצות (שעדיין לא קיים בגרסה הנוכחית).",
};
