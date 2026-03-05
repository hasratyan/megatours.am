import { headers } from "next/headers";
import { auth, toAppSession, type AppSession } from "@/lib/auth";

export async function getServerSession(...args: [unknown?]): Promise<AppSession | null> {
  void args;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  return toAppSession(session);
}
