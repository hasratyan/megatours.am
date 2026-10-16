import { getServerSession } from "@/lib/auth-compat/server";
import { authOptions } from "@/lib/auth";
import ProfileSignIn from "@/components/profile-signin";
import DestinationOrderClient from "@/components/destinations/destination-order-client";
import { notFound } from "next/navigation";
import { orderIdValid } from "@/lib/packages/order-security";
export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!orderIdValid(orderId)) notFound();
  if (!(await getServerSession(authOptions))?.user?.id) return <main className="container"><ProfileSignIn /></main>;
  return <DestinationOrderClient orderId={orderId} />;
}
