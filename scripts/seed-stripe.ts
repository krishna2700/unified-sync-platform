import 'dotenv/config';
import Stripe from 'stripe';

/**
 * Seeds a Stripe test-mode account with realistic sample PaymentIntents spanning the statuses
 * the revenue engine cares about: a few confirmed successes (using Stripe's test payment method
 * token, no real card needed), one explicitly canceled, and a couple left unconfirmed (pending) —
 * so the seeded data actually exercises the allow-list (only "succeeded" counts) end to end.
 */
const SUCCESSFUL_PAYMENTS = [
  { amount: 4999, currency: 'usd', description: 'Pro plan — monthly' },
  { amount: 19999, currency: 'usd', description: 'Enterprise plan — annual (partial seed)' },
  { amount: 2500, currency: 'eur', description: 'Add-on seats' },
];

const PENDING_PAYMENTS = [
  { amount: 9999, currency: 'usd', description: 'Awaiting payment method' },
];

async function main(): Promise<void> {
  const secretKey = process.env['STRIPE_SECRET_KEY'];
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not set — nothing to seed. See .env.example.');
    process.exitCode = 1;
    return;
  }

  const stripe = new Stripe(secretKey);

  for (const payment of SUCCESSFUL_PAYMENTS) {
    const intent = await stripe.paymentIntents.create({
      amount: payment.amount,
      currency: payment.currency,
      description: payment.description,
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: true,
    });
    console.log(`Created + confirmed PaymentIntent: ${intent.id} (${intent.status})`);
  }

  for (const payment of PENDING_PAYMENTS) {
    const intent = await stripe.paymentIntents.create({
      amount: payment.amount,
      currency: payment.currency,
      description: payment.description,
      payment_method_types: ['card'],
    });
    console.log(`Created (unconfirmed) PaymentIntent: ${intent.id} (${intent.status})`);
  }

  const toCancel = await stripe.paymentIntents.create({
    amount: 3000,
    currency: 'usd',
    description: 'Cancelled checkout',
    payment_method_types: ['card'],
  });
  const cancelled = await stripe.paymentIntents.cancel(toCancel.id);
  console.log(`Created + cancelled PaymentIntent: ${cancelled.id} (${cancelled.status})`);

  console.log(
    `Seeded ${SUCCESSFUL_PAYMENTS.length} succeeded, ${PENDING_PAYMENTS.length} pending, and 1 canceled PaymentIntent in Stripe.`,
  );
}

main().catch((error: unknown) => {
  console.error('Stripe seed failed:', error);
  process.exitCode = 1;
});
