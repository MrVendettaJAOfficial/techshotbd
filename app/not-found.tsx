// 404 page — generic "this page could not be found" with links
// back home and to the shop. No internals are leaked.

import Link from "next/link";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
      <p className="text-5xl font-bold text-text">404</p>
      <h1 className="mt-4 text-xl font-bold text-text">This page could not be found</h1>
      <p className="mt-2 text-sm text-muted">
        The page you are looking for may have moved, or the link may be out of date.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/">
          <Button>Go home</Button>
        </Link>
        <Link href="/shop">
          <Button variant="outline">Browse the shop</Button>
        </Link>
      </div>
    </main>
  );
}
