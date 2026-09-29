<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use Sabre\VObject\Property;

/**
 * Mutable scratch space for one vCard import.
 */
final class VCardToJsContactState
{
    /** @var array<string, string> */
    public array $groupLabels = [];

    /** @var array<string, string> */
    public array $organizationIdsByGroup = [];

    /** @var list<Property> */
    public array $deferredKnownProperties = [];

    /** @var list<Property> */
    public array $extraFnProperties = [];
}
