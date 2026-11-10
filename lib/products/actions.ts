// TechShot marketplace — product server actions (staff only).
//
// The actions used to live in this file. They have moved, one job
// per file, into lib/products/actions/ — this file is now only a
// re-export barrel so every existing import path keeps working:
//   lib/products/actions/shared.ts       — staff gate, admin client,
//                                         image / variant / audit writers
//   lib/products/actions/upload.ts       — uploadProductImages
//   lib/products/actions/create-update.ts — createProduct, updateProduct
//   lib/products/actions/manage.ts       — setProductStatus, deleteProduct
//
// The staff rules still apply exactly as before (see shared.ts):
// create / delete / upload photos — owner, co-admin, manager;
// update / pause — owner, co-admin, manager (2026-11-10).
//
// NOTE: this barrel deliberately has NO "use server" directive.
// Next.js only allows async-function exports in a "use server" file,
// so a barrel that re-exports actions would fail the build. The
// directive lives in the files where the actions are defined
// (actions/*.ts); re-exporting them from here keeps them server
// actions.

export { uploadProductImages } from "./actions/upload";
export { createProduct, updateProduct } from "./actions/create-update";
export { deleteProduct, setProductStatus } from "./actions/manage";
