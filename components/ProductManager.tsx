"use client";

// Product manager — the code moved 2026-11-09 into
// components/product-manager/ (product-form.tsx, product-list.tsx,
// helpers.ts). This file stays so the existing import in
// app/admin/AdminDashboard.tsx keeps working; it only re-exports
// the same default export.

export { default } from "./product-manager/product-form";
