<?php

declare(strict_types=1);

namespace App\Services\VObject;

/**
 * Stringify a Sabre parameter or property.
 *
 * Property::offsetGet() is documented as Node, which has no __toString.
 * Parameters and properties do. Node values that cannot be stringified become
 * an empty string instead of a cast error.
 */
final class VObjectScalar
{
    public static function string(mixed $value): string
    {
        if (is_string($value)) {
            return $value;
        }
        if ($value instanceof \Stringable) {
            return (string) $value;
        }
        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }
        if (is_bool($value)) {
            return $value ? '1' : '';
        }

        return '';
    }
}
