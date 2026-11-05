import { RECURRING_ORDERS_UNAVAILABLE_MESSAGE } from "@/lib/recurringOrders";

/**
 * Intentionally retained as an explanatory route for historic links.
 * The feature is disabled pending a new audited recurring-order design.
 */
export default function RecurringOrdersPage() {
  return (
    <main className="min-h-screen bg-black px-4 py-20 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center">
        <h1 className="text-3xl font-bold text-foreground">Recurring Orders</h1>
        <p className="mt-4 text-muted-foreground">
          {RECURRING_ORDERS_UNAVAILABLE_MESSAGE}
        </p>
      </section>
    </main>
  );
}
