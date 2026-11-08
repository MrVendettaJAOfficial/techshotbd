// Seller dashboard.
//
// Catalogue override mechanism (see lib/demo-store.ts): the base catalogue
// comes from lib/data/catalog (written by a parallel workstream). Products
// added here, edits, pauses and removals are stored in localStorage via
// lib/demo-store; the shop listing merges the base catalogue with that
// override. Until the shop merge lands, added products are visible here
// and in the override store.
//
// Orders come from lib/checkout-store (listOrders / updateOrderStatus).
// Stored orders carry no seller id, so the dashboard shows all stored
// orders and says so, rather than inventing an attribution. Revenue and
// order counts are computed from the real stored orders, and are
// honestly 0 when there are none.
//
// Approval gate: a seller account needs admin approval before it can
// publish. Until the seller's approval record is "approved", the Add
// product form is disabled and added products stay unpublished.
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { AuthProvider, useAuth } from "@/lib/auth";
import {
  addSellerApproval,
  addSellerProduct,
  getSellerApprovals,
  getSellerProductsOverride,
  removeProduct,
  togglePauseProduct,
  updateSellerProduct,
  type DemoProduct,
  type SellerApproval,
  type SellerProductsOverride,
} from "@/lib/demo-store";
import { formatBDT } from "@/lib/theme";
import { listOrders, updateOrderStatus, type StoredOrder } from "@/lib/checkout-store";
import { Badge, Button, Card, EmptyState, Field, Input, SectionHeading } from "@/components/ui";

interface ListedProduct {
  id: string;
  title: string;
  pricePoisha: number;
  stock: number;
  category: string;
  description: string;
  sellerId?: string;
  paused: boolean;
  isSellerAdded: boolean;
}

interface OrderItem {
  productId?: string;
  title?: string;
  quantity?: number;
  pricePoisha?: number;
}

interface ListedOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalPoisha: number;
  sellerId?: string;
  createdAt?: string;
  items: OrderItem[];
}

/** Stored checkout orders (lib/checkout-store) carry no seller id, so
 *  the seller dashboard shows all stored orders and says so. */
function fromStoredOrder(order: StoredOrder): ListedOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalPoisha: order.total_poisha,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      productId: item.productId,
      title: item.title,
      quantity: item.quantity,
      pricePoisha: item.price_poisha,
    })),
  };
}

const productFormSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters."),
  priceTaka: z.number().positive("Price must be greater than ৳0."),
  stock: z.number().int("Stock must be a whole number.").min(0, "Stock cannot be negative."),
  category: z.string().trim().min(2, "Please enter a category."),
  description: z.string().trim().max(500, "Description must be 500 characters or fewer."),
});

function toPoisha(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  return 0;
}

function productPricePoisha(p: Record<string, unknown>): number {
  if (typeof p.pricePoisha === "number") return toPoisha(p.pricePoisha);
  if (typeof p.price_poisha === "number") return toPoisha(p.price_poisha);
  if (typeof p.price === "number") return toPoisha(p.price); // catalogue prices are in poisha (see lib/theme formatBDT)
  if (typeof p.priceTaka === "number") return Math.round(p.priceTaka * 100);
  return 0;
}

function normalizeCatalogProduct(raw: unknown): ListedProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id : typeof p.slug === "string" ? p.slug : null;
  if (!id) return null;
  return {
    id,
    title: typeof p.title === "string" ? p.title : typeof p.name === "string" ? p.name : "Untitled product",
    pricePoisha: productPricePoisha(p),
    stock: typeof p.stock === "number" ? p.stock : typeof p.inventory === "number" ? p.inventory : 0,
    category: typeof p.category === "string" ? p.category : "General",
    description: typeof p.description === "string" ? p.description : "",
    sellerId: typeof p.sellerId === "string" ? p.sellerId : typeof p.seller === "string" ? p.seller : undefined,
    paused: false,
    isSellerAdded: false,
  };
}

function extractProducts(module: Record<string, unknown>): ListedProduct[] {
  const candidates: unknown[] = [];
  for (const key of ["products", "catalog", "PRODUCTS", "items", "default"]) {
    const value = module[key];
    if (Array.isArray(value)) candidates.push(...value);
    else if (typeof value === "function") {
      try {
        const result = (value as () => unknown)();
        if (Array.isArray(result)) candidates.push(...result);
      } catch {
        // Ignore a catalogue accessor that needs arguments.
      }
    }
  }
  return candidates
    .map(normalizeCatalogProduct)
    .filter((p): p is ListedProduct => p !== null);
}

