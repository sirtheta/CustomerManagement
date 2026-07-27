"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  EMPTY_SEARCH_RESULTS,
  SEARCH_MIN_LENGTH,
  searchGlobal,
  type GlobalSearchResults,
} from "@/lib/search";

// Read-only typeahead lookup. Deliberately uses auth() instead of
// requireRole(): a redirect mid-keystroke would be wrong, and Viewers
// are allowed to search.
export async function searchAction(query: string): Promise<GlobalSearchResults> {
  const session = await auth();
  if (!session) return EMPTY_SEARCH_RESULTS;

  const term = query.trim();
  if (term.length < SEARCH_MIN_LENGTH) return EMPTY_SEARCH_RESULTS;

  return searchGlobal(prisma, term);
}
