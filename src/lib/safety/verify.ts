/** Night regroup challenge / password — case-insensitive, trimmed match. */

export function verifyChallenge(response: string, expected: string): boolean {
  const a = response.trim().toLowerCase();
  const b = expected.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}

export function verifyPassword(response: string, expected: string): boolean {
  return verifyChallenge(response, expected);
}

export function verifyRegroup(input: {
  challengeResponse: string;
  passwordResponse: string;
  expectedChallenge?: string;
  expectedPassword?: string;
}): { ok: boolean; message: string } {
  const challenge = input.expectedChallenge?.trim();
  const password = input.expectedPassword?.trim();

  if (!challenge && !password) {
    return { ok: false, message: "Set a night challenge and password in ICE first." };
  }

  if (password) {
    if (!verifyPassword(input.passwordResponse, password)) {
      return { ok: false, message: "Password reply does not match." };
    }
    return { ok: true, message: "Regroup verified — party identity confirmed." };
  }

  if (challenge && !verifyChallenge(input.challengeResponse, challenge)) {
    return { ok: false, message: "Challenge word does not match." };
  }

  return { ok: true, message: "Regroup verified — party identity confirmed." };
}
