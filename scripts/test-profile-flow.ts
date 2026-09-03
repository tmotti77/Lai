#!/usr/bin/env tsx
/**
 * Test script to verify profile extraction and matching data flow.
 * Tests the path: chat extraction → career_profile → recommendations
 */

import { createServiceClient } from "@/lib/supabase/service";
import { buildMatchingProfile } from "@/lib/matching/profile";
import type { Stage } from "@/lib/ai/stages";

async function testProfileFlow() {
  const svc = createServiceClient();
  
  // Create a test user and conversation
  const testUserId = "00000000-0000-0000-0000-000000000001";
  const testConvId = "00000000-0000-0000-0000-000000000002";
  
  console.log("1. Testing profile extraction merge...");
  
  // Simulate extraction data like what runExtraction produces
  const extractionData = {
    interests: [
      { label: "Technology", label_he: "טכנולוגיה", evidence: "test", confidence: "high" },
      { label: "Building", label_he: "בנייה", evidence: "test", confidence: "medium" },
    ],
    skills: [
      { label: "Programming", label_he: "תכנות", evidence: "test", confidence: "high" },
      { label: "Electrical", label_he: "חשמל", evidence: "test", confidence: "medium" },
    ],
    values: ["money", "stability", "freedom"],
    constraints: {
      location_he: "תל אביב",
      remote_ok: true,
      time_per_week_hours: 40,
      training_budget_nis: 10000,
      english_level: "intermediate",
      risk_tolerance: 5,
      needs_immediate_income: false,
      months_until_income_required: 6,
    },
  };
  
  // Call the RPC to merge extraction
  const { error } = await svc.rpc("merge_career_profile", {
    p_user_id: testUserId,
    p_conversation_id: testConvId,
    p_stage: "wrap" as Stage,
    p_data: extractionData as never,
  });
  
  if (error) {
    console.error("❌ Failed to merge profile:", error.message);
    return;
  }
  console.log("✓ Profile merged successfully");
  
  console.log("\n2. Reading profile back...");
  const { data: profile, error: readErr } = await svc
    .from("career_profile")
    .select("*")
    .eq("user_id", testUserId)
    .eq("conversation_id", testConvId)
    .maybeSingle();
    
  if (readErr || !profile) {
    console.error("❌ Failed to read profile:", readErr?.message);
    return;
  }
  
  console.log("✓ Profile found:");
  console.log("  - interests:", profile.data?.interests?.length ?? 0, "items");
  console.log("  - skills:", profile.data?.skills?.length ?? 0, "items");
  console.log("  - values:", profile.data?.values?.length ?? 0, "items");
  console.log("  - constraints:", profile.data?.constraints ? "present" : "missing");
  
  console.log("\n3. Building matching profile...");
  const matchingProfile = buildMatchingProfile({ ...profile, formal: null });
  
  console.log("✓ Matching profile dimensions:");
  console.log("  - interests:", matchingProfile.interests ? "present" : "null");
  console.log("  - skills:", matchingProfile.skills ? `${matchingProfile.skills.length} skills` : "null");
  console.log("  - values:", matchingProfile.values ? "present" : "null");
  console.log("  - big5:", matchingProfile.big5 ? "present" : "null");
  console.log("  - constraints:", matchingProfile.constraints ? "present" : "null");
  
  // Cleanup
  console.log("\n4. Cleaning up test data...");
  await svc.from("career_profile").delete().eq("user_id", testUserId);
  console.log("✓ Cleanup complete");
  
  console.log("\n=== Summary ===");
  if (matchingProfile.skills && matchingProfile.values && matchingProfile.constraints) {
    console.log("✅ Profile flow working correctly!");
    console.log("   Chat-extracted skills, values, and constraints are populated.");
    console.log("   Interests and Big5 are null (expected - need formal assessments).");
  } else {
    console.log("❌ Profile flow has issues:");
    if (!matchingProfile.skills) console.log("   - Skills are missing");
    if (!matchingProfile.values) console.log("   - Values are missing");
    if (!matchingProfile.constraints) console.log("   - Constraints are missing");
  }
}

testProfileFlow().catch(console.error);
