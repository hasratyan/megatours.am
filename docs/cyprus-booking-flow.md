# Cyprus B2C booking flow

Customers pay and confirm the hotel before booking or paying for flights. Hotel-only bookings remain supported. Transfers, excursions and insurance are optional hotel add-ons. Removing the hotel disables extras.

The agent service channel owns inventory and native booking records. Production uses the active **B2C Bookings** agency, `6ad1d1a65259347f817341e9`, in market `am`. Set `bookingAgencyId` in the agent's `B2C_CHANNEL_CONFIG_JSON`; retain hotel markups of `0.12` and transfer/flight markups of `0`. Customer accounts never choose the agency or submit trusted prices.

## Launch configuration

- Set `B2C_CYPRUS_CHECKOUT_ENABLED=true` on B2C only after the agent order routes pass their authenticated service boundary and the agency is active.
- Hotel payment methods must have live bank credentials. Cyprus refuses known bank test endpoints; UAE settings remain independent.
- The production B2C agent URL uses the loopback Nginx listener `http://127.0.0.1:3189`. `/etc/nginx/conf.d/megatours-b2c-agent-internal.conf` forwards only `/api/b2c/v1/` to the active agent upstream with a 300-second timeout. Public airline payments return a processing response before the long supplier request finishes.
- Never expose service tokens, reservation keys, upstream errors or supplier names in customer text.

## Payment and recovery

B2C stores payment intents in `destination_orders`; the agent stores encrypted orders in `b2c_booking_orders`. These records survive search-quote expiry and bank redirects. Card numbers and CVV are never persisted. Bank confirmation requires a server status lookup or the wallet's verified callback, with the exact paid amount and currency.

Flight fares are checked again after hotel confirmation. The customer supplies passenger documents, reviews the current card surcharge, and explicitly accepts the final amount. Flight payment is separate from the hotel checkout. Card verification callbacks use a customer/order-bound, single-use nonce. A payment timeout, pending result or unknown result blocks another charge until its outcome is reconciled. A zero balance alone is not proof of payment.

An order operation is locked before booking/payment submission. Do not clear a stale lock or repeat an `unknown` operation merely because it is old: the supplier may already have accepted it. Reconcile using the order ID, bank reference, supplier booking reference and native booking record. Supplier failures after hotel payment require operator review, confirmation or refund; they do not unlock flight payment. Selected add-ons have independent confirmation states.

Excursion availability uses stable product, modality, date, session, language and fare identity. Rotating reservation keys are refreshed; ambiguous matches are rejected. Transfer pickup dates and times must match the validated quote before payment.

## Verification

Run B2C contract/security tests with `node --test tests/destination-orders.test.mjs`. Agent order integration tests are opt-in and require the disposable local database `b2c_orders_test` at `mongodb://127.0.0.1:27017`; they refuse other database targets and mock all supplier payment/booking calls. Agent CI also verifies the proxy boundary.

Production inventory/prebook checks are read-only. Browser simulations and mocked payment tests do not prove a real card charge, bank challenge or ticket issuance. Customer payment testing must use the real customer-controlled checkout, with its current fare and terms.
