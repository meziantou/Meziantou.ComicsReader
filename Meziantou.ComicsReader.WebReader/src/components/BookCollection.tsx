import type { BookResponse } from '../types';
import { BookPreview } from './BookPreview';
import './BookCollection.css';

interface BookCollectionProps {
  books: BookResponse[];
  showProgress?: boolean;
  eagerLoadCount?: number;
}

export function BookCollection({ books, showProgress = true, eagerLoadCount = 12 }: BookCollectionProps) {
  if (books.length === 0) {
    return null;
  }

  return (
    <div className="book-collection">
      {books.map((book, index) => (
        <BookPreview 
          key={book.path} 
          book={book} 
          showProgress={showProgress}
          eager={index < eagerLoadCount}
        />
      ))}
    </div>
  );
}
