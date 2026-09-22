import type { AoryxRoomOption } from "@/types/aoryx";

export const selectBookableRoomGroup = (options: AoryxRoomOption[], count: number) => {
  const groups = new Map<number, Map<number, AoryxRoomOption>>();
  for (const room of options) {
    const identifier = room.roomIdentifier ?? (count === 1 ? 1 : null);
    if (!room.rateKey || typeof room.groupCode !== "number" ||
        typeof identifier !== "number" ||
        typeof room.totalPrice !== "number" || !Number.isFinite(room.totalPrice) ||
        room.totalPrice <= 0) continue;
    if (identifier < 1 || identifier > count) continue;
    const group = groups.get(room.groupCode) ?? new Map<number, AoryxRoomOption>();
    const previous = group.get(identifier);
    if (!previous || (room.totalPrice ?? Infinity) < (previous.totalPrice ?? Infinity)) {
      group.set(identifier, room);
    }
    groups.set(room.groupCode, group);
  }
  return Array.from(groups.entries())
    .filter(([, group]) => group.size === count)
    .map(([groupCode, group]) => ({
      groupCode,
      rooms: Array.from({ length: count }, (_, index) => group.get(index + 1)!),
    }))
    .sort((a, b) =>
      a.rooms.reduce((sum, room) => sum + (room.totalPrice ?? 0), 0) -
      b.rooms.reduce((sum, room) => sum + (room.totalPrice ?? 0), 0)
    )[0] ?? null;
};
