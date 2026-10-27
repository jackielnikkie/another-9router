// Persona injector: appends a per-combo persona (SOUL.md / AGENT.md text) into the
// system message of the final request body, right before dispatch.
import { injectSystemPrompt } from "./systemInject.js";

export function injectPersona(body, format, persona) {
  if (!persona || typeof persona !== "string") return;
  injectSystemPrompt(body, format, persona);
}
