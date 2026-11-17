<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Calendars\Imip\Dkim\DnsTxtAnswer;
use App\Services\Calendars\Imip\Dkim\DnsTxtResolver;

/**
 * DNS for DKIM tests: TXT records by name, or `FAIL` for a lookup that fails
 * like a timeout. Every name asked for is in `$queries`. No test queries
 * real DNS.
 */
final class FakeDnsTxtResolver implements DnsTxtResolver
{
    public const FAIL = 'fail';

    /** @var list<string> */
    public array $queries = [];

    /**
     * @param  array<string, list<string>|string>  $records  name => TXT strings, or FAIL
     */
    public function __construct(public array $records = []) {}

    /** The records in `tests/fixtures/Calendars/Dkim/dns.json`. */
    public static function fixtures(): self
    {
        /** @var array<string, string> $records */
        $records = json_decode((string) file_get_contents(dirname(__DIR__).'/fixtures/Calendars/Dkim/dns.json'), true, flags: JSON_THROW_ON_ERROR);

        return new self(array_map(static fn (string $record): array => [$record], $records));
    }

    public function txt(string $name): DnsTxtAnswer
    {
        $this->queries[] = $name;
        $records = $this->records[$name] ?? [];
        if ($records === self::FAIL) {
            return DnsTxtAnswer::error();
        }

        return DnsTxtAnswer::found(is_array($records) ? $records : [$records]);
    }
}
