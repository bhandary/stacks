import type { BookInput } from "./types";

export const EXAMPLE_BOOKS: BookInput[] = [
  {
    title: "Project Hail Mary",
    author: "Andy Weir",
    category: "Science Fiction",
    status: "owned",
    year: 2021,
    isbn: "9780593135204",
    publisher: "Ballantine Books",
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780593135204-M.jpg",
    isExample: true,
  },
  {
    title: "Sapiens",
    author: "Yuval Noah Harari",
    category: "History",
    status: "reading",
    year: 2015,
    isbn: "9780062316097",
    publisher: "Harper",
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780062316097-M.jpg",
    isExample: true,
  },
  {
    title: "The Hobbit",
    author: "J.R.R. Tolkien",
    category: "Fiction",
    status: "read",
    rating: 5,
    year: 2012,
    isbn: "9780547928227",
    publisher: "Houghton Mifflin Harcourt",
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780547928227-M.jpg",
    isExample: true,
  },
];
