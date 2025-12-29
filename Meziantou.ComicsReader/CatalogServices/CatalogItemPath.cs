using System.Text.Json.Serialization;
using Meziantou.Framework;

namespace Meziantou.ComicsReader.CatalogServices;

[JsonConverter(typeof(CatalogItemPathJsonConverter))]
public sealed class CatalogItemPath : IEquatable<CatalogItemPath>, IComparable<CatalogItemPath>
{
    internal CatalogItemPath(string value) => Value = value;

    public CatalogItemPath(FullPath rootPath, FullPath filePath)
    {
        if (!filePath.IsChildOf(rootPath))
            throw new ArgumentException($"{filePath} is not a child of {rootPath}", nameof(filePath));

        Value = filePath.MakePathRelativeTo(rootPath).Replace('\\', '/');
    }

    public string Value { get; }

    public string? Directory
    {
        get
        {
            var value = Path.GetDirectoryName(Value);
            if (string.IsNullOrEmpty(value))
                return null;

            return value;
        }
    }

    public string? FirstDirectory
    {
        get
        {
            var value = Path.GetDirectoryName(Value);
            if (string.IsNullOrEmpty(value))
                return null;

            while (true)
            {
                var parent = Path.GetDirectoryName(value);
                if (string.IsNullOrEmpty(parent))
                    return value;

                value = parent;
            }
        }
    }

    public static implicit operator string(CatalogItemPath path) => path.Value;

    public static bool operator ==(CatalogItemPath? left, CatalogItemPath? right) => EqualityComparer<CatalogItemPath>.Default.Equals(left, right);
    public static bool operator !=(CatalogItemPath? left, CatalogItemPath? right) => !(left == right);

    public override string ToString() => Value;
    public override int GetHashCode() => HashCode.Combine(Value);
    public override bool Equals(object? obj) => obj is CatalogItemPath other && Equals(other);

    public bool Equals(CatalogItemPath? other)
    {
        if (other is null)
            return false;

        return Value == other.Value;
    }

    public static bool TryParse(string? name, [NotNullWhen(true)] out CatalogItemPath? result)
    {
        if (name is null)
        {
            result = null;
            return false;
        }

        result = new CatalogItemPath(name);
        return true;
    }

    public int CompareTo(CatalogItemPath? other) => NaturalSortStringComparer.OrdinalIgnoreCase.Compare(Value, other?.Value);

    public static bool operator <(CatalogItemPath left, CatalogItemPath right)
    {
        return left is null ? right is not null : left.CompareTo(right) < 0;
    }

    public static bool operator <=(CatalogItemPath left, CatalogItemPath right)
    {
        return left is null || left.CompareTo(right) <= 0;
    }

    public static bool operator >(CatalogItemPath left, CatalogItemPath right)
    {
        return left is not null && left.CompareTo(right) > 0;
    }

    public static bool operator >=(CatalogItemPath left, CatalogItemPath right)
    {
        return left is null ? right is null : left.CompareTo(right) >= 0;
    }
}
