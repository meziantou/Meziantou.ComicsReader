import type { FilterType } from '../types';
import './FilterChips.css';

interface FilterChipsProps {
  currentFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
}

export function FilterChips({ currentFilter, onFilterChange }: FilterChipsProps) {
  return (
    <div className="filter-chips">
      <button
        className={`chip ${currentFilter === 'all' ? 'chip-active' : ''}`}
        onClick={() => onFilterChange('all')}
      >
        All
      </button>
      <button
        className={`chip ${currentFilter === 'one-shot' ? 'chip-active' : ''}`}
        onClick={() => onFilterChange('one-shot')}
      >
        One Shot
      </button>
      <button
        className={`chip ${currentFilter === 'series' ? 'chip-active' : ''}`}
        onClick={() => onFilterChange('series')}
      >
        Series
      </button>
    </div>
  );
}
