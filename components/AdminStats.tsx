// Overview / stats cards for the admin dashboard. Renders the seven
// figures from getAdminStats() (lib/admin/stats.ts) as labelled
// cards. Solid colours only, no gradients, no emoji.

import { Card } from "@/components/ui";
import type { AdminStats } from "@/lib/admin/stats";

export default function AdminStats({ stats }: { stats: AdminStats }) {
  const cards: Array<{ label: string; value: number }> = [
    { label: "Total products", value: stats.totalProducts },
    { label: "Total orders", value: stats.totalOrders },
    { label: "Delivered", value: stats.delivered },
    { label: "Not delivered", value: stats.notDelivered },
    { label: "Paid", value: stats.paid },
    { label: "Unpaid", value: stats.unpaid },
    { label: "Returned", value: stats.returned },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Store statistics">
      {cards.map((card) => (
        <Card key={card.label}>
          <p className="text-sm text-muted">{card.label}</p>
          <p className="mt-1 text-2xl font-bold text-text">{card.value}</p>
        </Card>
      ))}
    </div>
  );
}
