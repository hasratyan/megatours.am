export const resolveScopedAssistantSessionId = (
  requested: string | null,
  storedSession: { ownerKey?: string } | null,
  requesterOwnerKey: string,
  canContinue: boolean,
  generateId: () => string
): string => {
  if (!requested || !canContinue) return generateId();
  if (storedSession && storedSession.ownerKey !== requesterOwnerKey) return generateId();
  return requested;
};
