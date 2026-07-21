/**
 * AG Grid marks row/cell elements with custom (non-data-) attributes, exactly like the React
 * wrapper does (React 16+ passes unknown lowercased attributes through; Solid's JSX types are
 * stricter, so we widen them here). Augments the module the JSX checker actually uses
 * (`@solidjs/web/jsx-runtime` resolves to the same types file as `@solidjs/web`'s JSX export).
 */
declare module "@solidjs/web/jsx-runtime" {
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- T must match the upstream declaration for interface merging
    interface HTMLAttributes<T> {
      "row-index"?: string | null;
      "row-id"?: string | null;
      "row-business-key"?: string | null;
      "col-id"?: string | null;
    }
  }
}

export {};
