import Link from "next/link";

export default function PaymentSuccessPage() {
  return (
    <main className="container payment-status">
      <h1>Payment received</h1>
      <p>Thanks for your payment. We are confirming your booking now.</p>
      <p>If you do not receive a confirmation shortly, please contact support.</p>
      <Link href="/" className="payment-link">
        Return to home
      </Link>
    </main>
  );
}
