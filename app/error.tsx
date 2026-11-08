// Error boundary. Deliberately generic: no stack trace, no SQL, no
// table or column names are ever shown to the user. The reference code
// is a random value for this visit only, so support can match a report
// to a server log entry without leaking internals.
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@/components/ui";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const referenceCode = useMemo(() => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    const bytes = new Uint8Array(6);
    window.crypto.getRandomValues(bytes);
    for (const byte of bytes) code += chars[byte % chars.length];
    return `TS-${code}`;
  }, []);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-bold text-text">Something went wrong.</h1>
      <p className="mt-2 text-sm text-muted">
        Please try again. If the problem continues, contact TechShot support and mention reference
        code <span className="font-mono font-medium text-text">{referenceCode}</span>.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Link href="/">
          <Button variant="outline">Go home</Button>
        </Link>
      </div>
    </main>
  );
}
