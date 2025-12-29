#pragma warning disable RS0030 // Do not use banned APIs
using System.Runtime.InteropServices;

namespace Meziantou.ComicsReader.CatalogServices;

internal sealed class NaturalSortStringComparer : IComparer<string>, IEqualityComparer<string>
{
    public static NaturalSortStringComparer Ordinal { get; } = new NaturalSortStringComparer(StringComparison.Ordinal);
    public static NaturalSortStringComparer OrdinalIgnoreCase { get; } = new NaturalSortStringComparer(StringComparison.OrdinalIgnoreCase);
    public static NaturalSortStringComparer CurrentCulture { get; } = new NaturalSortStringComparer(StringComparison.CurrentCulture);
    public static NaturalSortStringComparer CurrentCultureIgnoreCase { get; } = new NaturalSortStringComparer(StringComparison.CurrentCultureIgnoreCase);
    public static NaturalSortStringComparer InvariantCulture { get; } = new NaturalSortStringComparer(StringComparison.InvariantCulture);
    public static NaturalSortStringComparer InvariantCultureIgnoreCase { get; } = new NaturalSortStringComparer(StringComparison.InvariantCultureIgnoreCase);

    private readonly StringComparison _comparison;

    private NaturalSortStringComparer(StringComparison comparison) => _comparison = comparison;

    public static NaturalSortStringComparer Create(StringComparison comparison)
    {
        return comparison switch
        {
            StringComparison.Ordinal => Ordinal,
            StringComparison.OrdinalIgnoreCase => OrdinalIgnoreCase,
            StringComparison.CurrentCulture => CurrentCulture,
            StringComparison.CurrentCultureIgnoreCase => CurrentCultureIgnoreCase,
            StringComparison.InvariantCulture => InvariantCulture,
            StringComparison.InvariantCultureIgnoreCase => InvariantCultureIgnoreCase,
            _ => new NaturalSortStringComparer(comparison),
        };
    }

    public int Compare(string? x, string? y)
    {
        // Let string.Compare handle the case where x or y is null
        if (x is null || y is null)
            return string.Compare(x, y, _comparison);

        var xSegments = GetSegments(x);
        var ySegments = GetSegments(y);

        while (xSegments.MoveNext() && ySegments.MoveNext())
        {
            int cmp;

            // If they're both numbers, compare the value
            if (xSegments.CurrentIsNumber && ySegments.CurrentIsNumber)
            {
                var xValue = long.Parse(xSegments.Current);
                var yValue = long.Parse(ySegments.Current);
                cmp = xValue.CompareTo(yValue);
                if (cmp is not 0)
                    return cmp;
            }
            // If x is a number and y is not, x is "lesser than" y
            else if (xSegments.CurrentIsNumber)
            {
                return -1;
            }
            // If y is a number and x is not, x is "greater than" y
            else if (ySegments.CurrentIsNumber)
            {
                return 1;
            }

            // OK, neither are number, compare the segments as text
            cmp = xSegments.Current.CompareTo(ySegments.Current, _comparison);
            if (cmp != 0)
                return cmp;
        }

        // At this point, either all segments are equal, or one string is shorter than the other

        // If x is shorter, it's "lesser than" y
        if (x.Length < y.Length)
            return -1;

        // If x is longer, it's "greater than" y
        if (x.Length > y.Length)
            return 1;

        // If they have the same length, they're equal
        return 0;
    }

    private static StringSegmentEnumerator GetSegments(string s) => new(s);

    public bool Equals(string? x, string? y) => Compare(x, y) is 0;

    public int GetHashCode([DisallowNull] string obj) => 0;

    [StructLayout(LayoutKind.Auto)]
    private ref struct StringSegmentEnumerator
    {
        private ReadOnlySpan<char> _value;

        public StringSegmentEnumerator(ReadOnlySpan<char> s)
        {
            _value = s;
            CurrentIsNumber = false;
        }

        public ReadOnlySpan<char> Current { readonly get; private set; }

        public bool CurrentIsNumber { get; private set; }

        public bool MoveNext()
        {
            if (_value.IsEmpty)
                return false;

            // Rune enumerator
            var currentPosition = 0;
            var rune = _value.EnumerateRunes();
            if (!rune.MoveNext())
                return false;

            var isFirstCharDigit = Rune.IsDigit(rune.Current);
            currentPosition += rune.Current.Utf16SequenceLength;

            while (rune.MoveNext() && Rune.IsDigit(rune.Current) == isFirstCharDigit)
            {
                currentPosition += rune.Current.Utf16SequenceLength;
            }

            Current = _value[..currentPosition];
            _value = _value[currentPosition..];
            CurrentIsNumber = isFirstCharDigit;
            return true;
        }
    }
}
