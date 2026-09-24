export type CartOwner =
  | { kind: 'user'; userId: string }
  | { kind: 'guest'; sessionToken: string };

export function cartOwnerFromRequest(input: {
  userId?: string;
  sessionToken?: string;
}): CartOwner | null {
  if (input.userId) {
    return { kind: 'user', userId: input.userId };
  }
  if (input.sessionToken) {
    return { kind: 'guest', sessionToken: input.sessionToken };
  }
  return null;
}
