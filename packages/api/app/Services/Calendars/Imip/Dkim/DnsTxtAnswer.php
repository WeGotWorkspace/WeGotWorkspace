<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

/**
 * The answer to one TXT query: the records found, no record at all
 * (NXDOMAIN or no TXT), or a failed lookup that may work on a later try.
 */
final readonly class DnsTxtAnswer
{
    public const FOUND = 'found';

    public const NONE = 'none';

    public const ERROR = 'error';

    /**
     * @param  list<string>  $records  each record's strings joined
     */
    private function __construct(
        public string $status,
        public array $records,
    ) {}

    /**
     * @param  list<string>  $records
     */
    public static function found(array $records): self
    {
        return $records === [] ? self::none() : new self(self::FOUND, $records);
    }

    public static function none(): self
    {
        return new self(self::NONE, []);
    }

    public static function error(): self
    {
        return new self(self::ERROR, []);
    }
}
