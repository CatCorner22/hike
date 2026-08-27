// ONE-WAY FEEDBACK — Pioneer → hiker, never hiker → Pioneer.
//
// Pioneer gives feedback through objective language (observations) and
// graphics (gauges, layer chip). Hikers cannot prompt it, rate it, copy from
// it, or send any signal back that could train or steer the model. The only
// POST body they may send is a structured prep snapshot for passive
// observation.

export const PIONEER_ONE_WAY_NOTICE =
  "Pioneer observes this hike's prep — language and gauges only. You cannot prompt it, copy its text into the plan, or send it feedback.";

/** Actions hikers must never use to talk TO Pioneer. Enforced in the API route. */
export const PIONEER_FORBIDDEN_USER_ACTIONS = [
  "feedback",
  "rate",
  "thumbs-up",
  "thumbs-down",
  "train",
  "opt-in",
  "opt-out",
  "chat",
  "prompt",
] as const;

export type ForbiddenUserAction = (typeof PIONEER_FORBIDDEN_USER_ACTIONS)[number];

export function isForbiddenUserAction(action: unknown): action is ForbiddenUserAction {
  return (
    typeof action === "string"
    && (PIONEER_FORBIDDEN_USER_ACTIONS as readonly string[]).includes(action)
  );
}
