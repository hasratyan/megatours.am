export type CheckoutContactName = {
  firstName: string;
  lastName: string;
};

export type CheckoutGuestName = {
  id: string;
  firstName: string;
  lastName: string;
};

export type CheckoutRoomGuestNames<TGuest extends CheckoutGuestName = CheckoutGuestName> = {
  roomIdentifier: number;
  guests: TGuest[];
};

const normalizeName = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const shouldFollowContactName = (
  currentValue: string,
  previousContactValue: string
) => {
  const current = normalizeName(currentValue);
  const previous = normalizeName(previousContactValue);
  return current.length === 0 || current === previous;
};

export const syncLeadGuestWithContact = <
  TGuest extends CheckoutGuestName,
  TRoom extends CheckoutRoomGuestNames<TGuest>,
>(
  rooms: TRoom[],
  previousContact: CheckoutContactName,
  nextContact: CheckoutContactName
): TRoom[] => {
  let leadFound = false;
  let changed = false;

  const nextRooms = rooms.map((room) => {
    const guests = room.guests.map((guest) => {
      if (leadFound || !guest.id.endsWith("-adult-1")) return guest;
      leadFound = true;

      const nextFirstName = shouldFollowContactName(
        guest.firstName,
        previousContact.firstName
      )
        ? nextContact.firstName
        : guest.firstName;
      const nextLastName = shouldFollowContactName(
        guest.lastName,
        previousContact.lastName
      )
        ? nextContact.lastName
        : guest.lastName;

      if (
        nextFirstName === guest.firstName &&
        nextLastName === guest.lastName
      ) {
        return guest;
      }
      changed = true;
      return {
        ...guest,
        firstName: nextFirstName,
        lastName: nextLastName,
      };
    });
    return guests === room.guests ? room : ({ ...room, guests } as TRoom);
  });

  return changed ? nextRooms : rooms;
};

export const hasManualGuestNameInput = (
  rooms: CheckoutRoomGuestNames[],
  contact: CheckoutContactName
) =>
  rooms.some((room) =>
    room.guests.some((guest) => {
      const hasFirstName = normalizeName(guest.firstName).length > 0;
      const hasLastName = normalizeName(guest.lastName).length > 0;
      const isLeadGuest = guest.id === `room-${room.roomIdentifier}-adult-1`;
      if (!isLeadGuest) return hasFirstName || hasLastName;

      return (
        (hasFirstName &&
          normalizeName(guest.firstName) !== normalizeName(contact.firstName)) ||
        (hasLastName &&
          normalizeName(guest.lastName) !== normalizeName(contact.lastName))
      );
    })
  );
