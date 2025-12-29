using System.ComponentModel;
using Meziantou.Framework;

namespace Meziantou.ComicsReader.CatalogServices;

internal sealed class FullPathTypeConverter : TypeConverter
{
    public override bool CanConvertFrom(ITypeDescriptorContext? context, Type sourceType)
    {
        return sourceType == typeof(string) || base.CanConvertFrom(context, sourceType);
    }

    public override object? ConvertFrom(ITypeDescriptorContext? context, CultureInfo? culture, object value)
    {
        if (value is string s)
        {
            return FullPath.FromPath(s);
        }

        return base.ConvertFrom(context, culture, value);
    }
}
