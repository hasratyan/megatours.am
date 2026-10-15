import type { NextRequest } from "next/server";
import { destinationServiceProxy } from "@/lib/packages/service-proxy";
export const POST = (request: NextRequest, { params }: { params: Promise<{ destination: string }> }) => destinationServiceProxy(request, params, "attractions/search");
