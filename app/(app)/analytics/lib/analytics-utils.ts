export function categoryParamValue(categoryId: number | null): string {
  return categoryId === null ? "none" : String(categoryId);
}
