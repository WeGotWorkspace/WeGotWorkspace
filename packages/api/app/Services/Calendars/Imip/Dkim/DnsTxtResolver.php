<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

/**
 * TXT lookups for DKIM keys. Tests bind a fake so no test touches real DNS.
 */
interface DnsTxtResolver
{
    /** `$name` is already checked against DNS name syntax. */
    public function txt(string $name): DnsTxtAnswer;
}