async function loadCatalogue(): Promise<ListedProduct[]> {
  try {
    const mod = (await import("@/lib/data/catalog")) as Record<string, unknown>;
    return extractProducts(mod);
  } catch {
    return [];
  }
}

function SellerDashboard() {
  const router = useRouter();
  const { user, loading, signOutUser } = useAuth();
  const [override, setOverride] = useState<SellerProductsOverride | null>(null);
  const [catalogue, setCatalogue] = useState<ListedProduct[]>([]);
  const [orders, setOrders] = useState<ListedOrder[]>([]);
  const [catalogueAvailable, setCatalogueAvailable] = useState(false);
  const [ordersAvailable, setOrdersAvailable] = useState(false);
  const [approval, setApproval] = useState<SellerApproval | null>(null);

  const [title, setTitle] = useState("");
  const [priceTaka, setPriceTaka] = useState("");
  const [stock, setStock] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriceTaka, setEditPriceTaka] = useState("");
  const [editStock, setEditStock] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const refreshOverride = useCallback(() => setOverride(getSellerProductsOverride()), []);

  useEffect(() => {
    refreshOverride();
    void loadCatalogue().then((products) => {
      setCatalogue(products);
      setCatalogueAvailable(products.length > 0);
    });
    const stored = listOrders().map(fromStoredOrder);
    setOrders(stored);
    setOrdersAvailable(stored.length > 0);
  }, [refreshOverride]);

  useEffect(() => {
    if (!user || user.role !== "seller") return;
    const existing = getSellerApprovals().find((a) => a.email.toLowerCase() === user.email.toLowerCase());
    if (existing) {
      setApproval(existing);
    } else {
      // Seller signed up before approvals were recorded: create the
      // pending record so an admin can approve it.
      const record: SellerApproval = {
        id: `approval-${user.id}`,
        displayName: user.displayName,
        email: user.email,
        status: "pending",
        createdAt: new Date().toISOString(),
        decidedAt: null,
      };
      addSellerApproval(record);
      setApproval(record);
    }
  }, [user]);

  useEffect(() => {
    if (!loading && !user) router.replace("/auth/sign-in");
  }, [loading, user, router]);

  if (loading || !override) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <p className="text-muted">Loading your seller dashboard…</p>
      </main>
    );
  }

  if (!user) return null;

  if (user.role !== "seller") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <SectionHeading title="Seller dashboard" description="This area is for seller accounts." />
        <EmptyState
          title="You are signed in as a customer"
          description="Seller tools need a seller account. Sign up as a seller, or sign in with a seller account, to manage products and orders."
          action={
            <div className="flex gap-3">
              <Link href="/auth/sign-up">
                <Button>Sign up as a seller</Button>
              </Link>
              <Link href="/shop">
                <Button variant="outline">Back to shop</Button>
              </Link>
            </div>
          }
        />
      </main>
    );
  }

  const isApproved = approval?.status === "approved";

  // Merge base catalogue with the override: edited fields win, paused /
  // removed base products are hidden, seller-added products are included.
  const merged: ListedProduct[] = [
    ...override.added.map((p: DemoProduct): ListedProduct => ({
      id: p.id,
      title: p.title,
      pricePoisha: p.pricePoisha,
      stock: p.stock,
      category: p.category,
      description: p.description,
      sellerId: p.sellerId,
      paused: p.paused,
      isSellerAdded: true,
    })),
    ...catalogue
      .filter((p) => !override.removedIds.includes(p.id))
      .map((p) => {
        const edited = override.edited[p.id];
        return {
          ...p,
          ...(edited ?? {}),
          paused: override.pausedIds.includes(p.id) ? true : p.paused,
        };
      }),
  ];
  // A seller sees their own added products plus the shared catalogue.
  const myProducts = merged.filter((p) => p.isSellerAdded || !p.sellerId || p.sellerId === user.id);
  const visibleProducts = myProducts.filter((p) => !p.paused);

  const ordersWithStatus = orders;
  const ordersCarrySeller = ordersWithStatus.some((o) => Boolean(o.sellerId));
  const myOrders = ordersCarrySeller
    ? ordersWithStatus.filter((o) => o.sellerId === user.id)
    : ordersWithStatus;
  const revenuePoisha = myOrders.reduce((sum, o) => sum + o.totalPoisha, 0);

  function handleAddProduct(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFormNotice(null);
    if (!user) {
      setFormError("Please sign in as a seller to add products.");
      return;
    }
    if (!isApproved) {
      setFormError("Your seller account is waiting for admin approval. You can add products after approval.");
      return;
    }
    const parsed = productFormSchema.safeParse({
      title,
      priceTaka: Number(priceTaka),
      stock: Number(stock),
      category,
      description,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }
    const product: DemoProduct = {
      id: `seller-${Date.now()}`,
      title: parsed.data.title,
      pricePoisha: Math.round(parsed.data.priceTaka * 100),
      stock: parsed.data.stock,
      category: parsed.data.category,
      description: parsed.data.description,
      sellerId: user.id,
      sellerEmail: user.email,
      paused: false,
      createdAt: new Date().toISOString(),
    };
    addSellerProduct(product);
    refreshOverride();
    setTitle("");
    setPriceTaka("");
    setStock("");
    setCategory("");
    setDescription("");
    setFormNotice(`"${product.title}" was added. It is stored in the catalogue override and will appear in the shop listing once the shop merge is applied.`);
  }

  function startEdit(product: ListedProduct) {
    setEditingId(product.id);
    setEditTitle(product.title);
    setEditPriceTaka(String(product.pricePoisha / 100));
    setEditStock(String(product.stock));
    setEditCategory(product.category);
    setEditDescription(product.description);
    setEditError(null);
  }

  function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    const parsed = productFormSchema.safeParse({
      title: editTitle,
      priceTaka: Number(editPriceTaka),
      stock: Number(editStock),
      category: editCategory,
      description: editDescription,
    });
    if (!parsed.success) {
      setEditError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }
    updateSellerProduct(editingId, {
      title: parsed.data.title,
      pricePoisha: Math.round(parsed.data.priceTaka * 100),
      stock: parsed.data.stock,
      category: parsed.data.category,
      description: parsed.data.description,
    });
    setEditingId(null);
    refreshOverride();
  }

  function handlePause(id: string) {
    togglePauseProduct(id);
    refreshOverride();
  }

  function handleRemove(id: string) {
    removeProduct(id);
    refreshOverride();
  }

  function handleAdvanceOrder(order: ListedOrder) {
    const flow = ["pending_payment", "confirmed", "processing", "shipped", "delivered"];
    const index = flow.indexOf(order.status);
    const next = index >= 0 && index < flow.length - 1 ? flow[index + 1] : "delivered";
    updateOrderStatus(order.id, { status: next as StoredOrder["status"] });
    setOrders(listOrders().map(fromStoredOrder));
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Seller dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Signed in as {user.displayName} ({user.email})
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            signOutUser();
            router.push("/");
          }}
        >
          Sign out
        </Button>
      </div>

      {!isApproved ? (
        <div className="mb-6 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text" role="alert">
          {approval?.status === "rejected"
            ? "Your seller application was not approved. Please contact TechShot support if you think this is a mistake."
            : "Your seller account is waiting for admin approval. You can view your shop below, but publishing new products is disabled until an admin approves your account."}
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-text">
          Your seller account is approved. You can publish products.
        </div>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Products listed</p>
          <p className="mt-1 text-2xl font-bold text-text">{visibleProducts.length}</p>
          <p className="text-xs text-muted">{myProducts.length} total, including paused</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Orders</p>
          <p className="mt-1 text-2xl font-bold text-text">{myOrders.length}</p>
          <p className="text-xs text-muted">
            {ordersAvailable ? "From stored checkout orders" : "No stored orders yet"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Revenue</p>
          <p className="mt-1 text-2xl font-bold text-text">{formatBDT(revenuePoisha)}</p>
          <p className="text-xs text-muted">Sum of your stored orders</p>
        </Card>
      </div>

      <SectionHeading title="Add a product" description="Prices are in Bangladeshi Taka (৳). Stock is the number of units you have available." />
      <Card className="mb-10">
        <form onSubmit={handleAddProduct} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="new-title" required>
            <Input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Product title" disabled={!isApproved} />
          </Field>
          <Field label="Price (৳)" htmlFor="new-price" required>
            <Input id="new-price" type="number" min="0" step="1" value={priceTaka} onChange={(e) => setPriceTaka(e.target.value)} placeholder="e.g. 1499" disabled={!isApproved} />
          </Field>
          <Field label="Stock" htmlFor="new-stock" required>
            <Input id="new-stock" type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="e.g. 25" disabled={!isApproved} />
          </Field>
          <Field label="Category" htmlFor="new-category" required>
            <Input id="new-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Electronics" disabled={!isApproved} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="new-description">
              <Input id="new-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description for shoppers" disabled={!isApproved} />
            </Field>
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-[#f87171] sm:col-span-2">{formError}</p>
          ) : null}
          {formNotice ? (
            <p role="status" className="text-sm text-success sm:col-span-2">{formNotice}</p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!isApproved}>
              Add product
            </Button>
          </div>
        </form>
      </Card>

      <SectionHeading
        title="Your products"
        description={
          catalogueAvailable
            ? "Base catalogue products plus products you added. Pause hides a product from shoppers; Edit saves an override."
            : "The base catalogue (lib/data/catalog) is not available yet, so only products you add here are listed."
        }
      />
      {myProducts.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Add your first product with the form above. It will be stored in the catalogue override."
        />
      ) : (
        <div className="space-y-3">
          {myProducts.map((product) => (
            <Card key={product.id}>
              {editingId === product.id ? (
                <form onSubmit={handleSaveEdit} noValidate className="grid gap-3 sm:grid-cols-2">
                  <Field label="Title" htmlFor={`edit-title-${product.id}`} required>
                    <Input id={`edit-title-${product.id}`} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  </Field>
                  <Field label="Price (৳)" htmlFor={`edit-price-${product.id}`} required>
                    <Input id={`edit-price-${product.id}`} type="number" min="0" step="1" value={editPriceTaka} onChange={(e) => setEditPriceTaka(e.target.value)} />
                  </Field>
                  <Field label="Stock" htmlFor={`edit-stock-${product.id}`} required>
                    <Input id={`edit-stock-${product.id}`} type="number" min="0" step="1" value={editStock} onChange={(e) => setEditStock(e.target.value)} />
                  </Field>
                  <Field label="Category" htmlFor={`edit-category-${product.id}`} required>
                    <Input id={`edit-category-${product.id}`} value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Description" htmlFor={`edit-description-${product.id}`}>
                      <Input id={`edit-description-${product.id}`} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                    </Field>
                  </div>
                  {editError ? (
                    <p role="alert" className="text-sm text-[#f87171] sm:col-span-2">{editError}</p>
                  ) : null}
                  <div className="flex gap-2 sm:col-span-2">
                    <Button type="submit" size="sm">Save changes</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-text">
                      {product.title}{" "}
                      {product.paused ? <Badge tone="warning">Paused</Badge> : <Badge tone="success">Live</Badge>}{" "}
                      {product.isSellerAdded ? <Badge tone="brand">Added by you</Badge> : null}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {formatBDT(product.pricePoisha)} · Stock: {product.stock} · {product.category}
                    </p>
                    {product.description ? <p className="mt-1 text-sm text-muted">{product.description}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => startEdit(product)}>Edit</Button>
                    <Button variant="outline" size="sm" onClick={() => handlePause(product.id)}>
                      {product.paused ? "Resume" : "Pause"}
                    </Button>
                    {product.isSellerAdded ? (
                      <Button variant="danger" size="sm" onClick={() => handleRemove(product.id)}>Remove</Button>
                    ) : null}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <div className="mt-10">
        <SectionHeading
          title="Your orders"
          description={
            ordersCarrySeller
              ? "Orders for your products, from stored checkout orders."
              : "Stored orders do not carry a seller id, so all stored orders are shown here."
          }
        />
        {myOrders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="When a customer buys one of your products, the order will appear here with its current status."
          />
        ) : (
          <div className="space-y-3">
            {myOrders.map((order) => (
              <Card key={order.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-text">Order {order.orderNumber || order.id}</p>
                    <p className="mt-1 text-sm text-muted">
                      {formatBDT(order.totalPoisha)} · {order.items.length} item(s)
                      {order.createdAt ? ` · ${new Date(order.createdAt).toLocaleDateString("en-GB")}` : ""}
                    </p>
                    <ul className="mt-2 list-inside list-disc text-sm text-muted">
                      {order.items.map((item, index) => (
                        <li key={`${order.id}-item-${index}`}>
                          {item.title ?? item.productId ?? "Item"} × {item.quantity ?? 1}
                          {item.pricePoisha ? ` — ${formatBDT(item.pricePoisha)} each` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{order.status}</Badge>
                    {order.status !== "delivered" ? (
                      <Button variant="outline" size="sm" onClick={() => handleAdvanceOrder(order)}>
                        Advance status
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <p className="mt-8 text-sm">
        <Link href="/shop" className="font-medium text-brand hover:underline">
          View the shop
        </Link>
      </p>
    </main>
  );
}

export default function SellerPage() {
  return (
    <AuthProvider>
      <SellerDashboard />
    </AuthProvider>
  );
}
