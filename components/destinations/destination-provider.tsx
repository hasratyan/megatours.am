"use client";
import { createContext, useContext } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { destinationFromPath, getDestination, type DestinationId } from "@/lib/destinations/registry";

const DestinationContext = createContext<DestinationId>("uae");
export function DestinationProvider({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "", query = useSearchParams();
  const explicit = getDestination(path.split("/").filter(Boolean)[1]);
  const destination = explicit?.id ?? (query.get("countryCode") === "CY" || query.get("destinationId") === "cyprus" ? "cyprus" : destinationFromPath(path) ?? "uae");
  return <DestinationContext.Provider value={destination}>{children}</DestinationContext.Provider>;
}
export const useDestination = () => useContext(DestinationContext);
