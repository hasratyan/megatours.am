import type { NextRequest } from "next/server";
import { destinationOrderRoute } from "@/lib/packages/orders";
export const POST = async (request: NextRequest, { params }: { params: Promise<{ operation: string[] }> }) => destinationOrderRoute(request, (await params).operation.join("/"));
