<?php

declare(strict_types=1);

namespace App\Services\VObject;

use Sabre\VObject\Component;

/**
 * Replace one Sabre child by name.
 *
 * Component::__set() removes every existing child with that name, then adds
 * the new value. PHPStan types the magic property as the property object, so
 * scalar and list writes use this instead of assignment.
 */
final class ComponentProperty
{
    public static function replace(Component $component, string $name, mixed $value): void
    {
        $component->remove($name);
        $component->add($name, $value);
    }
}
