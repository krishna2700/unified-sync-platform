import 'dotenv/config';
import { Client } from '@hubspot/api-client';

/**
 * Seeds a free HubSpot Developer test account with realistic sample data: a handful of contacts
 * at different lifecycle stages, and deals across a few pipeline stages (some with an amount, one
 * deliberately without — exercising the "amount can be null" path the sync adapter handles).
 * Safe to re-run: HubSpot doesn't dedupe by email/name for us, so running this twice will create
 * a second batch — intentional, since this is a one-time seeding script, not part of the sync
 * pipeline's own idempotency guarantees.
 */
const SAMPLE_CONTACTS = [
  {
    email: 'ada.lovelace@example.com',
    firstname: 'Ada',
    lastname: 'Lovelace',
    lifecyclestage: 'customer',
  },
  {
    email: 'grace.hopper@example.com',
    firstname: 'Grace',
    lastname: 'Hopper',
    lifecyclestage: 'customer',
  },
  {
    email: 'alan.turing@example.com',
    firstname: 'Alan',
    lastname: 'Turing',
    lifecyclestage: 'opportunity',
  },
  {
    email: 'margaret.hamilton@example.com',
    firstname: 'Margaret',
    lastname: 'Hamilton',
    lifecyclestage: 'lead',
  },
  {
    email: 'katherine.johnson@example.com',
    firstname: 'Katherine',
    lastname: 'Johnson',
    lifecyclestage: 'subscriber',
  },
];

const SAMPLE_DEALS: Array<{
  dealname: string;
  dealstage: string;
  pipeline: string;
  amount?: string;
}> = [
  {
    dealname: 'Acme Corp — Annual Plan',
    dealstage: 'closedwon',
    amount: '12000',
    pipeline: 'default',
  },
  {
    dealname: 'Globex — Pilot Program',
    dealstage: 'presentationscheduled',
    amount: '4500',
    pipeline: 'default',
  },
  {
    dealname: 'Initech — Enterprise Upgrade',
    dealstage: 'contractsent',
    amount: '25000',
    pipeline: 'default',
  },
  {
    dealname: 'Umbrella Inc — Trial Extension',
    dealstage: 'appointmentscheduled',
    pipeline: 'default',
  }, // no amount
  {
    dealname: 'Wayne Enterprises — Renewal',
    dealstage: 'closedwon',
    amount: '18000',
    pipeline: 'default',
  },
];

async function main(): Promise<void> {
  const accessToken = process.env['HUBSPOT_ACCESS_TOKEN'];
  if (!accessToken) {
    console.error('HUBSPOT_ACCESS_TOKEN is not set — nothing to seed. See .env.example.');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ accessToken });

  for (const contact of SAMPLE_CONTACTS) {
    await client.crm.contacts.basicApi.create({ properties: contact });
    console.log(`Created contact: ${contact.email}`);
  }

  for (const deal of SAMPLE_DEALS) {
    const properties: Record<string, string> = {
      dealname: deal.dealname,
      dealstage: deal.dealstage,
      pipeline: deal.pipeline,
    };
    if (deal.amount) properties['amount'] = deal.amount;
    await client.crm.deals.basicApi.create({ properties });
    console.log(`Created deal: ${deal.dealname}`);
  }

  console.log(
    `Seeded ${SAMPLE_CONTACTS.length} contacts and ${SAMPLE_DEALS.length} deals in HubSpot.`,
  );
}

main().catch((error: unknown) => {
  console.error('HubSpot seed failed:', error);
  process.exitCode = 1;
});
