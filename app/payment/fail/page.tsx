import Link from "next/link";

export default function PaymentFailPage() {
  return (
    <main className="container payment-status">
      <h1>Payment failed</h1>
      <p>We could not complete the payment. Please try again or contact support.</p>
      <Link href="/" className="payment-link">
        Return to home
      </Link>
    </main>
  );
}
