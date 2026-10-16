import Link from "next/link";
import type { Route } from "next";
import { getDb } from "@/lib/db";
import { cookies } from "next/headers";
import { destinationOrderCopy } from "./destination-order-copy";
export default async function DestinationOrderHistory({ customerId }: { customerId: string }) {
  const cookieLocale = (await cookies()).get("megatours-locale")?.value;
  const locale = cookieLocale === "hy" || cookieLocale === "ru" ? cookieLocale : "en", c = destinationOrderCopy[locale];
  let orders: { _id: string; hotelName?: string; amountAmd: number; createdAt?: Date }[] = [];
  try { orders = await (await getDb()).collection<{ _id: string; customerId: string; hotelName?: string; amountAmd: number; createdAt?: Date }>("destination_orders").find({ customerId }, { projection: { _id: 1, hotelName: 1, amountAmd: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(12).toArray(); } catch { return null; }
  if (!orders.length) return null;
  return <section className="package-checkout__panel checkout-section"><h2>{c.title}</h2><ul>{orders.map((order) => <li key={order._id}><Link href={`/${locale}/orders/${order._id}` as Route}>{order.hotelName || c.hotel} · {new Intl.NumberFormat(locale).format(order.amountAmd)} AMD{order.createdAt ? ` · ${order.createdAt.toLocaleDateString(locale)}` : ""}</Link></li>)}</ul></section>;
}
