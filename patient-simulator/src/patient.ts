// ── Patient scenario definitions & system prompt builder ──

export interface PatientScenario {
  key: string;
  title: string;
  description: string;
  /** Path to the skill file relative to project root (without extension). */
  skillFile: string;
}

/**
 * Available patient scenarios.
 * Add or edit these to match your curriculum.
 * Each scenario points to a skill file in /patient-scenarios/.
 */
export const SCENARIOS: PatientScenario[] = [
  {
    key: "chest-pain",
    title: "Chest Pain Assessment",
    description: "A 55-year-old male presenting with substernal chest pain.",
    skillFile: "chest-pain",
  },
  {
    key: "migraine",
    title: "Migraine Evaluation",
    description: "A 32-year-old female with recurrent severe headaches.",
    skillFile: "migraine",
  },
  {
    key: "abdominal-pain",
    title: "Abdominal Pain Workup",
    description: "A 45-year-old female with right lower quadrant pain.",
    skillFile: "abdominal-pain",
  },
];

export function getScenario(key: string): PatientScenario | undefined {
  return SCENARIOS.find((s) => s.key === key);
}

/**
 * Build the system prompt for Gemini.
 *
 * Combines:
 *  1. The skill file content (patient persona, behaviour rules)
 *  2. Optional RAG context from Vectorize (indexed material)
 *  3. Standard guardrails for a patient simulator
 */
export function buildSystemPrompt(
  skillFileContent: string,
  ragContext: string | null,
): string {
  let prompt = skillFileContent.trim();

  if (ragContext) {
    prompt += "\n\n---\n\nREFERENCE MATERIAL (from indexed knowledge base):\n";
    prompt += "Use the following context to inform your responses, ";
    prompt += "but stay in character as the patient at all times.\n\n";
    prompt += ragContext;
  }

  // Guardrails appended after the skill file content
  prompt += "\n\n---\n\nCRITICAL RULES:\n";
  prompt += "1. Stay in character as the patient at ALL times.\n";
  prompt += "2. Never break character, never say you are an AI or a simulator.\n";
  prompt += "3. Do not give medical advice or diagnose yourself.\n";
  prompt += "4. Respond as a real patient would — with emotions, ";
  prompt += "uncertainty, and the knowledge level defined in your scenario.\n";
  prompt += "5. Keep responses concise and conversational (1-4 sentences).\n";
  prompt += "6. If the student asks something you (the patient) would not know, ";
  prompt += "say so in character.\n";
  prompt += "7. Do not volunteer information the student has not asked about — ";
  prompt += "wait for them to ask the right questions.\n";

  return prompt;
}
