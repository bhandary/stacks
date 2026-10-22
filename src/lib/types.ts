export const BOOK_STATUSES = ["owned", "reading", "read"] as const;

export type BookStatus = (typeof BOOK_STATUSES)[number];

export type Book = {
  id: string;
  title: string;
  author: string;
  category: string;
  status: BookStatus;
  rating: number | null;
  notes: string;
  isbn: string;
  year: number | null;
  publisher: string;
  pageCount: number | null;
  coverUrl: string;
  description: string;
  isExample: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BookInput = {
  title: string;
  author: string;
  category?: string;
  status?: BookStatus;
  rating?: number | null;
  notes?: string;
  isbn?: string;
  year?: number | null;
  publisher?: string;
  pageCount?: number | null;
  coverUrl?: string;
  description?: string;
  isExample?: boolean;
};

export type BookLookup = {
  isbn: string;
  title: string;
  author: string;
  category: string;
  year: number | null;
  publisher: string;
  pageCount: number | null;
  coverUrl: string;
  description: string;
  sources: string[];
};
