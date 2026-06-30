package app.rosettacloud.shared.aws;

import software.amazon.awssdk.enhanced.dynamodb.AttributeConverter;
import software.amazon.awssdk.enhanced.dynamodb.AttributeValueType;
import software.amazon.awssdk.enhanced.dynamodb.EnhancedType;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Maps an arbitrary {@code Map<String,Object>} to/from a native DynamoDB Map ({@code M}) attribute,
 * recursing through strings, numbers, booleans, nulls, nested maps and lists.
 *
 * <p>This preserves the EXACT on-the-wire representation written by the Python plane (the
 * {@code agent_tools} Lambda and, during strangler parallel-run, FastAPI) so that {@code metadata}
 * and similar schemaless attributes round-trip without being serialised to a JSON string.
 */
public class DynamoMapAttributeConverter implements AttributeConverter<Map<String, Object>> {

    @Override
    public AttributeValue transformFrom(Map<String, Object> input) {
        if (input == null) {
            return AttributeValue.fromNul(true);
        }
        return AttributeValue.fromM(toAvMap(input));
    }

    @Override
    public Map<String, Object> transformTo(AttributeValue attributeValue) {
        if (attributeValue == null || Boolean.TRUE.equals(attributeValue.nul())) {
            return null;
        }
        return fromAvMap(attributeValue.m());
    }

    @Override
    public EnhancedType<Map<String, Object>> type() {
        return EnhancedType.mapOf(String.class, Object.class);
    }

    @Override
    public AttributeValueType attributeValueType() {
        return AttributeValueType.M;
    }

    private static Map<String, AttributeValue> toAvMap(Map<String, Object> map) {
        Map<String, AttributeValue> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : map.entrySet()) {
            out.put(e.getKey(), toAv(e.getValue()));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static AttributeValue toAv(Object value) {
        if (value == null) {
            return AttributeValue.fromNul(true);
        }
        if (value instanceof String s) {
            return AttributeValue.fromS(s);
        }
        if (value instanceof Boolean b) {
            return AttributeValue.fromBool(b);
        }
        if (value instanceof Number n) {
            return AttributeValue.fromN(n.toString());
        }
        if (value instanceof Map<?, ?> m) {
            Map<String, AttributeValue> nested = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : m.entrySet()) {
                nested.put(String.valueOf(e.getKey()), toAv(e.getValue()));
            }
            return AttributeValue.fromM(nested);
        }
        if (value instanceof Iterable<?> it) {
            List<AttributeValue> list = new ArrayList<>();
            for (Object o : it) {
                list.add(toAv(o));
            }
            return AttributeValue.fromL(list);
        }
        return AttributeValue.fromS(value.toString());
    }

    private static Map<String, Object> fromAvMap(Map<String, AttributeValue> map) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (map != null) {
            for (Map.Entry<String, AttributeValue> e : map.entrySet()) {
                out.put(e.getKey(), fromAv(e.getValue()));
            }
        }
        return out;
    }

    private static Object fromAv(AttributeValue av) {
        if (av == null || Boolean.TRUE.equals(av.nul())) {
            return null;
        }
        if (av.s() != null) {
            return av.s();
        }
        if (av.bool() != null) {
            return av.bool();
        }
        if (av.n() != null) {
            String n = av.n();
            if (n.indexOf('.') < 0 && n.indexOf('e') < 0 && n.indexOf('E') < 0) {
                try {
                    return Long.parseLong(n);
                } catch (NumberFormatException ignored) {
                    return new BigDecimal(n);
                }
            }
            return new BigDecimal(n);
        }
        if (av.hasM()) {
            return fromAvMap(av.m());
        }
        if (av.hasL()) {
            List<Object> list = new ArrayList<>();
            for (AttributeValue item : av.l()) {
                list.add(fromAv(item));
            }
            return list;
        }
        return null;
    }
}
