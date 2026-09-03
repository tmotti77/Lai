/**
 * Ensures assistant message has a proper markdown link to /recommendations
 * when the conversation wraps up. Detects if a link already exists; if not,
 * appends a standard Hebrew prompt.
 * 
 * Exported for testing.
 */
export function ensureRecommendationsLink(text: string): string {
  if (!text) return text;

  // Check if text already contains a proper markdown link to recommendations
  // Matches [any text](optional-whitespace /recommendations optional-whitespace) with optional leading/trailing slash
  // Handles whitespace both before and after the path inside parentheses
  const hasLink = /\[[^\]]+\]\(\s*\/?\s*recommendations\/?\s*\)/i.test(text);
  
  if (hasLink) {
    return text; // Already has a clickable link, don't append
  }

  // Append standard Hebrew link prompt
  const linkPrompt = "\n\nתודה! עכשיו אתה יכול לעבור [לדף ההמלצות](/recommendations) כדי לראות את שלושת המסלולים שהתאמתי לך.";
  return text + linkPrompt;
}
