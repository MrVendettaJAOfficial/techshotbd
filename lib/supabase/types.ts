// TechShot marketplace — Supabase table types.
// Money is integer poisha (100 poisha = 1 BDT) everywhere.
// These mirror supabase/migrations/0001_initial_schema.sql exactly; if the
// schema changes, update this file in the same change.

export type UserRole = "customer" | "admin";

export type ProductStatus = "draft" | "active" | "paused";

export type OrderStatus =
  | "pending_payment"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "returned";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type CouponType = "fixed";

/** JSON value, as stored in jsonb columns such as orders.address_snapshot. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Snapshot of the delivery address stored on an order at order time. */
export interface AddressSnapshot {
  name: string;
  phone: string;
  division: string;
  district: string;
  city: string;
  full_address: string;
}

export interface Profile {
  id: string;
  display_name: string | null;
  phone: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

/**
 * Legacy only: the seller_profiles table still exists in the database
 * (kept, with its RLS policies — it is never dropped), but nothing in
 * the app reads or writes it any more. TechShot is single-seller: the
 * owner sells, products are store-owned (seller_id null) and managed
 * in /admin. Kept here so the Database type still mirrors the schema.
 */
export interface SellerProfile {
  id: string;
  user_id: string;
  shop_name: string;
  shop_slug: string | null;
  description: string | null;
  logo_path: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  seller_id: string | null;
  category_id: string | null;
  title: string;
  slug: string;
  description: string | null;
  price_poisha: number;
  compare_at_poisha: number | null;
  stock: number;
  status: ProductStatus;
  search_text: string | null;
  rating: number;
  review_count: number;
  is_flash_deal: boolean;
  flash_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: string;
  product_id: string;
  storage_path: string;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  price_override_poisha: number | null;
  stock: number;
  created_at: string;
  updated_at: string;
}

export interface Address {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  division: string;
  district: string;
  city: string;
  full_address: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Cart {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  cart_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  price_snapshot_poisha: number;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  user_id: string;
  status: OrderStatus;
  subtotal_poisha: number;
  delivery_poisha: number;
  discount_poisha: number;
  total_poisha: number;
  address_snapshot: AddressSnapshot | Json;
  payment_method: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  seller_id: string | null;
  title: string;
  price_poisha: number;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  order_id: string;
  provider: string;
  provider_reference: string | null;
  amount_poisha: number;
  status: PaymentStatus;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  user_id: string;
  product_id: string;
  order_id: string | null;
  rating: number;
  text: string | null;
  created_at: string;
  updated_at: string;
}

export interface Wishlist {
  id: string;
  user_id: string;
  product_id: string;
  created_at: string;
  updated_at: string;
}

export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  value_poisha: number;
  min_spend_poisha: number;
  usage_limit: number | null;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Joined shapes used by the storefront / account pages.
// ---------------------------------------------------------------------------

export interface ProductWithImages extends Product {
  product_images: ProductImage[];
  category: Category | null;
}

export interface CartItemWithProduct extends CartItem {
  product: Product | null;
  variant: ProductVariant | null;
}

export interface OrderWithItems extends Order {
  order_items: OrderItem[];
}

// ---------------------------------------------------------------------------
// Database — the shape @supabase/supabase-js and @supabase/ssr expect.
// Row is the shape read from the table; Insert / Update are the shapes
// accepted on write (server-generated columns are optional there).
// ---------------------------------------------------------------------------

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: unknown[];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<
        Profile,
        Omit<Profile, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
          role?: UserRole;
        },
        Partial<Omit<Profile, "id">>
      >;
      seller_profiles: Table<
        SellerProfile,
        Omit<SellerProfile, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<SellerProfile, "id">>
      >;
      categories: Table<
        Category,
        Omit<Category, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<Category, "id">>
      >;
      products: Table<
        Product,
        Omit<Product, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<Product, "id">>
      >;
      product_images: Table<
        ProductImage,
        Omit<ProductImage, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<ProductImage, "id">>
      >;
      product_variants: Table<
        ProductVariant,
        Omit<ProductVariant, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<ProductVariant, "id">>
      >;
      addresses: Table<
        Address,
        Omit<Address, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<Address, "id">>
      >;
      carts: Table<
        Cart,
        Omit<Cart, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<Cart, "id">>
      >;
      cart_items: Table<
        CartItem,
        Omit<CartItem, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<CartItem, "id">>
      >;
      orders: Table<
        Order,
        Omit<Order, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<Order, "id">>
      >;
      order_items: Table<
        OrderItem,
        Omit<OrderItem, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<OrderItem, "id">>
      >;
      payments: Table<
        Payment,
        Omit<Payment, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<Payment, "id">>
      >;
      reviews: Table<
        Review,
        Omit<Review, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<Review, "id">>
      >;
      wishlists: Table<
        Wishlist,
        Omit<Wishlist, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<Wishlist, "id">>
      >;
      coupons: Table<
        Coupon,
        Omit<Coupon, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<Coupon, "id">>
      >;
      audit_log: Table<
        AuditLog,
        Omit<AuditLog, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<AuditLog, "id">>
      >;
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
