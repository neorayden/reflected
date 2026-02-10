import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env then .env.local (local overrides). On Vercel, env vars come from the dashboard only.
dotenv.config();
try {
  dotenv.config({ path: join(__dirname, ".env.local"), override: true });
} catch {
  // .env.local optional (e.g. not present on Vercel)
}
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

const SYSTEM_PROMPT = `You are the analyst for Reflected, a one-question psychological insight tool. Your role is to interpret the user's single open-ended answer as a projection of values and infer personality-relevant traits. You are serious, reflective, non-diagnostic, precise (not mystical), and respectful of the user's intelligence.

CORE BEHAVIOR
- Treat the response as a projection of values, not a factual opinion.
- Infer: what the user believes creates power; what they respect in people; what they distrust or reject; how they think problems should be solved; how they relate to control, responsibility, and morality.

CHARACTER CHOICE
- Batman indicates: human-scale agency, earned capability, control through preparation, respect for limits, responsibility without destiny.
- Superman indicates: inherent power, moral clarity or destiny, protection through strength, transcendence of limits, responsibility due to capability.

PROJECTED TRAIT → INFERRED MEANING
- HARD WORK → values effort over luck, success is earned, respects discipline, distrusts entitlement.
- STRATEGY / PLANNING → analytical problem solver, long-term thinker, emotionally regulated, control-oriented under stress.
- POWER / STRENGTH → values safety and dominance, drawn to certainty, believes force resolves chaos, risk tolerance for authority.
- MORAL CHOICE → strong internal ethics, goodness is intentional, values restraint over impulse, judges character more than outcomes.
- WEALTH / RESOURCES → pragmatic worldview, systems as decisive, values leverage and security, comfortable with hierarchy.
- HOPE / INSPIRATION → idealistic orientation, emotionally expressive, believes symbols matter, motivated by meaning.
- FREEDOM / MOBILITY → autonomy-driven, dislikes constraint, values optionality, resistant to control.

LANGUAGE TONE MODIFIERS
- Agency-focused language → internal locus of control, responsibility-oriented, self-directed attachment tendencies.
- Emotion-heavy language → expressive processing, relational sensitivity, potential reactivity in conflict.
- Pragmatic language → outcome-focused, low tolerance for inefficiency, conflict-solving orientation.
- Idealistic language → vision-driven, meaning-seeking, risk of disappointment.

OUTPUT STRUCTURE (required)
Generate a long-form personality report with exactly these seven sections. Use clear section headings. Write in second person ("you") where appropriate. No scores, no type labels, no diagnosis, no moral judgment. Avoid flattery. Be psychologically precise and humble. Aim for personally accurate, thought-provoking, slightly uncomfortable precision.

1. Core Personality Orientation
   Explain how the user views effort, power, responsibility, and control.

2. Motivation & Values
   Describe what drives them, what they respect, and what they quietly reject.

3. Conflict Style & Decision-Making
   Detail how they approach disagreement, stress, and resolution. Include strengths and blind spots.

4. Attachment & Relational Dynamics
   Describe how they connect, build trust, and handle independence vs closeness. Use non-clinical language.

5. Relationship & Partnership Preferences
   Explain the type of people they are drawn to and what creates friction.

6. Strengths, Shadow, & Growth Edge
   Bullet-point strengths and overextensions. Include one grounded growth insight.

7. Signature Insight
   End with one precise, quotable sentence that captures their worldview.`;

app.post("/api/insight", async (req, res) => {
  const { answer } = req.body;
  if (!answer || typeof answer !== "string") {
    return res.status(400).json({ error: "Missing or invalid answer." });
  }

  const trimmed = answer.trim();
  if (trimmed.length < 10) {
    return res.status(400).json({ error: "Please write at least a few sentences so we can reflect your response meaningfully." });
  }

  const groqKey = (process.env.GROQ_API_KEY || "").trim();
  const hfKey = (process.env.HUGGINGFACE_API_KEY || "").trim();
  if (!groqKey && !hfKey) {
    const onVercel = !!process.env.VERCEL;
    console.warn(
      "[Reflected] Missing API keys. GROQ_API_KEY set:",
      !!groqKey,
      "HUGGINGFACE_API_KEY set:",
      !!hfKey,
      onVercel ? "(Vercel: add both in Project → Settings → Environment Variables, then redeploy)" : ""
    );
    return res.status(500).json({
      error:
        "Server is not configured for AI. Please set GROQ_API_KEY or HUGGINGFACE_API_KEY." +
        (onVercel
          ? " In Vercel: Project → Settings → Environment Variables — add them for Production (and Preview), then redeploy."
          : ""),
    });
  }

  const userMessage = `The user was asked: "Batman or Superman — and why?"\n\nTheir answer:\n\n${trimmed}`;
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  let text = null;
  let lastError = null;

  // Primary: Groq (OpenAI-compatible)
  if (groqKey) {
    try {
      const groq = new OpenAI({
        apiKey: groqKey,
        baseURL: "https://api.groq.com/openai/v1",
      });
      const model = (process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim();
      const completion = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0.6,
        max_tokens: 2000,
      });
      text = completion.choices[0]?.message?.content?.trim();
    } catch (err) {
      lastError = err;
      const msg = err?.message || String(err);
      const status = err?.status || err?.code;
      console.error("[Groq]", status || msg, err?.error?.message || "");
    }
  }

  // Fallback: Hugging Face Inference
  if (!text && hfKey) {
    try {
      const prompt = `${SYSTEM_PROMPT}\n\nUser: ${userMessage}\n\nAssistant:`;
      const hfModel = "mistralai/Mistral-7B-Instruct-v0.2";
      const hfRes = await fetch(`https://api-inference.huggingface.co/models/${hfModel}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 2000,
            temperature: 0.6,
            return_full_text: false,
          },
        }),
      });
      const errBody = await hfRes.text();
      if (!hfRes.ok) {
        throw new Error(`HF ${hfRes.status}: ${errBody.slice(0, 300)}`);
      }
      let data;
      try {
        data = JSON.parse(errBody);
      } catch {
        throw new Error("HF invalid JSON: " + errBody.slice(0, 100));
      }
      // HF can return array or single object; sometimes generated_text is nested
      const raw = Array.isArray(data) ? data[0] : data;
      const generated = raw?.generated_text ?? raw?.[0]?.generated_text;
      text = (generated ?? "").trim();
    } catch (err) {
      lastError = err;
      console.error("[Hugging Face]", err?.message || err);
    }
  }

  if (!text) {
    const hint = lastError?.message?.slice(0, 120) || "";
    return res.status(500).json({
      error: "No insight was generated. Groq and Hugging Face both failed or are unconfigured. Please try again or set GROQ_API_KEY / HUGGINGFACE_API_KEY." +
        (hint ? ` (Server log: ${hint})` : ""),
    });
  }

  return res.json({ report: text });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Reflected running at http://localhost:${PORT}`);
});
