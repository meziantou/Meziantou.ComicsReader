import { describe, it, expect } from 'vitest';
import {
  normalizeString,
  containsInsensitive,
  formatFileSize,
  formatRelativeTime,
  clamp,
} from '../utils/strings';

describe('String Utilities', () => {
  describe('normalizeString', () => {
    it('should convert to lowercase', () => {
      expect(normalizeString('HELLO')).toBe('hello');
      expect(normalizeString('Hello World')).toBe('hello world');
    });

    it('should remove accents', () => {
      expect(normalizeString('café')).toBe('cafe');
      expect(normalizeString('résumé')).toBe('resume');
      expect(normalizeString('Ñoño')).toBe('nono');
      expect(normalizeString('Über')).toBe('uber');
    });

    it('should handle mixed case and accents', () => {
      expect(normalizeString('CAFÉ')).toBe('cafe');
      expect(normalizeString('Éléphant')).toBe('elephant');
    });
  });

  describe('containsInsensitive', () => {
    it('should match case insensitively', () => {
      expect(containsInsensitive('Hello World', 'hello')).toBe(true);
      expect(containsInsensitive('Hello World', 'WORLD')).toBe(true);
      expect(containsInsensitive('Hello World', 'xyz')).toBe(false);
    });

    it('should match accent insensitively', () => {
      expect(containsInsensitive('café', 'cafe')).toBe(true);
      expect(containsInsensitive('cafe', 'café')).toBe(true);
      expect(containsInsensitive('RÉSUMÉ', 'resume')).toBe(true);
    });

    it('should handle partial matches', () => {
      expect(containsInsensitive('The quick brown fox', 'quick')).toBe(true);
      expect(containsInsensitive('Comics/Vol1', 'vol')).toBe(true);
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1048576)).toBe('1 MB');
      expect(formatFileSize(5242880)).toBe('5 MB');
    });

    it('should format gigabytes', () => {
      expect(formatFileSize(1073741824)).toBe('1 GB');
    });
  });

  describe('formatRelativeTime', () => {
    it('should format recent times', () => {
      const now = new Date();
      expect(formatRelativeTime(now.toISOString())).toBe('just now');

      const thirtySecsAgo = new Date(now.getTime() - 30000);
      expect(formatRelativeTime(thirtySecsAgo.toISOString())).toBe('just now');
    });

    it('should format minutes', () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
      expect(formatRelativeTime(fiveMinutesAgo.toISOString())).toBe('5m ago');

      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60000);
      expect(formatRelativeTime(thirtyMinutesAgo.toISOString())).toBe('30m ago');
    });

    it('should format hours', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 3600000);
      expect(formatRelativeTime(twoHoursAgo.toISOString())).toBe('2h ago');
    });

    it('should format days', () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);
      expect(formatRelativeTime(threeDaysAgo.toISOString())).toBe('3d ago');
    });
  });

  describe('clamp', () => {
    it('should return value within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('should clamp to minimum', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('should clamp to maximum', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should handle equal min and max', () => {
      expect(clamp(5, 3, 3)).toBe(3);
    });
  });
});
