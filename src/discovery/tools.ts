import type Anthropic from "@anthropic-ai/sdk";

export const DISCOVERY_TOOLS: Anthropic.Tool[] = [
  {
    name: "login",
    description:
      "Sign in as the teller using pre-configured credentials. The credentials are never exposed to you; call this tool and the harness fills them in.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "navigate",
    description: "Navigate the browser to an absolute URL within the allowed target application.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL to navigate to." },
        intent: { type: "string", description: "Why you are navigating here." },
      },
      required: ["url", "intent"],
    },
  },
  {
    name: "click",
    description:
      "Click an element identified by its accessibility role and accessible name, as shown in the accessibility tree observation.",
    input_schema: {
      type: "object",
      properties: {
        role: { type: "string", description: "ARIA role, e.g. 'button' or 'link'." },
        name: { type: "string", description: "Accessible name/text of the element." },
        intent: { type: "string", description: "Why you are clicking this element." },
      },
      required: ["role", "name", "intent"],
    },
  },
  {
    name: "fill",
    description: "Fill a text input or combobox identified by its accessibility role and name.",
    input_schema: {
      type: "object",
      properties: {
        role: { type: "string", description: "ARIA role, e.g. 'textbox'." },
        name: { type: "string", description: "Accessible name/label of the field." },
        value: { type: "string", description: "Value to type into the field." },
        intent: { type: "string", description: "Why you are filling this field." },
      },
      required: ["role", "name", "value", "intent"],
    },
  },
  {
    name: "wait_for",
    description:
      "Wait until an element with the given role and accessible name becomes visible (e.g. after a slow load or navigation).",
    input_schema: {
      type: "object",
      properties: {
        role: { type: "string" },
        name: { type: "string" },
        intent: { type: "string" },
      },
      required: ["role", "name", "intent"],
    },
  },
  {
    name: "extract",
    description:
      "Extract a data value from a table row for later use as a goal output. Identify the row by a stable label in one of its cells (e.g. 'Savings'), not by the value itself — the value will differ on future replays. The harness returns the text of the last cell in that row.",
    input_schema: {
      type: "object",
      properties: {
        rowLabel: {
          type: "string",
          description: "Stable text that identifies the row, e.g. 'Savings' or 'Status'.",
        },
        key: { type: "string", description: "Output key to store this value under, e.g. 'savingsBalance'." },
        intent: { type: "string", description: "Why you are extracting this value." },
      },
      required: ["rowLabel", "key", "intent"],
    },
  },
  {
    name: "finish_goal",
    description:
      "Call this once the goal has been fully accomplished and verified in the current observation. Provide the requested outputs.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-sentence summary of what was accomplished." },
        outputs: {
          type: "object",
          description: "Key/value data the goal asked you to extract, e.g. { savingsBalance: 4820.55 }.",
          additionalProperties: true,
        },
      },
      required: ["summary", "outputs"],
    },
  },
  {
    name: "report_stuck",
    description:
      "Call this if you cannot safely make progress toward the goal (ambiguous state, missing element, repeated failures, or an action that needs human judgment).",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why you cannot proceed." },
      },
      required: ["reason"],
    },
  },
];
