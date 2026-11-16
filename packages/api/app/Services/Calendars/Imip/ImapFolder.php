<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/** One folder from IMAP LIST (RFC 3501 7.2.2), its name decoded to UTF-8. */
final class ImapFolder
{
    /**
     * @param  string  $name  full hierarchical name, UTF-8
     * @param  ?string  $delimiter  hierarchy delimiter; null for a flat namespace
     * @param  list<string>  $flags  name attributes, lower-case (`\sent`, `\haschildren`, …)
     */
    public function __construct(
        public readonly string $name,
        public readonly ?string $delimiter,
        public readonly array $flags,
    ) {}
}
