type RoomCandidate = {
  id?: string | null;
  roomIdentifier?: number | null;
  rateKey?: string | null;
  rateIdentity?: string | null;
  groupCode?: number | null;
  groupIdentity?: string | null;
  roomCombinationId?: number | null;
  marriageIdentifier?: number | null;
  totalPrice?: number | null;
};

export type CompleteRoomGroup<T extends RoomCandidate> = {
  key: string;
  items: T[];
};

export function groupCompleteRoomOptions<T extends RoomCandidate>(
  options: readonly T[],
  requestedRooms: readonly { roomIdentifier: number }[]
): CompleteRoomGroup<T>[] {
  const identifiers = requestedRooms.map((room) => room.roomIdentifier);
  if (identifiers.length === 0 || new Set(identifiers).size !== identifiers.length) return [];

  if (identifiers.length === 1) {
    return options
      .filter((option) => option.roomIdentifier === null || option.roomIdentifier === undefined || option.roomIdentifier === identifiers[0])
      .map((option, index) => ({ key: `single:${option.rateKey ?? index}:${index}`, items: [option] }));
  }

  const requested = new Set(identifiers);
  const groups = new Map<string, Map<number, T>>();
  for (const option of options) {
    const identifier = option.roomIdentifier;
    if (identifier === null || identifier === undefined || !requested.has(identifier)) continue;

    const combination = option.roomCombinationId ?? option.marriageIdentifier;
    const rateKey = (option.rateIdentity ?? option.id ?? option.rateKey)?.trim();
    if (combination === null || combination === undefined) {
      if (!rateKey) continue;
    }
    const key = `${option.groupIdentity ?? option.groupCode ?? "unknown"}:${combination !== null && combination !== undefined ? `combination:${combination}:${option.marriageIdentifier ?? ""}` : `rate:${rateKey}`}`;
    const byIdentifier = groups.get(key) ?? new Map<number, T>();
    const current = byIdentifier.get(identifier);
    if (!current || (
      typeof option.totalPrice === "number" && Number.isFinite(option.totalPrice) &&
      (typeof current.totalPrice !== "number" || option.totalPrice < current.totalPrice)
    )) {
      byIdentifier.set(identifier, option);
    }
    groups.set(key, byIdentifier);
  }

  return Array.from(groups, ([key, byIdentifier]) => ({
    key,
    items: identifiers.map((identifier) => byIdentifier.get(identifier)),
  })).filter((group): group is CompleteRoomGroup<T> => group.items.every((item): item is T => Boolean(item)));
}
