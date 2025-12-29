using System.Text.Json;
using System.Text.Json.Serialization;

namespace Meziantou.ComicsReader.CatalogServices;

internal sealed class CatalogItemPathJsonConverter : JsonConverter<CatalogItemPath>
{
    public override CatalogItemPath Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        return new CatalogItemPath(reader.GetString() ?? throw new JsonException());
    }

    public override void Write(Utf8JsonWriter writer, CatalogItemPath value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.Value);
    }
}
